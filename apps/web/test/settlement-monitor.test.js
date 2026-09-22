import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';
import { createUserAccount } from '../src/services/auth-service.js';
import {
    previewMatchSettlement,
    settleMatchFromTrueOdds
} from '../src/services/settlement-service.js';
import { findDataSourceByCode } from '../src/repositories/data-source-repository.js';
import { findSportByCode } from '../src/repositories/sport-repository.js';
import { upsertCompetition } from '../src/repositories/competition-repository.js';
import { upsertTeam } from '../src/repositories/team-repository.js';
import { upsertMatch } from '../src/repositories/match-repository.js';
import { createTip } from '../src/repositories/tip-repository.js';
import {
    attachTipsToSlip,
    createSlip
} from '../src/repositories/slip-repository.js';

/**
 * Settlement monitor: local queue, read-only TrueOdds preview and the existing
 * settlement engine driven through an injected TrueOdds fetch so mutation rules
 * are deterministic (no live API dependency for the safety cases).
 */
const runId = Date.now();
const adminEmail = `settlement-monitor-test+${runId}@example.test`;
const adminPassword = 'settlement-monitor-password';

let server = null;
let baseUrl = null;
let adminUserId = null;
let fixture = null;

function createCookieJar() {
    const cookies = new Map();

    return {
        header() {
            return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
        },
        store(response) {
            const setCookies = typeof response.headers.getSetCookie === 'function'
                ? response.headers.getSetCookie()
                : [];

            for (const rawCookie of setCookies) {
                const [pair] = rawCookie.split(';');
                const separator = pair.indexOf('=');

                if (separator > 0) {
                    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
                }
            }
        }
    };
}

async function request(path, { method = 'GET', body, jar } = {}) {
    const headers = {};

    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (jar?.header()) headers.Cookie = jar.header();

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });
    const text = await response.text();

    if (jar) jar.store(response);

    let payload = null;

    try {
        payload = JSON.parse(text);
    } catch {
        payload = text;
    }

    return { status: response.status, body: payload };
}

async function signedInJar() {
    const jar = createCookieJar();
    const response = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: adminEmail, password: adminPassword },
        jar
    });

    assert.equal(response.status, 200);

    return jar;
}

/**
 * Injected TrueOdds payloads. `trueOddsId` matches the local source_match_id so
 * the engine's identity guard passes.
 */
function trueOddsPayload(sourceMatchId, overrides = {}) {
    return {
        match: {
            id: `sr:match:test-${sourceMatchId}`,
            trueOddsId: sourceMatchId,
            status: 'finished',
            providerStatus: 'Ended',
            score: { home: 2, away: 1 },
            finalResult: 'H',
            resultStatus: 'Ended',
            ...overrides
        }
    };
}

function fetchReturning(sourceMatchId, overrides) {
    return async () => trueOddsPayload(sourceMatchId, overrides);
}

