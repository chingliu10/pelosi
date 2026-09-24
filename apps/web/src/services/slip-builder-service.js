import pool from '../db/postgres.js';
import { todayInAppTimezone } from '../config/app-timezone.js';
import { findDataSourceByCode } from '../repositories/data-source-repository.js';
import { findSportByCode } from '../repositories/sport-repository.js';
import { upsertCompetition } from '../repositories/competition-repository.js';
import { upsertTeam } from '../repositories/team-repository.js';
import { upsertMatch } from '../repositories/match-repository.js';
import {
    createTip,
    findTipByMatchAndSourceOddsId
} from '../repositories/tip-repository.js';
import {
    attachTipsToSlip,
    createSlip as createSlipRecord
} from '../repositories/slip-repository.js';
import { slipTypeForCount } from '../utils/slip-type.js';
import { getSlipById } from './slip-service.js';
import { resolveTrueOddsSelectionForSlip } from './trueodds-service.js';

export const builderTtlMs = 24 * 60 * 60 * 1000;
export { slipTypeForCount };

export function getBuilder(req, now = new Date()) {
    const builder = currentBuilder(req, now);

    return toBuilderResponse(builder, now);
}

export async function addBuilderSelection(req, data, options = {}) {
    const resolver = options.resolveSelection ?? resolveTrueOddsSelectionForSlip;
    const builder = currentBuilder(req, options.now ?? new Date());
    const input = normalizeSelectionInput(data);

    if (builder.selections.some((selection) => sameSelection(selection, input))) {
        touchBuilder(req, builder, options.now);
        return toBuilderResponse(builder, options.now ?? new Date());
    }

    if (builder.selections.some((selection) => String(selection.matchId) === String(input.matchId))) {
        throw badRequest('A slip cannot contain multiple selections from the same match');
    }

    const resolved = await resolver(input);
    const selection = toSessionSelection(input, resolved, options.now ?? new Date());

    if (builder.selections.some((existing) => String(existing.matchId) === String(selection.matchId))) {
        throw badRequest('A slip cannot contain multiple selections from the same match');
    }

    builder.selections.push(selection);
    touchBuilder(req, builder, options.now);

    return toBuilderResponse(builder, options.now ?? new Date());
}

export function removeBuilderSelection(req, sourceOddsId, options = {}) {
    const builder = currentBuilder(req, options.now ?? new Date());
    const before = builder.selections.length;

    builder.selections = builder.selections.filter(
        (selection) => String(selection.sourceOddsId) !== String(sourceOddsId)
    );

    if (builder.selections.length !== before) {
        touchBuilder(req, builder, options.now);
    }

    return toBuilderResponse(builder, options.now ?? new Date());
}

export function clearBuilder(req) {
    delete req.session.slipBuilder;

    return toBuilderResponse({ selections: [], updatedAt: null }, new Date());
}

