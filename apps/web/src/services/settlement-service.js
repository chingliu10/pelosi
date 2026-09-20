import pool from '../db/postgres.js';
import { findDataSourceByCode } from '../repositories/data-source-repository.js';
import { findMatchBySourceMatchId } from '../repositories/match-repository.js';
import {
    findPendingTipsByMatchId,
    updateTipResult
} from '../repositories/tip-repository.js';
import {
    findSlipIdsContainingTips,
    findSlipSettlementLegs,
    updateSlipResult
} from '../repositories/slip-repository.js';
import { getTrueOddsMatch } from '../integrations/trueodds-client.js';

const safeResultStatuses = new Set(['Ended', 'manual']);
const safeFinalResults = new Set(['H', 'D', 'A']);
const notReadyStatuses = new Set(['scheduled', 'live', 'postponed', 'cancelled']);
const manualReviewResultStatuses = new Set(['AP', 'AET', 'H1', 'Not Start']);

export async function settleMatchFromTrueOdds(sourceMatchId) {
    if (!sourceMatchId) {
        throw new Error('sourceMatchId is required');
    }

    const source = await findDataSourceByCode('trueodds');
    if (!source) {
        throw new Error('trueodds data source does not exist');
    }

    const match = await findMatchBySourceMatchId(source.id, sourceMatchId);
    if (!match) {
        const error = new Error(`Pelosi match not found for source_match_id ${sourceMatchId}`);
        error.status = 404;
        throw error;
    }

    const pendingTips = await findPendingTipsByMatchId(match.id);
    const trueOddsResponse = await getTrueOddsMatch(sourceMatchId);
    const trueOddsMatch = trueOddsResponse.match;
    const classification = classifyTrueOddsMatch(trueOddsMatch);
    const baseResult = {
        sourceMatchId: String(sourceMatchId),
        pelosiMatchId: Number(match.id),
        trueOddsMatch: summarizeTrueOddsMatch(trueOddsMatch),
        classification: classification.status,
        reason: classification.reason,
        pendingTipsFound: pendingTips.length,
        tipsChanged: 0,
        tipsSkipped: [],
        slipsUpdated: [],
        slipsRequiringManualReview: []
    };

    if (pendingTips.length === 0) {
        return baseResult;
    }

    if (classification.status === 'NOT_READY' || classification.status === 'MANUAL_REVIEW') {
        return {
            ...baseResult,
            tipsSkipped: pendingTips.map((tip) => skippedTip(tip, classification.reason))
        };
    }

    const settlementDecisions = pendingTips.map((tip) => decideTipSettlement(tip, classification));
    const changedDecisions = settlementDecisions.filter((decision) => decision.result);

    if (changedDecisions.length === 0) {
        return {
            ...baseResult,
            tipsSkipped: settlementDecisions
                .filter((decision) => !decision.result)
                .map((decision) => skippedTip(decision.tip, decision.reason))
        };
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const updatedTips = [];

        for (const decision of changedDecisions) {
            const updatedTip = await updateTipResult(decision.tip.id, decision.result, client);
            updatedTips.push(updatedTip);
        }

        const changedTipIds = updatedTips.map((tip) => Number(tip.id));
        const affectedSlipIds = await findSlipIdsContainingTips(changedTipIds, client);
        const slipRows = await findSlipSettlementLegs(affectedSlipIds, client);
        const slipSettlements = await settleEligibleSlips(slipRows, client);

        await client.query('COMMIT');

        return {
            ...baseResult,
            tipsChanged: updatedTips.length,
            tipsUpdated: updatedTips.map((tip) => ({
                id: Number(tip.id),
                result: tip.result,
                marketCode: tip.market_code,
                selectionCode: tip.selection_code,
                settledAt: tip.settled_at
            })),
            tipsSkipped: settlementDecisions
                .filter((decision) => !decision.result)
                .map((decision) => skippedTip(decision.tip, decision.reason)),
            slipsUpdated: slipSettlements.updated,
            slipsRequiringManualReview: slipSettlements.manualReview
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

function classifyTrueOddsMatch(match) {
    if (!match) {
        return { status: 'NOT_READY', reason: 'TrueOdds match detail was not returned' };
    }

    if (match.resultStatus === 'void') {
        return { status: 'VOID', reason: 'TrueOdds resultStatus void' };
    }

    if (notReadyStatuses.has(match.status)) {
        return { status: 'NOT_READY', reason: `TrueOdds status ${match.status} is not final` };
    }

    if (match.resultStatus === null || match.resultStatus === undefined) {
        return { status: 'NOT_READY', reason: 'TrueOdds resultStatus is not available yet' };
    }

    if (manualReviewResultStatuses.has(match.resultStatus)) {
        return {
            status: 'MANUAL_REVIEW',
            reason: `TrueOdds resultStatus ${match.resultStatus} is not automatically settled`
        };
    }

    if (match.status !== 'finished') {
        return { status: 'MANUAL_REVIEW', reason: `TrueOdds status ${match.status} is not safely settled` };
    }

    if (!safeResultStatuses.has(match.resultStatus)) {
        return {
            status: 'MANUAL_REVIEW',
            reason: `TrueOdds resultStatus ${match.resultStatus} is not supported for automatic settlement`
        };
    }

    if (!safeFinalResults.has(match.finalResult)) {
        return { status: 'MANUAL_REVIEW', reason: 'TrueOdds finalResult is not supported for automatic settlement' };
    }

    if (!Number.isFinite(Number(match.score?.home)) || !Number.isFinite(Number(match.score?.away))) {
        return { status: 'MANUAL_REVIEW', reason: 'TrueOdds score is incomplete' };
    }

    return {
        status: 'SAFE_FINAL',
        reason: 'TrueOdds match is safe for automatic settlement',
        homeScore: Number(match.score.home),
        awayScore: Number(match.score.away),
        finalResult: match.finalResult
    };
}

function decideTipSettlement(tip, classification) {
    if (classification.status === 'VOID') {
        return {
            tip,
            result: 'void',
            reason: classification.reason
        };
    }

    const homeScore = classification.homeScore;
    const awayScore = classification.awayScore;
    const marketCode = normalizeCode(tip.market_code);
    const selectionCode = normalizeCode(tip.selection_code);

    if (marketCode === 'MATCH_RESULT') {
        return settleMatchResult(tip, selectionCode, homeScore, awayScore);
    }

    if (marketCode === 'DOUBLE_CHANCE') {
        return settleDoubleChance(tip, selectionCode, homeScore, awayScore);
    }

    if (marketCode === 'TOTAL_GOALS') {
        return settleTotalGoals(tip, selectionCode, homeScore, awayScore);
    }

    if (marketCode === 'BTTS') {
        return settleBtts(tip, selectionCode, homeScore, awayScore);
    }

    return {
        tip,
        result: null,
        reason: `Unsupported market_code ${tip.market_code}`
    };
}

function settleMatchResult(tip, selectionCode, homeScore, awayScore) {
    const result = winnerFromScores(homeScore, awayScore);

    if (!['HOME', 'DRAW', 'AWAY'].includes(selectionCode)) {
        return { tip, result: null, reason: `Unsupported MATCH_RESULT selection_code ${tip.selection_code}` };
    }

    return {
        tip,
        result: selectionCode === result ? 'won' : 'lost',
        reason: 'MATCH_RESULT settled from full-time score'
    };
}

function settleDoubleChance(tip, selectionCode, homeScore, awayScore) {
    const result = winnerFromScores(homeScore, awayScore);
    const aliases = {
        HOME_DRAW: ['HOME', 'DRAW'],
        HOME_OR_DRAW: ['HOME', 'DRAW'],
        HOME_AWAY: ['HOME', 'AWAY'],
        HOME_OR_AWAY: ['HOME', 'AWAY'],
        DRAW_AWAY: ['DRAW', 'AWAY'],
        DRAW_OR_AWAY: ['DRAW', 'AWAY']
    };
    const coveredResults = aliases[selectionCode];

    if (!coveredResults) {
        return { tip, result: null, reason: `Unsupported DOUBLE_CHANCE selection_code ${tip.selection_code}` };
    }

    return {
        tip,
        result: coveredResults.includes(result) ? 'won' : 'lost',
        reason: 'DOUBLE_CHANCE settled from full-time score'
    };
}

function settleTotalGoals(tip, selectionCode, homeScore, awayScore) {
    const line = Number(tip.line);

    if (!Number.isFinite(line)) {
        return { tip, result: null, reason: 'TOTAL_GOALS line is missing' };
    }

    const totalGoals = homeScore + awayScore;

    if (totalGoals === line) {
        return { tip, result: null, reason: 'TOTAL_GOALS push handling is not defined' };
    }

    if (selectionCode === 'OVER') {
        return { tip, result: totalGoals > line ? 'won' : 'lost', reason: 'TOTAL_GOALS OVER settled' };
    }

    if (selectionCode === 'UNDER') {
        return { tip, result: totalGoals < line ? 'won' : 'lost', reason: 'TOTAL_GOALS UNDER settled' };
    }

    return { tip, result: null, reason: `Unsupported TOTAL_GOALS selection_code ${tip.selection_code}` };
}

function settleBtts(tip, selectionCode, homeScore, awayScore) {
    const bothTeamsScored = homeScore > 0 && awayScore > 0;

    if (selectionCode === 'YES') {
        return { tip, result: bothTeamsScored ? 'won' : 'lost', reason: 'BTTS YES settled' };
    }

    if (selectionCode === 'NO') {
        return { tip, result: bothTeamsScored ? 'lost' : 'won', reason: 'BTTS NO settled' };
    }

    return { tip, result: null, reason: `Unsupported BTTS selection_code ${tip.selection_code}` };
}

async function settleEligibleSlips(rows, client) {
    const grouped = new Map();

    for (const row of rows) {
        const slipId = Number(row.slip_id);

        if (!grouped.has(slipId)) {
            grouped.set(slipId, []);
        }

        grouped.get(slipId).push(row);
    }

    const updated = [];
    const manualReview = [];

    for (const [slipId, legs] of grouped.entries()) {
        if (legs.some((leg) => leg.tip_result === 'void')) {
            manualReview.push({
                slipId,
                reason: 'Slip contains a void leg and void-leg accumulator rules are not defined'
            });
            continue;
        }

        if (legs.some((leg) => leg.tip_result === 'lost')) {
            const slip = await updateSlipResult(
                slipId,
                {
                    result: 'lost',
                    returnUnits: 0,
                    profitUnits: -Number(legs[0].stake_units)
                },
                client
            );
            updated.push(toSlipSummary(slip));
            continue;
        }

        if (legs.every((leg) => leg.tip_result === 'won')) {
            const returnUnits = Number(legs[0].stake_units) * Number(legs[0].total_odds);
            const slip = await updateSlipResult(
                slipId,
                {
                    result: 'won',
                    returnUnits,
                    profitUnits: returnUnits - Number(legs[0].stake_units)
                },
                client
            );
            updated.push(toSlipSummary(slip));
            continue;
        }

        const slip = await updateSlipResult(
            slipId,
            {
                result: 'pending',
                returnUnits: null,
                profitUnits: null
            },
            client
        );
        updated.push(toSlipSummary(slip));
    }

    return { updated, manualReview };
}

function winnerFromScores(homeScore, awayScore) {
    if (homeScore > awayScore) return 'HOME';
    if (awayScore > homeScore) return 'AWAY';
    return 'DRAW';
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function skippedTip(tip, reason) {
    return {
        id: Number(tip.id),
        marketCode: tip.market_code,
        selectionCode: tip.selection_code,
        reason
    };
}

function summarizeTrueOddsMatch(match) {
    return {
        id: match?.id,
        trueOddsId: match?.trueOddsId,
        status: match?.status,
        score: match?.score,
        finalResult: match?.finalResult,
        resultStatus: match?.resultStatus
    };
}

function toSlipSummary(slip) {
    return {
        id: Number(slip.id),
        result: slip.result,
        returnUnits: slip.return_units === null ? null : Number(slip.return_units),
        profitUnits: slip.profit_units === null ? null : Number(slip.profit_units),
        settledAt: slip.settled_at
    };
}
