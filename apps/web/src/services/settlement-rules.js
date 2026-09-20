/**
 * Pure settlement rules for Pelosi.
 *
 * This module contains NO database access and NO network access, so the
 * automatic settlement contract can be unit tested deterministically.
 *
 * Automatic settlement contract (see docs/settlement.md):
 *
 *   SAFE_FINAL when
 *     TrueOdds status is finished
 *     AND resultStatus is "Ended" or "manual"
 *     AND finalResult is one of H / D / A
 *     AND score.home and score.away are present numbers
 *
 *   MANUAL_REVIEW for AP / AET / H1 / Not Start / unknown result statuses,
 *   unknown final results and incomplete scores.
 *
 *   NOT_READY while the match has no final result yet.
 *
 *   VOID when TrueOdds reports the event as void.
 *
 * Unknown or unsupported markets, selection codes and push (equal line)
 * situations are never treated as lost. They are left pending for manual
 * review.
 */

const safeFinalResultStatuses = new Set(['ended', 'manual']);
const manualReviewResultStatuses = new Set(['ap', 'aet', 'h1', 'not start', 'not started']);
const notReadyMatchStatuses = new Set(['scheduled', 'not start', 'not started', 'live', 'postponed', 'cancelled']);
const finishedMatchStatuses = new Set(['finished', 'ended', 'closed', 'complete', 'completed']);
const safeFinalResults = new Set(['H', 'D', 'A']);

export const SUPPORTED_MARKET_CODES = Object.freeze([
    'MATCH_RESULT',
    '1X2',
    'DOUBLE_CHANCE',
    'TOTAL_GOALS',
    'BTTS',
    'BOTH_TEAMS_TO_SCORE',
    'GG_NG'
]);

export const CLASSIFICATION_STATUSES = Object.freeze({
    SAFE_FINAL: 'SAFE_FINAL',
    MANUAL_REVIEW: 'MANUAL_REVIEW',
    NOT_READY: 'NOT_READY',
    VOID: 'VOID'
});

const matchResultSelections = new Set(['HOME', 'DRAW', 'AWAY']);

const doubleChanceSelections = new Map([
    ['HOME_DRAW', ['HOME', 'DRAW']],
    ['HOME_OR_DRAW', ['HOME', 'DRAW']],
    ['DRAW_HOME', ['HOME', 'DRAW']],
    ['HOME_AWAY', ['HOME', 'AWAY']],
    ['HOME_OR_AWAY', ['HOME', 'AWAY']],
    ['AWAY_HOME', ['HOME', 'AWAY']],
    ['DRAW_AWAY', ['DRAW', 'AWAY']],
    ['DRAW_OR_AWAY', ['DRAW', 'AWAY']],
    ['AWAY_DRAW', ['DRAW', 'AWAY']],
    ['1X', ['HOME', 'DRAW']],
    ['12', ['HOME', 'AWAY']],
    ['X2', ['DRAW', 'AWAY']]
]);

/**
 * Classify an exact TrueOdds match-detail payload.
 *
 * @param {object|null} match TrueOdds `match` object from GET /api/v1/matches/:matchId
 * @returns {{status: string, reason: string, homeScore?: number, awayScore?: number, finalResult?: string}}
 */
