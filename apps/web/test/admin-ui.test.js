import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';
import { createUserAccount } from '../src/services/auth-service.js';

/**
 * Admin UI tests: server-rendered pages, session protection and static assets.
 *
 * These tests never call TrueOdds. The create-tip page is a shell; its data
 * calls happen in the browser against the existing Pelosi API, so the test
 * asserts the page/JS wiring instead of making live API requests.
 */
const email = `admin-ui-test+${Date.now()}@example.test`;
const password = 'admin-ui-test-password';
const cookieName = process.env.SESSION_COOKIE_NAME || 'pelosi.sid';

let server = null;
let baseUrl = null;
let userId = null;

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

                if (separator === -1) continue;

                cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
            }
        }
    };
}

async function request(path, { method = 'GET', jar, body } = {}) {
    const headers = {};

    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (jar?.header()) headers.Cookie = jar.header();

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });

    if (jar) {
        jar.store(response);
    }

    return {
        status: response.status,
        location: response.headers.get('location'),
        contentType: response.headers.get('content-type'),
        text: await response.text()
    };
}

function assetPath(relativePath) {
    return new URL(relativePath, import.meta.url);
}

async function readAsset(relativePath) {
    return readFile(assetPath(relativePath), 'utf8');
}

function elementIdsUsedBy(script) {
    return [...new Set(
        [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1])
    )];
}

async function signedInJar() {
    const jar = createCookieJar();
    const response = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
        jar
    });

    assert.equal(response.status, 200);

    return jar;
}

test.before(async () => {
    const user = await createUserAccount({ email, password });

    userId = user.id;

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await pool.query(`DELETE FROM session WHERE sess -> 'user' ->> 'id' = $1`, [String(userId)]);
    await pool.query('DELETE FROM users WHERE email = $1', [email]);

    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

test('anonymous browsers are redirected from the admin page to sign in', async () => {
    const response = await request('/admin/tips/new');

    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin/login?next=%2Fadmin%2Ftips%2Fnew');

    const root = await request('/admin');

    assert.equal(root.status, 302);
    assert.equal(root.location, '/admin/login?next=%2Fadmin');
});

test('the sign-in page renders the session login form', async () => {
    const response = await request('/admin/login');

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);
    assert.ok(response.text.includes('id="login-form"'));
    assert.ok(response.text.includes('id="login-email"'));
    assert.ok(response.text.includes('id="login-password"'));
    assert.ok(response.text.includes('data-next="/admin"'));
    assert.ok(response.text.includes('/js/admin/login.js'));
    assert.ok(response.text.includes('/css/admin.css'));
});

test('the sign-in page only redirects to admin paths', async () => {
    const response = await request('/admin/login?next=https://evil.example/phish');

    assert.equal(response.status, 200);
    assert.ok(response.text.includes('data-next="/admin"'));
    assert.ok(!response.text.includes('evil.example'));
});

test('signed-in admins are sent straight from sign-in to the dashboard', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/login', { jar });

    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin');
});

test('the create tip page renders the full workflow shell', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/tips/new', { jar });

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);

    // Page header
    assert.ok(response.text.includes('<title>Create tip · PELOSI Admin</title>'));
    assert.ok(response.text.includes('Create tip'));
    assert.ok(response.text.includes('Search TrueOdds, choose a match and import one betting selection.'));

    // Admin shell: navigation with Tips active, other sections inert
    for (const label of ['Dashboard', 'Tips', 'Slips', 'Settlement', 'Performance']) {
        assert.ok(response.text.includes(label), `nav is missing ${label}`);
    }

    assert.match(response.text, /nav__link is-active" href="\/admin\/tips" aria-current="page"/);
    assert.ok(response.text.includes(email), 'account menu shows the signed-in admin');

    // Workflow pieces
    assert.ok(response.text.includes('id="search-form"'));
    assert.ok(response.text.includes('for="search-input"'));
    assert.ok(response.text.includes('Search team or match...'));
    assert.ok(response.text.includes('id="market-tabs"'));
    assert.ok(response.text.includes('Selected tip'));
    assert.ok(response.text.includes('/js/admin/create-tip.js'));
});

