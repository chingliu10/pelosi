import pool from '../db/postgres.js';
import {
    getTrueOddsLegacyMatchMarkets,
    getTrueOddsMatch,
    getTrueOddsResults,
    getTrueOddsMatchMarkets,
    searchTrueOddsLegacyMatches,
    searchTrueOddsMatches
} from '../integrations/trueodds-client.js';
import { findDataSourceByCode } from '../repositories/data-source-repository.js';
import { findSportByCode } from '../repositories/sport-repository.js';
import { upsertCompetition } from '../repositories/competition-repository.js';
import { upsertTeam } from '../repositories/team-repository.js';
import { upsertMatch } from '../repositories/match-repository.js';
import {
    createTip,
    findTipByMatchAndSourceOddsId
} from '../repositories/tip-repository.js';

const allowedMarketFilters = new Set([
    'winner',
    'totals',
    'doublechance',
    'handicap',
    'btts'
]);

export async function searchMatchesFromTrueOdds(filters = {}) {
    const searchTerm = filters.q || filters.search;

    if (!searchTerm) {
        throw new Error('q is required');
    }

    try {
        const response = await searchTrueOddsMatches({
            q: searchTerm,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            limit: filters.limit
        });

        return {
            source: 'trueodds-v1',
            matches: response.matches || [],
            count: Number(response.matches?.length || 0),
            integrationWarnings: inspectV1MatchIdentifierCoverage(response.matches || [])
        };
    } catch (error) {
        if (!shouldFallbackToLegacyTrueOdds(error)) {
            throw error;
        }

        const response = await searchTrueOddsLegacyMatches({
            search: searchTerm,
            time: filters.time || '24',
            sort: filters.sort || 'kickoff',
            sports: filters.sports,
            market: normalizeMarketFilter(filters.market),
            selection: filters.selection,
            minOdds: filters.minOdds,
            maxOdds: filters.maxOdds,
            country: filters.country,
            league: filters.league,
            limit: filters.limit
        });

        return {
            source: 'trueodds-live-fallback',
            matches: response.matches || [],
            count: Number(response.count || response.matches?.length || 0),
            matchedPicksCount: Number(response.matched_picks_count || 0),
            facets: response.facets || null,
            nextCursor: response.next_cursor || null,
            integrationWarnings: [
                `Configured /api/v1 search returned ${error.status}, so Pelosi used the deployed /api fallback.`,
                ...inspectLegacyMatchIdentifierCoverage(response.matches || [])
            ]
        };
    }
}

export async function getMarketsFromTrueOdds(matchId) {
    if (!matchId) {
        throw new Error('matchId is required');
    }

    try {
        const response = await getTrueOddsMatchMarkets(matchId);

        return {
            source: 'trueodds-v1',
            matchId: response.matchId,
            markets: response.markets || [],
            integrationWarnings: inspectV1MarketIdentifierCoverage(response.markets || [])
        };
    } catch (error) {
        if (!shouldFallbackToLegacyTrueOdds(error)) {
            throw error;
        }

        const response = await getTrueOddsLegacyMatchMarkets(matchId);
        const marketGroups = response.market_groups || [];

        return {
            source: 'trueodds-live-fallback',
            match: response.match,
            marketGroups,
            markets: marketGroups.map(toPelosiMarketFromLegacyGroup),
            integrationWarnings: [
                `Configured /api/v1 markets returned ${error.status}, so Pelosi used the deployed /api fallback.`,
                ...inspectLegacyMarketIdentifierCoverage(response.match, marketGroups)
            ]
        };
    }
}

export async function getMatchFromTrueOdds(matchId) {
    if (!matchId) {
        throw new Error('matchId is required');
    }

    const response = await getTrueOddsMatch(matchId);

    return {
        source: 'trueodds-v1-match-detail',
        match: response.match,
        settlementLookup: {
            primary: true,
            endpoint: '/api/v1/matches/:matchId',
            note: 'Use this exact match-detail response for future settlement lookup. /api/results is debug/fallback only.'
        }
    };
}

