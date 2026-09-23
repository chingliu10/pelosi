import {
    appTimezone,
    assertValidDateString,
    todayInAppTimezone
} from '../config/app-timezone.js';
import {
    countPublicTipsByResult,
    findPublicTipById,
    listPublicTips
} from '../repositories/public-tip-repository.js';

const allowedResults = new Set(['all', 'pending', 'won', 'lost', 'void']);

export async function getPublicTips(filters = {}) {
    const normalized = normalizePublicTipFilters(filters);
    const rows = await listPublicTips(normalized);
    const counts = await countPublicTipsByResult(normalized);

    return {
        date: normalized.date,
        result: normalized.requestedResult,
        timezone: normalized.timezone,
        tips: rows.map(toPublicTip),
        count: rows.length,
        counts: toResultCounts(counts)
    };
}

export async function getPublicTipById(id) {
    const tipId = normalizeTipId(id);
    const row = await findPublicTipById(tipId);

    return row ? toPublicTip(row) : null;
}

function normalizePublicTipFilters(filters = {}) {
    const timezone = appTimezone();
    const date = filters.date === undefined || filters.date === null || String(filters.date).trim() === ''
        ? todayInAppTimezone(new Date(), timezone)
        : assertValidDateString(filters.date);
    const requestedResult = filters.result === undefined || filters.result === null || String(filters.result).trim() === ''
        ? 'all'
        : String(filters.result).trim().toLowerCase();

    if (!allowedResults.has(requestedResult)) {
        const error = new Error('Invalid result. Allowed values: all, pending, won, lost, void');
        error.status = 400;
        throw error;
    }

    return {
        date,
        timezone,
        requestedResult,
        result: requestedResult === 'all' ? null : requestedResult
    };
}

function normalizeTipId(id) {
    const number = Number(id);

    if (!Number.isInteger(number) || number <= 0) {
        const error = new Error('Invalid tip id');
        error.status = 400;
        throw error;
    }

    return number;
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

function toPublicTip(row) {
    return {
        id: Number(row.id),
        result: row.result,
        odds: Number(row.odds),
        marketCode: row.market_code,
        marketName: row.market_name,
        selectionCode: row.selection_code,
        selectionName: row.selection_name,
        line: row.line === null ? null : Number(row.line),
        settledAt: row.settled_at,
        match: {
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
