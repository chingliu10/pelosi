import bcrypt from 'bcryptjs';
import {
    createUser,
    findUserByEmail,
    findUserById,
    updateUserPassword
} from '../repositories/user-repository.js';

const bcryptRounds = 10;
const minimumPasswordLength = 10;
const genericLoginError = 'Invalid credentials';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rolePattern = /^[a-z][a-z_]{2,29}$/;

/**
 * Comparing an unknown email against a real bcrypt hash keeps the failure cost
 * similar to a wrong password, so login does not leak whether an account
 * exists.
 */
const timingEqualizerHash = bcrypt.hashSync('pelosi-login-timing-equalizer', bcryptRounds);

export async function login(data, session) {
    const email = normalizeEmail(data?.email);
    const password = typeof data?.password === 'string' ? data.password : '';

    if (!email || !password) {
        throw badRequest('email and password are required');
    }

    const user = await findUserByEmail(email);
    const passwordMatches = user
        ? await verifyPassword(password, user.password_hash)
        : await bcrypt.compare(password, timingEqualizerHash);

    if (!user || !user.is_active || !passwordMatches) {
        const error = new Error(genericLoginError);
        error.status = 401;
        throw error;
    }

    // Regenerate the session id on login so a pre-existing (attacker supplied)
    // session id cannot be reused after authentication.
    await session.regenerate();
    session.setUser({ id: user.id, role: user.role });
    await session.save();

    return toPublicUser(user);
}

export async function currentUser(session) {
    const userId = session.getUser()?.id;

    if (!userId) {
        return null;
    }

    const user = await findUserById(userId);

    if (!user || !user.is_active) {
        return null;
    }

    return toPublicUser(user);
}

export async function logout(session) {
    await session.destroy();
}

export function hashPassword(plainPassword) {
    return bcrypt.hash(plainPassword, bcryptRounds);
}

export function verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Used by the one-time admin creation script. No user is ever inserted with a
 * plain-text password and no seeded password lives in a migration.
 */
export async function createUserAccount({ email, password, role = 'admin' }) {
    const normalizedEmail = normalizeEmail(email);

    validateEmail(normalizedEmail);
    validatePassword(password);

    const normalizedRole = String(role).trim().toLowerCase();

    if (!rolePattern.test(normalizedRole)) {
        throw badRequest('Invalid role. Use lowercase letters and underscores');
    }

    const passwordHash = await hashPassword(password);

    try {
        const user = await createUser({
            email: normalizedEmail,
            passwordHash,
            role: normalizedRole
        });

        return toPublicUser(user);
    } catch (error) {
        if (error.code === '23505') {
            const conflict = new Error(`User already exists: ${normalizedEmail}`);
            conflict.status = 409;
            throw conflict;
        }

        throw error;
    }
}

export async function resetUserPassword({ email, password }) {
    const normalizedEmail = normalizeEmail(email);

    validateEmail(normalizedEmail);
    validatePassword(password);

    const user = await findUserByEmail(normalizedEmail);

    if (!user) {
        const error = new Error(`User not found: ${normalizedEmail}`);
        error.status = 404;
        throw error;
    }

    const updated = await updateUserPassword(user.id, await hashPassword(password));

    return toPublicUser(updated);
}

export function toPublicUser(user) {
    return {
        id: Number(user.id),
        email: user.email,
        role: user.role
    };
}

function normalizeEmail(value) {
    if (value === undefined || value === null) {
        return '';
    }

    return String(value).trim().toLowerCase();
}

function validateEmail(email) {
    if (!email || email.length > 255 || !emailPattern.test(email)) {
        throw badRequest('A valid email address is required');
    }
}

function validatePassword(password) {
    if (typeof password !== 'string' || password.length < minimumPasswordLength) {
        throw badRequest(`Password must be at least ${minimumPasswordLength} characters long`);
    }
}

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;

    return error;
}