async function createFixture() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const source = await findDataSourceByCode('trueodds', client);
        const sport = await findSportByCode('football', client);
        const competition = await upsertCompetition({
            sourceId: source.id,
            sourceCompetitionId: `settlement-monitor-competition-${runId}`,
            sportId: sport.id,
            name: `Settlement Monitor League ${runId}`
        }, client);

        const makeMatch = async (suffix, label) => {
            const homeTeam = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `settlement-monitor-team-${runId}-${suffix}-home`,
                sportId: sport.id,
                name: `${label} Home ${runId}`
            }, client);

            const awayTeam = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `settlement-monitor-team-${runId}-${suffix}-away`,
                sportId: sport.id,
                name: `${label} Away ${runId}`
            }, client);

            const match = await upsertMatch({
                sourceId: source.id,
                sourceMatchId: `settlement-monitor-${suffix}-${runId}`,
                sportId: sport.id,
                competitionId: competition.id,
                homeTeamId: homeTeam.id,
                awayTeamId: awayTeam.id,
                startsAt: new Date(Date.now() - 3600 * 1000).toISOString(),
                status: 'scheduled'
            }, client);

            return {
                matchId: Number(match.id),
                sourceMatchId: match.source_match_id,
                homeTeamId: Number(homeTeam.id),
                awayTeamId: Number(awayTeam.id)
            };
        };

        const safeMatch = await makeMatch('safe', 'Monitor Safe');
        const otherMatch = await makeMatch('other', 'Monitor Other');
        const reviewMatch = await makeMatch('review', 'Monitor Review');
        const voidMatch = await makeMatch('void', 'Monitor Void');

        const tipSafe = await createTip({
            matchId: safeMatch.matchId,
            sourceOddsId: `settlement-monitor-odds-${runId}-safe`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'HOME',
            selectionName: `Monitor Safe Home ${runId}`,
            odds: 2.1,
            result: 'pending'
        }, client);

        const tipUnsupported = await createTip({
            matchId: safeMatch.matchId,
            sourceOddsId: `settlement-monitor-odds-${runId}-handicap`,
            marketCode: 'HANDICAP',
            marketName: 'Handicap 0:1',
            selectionCode: 'HOME_(0:1)',
            selectionName: 'Home (0:1)',
            line: 0,
            odds: 3.3,
            result: 'pending'
        }, client);

        const tipOtherWon = await createTip({
            matchId: otherMatch.matchId,
            sourceOddsId: `settlement-monitor-odds-${runId}-other-won`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'HOME',
            selectionName: `Monitor Other Home ${runId}`,
            odds: 1.5,
            result: 'won'
        }, client);

        await client.query('UPDATE tips SET settled_at = NOW() WHERE id = $1', [tipOtherWon.id]);

        const tipReview = await createTip({
            matchId: reviewMatch.matchId,
            sourceOddsId: `settlement-monitor-odds-${runId}-review`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'AWAY',
            selectionName: `Monitor Review Away ${runId}`,
            odds: 2.63,
            result: 'pending'
        }, client);

        const tipVoid = await createTip({
            matchId: voidMatch.matchId,
            sourceOddsId: `settlement-monitor-odds-${runId}-void`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'HOME',
            selectionName: `Monitor Void Home ${runId}`,
            odds: 1.9,
            result: 'pending'
        }, client);

        const slip = await createSlip({
            title: `Monitor slip ${runId}`,
            slipDate: new Date().toISOString().slice(0, 10),
            totalOdds: Number((2.1 * 1.5).toFixed(4)),
            stakeUnits: 1,
            creationType: 'manual'
        }, client);

        await attachTipsToSlip(slip.id, [Number(tipSafe.id), Number(tipOtherWon.id)], client);

        await client.query('COMMIT');

        return {
            competitionId: Number(competition.id),
            safeMatch,
            otherMatch,
            reviewMatch,
            voidMatch,
            tipSafe: Number(tipSafe.id),
            tipUnsupported: Number(tipUnsupported.id),
            tipOtherWon: Number(tipOtherWon.id),
            tipReview: Number(tipReview.id),
            tipVoid: Number(tipVoid.id),
            slipId: Number(slip.id),
            teamIds: [
                safeMatch.homeTeamId,
                safeMatch.awayTeamId,
                otherMatch.homeTeamId,
                otherMatch.awayTeamId,
                reviewMatch.homeTeamId,
                reviewMatch.awayTeamId,
                voidMatch.homeTeamId,
                voidMatch.awayTeamId
            ],
            matchIds: [
                safeMatch.matchId,
                otherMatch.matchId,
                reviewMatch.matchId,
                voidMatch.matchId
            ]
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function readTip(tipId) {
    const result = await pool.query('SELECT id, result, odds, settled_at FROM tips WHERE id = $1', [tipId]);

    return result.rows[0];
}

async function readSlip(slipId) {
    const result = await pool.query('SELECT id, result, total_odds, return_units, profit_units FROM slips WHERE id = $1', [slipId]);

    return result.rows[0];
}

async function readMatch(matchId) {
    const result = await pool.query('SELECT id, status, home_score, away_score FROM matches WHERE id = $1', [matchId]);

    return result.rows[0];
}

test.before(async () => {
    const admin = await createUserAccount({ email: adminEmail, password: adminPassword });

    adminUserId = admin.id;
    fixture = await createFixture();

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (fixture) {
        await pool.query('DELETE FROM slips WHERE id = $1', [fixture.slipId]);
        await pool.query('DELETE FROM tips WHERE match_id = ANY($1::bigint[])', [fixture.matchIds]);
        await pool.query('DELETE FROM matches WHERE id = ANY($1::bigint[])', [fixture.matchIds]);
        await pool.query('DELETE FROM competitions WHERE id = $1', [fixture.competitionId]);
        await pool.query('DELETE FROM teams WHERE id = ANY($1::bigint[])', [fixture.teamIds]);
    }

    await pool.query(`DELETE FROM session WHERE sess -> 'user' ->> 'id' = $1`, [String(adminUserId)]);
    await pool.query('DELETE FROM users WHERE email = $1', [adminEmail]);

    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

/* ---------------- queue ---------------- */

test('the settlement queue requires an admin session', async () => {
    const response = await request('/api/v1/settlement/matches');

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required');
});

test('the queue lists local matches that still have pending tips', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/settlement/matches?search=Monitor%20Safe&limit=50', { jar });

    assert.equal(response.status, 200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.total, 1);

    const row = response.body.matches[0];

    assert.equal(row.matchId, fixture.safeMatch.matchId);
    assert.equal(row.sourceMatchId, fixture.safeMatch.sourceMatchId);
    assert.equal(row.pendingTipCount, 2);
    assert.equal(row.affectedPendingSlipCount, 1);
    assert.equal(row.localStatus, 'scheduled');
    assert.equal(row.homeScore, null);
    assert.equal(row.homeTeam, `Monitor Safe Home ${runId}`);
    assert.ok(row.startsAt);
});

test('a match whose tips are all settled is not queued', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/settlement/matches?search=Monitor%20Other&limit=50', { jar });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.matches, []);
});

test('queue filters and pagination are validated', async () => {
    const jar = await signedInJar();
    const invalidStatus = await request('/api/v1/settlement/matches?localStatus=banana', { jar });
    const invalidLimit = await request('/api/v1/settlement/matches?limit=0', { jar });
    const paged = await request('/api/v1/settlement/matches?search=Monitor&limit=2&offset=0', { jar });
    const second = await request('/api/v1/settlement/matches?search=Monitor&limit=2&offset=2', { jar });

    assert.equal(invalidStatus.status, 400);
    assert.match(invalidStatus.body.error, /Invalid localStatus/);
    assert.equal(invalidLimit.status, 400);
    assert.equal(paged.status, 200);
    assert.equal(paged.body.count, 2);
    assert.equal(paged.body.total, 3);
    assert.equal(second.body.count, 1);
    assert.equal(
        paged.body.matches.some((row) => second.body.matches.some((other) => other.matchId === row.matchId)),
        false
    );
});

/* ---------------- preview ---------------- */

test('the preview endpoint requires an admin session and reports unknown matches', async () => {
    const anonymous = await request(`/api/v1/settlement/matches/${fixture.safeMatch.sourceMatchId}/preview`);

    assert.equal(anonymous.status, 401);

    const jar = await signedInJar();
    const missing = await request('/api/v1/settlement/matches/does-not-exist/preview', { jar });

    assert.equal(missing.status, 404);
});

test('preview of a safe final result is settleable and mutates nothing', async () => {
    const tipBefore = await readTip(fixture.tipSafe);
    const matchBefore = await readMatch(fixture.safeMatch.matchId);
    const slipBefore = await readSlip(fixture.slipId);

    const preview = await previewMatchSettlement(
        fixture.safeMatch.sourceMatchId,
        { fetchMatch: fetchReturning(fixture.safeMatch.sourceMatchId) }
    );

    assert.equal(preview.status, 'safe_final');
    assert.equal(preview.classification, 'SAFE_FINAL');
    assert.equal(preview.canAutoSettle, true);
    assert.equal(preview.actionLabel, 'Settle match');
    assert.equal(preview.wouldUpdateLocalMatch, true);
    assert.equal(preview.pendingTipCount, 2);
    assert.equal(preview.affectedPendingSlipCount, 1);

    const safeTip = preview.pendingTips.find((tip) => tip.id === fixture.tipSafe);
    const unsupportedTip = preview.pendingTips.find((tip) => tip.id === fixture.tipUnsupported);

    assert.equal(safeTip.willAutoSettle, true);
    assert.equal(safeTip.predictedResult, 'won');
    assert.equal(unsupportedTip.willAutoSettle, false);
    assert.match(unsupportedTip.reason, /Unsupported market_code/);
    assert.equal(preview.trueOdds.score.home, 2);
    assert.equal(preview.trueOdds.resultStatus, 'Ended');

    assert.deepEqual(await readTip(fixture.tipSafe), tipBefore);
    assert.deepEqual(await readMatch(fixture.safeMatch.matchId), matchBefore);
    assert.deepEqual(await readSlip(fixture.slipId), slipBefore);
});

test('preview of an AP result is manual review', async () => {
    const preview = await previewMatchSettlement(
        fixture.reviewMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.reviewMatch.sourceMatchId, {
                resultStatus: 'AP',
                score: { home: 0, away: 0 },
                finalResult: 'D'
            })
        }
    );

    assert.equal(preview.status, 'manual_review');
    assert.equal(preview.classification, 'MANUAL_REVIEW');
    assert.equal(preview.canAutoSettle, false);
    assert.equal(preview.actionLabel, null);
    assert.match(preview.reason, /AP/);
    assert.equal(preview.pendingTips[0].willAutoSettle, false);
    assert.equal(preview.pendingTips[0].predictedResult, null);
});

