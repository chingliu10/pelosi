import pool from '../db/postgres.js';
import { findDataSourceByCode } from '../repositories/data-source-repository.js';
import {
    countSettlementQueue,
    findMatchBySourceMatchId,
    listSettlementQueue,
    updateMatchScoreAndStatus
} from '../repositories/match-repository.js';
import {
    findPendingTipsByMatchId,
    updateTipResult
} from '../repositories/tip-repository.js';
import {
    findPendingSlipsForMatch,
    findSlipIdsContainingTips,
    findSlipSettlementLegs,
    updateSlipResult
} from '../repositories/slip-repository.js';
import { getTrueOddsMatch } from '../integrations/trueodds-client.js';
import {
    CLASSIFICATION_STATUSES,
    classifyTrueOddsMatch,
    decideTipSettlement,
    evaluateSlipSettlement
} from './settlement-rules.js';

/**
 * TrueOdds exact match details are the primary settlement source.
 * `matches.source_match_id` maps directly to this endpoint.
 */
const trueOddsSettlementEndpoint = '/api/v1/matches/:matchId';

const responseStatusByClassification = {
    [CLASSIFICATION_STATUSES.SAFE_FINAL]: 'safe_final',
    [CLASSIFICATION_STATUSES.MANUAL_REVIEW]: 'manual_review',
    [CLASSIFICATION_STATUSES.NOT_READY]: 'not_ready',
    [CLASSIFICATION_STATUSES.VOID]: 'void'
};

const allowedLocalMatchStatuses = new Set(['scheduled', 'live', 'finished', 'postponed', 'cancelled']);
const defaultQueueLimit = 50;
const maxQueueLimit = 100;
const maxSearchLength = 100;

/**
 * Settlement queue for the admin monitor: local Pelosi matches that still have
 * pending tips (and how many pending slips those tips affect).
 *
 * Deliberately local-only: the queue never calls TrueOdds, so opening the screen
 * cannot fan out one external request per match. TrueOdds is only contacted when
 * the admin explicitly checks one match.
 */
export async function getSettlementQueue(filters = {}) {
    const normalized = normalizeQueueFilters(filters);
    const rows = await listSettlementQueue(normalized);
    const total = await countSettlementQueue(normalized);

    return {
        matches: rows.map(toQueueRow),
        count: rows.length,
        total,
        limit: normalized.limit,
        offset: normalized.offset,
        localStatus: normalized.localStatus ?? null,
        search: normalized.search ?? null
    };
}

/**
 * Read-only preview of one match: fetch the exact TrueOdds v1 result, classify
 * it with the same classifier the settlement engine uses, and report what the
 * engine would do - without writing anything.
 */
export async function previewMatchSettlement(sourceMatchId, options = {}) {
    const context = await resolveSettlementContext(sourceMatchId, options);
    const { match, pendingTips, trueOddsMatch, classification } = context;
    const matchPlan = planLocalMatchSnapshot(match, classification);
    const decisions = buildSettlementDecisions(pendingTips, classification);
    const affectedSlips = await findPendingSlipsForMatch(match.id);
    const status = responseStatusByClassification[classification.status] ?? 'manual_review';
    const canAutoSettle = classification.status === CLASSIFICATION_STATUSES.SAFE_FINAL
        || classification.status === CLASSIFICATION_STATUSES.VOID;
    const notes = [];

    if (matchPlan.note) {
        notes.push(matchPlan.note);
    }

    if (classification.status === CLASSIFICATION_STATUSES.VOID) {
        notes.push(
            'Applying this void result marks the pending tips void. Slips with a void leg stay pending and are reported as needing manual void handling.'
        );
    }

    if (affectedSlips.length > 0 && classification.status === CLASSIFICATION_STATUSES.SAFE_FINAL) {
        notes.push('Affected slips are recalculated in the same transaction (lost, won, or still pending).');
    }

    return {
        sourceMatchId: context.normalizedSourceMatchId,
        pelosiMatchId: Number(match.id),
        status,
        classification: classification.status,
        canAutoSettle,
        actionLabel: classification.status === CLASSIFICATION_STATUSES.SAFE_FINAL
            ? 'Settle match'
            : (classification.status === CLASSIFICATION_STATUSES.VOID ? 'Mark tips void' : null),
        reason: classification.reason,
        trueOddsEndpoint: trueOddsSettlementEndpoint,
        trueOdds: summarizeTrueOddsMatch(trueOddsMatch),
        localMatch: {
            id: Number(match.id),
            status: match.status,
            homeScore: match.home_score === null ? null : Number(match.home_score),
            awayScore: match.away_score === null ? null : Number(match.away_score)
        },
        wouldUpdateLocalMatch: matchPlan.needed,
        pendingTipCount: pendingTips.length,
        affectedPendingSlipCount: affectedSlips.length,
        pendingTips: decisions.map((decision) => toPreviewTip(decision)),
        affectedSlips: affectedSlips.map(toAffectedSlipSummary),
        notes
    };
}

