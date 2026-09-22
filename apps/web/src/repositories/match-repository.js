import pool from '../db/postgres.js';
import { toLikePattern } from '../utils/sql-like.js';

const matchColumns = `
    m.id,
    m.source_id,
    m.source_match_id,
    m.sport_id,
    m.competition_id,
    m.home_team_id,
    m.away_team_id,
    m.starts_at,
    m.home_score,
    m.away_score,
    m.status,
    m.created_at,
    m.updated_at
`;

export async function findMatchById(id, db = pool) {
    const result = await db.query(
        `
        SELECT ${matchColumns}
        FROM matches m
        WHERE m.id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function findMatchBySourceMatchId(sourceId, sourceMatchId, db = pool) {
    const result = await db.query(
        `
        SELECT ${matchColumns}
        FROM matches m
        WHERE m.source_id = $1
          AND m.source_match_id = $2
        `,
        [sourceId, sourceMatchId]
    );

    return result.rows[0] ?? null;
}

export async function createMatch(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO matches (
            source_id,
            source_match_id,
            sport_id,
            competition_id,
            home_team_id,
            away_team_id,
            starts_at,
            home_score,
            away_score,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
            id,
            source_id,
            source_match_id,
            sport_id,
            competition_id,
            home_team_id,
            away_team_id,
            starts_at,
            home_score,
            away_score,
            status,
            created_at,
            updated_at
        `,
        [
            data.sourceId,
            data.sourceMatchId,
            data.sportId,
            data.competitionId ?? null,
            data.homeTeamId,
            data.awayTeamId,
            data.startsAt,
            data.homeScore ?? null,
            data.awayScore ?? null,
            data.status ?? 'scheduled'
        ]
    );

    return result.rows[0];
}

export async function upsertMatch(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO matches (
            source_id,
            source_match_id,
            sport_id,
            competition_id,
            home_team_id,
            away_team_id,
            starts_at,
            home_score,
            away_score,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (source_id, source_match_id)
        DO UPDATE SET
            sport_id = EXCLUDED.sport_id,
            competition_id = EXCLUDED.competition_id,
            home_team_id = EXCLUDED.home_team_id,
            away_team_id = EXCLUDED.away_team_id,
            starts_at = EXCLUDED.starts_at,
            home_score = EXCLUDED.home_score,
            away_score = EXCLUDED.away_score,
            status = EXCLUDED.status
        RETURNING
            id,
            source_id,
            source_match_id,
            sport_id,
            competition_id,
            home_team_id,
            away_team_id,
            starts_at,
            home_score,
            away_score,
            status,
            created_at,
            updated_at
        `,
        [
            data.sourceId,
            data.sourceMatchId,
            data.sportId,
            data.competitionId ?? null,
            data.homeTeamId,
            data.awayTeamId,
            data.startsAt,
            data.homeScore ?? null,
            data.awayScore ?? null,
            data.status ?? 'scheduled'
        ]
    );

    return result.rows[0];
}

export async function updateMatchScoreAndStatus(id, data, db = pool) {
    const result = await db.query(
        `
        UPDATE matches
        SET
            home_score = $2,
            away_score = $3,
            status = $4
        WHERE id = $1
        RETURNING
            id,
            source_id,
            source_match_id,
            sport_id,
            competition_id,
            home_team_id,
            away_team_id,
            starts_at,
            home_score,
            away_score,
            status,
            created_at,
            updated_at
        `,
        [id, data.homeScore, data.awayScore, data.status]
    );

    return result.rows[0] ?? null;
}

export async function searchMatches(searchTerm, db = pool) {
    const result = await db.query(
        `
        SELECT
            m.id,
            m.source_id,
            m.source_match_id,
            m.sport_id,
            m.competition_id,
            m.home_team_id,
            ht.name AS home_team,
            m.away_team_id,
            at.name AS away_team,
            c.name AS competition,
            m.starts_at,
            m.home_score,
            m.away_score,
            m.status,
            m.created_at,
            m.updated_at
        FROM matches m
        JOIN teams ht
            ON ht.id = m.home_team_id
        JOIN teams at
            ON at.id = m.away_team_id
        LEFT JOIN competitions c
            ON c.id = m.competition_id
        WHERE ht.name ILIKE '%' || $1 || '%'
           OR at.name ILIKE '%' || $1 || '%'
           OR c.name ILIKE '%' || $1 || '%'
        ORDER BY m.starts_at DESC
        LIMIT 50
        `,
        [searchTerm]
    );

    return result.rows;
}

/**
 * Settlement queue: Pelosi matches that still have pending tips, with how many
 * pending slips those tips affect. Purely local data - no TrueOdds calls, so
 * rendering the queue never fans out external requests.
 */
export async function listSettlementQueue(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT
            m.id AS match_id,
            m.source_match_id,
            ht.name AS home_team,
            at.name AS away_team,
            c.name AS competition,
            m.starts_at,
            m.status AS local_status,
            m.home_score,
            m.away_score,
            COUNT(DISTINCT t.id)::int AS pending_tip_count,
            COUNT(DISTINCT s.id)::int AS affected_pending_slip_count
        FROM matches m
        JOIN teams ht
            ON ht.id = m.home_team_id
        JOIN teams at
            ON at.id = m.away_team_id
        LEFT JOIN competitions c
            ON c.id = m.competition_id
        JOIN tips t
            ON t.match_id = m.id
           AND t.result = 'pending'
        LEFT JOIN slip_tips st
            ON st.tip_id = t.id
        LEFT JOIN slips s
            ON s.id = st.slip_id
           AND s.result = 'pending'
        WHERE ($1::varchar IS NULL OR m.status = $1)
          AND (
              $2::varchar IS NULL
              OR ht.name ILIKE $2 ESCAPE '\\'
              OR at.name ILIKE $2 ESCAPE '\\'
              OR c.name ILIKE $2 ESCAPE '\\'
          )
        GROUP BY m.id, ht.name, at.name, c.name
        ORDER BY m.starts_at ASC, m.id ASC
        LIMIT $3
        OFFSET $4
        `,
        [
            filters.localStatus ?? null,
            toLikePattern(filters.search),
            filters.limit ?? 50,
            filters.offset ?? 0
        ]
    );

    return result.rows;
}

export async function countSettlementQueue(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT COUNT(*)::int AS total
        FROM (
            SELECT m.id
            FROM matches m
            JOIN teams ht
                ON ht.id = m.home_team_id
            JOIN teams at
                ON at.id = m.away_team_id
            LEFT JOIN competitions c
                ON c.id = m.competition_id
            JOIN tips t
                ON t.match_id = m.id
               AND t.result = 'pending'
            WHERE ($1::varchar IS NULL OR m.status = $1)
              AND (
                  $2::varchar IS NULL
                  OR ht.name ILIKE $2 ESCAPE '\\'
                  OR at.name ILIKE $2 ESCAPE '\\'
                  OR c.name ILIKE $2 ESCAPE '\\'
              )
            GROUP BY m.id
        ) AS settlement_queue
        `,
        [
            filters.localStatus ?? null,
            toLikePattern(filters.search)
        ]
    );

    return result.rows[0]?.total ?? 0;
}