test('the browser code talks to the existing Pelosi API, never to TrueOdds', async () => {
    const response = await request('/js/admin/create-tip.js');

    assert.equal(response.status, 200);
    assert.match(response.contentType, /javascript/);
    assert.ok(response.text.includes('/api/trueodds/matches/search?q='));
    assert.ok(response.text.includes('/api/trueodds/matches/'));
    assert.ok(response.text.includes('/api/trueodds/tips/import'));
    assert.ok(response.text.includes('sourceOddsId'));
    assert.ok(response.text.includes('credentials: \'same-origin\''));
    assert.ok(!/https?:\/\//.test(response.text), 'browser code must not call external hosts');
});

test('the TrueOdds API key is never sent to the browser', async () => {
    const jar = await signedInJar();
    const apiKey = process.env.TRUEODDSAPIKEY;
    const payloads = [
        (await request('/admin/tips/new', { jar })).text,
        (await request('/admin/login')).text,
        (await request('/js/admin/create-tip.js')).text,
        (await request('/js/admin/login.js')).text,
        (await request('/css/admin.css')).text
    ];

    for (const payload of payloads) {
        assert.equal(payload.includes('TRUEODDSAPIKEY'), false);
        assert.equal(payload.includes('Bearer'), false);

        if (apiKey) {
            assert.equal(payload.includes(apiKey), false);
        }
    }
});

test('static admin assets are served', async () => {
    const css = await request('/css/admin.css');
    const createTipJs = await request('/js/admin/create-tip.js');
    const loginJs = await request('/js/admin/login.js');

    assert.equal(css.status, 200);
    assert.match(css.contentType, /text\/css/);
    assert.equal(createTipJs.status, 200);
    assert.match(createTipJs.contentType, /javascript/);
    assert.equal(loginJs.status, 200);
    assert.match(loginJs.contentType, /javascript/);
});

test('signing out from the admin shell destroys the session', async () => {
    const jar = await signedInJar();
    const logout = await request('/admin/logout', { method: 'POST', jar });

    assert.equal(logout.status, 302);
    assert.equal(logout.location, '/admin/login');

    const page = await request('/admin/tips/new', { jar });

    assert.equal(page.status, 302);
    assert.equal(page.location, '/admin/login?next=%2Fadmin%2Ftips%2Fnew');
});

test('the cookie name used by the UI matches the configured session cookie', async () => {
    const jar = await signedInJar();

    assert.ok(jar.header().startsWith(`${cookieName}=`));
});

test('every element id the create tip script uses exists in the rendered page', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin/tips/new', { jar })).text;
    const script = await readAsset('../public/js/admin/create-tip.js');
    const ids = elementIdsUsedBy(script);

    assert.ok(ids.length >= 10, 'the script should bind to the page elements');

    for (const id of ids) {
        assert.ok(html.includes(`id="${id}"`), `rendered page is missing id="${id}"`);
    }
});

test('anonymous browsers are redirected from the tips manager to sign in', async () => {
    const response = await request('/admin/tips');

    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin/login?next=%2Fadmin%2Ftips');
});

test('the tips manager renders with its header, action and panels', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/tips', { jar });

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);
    assert.ok(response.text.includes('<title>Tips · PELOSI Admin</title>'));
    assert.ok(response.text.includes('Review imported predictions and their settlement status.'));
    assert.ok(response.text.includes('+ Create tip'));
    assert.ok(response.text.includes('href="/admin/tips/new"'));
    assert.ok(response.text.includes('id="tips-search-input"'));
    assert.ok(response.text.includes('Search match, team or prediction...'));
    assert.ok(response.text.includes('id="tips-filters"'));
    assert.ok(response.text.includes('id="tips-empty"'));
    assert.ok(response.text.includes('id="tips-pager"'));
    assert.ok(response.text.includes('Tip details'));
    assert.ok(response.text.includes('/js/admin/tips.js'));
    assert.ok(response.text.includes(email));
});

test('the Tips nav item is functional and active on both tips pages', async () => {
    const jar = await signedInJar();

    for (const path of ['/admin/tips', '/admin/tips/new']) {
        const html = (await request(path, { jar })).text;

        assert.match(
            html,
            /nav__link is-active" href="\/admin\/tips" aria-current="page">Tips<\/a>/,
            `${path} should mark Tips as the active section`
        );
        assert.ok(!html.includes('nav__link is-disabled" aria-disabled="true" title="Coming in a later task">Tips'));
    }

    const disabled = (await request('/admin/tips', { jar })).text;

    // Every main nav item is now a real link - no disabled placeholders remain.
    assert.equal(
        disabled.includes('is-disabled" aria-disabled="true" title="Coming in a later task"'),
        false,
        'no admin nav item should be disabled any more'
    );

    for (const [label, href] of [
        ['Dashboard', '/admin'],
        ['Tips', '/admin/tips'],
        ['Slips', '/admin/slips'],
        ['Settlement', '/admin/settlement'],
        ['Performance', '/admin/performance']
    ]) {
        assert.ok(
            disabled.includes(`href="${href}">${label}</a>`)
            || disabled.includes(`href="${href}" aria-current="page">${label}</a>`),
            `${label} should be a functional nav link`
        );
    }
});

test('every element id the tips script uses exists in the rendered page', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin/tips', { jar })).text;
    const script = await readAsset('../public/js/admin/tips.js');
    const ids = elementIdsUsedBy(script);

    assert.ok(ids.length >= 8);

    for (const id of ids) {
        assert.ok(html.includes(`id="${id}"`), `tips page is missing id="${id}"`);
    }
});

