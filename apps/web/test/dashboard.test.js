import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';
import { createUserAccount } from '../src/services/auth-service.js';
import { getPublishedPerformance } from '../src/services/performance-service.js';
import { getSettlementQueue } from '../src/services/settlement-service.js';
import { getSlips } from '../src/services/slip-service.js';
import { getTips } from '../src/services/tip-service.js';

/**
 * Dashboard API: an aggregator over the existing services.
 *
 * The strongest property is consistency - every dashboard number must equal the
 * number the owning service returns - so most assertions compare the dashboard
 * response with a direct service call instead of hard-coded values.
 */
const runId = Date.now();
const adminEmail = `dashboard-test+${runId}@example.test`;
const adminPassword = 'dashboard-test-password';

let server = null;
let baseUrl = null;
let adminUserId = null;
const fixtureMatchIds = [];
const fixtureTipIds = [];
const fixtureSlipIds = [];

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

/** Fixtures: one pending tip on a fresh match, plus a draft slip. */
async function createFixture() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const source = (await client.query('SELECT id FROM data_sources WHERE code = $1', ['trueodds'])).rows[0];
        const sport = (await client.query('SELECT id FROM sports WHERE code = $1', ['football'])).rows[0];
        const competition = (await client.query(
            `
            INSERT INTO competitions (source_id, source_competition_id, sport_id, name)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            `,
            [source.id, `dashboard-competition-${runId}`, sport.id, `Dashboard Test League ${runId}`]
        )).rows[0];

        const teamIds = [];

        for (const suffix of ['home', 'away']) {
            const team = (await client.query(
                `
                INSERT INTO teams (source_id, source_team_id, sport_id, name)
                VALUES ($1, $2, $3, $4)
                RETURNING id
                `,
                [source.id, `dashboard-team-${runId}-${suffix}`, sport.id, `Dashboard ${suffix} ${runId}`]
            )).rows[0];

            teamIds.push(Number(team.id));
        }

        const match = (await client.query(
            `
            INSERT INTO matches (source_id, source_match_id, sport_id, competition_id, home_team_id, away_team_id, starts_at, status)
            VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '2 hours', 'scheduled')
            RETURNING id
            `,
            [source.id, `dashboard-match-${runId}`, sport.id, competition.id, teamIds[0], teamIds[1]]
        )).rows[0];

        fixtureMatchIds.push(Number(match.id));

        const tip = (await client.query(
            `
            INSERT INTO tips (match_id, source_odds_id, market_code, market_name, selection_code, selection_name, odds, result)
            VALUES ($1, $2, 'MATCH_RESULT', '1X2', 'HOME', $3, 2.4, 'pending')
            RETURNING id
            `,
            [match.id, `dashboard-odds-${runId}`, `Dashboard home ${runId}`]
        )).rows[0];

        fixtureTipIds.push(Number(tip.id));

        const slip = (await client.query(
            `
            INSERT INTO slips (title, slip_date, total_odds, stake_units, result, publication_status)
            VALUES ($1, CURRENT_DATE, 2.4, 1, 'pending', 'draft')
            RETURNING id
            `,
            [`Dashboard test slip ${runId}`]
        )).rows[0];

        fixtureSlipIds.push(Number(slip.id));

        await client.query('COMMIT');

        return {
            competitionId: Number(competition.id),
            teamIds
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

let fixture = null;

test.before(async () => {
    const admin = await createUserAccount({ email: adminEmail, password: adminPassword });

    adminUserId = admin.id;
    fixture = await createFixture();

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (fixtureSlipIds.length > 0) {
        await pool.query('DELETE FROM slips WHERE id = ANY($1::bigint[])', [fixtureSlipIds]);
    }

    if (fixtureTipIds.length > 0) {
        await pool.query('DELETE FROM tips WHERE id = ANY($1::bigint[])', [fixtureTipIds]);
    }

    if (fixtureMatchIds.length > 0) {
        await pool.query('DELETE FROM matches WHERE id = ANY($1::bigint[])', [fixtureMatchIds]);
    }

    if (fixture) {
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

test('the dashboard API requires an admin session', async () => {
    const response = await request('/api/v1/admin/dashboard');

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required');
});

test('the dashboard returns every section for an admin session', async () => {
    const jar = await signedInJar();
    const response = await request('/api/v1/admin/dashboard', { jar });

    assert.equal(response.status, 200);

    for (const key of ['summary', 'performance', 'recentTips', 'recentSlips', 'settlementQueue', 'errors']) {
        assert.ok(key in response.body, `missing ${key}`);
    }

    for (const key of ['pendingTips', 'draftSlips', 'publishedSlips', 'settlementMatches']) {
        assert.equal(typeof response.body.summary[key], 'number', `summary.${key} should be a number`);
    }

    assert.deepEqual(response.body.errors, {});
    assert.deepEqual(response.body.limits, { recentActivity: 5, settlementPreview: 5 });
});

test('every summary count matches the service that owns the definition', async () => {
    const jar = await signedInJar();
    const before = await readDashboardSources();
    const dashboard = (await request('/api/v1/admin/dashboard', { jar })).body;
    const after = await readDashboardSources();

    // Another test file could commit a row between the service read and the
    // dashboard read, so accept either snapshot.
    const matchesSnapshot = (snapshot) => dashboard.summary.pendingTips === snapshot.pendingTips
        && dashboard.summary.draftSlips === snapshot.draftSlips
        && dashboard.summary.publishedSlips === snapshot.publishedSlips
        && dashboard.summary.settlementMatches === snapshot.settlementMatches;

    assert.ok(matchesSnapshot(before) || matchesSnapshot(after), 'summary counts must match the services');

    // The result breakdown comes from the tips service too.
    assert.deepEqual(dashboard.tipCounts, before.tipCounts);
    assert.ok(
        dashboard.settlementQueueTotal === before.settlementMatches
        || dashboard.settlementQueueTotal === after.settlementMatches
    );
});

async function readDashboardSources() {
    const [pendingTips, draftSlips, publishedSlips, settlement] = await Promise.all([
        getTips({ result: 'pending', limit: 1 }),
        getSlips({ publicationStatus: 'draft', limit: 1 }),
        getSlips({ publicationStatus: 'published', limit: 1 }),
        getSettlementQueue({ limit: 1 })
    ]);

    return {
        pendingTips: pendingTips.total,
        draftSlips: draftSlips.total,
        publishedSlips: publishedSlips.total,
        settlementMatches: settlement.total,
        tipCounts: pendingTips.counts
    };
}

test('the performance snapshot matches the performance service exactly', async () => {
    const jar = await signedInJar();
    const before = await getPublishedPerformance('all');
    const dashboard = (await request('/api/v1/admin/dashboard', { jar })).body;
    const after = await getPublishedPerformance('all');
    const totals = [
        'totalSlips',
        'wins',
        'losses',
        'unitsStaked',
        'totalReturnUnits',
        'profitUnits',
        'roiPercentage',
        'winRatePercentage',
        'averageTotalOdds'
    ];
    const matchesSnapshot = (snapshot) => totals.every((field) => dashboard.performance[field] === snapshot[field]);

    assert.equal(dashboard.performance.range, 'all');
    assert.ok(
        matchesSnapshot(before) || matchesSnapshot(after),
        'the performance snapshot must be the service value, field for field'
    );
});

test('recent tips and slips match their services and stay limited', async () => {
    const jar = await signedInJar();
    const tipsBefore = await getTips({ limit: 5 });
    const slipsBefore = await getSlips({ limit: 5 });
    const dashboard = (await request('/api/v1/admin/dashboard', { jar })).body;
    const tipsAfter = await getTips({ limit: 5 });
    const slipsAfter = await getSlips({ limit: 5 });
    const tipIds = dashboard.recentTips.map((tip) => tip.id);
    const slipIds = dashboard.recentSlips.map((slip) => slip.id);
    const sameIds = (ids, rows) => JSON.stringify(ids) === JSON.stringify(rows.map((row) => row.id));

    assert.ok(dashboard.recentTips.length <= 5);
    assert.ok(dashboard.recentSlips.length <= 5);
    assert.ok(sameIds(tipIds, tipsBefore.tips) || sameIds(tipIds, tipsAfter.tips), 'recent tips must be the service order');
    assert.ok(sameIds(slipIds, slipsBefore.slips) || sameIds(slipIds, slipsAfter.slips), 'recent slips must be the service order');

    // Ordering: newest first for tips (created_at DESC, id DESC).
    for (let index = 1; index < tipIds.length; index += 1) {
        assert.ok(tipIds[index - 1] > tipIds[index], 'recent tips are newest first');
    }

    // Every tip carries the match details the dashboard renders.
    assert.ok(dashboard.recentTips.every((tip) => tip.match?.homeTeam && tip.match?.awayTeam));
});

test('the settlement preview matches the settlement queue and stays limited', async () => {
    const jar = await signedInJar();
    const before = await getSettlementQueue({ limit: 5 });
    const dashboard = (await request('/api/v1/admin/dashboard', { jar })).body;
    const after = await getSettlementQueue({ limit: 5 });
    const ids = dashboard.settlementQueue.map((row) => row.sourceMatchId);
    const sameIds = (rows) => JSON.stringify(ids) === JSON.stringify(rows.map((row) => row.sourceMatchId));

    assert.ok(sameIds(before.matches) || sameIds(after.matches), 'the preview must be the queue order');
    assert.ok(dashboard.settlementQueue.length <= 5);
    assert.ok(dashboard.settlementQueue.every((row) => Number(row.pendingTipCount) > 0));
});

test('loading the dashboard mutates nothing', async () => {
    const snapshot = async () => {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*)::int FROM tips) AS tips,
                (SELECT COUNT(*)::int FROM slips) AS slips,
                (SELECT COUNT(*)::int FROM slip_tips) AS slip_tips,
                (SELECT COUNT(*)::int FROM matches) AS matches,
                (SELECT COUNT(*)::int FROM users) AS users,
                (SELECT COALESCE(SUM(odds), 0) FROM tips) AS tip_odds_sum,
                (SELECT COALESCE(SUM(total_odds), 0) FROM slips) AS slip_odds_sum,
                (SELECT COALESCE(SUM(profit_units), 0) FROM slips) AS profit_sum,
                (SELECT COALESCE(SUM(return_units), 0) FROM slips) AS return_sum
        `);

        return result.rows[0];
    };

    const before = await snapshot();
    const jar = await signedInJar();

    for (let index = 0; index < 3; index += 1) {
        const response = await request('/api/v1/admin/dashboard', { jar });

        assert.equal(response.status, 200);
    }

    assert.deepEqual(await snapshot(), before, 'the dashboard must be read-only');
});

test('the dashboard code never reaches TrueOdds', async () => {
    for (const file of [
        '../src/services/dashboard-service.js',
        '../src/controllers/dashboard-controller.js',
        '../src/routes/api/admin/dashboard-routes.js',
        '../public/js/admin/dashboard.js'
    ]) {
        const source = await readFile(new URL(file, import.meta.url), 'utf8');

        for (const pattern of ['trueodds-client', '/api/trueodds', 'getTrueOdds', 'TRUEODDS']) {
            assert.equal(source.includes(pattern), false, `${file} must not use ${pattern}`);
        }
    }

    const script = await readFile(new URL('../public/js/admin/dashboard.js', import.meta.url), 'utf8');

    assert.equal((script.match(/fetch\(/g) ?? []).length, 1, 'the dashboard makes a single API call');
    assert.ok(script.includes("fetch('/api/v1/admin/dashboard'"));
});

test('the dashboard aggregation works with TrueOdds unreachable', () => {
    // A child process with a dead TrueOdds host proves the dashboard has no
    // external dependency at runtime (not just by source inspection).
    const script = `
        import app from './src/app.js';
        import pool from './src/db/postgres.js';
        import { getDashboardOverview } from './src/services/dashboard-service.js';

        const overview = await getDashboardOverview();
        console.log('summary', JSON.stringify(overview.summary));
        console.log('errors', JSON.stringify(overview.errors));

        const server = app.listen(0);
        await new Promise((resolve) => server.once('listening', resolve));
        const response = await fetch(\`http://127.0.0.1:\${server.address().port}/api/v1/admin/dashboard\`);
        console.log('dashboard route status', response.status);
        await new Promise((resolve) => server.close(resolve));
        await pool.end();
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: process.cwd(),
        env: { ...process.env, TRUEODDS_BASE_URL: 'http://127.0.0.1:9/api/v1' },
        encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /errors \{\}/, 'every widget should still load');
    assert.match(result.stdout, /"pendingTips":\d+/, 'real counts are returned without TrueOdds');
    assert.match(result.stdout, /dashboard route status 401/, 'the API stays session protected');
});
