import pool from '../db/postgres.js';
import { findTipsByIds } from '../repositories/tip-repository.js';
import {
    attachTipsToSlip,
    createSlip as createSlipRecord,
    findSlipById as findSlipRecordById,
    getSlipWithLegs,
    listSlips,
    publishSlip as publishSlipRecord,
    updateSlipResult
} from '../repositories/slip-repository.js';

export async function getSlipById(slipId) {
    const rows = await getSlipWithLegs(slipId);

    if (rows.length === 0) {
        return null;
    }

    return shapeSlipWithLegs(rows);
}

export async function getSlips(filters = {}) {
    return listSlips(filters);
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

export async function publishSlip(id) {
    const slip = await publishSlipRecord(id);

    if (!slip) {
        return null;
    }

    return getSlipById(id);
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
    return findSlipRecordById(id);
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

    if (data.creationType && !['manual', 'automatic'].includes(data.creationType)) {
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