test('preview of an AET result is manual review', async () => {
    const preview = await previewMatchSettlement(
        fixture.reviewMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.reviewMatch.sourceMatchId, {
                resultStatus: 'AET',
                score: { home: 1, away: 1 },
                finalResult: 'D'
            })
        }
    );

    assert.equal(preview.status, 'manual_review');
    assert.equal(preview.canAutoSettle, false);
    assert.match(preview.reason, /AET/);
});

test('preview of an unfinished match is not ready', async () => {
    const preview = await previewMatchSettlement(
        fixture.reviewMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.reviewMatch.sourceMatchId, {
                status: 'scheduled',
                providerStatus: 'Not start',
                resultStatus: null,
                score: { home: null, away: null },
                finalResult: null
            })
        }
    );

    assert.equal(preview.status, 'not_ready');
    assert.equal(preview.canAutoSettle, false);
    assert.equal(preview.wouldUpdateLocalMatch, false);
});

test('preview of a void match explains the void handling', async () => {
    const preview = await previewMatchSettlement(
        fixture.voidMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.voidMatch.sourceMatchId, {
                status: 'cancelled',
                providerStatus: 'void',
                resultStatus: 'void',
                score: { home: null, away: null },
                finalResult: null
            })
        }
    );

    assert.equal(preview.status, 'void');
    assert.equal(preview.canAutoSettle, true);
    assert.equal(preview.actionLabel, 'Mark tips void');
    assert.ok(preview.notes.some((note) => /manual void handling/.test(note)));
    assert.equal(preview.wouldUpdateLocalMatch, false);
});