test('the tips script reads the authenticated tips API with filters, search and paging', async () => {
    const script = await readAsset('../public/js/admin/tips.js');

    assert.ok(script.includes('/api/v1/tips?'));
    assert.ok(script.includes('credentials: \'same-origin\''));
    for (const token of ['result', 'search', 'limit', 'offset']) {
        assert.ok(script.includes(token), `tips script should send ${token}`);
    }
    assert.ok(!/https?:\/\//.test(script), 'browser code must not call external hosts');
});

test('the tips screen ships filter, loading, empty and error states', async () => {
    const script = await readAsset('../public/js/admin/tips.js');
    const css = await readAsset('../public/css/admin.css');

    for (const label of ['All', 'Pending', 'Won', 'Lost', 'Void']) {
        assert.ok(script.includes(`'${label}'`) || script.includes(`: '${label}'`), `filter ${label} missing`);
    }

    assert.ok(script.includes('Loading tips…'));
    assert.ok(script.includes('Failed to load tips'));
    assert.ok(script.includes('No tips imported yet.'));
    assert.ok(script.includes('No results matching search.'));
    assert.ok(script.includes('Clear filters'));
    assert.ok(script.includes('Create your first tip'));
    assert.ok(script.includes('tab__count'));

    const shared = await readAsset('../public/js/admin/ui-shared.js');

    assert.ok(shared.includes('Session expired'), 'the shared helper renders the session-expired state');

    for (const className of ['tip-card', 'status-pill--pending', 'status-pill--won', 'status-pill--lost', 'status-pill--void', 'pager']) {
        assert.ok(css.includes(`.${className}`), `stylesheet is missing .${className}`);
    }
});

test('the create tip success panel links to the tips manager', async () => {
    const script = await readAsset('../public/js/admin/create-tip.js');

    assert.ok(script.includes('View imported tips'));
    assert.ok(script.includes("viewAll.href = '/admin/tips'"));
    assert.ok(script.includes('This selection has already been imported.'));
    assert.ok(script.includes('/admin/tips?tip='));
    assert.ok(script.includes('View existing tip'));
});

test('anonymous browsers are redirected from the slip screens to sign in', async () => {
    const builder = await request('/admin/slips/new');
    const manager = await request('/admin/slips');
    const unpublished = await request('/admin/slips/unpublished');

    assert.equal(builder.status, 302);
    assert.equal(builder.location, '/admin/login?next=%2Fadmin%2Fslips%2Fnew');
    assert.equal(manager.status, 302);
    assert.equal(manager.location, '/admin/login?next=%2Fadmin%2Fslips');
    assert.equal(unpublished.status, 302);
    assert.equal(unpublished.location, '/admin/login?next=%2Fadmin%2Fslips%2Funpublished');
});

test('the slip manager renders with its header, filters and detail panel', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/slips', { jar });

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);
    assert.ok(response.text.includes('<title>Slips · PELOSI Admin</title>'));
    assert.ok(response.text.includes('Review, publish and manage betting slips.'));
    assert.ok(response.text.includes('+ Build slip'));
    assert.ok(response.text.includes('href="/admin/slips/new"'));
    assert.ok(response.text.includes('id="slip-filters"'));
    assert.ok(response.text.includes('id="slip-result-filter"'));
    assert.ok(response.text.includes('id="slips-list"'));
    assert.ok(response.text.includes('id="slips-empty"'));
    assert.ok(response.text.includes('id="slips-pager"'));
    assert.ok(response.text.includes('Slip details'));
    assert.ok(response.text.includes('/js/admin/slips.js'));
    assert.ok(response.text.includes('/js/admin/ui-shared.js'));
});

test('the slip builder renders the TrueOdds search and temporary slip panels', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/slips/new', { jar });

    assert.equal(response.status, 200);
    assert.ok(response.text.includes('<title>Build slip · PELOSI Admin</title>'));
    assert.ok(response.text.includes('Search TrueOdds, add selections to your slip, then save a draft.'));
    assert.ok(response.text.includes('id="builder-search-input"'));
    assert.ok(response.text.includes('id="builder-results-card"'));
    assert.ok(response.text.includes('id="builder-markets-card"'));
    assert.ok(response.text.includes('id="slip-preview"'));
    assert.ok(response.text.includes('Your slip'));
    assert.ok(response.text.includes('Add one selection for a Single'));
    assert.ok(response.text.includes('/js/admin/slip-builder.js'));
    assert.ok(response.text.includes('/js/admin/ui-shared.js'));
});

test('/admin/slips/:id deep-links into the manager', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/slips/12', { jar });

    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin/slips?slip=12');

    const invalid = await request('/admin/slips/not-a-number', { jar });

    assert.equal(invalid.status, 302);
    assert.equal(invalid.location, '/admin/slips');
});

test('/admin/slips/unpublished opens the draft slip filter', async () => {
    const jar = await signedInJar();
    const unpublished = await request('/admin/slips/unpublished', { jar });
    const drafts = await request('/admin/slips/drafts', { jar });

    assert.equal(unpublished.status, 302);
    assert.equal(unpublished.location, '/admin/slips?publicationStatus=draft');
    assert.equal(drafts.status, 302);
    assert.equal(drafts.location, '/admin/slips?publicationStatus=draft');
});

test('the Slips nav item is functional and active on every slip screen', async () => {
    const jar = await signedInJar();

    for (const path of ['/admin/slips', '/admin/slips/new']) {
        const html = (await request(path, { jar })).text;

        assert.match(
            html,
            /nav__link is-active" href="\/admin\/slips" aria-current="page">Slips<\/a>/,
            `${path} should mark Slips as the active section`
        );
    }

    const tipsPage = (await request('/admin/tips', { jar })).text;

    assert.ok(tipsPage.includes('nav__link" href="/admin/slips">Slips</a>'));
    assert.ok(tipsPage.includes('href="/admin/slips/new"'), 'the Tips screen links to the builder');
});