export function classifyTrueOddsMatch(match) {
    if (!match) {
        return {
            status: CLASSIFICATION_STATUSES.NOT_READY,
            reason: 'TrueOdds match detail was not returned'
        };
    }

    const matchStatus = toNormalizedText(match.status);
    const resultStatus = toNormalizedText(match.resultStatus);
    const rawResultStatus = match.resultStatus === null || match.resultStatus === undefined
        ? 'null'
        : String(match.resultStatus);

    if (resultStatus === 'void' || matchStatus === 'void') {
        return {
            status: CLASSIFICATION_STATUSES.VOID,
            reason: 'TrueOdds resultStatus void'
        };
    }

    if (notReadyMatchStatuses.has(matchStatus)) {
        return {
            status: CLASSIFICATION_STATUSES.NOT_READY,
            reason: `TrueOdds status ${match.status} is not final`
        };
    }

    if (!resultStatus) {
        return {
            status: CLASSIFICATION_STATUSES.NOT_READY,
            reason: 'TrueOdds resultStatus is not available yet'
        };
    }

    if (manualReviewResultStatuses.has(resultStatus)) {
        return {
            status: CLASSIFICATION_STATUSES.MANUAL_REVIEW,
            reason: `TrueOdds resultStatus ${rawResultStatus} is not automatically settled`
        };
    }

    if (!finishedMatchStatuses.has(matchStatus)) {
        return {
            status: CLASSIFICATION_STATUSES.MANUAL_REVIEW,
            reason: `TrueOdds status ${match.status} is not safely settled`
        };
    }

    if (!safeFinalResultStatuses.has(resultStatus)) {
        return {
            status: CLASSIFICATION_STATUSES.MANUAL_REVIEW,
            reason: `TrueOdds resultStatus ${rawResultStatus} is not supported for automatic settlement`
        };
    }

    if (!safeFinalResults.has(match.finalResult)) {
        return {
            status: CLASSIFICATION_STATUSES.MANUAL_REVIEW,
            reason: 'TrueOdds finalResult is not supported for automatic settlement'
        };
    }

    const homeScore = toFiniteNumber(match.score?.home);
    const awayScore = toFiniteNumber(match.score?.away);

    if (homeScore === null || awayScore === null) {
        return {
            status: CLASSIFICATION_STATUSES.MANUAL_REVIEW,
            reason: 'TrueOdds score is incomplete'
        };
    }

    return {
        status: CLASSIFICATION_STATUSES.SAFE_FINAL,
        reason: 'TrueOdds match is safe for automatic settlement',
        homeScore,
        awayScore,
        finalResult: match.finalResult
    };
}

/**
 * Decide the settlement result for a single pending Pelosi tip.
 *
 * @param {object} tip Pelosi tip row (market_code, selection_code, line)
 * @param {object} classification Output of classifyTrueOddsMatch
 * @returns {{tip: object, result: 'won'|'lost'|'void'|null, reason: string}}
 */
export function decideTipSettlement(tip, classification) {
    if (classification.status === CLASSIFICATION_STATUSES.VOID) {
        return { tip, result: 'void', reason: classification.reason };
    }

    if (classification.status !== CLASSIFICATION_STATUSES.SAFE_FINAL) {
        return { tip, result: null, reason: classification.reason };
    }

    const homeScore = classification.homeScore;
    const awayScore = classification.awayScore;
    const marketCode = normalizeCode(tip.market_code);
    const selectionCode = normalizeCode(tip.selection_code);

    if (marketCode === 'MATCH_RESULT' || marketCode === '1X2') {
        return settleMatchResult(tip, selectionCode, homeScore, awayScore);
    }

    if (marketCode === 'DOUBLE_CHANCE') {
        return settleDoubleChance(tip, selectionCode, homeScore, awayScore);
    }

    if (marketCode === 'TOTAL_GOALS') {
        return settleTotalGoals(tip, selectionCode, homeScore, awayScore);
    }

    if (marketCode === 'BTTS' || marketCode === 'BOTH_TEAMS_TO_SCORE' || marketCode === 'GG_NG') {
        return settleBtts(tip, selectionCode, homeScore, awayScore);
    }

    return {
        tip,
        result: null,
        reason: `Unsupported market_code ${tip.market_code} is not automatically settled`
    };
}

/**
 * Determine an accumulator slip outcome from its fully evaluated legs.
 *
 * Void-leg accumulator rules are intentionally NOT invented here: a slip with
 * any void leg is reported for manual void handling instead of being silently
 * recalculated.
 *
 * @param {Array<{tipResult: string}>} legs
 * @param {{stakeUnits: number, totalOdds: number}} slip
 * @returns {{outcome: 'won'|'lost'|'pending'|'manual_void_review', returnUnits: number|null, profitUnits: number|null, reason: string}}
 */