/* ---------------- settlement ---------------- */

test('a safe final result settles the supported tip, keeps the unsupported one pending and recalculates the slip', async () => {
    const tipBefore = await readTip(fixture.tipSafe);
    const slipBefore = await readSlip(fixture.slipId);

    const result = await settleMatchFromTrueOdds(
        fixture.safeMatch.sourceMatchId,
        { fetchMatch: fetchReturning(fixture.safeMatch.sourceMatchId) }
    );

    assert.equal(result.status, 'safe_final');
    assert.equal(result.tipsChanged, 1);
    assert.deepEqual(result.tipsUpdated.map((tip) => [tip.id, tip.result]), [[fixture.tipSafe, 'won']]);
    assert.deepEqual(result.tipsSkipped.map((tip) => tip.id), [fixture.tipUnsupported]);
    assert.match(result.tipsSkipped[0].reason, /Unsupported market_code/);
    assert.equal(result.localMatchUpdated, true);
    assert.equal(result.localMatch.status, 'finished');
    assert.equal(result.localMatch.homeScore, 2);
    assert.equal(result.localMatch.awayScore, 1);

    const settledTip = await readTip(fixture.tipSafe);
    const unsupportedTip = await readTip(fixture.tipUnsupported);
    const match = await readMatch(fixture.safeMatch.matchId);

    assert.equal(settledTip.result, 'won');
    assert.notEqual(settledTip.settled_at, null);
    assert.equal(settledTip.odds, tipBefore.odds, 'historical tip odds never change');
    assert.equal(unsupportedTip.result, 'pending', 'unsupported markets are never marked lost');
    assert.equal(match.status, 'finished');
    assert.equal(match.home_score, 2);
    assert.equal(match.away_score, 1);

    const slip = await readSlip(fixture.slipId);

    assert.equal(slip.result, 'won');
    assert.equal(slip.total_odds, slipBefore.total_odds, 'slip total odds never change');
    assert.equal(result.slipsUpdated.length, 1);
    assert.equal(result.slipsUpdated[0].id, fixture.slipId);
    assert.equal(Number(result.slipsUpdated[0].returnUnits), Number(slipBefore.total_odds));
});

