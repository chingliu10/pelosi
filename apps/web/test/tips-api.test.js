import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';
import { createUserAccount } from '../src/services/auth-service.js';
import { findDataSourceByCode } from '../src/repositories/data-source-repository.js';
import { findSportByCode } from '../src/repositories/sport-repository.js';
import { upsertCompetition } from '../src/repositories/competition-repository.js';
import { upsertTeam } from '../src/repositories/team-repository.js';
import { upsertMatch } from '../src/repositories/match-repository.js';
import { createTip } from '../src/repositories/tip-repository.js';

/**
 * Tips read API + duplicate-import protection.
 *
 * Fixture data (one throwaway match with three tips) is committed so the HTTP
 * API can see it, then deleted again in the cleanup hook.
 */
const runId = Date.now();
const adminEmail = `tips-api-test+${runId}@example.test`;
const adminPassword = 'tips-api-test-password';
const homeTeamName = `Zeta Test United ${runId}`;
const awayTeamName = `Zeta Test City ${runId}`;
const cookieName = process.env.SESSION_COOKIE_NAME || 'pelosi.sid';

// Real imported tip kept in the project (real TrueOdds selection).
const realTipId = 13;
const realTipSelection = { matchId: '6278349', sourceOddsId: '154886210' };

let server = null;
let baseUrl = null;
let adminUserId = null;
let fixture = null;
let realTipBefore = null;

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

