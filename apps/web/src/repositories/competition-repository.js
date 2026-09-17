import pool from '../db/postgres.js';

export async function findCompetitionById(id, db = pool) {
    const result = await db.query(
        `
        SELECT id, source_id, source_competition_id, sport_id, name, country, created_at, updated_at
        FROM competitions
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function findCompetitionBySourceCompetitionId(sourceId, sourceCompetitionId, db = pool) {
    const result = await db.query(
        `
        SELECT id, source_id, source_competition_id, sport_id, name, country, created_at, updated_at
        FROM competitions
        WHERE source_id = $1
          AND source_competition_id = $2
        `,
        [sourceId, sourceCompetitionId]
    );

    return result.rows[0] ?? null;
}

export async function searchCompetitions(searchTerm, db = pool) {
    const result = await db.query(
        `
        SELECT id, source_id, source_competition_id, sport_id, name, country, created_at, updated_at
        FROM competitions
        WHERE name ILIKE '%' || $1 || '%'
        ORDER BY name
        LIMIT 50
        `,
        [searchTerm]
    );

    return result.rows;
}

export async function createCompetition(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO competitions (
            source_id,
            source_competition_id,
            sport_id,
            name,
            country
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, source_id, source_competition_id, sport_id, name, country, created_at, updated_at
        `,
        [
            data.sourceId,
            data.sourceCompetitionId,
            data.sportId,
            data.name,
            data.country ?? null
        ]
    );

    return result.rows[0];
}

export async function upsertCompetition(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO competitions (
            source_id,
            source_competition_id,
            sport_id,
            name,
            country
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (source_id, source_competition_id)
        DO UPDATE SET
            sport_id = EXCLUDED.sport_id,
            name = EXCLUDED.name,
            country = EXCLUDED.country
        RETURNING id, source_id, source_competition_id, sport_id, name, country, created_at, updated_at
        `,
        [
            data.sourceId,
            data.sourceCompetitionId,
            data.sportId,
            data.name,
            data.country ?? null
        ]
    );

    return result.rows[0];
}
