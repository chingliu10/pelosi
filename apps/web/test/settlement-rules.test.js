import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CLASSIFICATION_STATUSES,
    classifyTrueOddsMatch,
    decideTipSettlement,
    evaluateSlipSettlement,
    winnerFromScores
} from '../src/services/settlement-rules.js';

/**
 * Real TrueOdds payload for Pelosi match 3 (source_match_id 5630529,
 * Brentford vs Chelsea) as returned by GET /api/v1/matches/5630529.
 *
 * Verified on the deployed API: the match went to penalties, TrueOdds
 * exposes the pre-penalty score (0-0) with resultStatus AP. Pelosi Tip 3 is
 * MATCH_RESULT / AWAY and must stay pending.
 */
const brentfordChelseaAfterPenalties = {
    id: 'sr:match:72221274',
    trueOddsId: '5630529',
    status: 'finished',
    providerStatus: 'Ended',
    score: { home: 0, away: 0 },
    finalResult: 'D',
    resultStatus: 'AP'
};

function safeFinalMatch(overrides = {}) {
    return {
        id: 'sr:match:70000000',
        trueOddsId: '6000000',
        status: 'finished',
        providerStatus: 'Ended',
        score: { home: 2, away: 1 },
        finalResult: 'H',
        resultStatus: 'Ended',
        ...overrides
    };
}

function tip(overrides = {}) {
    return {
        id: 1,
        market_code: 'MATCH_RESULT',
        selection_code: 'HOME',
        line: null,
        odds: '1.7500',
        ...overrides
    };
}

test('classify: finished Ended match with valid score is SAFE_FINAL', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch());

    assert.equal(classification.status, CLASSIFICATION_STATUSES.SAFE_FINAL);
    assert.equal(classification.homeScore, 2);
    assert.equal(classification.awayScore, 1);
});

test('classify: manually entered final result is SAFE_FINAL', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch({
        resultStatus: 'manual',
        score: { home: 0, away: 3 },
        finalResult: 'A'
    }));

    assert.equal(classification.status, CLASSIFICATION_STATUSES.SAFE_FINAL);
});

test('classify: AP (after penalties) is MANUAL_REVIEW', () => {
    const classification = classifyTrueOddsMatch(brentfordChelseaAfterPenalties);

    assert.equal(classification.status, CLASSIFICATION_STATUSES.MANUAL_REVIEW);
    assert.match(classification.reason, /AP/);
});

test('classify: AET is MANUAL_REVIEW', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch({ resultStatus: 'AET' }));

    assert.equal(classification.status, CLASSIFICATION_STATUSES.MANUAL_REVIEW);
});

test('classify: H1 anomaly is MANUAL_REVIEW', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch({ resultStatus: 'H1' }));

    assert.equal(classification.status, CLASSIFICATION_STATUSES.MANUAL_REVIEW);
});

test('classify: Not Start result status is MANUAL_REVIEW', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch({
        resultStatus: 'Not Start',
        score: { home: null, away: null },
        finalResult: null
    }));

    assert.equal(classification.status, CLASSIFICATION_STATUSES.MANUAL_REVIEW);
});

test('classify: void result status is VOID', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch({
        status: 'cancelled',
        resultStatus: 'void',
        score: { home: null, away: null },
        finalResult: null
    }));

    assert.equal(classification.status, CLASSIFICATION_STATUSES.VOID);
});

test('classify: unfinished match is NOT_READY', () => {
    const scheduled = classifyTrueOddsMatch(safeFinalMatch({
        status: 'scheduled',
        resultStatus: null,
        score: { home: null, away: null },
        finalResult: null
    }));
    const finishedWithoutResult = classifyTrueOddsMatch(safeFinalMatch({ resultStatus: null }));

    assert.equal(scheduled.status, CLASSIFICATION_STATUSES.NOT_READY);
    assert.equal(finishedWithoutResult.status, CLASSIFICATION_STATUSES.NOT_READY);
});

