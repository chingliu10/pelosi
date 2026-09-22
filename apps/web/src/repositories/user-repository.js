import pool from '../db/postgres.js';

const userColumns = `
    id,
    email,
    password_hash,
    role,
    is_active,
    created_at,
    updated_at
`;

export async function findUserByEmail(email, db = pool) {
    const result = await db.query(
        `
        SELECT ${userColumns}
        FROM users
        WHERE email = $1
        `,
        [email]
    );

    return result.rows[0] ?? null;
}

export async function findUserById(id, db = pool) {
    const result = await db.query(
        `
        SELECT ${userColumns}
        FROM users
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function createUser(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO users (
            email,
            password_hash,
            role,
            is_active
        )
        VALUES ($1, $2, $3, COALESCE($4, TRUE))
        RETURNING ${userColumns}
        `,
        [
            data.email,
            data.passwordHash,
            data.role ?? 'admin',
            data.isActive ?? true
        ]
    );

    return result.rows[0];
}

export async function updateUserPassword(id, passwordHash, db = pool) {
    const result = await db.query(
        `
        UPDATE users
        SET password_hash = $2
        WHERE id = $1
        RETURNING ${userColumns}
        `,
        [id, passwordHash]
    );

    return result.rows[0] ?? null;
}
