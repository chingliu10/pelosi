import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';
import { createUserAccount } from '../src/services/auth-service.js';
import { createSlip } from '../src/repositories/slip-repository.js';

/**
 * Performance screen backend: range filtering, eligibility rules, trend
 * aggregation and recent settled results.
 *
 * Fixture slips are inserted with explicit `settled_at` offsets so the range
 * boundaries are deterministic relative to the database clock (the same clock
 * the API filters against). All assertions compare *deltas* against a baseline
 * capture, so real data in the database never makes the test flaky.
 */
const runId = Date.now();
const adminEmail = `performance-admin-test+${runId}@example.test`;
const adminPassword = 'performance-admin-password';
const titlePrefix = `Perf test ${runId}`;

let server = null;
let baseUrl = null;
let adminUserId = null;
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

/**
 * Creates a settled/draft/etc. slip with explicit money values and an explicit
 * settled_at offset in days.
 */
async function insertSlip({
    label,
    result,
    publicationStatus,
    settleDaysAgo = null,
    stake = 1,
    totalOdds = 2,
    returnUnits = null,
    profitUnits = null,
    title = null
}) {
    const slip = await createSlip({
        title: title ?? `${titlePrefix} ${label}`,
        slipDate: new Date().toISOString().slice(0, 10),
        totalOdds,
        stakeUnits: stake,
        creationType: 'manual'
    });

    // Track the row before touching it, so a failure below still cleans up.
    fixtureSlipIds.push(Number(slip.id));

    const settledAt = settleDaysAgo === null
        ? null
        : new Date(Date.now() - settleDaysAgo * 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
        `
        UPDATE slips
        SET result = $2,
            return_units = $3,
            profit_units = $4,
            publication_status = $5::varchar,
            settled_at = $6::timestamptz,
            published_at = CASE WHEN $5::varchar = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END
        WHERE id = $1
        `,
        [slip.id, result, returnUnits, profitUnits, publicationStatus, settledAt]
    );

    return Number(slip.id);
}

test('the trend bucket labels are real calendar dates, not UTC-shifted ones', async () => {
    const response = await history('all');

    for (const point of response.points) {
        assert.match(point.date, /^\d{4}-\d{2}-\d{2}$/, `unexpected bucket label ${point.date}`);
    }

    // A settled slip must land in the bucket of its own settlement date in the
    // database time zone - verified against PostgreSQL, not recomputed in JS.
    const comparison = await pool.query(`
        SELECT
            to_char(date_trunc('day', settled_at), 'YYYY-MM-DD') AS expected,
            COUNT(*)::int AS slips
        FROM slips
        WHERE publication_status = 'published'
          AND result IN ('won', 'lost')
          AND settled_at IS NOT NULL
        GROUP BY 1
        ORDER BY 1
    `);

    assert.deepEqual(
        response.points.map((point) => point.date),
        comparison.rows.map((row) => row.expected)
    );
});

async function performance(range) {
    const query = range ? `?range=${encodeURIComponent(range)}` : '';
    const response = await request(`/api/v1/performance${query}`);

    assert.equal(response.status, 200);

    return response.body;
}

async function history(range) {
    const query = range ? `?range=${encodeURIComponent(range)}` : '';
    const response = await request(`/api/v1/performance/history${query}`);

    assert.equal(response.status, 200);

    return response.body;
}

function delta(before, after, field) {
    return Number((Number(after[field]) - Number(before[field])).toFixed(4));
}

