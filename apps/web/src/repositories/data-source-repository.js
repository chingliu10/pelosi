import pool from '../db/postgres.js';

export async function findDataSourceById(id, db = pool) {
    const result = await db.query(
        `
        SELECT id, code, name, created_at, updated_at
        FROM data_sources
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function findDataSourceByCode(code, db = pool) {
    const result = await db.query(
        `
        SELECT id, code, name, created_at, updated_at
        FROM data_sources
        WHERE code = $1
        `,
        [code]
    );

    return result.rows[0] ?? null;
}
