import pool from '../db/postgres.js';

export async function findSportById(id, db = pool) {
    const result = await db.query(
        `
        SELECT id, code, name, created_at, updated_at
        FROM sports
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function findSportByCode(code, db = pool) {
    const result = await db.query(
        `
        SELECT id, code, name, created_at, updated_at
        FROM sports
        WHERE code = $1
        `,
        [code]
    );

    return result.rows[0] ?? null;
}
