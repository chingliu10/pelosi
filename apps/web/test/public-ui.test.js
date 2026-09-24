import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';

let server = null;
let baseUrl = null;

async function request(path) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
    const text = await response.text();

    return {
        status: response.status,
        location: response.headers.get('location'),
        text
    };
}

test.before(async () => {
    process.env.APP_TIMEZONE = 'UTC';
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

test('GET / renders the public homepage and /tips redirects to /slips', async () => {
    const home = await request('/');
    const tips = await request('/tips?date=2031-06-15');
    const slips = await request('/slips');

    assert.equal(home.status, 200);
    assert.equal(home.location, null);
    assert.match(home.text, /<title>Football Betting Slips &amp; Performance \| Wachimba Odds<\/title>/);
    assert.match(home.text, /href="\/" aria-label="Wachimba Odds home"/);
    assert.match(home.text, /aria-current="page">Home<\/a>/);
    assert.match(home.text, /Smarter football selections/);
    assert.match(home.text, /href="\/slips">View Today(?:'|&#x27;)s Slips<\/a>/);
    assert.match(home.text, /href="\/performance">View Performance<\/a>/);
    assert.match(home.text, /id="home-slips-grid"/);
    assert.match(home.text, /id="home-performance-metrics"/);
    assert.match(home.text, /id="home-history-list"/);
    assert.match(home.text, /How Wachimba Odds Works/);
    assert.match(home.text, /Transparent by design/);
    assert.equal(tips.status, 302);
    assert.equal(tips.location, '/slips');
    assert.equal(slips.status, 200);
    assert.match(slips.text, /<title>Today&#x27;s Slips \| Wachimba Odds<\/title>/);
    assert.match(slips.text, /class="site-header"/);
    assert.match(slips.text, /Today's Slips/);
    assert.match(slips.text, /aria-current="page">Today&#x27;s Slips<\/a>/);
    assert.match(slips.text, /id="slips-grid"/);
    assert.match(slips.text, /id="slip-detail"/);
    assert.match(slips.text, /data-result-filter="pending"/);
    assert.match(slips.text, /id="slips-loading"/);
    assert.match(slips.text, /id="slips-empty"/);
    assert.match(slips.text, /id="slips-error"/);
});

test('GET /slips/:id renders the public slip detail shell', async () => {
    const response = await request('/slips/123');

    assert.equal(response.status, 200);
    assert.match(response.text, /data-slip-id="123"/);
    assert.match(response.text, /id="slip-detail"/);
    assert.match(response.text, /Loading slip/);
});

test('GET /performance renders the public performance shell with active navigation', async () => {
    const response = await request('/performance?range=30d');

    assert.equal(response.status, 200);
    assert.match(response.text, /<title>Performance \| Wachimba Odds<\/title>/);
    assert.match(response.text, /aria-current="page">Performance<\/a>/);
    assert.match(response.text, /id="performance-metrics"/);
    assert.match(response.text, /id="trend-chart"/);
    assert.match(response.text, /id="breakdown-panel"/);
    assert.match(response.text, /id="recent-results"/);
    assert.match(response.text, /Loading performance/);
    assert.match(response.text, /Loading trend/);
});

test('GET /history renders the public history shell with active navigation', async () => {
    const response = await request('/history?result=won');

    assert.equal(response.status, 200);
    assert.match(response.text, /<title>History \| Wachimba Odds<\/title>/);
    assert.match(response.text, /aria-current="page">History<\/a>/);
    assert.match(response.text, /id="history-list"/);
    assert.match(response.text, /id="history-pager"/);
    assert.match(response.text, /data-result-filter="pending"/);
    assert.match(response.text, /Loading history/);
});

test('public tips browser script calls only the public tips API', async () => {
    const script = await readFile(new URL('../public/js/public/tips.js', import.meta.url), 'utf8');

    assert.match(script, /\/api\/v1\/public\/tips/);
    assert.doesNotMatch(script, /\/api\/v1\/tips(?![A-Za-z/-])/);
    assert.doesNotMatch(script, /\/api\/trueodds/);
    assert.doesNotMatch(script, /TRUEODDS/);
});

test('public slips browser script calls only the public slips API', async () => {
    const script = await readFile(new URL('../public/js/public/slips.js', import.meta.url), 'utf8');
    const layout = await readFile(new URL('../views/layouts/public.hbs', import.meta.url), 'utf8');

    assert.match(script, /\/api\/v1\/public\/slips/);
    assert.doesNotMatch(script, /\/api\/v1\/slips(?![A-Za-z/-])/);
    assert.doesNotMatch(script, /\/api\/v1\/admin/);
    assert.doesNotMatch(script, /\/api\/trueodds/);
    assert.doesNotMatch(script, /TRUEODDS/);
    assert.match(layout, /href="\/slips"/);
    assert.doesNotMatch(layout, /href="\/tips"/);
});

test('public performance browser script reuses public APIs and has chart states', async () => {
    const script = await readFile(new URL('../public/js/public/performance.js', import.meta.url), 'utf8');

    assert.match(script, /\/api\/v1\/performance\?range=/);
    assert.match(script, /\/api\/v1\/performance\/history\?range=/);
    assert.match(script, /\/api\/v1\/public\/slips\?scope=history/);
    assert.match(script, /role: 'img'/);
    assert.match(script, /Cumulative profit/);
    assert.match(script, /Not enough settled slips for a trend yet/);
    assert.match(script, /No published settled slips yet/);
    assert.match(script, /\/slips\/\$\{encodeURIComponent\(slip.id\)\}/);
    assert.doesNotMatch(script, /\/api\/trueodds/);
    assert.doesNotMatch(script, /TRUEODDS/);
    assert.doesNotMatch(script, /\/api\/v1\/slips/);
});

test('public history browser script uses public slips, filters and pagination', async () => {
    const script = await readFile(new URL('../public/js/public/history.js', import.meta.url), 'utf8');

    assert.match(script, /scope: 'history'/);
    assert.match(script, /sort: 'published'/);
    assert.match(script, /limit: String\(state.limit\)/);
    assert.match(script, /offset: String\(state.offset\)/);
    assert.match(script, /No \$\{result\} slips found/);
    assert.match(script, /\+ \$\{hiddenCount\} more selection/);
    assert.match(script, /\/slips\/\$\{encodeURIComponent\(slip.id\)\}/);
    assert.doesNotMatch(script, /\/api\/trueodds/);
    assert.doesNotMatch(script, /TRUEODDS/);
    assert.doesNotMatch(script, /\/api\/v1\/slips/);
});

test('public homepage browser script uses public APIs with isolated states', async () => {
    const script = await readFile(new URL('../public/js/public/home.js', import.meta.url), 'utf8');
    const view = await readFile(new URL('../views/public/home.hbs', import.meta.url), 'utf8');
    const css = await readFile(new URL('../public/css/public.css', import.meta.url), 'utf8');
    const combined = `${script}\n${view}`;

    assert.match(script, /\/api\/v1\/public\/slips\?limit=3/);
    assert.match(script, /\/api\/v1\/performance\?range=all/);
    assert.match(script, /\/api\/v1\/public\/slips\?scope=history&sort=published&limit=5/);
    assert.match(script, /\/slips\/\$\{encodeURIComponent\(slip.id\)\}/);
    assert.match(script, /\+ \$\{hiddenCount\} more selection/);
    assert.match(script, /formatSignedUnits/);
    assert.match(script, /formatSignedPercent/);
    assert.match(view, /Loading today's slips/);
    assert.match(view, /Loading performance/);
    assert.match(view, /Loading recent results/);
    assert.match(view, /No slips have been published for today yet/);
    assert.match(view, /No settled public slips yet/);
    assert.match(view, /No published history yet/);
    assert.match(view, /temporarily unavailable/);
    assert.match(css, /home-hero/);
    assert.match(css, /home-card-grid/);
    assert.match(css, /home-steps/);
    assert.doesNotMatch(combined, /\/api\/trueodds/);
    assert.doesNotMatch(combined, /TRUEODDS/);
    assert.doesNotMatch(combined, /\/api\/v1\/admin/);
    assert.doesNotMatch(combined, /\/api\/v1\/tips/);
    assert.doesNotMatch(combined, /\/api\/v1\/slips/);
    assert.doesNotMatch(view, /Pelosi/);
    assert.doesNotMatch(view, /TrueOdds/);

    for (const forbidden of ['Guaranteed', 'Sure bets', '100% win', 'Risk free', 'Beat the bookmaker', 'Never lose']) {
        assert.equal(combined.includes(forbidden), false, `${forbidden} should not appear on the homepage`);
    }
});

test('public slips UI includes product labels, filters, anchors and safe states', async () => {
    const script = await readFile(new URL('../public/js/public/slips.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../public/css/public.css', import.meta.url), 'utf8');
    const view = await readFile(new URL('../views/public/slips.hbs', import.meta.url), 'utf8');

    for (const label of ['Single', 'Double', 'Treble', 'Fold Accumulator']) {
        assert.match(script, new RegExp(label));
    }

    for (const result of ['all', 'pending', 'won', 'lost', 'void']) {
        assert.match(view, new RegExp(`data-result-filter="${result}"`));
    }

    assert.match(script, /Loading slips/);
    assert.match(script, /Loading slip/);
    assert.match(script, /No slips have been published for this date yet/);
    assert.match(script, /Slip not found/);
    assert.match(script, /\+ \$\{hiddenCount\} more selection/);
    assert.match(script, /detailUrl/);
    assert.match(script, /href = detailUrl/);
    assert.match(script, /Final score/);
    assert.match(script, /Combined odds/);
    assert.match(script, /Total odds/);
    assert.match(css, /selection-row/);
    assert.match(css, /slip-detail/);
    assert.match(css, /grid-template-columns: 1fr/);
});

test('result tabs, odds formatting and visual states are present', async () => {
    const script = await readFile(new URL('../public/js/public/tips.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../public/css/public.css', import.meta.url), 'utf8');
    const view = await readFile(new URL('../views/public/tips.hbs', import.meta.url), 'utf8');

    for (const result of ['all', 'pending', 'won', 'lost', 'void']) {
        assert.match(view, new RegExp(`data-result-filter="${result}"`));
    }

    assert.match(script, /toFixed\(2\)/);

    for (const state of ['pending', 'won', 'lost', 'void']) {
        assert.match(css, new RegExp(`status-pill--${state}`));
    }
});

test('mobile navigation is accessible and responsive classes exist', async () => {
    const layout = await readFile(new URL('../views/layouts/public.hbs', import.meta.url), 'utf8');
    const script = await readFile(new URL('../public/js/public/site.js', import.meta.url), 'utf8');
    const css = await readFile(new URL('../public/css/public.css', import.meta.url), 'utf8');

    assert.match(layout, /aria-expanded="false"/);
    assert.match(layout, /aria-controls="public-nav"/);
    assert.match(layout, /aria-label="Public sections"/);
    assert.match(layout, /<footer class="site-footer">/);
    assert.match(script, /aria-expanded/);
    assert.match(script, /Escape/);
    assert.match(css, /@media \(max-width: 980px\)/);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.match(css, /grid-template-columns: repeat\(3/);
    assert.match(css, /metric-grid/);
    assert.match(css, /public-analytics/);
    assert.match(css, /history-card/);
    assert.match(css, /site-footer/);
});

test('public UI does not hard-code source IDs or fabricated analysis content', async () => {
    const script = await readFile(new URL('../public/js/public/tips.js', import.meta.url), 'utf8');
    const view = await readFile(new URL('../views/public/tips.hbs', import.meta.url), 'utf8');
    const combined = `${script}\n${view}`;

    for (const forbidden of [
        'sourceOddsId',
        'sourceMarketId',
        'sourceSelectionId',
        'Confidence',
        '87%',
        'Risk level',
        'recommended stake',
        'Guaranteed',
        '100% sure',
        'Bet now',
        'Place bet'
    ]) {
        assert.equal(combined.includes(forbidden), false, `${forbidden} should not be hard-coded`);
    }
});