export async function saveBuilderSlip(req, data = {}, options = {}) {
    const now = options.now ?? new Date();
    const resolver = options.resolveSelection ?? resolveTrueOddsSelectionForSlip;
    const builder = currentBuilder(req, now);

    if (builder.selections.length === 0) {
        throw badRequest('Add at least one selection before saving the slip');
    }

    assertNoDuplicateSelections(builder.selections);
    assertNoSameMatchSelections(builder.selections);

    // All external work happens before the PostgreSQL transaction starts.
    const resolvedSelections = [];

    for (const selection of builder.selections) {
        resolvedSelections.push(await resolver({
            matchId: selection.matchId,
            sourceOddsId: selection.sourceOddsId
        }));
    }

    assertNoSameMatchResolvedSelections(resolvedSelections);

    const client = await pool.connect();
    let slipId = null;
    const tipIds = [];
    const reusedTipIds = [];
    const createdTipIds = [];
    const oddsChanges = [];

    try {
        await client.query('BEGIN');

        for (let index = 0; index < resolvedSelections.length; index += 1) {
            const resolved = resolvedSelections[index];
            const original = builder.selections[index];
            const tip = await upsertResolvedSelectionTip(resolved, client);

            if (tip.reused) {
                reusedTipIds.push(Number(tip.row.id));
            } else {
                createdTipIds.push(Number(tip.row.id));
            }

            tipIds.push(Number(tip.row.id));

            if (Number(original.displayedOdds) !== Number(resolved.selection.odds)) {
                oddsChanges.push({
                    sourceOddsId: String(original.sourceOddsId),
                    from: Number(original.displayedOdds),
                    to: Number(resolved.selection.odds)
                });
            }
        }

        const tips = await loadTipsForSlip(tipIds, client);
        const totalOdds = Number(tips.reduce((total, tip) => total * Number(tip.odds), 1).toFixed(4));
        const slip = await createSlipRecord(
            {
                title: normalizeTitle(data.title),
                slipDate: todayInAppTimezone(now),
                totalOdds,
                stakeUnits: 1,
                creationType: 'manual'
            },
            client
        );

        await attachTipsToSlip(slip.id, tipIds, client);
        await client.query('COMMIT');
        slipId = slip.id;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    delete req.session.slipBuilder;

    const slip = await getSlipById(slipId);
    const legCount = slip.tips.length;

    return {
        slip: {
            ...slip,
            legCount,
            slipType: slipTypeForCount(legCount),
            legs: slip.tips
        },
        reusedTipIds,
        createdTipIds,
        oddsChanges
    };
}

async function upsertResolvedSelectionTip(resolved, client) {
    const source = await findDataSourceByCode('trueodds', client);
    if (!source) throw new Error('trueodds data source does not exist');

    const sport = await findSportByCode(toSportCode(resolved.match.sportName), client);
    if (!sport) throw new Error(`Sport not found: ${resolved.match.sportName}`);

    const homeTeam = await upsertTeam({
        sourceId: source.id,
        sourceTeamId: resolved.match.homeTeamId,
        sportId: sport.id,
        name: resolved.match.homeTeamName,
        country: resolved.match.country
    }, client);
    const awayTeam = await upsertTeam({
        sourceId: source.id,
        sourceTeamId: resolved.match.awayTeamId,
        sportId: sport.id,
        name: resolved.match.awayTeamName,
        country: resolved.match.country
    }, client);
    const competition = await upsertCompetition({
        sourceId: source.id,
        sourceCompetitionId: resolved.match.sourceCompetitionId,
        sportId: sport.id,
        name: resolved.match.competitionName,
        country: resolved.match.country
    }, client);
    const match = await upsertMatch({
        sourceId: source.id,
        sourceMatchId: resolved.match.sourceMatchId,
        sportId: sport.id,
        competitionId: competition.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        startsAt: resolved.match.startsAt,
        homeScore: resolved.match.homeScore,
        awayScore: resolved.match.awayScore,
        status: resolved.match.status
    }, client);

    const existingTip = await findTipByMatchAndSourceOddsId(
        match.id,
        resolved.selection.sourceOddsId,
        client
    );

    if (existingTip) {
        if (existingTip.result !== 'pending') {
            throw badRequest(`Selection already exists as settled tip ${existingTip.id} (${existingTip.result})`);
        }

        return { row: existingTip, reused: true };
    }

    const created = await createTip({
        matchId: match.id,
        sourceOddsId: resolved.selection.sourceOddsId,
        sourceMarketId: resolved.market.sourceMarketId,
        sourceSelectionId: resolved.selection.sourceSelectionId,
        marketCode: resolved.market.code,
        marketName: resolved.market.name,
        selectionCode: resolved.selection.code,
        selectionName: resolved.selection.name,
        line: resolved.market.line,
        odds: resolved.selection.odds,
        oddsCapturedAt: resolved.selection.oddsCapturedAt,
        result: 'pending',
        creationType: 'manual'
    }, client);

    return { row: created, reused: false };
}

async function loadTipsForSlip(tipIds, client) {
    const result = await client.query(
        `
        SELECT id, odds
        FROM tips
        WHERE id = ANY($1::bigint[])
        `,
        [tipIds]
    );
    const byId = new Map(result.rows.map((tip) => [Number(tip.id), tip]));

    return tipIds.map((id) => byId.get(id));
}

function currentBuilder(req, now = new Date()) {
    const builder = req.session.slipBuilder;

    if (!builder || isExpired(builder, now)) {
        req.session.slipBuilder = {
            selections: [],
            updatedAt: null
        };

        return req.session.slipBuilder;
    }

    builder.selections = Array.isArray(builder.selections) ? builder.selections : [];

    return builder;
}

function isExpired(builder, now) {
    if (!builder.updatedAt) return false;

    return now.getTime() - new Date(builder.updatedAt).getTime() >= builderTtlMs;
}

function touchBuilder(req, builder, now = new Date()) {
    builder.updatedAt = now.toISOString();
    req.session.slipBuilder = builder;
}

function toBuilderResponse(builder, now = new Date()) {
    const selections = builder.selections ?? [];

    return {
        selections,
        selectionCount: selections.length,
        slipType: selections.length > 0 ? slipTypeForCount(selections.length) : null,
        previewTotalOdds: previewTotalOdds(selections),
        updatedAt: builder.updatedAt,
        expiresAt: builder.updatedAt ? new Date(new Date(builder.updatedAt).getTime() + builderTtlMs).toISOString() : null
    };
}

function previewTotalOdds(selections) {
    if (selections.length === 0) return 1;

    return Number(selections.reduce((total, selection) => total * Number(selection.displayedOdds), 1).toFixed(4));
}

function normalizeSelectionInput(data) {
    if (!data?.matchId) throw badRequest('matchId is required');
    if (!data?.sourceOddsId) throw badRequest('sourceOddsId is required');

    return {
        matchId: String(data.matchId).trim(),
        sourceOddsId: String(data.sourceOddsId).trim()
    };
}

function toSessionSelection(input, resolved, now) {
    return {
        matchId: String(input.matchId),
        sourceOddsId: String(input.sourceOddsId),
        match: {
            homeTeam: resolved.match.homeTeamName,
            awayTeam: resolved.match.awayTeamName,
            competition: resolved.match.competitionName,
            startsAt: resolved.match.startsAt
        },
        market: {
            code: resolved.market.code,
            name: resolved.market.name,
            line: resolved.market.line
        },
        selection: {
            code: resolved.selection.code,
            name: resolved.selection.name
        },
        displayedOdds: Number(resolved.selection.odds),
        addedAt: now.toISOString()
    };
}

function sameSelection(selection, input) {
    return String(selection.matchId) === String(input.matchId)
        && String(selection.sourceOddsId) === String(input.sourceOddsId);
}

function assertNoDuplicateSelections(selections) {
    const seen = new Set();

    for (const selection of selections) {
        const key = `${selection.matchId}:${selection.sourceOddsId}`;

        if (seen.has(key)) throw badRequest('Duplicate selections are not allowed');
        seen.add(key);
    }
}

function assertNoSameMatchSelections(selections) {
    const seen = new Set();

    for (const selection of selections) {
        const key = String(selection.matchId);

        if (seen.has(key)) throw badRequest('A slip cannot contain multiple selections from the same match');
        seen.add(key);
    }
}

function assertNoSameMatchResolvedSelections(selections) {
    const seen = new Set();

    for (const selection of selections) {
        const key = String(selection.match.sourceMatchId);

        if (seen.has(key)) throw badRequest('A slip cannot contain multiple selections from the same match');
        seen.add(key);
    }
}

function normalizeTitle(value) {
    const title = String(value ?? '').trim();

    return title || null;
}

function toSportCode(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;

    return error;
}