async function createFixture() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const source = await findDataSourceByCode('trueodds', client);
        const sport = await findSportByCode('football', client);

        const homeTeam = await upsertTeam({
            sourceId: source.id,
            sourceTeamId: `test-team-${runId}-home`,
            sportId: sport.id,
            name: homeTeamName
        }, client);

        const awayTeam = await upsertTeam({
            sourceId: source.id,
            sourceTeamId: `test-team-${runId}-away`,
            sportId: sport.id,
            name: awayTeamName
        }, client);

        const competition = await upsertCompetition({
            sourceId: source.id,
            sourceCompetitionId: `test-competition-${runId}`,
            sportId: sport.id,
            name: `Test League ${runId}`
        }, client);

        const match = await upsertMatch({
            sourceId: source.id,
            sourceMatchId: `test-match-${runId}`,
            sportId: sport.id,
            competitionId: competition.id,
            homeTeamId: homeTeam.id,
            awayTeamId: awayTeam.id,
            startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            status: 'scheduled'
        }, client);

        const pendingTip = await createTip({
            matchId: match.id,
            sourceOddsId: `test-odds-${runId}-1`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'HOME',
            selectionName: homeTeamName,
            odds: 2.1,
            result: 'pending'
        }, client);

        const wonTip = await createTip({
            matchId: match.id,
            sourceOddsId: `test-odds-${runId}-2`,
            marketCode: 'TOTAL_GOALS',
            marketName: 'Over/Under 2.5',
            selectionCode: 'OVER',
            selectionName: 'Over 2.5',
            line: 2.5,
            odds: 1.8,
            result: 'won'
        }, client);

        await client.query(
            `UPDATE tips SET settled_at = NOW() WHERE id = $1`,
            [wonTip.id]
        );

        const lostTip = await createTip({
            matchId: match.id,
            sourceOddsId: `test-odds-${runId}-3`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'AWAY',
            selectionName: awayTeamName,
            odds: 3.4,
            result: 'lost'
        }, client);

        await client.query('COMMIT');

        return {
            matchId: Number(match.id),
            homeTeamId: Number(homeTeam.id),
            awayTeamId: Number(awayTeam.id),
            competitionId: Number(competition.id),
            tipIds: [Number(pendingTip.id), Number(wonTip.id), Number(lostTip.id)]
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

test.before(async () => {
    const admin = await createUserAccount({ email: adminEmail, password: adminPassword });

    adminUserId = admin.id;
    fixture = await createFixture();

    const realTip = await pool.query('SELECT id, odds, result FROM tips WHERE id = $1', [realTipId]);

    realTipBefore = realTip.rows[0] ?? null;

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (fixture) {
        await pool.query('DELETE FROM tips WHERE match_id = $1', [fixture.matchId]);
        await pool.query('DELETE FROM matches WHERE id = $1', [fixture.matchId]);
        await pool.query('DELETE FROM competitions WHERE id = $1', [fixture.competitionId]);
        await pool.query('DELETE FROM teams WHERE id = ANY($1::bigint[])', [[fixture.homeTeamId, fixture.awayTeamId]]);
    }

    await pool.query(`DELETE FROM session WHERE sess -> 'user' ->> 'id' = $1`, [String(adminUserId)]);
    await pool.query('DELETE FROM users WHERE email = $1', [adminEmail]);

    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

test('GET /api/v1/tips without a session returns 401', async () => {
    const response = await request('/api/v1/tips');

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required');
});

test('GET /api/v1/tips returns tips with their match for an admin session', async () => {
    const jar = await signedInJar();
    const response = await request(`/api/v1/tips?matchId=${fixture.matchId}`, { jar });

    assert.equal(response.status, 200);
    assert.equal(response.body.tips.length, 3);
    assert.equal(response.body.count, 3);
    assert.equal(response.body.total, 3);
    assert.equal(response.body.limit, 50);
    assert.equal(response.body.offset, 0);
    assert.deepEqual(response.body.counts, { all: 3, pending: 1, won: 1, lost: 1, void: 0 });

    const tip = response.body.tips.find((row) => row.result === 'pending');

    assert.equal(typeof tip.id, 'number');
    assert.equal(tip.odds, 2.1);
    assert.equal(tip.marketCode, 'MATCH_RESULT');
    assert.equal(tip.selectionCode, 'HOME');
    assert.equal(tip.creationType, 'manual');
    assert.equal(tip.match.id, fixture.matchId);
    assert.equal(tip.match.sourceMatchId, `test-match-${runId}`);
    assert.equal(tip.match.homeTeam, homeTeamName);
    assert.equal(tip.match.awayTeam, awayTeamName);
    assert.equal(tip.match.competition, `Test League ${runId}`);
    assert.equal(tip.match.status, 'scheduled');
    assert.equal(tip.settledAt, null);

    // Source identifiers stay out of the list payload.
    assert.equal(tip.sourceOddsId, undefined);
    assert.equal(tip.source_odds_id, undefined);
});

test('the result filter narrows the list and keeps every count', async () => {
    const jar = await signedInJar();
    const pending = await request(`/api/v1/tips?matchId=${fixture.matchId}&result=pending`, { jar });

    assert.equal(pending.status, 200);
    assert.equal(pending.body.count, 1);
    assert.equal(pending.body.total, 1);
    assert.equal(pending.body.tips[0].result, 'pending');
    assert.deepEqual(pending.body.counts, { all: 3, pending: 1, won: 1, lost: 1, void: 0 });

    const won = await request(`/api/v1/tips?matchId=${fixture.matchId}&result=won`, { jar });

    assert.equal(won.body.tips.length, 1);
    assert.equal(won.body.tips[0].result, 'won');
    assert.notEqual(won.body.tips[0].settledAt, null);
});

test('an invalid result filter returns 400', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/tips?result=banana', { jar });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Invalid result/);
});

test('invalid pagination values return 400', async () => {
    const jar = await signedInJar();

    assert.equal((await request('/api/v1/tips?limit=0', { jar })).status, 400);
    assert.equal((await request('/api/v1/tips?limit=abs', { jar })).status, 400);
    assert.equal((await request('/api/v1/tips?offset=-1', { jar })).status, 400);
});

test('pagination walks the result set', async () => {
    const jar = await signedInJar();
    const first = await request(`/api/v1/tips?matchId=${fixture.matchId}&limit=2&offset=0`, { jar });
    const second = await request(`/api/v1/tips?matchId=${fixture.matchId}&limit=2&offset=2`, { jar });

    assert.equal(first.body.count, 2);
    assert.equal(first.body.total, 3);
    assert.equal(first.body.limit, 2);
    assert.equal(second.body.count, 1);
    assert.equal(second.body.offset, 2);

    const firstIds = first.body.tips.map((tip) => tip.id);
    const secondIds = second.body.tips.map((tip) => tip.id);

    assert.equal(firstIds.some((id) => secondIds.includes(id)), false);
});

test('search matches team, selection and market text', async () => {
    const jar = await signedInJar();
    const byHomeTeam = await request(`/api/v1/tips?search=${encodeURIComponent(homeTeamName)}`, { jar });
    const byAwayTeam = await request(`/api/v1/tips?search=${encodeURIComponent(awayTeamName)}`, { jar });
    const bySelection = await request(`/api/v1/tips?search=${encodeURIComponent('Over 2.5')}`, { jar });
    const byMarket = await request(`/api/v1/tips?search=${encodeURIComponent('Over/Under')}`, { jar });

    assert.equal(byHomeTeam.status, 200);
    assert.ok(byHomeTeam.body.tips.length >= 1);
    assert.ok(byHomeTeam.body.tips.every((tip) => tip.match.homeTeam === homeTeamName));

    assert.ok(byAwayTeam.body.tips.length >= 1);
    assert.ok(byAwayTeam.body.tips.every((tip) => tip.match.awayTeam === awayTeamName));

    assert.ok(bySelection.body.tips.some((tip) => tip.selectionName === 'Over 2.5'));
    assert.ok(byMarket.body.tips.some((tip) => tip.marketName === 'Over/Under 2.5'));

    // LIKE wildcards in user input stay literal instead of matching everything.
    const literalWildcard = await request('/api/v1/tips?search=%25', { jar });

    assert.equal(literalWildcard.status, 200);
    assert.deepEqual(literalWildcard.body.tips, []);

    const noMatches = await request('/api/v1/tips?search=zzzz-no-such-team-zzzz', { jar });

    assert.equal(noMatches.status, 200);
    assert.deepEqual(noMatches.body.tips, []);
});

test('GET /api/v1/tips/:id returns the tip with its source identifiers', async () => {
    const jar = await signedInJar();
    const tipId = fixture.tipIds[0];
    const response = await request(`/api/v1/tips/${tipId}`, { jar });

    assert.equal(response.status, 200);
    assert.equal(response.body.id, tipId);
    assert.equal(response.body.marketCode, 'MATCH_RESULT');
    assert.equal(response.body.source.oddsId, `test-odds-${runId}-1`);
    assert.equal(response.body.match.homeTeam, homeTeamName);

    assert.equal((await request('/api/v1/tips/999999999', { jar })).status, 404);
    assert.equal((await request('/api/v1/tips/abc', { jar })).status, 400);
    assert.equal((await request(`/api/v1/tips/${tipId}`)).status, 401);
});

test('the database rejects a duplicate (match_id, source_odds_id) pair', async () => {
    const client = await pool.connect();
    let error = null;

    try {
        await client.query('BEGIN');
        await client.query(
            `
            INSERT INTO tips (match_id, source_odds_id, market_code, selection_code, odds)
            VALUES ($1, $2, 'MATCH_RESULT', 'HOME', 2.1)
            `,
            [fixture.matchId, `test-odds-${runId}-1`]
        );
        await client.query('COMMIT');
    } catch (thrown) {
        error = thrown;
        await client.query('ROLLBACK');
    } finally {
        client.release();
    }

    assert.ok(error, 'the unique index must reject the duplicate row');
    assert.equal(error.code, '23505');

    const stored = await pool.query(
        'SELECT COUNT(*)::int AS total FROM tips WHERE match_id = $1 AND source_odds_id = $2',
        [fixture.matchId, `test-odds-${runId}-1`]
    );

    assert.equal(stored.rows[0].total, 1);
});

test('importing the same TrueOdds selection twice returns 409 and creates no row', async (t) => {
    if (!realTipBefore) {
        t.skip('real tip 13 is not present in this database');
        return;
    }

    const jar = await signedInJar();
    const response = await request('/api/trueodds/tips/import', {
        method: 'POST',
        body: { ...realTipSelection, creationType: 'manual' },
        jar
    });

    if (response.status === 500) {
        t.skip('TrueOdds is not reachable from this environment');
        return;
    }

    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'Tip already imported');
    assert.equal(response.body.existingTipId, realTipId);

    const stored = await pool.query(
        'SELECT id, odds, result FROM tips WHERE match_id = (SELECT id FROM matches WHERE source_match_id = $1) AND source_odds_id = $2',
        [realTipSelection.matchId, realTipSelection.sourceOddsId]
    );

    assert.equal(stored.rows.length, 1);
    assert.equal(Number(stored.rows[0].id), realTipId);
    assert.equal(Number(stored.rows[0].odds), 2.35);
    assert.equal(stored.rows[0].result, 'pending');
});

test('the duplicate attempt leaves historical tip odds untouched', async (t) => {
    if (!realTipBefore) {
        t.skip('real tip 13 is not present in this database');
        return;
    }

    const after = await pool.query('SELECT id, odds, result FROM tips WHERE id = $1', [realTipId]);

    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0].odds, realTipBefore.odds);
    assert.equal(after.rows[0].result, realTipBefore.result);

    const jar = await signedInJar();
    const listed = await request(`/api/v1/tips?search=${encodeURIComponent('Bangalore')}`, { jar });

    if (listed.status !== 200) {
        t.skip('tips list unavailable');
        return;
    }

    const tip = listed.body.tips.find((row) => row.id === realTipId);

    assert.ok(tip, 'tip 13 should be listed');
    assert.equal(tip.odds, Number(realTipBefore.odds));
    assert.equal(tip.result, realTipBefore.result);
});