export async function importTipFromTrueOddsMarkets(data) {
    validateImportInput(data);

    const {
        selection: authoritativeSelection,
        marketsSource,
        importWarnings
    } = await resolveImportSource(data.matchId, data);

    validateLegacyImportSourceIds(authoritativeSelection);

    const {
        match: trueOddsMatch,
        market,
        selection
    } = authoritativeSelection;

    const client = await pool.connect();
    let duplicateContext = null;

    try {
        await client.query('BEGIN');

        const source = await findDataSourceByCode('trueodds', client);
        if (!source) {
            throw new Error('trueodds data source does not exist');
        }

        const sport = await findSportByCode(toSportCode(trueOddsMatch.sport_name), client);
        if (!sport) {
            throw new Error(`Sport not found: ${trueOddsMatch.sport_name}`);
        }

        const homeTeam = await upsertTeam(
            {
                sourceId: source.id,
                sourceTeamId: trueOddsMatch.home_team_id,
                sportId: sport.id,
                name: trueOddsMatch.home_team_name,
                country: trueOddsMatch.country ?? null
            },
            client
        );

        const awayTeam = await upsertTeam(
            {
                sourceId: source.id,
                sourceTeamId: trueOddsMatch.away_team_id,
                sportId: sport.id,
                name: trueOddsMatch.away_team_name,
                country: trueOddsMatch.country ?? null
            },
            client
        );

        const competition = await upsertCompetition(
            {
                sourceId: source.id,
                sourceCompetitionId: trueOddsMatch.tournament_id,
                sportId: sport.id,
                name: trueOddsMatch.league,
                country: trueOddsMatch.country ?? null
            },
            client
        );

        const match = await upsertMatch(
            {
                sourceId: source.id,
                sourceMatchId: trueOddsMatch.trueodds_id,
                sportId: sport.id,
                competitionId: competition.id,
                homeTeamId: homeTeam.id,
                awayTeamId: awayTeam.id,
                startsAt: trueOddsMatch.start_time,
                homeScore: trueOddsMatch.home_score ?? null,
                awayScore: trueOddsMatch.away_score ?? null,
                status: normalizeMatchStatus(trueOddsMatch.match_status)
            },
            client
        );

        duplicateContext = {
            matchId: match.id,
            sourceOddsId: selection.event_odds_id ?? null
        };

        // A TrueOdds selection is only imported once per local match. The unique
        // index uq_tips_match_source_odds is the backstop for concurrent imports.
        const existingTip = await findTipByMatchAndSourceOddsId(
            match.id,
            selection.event_odds_id ?? null,
            client
        );

        if (existingTip) {
            throw duplicateTipError(existingTip.id);
        }

        const tip = await createTip(
            {
                matchId: match.id,
                sourceOddsId: selection.event_odds_id ?? null,
                sourceMarketId: marketCompositeIdFromLegacy(market),
                sourceSelectionId: selection.outcome_id ?? null,
                marketCode: inferLegacyMarketCode(market),
                marketName: market.market_title || market.market_name,
                selectionCode: inferLegacySelectionCode(selection),
                selectionName: selection.pick_team || selection.outcome_desc,
                line: inferLine(market.market_specifier),
                odds: Number(selection.odds),
                oddsCapturedAt: selection.odds_captured_at ?? selection.last_fetched_at ?? null,
                result: 'pending',
                creationType: data.creationType ?? 'manual'
            },
            client
        );

        await client.query('COMMIT');

        return {
            source,
            marketsSource,
            importWarnings,
            sport,
            competition,
            homeTeam,
            awayTeam,
            match,
            tip
        };
    } catch (error) {
        await client.query('ROLLBACK');

        // Racing imports hit the unique index instead of the check above.
        if (error?.code === '23505' && duplicateContext) {
            const conflictingTip = await findTipByMatchAndSourceOddsId(
                duplicateContext.matchId,
                duplicateContext.sourceOddsId
            );

            throw duplicateTipError(conflictingTip?.id ?? null);
        }

        throw error;
    } finally {
        client.release();
    }
}

function duplicateTipError(existingTipId) {
    const error = new Error('Tip already imported');
    error.status = 409;
    error.existingTipId = existingTipId === null || existingTipId === undefined
        ? null
        : Number(existingTipId);

    return error;
}

function validateImportInput(data) {
    if (!data?.matchId) throw new Error('matchId is required');
    if (!data?.sourceOddsId && !data?.eventOddsId && !data?.selectionId) {
        if (!data?.market && !data?.marketCode && !data?.sourceMarketId && !data?.marketId) {
            throw new Error('sourceOddsId or market is required');
        }
        if (!data?.selection && !data?.selectionCode) {
            throw new Error('sourceOddsId or selection is required');
        }
    }
    if (data.creationType && !['manual', 'automatic'].includes(data.creationType)) {
        throw new Error('Invalid creation type');
    }
}