test('classify: finished match without a complete score is MANUAL_REVIEW', () => {
    const nullHomeScore = classifyTrueOddsMatch(safeFinalMatch({ score: { home: null, away: 1 } }));
    const missingScoreObject = classifyTrueOddsMatch(safeFinalMatch({ score: undefined }));
    const zeroZero = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 0, away: 0 }, finalResult: 'D' }));

    assert.equal(nullHomeScore.status, CLASSIFICATION_STATUSES.MANUAL_REVIEW);
    assert.equal(missingScoreObject.status, CLASSIFICATION_STATUSES.MANUAL_REVIEW);
    assert.equal(zeroZero.status, CLASSIFICATION_STATUSES.SAFE_FINAL);
    assert.equal(zeroZero.homeScore, 0);
});

test('classify: finished match without a supported finalResult is MANUAL_REVIEW', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch({ finalResult: null }));

    assert.equal(classification.status, CLASSIFICATION_STATUSES.MANUAL_REVIEW);
});

test('MATCH_RESULT settles home, draw and away from the full-time score', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch());
    const draw = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 1, away: 1 }, finalResult: 'D' }));
    const away = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 0, away: 2 }, finalResult: 'A' }));

    assert.equal(decideTipSettlement(tip({ selection_code: 'HOME' }), classification).result, 'won');
    assert.equal(decideTipSettlement(tip({ selection_code: 'AWAY' }), classification).result, 'lost');
    assert.equal(decideTipSettlement(tip({ selection_code: 'AWAY' }), away).result, 'won');
    assert.equal(decideTipSettlement(tip({ selection_code: 'DRAW' }), draw).result, 'won');
    assert.equal(decideTipSettlement(tip({ selection_code: 'HOME' }), draw).result, 'lost');
});

test('MATCH_RESULT with an unknown selection code is never lost', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch());
    const decision = decideTipSettlement(tip({ selection_code: 'UNKNOWN' }), classification);

    assert.equal(decision.result, null);
});

test('AP match never settles the Brentford vs Chelsea AWAY tip', () => {
    const classification = classifyTrueOddsMatch(brentfordChelseaAfterPenalties);
    const decisions = [
        decideTipSettlement(tip({ id: 3, selection_code: 'AWAY' }), classification),
        decideTipSettlement(tip({ id: 4, selection_code: 'DRAW' }), classification)
    ];

    for (const decision of decisions) {
        assert.equal(decision.result, null);
        assert.match(decision.reason, /AP/);
    }
});

test('DOUBLE_CHANCE settles both-way selections', () => {
    const homeWin = classifyTrueOddsMatch(safeFinalMatch());
    const draw = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 1, away: 1 }, finalResult: 'D' }));
    const awayWin = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 0, away: 2 }, finalResult: 'A' }));

    const doubleChance = (selectionCode, classification) => decideTipSettlement(
        tip({ market_code: 'DOUBLE_CHANCE', selection_code: selectionCode }),
        classification
    ).result;

    assert.equal(doubleChance('HOME_OR_DRAW', homeWin), 'won');
    assert.equal(doubleChance('HOME_OR_DRAW', draw), 'won');
    assert.equal(doubleChance('HOME_OR_DRAW', awayWin), 'lost');
    assert.equal(doubleChance('HOME_OR_AWAY', awayWin), 'won');
    assert.equal(doubleChance('HOME_OR_AWAY', draw), 'lost');
    assert.equal(doubleChance('DRAW_OR_AWAY', draw), 'won');
    assert.equal(doubleChance('DRAW_AWAY', awayWin), 'won');
    assert.equal(doubleChance('1X', homeWin), 'won');
    assert.equal(doubleChance('UNKNOWN', homeWin), null);
});

test('TOTAL_GOALS settles over and under, and pushes stay manual review', () => {
    const twoOne = classifyTrueOddsMatch(safeFinalMatch());
    const totalGoalsTip = (selectionCode, line) => tip({
        market_code: 'TOTAL_GOALS',
        selection_code: selectionCode,
        line
    });

    assert.equal(decideTipSettlement(totalGoalsTip('OVER', '2.5'), twoOne).result, 'won');
    assert.equal(decideTipSettlement(totalGoalsTip('UNDER', '2.5'), twoOne).result, 'lost');
    assert.equal(decideTipSettlement(totalGoalsTip('UNDER', '3.5'), twoOne).result, 'won');
    assert.equal(decideTipSettlement(totalGoalsTip('OVER', '3.5'), twoOne).result, 'lost');
    assert.equal(decideTipSettlement(totalGoalsTip('OVER', '3'), twoOne).result, null);
    assert.equal(decideTipSettlement(totalGoalsTip('UNDER', '3'), twoOne).result, null);
    assert.equal(decideTipSettlement(totalGoalsTip('OVER', null), twoOne).result, null);
    assert.equal(decideTipSettlement(totalGoalsTip('UNKNOWN', '2.5'), twoOne).result, null);
});

