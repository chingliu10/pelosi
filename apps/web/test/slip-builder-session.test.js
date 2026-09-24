import test from 'node:test';
import assert from 'node:assert/strict';

import pool from '../src/db/postgres.js';
import {
    addBuilderSelection,
    builderTtlMs,
    clearBuilder,
    getBuilder,
    removeBuilderSelection,
    saveBuilderSlip,
    slipTypeForCount
} from '../src/services/slip-builder-service.js';

const runId = Date.now();
const createdSlipIds = [];
const sourceOddsPrefix = `builder-test-odds-${runId}`;
const matchPrefix = `builder-test-match-${runId}`;
const teamPrefix = `builder-test-team-${runId}`;
const competitionId = `builder-test-competition-${runId}`;

function req(session = {}) {
    return { session };
}

function resolved({ matchId, sourceOddsId }, oddsBySource = {}) {
    const suffix = String(matchId).replace(`${matchPrefix}-`, '');
    const odds = oddsBySource[sourceOddsId] ?? (sourceOddsId.endsWith('-b') ? 1.8 : 1.72);

    return {
        match: {
            sourceMatchId: matchId,
            eventId: `${matchId}-event`,
            sportName: 'football',
            startsAt: '2031-08-01T16:00:00.000Z',
            country: 'Testland',
            sourceCompetitionId: competitionId,
            competitionName: `Builder Test League ${runId}`,
            homeTeamId: `${teamPrefix}-${suffix}-home`,
            homeTeamName: `Builder ${suffix} Home`,
            awayTeamId: `${teamPrefix}-${suffix}-away`,
            awayTeamName: `Builder ${suffix} Away`,
            status: 'scheduled',
            homeScore: null,
            awayScore: null
        },
        market: {
            sourceMarketId: `market-${suffix}`,
            code: 'MATCH_RESULT',
            name: 'Match Result',
            line: null
        },
        selection: {
            sourceOddsId,
            sourceSelectionId: `selection-${suffix}`,
            code: 'HOME',
            name: `Builder ${suffix} Home`,
            odds,
            oddsCapturedAt: null
        }
    };
}

function resolver(oddsBySource = {}) {
    const calls = [];
    const fn = async (input) => {
        calls.push({ ...input });

        return resolved(input, oddsBySource);
    };

    fn.calls = calls;

    return fn;
}

test.after(async () => {
    if (createdSlipIds.length > 0) {
        await pool.query('DELETE FROM slips WHERE id = ANY($1::bigint[])', [createdSlipIds]);
    }

    await pool.query('DELETE FROM tips WHERE source_odds_id LIKE $1', [`${sourceOddsPrefix}%`]);
    await pool.query('DELETE FROM matches WHERE source_match_id LIKE $1', [`${matchPrefix}%`]);
    await pool.query('DELETE FROM competitions WHERE source_competition_id = $1', [competitionId]);
    await pool.query('DELETE FROM teams WHERE source_team_id LIKE $1', [`${teamPrefix}%`]);
    await pool.end();
});

test('builder starts empty, persists in session and expires independently', async () => {
    const session = {};
    const request = req(session);
    const addResolver = resolver();
    const now = new Date('2031-08-01T10:00:00.000Z');

    assert.equal(getBuilder(request, now).selectionCount, 0);

    const added = await addBuilderSelection(
        request,
        { matchId: `${matchPrefix}-a`, sourceOddsId: `${sourceOddsPrefix}-a` },
        { resolveSelection: addResolver, now }
    );

    assert.equal(added.selectionCount, 1);
    assert.equal(getBuilder(req(session), new Date('2031-08-01T12:00:00.000Z')).selectionCount, 1);
    assert.equal(getBuilder(req({}), new Date('2031-08-01T12:00:00.000Z')).selectionCount, 0);

    const expired = getBuilder(req(session), new Date(now.getTime() + builderTtlMs + 1000));

    assert.equal(expired.selectionCount, 0);
});