/**
 * The authenticated TrueOdds v1 API is the authoritative import source - it is
 * the same feed the admin screen displays, so the odds Pelosi snapshots are the
 * odds the admin saw.
 *
 * The deployed `/api/matches/:id/markets` feed is only used as a fallback when
 * v1 is unavailable (401/403/404) or does not contain the requested selection.
 * Either way the response reports which source was used.
 */
async function resolveImportSource(matchId, request) {
    const importWarnings = [];
    let v1Response = null;

    try {
        v1Response = toLegacyShapedMarketsResponse(await getTrueOddsMatchMarkets(matchId));
    } catch (error) {
        if (!shouldFallbackToLegacyTrueOdds(error)) {
            throw error;
        }

        importWarnings.push(
            `TrueOdds /api/v1 markets returned ${error.status}, so Pelosi fell back to the deployed /api markets feed.`
        );
    }

    if (v1Response) {
        try {
            return {
                selection: buildImportSelectionFromLegacyMarkets(v1Response, request),
                marketsSource: 'trueodds-v1 /api/v1/matches/:matchId/markets',
                importWarnings
            };
        } catch (error) {
            if (error.status !== 404) {
                throw error;
            }

            importWarnings.push(
                'Requested selection was not present in the TrueOdds v1 markets response, so Pelosi fell back to the deployed /api markets feed.'
            );
        }
    }

    const legacyResponse = await getTrueOddsLegacyMatchMarkets(matchId);

    return {
        selection: buildImportSelectionFromLegacyMarkets(legacyResponse, request),
        marketsSource: 'trueodds-live /api/matches/:matchId/markets',
        importWarnings
    };
}

function toLegacyShapedMarketsResponse(response) {
    const match = response?.match ?? {};

    return {
        match: {
            trueodds_id: firstPresent(match.trueOddsId, match.id),
            event_id: firstPresent(match.id, match.trueOddsId),
            sport_name: match.sport?.name ?? null,
            start_time: match.startsAt ?? null,
            country: match.competition?.country ?? null,
            tournament_id: match.competition?.id ?? null,
            league: match.competition?.name ?? null,
            home_team_id: match.homeTeam?.id ?? null,
            home_team_name: match.homeTeam?.name ?? null,
            away_team_id: match.awayTeam?.id ?? null,
            away_team_name: match.awayTeam?.name ?? null,
            match_status: match.providerStatus ?? match.status ?? null,
            home_score: match.score?.home ?? null,
            away_score: match.score?.away ?? null
        },
        market_groups: (response?.markets ?? []).map(toLegacyShapedMarketGroup)
    };
}

function toLegacyShapedMarketGroup(market) {
    const marketName = market.name ?? market.code ?? null;
    const specifier = market.sourceMarketSpecifier ?? '';

    return {
        market_id: market.sourceMarketId,
        market_specifier: specifier,
        market_title: marketName,
        market_name: marketName,
        market_category: market.code,
        market_category_slug: market.code,
        outcomes: (market.selections ?? []).map((selection) => ({
            event_odds_id: selection.sourceOddsId,
            outcome_id: selection.sourceSelectionId ?? null,
            market_id: market.sourceMarketId,
            market_name: marketName,
            market_desc: marketName,
            market_specifier: specifier,
            market_title: marketName,
            bet_type: selection.betType ?? null,
            pick_team: selection.name ?? selection.outcomeName ?? null,
            outcome_desc: selection.outcomeName ?? selection.name ?? null,
            odds: selection.odds,
            is_active: selection.isActive ?? true
        }))
    };
}

export async function getResultsFromTrueOdds(filters = {}) {
    const trueOddsId = filters.trueodds_id ?? filters.trueOddsId;

    if (trueOddsId) {
        return getResultByTrueOddsIdFromTrueOdds(trueOddsId, filters);
    }

    return getTrueOddsResults(filters);
}

