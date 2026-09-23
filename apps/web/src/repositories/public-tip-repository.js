import pool from '../db/postgres.js';

const publicTipColumns = `
    t.id,
    t.result,
    t.odds,
    t.market_code,
    t.market_name,
    t.selection_code,
    t.selection_name,
    t.line,
    t.settled_at,
    m.starts_at,
    m.status AS match_status,
    m.home_score,
    m.away_score,
    ht.name AS home_team,
    at.name AS away_team,
    c.name AS competition
`;

const publicTipJoins = `
    FROM tips t
    JOIN matches m
        ON m.id = t.match_id
    JOIN teams ht
        ON ht.id = m.home_team_id
    JOIN teams at
        ON at.id = m.away_team_id
    LEFT JOIN competitions c
        ON c.id = m.competition_id
`;

const publicTipVisibility = `
    EXISTS (
        SELECT 1
        FROM slip_tips st
        JOIN slips s
            ON s.id = st.slip_id
        WHERE st.tip_id = t.id
          AND s.publication_status = 'published'
    )
`;

export async function listPublicTips(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT ${publicTipColumns}
        ${publicTipJoins}
        WHERE ${publicTipVisibility}
          AND (m.starts_at AT TIME ZONE $1)::date = $2::date
          AND ($3::varchar IS NULL OR t.result = $3)
        ORDER BY m.starts_at ASC, t.id ASC
        `,
        [
            filters.timezone,
            filters.date,
            filters.result ?? null
        ]
    );

    return result.rows;
}

export async function countPublicTipsByResult(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT t.result, COUNT(DISTINCT t.id)::int AS total
        ${publicTipJoins}
        WHERE ${publicTipVisibility}
          AND (m.starts_at AT TIME ZONE $1)::date = $2::date
        GROUP BY t.result
        `,
        [filters.timezone, filters.date]
    );

    return result.rows;
}

export async function findPublicTipById(id, db = pool) {
    const result = await db.query(
        `
        SELECT ${publicTipColumns}
        ${publicTipJoins}
        WHERE ${publicTipVisibility}
          AND t.id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}
