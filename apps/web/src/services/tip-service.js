import {
    countTips,
    countTipsByResult,
    createTip as createTipRecord,
    findTipById,
    findTipWithMatchById,
    findTipsByIds,
    findTipsByMatchId,
    listTips,
    markTipPublished,
    updateTipResult
} from '../repositories/tip-repository.js';

const allowedTipResults = ['pending', 'won', 'lost', 'void'];
const allowedCreationTypes = ['manual', 'automatic'];
const defaultTipListLimit = 50;
const maxTipListLimit = 100;
const maxSearchLength = 100;

function validateTipInput(data) {
    if (!data.matchId) throw new Error('matchId is required');
    if (!data.marketCode) throw new Error('marketCode is required');
    if (!data.selectionCode) throw new Error('selectionCode is required');

    const odds = Number(data.odds);
    if (!Number.isFinite(odds) || odds <= 1) {
        throw new Error('odds must be greater than 1');
    }

    if (data.result && !allowedTipResults.includes(data.result)) {
        throw new Error('Invalid tip result');
    }

    if (data.creationType && !allowedCreationTypes.includes(data.creationType)) {
        throw new Error('Invalid creation type');
    }
}

export async function createTip(data) {
    validateTipInput(data);

    return createTipRecord({
        ...data,
        odds: Number(data.odds),
        result: data.result ?? 'pending',
        creationType: data.creationType ?? 'manual'
    });
}

/**
 * Tip list used by the admin Tips Manager and (next) the slip builder.
 * One joined query plus one count query - no per-row lookups.
 */
export async function getTips(filters = {}) {
    const normalizedFilters = normalizeTipListFilters(filters);
    const rows = await listTips(normalizedFilters);
    const total = await countTips(normalizedFilters);
    const counts = await countTipsByResult(normalizedFilters);

    return {
        tips: rows.map((row) => toTipResponse(row)),
        count: rows.length,
        total,
        limit: normalizedFilters.limit,
        offset: normalizedFilters.offset,
        counts: toResultCounts(counts),
        result: normalizedFilters.result ?? null,
        marketCode: normalizedFilters.marketCode ?? null,
        creationType: normalizedFilters.creationType ?? null,
        matchId: normalizedFilters.matchId ?? null,
        search: normalizedFilters.search ?? null
    };
}

export async function getTipById(id) {
    const row = await findTipWithMatchById(normalizeTipId(id));

    if (!row) {
        return null;
    }

    return {
        ...toTipResponse(row),
        source: {
            oddsId: row.source_odds_id,
            marketId: row.source_market_id,
            selectionId: row.source_selection_id
        }
    };
}

export async function getTipsByIds(ids) {
    return findTipsByIds(ids);
}

export async function getTipsByMatchId(matchId) {
    return findTipsByMatchId(matchId);
}

export async function settleTip(id, resultValue) {
    if (!allowedTipResults.includes(resultValue)) {
        throw new Error('Invalid tip result');
    }

    return updateTipResult(id, resultValue);
}

export async function publishTip(id) {
    return markTipPublished(id);
}

export async function getFlatTipById(id) {
    return findTipById(normalizeTipId(id));
}

function normalizeTipListFilters(filters = {}) {
    const result = normalizeFilterValue(filters.result);
    const marketCode = normalizeFilterValue(filters.marketCode);
    const creationType = normalizeFilterValue(filters.creationType);

    if (result && !allowedTipResults.includes(result)) {
        throw badRequest('Invalid result. Allowed values: pending, won, lost, void');
    }

    if (creationType && !allowedCreationTypes.includes(creationType)) {
        throw badRequest('Invalid creationType. Allowed values: manual, automatic');
    }

    const limit = normalizeIntegerOption(filters.limit, defaultTipListLimit, 'limit');
    const offset = normalizeIntegerOption(filters.offset, 0, 'offset');
    const matchId = normalizeIntegerOption(filters.matchId, null, 'matchId');

    if (limit <= 0 || limit > maxTipListLimit) {
        throw badRequest(`Invalid limit. Allowed range: 1-${maxTipListLimit}`);
    }

    if (offset < 0) {
        throw badRequest('Invalid offset. Must be zero or greater');
    }

    if (matchId !== null && matchId <= 0) {
        throw badRequest('Invalid matchId. Must be a positive integer');
    }

    const search = normalizeSearch(filters.search);

    return {
        result,
        marketCode,
        creationType,
        matchId,
        search,
        limit,
        offset
    };
}

function normalizeSearch(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return null;
    }

    const search = String(value).trim();

    if (search.length > maxSearchLength) {
        throw badRequest(`Invalid search. Maximum ${maxSearchLength} characters`);
    }

    return search;
}

function normalizeFilterValue(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    return String(value).trim().toLowerCase();
}

function normalizeIntegerOption(value, fallback, name) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const number = Number(value);

    if (!Number.isInteger(number)) {
        throw badRequest(`Invalid ${name}. Must be an integer`);
    }

    return number;
}

function normalizeTipId(id) {
    if (id === undefined || id === null || String(id).trim() === '') {
        throw badRequest('tipId is required');
    }

    const number = Number(id);

    if (!Number.isInteger(number) || number <= 0) {
        throw badRequest('Invalid tip id');
    }

    return number;
}

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;

    return error;
}

function toResultCounts(rows) {
    const counts = {
        all: 0,
        pending: 0,
        won: 0,
        lost: 0,
        void: 0
    };

    for (const row of rows) {
        const total = Number(row.total);

        if (row.result in counts) {
            counts[row.result] = total;
        }

        counts.all += total;
    }

    return counts;
}

function toTipResponse(row) {
    return {
        id: Number(row.id),
        result: row.result,
        creationType: row.creation_type,
        odds: Number(row.odds),
        marketCode: row.market_code,
        marketName: row.market_name,
        selectionCode: row.selection_code,
        selectionName: row.selection_name,
        line: row.line === null ? null : Number(row.line),
        oddsCapturedAt: row.odds_captured_at,
        publishedAt: row.published_at,
        settledAt: row.settled_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        match: {
            id: Number(row.match_id),
            sourceMatchId: row.source_match_id,
            homeTeam: row.home_team,
            awayTeam: row.away_team,
            competition: row.competition,
            startsAt: row.starts_at,
            status: row.match_status,
            homeScore: row.home_score === null ? null : Number(row.home_score),
            awayScore: row.away_score === null ? null : Number(row.away_score)
        }
    };
}