export async function getResultByTrueOddsIdFromTrueOdds(trueOddsId, filters = {}) {
    if (!trueOddsId) {
        throw new Error('trueOddsId is required');
    }

    const maxPages = toPositiveInteger(filters.maxPages, 20);
    const query = {
        ...filters,
        limit: toPositiveInteger(filters.limit, 50)
    };

    delete query.trueOddsId;
    delete query.trueodds_id;
    delete query.maxPages;

    let cursor = filters.cursor;

    for (let page = 1; page <= maxPages; page += 1) {
        const response = await getTrueOddsResults({
            ...query,
            cursor
        });
        const matches = response.matches || [];
        const match = matches.find((result) => String(result.trueodds_id) === String(trueOddsId));

        if (match) {
            return {
                source: 'trueodds-live-results-feed',
                match,
                pagesScanned: page,
                integrationWarnings: [
                    'TrueOdds /api/results does not currently filter by trueodds_id, so Pelosi filtered the paged results feed exactly by trueodds_id.'
                ]
            };
        }

        if (!response.next_cursor) {
            break;
        }

        cursor = response.next_cursor;
    }

    const error = new Error(`TrueOdds result not found for trueodds_id ${trueOddsId}`);
    error.status = 404;
    throw error;
}

function normalizeMarketFilter(value) {
    if (!value) {
        return undefined;
    }

    const normalized = String(value).toLowerCase();

    if (!allowedMarketFilters.has(normalized)) {
        throw new Error('Invalid market filter');
    }

    return normalized;
}

function shouldFallbackToLegacyTrueOdds(error) {
    return [401, 403, 404].includes(Number(error.status));
}

function toPositiveInteger(value, fallback) {
    const number = Number(value);

    if (!Number.isInteger(number) || number <= 0) {
        return fallback;
    }

    return number;
}