export function evaluateSlipSettlement(legs, { stakeUnits, totalOdds }) {
    const results = legs.map((leg) => String(leg.tipResult || '').toLowerCase());

    if (results.length === 0) {
        return {
            outcome: 'pending',
            returnUnits: null,
            profitUnits: null,
            reason: 'Slip has no legs'
        };
    }

    if (results.includes('void')) {
        return {
            outcome: 'manual_void_review',
            returnUnits: null,
            profitUnits: null,
            reason: 'Slip contains a void leg and void-leg accumulator rules are not defined'
        };
    }

    if (results.includes('lost')) {
        return {
            outcome: 'lost',
            returnUnits: 0,
            profitUnits: -Number(stakeUnits),
            reason: 'Slip lost because at least one leg was lost'
        };
    }

    if (results.every((result) => result === 'won')) {
        const returnUnits = Number(stakeUnits) * Number(totalOdds);

        return {
            outcome: 'won',
            returnUnits,
            profitUnits: returnUnits - Number(stakeUnits),
            reason: 'Slip won because every leg won'
        };
    }

    return {
        outcome: 'pending',
        returnUnits: null,
        profitUnits: null,
        reason: 'Slip still has pending legs'
    };
}

export function winnerFromScores(homeScore, awayScore) {
    if (homeScore > awayScore) return 'HOME';
    if (awayScore > homeScore) return 'AWAY';
    return 'DRAW';
}

export function normalizeCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

function settleMatchResult(tip, selectionCode, homeScore, awayScore) {
    if (!matchResultSelections.has(selectionCode)) {
        return {
            tip,
            result: null,
            reason: `Unsupported MATCH_RESULT selection_code ${tip.selection_code}`
        };
    }

    const outcome = winnerFromScores(homeScore, awayScore);

    return {
        tip,
        result: selectionCode === outcome ? 'won' : 'lost',
        reason: 'MATCH_RESULT settled from full-time score'
    };
}

function settleDoubleChance(tip, selectionCode, homeScore, awayScore) {
    const coveredOutcomes = doubleChanceSelections.get(selectionCode);

    if (!coveredOutcomes) {
        return {
            tip,
            result: null,
            reason: `Unsupported DOUBLE_CHANCE selection_code ${tip.selection_code}`
        };
    }

    const outcome = winnerFromScores(homeScore, awayScore);

    return {
        tip,
        result: coveredOutcomes.includes(outcome) ? 'won' : 'lost',
        reason: 'DOUBLE_CHANCE settled from full-time score'
    };
}

function settleTotalGoals(tip, selectionCode, homeScore, awayScore) {
    const line = toFiniteNumber(tip.line);

    if (line === null) {
        return { tip, result: null, reason: 'TOTAL_GOALS line is missing' };
    }

    if (selectionCode !== 'OVER' && selectionCode !== 'UNDER') {
        return {
            tip,
            result: null,
            reason: `Unsupported TOTAL_GOALS selection_code ${tip.selection_code}`
        };
    }

    const totalGoals = homeScore + awayScore;

    if (totalGoals === line) {
        return {
            tip,
            result: null,
            reason: 'TOTAL_GOALS push handling is not defined'
        };
    }

    if (selectionCode === 'OVER') {
        return { tip, result: totalGoals > line ? 'won' : 'lost', reason: 'TOTAL_GOALS OVER settled' };
    }

    return { tip, result: totalGoals < line ? 'won' : 'lost', reason: 'TOTAL_GOALS UNDER settled' };
}

function settleBtts(tip, selectionCode, homeScore, awayScore) {
    if (selectionCode !== 'YES' && selectionCode !== 'NO') {
        return {
            tip,
            result: null,
            reason: `Unsupported BTTS selection_code ${tip.selection_code}`
        };
    }

    const bothTeamsScored = homeScore > 0 && awayScore > 0;

    if (selectionCode === 'YES') {
        return {
            tip,
            result: bothTeamsScored ? 'won' : 'lost',
            reason: 'BTTS YES settled from full-time score'
        };
    }

    return {
        tip,
        result: bothTeamsScored ? 'lost' : 'won',
        reason: 'BTTS NO settled from full-time score'
    };
}

function toNormalizedText(value) {
    return String(value ?? '').trim().toLowerCase();
}