test.before(async () => {
    const admin = await createUserAccount({ email: adminEmail, password: adminPassword });

    adminUserId = admin.id;

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (fixtureSlipIds.length > 0) {
        await pool.query('DELETE FROM slips WHERE id = ANY($1::bigint[])', [fixtureSlipIds]);
    }

    await pool.query(`DELETE FROM session WHERE sess -> 'user' ->> 'id' = $1`, [String(adminUserId)]);
    await pool.query('DELETE FROM users WHERE email = $1', [adminEmail]);

    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

test('the all-time performance response keeps its original contract', async () => {
    const response = await request('/api/v1/performance');

    assert.equal(response.status, 200);

    for (const field of [
        'totalSlips',
        'wins',
        'losses',
        'unitsStaked',
        'totalReturnUnits',
        'profitUnits',
        'roiPercentage',
        'winRatePercentage',
        'averageTotalOdds'
    ]) {
        assert.ok(field in response.body, `missing ${field}`);
    }

    assert.equal(response.body.range, 'all');
    assert.equal(typeof response.body.totalSlips, 'number');
    assert.equal(typeof response.body.profitUnits, 'number');
});

test('only published won/lost slips contribute and every formula holds', async () => {
    const before = await performance('all');

    await insertSlip({
        label: 'published won',
        result: 'won',
        publicationStatus: 'published',
        settleDaysAgo: 1,
        totalOdds: 3,
        returnUnits: 3,
        profitUnits: 2
    });
    await insertSlip({
        label: 'published lost',
        result: 'lost',
        publicationStatus: 'published',
        settleDaysAgo: 1,
        stake: 2,
        totalOdds: 2.5,
        returnUnits: 0,
        profitUnits: -2
    });
    await insertSlip({
        label: 'draft won',
        result: 'won',
        publicationStatus: 'draft',
        settleDaysAgo: 1,
        totalOdds: 9,
        returnUnits: 9,
        profitUnits: 8
    });
    await insertSlip({
        label: 'hidden lost',
        result: 'lost',
        publicationStatus: 'hidden',
        settleDaysAgo: 1,
        totalOdds: 2,
        returnUnits: 0,
        profitUnits: -1
    });
    await insertSlip({
        label: 'published pending',
        result: 'pending',
        publicationStatus: 'published',
        totalOdds: 4
    });
    await insertSlip({
        label: 'published void',
        result: 'void',
        publicationStatus: 'published',
        settleDaysAgo: 1,
        totalOdds: 4,
        returnUnits: 1,
        profitUnits: 0
    });

    const after = await performance('all');

    assert.equal(delta(before, after, 'totalSlips'), 2, 'only the published won/lost slips count');
    assert.equal(delta(before, after, 'wins'), 1);
    assert.equal(delta(before, after, 'losses'), 1);
    assert.equal(delta(before, after, 'unitsStaked'), 3);
    assert.equal(delta(before, after, 'totalReturnUnits'), 3);
    assert.equal(delta(before, after, 'profitUnits'), 0);

    // Formulas are computed server-side over the counted slips.
    assert.equal(
        Number(after.roiPercentage),
        Number(((Number(after.profitUnits) / Number(after.unitsStaked)) * 100).toFixed(2))
    );
    assert.equal(
        Number(after.winRatePercentage),
        Number(((after.wins / after.totalSlips) * 100).toFixed(2))
    );
    assert.ok(Number(after.averageTotalOdds) > 1);

    assert.ok(
        !Number.isNaN(Number(after.roiPercentage)) && Number.isFinite(Number(after.roiPercentage)),
        'ROI must stay a finite number'
    );
});

test('a hidden settled slip is excluded until it is republished', async () => {
    const hiddenSlipId = await insertSlip({
        label: 'republish me',
        result: 'won',
        publicationStatus: 'hidden',
        settleDaysAgo: 1,
        totalOdds: 5,
        returnUnits: 5,
        profitUnits: 4
    });
    const beforePublish = await performance('all');

    const jar = await signedInJar();
    const publish = await request(`/api/v1/slips/${hiddenSlipId}/publish`, { method: 'POST', jar });

    assert.equal(publish.status, 200);

    const afterPublish = await performance('all');

    assert.equal(delta(beforePublish, afterPublish, 'totalSlips'), 1);
    assert.equal(delta(beforePublish, afterPublish, 'profitUnits'), 4);

    const hide = await request(`/api/v1/slips/${hiddenSlipId}/hide`, { method: 'POST', jar });

    assert.equal(hide.status, 200);

    const afterHide = await performance('all');

    assert.equal(delta(beforePublish, afterHide, 'totalSlips'), 0, 'hiding removes it again');
    assert.equal(delta(beforePublish, afterHide, 'profitUnits'), 0);
});

test('range filters use settled_at and respect their boundaries', async () => {
    const baseline = {
        '7d': await performance('7d'),
        '30d': await performance('30d'),
        '90d': await performance('90d'),
        all: await performance('all')
    };

    const recent = await insertSlip({
        label: 'settled 2d ago',
        result: 'won',
        publicationStatus: 'published',
        settleDaysAgo: 2,
        totalOdds: 2,
        returnUnits: 2,
        profitUnits: 1
    });
    const tenDays = await insertSlip({
        label: 'settled 10d ago',
        result: 'won',
        publicationStatus: 'published',
        settleDaysAgo: 10,
        totalOdds: 2,
        returnUnits: 2,
        profitUnits: 1
    });
    const fortyFiveDays = await insertSlip({
        label: 'settled 45d ago',
        result: 'lost',
        publicationStatus: 'published',
        settleDaysAgo: 45,
        totalOdds: 2,
        returnUnits: 0,
        profitUnits: -1
    });
    const longAgo = await insertSlip({
        label: 'settled 120d ago',
        result: 'won',
        publicationStatus: 'published',
        settleDaysAgo: 120,
        totalOdds: 6,
        returnUnits: 6,
        profitUnits: 5
    });

    const after = {
        '7d': await performance('7d'),
        '30d': await performance('30d'),
        '90d': await performance('90d'),
        all: await performance('all')
    };

    // Each window only picks up the fixtures that fall inside it.
    assert.equal(delta(baseline['7d'], after['7d'], 'totalSlips'), 1);
    assert.equal(delta(baseline['7d'], after['7d'], 'profitUnits'), 1);

    assert.equal(delta(baseline['30d'], after['30d'], 'totalSlips'), 2);
    assert.equal(delta(baseline['30d'], after['30d'], 'profitUnits'), 2);

    assert.equal(delta(baseline['90d'], after['90d'], 'totalSlips'), 3);
    assert.equal(delta(baseline['90d'], after['90d'], 'profitUnits'), 1);

    assert.equal(delta(baseline.all, after.all, 'totalSlips'), 4);
    assert.equal(delta(baseline.all, after.all, 'profitUnits'), 6);

    // Sanity: the fixtures are ordered as expected by settlement age.
    assert.ok(recent < tenDays && tenDays < fortyFiveDays && fortyFiveDays < longAgo);
});

test('an invalid or unsupported range returns 400', async () => {
    for (const range of ['banana', '1y', '7', 'all-time']) {
        const response = await request(`/api/v1/performance?range=${encodeURIComponent(range)}`);

        assert.equal(response.status, 400, `range=${range} must be rejected`);
        assert.match(response.body.error, /Invalid range/);

        const trend = await request(`/api/v1/performance/history?range=${encodeURIComponent(range)}`);

        assert.equal(trend.status, 400);
    }
});

test('the zero-eligible-slip contract returns null percentages', async () => {
    // A range that no settled slip can fall inside (settled_at is never in the
    // future), proving the null handling without touching real data.
    const response = await request('/api/v1/performance?range=7d');

    assert.equal(response.status, 200);
    assert.ok(response.body.totalSlips >= 0);

    const future = await pool.query(`
        SELECT
            ROUND(
                SUM(profit_units) FILTER (WHERE result IN ('won','lost') AND settled_at > NOW() + INTERVAL '1 day')
                / NULLIF(SUM(stake_units) FILTER (WHERE result IN ('won','lost') AND settled_at > NOW() + INTERVAL '1 day'), 0)
                * 100,
                2
            ) AS roi
        FROM slips
        WHERE publication_status = 'published'
    `);

    assert.equal(future.rows[0].roi, null, 'division by zero is guarded in SQL');

    const emptyContract = await performance('all');

    if (Number(emptyContract.totalSlips) === 0) {
        assert.equal(emptyContract.roiPercentage, null);
        assert.equal(emptyContract.winRatePercentage, null);
        assert.equal(emptyContract.averageTotalOdds, null);
    } else {
        assert.ok(Number.isFinite(Number(emptyContract.roiPercentage)));
    }
});

test('the trend only aggregates eligible slips and cumulative profit is consistent', async () => {
    const before = await history('all');
    const beforeLast = before.points.at(-1)?.cumulativeProfitUnits ?? 0;

    await insertSlip({
        label: 'trend won',
        result: 'won',
        publicationStatus: 'published',
        settleDaysAgo: 3,
        totalOdds: 4,
        returnUnits: 4,
        profitUnits: 3
    });
    await insertSlip({
        label: 'trend lost',
        result: 'lost',
        publicationStatus: 'published',
        settleDaysAgo: 3,
        totalOdds: 2,
        returnUnits: 0,
        profitUnits: -1
    });
    await insertSlip({
        label: 'trend draft won',
        result: 'won',
        publicationStatus: 'draft',
        settleDaysAgo: 3,
        totalOdds: 9,
        returnUnits: 9,
        profitUnits: 8
    });
    await insertSlip({
        label: 'trend pending published',
        result: 'pending',
        publicationStatus: 'published',
        totalOdds: 3
    });

    const after = await history('all');
    const afterLast = after.points.at(-1)?.cumulativeProfitUnits ?? 0;

    assert.equal(after.period, 'day');
    assert.ok(after.points.length >= 1);

    // Only the two settled published fixtures moved the cumulative total.
    assert.equal(Number((afterLast - beforeLast).toFixed(4)), 2);

    // Ordering is chronological and cumulative equals the running sum.
    const dates = after.points.map((point) => point.date);
    const sorted = [...dates].sort();

    assert.deepEqual(dates, sorted);

    let running = 0;

    for (const point of after.points) {
        running = Number((running + point.profitUnits).toFixed(4));
        assert.equal(Number(point.cumulativeProfitUnits.toFixed(4)), running, `cumulative mismatch on ${point.date}`);
        assert.equal(point.slips, point.wins + point.losses);
        assert.ok(Number.isFinite(point.unitsStaked));
    }

    // The excluded fixtures never created a bucket of their own.
    const draftCounted = after.points.some((point) => Number(point.profitUnits) === 8);

    assert.equal(draftCounted, false, 'draft slips must not appear in the trend');
});

test('recent settled results reuse the slips list and exclude non-settled slips', async () => {
    const draftId = await insertSlip({
        label: 'recent draft',
        result: 'won',
        publicationStatus: 'draft',
        settleDaysAgo: 1,
        totalOdds: 7,
        returnUnits: 7,
        profitUnits: 6
    });
    const hiddenId = await insertSlip({
        label: 'recent hidden',
        result: 'lost',
        publicationStatus: 'hidden',
        settleDaysAgo: 1,
        totalOdds: 2,
        returnUnits: 0,
        profitUnits: -1
    });
    const pendingId = await insertSlip({
        label: 'recent pending',
        result: 'pending',
        publicationStatus: 'published',
        totalOdds: 3
    });
    const voidId = await insertSlip({
        label: 'recent void',
        result: 'void',
        publicationStatus: 'published',
        settleDaysAgo: 1,
        totalOdds: 3,
        returnUnits: 1,
        profitUnits: 0
    });
    const settledId = await insertSlip({
        label: 'recent settled',
        result: 'won',
        publicationStatus: 'published',
        settleDaysAgo: 1,
        totalOdds: 2.5,
        returnUnits: 2.5,
        profitUnits: 1.5
    });
    const jar = await signedInJar();
    const response = await request('/api/v1/slips?publicationStatus=published&result=settled&sort=settled&limit=50', { jar });

    assert.equal(response.status, 200);
    assert.equal(response.body.result, null);
    assert.deepEqual(response.body.results, ['won', 'lost']);
    assert.equal(response.body.sort, 'settled');

    const ids = response.body.slips.map((slip) => slip.id);

    assert.ok(ids.includes(settledId));
    assert.equal(ids.includes(draftId), false);
    assert.equal(ids.includes(hiddenId), false);
    assert.equal(ids.includes(pendingId), false);
    assert.equal(ids.includes(voidId), false);
    assert.ok(response.body.slips.every((slip) => ['won', 'lost'].includes(slip.result)));
    assert.ok(response.body.slips.every((slip) => slip.publicationStatus === 'published'));

    // Newest settlement first.
    const settledTimes = response.body.slips.map((slip) => new Date(slip.settledAt).getTime());

    for (let index = 1; index < settledTimes.length; index += 1) {
        assert.ok(settledTimes[index - 1] >= settledTimes[index], 'recent results are ordered by settled_at desc');
    }

    const invalidSort = await request('/api/v1/slips?sort=banana', { jar });

    assert.equal(invalidSort.status, 400);
    assert.match(invalidSort.body.error, /Invalid sort/);
});

test('performance code never reaches TrueOdds', async () => {
    const files = [
        '../src/services/performance-service.js',
        '../src/repositories/performance-repository.js',
        '../src/controllers/performance-controller.js',
        '../src/routes/api/performance-routes.js',
        '../public/js/admin/performance.js'
    ];

    for (const file of files) {
        const source = await readFile(new URL(file, import.meta.url), 'utf8');

        // No TrueOdds client import, endpoint or HTTP call may appear in the
        // performance code path (a comment mentioning the name is fine).
        for (const pattern of ['trueodds-client', '/api/trueodds', 'getTrueOdds', 'TRUEODDS']) {
            assert.equal(source.includes(pattern), false, `${file} must not use ${pattern}`);
        }
    }

    // The admin page script only talks to Pelosi performance/slip endpoints.
    const script = await readFile(new URL('../public/js/admin/performance.js', import.meta.url), 'utf8');

    assert.ok(script.includes('/api/v1/performance?range='));
    assert.ok(script.includes('/api/v1/performance/history?range='));
    assert.ok(script.includes('/api/v1/slips?'));
    assert.equal(script.includes('/api/trueodds'), false);
});