test('settling the same match twice changes nothing the second time', async () => {
    const tipBefore = await readTip(fixture.tipSafe);
    const slipBefore = await readSlip(fixture.slipId);
    const matchBefore = await readMatch(fixture.safeMatch.matchId);

    const result = await settleMatchFromTrueOdds(
        fixture.safeMatch.sourceMatchId,
        { fetchMatch: fetchReturning(fixture.safeMatch.sourceMatchId) }
    );

    assert.equal(result.tipsChanged, 0);
    assert.deepEqual(result.tipsUpdated, []);
    assert.deepEqual(result.slipsUpdated, []);
    assert.deepEqual(result.tipsSkipped.map((tip) => tip.id), [fixture.tipUnsupported]);

    assert.deepEqual(await readTip(fixture.tipSafe), tipBefore);
    assert.deepEqual(await readSlip(fixture.slipId), slipBefore);
    assert.deepEqual(await readMatch(fixture.safeMatch.matchId), matchBefore);
});

test('an AP result never mutates tips or the local match', async () => {
    const tipBefore = await readTip(fixture.tipReview);
    const matchBefore = await readMatch(fixture.reviewMatch.matchId);

    const result = await settleMatchFromTrueOdds(
        fixture.reviewMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.reviewMatch.sourceMatchId, {
                resultStatus: 'AP',
                score: { home: 0, away: 0 },
                finalResult: 'D'
            })
        }
    );

    assert.equal(result.status, 'manual_review');
    assert.equal(result.tipsChanged, 0);
    assert.deepEqual(result.tipsSkipped.map((tip) => tip.id), [fixture.tipReview]);
    assert.deepEqual(await readTip(fixture.tipReview), tipBefore);
    assert.deepEqual(await readMatch(fixture.reviewMatch.matchId), matchBefore);
});

test('an AET result never mutates tips or the local match', async () => {
    const tipBefore = await readTip(fixture.tipReview);
    const matchBefore = await readMatch(fixture.reviewMatch.matchId);

    const result = await settleMatchFromTrueOdds(
        fixture.reviewMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.reviewMatch.sourceMatchId, {
                resultStatus: 'AET',
                score: { home: 1, away: 1 },
                finalResult: 'D'
            })
        }
    );

    assert.equal(result.status, 'manual_review');
    assert.equal(result.tipsChanged, 0);
    assert.deepEqual(await readTip(fixture.tipReview), tipBefore);
    assert.deepEqual(await readMatch(fixture.reviewMatch.matchId), matchBefore);
});