/**
 * Settle every eligible pending Pelosi tip that belongs to one TrueOdds match.
 *
 * Flow (see docs/settlement.md):
 *   validate sourceMatchId
 *   -> one TrueOdds exact-match request
 *   -> classify the result
 *   -> if no DB write is needed, return
 *   -> BEGIN, snapshot local match, update tips, recalculate slips, COMMIT
 */
export async function settleMatchFromTrueOdds(sourceMatchId, options = {}) {
    const {
        normalizedSourceMatchId,
        match,
        pendingTips,
        trueOddsMatch,
        classification
    } = await resolveSettlementContext(sourceMatchId, options);

    const notes = [];
    const matchPlan = planLocalMatchSnapshot(match, classification);
    const settlementDecisions = buildSettlementDecisions(pendingTips, classification);
    const changedDecisions = settlementDecisions.filter((decision) => decision.result);

    if (matchPlan.note) {
        notes.push(matchPlan.note);
    }

    const baseResult = {
        sourceMatchId: normalizedSourceMatchId,
        pelosiMatchId: Number(match.id),
        status: responseStatusByClassification[classification.status] ?? 'manual_review',
        classification: classification.status,
        reason: classification.reason,
        trueOddsEndpoint: trueOddsSettlementEndpoint,
        trueOddsMatch: summarizeTrueOddsMatch(trueOddsMatch),
        pendingTipsFound: pendingTips.length,
        tipsChanged: 0,
        tipsUpdated: [],
        tipsSkipped: settlementDecisions
            .filter((decision) => !decision.result)
            .map((decision) => skippedTip(decision.tip, decision.reason)),
        localMatchUpdated: false,
        localMatch: null,
        slipsUpdated: [],
        slipsRequiringManualReview: [],
        notes
    };

    if (changedDecisions.length === 0 && !matchPlan.needed) {
        return baseResult;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let updatedMatch = null;

        if (matchPlan.needed) {
            updatedMatch = await updateMatchScoreAndStatus(
                match.id,
                {
                    homeScore: matchPlan.homeScore,
                    awayScore: matchPlan.awayScore,
                    status: matchPlan.status
                },
                client
            );
        }

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
                odds: Number(tip.odds),
                settledAt: tip.settled_at
            })),
            localMatchUpdated: updatedMatch !== null,
            localMatch: updatedMatch === null ? null : toLocalMatchSummary(updatedMatch),
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

function normalizeSourceMatchId(sourceMatchId) {
    if (sourceMatchId === undefined || sourceMatchId === null) {
        throw new Error('sourceMatchId is required');
    }

    const normalized = String(sourceMatchId).trim();

    if (!normalized) {
        throw new Error('sourceMatchId is required');
    }

    return normalized;
}

/**
 * Shared setup for preview and settlement: resolve the local match, read its
 * pending tips and fetch the exact TrueOdds v1 match detail exactly once.
 *
 * `options.fetchMatch` is a test seam (defaults to the real TrueOdds client) so
 * the engine can be exercised deterministically; production callers never pass
 * it.
 */