test('add is idempotent, same-match is rejected, remove and clear preserve session rules', async () => {
    const request = req({});
    const addResolver = resolver();

    await addBuilderSelection(request, { matchId: `${matchPrefix}-a`, sourceOddsId: `${sourceOddsPrefix}-a` }, { resolveSelection: addResolver });
    const duplicate = await addBuilderSelection(request, { matchId: `${matchPrefix}-a`, sourceOddsId: `${sourceOddsPrefix}-a` }, { resolveSelection: addResolver });

    assert.equal(duplicate.selectionCount, 1);

    await assert.rejects(
        () => addBuilderSelection(request, { matchId: `${matchPrefix}-a`, sourceOddsId: `${sourceOddsPrefix}-a2` }, { resolveSelection: addResolver }),
        /multiple selections from the same match/
    );

    const second = await addBuilderSelection(request, { matchId: `${matchPrefix}-b`, sourceOddsId: `${sourceOddsPrefix}-b` }, { resolveSelection: addResolver });

    assert.equal(second.selectionCount, 2);
    assert.equal(second.slipType, 'Double');
    assert.equal(second.previewTotalOdds, Number((1.72 * 1.8).toFixed(4)));

    const removed = removeBuilderSelection(request, `${sourceOddsPrefix}-a`);

    assert.equal(removed.selectionCount, 1);
    assert.equal(removed.selections[0].sourceOddsId, `${sourceOddsPrefix}-b`);
    assert.equal(clearBuilder(request).selectionCount, 0);
});

test('slip type labels are count based', () => {
    assert.equal(slipTypeForCount(1), 'Single');
    assert.equal(slipTypeForCount(2), 'Double');
    assert.equal(slipTypeForCount(3), 'Treble');
    assert.equal(slipTypeForCount(4), '4-Fold Accumulator');
    assert.equal(slipTypeForCount(5), '5-Fold Accumulator');
    assert.equal(slipTypeForCount(10), '10-Fold Accumulator');
});

test('saving one selection creates a Single draft and clears the builder', async () => {
    const request = req({});
    const saveResolver = resolver({ [`${sourceOddsPrefix}-single`]: 1.91 });

    await addBuilderSelection(request, { matchId: `${matchPrefix}-single`, sourceOddsId: `${sourceOddsPrefix}-single` }, { resolveSelection: saveResolver });

    const saved = await saveBuilderSlip(
        request,
        {
            title: 'Injected title',
            totalOdds: 999,
            stakeUnits: 50,
            result: 'won',
            publicationStatus: 'published'
        },
        { resolveSelection: saveResolver }
    );

    createdSlipIds.push(saved.slip.id);
    assert.equal(saved.slip.slipType, 'Single');
    assert.equal(saved.slip.legCount, 1);
    assert.equal(saved.slip.result, 'pending');
    assert.equal(saved.slip.publicationStatus, 'draft');
    assert.equal(Number(saved.slip.stakeUnits), 1);
    assert.equal(saved.slip.totalOdds, 1.91);
    assert.equal(saved.slip.tips[0].odds, 1.91);
    assert.deepEqual(saved.createdTipIds, [saved.slip.tips[0].id]);
    assert.deepEqual(saved.reusedTipIds, []);
    assert.equal(getBuilder(request).selectionCount, 0);
});

test('builder slipDate uses APP_TIMEZONE for future saved slips', async () => {
    const previousTimezone = process.env.APP_TIMEZONE;
    const request = req({});
    const saveResolver = resolver({ [`${sourceOddsPrefix}-timezone`]: 1.93 });

    process.env.APP_TIMEZONE = 'Asia/Riyadh';

    try {
        await addBuilderSelection(
            request,
            { matchId: `${matchPrefix}-timezone`, sourceOddsId: `${sourceOddsPrefix}-timezone` },
            { resolveSelection: saveResolver, now: new Date('2031-08-01T20:00:00.000Z') }
        );

        const saved = await saveBuilderSlip(
            request,
            {},
            { resolveSelection: saveResolver, now: new Date('2031-08-01T22:30:00.000Z') }
        );

        createdSlipIds.push(saved.slip.id);
        const stored = await pool.query('SELECT slip_date::text AS slip_date FROM slips WHERE id = $1', [saved.slip.id]);

        assert.equal(stored.rows[0].slip_date, '2031-08-02');
    } finally {
        if (previousTimezone === undefined) delete process.env.APP_TIMEZONE;
        else process.env.APP_TIMEZONE = previousTimezone;
    }
});