test('the slip builder uses TrueOdds proxy and the temporary builder API', async () => {
    const script = await readAsset('../public/js/admin/slip-builder.js');

    assert.ok(script.includes('/api/trueodds/matches/search'));
    assert.ok(script.includes('/api/trueodds/matches/${encodeURIComponent(match.trueOddsId)}/markets'));
    assert.ok(script.includes("fetch('/api/v1/admin/slip-builder'"));
    assert.ok(script.includes("fetch('/api/v1/admin/slip-builder/selections'"));
    assert.ok(script.includes("fetch('/api/v1/admin/slip-builder/save'"));
    assert.ok(script.includes('credentials: \'same-origin\''));
    assert.ok(script.includes('matchId: state.match.trueOddsId'));
    assert.ok(script.includes('sourceOddsId: selection.sourceOddsId'));
    assert.ok(!script.includes('/api/v1/tips?'));
    assert.ok(!script.includes("fetch('/api/v1/slips'"));

    // The browser must never send backend-owned financial values.
    for (const forbidden of ['totalOdds:', 'stakeUnits:', 'profitUnits:', 'returnUnits:', 'publicationStatus:', 'tipIds:']) {
        assert.ok(!script.includes(forbidden), `the builder must not send ${forbidden}`);
    }

    assert.ok(!/https?:\/\//.test(script));
});

test('the slip builder previews session odds and displays saved backend totals', async () => {
    const script = await readAsset('../public/js/admin/slip-builder.js');

    assert.ok(script.includes('formatTotalOdds(state.builder.previewTotalOdds)'));
    assert.ok(script.includes('formatTotalOdds(slip.totalOdds)'), 'the created slip shows the backend total');
    assert.ok(script.includes('Odds are re-checked with TrueOdds at save time.'));
    assert.ok(script.includes('Single Pick'));
});

test('the slip manager consumes the slips API and calls publish/hide', async () => {
    const script = await readAsset('../public/js/admin/slips.js');

    assert.ok(script.includes('`/api/v1/slips?${params.toString()}`'));
    assert.ok(script.includes('`/api/v1/slips/${encodeURIComponent(slipId)}`'));
    assert.ok(script.includes('`/api/v1/slips/${slipId}/${endpoint}`'));
    assert.ok(script.includes("action === 'publish' ? 'publish' : 'hide'"));
    assert.ok(script.includes('credentials: \'same-origin\''));
    assert.ok(script.includes('Published successfully'));
    assert.ok(script.includes('Slip hidden'));
    assert.ok(script.includes('Hide this slip from public view?'));
    assert.ok(!/https?:\/\//.test(script));
});

test('the slip screens ship loading, empty, error and mobile states', async () => {
    const builder = await readAsset('../public/js/admin/slip-builder.js');
    const manager = await readAsset('../public/js/admin/slips.js');
    const css = await readAsset('../public/css/admin.css');

    assert.ok(builder.includes('Loading your slip...'));
    assert.ok(builder.includes('Saving slip...'));
    assert.ok(builder.includes('No selections yet.'));
    assert.ok(builder.includes('No selections yet.'));
    assert.ok(builder.includes('Slip not saved'));

    assert.ok(manager.includes('Loading slips…'));
    assert.ok(manager.includes('Publishing…'));
    assert.ok(manager.includes('Hiding…'));
    assert.ok(manager.includes('No slips yet.'));
    assert.ok(manager.includes('No slips match these filters.'));
    assert.ok(manager.includes('Slip not found.'));

    for (const className of ['slip-card', 'slips-list', 'leg', 'legs', 'confirm', 'selection-item', 'status-pill--published', 'status-pill--draft', 'status-pill--hidden']) {
        assert.ok(css.includes(`.${className}`), `stylesheet is missing .${className}`);
    }

    assert.ok(css.includes('@media (max-width: 1024px)'));
    assert.ok(css.includes('@media (max-width: 560px)'));
});

test('every element id the slip scripts use exists in the rendered pages', async () => {
    const jar = await signedInJar();
    const builderHtml = (await request('/admin/slips/new', { jar })).text;
    const managerHtml = (await request('/admin/slips', { jar })).text;
    const builderIds = elementIdsUsedBy(await readAsset('../public/js/admin/slip-builder.js'));
    const managerIds = elementIdsUsedBy(await readAsset('../public/js/admin/slips.js'));

    assert.ok(builderIds.length >= 8);
    assert.ok(managerIds.length >= 8);

    for (const id of builderIds) {
        assert.ok(builderHtml.includes(`id="${id}"`), `builder page is missing id="${id}"`);
    }

    for (const id of managerIds) {
        assert.ok(managerHtml.includes(`id="${id}"`), `manager page is missing id="${id}"`);
    }
});

test('the shared admin helper script is parsed and used by every screen', async () => {
    const shared = await readAsset('../public/js/admin/ui-shared.js');

    new vm.Script(shared, { filename: 'ui-shared.js' });

    assert.ok(shared.includes('window.PelosiAdminUI'));
    assert.ok(shared.includes('predictionLabel'));
    assert.ok(shared.includes('sessionExpiredAlert'));

    const jar = await signedInJar();

    for (const path of ['/admin/tips', '/admin/tips/new', '/admin/slips', '/admin/slips/new']) {
        const html = (await request(path, { jar })).text;

        assert.ok(html.includes('/js/admin/ui-shared.js'), `${path} should load the shared helper`);
    }
});

test('anonymous browsers are redirected from the settlement monitor to sign in', async () => {
    const response = await request('/admin/settlement');

    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin/login?next=%2Fadmin%2Fsettlement');
});

test('the settlement monitor renders its queue and result panels', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/settlement', { jar });

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);
    assert.ok(response.text.includes('<title>Settlement · PELOSI Admin</title>'));
    assert.ok(response.text.includes('Review pending match results and settle tips and slips safely.'));
    assert.ok(response.text.includes('id="queue-list"'));
    assert.ok(response.text.includes('id="queue-empty"'));
    assert.ok(response.text.includes('id="queue-search-input"'));
    assert.ok(response.text.includes('id="queue-status-filter"'));
    assert.ok(response.text.includes('id="queue-refresh"'));
    assert.ok(response.text.includes('id="result-panel"'));
    assert.ok(response.text.includes('Refresh queue'));
    assert.ok(response.text.includes('TrueOdds is only contacted when you'));
    assert.ok(response.text.includes('/js/admin/settlement.js'));
    assert.ok(response.text.includes('/js/admin/ui-shared.js'));
    assert.ok(response.text.includes(email));
});

