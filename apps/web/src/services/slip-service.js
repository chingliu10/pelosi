import pool from '../db/postgres.js';
import { findTipsByIds } from '../repositories/tip-repository.js';
import {
    attachTipsToSlip,
    createSlip as createSlipRecord,
    findSlipById as findSlipRecordById,
    getSlipWithLegs,
    hideSlip as hideSlipRecord,
    listSlips,
    publishSlip as publishSlipRecord,
    updateSlipResult
} from '../repositories/slip-repository.js';

const allowedPublicationStatuses = new Set(['draft', 'published', 'hidden']);
const allowedSlipResults = new Set(['pending', 'won', 'lost', 'void']);
const allowedCreationTypes = new Set(['manual', 'automatic']);
const defaultSlipListLimit = 50;
const maxSlipListLimit = 100;

export async function getSlipById(slipId) {
    const rows = await getSlipWithLegs(normalizeSlipId(slipId));

    if (rows.length === 0) {
        return null;
    }

    return shapeSlipWithLegs(rows);
}

/**
 * Slip listing used by the admin list and by the public history query
 * (`?publicationStatus=published`). Returns light rows with a leg count, not
 * the nested tip structure - that stays on GET /api/v1/slips/:id.
 */
export async function getSlips(filters = {}) {
    const normalizedFilters = normalizeSlipListFilters(filters);
    const rows = await listSlips(normalizedFilters);

    return {
        slips: rows.map(toSlipListRow),
        count: rows.length,
        limit: normalizedFilters.limit,
        offset: normalizedFilters.offset,
        publicationStatus: normalizedFilters.publicationStatus ?? null,
        result: normalizedFilters.result ?? null
    };
}