async function resolveSettlementContext(sourceMatchId, options = {}) {
    const fetchMatch = options.fetchMatch ?? getTrueOddsMatch;
    const normalizedSourceMatchId = normalizeSourceMatchId(sourceMatchId);

    const source = await findDataSourceByCode('trueodds');
    if (!source) {
        throw new Error('trueodds data source does not exist');
    }

    const match = await findMatchBySourceMatchId(source.id, normalizedSourceMatchId);
    if (!match) {
        const error = new Error(`Pelosi match not found for source_match_id ${normalizedSourceMatchId}`);
        error.status = 404;
        throw error;
    }

    const pendingTips = await findPendingTipsByMatchId(match.id);

    // The external HTTP call always happens before any PostgreSQL transaction is
    // opened, and exactly one request is made per source match id.
    const trueOddsResponse = await fetchMatch(normalizedSourceMatchId);
    const trueOddsMatch = trueOddsResponse?.match ?? null;

    assertTrueOddsMatchIdentity(trueOddsMatch, normalizedSourceMatchId);

    return {
        normalizedSourceMatchId,
        match,
        pendingTips,
        trueOddsMatch,
        classification: classifyTrueOddsMatch(trueOddsMatch)
    };
}

/**
 * Guard against settling a Pelosi match with a TrueOdds payload that is not
 * the match we asked for. The endpoint accepts either the Sportradar event id
 * or the TrueOdds id, so both are accepted as a match.
 */
function assertTrueOddsMatchIdentity(trueOddsMatch, sourceMatchId) {
    if (!trueOddsMatch) {
        return;
    }

    const identifiers = [trueOddsMatch.trueOddsId, trueOddsMatch.id]
        .filter((value) => value !== undefined && value !== null && value !== '')
        .map(String);

    if (identifiers.length === 0) {
        const error = new Error('TrueOdds match detail did not include a match identifier');
        error.status = 502;
        throw error;
    }

    if (identifiers.includes(sourceMatchId)) {
        return;
    }

    const error = new Error(
        `TrueOdds returned a different match (${identifiers.join(', ')}) for source_match_id ${sourceMatchId}`
    );
    error.status = 502;
    throw error;
}

function buildSettlementDecisions(pendingTips, classification) {
    const canDecide = classification.status === CLASSIFICATION_STATUSES.SAFE_FINAL
        || classification.status === CLASSIFICATION_STATUSES.VOID;

    if (!canDecide) {
        return pendingTips.map((tip) => ({ tip, result: null, reason: classification.reason }));
    }

    return pendingTips.map((tip) => decideTipSettlement(tip, classification));
}

/**
 * Pelosi keeps its own historical result snapshot in `matches`, so a
 * SAFE_FINAL result is written in the same transaction as the tip updates.
 * Non-safe results never overwrite the local match with a misleading final.
 */
function planLocalMatchSnapshot(match, classification) {
    if (classification.status === CLASSIFICATION_STATUSES.VOID) {
        return {
            needed: false,
            note: 'Pelosi matches.status has no unambiguous void/abandoned value, so the local match row was left unchanged and the match needs manual void handling'
        };
    }

    if (classification.status !== CLASSIFICATION_STATUSES.SAFE_FINAL) {
        return {
            needed: false,
            note: `Local match snapshot not updated because the TrueOdds result is ${classification.status}`
        };
    }

    const needsUpdate = !sameScore(match.home_score, classification.homeScore)
        || !sameScore(match.away_score, classification.awayScore)
        || match.status !== 'finished';

    return {
        needed: needsUpdate,
        homeScore: classification.homeScore,
        awayScore: classification.awayScore,
        status: 'finished'
    };
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
        const evaluation = evaluateSlipSettlement(
            legs.map((leg) => ({ tipResult: leg.tip_result })),
            {
                stakeUnits: Number(legs[0].stake_units),
                totalOdds: Number(legs[0].total_odds)
            }
        );

        if (evaluation.outcome === 'manual_void_review') {
            manualReview.push({
                slipId,
                reason: evaluation.reason
            });
            continue;
        }

        // slip.total_odds is intentionally never touched here: it stays a
        // permanent snapshot of the odds stored on the tips.
        const slip = await updateSlipResult(
            slipId,
            {
                result: evaluation.outcome,
                returnUnits: evaluation.returnUnits,
                profitUnits: evaluation.profitUnits
            },
            client
        );

        updated.push(toSlipSummary(slip));
    }

    return { updated, manualReview };
}