function toSportCode(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeMatchStatus(status) {
    const normalized = String(status || 'scheduled').toLowerCase();

    if (['scheduled', 'live', 'finished', 'postponed', 'cancelled'].includes(normalized)) {
        return normalized;
    }

    if (['ended', 'closed', 'complete', 'completed'].includes(normalized)) {
        return 'finished';
    }

    return 'scheduled';
}

function marketCompositeIdFromLegacy(market) {
    return `${market.market_id}|${market.market_specifier || ''}`;
}

function buildImportSelectionFromLegacyMarkets(response, request) {
    const trueOddsMatch = normalizeLegacyMatchForImport(response.match);
    const marketGroups = response.market_groups || [];
    const candidates = [];

    for (const market of marketGroups) {
        for (const selection of market.outcomes || []) {
            if (matchesImportRequest(market, selection, request)) {
                candidates.push({ match: trueOddsMatch, market, selection });
            }
        }
    }

    if (candidates.length === 0) {
        const error = new Error('Requested market/selection is not present in the current TrueOdds markets response');
        error.status = 404;
        throw error;
    }

    if (candidates.length > 1) {
        const error = new Error('Requested market/selection matched multiple TrueOdds outcomes; provide sourceOddsId for an exact import');
        error.status = 400;
        throw error;
    }

    const odds = Number(candidates[0].selection.odds);

    if (!Number.isFinite(odds) || odds <= 1) {
        const error = new Error('Selected TrueOdds outcome has invalid odds');
        error.status = 502;
        throw error;
    }

    return candidates[0];
}

function normalizeLegacyMatchForImport(match) {
    return {
        ...match,
        home_team_id: firstPresent(match.home_team_id, match.homeTeamId, match.home_team_source_id),
        away_team_id: firstPresent(match.away_team_id, match.awayTeamId, match.away_team_source_id),
        tournament_id: firstPresent(match.tournament_id, match.competition_id, match.source_competition_id),
        trueodds_id: firstPresent(match.trueodds_id, match.trueOddsId),
        event_id: firstPresent(match.event_id, match.id, match.source_match_id)
    };
}

function firstPresent(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function matchesImportRequest(market, selection, request) {
    const requestedOddsId = request.sourceOddsId ?? request.eventOddsId ?? request.selectionId;

    if (requestedOddsId) {
        return String(selection.event_odds_id) === String(requestedOddsId);
    }

    if (!matchesRequestedMarket(market, request)) {
        return false;
    }

    return matchesRequestedSelection(selection, request);
}

function matchesRequestedMarket(market, request) {
    const requestedMarketId = request.sourceMarketId ?? request.marketId;

    if (requestedMarketId && String(market.market_id) !== String(requestedMarketId)) {
        return false;
    }

    if (request.marketSpecifier !== undefined && String(market.market_specifier || '') !== String(request.marketSpecifier || '')) {
        return false;
    }

    const requestedMarket = normalizeMarketAlias(request.market ?? request.marketCode);

    if (!requestedMarket) {
        return true;
    }

    return normalizeMarketAlias(market.market_category_slug)
        === requestedMarket
        || normalizeMarketAlias(inferLegacyMarketCode(market)) === requestedMarket;
}

function matchesRequestedSelection(selection, request) {
    const requestedSelection = normalizeSelectionAlias(request.selection ?? request.selectionCode);

    if (!requestedSelection) {
        return true;
    }

    return normalizeSelectionAlias(inferLegacySelectionCode(selection)) === requestedSelection
        || normalizeSelectionAlias(selection.outcome_desc) === requestedSelection
        || normalizeSelectionAlias(selection.bet_type) === requestedSelection
        || normalizeSelectionAlias(selection.pick_team) === requestedSelection;
}

function normalizeMarketAlias(value) {
    const normalized = String(value || '').trim().toLowerCase();

    if (!normalized) return '';
    if (['winner', 'main', '1x2', 'match_result'].includes(normalized)) return 'winner';
    if (['totals', 'total_goals', 'over_under', 'over/under'].includes(normalized)) return 'totals';
    if (['doublechance', 'double_chance', 'double chance'].includes(normalized)) return 'doublechance';
    if (['gg', 'btts', 'gg/ng', 'gg_ng', 'both_teams_to_score'].includes(normalized)) return 'btts';
    if (normalized === 'handicap') return 'handicap';

    return normalized;
}

function normalizeSelectionAlias(value) {
    const normalized = String(value || '').trim().toLowerCase();

    if (!normalized) return '';
    if (['home', 'home_win'].includes(normalized)) return 'home';
    if (['away', 'away_win'].includes(normalized)) return 'away';
    if (normalized === 'draw') return 'draw';
    if (normalized.startsWith('over')) return 'over';
    if (normalized.startsWith('under')) return 'under';
    if (['yes', 'gg_yes'].includes(normalized)) return 'yes';
    if (['no', 'gg_no'].includes(normalized)) return 'no';
    if (['home_draw', 'home or draw', 'home_or_draw', 'draw_home', '1x'].includes(normalized)) return 'home_draw';
    if (['home_away', 'home or away', 'home_or_away', 'away_home', '12'].includes(normalized)) return 'home_away';
    if (['draw_away', 'draw or away', 'draw_or_away', 'away_draw', 'x2'].includes(normalized)) return 'draw_away';

    return normalized;
}

function validateLegacyImportSourceIds(authoritativeSelection) {
    const { match, selection } = authoritativeSelection;
    const missing = [];

    if (!match.trueodds_id) missing.push('match.trueodds_id');
    if (!match.event_id) missing.push('match.event_id');
    if (!match.home_team_id) missing.push('match.home_team_id');
    if (!match.away_team_id) missing.push('match.away_team_id');
    if (!match.tournament_id) missing.push('match.tournament_id');
    if (!selection.event_odds_id) missing.push('selection.event_odds_id');

    if (missing.length > 0) {
        const error = new Error(`TrueOdds /api markets response is missing required source IDs for import: ${missing.join(', ')}`);
        error.status = 502;
        throw error;
    }
}

function inspectV1MatchIdentifierCoverage(matches) {
    const warnings = [];

    if (matches.some((match) => !match.id)) warnings.push('Some matches are missing match.id.');
    if (matches.some((match) => !match.homeTeam?.id)) warnings.push('Some matches are missing homeTeam.id.');
    if (matches.some((match) => !match.awayTeam?.id)) warnings.push('Some matches are missing awayTeam.id.');
    if (matches.some((match) => !match.competition?.id)) warnings.push('Some matches are missing competition.id.');

    return warnings;
}

function inspectV1MarketIdentifierCoverage(markets) {
    const warnings = [];

    if (markets.some((market) => !market.sourceMarketId)) warnings.push('Some markets are missing sourceMarketId.');
    if (markets.some((market) => market.sourceMarketSpecifier === undefined)) warnings.push('Some markets are missing sourceMarketSpecifier.');

    const selections = markets.flatMap((market) => market.selections || []);

    if (selections.some((selection) => !selection.sourceOddsId)) warnings.push('Some selections are missing sourceOddsId.');
    if (selections.some((selection) => !selection.sourceSelectionId)) warnings.push('Some selections are missing sourceSelectionId.');

    return warnings;
}

function inspectLegacyMatchIdentifierCoverage(matches) {
    const warnings = [];

    if (matches.some((match) => !match.event_id)) {
        warnings.push('Some fallback matches are missing event_id.');
    }

    if (matches.some((match) => !match.home_team_id || !match.away_team_id)) {
        warnings.push('Fallback /api/matches responses do not include stable home_team_id/away_team_id fields.');
    }

    if (matches.some((match) => !match.tournament_id && !match.competition_id)) {
        warnings.push('Fallback /api/matches responses do not include a stable competition/tournament identifier.');
    }

    return warnings;
}

function inspectLegacyMarketIdentifierCoverage(match, marketGroups) {
    const warnings = [];

    if (match && (!match.home_team_id || !match.away_team_id)) {
        warnings.push('Fallback market response match object does not include stable team IDs.');
    }

    if (match && !match.tournament_id && !match.competition_id) {
        warnings.push('Fallback market response match object does not include a stable competition/tournament ID.');
    }

    if (marketGroups.some((group) => !group.market_id)) {
        warnings.push('Some fallback market groups are missing market_id.');
    }

    const outcomes = marketGroups.flatMap((group) => group.outcomes || []);

    if (outcomes.some((outcome) => !outcome.event_odds_id)) {
        warnings.push('Some fallback outcomes are missing event_odds_id.');
    }

    return warnings;
}

function toPelosiMarketFromLegacyGroup(group) {
    return {
        id: `${group.market_id}|${group.market_specifier || ''}`,
        sourceMarketId: String(group.market_id),
        sourceMarketSpecifier: group.market_specifier || '',
        code: inferLegacyMarketCode(group),
        name: group.market_title || group.market_name,
        category: group.market_category,
        line: inferLine(group.market_specifier),
        selections: (group.outcomes || []).map((outcome) => ({
            id: String(outcome.event_odds_id),
            sourceOddsId: String(outcome.event_odds_id),
            sourceSelectionId: outcome.outcome_id || null,
            code: inferLegacySelectionCode(outcome),
            name: outcome.pick_team || outcome.outcome_desc,
            odds: Number(outcome.odds),
            raw: outcome
        })),
        raw: group
    };
}

function inferLegacyMarketCode(group) {
    const title = String(group.market_title || group.market_name || '').toLowerCase();
    const slug = String(group.market_category_slug || group.market_category || '').toLowerCase();

    if (title.includes('1x2') || slug === 'match_result') return 'MATCH_RESULT';
    if (title.includes('double chance') || slug === 'double_chance') return 'DOUBLE_CHANCE';
    if (title.includes('over/under') || slug === 'total_goals') return 'TOTAL_GOALS';
    if (title.includes('handicap') || slug === 'handicap') return 'HANDICAP';
    if (
        title.includes('gg/ng')
        || title.includes('both teams to score')
        || slug === 'btts'
        || slug === 'both_teams_to_score'
    ) {
        return 'BTTS';
    }

    return 'UNKNOWN';
}

function inferLegacySelectionCode(outcome) {
    const value = String(outcome.outcome_desc || outcome.pick_team || outcome.bet_type || '').trim().toLowerCase();
    const doubleChanceCode = inferDoubleChanceSelectionCode(value);

    if (doubleChanceCode) return doubleChanceCode;

    if (value === 'home' || value.includes('home win')) return 'HOME';
    if (value === 'away' || value.includes('away win')) return 'AWAY';
    if (value === 'draw') return 'DRAW';
    if (value.includes('over')) return 'OVER';
    if (value.includes('under')) return 'UNDER';
    if (value === 'yes') return 'YES';
    if (value === 'no') return 'NO';

    return 'UNKNOWN';
}

/**
 * Double chance selections are stored with explicit two-way codes
 * (HOME_OR_DRAW / HOME_OR_AWAY / DRAW_OR_AWAY) so settlement never has to
 * guess from display names.
 */
function inferDoubleChanceSelectionCode(value) {
    let normalized = value.replace(/[\s-]+/g, '_');

    if (normalized.startsWith('double_chance')) {
        const separatorIndex = normalized.indexOf('|');
        normalized = separatorIndex === -1 ? 'double_chance' : normalized.slice(separatorIndex + 1);
    }

    if (['home_or_draw', 'home_draw', 'draw_home', '1x'].includes(normalized)) return 'HOME_OR_DRAW';
    if (['home_or_away', 'home_away', 'away_home', '12'].includes(normalized)) return 'HOME_OR_AWAY';
    if (['draw_or_away', 'draw_away', 'away_draw', 'x2'].includes(normalized)) return 'DRAW_OR_AWAY';

    return null;
}

function inferLine(specifier) {
    const match = String(specifier || '').match(/(?:total|hcp)=(-?\d+(?:\.\d+)?)/);

    return match ? Number(match[1]) : null;
}