test('the Settlement nav item is functional and active', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin/settlement', { jar })).text;

    assert.match(html, /nav__link is-active" href="\/admin\/settlement" aria-current="page">Settlement<\/a>/);

    assert.equal(
        html.includes('is-disabled" aria-disabled="true" title="Coming in a later task"'),
        false,
        'no admin nav item should be disabled any more'
    );

    const tipsPage = (await request('/admin/tips', { jar })).text;

    assert.ok(tipsPage.includes('nav__link" href="/admin/settlement">Settlement</a>'));
    assert.ok(tipsPage.includes('nav__link" href="/admin/performance">Performance</a>'));
});

test('the settlement script consumes the local queue API and the existing settlement endpoints', async () => {
    const script = await readAsset('../public/js/admin/settlement.js');

    assert.ok(script.includes('`/api/v1/settlement/matches?${params.toString()}`'));
    assert.ok(script.includes('/preview'));
    assert.ok(script.includes('method: \'POST\''));
    assert.ok(script.includes('`/api/v1/settlement/matches/${encodeURIComponent(state.selected.sourceMatchId)}`'));
    assert.ok(script.includes('credentials: \'same-origin\''));
    assert.ok(!/https?:\/\//.test(script), 'browser code must not call external hosts');
});

test('the settlement preview is only requested for the match the admin checked', async () => {
    const script = await readAsset('../public/js/admin/settlement.js');

    // Exactly one preview call site, reached from the per-row button and from
    // "Check again" - never from the queue render loop.
    assert.equal(script.split('/preview').length - 1, 1);
    assert.ok(script.includes("check.addEventListener('click', () => checkResult(match))"));
    assert.ok(script.includes("button.addEventListener('click', () => checkResult(state.selected))"));
    assert.ok(script.includes('loadQueue();'));
    assert.ok(!/for \([^)]*\)[\s\S]{0,200}checkResult/.test(script), 'the queue must not fan out preview requests');
});