export async function createSlip(data) {
    const tipIds = validateSlipInput(data);
    const uniqueTipIds = ensureUniqueTipIds(tipIds);
    const client = await pool.connect();
    let slipId;

    try {
        await client.query('BEGIN');

        const tips = await findTipsByIds(uniqueTipIds, client);
        validateAllTipsFound(uniqueTipIds, tips);

        const tipsById = new Map(tips.map((tip) => [String(tip.id), tip]));
        const orderedTips = uniqueTipIds.map((tipId) => tipsById.get(String(tipId)));
        const totalOdds = calculateTotalOdds(orderedTips);

        const slip = await createSlipRecord(
            {
                title: data.title ?? null,
                slipDate: data.slipDate ?? new Date().toISOString().slice(0, 10),
                totalOdds,
                stakeUnits: 1,
                creationType: data.creationType ?? 'manual'
            },
            client
        );

        await attachTipsToSlip(slip.id, uniqueTipIds, client);

        await client.query('COMMIT');
        slipId = slip.id;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    return getSlipById(slipId);
}

/**
 * Publishing is a publication action, not a settlement action, so a pending
 * slip can be published. It only changes publication_status/published_at.
 *
 * `publishSlip` in the repository uses COALESCE(published_at, NOW()), so an
 * already published slip (or a re-published hidden slip) keeps its original
 * published_at instead of getting a new timestamp.
 */
export async function publishSlip(id) {
    const slip = await publishSlipRecord(normalizeSlipId(id));

    if (!slip) {
        return null;
    }

    return getSlipById(slip.id);
}

/**
 * Hiding never deletes the slip, its legs or its money fields. published_at is
 * deliberately preserved as the historical publication record.
 */
export async function hideSlip(id) {
    const slip = await hideSlipRecord(normalizeSlipId(id));

    if (!slip) {
        return null;
    }

    return getSlipById(slip.id);
}

export async function settleSlipFromTips(id) {
    const slip = await getSlipById(id);

    if (!slip) {
        return null;
    }

    if (slip.tips.some((tip) => tip.result === 'void')) {
        throw new Error('Void-leg slip settlement rules are not defined yet');
    }

    if (slip.tips.some((tip) => tip.result === 'lost')) {
        return updateSlipResult(id, {
            result: 'lost',
            returnUnits: 0,
            profitUnits: -Number(slip.stakeUnits)
        });
    }

    if (slip.tips.every((tip) => tip.result === 'won')) {
        const returnUnits = Number(slip.stakeUnits) * Number(slip.totalOdds);

        return updateSlipResult(id, {
            result: 'won',
            returnUnits,
            profitUnits: returnUnits - Number(slip.stakeUnits)
        });
    }

    return updateSlipResult(id, {
        result: 'pending',
        returnUnits: null,
        profitUnits: null
    });
}

export async function getFlatSlipById(id) {
    return findSlipRecordById(normalizeSlipId(id));
}

function normalizeSlipListFilters(filters = {}) {
    const publicationStatus = normalizeFilterValue(filters.publicationStatus);
    const result = normalizeFilterValue(filters.result);
    const creationType = normalizeFilterValue(filters.creationType);

    if (publicationStatus && !allowedPublicationStatuses.has(publicationStatus)) {
        throw badRequest('Invalid publicationStatus. Allowed values: draft, published, hidden');
    }

    if (result && !allowedSlipResults.has(result)) {
        throw badRequest('Invalid result. Allowed values: pending, won, lost, void');
    }

    if (creationType && !allowedCreationTypes.has(creationType)) {
        throw badRequest('Invalid creationType. Allowed values: manual, automatic');
    }

    const limit = normalizeIntegerOption(filters.limit, defaultSlipListLimit, 'limit');
    const offset = normalizeIntegerOption(filters.offset, 0, 'offset');

    if (limit <= 0 || limit > maxSlipListLimit) {
        throw badRequest(`Invalid limit. Allowed range: 1-${maxSlipListLimit}`);
    }

    if (offset < 0) {
        throw badRequest('Invalid offset. Must be zero or greater');
    }

    return { publicationStatus, result, creationType, limit, offset };
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

function normalizeSlipId(id) {
    if (id === undefined || id === null || String(id).trim() === '') {
        throw badRequest('slipId is required');
    }

    const number = Number(id);

    if (!Number.isInteger(number) || number <= 0) {
        throw badRequest('Invalid slip id');
    }

    return number;
}

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;

    return error;
}

function validateSlipInput(data) {
    if (!data || !Array.isArray(data.tipIds)) {
        throw new Error('tipIds is required');
    }

    if (data.tipIds.length === 0) {
        throw new Error('At least one tipId is required');
    }

    for (const tipId of data.tipIds) {
        if (!Number.isInteger(Number(tipId)) || Number(tipId) <= 0) {
            throw new Error('tipIds must contain positive integer IDs');
        }
    }

    if (data.creationType && !allowedCreationTypes.has(data.creationType)) {
        throw new Error('Invalid creation type');
    }

    return data.tipIds.map((tipId) => Number(tipId));
}

function ensureUniqueTipIds(tipIds) {
    const uniqueTipIds = [];
    const seen = new Set();

    for (const tipId of tipIds) {
        if (seen.has(tipId)) {
            throw new Error('Duplicate tipIds are not allowed');
        }

        seen.add(tipId);
        uniqueTipIds.push(tipId);
    }

    return uniqueTipIds;
}

function validateAllTipsFound(tipIds, tips) {
    const foundIds = new Set(tips.map((tip) => Number(tip.id)));
    const missingIds = tipIds.filter((tipId) => !foundIds.has(tipId));

    if (missingIds.length > 0) {
        throw new Error(`Tip IDs not found: ${missingIds.join(', ')}`);
    }
}

function calculateTotalOdds(tips) {
    const totalOdds = tips.reduce((total, tip) => total * Number(tip.odds), 1);

    return Number(totalOdds.toFixed(4));
}

function toSlipListRow(row) {
    return {
        id: Number(row.id),
        title: row.title,
        slipDate: row.slip_date,
        totalOdds: Number(row.total_odds),
        stakeUnits: Number(row.stake_units),
        result: row.result,
        returnUnits: row.return_units === null ? null : Number(row.return_units),
        profitUnits: row.profit_units === null ? null : Number(row.profit_units),
        creationType: row.creation_type,
        publicationStatus: row.publication_status,
        publishedAt: row.published_at,
        settledAt: row.settled_at,
        legCount: Number(row.leg_count),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function shapeSlipWithLegs(rows) {
    const first = rows[0];

    return {
        id: Number(first.slip_id),
        title: first.title,
        slipDate: first.slip_date,
        totalOdds: Number(first.total_odds),
        stakeUnits: Number(first.stake_units),
        result: first.slip_result,
        returnUnits: first.return_units === null ? null : Number(first.return_units),
        profitUnits: first.profit_units === null ? null : Number(first.profit_units),
        creationType: first.slip_creation_type,
        publicationStatus: first.publication_status,
        publishedAt: first.slip_published_at,
        settledAt: first.slip_settled_at,
        createdAt: first.slip_created_at,
        updatedAt: first.slip_updated_at,
        tips: rows
            .filter((row) => row.tip_id !== null)
            .map((row) => ({
                id: Number(row.tip_id),
                legOrder: Number(row.leg_order),
                odds: Number(row.odds),
                result: row.tip_result,
                marketCode: row.market_code,
                marketName: row.market_name,
                selectionCode: row.selection_code,
                selectionName: row.selection_name,
                line: row.line === null ? null : Number(row.line),
                creationType: row.tip_creation_type,
                oddsCapturedAt: row.odds_captured_at,
                publishedAt: row.tip_published_at,
                settledAt: row.tip_settled_at,
                match: {
                    id: Number(row.match_id),
                    homeTeam: row.home_team,
                    awayTeam: row.away_team,
                    competition: row.competition,
                    startsAt: row.starts_at
                }
            }))
    };
}
