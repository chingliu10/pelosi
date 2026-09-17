import pool from '../db/postgres.js';

export async function findTeamById(id, db = pool) {
    const result = await db.query(
        `
        SELECT id, source_id, source_team_id, sport_id, name, country, created_at, updated_at
        FROM teams
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function findTeamBySourceId(sourceId, db = pool) {
    const result = await db.query(
        `
        SELECT id, source_id, source_team_id, sport_id, name, country, created_at, updated_at
        FROM teams
        WHERE source_id = $1
        ORDER BY name
        `,
        [sourceId]
    );

    return result.rows;
}

export async function findTeamBySourceTeamId(sourceId, sourceTeamId, db = pool) {
    const result = await db.query(
        `
        SELECT id, source_id, source_team_id, sport_id, name, country, created_at, updated_at
        FROM teams
        WHERE source_id = $1
          AND source_team_id = $2
        `,
        [sourceId, sourceTeamId]
    );

    return result.rows[0] ?? null;
}

export async function searchTeamsByName(searchTerm, db = pool) {
    const result = await db.query(
        `
        SELECT id, source_id, source_team_id, sport_id, name, country, created_at, updated_at
        FROM teams
        WHERE name ILIKE '%' || $1 || '%'
        ORDER BY name
        LIMIT 50
        `,
        [searchTerm]
    );

    return result.rows;
}

export async function createTeam(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO teams (
            source_id,
            source_team_id,
            sport_id,
            name,
            country
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, source_id, source_team_id, sport_id, name, country, created_at, updated_at
        `,
        [
            data.sourceId,
            data.sourceTeamId,
            data.sportId,
            data.name,
            data.country ?? null
        ]
    );

    return result.rows[0];
}

export async function upsertTeam(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO teams (
            source_id,
            source_team_id,
            sport_id,
            name,
            country
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (source_id, source_team_id)
        DO UPDATE SET
            sport_id = EXCLUDED.sport_id,
            name = EXCLUDED.name,
            country = EXCLUDED.country
        RETURNING id, source_id, source_team_id, sport_id, name, country, created_at, updated_at
        `,
        [
            data.sourceId,
            data.sourceTeamId,
            data.sportId,
            data.name,
            data.country ?? null
        ]
    );

    return result.rows[0];
}