test('the settlement UI reuses backend classifications instead of its own rules', async () => {
    const script = await readAsset('../public/js/admin/settlement.js');

    for (const label of ['Safe to settle', 'Not finished yet', 'Manual review required', 'Void result']) {
        assert.ok(script.includes(label), `missing classification label: ${label}`);
    }

    assert.ok(script.includes('preview.canAutoSettle'));
    assert.ok(script.includes('preview.actionLabel') || script.includes("'Settle match'"));

    // The UI only *displays* what the backend classified - it must not contain
    // its own settlement rules.
    assert.ok(!script.includes('resultStatus ==='), 'no resultStatus comparison may exist in the browser');
    assert.ok(!script.includes('finalResult ==='), 'no finalResult comparison may exist in the browser');
    assert.ok(!script.includes('SUPPORTED_MARKET_CODES'));
    assert.ok(!/['"]AP['"]/.test(script), 'AP must not be hard-coded in the browser');
    assert.ok(!/['"]AET['"]/.test(script), 'AET must not be hard-coded in the browser');
});

test('the settlement UI shows settle outcomes and manual-review states', async () => {
    const script = await readAsset('../public/js/admin/settlement.js');

    assert.ok(script.includes('Settlement complete'));
    assert.ok(script.includes('Nothing changed'));
    assert.ok(script.includes('Tips updated'));
    assert.ok(script.includes('Left for manual review'));
    assert.ok(script.includes('Slips recalculated'));
    assert.ok(script.includes('Local match updated'));
    assert.ok(script.includes('Affected tips'));
    assert.ok(script.includes('Affected pending slips'));
    assert.ok(script.includes('No pending tips for this match.'));
    assert.ok(script.includes('No affected slips.'));
});

test('the settlement screen ships loading, empty and error states', async () => {
    const script = await readAsset('../public/js/admin/settlement.js');
    const css = await readAsset('../public/css/admin.css');

    assert.ok(script.includes('Loading settlement queue…'));
    assert.ok(script.includes('Checking TrueOdds result…'));
    assert.ok(script.includes('Settling match…'));
    assert.ok(script.includes('Refreshing settlement queue…'));
    assert.ok(script.includes('No matches currently require settlement.'));
    assert.ok(script.includes('No search results.'));
    assert.ok(script.includes('TrueOdds result unavailable'));

    for (const className of ['queue-card', 'queue-list']) {
        assert.ok(css.includes(`.${className}`), `stylesheet is missing .${className}`);
    }

    assert.ok(css.includes('@media (max-width: 1024px)'));
    assert.ok(css.includes('@media (max-width: 560px)'));
});

test('every element id the settlement script uses exists in the rendered page', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin/settlement', { jar })).text;
    const ids = elementIdsUsedBy(await readAsset('../public/js/admin/settlement.js'));

    assert.ok(ids.length >= 8);

    for (const id of ids) {
        assert.ok(html.includes(`id="${id}"`), `settlement page is missing id="${id}"`);
    }
});

test('anonymous browsers are redirected from the performance screen to sign in', async () => {
    const response = await request('/admin/performance');

    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin/login?next=%2Fadmin%2Fperformance');
});

test('the performance screen renders its metrics, chart, breakdown and recent sections', async () => {
    const jar = await signedInJar();
    const response = await request('/admin/performance', { jar });

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);
    assert.ok(response.text.includes('<title>Performance · PELOSI Admin</title>'));
    assert.ok(response.text.includes('Track published betting results, profit and ROI.'));
    assert.ok(response.text.includes('id="performance-range"'));
    assert.ok(response.text.includes('id="metric-cards"'));
    assert.ok(response.text.includes('id="metrics-empty"'));
    assert.ok(response.text.includes('id="trend-chart"'));
    assert.ok(response.text.includes('id="trend-empty"'));
    assert.ok(response.text.includes('Cumulative profit'));
    assert.ok(response.text.includes('id="breakdown-panel"'));
    assert.ok(response.text.includes('Wins vs losses'));
    assert.ok(response.text.includes('id="recent-list"'));
    assert.ok(response.text.includes('Recent settled slips'));
    assert.ok(response.text.includes('/js/admin/performance.js'));
    assert.ok(response.text.includes('/js/admin/ui-shared.js'));
    assert.ok(response.text.includes(email));
});

test('the Performance nav item is functional and active', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin/performance', { jar })).text;

    assert.match(html, /nav__link is-active" href="\/admin\/performance" aria-current="page">Performance<\/a>/);
    assert.ok(html.includes('nav__link" href="/admin">Dashboard</a>'));

    const settlementPage = (await request('/admin/settlement', { jar })).text;

    assert.ok(settlementPage.includes('nav__link" href="/admin/performance">Performance</a>'));
});

test('the performance script consumes the existing summary, trend and slips APIs', async () => {
    const script = await readAsset('../public/js/admin/performance.js');

    assert.ok(script.includes('/api/v1/performance?range=${encodeURIComponent(state.range)}'));
    assert.ok(script.includes('/api/v1/performance/history?range=${encodeURIComponent(state.range)}'));
    assert.ok(script.includes('`/api/v1/slips?${params.toString()}`'));
    assert.ok(script.includes("publicationStatus: 'published'"));
    assert.ok(script.includes("result: 'settled'"));
    assert.ok(script.includes("sort: 'settled'"));
    assert.ok(script.includes('credentials: \'same-origin\''));
});

test('the performance screen makes exactly one trend request per refresh and no TrueOdds request', async () => {
    const script = await readAsset('../public/js/admin/performance.js');

    assert.equal(script.split('`/api/v1/performance/history?range=').length - 1, 1, 'one trend call site');

    for (const pattern of ['/api/trueodds', 'trueodds-client', 'getTrueOdds', 'TRUEODDS']) {
        assert.equal(script.includes(pattern), false, `performance script must not use ${pattern}`);
    }

    assert.ok(script.includes('await Promise.all([loadSummary(), loadHistory(), loadRecent()])'));

    // The recent list is fetched once with a limit, never per slip.
    assert.ok(script.includes('const recentLimit = 10;'));
    assert.ok(!/for \([^)]*\)[\s\S]{0,200}fetch\(/.test(script), 'no fetch inside a data loop');
});

test('the performance range control exists, is accessible and is sent to the backend', async () => {
    const script = await readAsset('../public/js/admin/performance.js');

    for (const label of ['All time', '7 days', '30 days', '90 days']) {
        assert.ok(script.includes(label), `missing range label: ${label}`);
    }

    assert.ok(script.includes("setAttribute('role', 'tab')"));
    assert.ok(script.includes("setAttribute('aria-selected'"));
    assert.ok(script.includes('syncUrl()'));
    assert.ok(script.includes('/admin/performance${query}'));
});

test('the performance metric cards come from the backend values with null guards', async () => {
    const script = await readAsset('../public/js/admin/performance.js');

    for (const label of ['Profit', 'ROI', 'Win rate', 'Settled slips', 'Units staked', 'Average odds']) {
        assert.ok(script.includes(`'${label}'`), `missing metric card: ${label}`);
    }

    // Formatting only - the browser never recomputes the metrics.
    assert.ok(script.includes("const placeholder = '—';"));
    assert.ok(script.includes('Number.isFinite(Number(value))'));
    assert.ok(!script.includes('profitUnits / '), 'ROI must not be recomputed in the browser');
    // The displayed win rate comes from the backend; the only division in the
    // browser is the visual bar width (a proportion, not a metric).
    assert.ok(script.includes('summary.winRatePercentage'));
    assert.ok(script.includes('const wonShare = settled === 0 ? 0 : (wins / settled) * 100;'));
    assert.ok(script.includes('won.style.width = `${wonShare}%`;'));

    // Null percentages render as an em dash, never NaN/Infinity.
    assert.ok(script.includes('? placeholder'));
    assert.equal(script.includes("'NaN'"), false);
    assert.equal(script.includes('Infinity%'), false);
});

test('the cumulative profit chart is a locally built SVG with a zero line and text alternatives', async () => {
    const script = await readAsset('../public/js/admin/performance.js');

    assert.ok(script.includes("createElementNS(svgNamespace, tag)"));
    assert.ok(script.includes('chart__zero'));
    assert.ok(script.includes('chart__line'));
    assert.ok(script.includes('chart__dot'));
    assert.ok(script.includes("role: 'img'"));
    assert.ok(script.includes("'aria-label'"));
    assert.ok(script.includes("ui.el('ul', 'visually-hidden')"), 'text equivalent of the chart');

    // No chart library is installed or referenced.
    assert.equal(/chart\.js|d3|echarts/i.test(script), false);
});

test('the performance screen ships loading, empty and error states', async () => {
    const script = await readAsset('../public/js/admin/performance.js');
    const css = await readAsset('../public/css/admin.css');

    assert.ok(script.includes('Loading performance…'));
    assert.ok(script.includes('Loading trend…'));
    assert.ok(script.includes('Loading results…'));
    assert.ok(script.includes('No published settled slips yet.'));
    assert.ok(script.includes('Not enough settled slips for a trend yet.'));
    assert.ok(script.includes('The performance response could not be read.'));
    assert.ok(script.includes('ui.friendlyFailure(response, payload, \'load performance data\')'));
    assert.ok(script.includes('sessionExpiredAlert(\'/admin/performance\')'));

    for (const className of ['metric-grid', 'metric-card', 'metric-card--positive', 'metric-card--negative', 'chart__svg', 'breakdown', 'breakdown__segment--won', 'breakdown__segment--lost']) {
        assert.ok(css.includes(`.${className}`), `stylesheet is missing .${className}`);
    }

    assert.ok(css.includes('@media (max-width: 1024px)'));
    assert.ok(css.includes('@media (max-width: 560px)'));
});

test('every element id the performance script uses exists in the rendered page', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin/performance', { jar })).text;
    const ids = elementIdsUsedBy(await readAsset('../public/js/admin/performance.js'));

    assert.ok(ids.length >= 8);

    for (const id of ids) {
        assert.ok(html.includes(`id="${id}"`), `performance page is missing id="${id}"`);
    }
});

test('anonymous browsers are redirected from the dashboard to sign in', async () => {
    const response = await request('/admin');

    assert.equal(response.status, 302);
    assert.equal(response.location, '/admin/login?next=%2Fadmin');
});

test('the dashboard renders its summary, attention, actions and activity sections', async () => {
    const jar = await signedInJar();
    const response = await request('/admin', { jar });

    assert.equal(response.status, 200);
    assert.match(response.contentType, /text\/html/);
    assert.ok(response.text.includes('<title>Dashboard · PELOSI Admin</title>'));
    assert.ok(response.text.includes('Overview of your betting operation.'));
    assert.ok(response.text.includes('id="summary-cards"'));
    assert.ok(response.text.includes('Needs attention'));
    assert.ok(response.text.includes('id="attention-list"'));
    assert.ok(response.text.includes('Quick actions'));
    assert.ok(response.text.includes('id="quick-actions"'));
    assert.ok(response.text.includes('id="performance-snapshot"'));
    assert.ok(response.text.includes('Cumulative profit') === false, 'the dashboard stays concise');
    assert.ok(response.text.includes('id="queue-preview"'));
    assert.ok(response.text.includes('id="recent-tips"'));
    assert.ok(response.text.includes('id="recent-slips"'));
    assert.ok(response.text.includes('/js/admin/dashboard.js'));
    assert.ok(response.text.includes('/js/admin/ui-shared.js'));
    assert.ok(response.text.includes(email));
});

test('the Dashboard nav item is functional and active', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin', { jar })).text;

    assert.match(html, /nav__link is-active" href="\/admin" aria-current="page">Dashboard<\/a>/);

    const otherPage = (await request('/admin/tips', { jar })).text;

    assert.ok(otherPage.includes('nav__link" href="/admin">Dashboard</a>'));
});

test('the dashboard script consumes one aggregated API and links to every workflow', async () => {
    const script = await readAsset('../public/js/admin/dashboard.js');

    assert.equal((script.match(/fetch\(/g) ?? []).length, 1, 'exactly one dashboard request');
    assert.ok(script.includes("fetch('/api/v1/admin/dashboard'"));
    assert.ok(script.includes('credentials: \'same-origin\''));

    for (const href of [
        '/admin/tips?result=pending',
        '/admin/slips/unpublished',
        '/admin/settlement',
        '/admin/slips?publicationStatus=published',
        '/admin/performance',
        '/admin/tips/new',
        '/admin/slips/new',
        '/admin/tips',
        '/admin/slips'
    ]) {
        assert.ok(script.includes(href), `missing dashboard link ${href}`);
    }

    assert.ok(script.includes('/admin/settlement?match='), 'settlement rows deep link to the match');
    assert.equal(script.includes('/api/trueodds'), false);
});

test('the dashboard never recalculates financial metrics', async () => {
    const script = await readAsset('../public/js/admin/dashboard.js');

    assert.ok(script.includes('performance.profitUnits'));
    assert.ok(script.includes('performance.roiPercentage'));
    assert.ok(script.includes('performance.winRatePercentage'));
    assert.equal(script.includes('profitUnits / '), false, 'ROI must come from the API');
    assert.equal(script.includes('wins / '), false, 'win rate must come from the API');
});

test('the dashboard ships loading, empty and error states', async () => {
    const script = await readAsset('../public/js/admin/dashboard.js');
    const css = await readAsset('../public/css/admin.css');

    assert.ok(script.includes('Loading dashboard…'));
    assert.ok(script.includes('No pending tips. Create a tip to get started.'));
    assert.ok(script.includes('No draft slips. Build a slip from pending tips.'));
    assert.ok(script.includes('No matches currently require settlement.'));
    assert.ok(script.includes('No published settled slips yet.'));
    assert.ok(script.includes('No tips imported yet. Create a tip to get started.'));
    assert.ok(script.includes('No slips yet. Build a slip from pending tips.'));
    assert.ok(script.includes('all caught up.'), 'the caught-up empty state exists');
    assert.ok(script.includes('Performance unavailable right now.'));
    assert.ok(script.includes('Settlement queue unavailable right now.'));
    assert.ok(script.includes('The dashboard response could not be read.'));
    assert.ok(script.includes('sessionExpiredAlert(\'/admin\')'));

    for (const className of ['dashboard-split', 'dashboard-list', 'dashboard-row', 'attention-item', 'quick-actions', 'metric-card__link']) {
        assert.ok(css.includes(`.${className}`), `stylesheet is missing .${className}`);
    }

    assert.ok(css.includes('@media (max-width: 1024px)'));
    assert.ok(css.includes('@media (max-width: 560px)'));
});

test('every element id the dashboard script uses exists in the rendered page', async () => {
    const jar = await signedInJar();
    const html = (await request('/admin', { jar })).text;
    const ids = elementIdsUsedBy(await readAsset('../public/js/admin/dashboard.js'));

    assert.ok(ids.length >= 8);

    for (const id of ids) {
        assert.ok(html.includes(`id="${id}"`), `dashboard page is missing id="${id}"`);
    }
});

test('the settlement monitor accepts a match deep link without checking TrueOdds', async () => {
    const script = await readAsset('../public/js/admin/settlement.js');

    assert.ok(script.includes('highlightedSourceMatchId'));
    assert.ok(script.includes("new URLSearchParams(window.location.search).get('match')"));
    assert.ok(script.includes('No result checked yet. Click "Check result"'), 'the admin still triggers the check');

    // The deep link must not add another preview call site.
    assert.equal(script.split('/preview').length - 1, 1);
});

test('every element id the login script uses exists in the rendered page', async () => {
    const html = (await request('/admin/login')).text;
    const script = await readAsset('../public/js/admin/login.js');
    const ids = elementIdsUsedBy(script);

    assert.ok(ids.length >= 4);

    for (const id of ids) {
        assert.ok(html.includes(`id="${id}"`), `login page is missing id="${id}"`);
    }
});

test('browser scripts parse and the stylesheet defines the state classes they toggle', async () => {
    const createTipScript = await readAsset('../public/js/admin/create-tip.js');
    const loginScript = await readAsset('../public/js/admin/login.js');
    const css = await readAsset('../public/css/admin.css');

    // Throws on a syntax error, so a broken browser bundle fails the suite.
    new vm.Script(createTipScript, { filename: 'create-tip.js' });
    new vm.Script(loginScript, { filename: 'login.js' });

    for (const className of [
        'alert--success',
        'alert--error',
        'alert--pending',
        'is-active',
        'is-hidden',
        'match-item',
        'selection',
        'tab',
        'empty'
    ]) {
        assert.ok(css.includes(`.${className}`), `stylesheet is missing .${className}`);
    }

    assert.ok(css.includes('.workspace'), 'stylesheet is missing the responsive workspace grid');
    assert.ok(css.includes('@media (max-width: 1024px)'), 'stylesheet is missing the tablet/mobile breakpoint');
    assert.ok(css.includes('@media (max-width: 560px)'), 'stylesheet is missing the mobile breakpoint');
});

