import 'dotenv/config';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pool from '../db/postgres.js';

const PgSessionStore = connectPgSimple(session);

export const sessionCookieName = process.env.SESSION_COOKIE_NAME || 'pelosi.sid';
export const sessionMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
export const sessionTableName = 'session';

export function isProduction() {
    return process.env.NODE_ENV === 'production';
}

/**
 * The session secret never lives in source code. Pelosi refuses to start
 * without a strong SESSION_SECRET instead of falling back to a default.
 */
export function resolveSessionSecret() {
    const secret = process.env.SESSION_SECRET;

    if (!secret || secret.trim().length < 32) {
        throw new Error('SESSION_SECRET is required and must be at least 32 characters long');
    }

    return secret;
}

export function sessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction(),
        path: '/'
    };
}

/**
 * Server-side sessions: the cookie only carries the opaque session id and the
 * session payload lives in the PostgreSQL `session` table, so sessions survive
 * restarts and no MemoryStore is used.
 */
export function createSessionMiddleware() {
    const store = new PgSessionStore({
        pool,
        tableName: sessionTableName,
        createTableIfMissing: false,
        pruneSessionInterval: 60
    });

    return session({
        name: sessionCookieName,
        secret: resolveSessionSecret(),
        store,
        resave: false,
        saveUninitialized: false,
        rolling: false,
        cookie: {
            ...sessionCookieOptions(),
            maxAge: sessionMaxAgeMs
        }
    });
}

/**
 * Small adapter so the service layer can work with the session without
 * touching Express internals.
 *
 * Express-session swaps `req.session` for a brand new Session object when a
 * session is regenerated (which is what protects against session fixation),
 * so every access goes through `req.session` instead of caching the object.
 */
export function createSessionContext(req) {
    return {
        getUser() {
            return req.session?.user ?? null;
        },
        setUser(user) {
            req.session.user = {
                id: Number(user.id),
                role: user.role
            };
        },
        regenerate() {
            return callSessionMethod(req.session, 'regenerate');
        },
        save() {
            return callSessionMethod(req.session, 'save');
        },
        destroy() {
            if (!req.session) {
                return Promise.resolve();
            }

            return callSessionMethod(req.session, 'destroy');
        }
    };
}

function callSessionMethod(session, method) {
    return new Promise((resolve, reject) => {
        session[method]((error) => (error ? reject(error) : resolve()));
    });
}
