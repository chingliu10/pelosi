import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';
import {
    createUserAccount,
    hashPassword,
    verifyPassword
} from '../src/services/auth-service.js';

/**
 * Session tests against the real Express app and the real PostgreSQL session
 * store. Two throwaway users are created for the run and deleted afterwards.
 *
 * Cookies are tracked with a tiny cookie-jar helper instead of a testing
 * framework: fetch already exposes Set-Cookie, so no extra dependency is
 * needed to keep the session between requests.
 */
const activeEmail = `pelosi-auth-test+active-${Date.now()}@example.test`;
const inactiveEmail = `pelosi-auth-test+inactive-${Date.now()}@example.test`;
const activePassword = 'correct-horse-battery';
const inactivePassword = 'inactive-user-password';
const cookieName = process.env.SESSION_COOKIE_NAME || 'pelosi.sid';

// Only the authentication gate is exercised here, so real ids are fine: the
// request never reaches the controller.
const protectedWriteRoutes = [
    { method: 'POST', path: '/api/v1/slips', body: {} },
    { method: 'POST', path: '/api/v1/slips/1/publish' },
    { method: 'POST', path: '/api/v1/slips/1/hide' },
    { method: 'POST', path: '/api/v1/settlement/matches/999999999' },
    { method: 'POST', path: '/api/trueodds/tips/import', body: {} }
];

// With a valid session the request reaches the controller, so these use inputs
// that fail validation or point at unknown rows. Nothing is created, published,
// hidden or settled.
const protectedWriteRoutesWithSession = [
    { method: 'POST', path: '/api/v1/slips', body: {}, expected: 400 },
    { method: 'POST', path: '/api/v1/slips/999999/publish', expected: 404 },
    { method: 'POST', path: '/api/v1/slips/999999/hide', expected: 404 },
    { method: 'POST', path: '/api/v1/settlement/matches/999999999', expected: 404 },
    { method: 'POST', path: '/api/trueodds/tips/import', body: {}, expected: 400 }
];

let server = null;
let baseUrl = null;
let activeUserId = null;

function createCookieJar() {
    const cookies = new Map();

    return {
        header() {
            return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
        },
        store(response) {
            for (const rawCookie of collectSetCookies(response)) {
                const [pair] = rawCookie.split(';');
                const separatorIndex = pair.indexOf('=');

                if (separatorIndex === -1) continue;

                const name = pair.slice(0, separatorIndex).trim();
                const value = pair.slice(separatorIndex + 1).trim();

                if (value === '' || /expires=Thu, 01 Jan 1970/i.test(rawCookie)) {
                    cookies.delete(name);
                    continue;
                }

                cookies.set(name, value);
            }
        },
        get(name) {
            return cookies.get(name) ?? null;
        }
    };
}

function collectSetCookies(response) {
    if (typeof response.headers.getSetCookie === 'function') {
        return response.headers.getSetCookie();
    }

    const single = response.headers.get('set-cookie');

    return single ? [single] : [];
}

async function request(path, { method = 'GET', body, jar } = {}) {
    const headers = {};

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    if (jar) {
        const cookieHeader = jar.header();

        if (cookieHeader) {
            headers.Cookie = cookieHeader;
        }
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let parsed = null;

    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = text;
    }

    if (jar) {
        jar.store(response);
    }

    return {
        status: response.status,
        body: parsed,
        setCookies: collectSetCookies(response)
    };
}

function extractSessionId(setCookies) {
    const sessionCookie = setCookies.find((cookie) => cookie.startsWith(`${cookieName}=`));

    if (!sessionCookie) {
        return null;
    }

    const rawValue = sessionCookie.split(';')[0].slice(cookieName.length + 1);
    const decoded = decodeURIComponent(rawValue);
    const withoutPrefix = decoded.startsWith('s:') ? decoded.slice(2) : decoded;

    return withoutPrefix.split('.')[0];
}

test.before(async () => {
    const active = await createUserAccount({ email: activeEmail, password: activePassword });
    const inactive = await createUserAccount({ email: inactiveEmail, password: inactivePassword });

    activeUserId = active.id;

    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [inactive.id]);

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    await pool.query(
        `
        DELETE FROM session
        WHERE sess -> 'user' ->> 'id' = ANY($1::text[])
        `,
        [[String(activeUserId)]]
    );
    await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [[activeEmail, inactiveEmail]]);

    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

test('login with valid credentials creates a server-side session', async () => {
    const jar = createCookieJar();
    const response = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: activePassword },
        jar
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, activeEmail);
    assert.equal(response.body.user.role, 'admin');
    assert.equal(response.body.user.password_hash, undefined);
    assert.equal(typeof response.body.user.id, 'number');

    const sessionCookie = response.setCookies.find((cookie) => cookie.startsWith(`${cookieName}=`));

    assert.ok(sessionCookie, 'a session cookie is issued');
    assert.match(sessionCookie, /HttpOnly/i);
    assert.match(sessionCookie, /SameSite=Lax/i);
    assert.doesNotMatch(sessionCookie, /Secure/i, 'secure is off for local HTTP development');

    const sessionId = extractSessionId(response.setCookies);
    const stored = await pool.query('SELECT sess FROM session WHERE sid = $1', [sessionId]);

    assert.equal(stored.rows.length, 1, 'the session is stored server-side in PostgreSQL');
    assert.equal(Number(stored.rows[0].sess.user.id), activeUserId);
    assert.equal(stored.rows[0].sess.user.role, 'admin');
    assert.equal(JSON.stringify(stored.rows[0].sess).includes('password'), false);
});

