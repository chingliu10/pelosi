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
 * Slip creation rules (pending-only, distinct matches, server-side odds) and
 * the admin/public slip visibility split.
 *
 * Fixtures are committed so the HTTP API can see them and are deleted in the
 * cleanup hook; created slips are deleted as well.
 */
const runId = Date.now();
const adminEmail = `slips-api-test+${runId}@example.test`;
const adminPassword = 'slips-api-test-password';

let server = null;
let baseUrl = null;
let adminUserId = null;
let fixture = null;
const createdSlipIds = [];

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
        const competition = await upsertCompetition({
            sourceId: source.id,
            sourceCompetitionId: `slip-test-competition-${runId}`,
            sportId: sport.id,
            name: `Slip Test League ${runId}`
        }, client);

        const matches = [];

        for (const suffix of ['a', 'b']) {
            const homeTeam = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `slip-test-team-${runId}-${suffix}-home`,
                sportId: sport.id,
                name: `Slip Test ${suffix.toUpperCase()} Home ${runId}`
            }, client);

            const awayTeam = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `slip-test-team-${runId}-${suffix}-away`,
                sportId: sport.id,
                name: `Slip Test ${suffix.toUpperCase()} Away ${runId}`
            }, client);

            const match = await upsertMatch({
                sourceId: source.id,
                sourceMatchId: `slip-test-match-${runId}-${suffix}`,
                sportId: sport.id,
                competitionId: competition.id,
                homeTeamId: homeTeam.id,
                awayTeamId: awayTeam.id,
                startsAt: new Date(Date.now() + 3600 * 1000).toISOString(),
                status: 'scheduled'
            }, client);

            matches.push({ match, homeTeam, awayTeam });
        }

        const [matchA, matchB] = matches;

        const tipA1 = await createTip({
            matchId: matchA.match.id,
            sourceOddsId: `slip-test-odds-${runId}-a1`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'HOME',
            selectionName: matchA.homeTeam.name,
            odds: 2.1,
            result: 'pending'
        }, client);

        const tipA2 = await createTip({
            matchId: matchA.match.id,
            sourceOddsId: `slip-test-odds-${runId}-a2`,
            marketCode: 'TOTAL_GOALS',
            marketName: 'Over/Under 2.5',
            selectionCode: 'OVER',
            selectionName: 'Over 2.5',
            line: 2.5,
            odds: 1.9,
            result: 'pending'
        }, client);

        const tipB1 = await createTip({
            matchId: matchB.match.id,
            sourceOddsId: `slip-test-odds-${runId}-b1`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'AWAY',
            selectionName: matchB.awayTeam.name,
            odds: 1.5,
            result: 'pending'
        }, client);

        const tipB2 = await createTip({
            matchId: matchB.match.id,
            sourceOddsId: `slip-test-odds-${runId}-b2`,
            marketCode: 'MATCH_RESULT',
            marketName: '1X2',
            selectionCode: 'HOME',
            selectionName: matchB.homeTeam.name,
            odds: 1.8,
            result: 'won'
        }, client);

        await client.query('UPDATE tips SET settled_at = NOW() WHERE id = $1', [tipB2.id]);
        await client.query('COMMIT');

        return {
            matchAId: Number(matchA.match.id),
            matchBId: Number(matchB.match.id),
            competitionId: Number(competition.id),
            teamIds: matches.flatMap((entry) => [Number(entry.homeTeam.id), Number(entry.awayTeam.id)]),
            tipA1: Number(tipA1.id),
            tipA2: Number(tipA2.id),
            tipB1: Number(tipB1.id),
            tipB2: Number(tipB2.id)
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function countRows(table, where = '', params = []) {
    const result = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table} ${where}`, params);

    return result.rows[0].total;
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
    if (createdSlipIds.length > 0) {
        await pool.query('DELETE FROM slips WHERE id = ANY($1::bigint[])', [createdSlipIds]);
    }

    if (fixture) {
        await pool.query('DELETE FROM tips WHERE match_id = ANY($1::bigint[])', [[fixture.matchAId, fixture.matchBId]]);
        await pool.query('DELETE FROM matches WHERE id = ANY($1::bigint[])', [[fixture.matchAId, fixture.matchBId]]);
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

test('anonymous callers cannot create a slip', async () => {
    const response = await request('/api/v1/slips', {
        method: 'POST',
        body: { tipIds: [fixture.tipA1, fixture.tipB1] }
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required');
});

test('an admin creates a draft slip from pending tips of different matches', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/slips', {
        method: 'POST',
        body: { title: 'Test Double', tipIds: [fixture.tipA1, fixture.tipB1], creationType: 'manual' },
        jar
    });

    assert.equal(response.status, 201);
    createdSlipIds.push(response.body.id);

    const slip = response.body;
    const expectedTotal = Number((2.1 * 1.5).toFixed(4));

    assert.equal(slip.title, 'Test Double');
    assert.equal(slip.result, 'pending');
    assert.equal(slip.publicationStatus, 'draft');
    assert.equal(Number(slip.stakeUnits), 1);
    assert.equal(slip.totalOdds, expectedTotal);
    assert.equal(slip.returnUnits, null);
    assert.equal(slip.profitUnits, null);
    assert.equal(slip.tips.length, 2);
    assert.deepEqual(slip.tips.map((tip) => tip.id), [fixture.tipA1, fixture.tipB1]);
    assert.deepEqual(slip.tips.map((tip) => tip.legOrder), [1, 2]);

    const stored = await pool.query('SELECT total_odds, stake_units, result, publication_status FROM slips WHERE id = $1', [slip.id]);

    assert.equal(Number(stored.rows[0].total_odds), expectedTotal);
    assert.equal(Number(stored.rows[0].stake_units), 1);
    assert.equal(stored.rows[0].result, 'pending');
    assert.equal(stored.rows[0].publication_status, 'draft');
});

test('total odds are the product of the stored tip odds, not a browser value', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/slips', {
        method: 'POST',
        body: {
            tipIds: [fixture.tipA1, fixture.tipB1],
            totalOdds: 999,
            stakeUnits: 50,
            result: 'won',
            publicationStatus: 'published',
            profitUnits: 100
        },
        jar
    });

    assert.equal(response.status, 201);
    createdSlipIds.push(response.body.id);
    assert.equal(response.body.totalOdds, Number((2.1 * 1.5).toFixed(4)));
    assert.equal(Number(response.body.stakeUnits), 1);
    assert.equal(response.body.result, 'pending');
    assert.equal(response.body.publicationStatus, 'draft');
    assert.equal(response.body.profitUnits, null);
});

test('duplicate tip ids are rejected', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/slips', {
        method: 'POST',
        body: { tipIds: [fixture.tipA1, fixture.tipA1] },
        jar
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Duplicate tipIds/);
});

test('an unknown tip id is rejected', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/slips', {
        method: 'POST',
        body: { tipIds: [fixture.tipA1, 999999999] },
        jar
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /not found/i);
});

test('an already settled tip cannot be added to a new slip', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/slips', {
        method: 'POST',
        body: { tipIds: [fixture.tipA1, fixture.tipB2] },
        jar
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /pending/i);
    assert.match(response.body.error, new RegExp(String(fixture.tipB2)));
});

test('two tips from the same match are rejected', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/slips', {
        method: 'POST',
        body: { tipIds: [fixture.tipA1, fixture.tipA2] },
        jar
    });

    assert.equal(response.status, 400);
    assert.equal(
        response.body.error.startsWith('A slip cannot contain multiple tips from the same match'),
        true
    );
});

test('a rejected creation leaves no partial slip or legs behind', async () => {
    const jar = await signedInJar();
    const slipsBefore = await countRows('slips');
    const legsBefore = await countRows('slip_tips');

    for (const body of [
        { tipIds: [fixture.tipA1, fixture.tipA1] },
        { tipIds: [fixture.tipA1, 999999999] },
        { tipIds: [fixture.tipA1, fixture.tipB2] },
        { tipIds: [fixture.tipA1, fixture.tipA2] }
    ]) {
        const response = await request('/api/v1/slips', { method: 'POST', body, jar });

        assert.equal(response.status, 400);
    }

    assert.equal(await countRows('slips'), slipsBefore);
    assert.equal(await countRows('slip_tips'), legsBefore);
});

test('anonymous callers cannot read slip management data', async () => {
    const list = await request('/api/v1/slips');
    const draft = await request(`/api/v1/slips/${createdSlipIds[0]}`);

    assert.equal(list.status, 401);
    assert.equal(draft.status, 401);
});

test('admins can list drafts and hidden slips', async () => {
    const jar = await signedInJar();
    const drafts = await request('/api/v1/slips?publicationStatus=draft&limit=100', { jar });

    assert.equal(drafts.status, 200);
    assert.ok(drafts.body.slips.some((slip) => slip.id === createdSlipIds[0]));
    assert.ok(drafts.body.slips.every((slip) => slip.publicationStatus === 'draft'));
});

test('drafts and hidden slips are invisible on the public slip API', async () => {
    const invisibleId = createdSlipIds[0];
    const publicList = await request('/api/v1/public/slips?limit=100');
    const publicDetail = await request(`/api/v1/public/slips/${invisibleId}`);

    assert.equal(publicList.status, 200);
    assert.equal(publicList.body.slips.some((slip) => slip.id === invisibleId), false);
    assert.ok(publicList.body.slips.every((slip) => slip.publicationStatus === 'published'));
    assert.equal(publicDetail.status, 404);
});

test('publishing exposes the slip publicly and hiding removes it again', async () => {
    const jar = await signedInJar();
    const slipId = createdSlipIds[0];
    const publish = await request(`/api/v1/slips/${slipId}/publish`, { method: 'POST', jar });

    assert.equal(publish.status, 200);
    assert.equal(publish.body.publicationStatus, 'published');
    assert.notEqual(publish.body.publishedAt, null);

    const publishedAt = publish.body.publishedAt;
    const publicList = await request('/api/v1/public/slips?limit=100');
    const publicDetail = await request(`/api/v1/public/slips/${slipId}`);

    assert.ok(publicList.body.slips.some((slip) => slip.id === slipId));
    assert.equal(publicDetail.status, 200);
    assert.equal(publicDetail.body.id, slipId);
    assert.equal(publicDetail.body.tips.length, 2);
    assert.equal(publicDetail.body.totalOdds, Number((2.1 * 1.5).toFixed(4)));
    assert.equal(publicDetail.body.tips[0].match.homeTeam, `Slip Test A Home ${runId}`);
    assert.equal(publicDetail.body.tips[1].match.homeTeam, `Slip Test B Home ${runId}`);

    const publishAgain = await request(`/api/v1/slips/${slipId}/publish`, { method: 'POST', jar });

    assert.equal(publishAgain.body.publishedAt, publishedAt, 'published_at is preserved');

    const hide = await request(`/api/v1/slips/${slipId}/hide`, { method: 'POST', jar });

    assert.equal(hide.status, 200);
    assert.equal(hide.body.publicationStatus, 'hidden');
    assert.equal(hide.body.publishedAt, publishedAt, 'hiding keeps the published timestamp');

    const hiddenDetail = await request(`/api/v1/public/slips/${slipId}`);
    const hiddenList = await request('/api/v1/public/slips?limit=100');

    assert.equal(hiddenDetail.status, 404);
    assert.equal(hiddenList.body.slips.some((slip) => slip.id === slipId), false);

    const republish = await request(`/api/v1/slips/${slipId}/publish`, { method: 'POST', jar });

    assert.equal(republish.status, 200);
    assert.equal(republish.body.publicationStatus, 'published');
    assert.equal(republish.body.publishedAt, publishedAt);
});

test('slip detail keeps the legs in order with stored odds', async () => {
    const jar = await signedInJar();
    const slipId = createdSlipIds[0];
    const response = await request(`/api/v1/slips/${slipId}`, { jar });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.tips.map((tip) => tip.id), [fixture.tipA1, fixture.tipB1]);
    assert.deepEqual(response.body.tips.map((tip) => tip.odds), [2.1, 1.5]);
    assert.equal(response.body.tips[0].match.id, fixture.matchAId);
    assert.equal(response.body.tips[1].match.id, fixture.matchBId);
});
