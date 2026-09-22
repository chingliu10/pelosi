import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const { default: pool } = await import('../apps/web/src/db/postgres.js');
const { createUserAccount } = await import('../apps/web/src/services/auth-service.js');

const baseUrl = 'http://127.0.0.1:3000';
const email = `dashboard-e2e+${Date.now()}@example.test`;
const password = randomBytes(18).toString('base64url');

let cookie = null;

async function call(path, { method = 'GET', withSession = false } = {}) {
    const headers = {};

    if (withSession && cookie) headers.Cookie = cookie;

    const response = await fetch(`${baseUrl}${path}`, { method, headers, redirect: 'manual' });
    const text = await response.text();
    let payload = null;

    try {
        payload = JSON.parse(text);
    } catch {
        payload = null;
    }

    return { status: response.status, location: response.headers.get('location'), text, payload };
}

async function databaseSnapshot() {
    const counts = await pool.query(`
        SELECT
            (SELECT COUNT(*)::int FROM tips) AS tips,
            (SELECT COUNT(*)::int FROM slips) AS slips,
            (SELECT COUNT(*)::int FROM slip_tips) AS slip_tips,
            (SELECT COUNT(*)::int FROM matches) AS matches,
            (SELECT COUNT(*)::int FROM users) AS users,
            (SELECT COALESCE(SUM(odds), 0)::text FROM tips) AS tip_odds_sum,
            (SELECT COALESCE(SUM(total_odds), 0)::text FROM slips) AS slip_odds_sum,
            (SELECT COALESCE(SUM(profit_units), 0)::text FROM slips) AS profit_sum,
            (SELECT COALESCE(SUM(stake_units), 0)::text FROM slips) AS stake_sum
    `);

    return counts.rows[0];
}

console.log('== Setup: temp admin session');
const admin = await createUserAccount({ email, password });
const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
});

cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0];
console.log('login', login.status, '| session captured:', cookie.startsWith('pelosi.sid='));

console.log('\n== GET /admin and the dashboard API');
const anonymous = await call('/admin');
const page = await call('/admin', { withSession: true });
const anonymousApi = await call('/api/v1/admin/dashboard');

console.log('/admin anonymous ->', anonymous.status, anonymous.location);
console.log('/admin authenticated ->', page.status, '| bytes', page.text.length);
console.log('/api/v1/admin/dashboard anonymous ->', anonymousApi.status, JSON.stringify(anonymousApi.payload));
console.log('page bits:', {
    title: page.text.includes('<title>Dashboard · Wachimba Odds Admin</title>'),
    subtitle: page.text.includes('Overview of your betting operation.'),
    summaryCards: page.text.includes('id="summary-cards"'),
    attention: page.text.includes('Needs attention'),
    quickActions: page.text.includes('id="quick-actions"'),
    performance: page.text.includes('id="performance-snapshot"'),
    queue: page.text.includes('id="queue-preview"'),
    recentTips: page.text.includes('id="recent-tips"'),
    recentSlips: page.text.includes('id="recent-slips"'),
    navActive: /nav__link is-active" href="\/admin" aria-current="page">Dashboard<\/a>/.test(page.text),
    noDisabledNav: !page.text.includes('is-disabled" aria-disabled="true" title="Coming in a later task"')
});

const before = await databaseSnapshot();
const dashboard = await call('/api/v1/admin/dashboard', { withSession: true });
const afterThreeLoads = await (async () => {
    for (let index = 0; index < 2; index += 1) {
        await call('/api/v1/admin/dashboard', { withSession: true });
    }

    return databaseSnapshot();
})();

console.log('\n== Real dashboard payload');
console.log('summary:', JSON.stringify(dashboard.payload.summary));
console.log('tipCounts:', JSON.stringify(dashboard.payload.tipCounts));
console.log('performance:', JSON.stringify(dashboard.payload.performance));
console.log('errors:', JSON.stringify(dashboard.payload.errors));
console.log('limits:', JSON.stringify(dashboard.payload.limits));

console.log('\n== Raw database state (the numbers the dashboard must reflect)');
const tipResults = await pool.query(`
    SELECT result, COUNT(*)::int AS n FROM tips GROUP BY result ORDER BY result
`);
const slipStates = await pool.query(`
    SELECT publication_status, result, COUNT(*)::int AS n
    FROM slips
    GROUP BY publication_status, result
    ORDER BY publication_status, result
`);
const queueCount = await pool.query(`
    SELECT COUNT(DISTINCT m.id)::int AS matches
    FROM matches m
    JOIN tips t ON t.match_id = m.id AND t.result = 'pending'
`);

console.log('tips by result:', JSON.stringify(tipResults.rows));
console.log('slips by publication/result:', JSON.stringify(slipStates.rows));
console.log('settlement queue matches:', queueCount.rows[0].matches);

console.log('\n== Recent tips shown (max 5)');
console.table(dashboard.payload.recentTips.map((tip) => ({
    id: tip.id,
    match: `${tip.match.homeTeam} vs ${tip.match.awayTeam}`.slice(0, 42),
    selection: tip.selectionName,
    market: tip.marketCode,
    odds: tip.odds,
    result: tip.result,
    createdAt: tip.createdAt
})));

console.log('\n== Recent slips shown (max 5)');
console.table(dashboard.payload.recentSlips.map((slip) => ({
    id: slip.id,
    title: slip.title?.slice(0, 30),
    legs: slip.legCount,
    totalOdds: slip.totalOdds,
    publication: slip.publicationStatus,
    result: slip.result
})));

console.log('\n== Settlement queue preview shown (max 5)');
console.table(dashboard.payload.settlementQueue.map((row) => ({
    sourceMatchId: row.sourceMatchId,
    match: `${row.homeTeam} vs ${row.awayTeam}`.slice(0, 42),
    competition: row.competition,
    kickoff: row.startsAt,
    pendingTips: row.pendingTipCount,
    affectedSlips: row.affectedPendingSlipCount
})));
console.log('settlementQueueTotal:', dashboard.payload.settlementQueueTotal);

console.log('\n== Read-only proof');
console.log('snapshot before :', JSON.stringify(before));
console.log('after 3 loads   :', JSON.stringify(afterThreeLoads));
console.log('database unchanged:', JSON.stringify(before) === JSON.stringify(afterThreeLoads));

console.log('\n== Zero TrueOdds proof (child process with an unreachable TrueOdds host)');
const script = `
    import { getDashboardOverview } from './src/services/dashboard-service.js';
    import app from './src/app.js';
    import pool from './src/db/postgres.js';

    const overview = await getDashboardOverview();
    console.log('summary with TrueOdds down:', JSON.stringify(overview.summary));
    console.log('widget errors:', JSON.stringify(overview.errors));

    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(\`http://127.0.0.1:\${server.address().port}/api/v1/admin/dashboard\`);
    console.log('route status without a session:', response.status);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
`;
const isolation = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, TRUEODDS_BASE_URL: 'http://127.0.0.1:9/api/v1' },
    encoding: 'utf8'
});

console.log(isolation.stdout.trim());
console.log('child exit code:', isolation.status);

console.log('\n== cleanup: temp admin');
await pool.query(`DELETE FROM session WHERE sess -> 'user' ->> 'id' = $1`, [String(admin.id)]);
const deletedAdmin = await pool.query('DELETE FROM users WHERE email = $1 RETURNING id', [email]);

console.log('deleted temp admin:', deletedAdmin.rowCount === 1);

await pool.end();