test('saving two distinct matches creates a Double with builder order and save-time odds', async () => {
    const request = req({});
    const addResolver = resolver({ [`${sourceOddsPrefix}-c`]: 1.72, [`${sourceOddsPrefix}-d`]: 1.8 });
    const saveResolver = resolver({ [`${sourceOddsPrefix}-c`]: 1.65, [`${sourceOddsPrefix}-d`]: 1.9 });

    await addBuilderSelection(request, { matchId: `${matchPrefix}-c`, sourceOddsId: `${sourceOddsPrefix}-c` }, { resolveSelection: addResolver });
    await addBuilderSelection(request, { matchId: `${matchPrefix}-d`, sourceOddsId: `${sourceOddsPrefix}-d` }, { resolveSelection: addResolver });

    const saved = await saveBuilderSlip(request, { title: 'Daily Double' }, { resolveSelection: saveResolver });

    createdSlipIds.push(saved.slip.id);
    assert.equal(saved.slip.slipType, 'Double');
    assert.equal(saved.slip.legCount, 2);
    assert.deepEqual(saved.slip.tips.map((tip) => tip.legOrder), [1, 2]);
    assert.deepEqual(saved.slip.tips.map((tip) => tip.odds), [1.65, 1.9]);
    assert.equal(saved.slip.totalOdds, Number((1.65 * 1.9).toFixed(4)));
    assert.equal(saved.oddsChanges.length, 2);
    assert.equal(saveResolver.calls.length, 2);
});

test('existing pending tips are reused and settled duplicates block unsafe live slips', async () => {
    const firstReq = req({});
    const saveResolver = resolver({ [`${sourceOddsPrefix}-reuse`]: 2.05 });

    await addBuilderSelection(firstReq, { matchId: `${matchPrefix}-reuse`, sourceOddsId: `${sourceOddsPrefix}-reuse` }, { resolveSelection: saveResolver });
    const first = await saveBuilderSlip(firstReq, {}, { resolveSelection: saveResolver });

    createdSlipIds.push(first.slip.id);
    assert.deepEqual(first.createdTipIds, [first.slip.tips[0].id]);
    assert.deepEqual(first.reusedTipIds, []);

    const secondReq = req({});

    await addBuilderSelection(secondReq, { matchId: `${matchPrefix}-reuse`, sourceOddsId: `${sourceOddsPrefix}-reuse` }, { resolveSelection: saveResolver });
    const second = await saveBuilderSlip(secondReq, {}, { resolveSelection: saveResolver });

    createdSlipIds.push(second.slip.id);
    assert.deepEqual(second.reusedTipIds, [first.slip.tips[0].id]);
    assert.deepEqual(second.createdTipIds, []);

    await pool.query("UPDATE tips SET result = 'won', settled_at = NOW() WHERE id = $1", [first.slip.tips[0].id]);

    const thirdReq = req({});

    await addBuilderSelection(thirdReq, { matchId: `${matchPrefix}-reuse`, sourceOddsId: `${sourceOddsPrefix}-reuse` }, { resolveSelection: saveResolver });
    await assert.rejects(
        () => saveBuilderSlip(thirdReq, {}, { resolveSelection: saveResolver }),
        /already exists as settled tip/
    );
    assert.equal(getBuilder(thirdReq).selectionCount, 1, 'failed save keeps the builder');
});

test('save failure before database work preserves the temporary builder', async () => {
    const request = req({});
    const addResolver = resolver();

    await addBuilderSelection(request, { matchId: `${matchPrefix}-fail`, sourceOddsId: `${sourceOddsPrefix}-fail` }, { resolveSelection: addResolver });

    await assert.rejects(
        () => saveBuilderSlip(request, {}, { resolveSelection: async () => { throw new Error('TrueOdds unavailable'); } }),
        /TrueOdds unavailable/
    );
    assert.equal(getBuilder(request).selectionCount, 1);
});