test('BTTS settles yes and no using both stored market codes', () => {
    const bothScored = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 1, away: 1 }, finalResult: 'D' }));
    const oneSided = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 2, away: 0 } }));
    const goalless = classifyTrueOddsMatch(safeFinalMatch({ score: { home: 0, away: 0 }, finalResult: 'D' }));

    for (const marketCode of ['BTTS', 'BOTH_TEAMS_TO_SCORE', 'GG_NG']) {
        const btts = (selectionCode, classification) => decideTipSettlement(
            tip({ market_code: marketCode, selection_code: selectionCode }),
            classification
        ).result;

        assert.equal(btts('YES', bothScored), 'won');
        assert.equal(btts('YES', oneSided), 'lost');
        assert.equal(btts('NO', goalless), 'won');
        assert.equal(btts('NO', bothScored), 'lost');
    }
});

test('unsupported markets are reported, never lost', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch());

    for (const marketCode of ['HANDICAP', 'CORNERS', 'CARDS', 'PLAYER_SHOTS', 'UNKNOWN']) {
        const decision = decideTipSettlement(
            tip({ market_code: marketCode, selection_code: 'HOME' }),
            classification
        );

        assert.equal(decision.result, null);
        assert.match(decision.reason, /Unsupported market_code/);
    }
});

test('void matches mark tips void', () => {
    const classification = classifyTrueOddsMatch(safeFinalMatch({
        status: 'cancelled',
        resultStatus: 'void',
        score: { home: null, away: null },
        finalResult: null
    }));
    const decision = decideTipSettlement(tip(), classification);

    assert.equal(decision.result, 'void');
});

test('non-settleable classifications never produce a tip result', () => {
    const manualReview = classifyTrueOddsMatch(brentfordChelseaAfterPenalties);
    const notReady = classifyTrueOddsMatch(safeFinalMatch({ status: 'scheduled', resultStatus: null }));

    assert.equal(decideTipSettlement(tip(), manualReview).result, null);
    assert.equal(decideTipSettlement(tip(), notReady).result, null);
});

test('winnerFromScores reports home, away and draw', () => {
    assert.equal(winnerFromScores(2, 1), 'HOME');
    assert.equal(winnerFromScores(1, 3), 'AWAY');
    assert.equal(winnerFromScores(0, 0), 'DRAW');
});

test('slip with every leg won pays stake times total odds', () => {
    const evaluation = evaluateSlipSettlement(
        [{ tipResult: 'won' }, { tipResult: 'won' }],
        { stakeUnits: 1, totalOdds: 4.8655 }
    );

    assert.equal(evaluation.outcome, 'won');
    assert.equal(evaluation.returnUnits, 4.8655);
    assert.equal(evaluation.profitUnits, 3.8655);
});

test('slip with any lost leg loses the stake', () => {
    const evaluation = evaluateSlipSettlement(
        [{ tipResult: 'won' }, { tipResult: 'lost' }, { tipResult: 'won' }],
        { stakeUnits: 2, totalOdds: 6 }
    );

    assert.equal(evaluation.outcome, 'lost');
    assert.equal(evaluation.returnUnits, 0);
    assert.equal(evaluation.profitUnits, -2);
});

test('slip with pending legs stays pending without payout fields', () => {
    const evaluation = evaluateSlipSettlement(
        [{ tipResult: 'won' }, { tipResult: 'pending' }],
        { stakeUnits: 1, totalOdds: 3 }
    );

    assert.equal(evaluation.outcome, 'pending');
    assert.equal(evaluation.returnUnits, null);
    assert.equal(evaluation.profitUnits, null);
});

test('slip with a void leg requires manual void handling', () => {
    const evaluation = evaluateSlipSettlement(
        [{ tipResult: 'won' }, { tipResult: 'void' }, { tipResult: 'won' }],
        { stakeUnits: 1, totalOdds: 5 }
    );

    assert.equal(evaluation.outcome, 'manual_void_review');
    assert.equal(evaluation.returnUnits, null);
    assert.equal(evaluation.profitUnits, null);
});