test('an unfinished match settles nothing', async () => {
    const tipBefore = await readTip(fixture.tipReview);

    const result = await settleMatchFromTrueOdds(
        fixture.reviewMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.reviewMatch.sourceMatchId, {
                status: 'scheduled',
                providerStatus: 'Not start',
                resultStatus: null,
                score: { home: null, away: null },
                finalResult: null
            })
        }
    );

    assert.equal(result.status, 'not_ready');
    assert.equal(result.tipsChanged, 0);
    assert.deepEqual(await readTip(fixture.tipReview), tipBefore);
});

test('a void result marks tips void and leaves the slip for manual void handling', async () => {
    const tipBefore = await readTip(fixture.tipVoid);
    const matchBefore = await readMatch(fixture.voidMatch.matchId);
    const result = await settleMatchFromTrueOdds(
        fixture.voidMatch.sourceMatchId,
        {
            fetchMatch: fetchReturning(fixture.voidMatch.sourceMatchId, {
                status: 'cancelled',
                providerStatus: 'void',
                resultStatus: 'void',
                score: { home: null, away: null },
                finalResult: null
            })
        }
    );

    assert.equal(result.status, 'void');
    assert.equal(result.tipsChanged, 1);
    assert.equal(result.tipsUpdated[0].result, 'void');
    assert.equal(result.localMatchUpdated, false);

    const tip = await readTip(fixture.tipVoid);

    assert.equal(tip.result, 'void');
    assert.equal(tip.odds, tipBefore.odds);
    assert.deepEqual(await readMatch(fixture.voidMatch.matchId), matchBefore, 'void never rewrites the local match row');
});

/* ---------------- live regression checks (skipped without TrueOdds) ---------------- */

test('the live Brentford vs Chelsea AP example stays manual review', async (t) => {
    const stored = await pool.query(
        `SELECT id, source_match_id FROM matches WHERE source_match_id = '5630529'`
    );

    if (stored.rows.length === 0) {
        t.skip('the AP example match is not stored in this database');
        return;
    }

    const jar = await signedInJar();
    const response = await request('/api/v1/settlement/matches/5630529/preview', { jar });

    if (response.status >= 500) {
        t.skip('TrueOdds is not reachable from this environment');
        return;
    }

    assert.equal(response.status, 200);
    assert.equal(response.body.canAutoSettle, false);
    assert.equal(response.body.status, 'manual_review');
    assert.match(response.body.reason, /AP/);

    const tips = await pool.query(
        `SELECT id, result, odds FROM tips WHERE match_id = $1 ORDER BY id`,
        [stored.rows[0].id]
    );

    assert.ok(tips.rows.every((tip) => tip.result === 'pending'), 'the AP preview must not touch tips');
});

test('the live preview performs no database mutation', async (t) => {
    const stored = await pool.query(
        `SELECT id, source_match_id FROM matches WHERE source_match_id = '6013445'`
    );

    if (stored.rows.length === 0) {
        t.skip('the finished example match is not stored in this database');
        return;
    }

    const matchId = stored.rows[0].id;
    const before = {
        match: await readMatch(matchId),
        tips: (await pool.query('SELECT id, result, odds FROM tips WHERE match_id = $1 ORDER BY id', [matchId])).rows,
        slips: (await pool.query('SELECT COUNT(*)::int AS total FROM slips')).rows[0].total
    };
    const jar = await signedInJar();
    const response = await request('/api/v1/settlement/matches/6013445/preview', { jar });

    if (response.status >= 500) {
        t.skip('TrueOdds is not reachable from this environment');
        return;
    }

    assert.equal(response.status, 200);
    assert.ok(['safe_final', 'manual_review', 'not_ready', 'void'].includes(response.body.status));

    assert.deepEqual(await readMatch(matchId), before.match);
    assert.deepEqual(
        (await pool.query('SELECT id, result, odds FROM tips WHERE match_id = $1 ORDER BY id', [matchId])).rows,
        before.tips
    );
    assert.equal((await pool.query('SELECT COUNT(*)::int AS total FROM slips')).rows[0].total, before.slips);
});

test('the settlement endpoint rejects unauthenticated callers', async () => {
    const response = await request(`/api/v1/settlement/matches/${fixture.safeMatch.sourceMatchId}`, {
        method: 'POST'
    });

    assert.equal(response.status, 401);
});