function sameScore(storedValue, trueOddsValue) {
    if (storedValue === null || storedValue === undefined) {
        return false;
    }

    return Number(storedValue) === Number(trueOddsValue);
}

function normalizeQueueFilters(filters = {}) {
    const localStatus = filters.localStatus === undefined || filters.localStatus === null || filters.localStatus === ''
        ? null
        : String(filters.localStatus).trim().toLowerCase();

    if (localStatus && !allowedLocalMatchStatuses.has(localStatus)) {
        const error = new Error('Invalid localStatus. Allowed values: scheduled, live, finished, postponed, cancelled');
        error.status = 400;
        throw error;
    }

    const search = filters.search === undefined || filters.search === null || String(filters.search).trim() === ''
        ? null
        : String(filters.search).trim();

    if (search && search.length > maxSearchLength) {
        const error = new Error(`Invalid search. Maximum ${maxSearchLength} characters`);
        error.status = 400;
        throw error;
    }

    const limit = toIntegerOption(filters.limit, defaultQueueLimit, 'limit');
    const offset = toIntegerOption(filters.offset, 0, 'offset');

    if (limit <= 0 || limit > maxQueueLimit) {
        const error = new Error(`Invalid limit. Allowed range: 1-${maxQueueLimit}`);
        error.status = 400;
        throw error;
    }

    if (offset < 0) {
        const error = new Error('Invalid offset. Must be zero or greater');
        error.status = 400;
        throw error;
    }

    return { localStatus, search, limit, offset };
}

function toIntegerOption(value, fallback, name) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }

    const number = Number(value);

    if (!Number.isInteger(number)) {
        const error = new Error(`Invalid ${name}. Must be an integer`);
        error.status = 400;
        throw error;
    }

    return number;
}

function toQueueRow(row) {
    return {
        matchId: Number(row.match_id),
        sourceMatchId: row.source_match_id,
        homeTeam: row.home_team,
        awayTeam: row.away_team,
        competition: row.competition,
        startsAt: row.starts_at,
        localStatus: row.local_status,
        homeScore: row.home_score === null ? null : Number(row.home_score),
        awayScore: row.away_score === null ? null : Number(row.away_score),
        pendingTipCount: Number(row.pending_tip_count),
        affectedPendingSlipCount: Number(row.affected_pending_slip_count)
    };
}

/**
 * Per-tip preview built from the same decision function the engine uses, so the
 * UI can never disagree with what settlement would do.
 */
function toPreviewTip(decision) {
    const tip = decision.tip;

    return {
        id: Number(tip.id),
        marketCode: tip.market_code,
        marketName: tip.market_name,
        selectionCode: tip.selection_code,
        selectionName: tip.selection_name,
        line: tip.line === null || tip.line === undefined ? null : Number(tip.line),
        odds: Number(tip.odds),
        result: tip.result,
        willAutoSettle: Boolean(decision.result),
        predictedResult: decision.result,
        reason: decision.reason
    };
}

function toAffectedSlipSummary(slip) {
    return {
        id: Number(slip.id),
        title: slip.title,
        result: slip.result,
        publicationStatus: slip.publication_status,
        totalOdds: Number(slip.total_odds),
        stakeUnits: Number(slip.stake_units),
        legCount: Number(slip.leg_count)
    };
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

function toLocalMatchSummary(match) {
    return {
        id: Number(match.id),
        status: match.status,
        homeScore: match.home_score === null ? null : Number(match.home_score),
        awayScore: match.away_score === null ? null : Number(match.away_score)
    };
}

function toSlipSummary(slip) {
    return {
        id: Number(slip.id),
        result: slip.result,
        totalOdds: slip.total_odds === null ? null : Number(slip.total_odds),
        stakeUnits: slip.stake_units === null ? null : Number(slip.stake_units),
        returnUnits: slip.return_units === null ? null : Number(slip.return_units),
        profitUnits: slip.profit_units === null ? null : Number(slip.profit_units),
        settledAt: slip.settled_at
    };
}