test('login with a wrong password returns 401', async () => {
    const response = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: 'not-the-password' }
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Invalid credentials');
    assert.equal(response.setCookies.length, 0);
});

test('login with a nonexistent user returns the same generic 401', async () => {
    const missing = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: `nobody-${Date.now()}@example.test`, password: 'whatever-password' }
    });
    const wrongPassword = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: 'not-the-password' }
    });

    assert.equal(missing.status, 401);
    assert.equal(missing.body.error, wrongPassword.body.error, 'no account enumeration');
});

test('login requires email and password', async () => {
    const response = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail }
    });

    assert.equal(response.status, 400);
});

test('an inactive user cannot log in', async () => {
    const response = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: inactiveEmail, password: inactivePassword }
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Invalid credentials');
    assert.equal(response.setCookies.length, 0);
});

test('GET /api/v1/auth/me without a session returns 401', async () => {
    const response = await request('/api/v1/auth/me');

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'Authentication required');
});

test('GET /api/v1/auth/me returns the logged-in user after login', async () => {
    const jar = createCookieJar();

    await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: activePassword },
        jar
    });

    const response = await request('/api/v1/auth/me', { jar });

    assert.equal(response.status, 200);
    assert.equal(response.body.user.email, activeEmail);
    assert.equal(response.body.user.role, 'admin');
    assert.equal(response.body.user.id, activeUserId);
    assert.equal(JSON.stringify(response.body).includes('password'), false);
    assert.equal(JSON.stringify(response.body).includes('$2'), false, 'no bcrypt hash is exposed');
});

test('logout destroys the session and clears the cookie', async () => {
    const jar = createCookieJar();
    const login = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: activePassword },
        jar
    });
    const sessionId = extractSessionId(login.setCookies);
    const logout = await request('/api/v1/auth/logout', { method: 'POST', jar });

    assert.equal(logout.status, 200);
    assert.equal(logout.body.success, true);
    assert.equal(jar.get(cookieName), null, 'the session cookie was cleared');

    const stored = await pool.query('SELECT sid FROM session WHERE sid = $1', [sessionId]);

    assert.equal(stored.rows.length, 0, 'the server-side session row was destroyed');

    const me = await request('/api/v1/auth/me', { jar });

    assert.equal(me.status, 401);
});

test('logging in again regenerates the session id', async () => {
    const jar = createCookieJar();
    const first = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: activePassword },
        jar
    });
    const second = await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: activePassword },
        jar
    });

    assert.notEqual(extractSessionId(first.setCookies), extractSessionId(second.setCookies));
    assert.equal((await request('/api/v1/auth/me', { jar })).status, 200);
});

test('protected write routes reject unauthenticated requests with 401', async () => {
    for (const route of protectedWriteRoutes) {
        const response = await request(route.path, { method: route.method, body: route.body });

        assert.equal(response.status, 401, `${route.method} ${route.path} must require a session`);
        assert.equal(response.body.error, 'Authentication required');
    }
});

test('protected write routes accept a valid admin session', async () => {
    const jar = createCookieJar();

    await request('/api/v1/auth/login', {
        method: 'POST',
        body: { email: activeEmail, password: activePassword },
        jar
    });

    // These requests intentionally fail their own validation (missing body,
    // unknown slip id, unknown match). Reaching validation/404 instead of 401
    // proves the request passed the authentication middleware without creating
    // any real slip, publishing anything or settling anything.
    for (const route of protectedWriteRoutesWithSession) {
        const response = await request(route.path, { method: route.method, body: route.body, jar });

        assert.equal(
            response.status,
            route.expected,
            `${route.method} ${route.path} should pass requireAuth and fail validation instead`
        );
    }
});

test('public read routes still work without a session', async () => {
    const routes = [
        '/api/v1/slips',
        '/api/v1/slips?publicationStatus=published',
        '/api/v1/slips/1',
        '/api/v1/performance'
    ];

    for (const path of routes) {
        const response = await request(path);

        assert.notEqual(response.status, 401, `${path} must stay public`);
        assert.notEqual(response.status, 403, `${path} must stay public`);
    }
});

test('stored passwords are bcrypt hashes, never plain text', async () => {
    const stored = await pool.query('SELECT email, password_hash FROM users WHERE email = $1', [activeEmail]);
    const user = stored.rows[0];

    assert.match(user.password_hash, /^\$2[aby]\$/);
    assert.notEqual(user.password_hash, activePassword);
    assert.equal(user.password_hash.includes(activePassword), false);

    const rehashed = await hashPassword(activePassword);

    assert.equal(await verifyPassword(activePassword, user.password_hash), true);
    assert.equal(await verifyPassword('wrong-password', user.password_hash), false);
    assert.notEqual(rehashed, user.password_hash, 'each hash is salted');
});
