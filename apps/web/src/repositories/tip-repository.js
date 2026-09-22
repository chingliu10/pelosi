import pool from '../db/postgres.js';
import { toLikePattern } from '../utils/sql-like.js';

export async function createTip(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO tips (
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            odds_captured_at,
            result,
            creation_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, NOW()), $12, $13)
        RETURNING
            id,
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            result,
            creation_type,
            odds_captured_at,
            published_at,
            settled_at,
            created_at,
            updated_at
        `,
        [
            data.matchId,
            data.sourceOddsId ?? null,
            data.sourceMarketId ?? null,
            data.sourceSelectionId ?? null,
            data.marketCode,
            data.marketName ?? null,
            data.selectionCode,
            data.selectionName ?? null,
            data.line ?? null,
            data.odds,
            data.oddsCapturedAt ?? null,
            data.result ?? 'pending',
            data.creationType ?? 'manual'
        ]
    );

    return result.rows[0];
}

export async function findTipById(id, db = pool) {
    const result = await db.query(
        `
        SELECT
            id,
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            result,
            creation_type,
            odds_captured_at,
            published_at,
            settled_at,
            created_at,
            updated_at
        FROM tips
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function findTipsByIds(ids, db = pool) {
    if (ids.length === 0) {
        return [];
    }

    const result = await db.query(
        `
        SELECT
            id,
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            result,
            creation_type,
            odds_captured_at,
            published_at,
            settled_at,
            created_at,
            updated_at
        FROM tips
        WHERE id = ANY($1::bigint[])
        `,
        [ids]
    );

    return result.rows;
}

export async function findTipsByMatchId(matchId, db = pool) {
    const result = await db.query(
        `
        SELECT
            id,
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            result,
            creation_type,
            odds_captured_at,
            published_at,
            settled_at,
            created_at,
            updated_at
        FROM tips
        WHERE match_id = $1
        ORDER BY created_at DESC
        `,
        [matchId]
    );

    return result.rows;
}

export async function findPendingTipsByMatchId(matchId, db = pool) {
    const result = await db.query(
        `
        SELECT
            id,
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            result,
            creation_type,
            odds_captured_at,
            published_at,
            settled_at,
            created_at,
            updated_at
        FROM tips
        WHERE match_id = $1
          AND result = 'pending'
        ORDER BY id
        `,
        [matchId]
    );

    return result.rows;
}

export async function listTips(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT
            t.id,
            t.match_id,
            t.source_odds_id,
            t.source_market_id,
            t.source_selection_id,
            t.market_code,
            t.market_name,
            t.selection_code,
            t.selection_name,
            t.line,
            t.odds,
            t.result,
            t.creation_type,
            t.odds_captured_at,
            t.published_at,
            t.settled_at,
            t.created_at,
            t.updated_at,
            m.source_match_id,
            m.starts_at,
            m.status AS match_status,
            m.home_score,
            m.away_score,
            ht.name AS home_team,
            at.name AS away_team,
            c.name AS competition
        FROM tips t
        JOIN matches m
            ON m.id = t.match_id
        JOIN teams ht
            ON ht.id = m.home_team_id
        JOIN teams at
            ON at.id = m.away_team_id
        LEFT JOIN competitions c
            ON c.id = m.competition_id
        WHERE ($1::varchar IS NULL OR t.result = $1)
          AND ($2::varchar IS NULL OR t.market_code = $2)
          AND ($3::varchar IS NULL OR t.creation_type = $3)
          AND ($4::bigint IS NULL OR t.match_id = $4)
          AND (
              $5::varchar IS NULL
              OR ht.name ILIKE $5 ESCAPE '\\'
              OR at.name ILIKE $5 ESCAPE '\\'
              OR t.selection_name ILIKE $5 ESCAPE '\\'
              OR t.market_name ILIKE $5 ESCAPE '\\'
          )
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $6
        OFFSET $7
        `,
        [
            filters.result ?? null,
            filters.marketCode ?? null,
            filters.creationType ?? null,
            filters.matchId ?? null,
            toLikePattern(filters.search),
            filters.limit ?? 50,
            filters.offset ?? 0
        ]
    );

    return result.rows;
}

export async function countTips(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT COUNT(*)::int AS total
        FROM tips t
        JOIN matches m
            ON m.id = t.match_id
        JOIN teams ht
            ON ht.id = m.home_team_id
        JOIN teams at
            ON at.id = m.away_team_id
        LEFT JOIN competitions c
            ON c.id = m.competition_id
        WHERE ($1::varchar IS NULL OR t.result = $1)
          AND ($2::varchar IS NULL OR t.market_code = $2)
          AND ($3::varchar IS NULL OR t.creation_type = $3)
          AND ($4::bigint IS NULL OR t.match_id = $4)
          AND (
              $5::varchar IS NULL
              OR ht.name ILIKE $5 ESCAPE '\\'
              OR at.name ILIKE $5 ESCAPE '\\'
              OR t.selection_name ILIKE $5 ESCAPE '\\'
              OR t.market_name ILIKE $5 ESCAPE '\\'
          )
        `,
        [
            filters.result ?? null,
            filters.marketCode ?? null,
            filters.creationType ?? null,
            filters.matchId ?? null,
            toLikePattern(filters.search)
        ]
    );

    return result.rows[0]?.total ?? 0;
}

/**
 * Result counters for the admin status tabs. The `result` filter is
 * deliberately not applied here so every tab can show its own count.
 */
export async function countTipsByResult(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT t.result, COUNT(*)::int AS total
        FROM tips t
        JOIN matches m
            ON m.id = t.match_id
        JOIN teams ht
            ON ht.id = m.home_team_id
        JOIN teams at
            ON at.id = m.away_team_id
        LEFT JOIN competitions c
            ON c.id = m.competition_id
        WHERE ($1::varchar IS NULL OR t.market_code = $1)
          AND ($2::varchar IS NULL OR t.creation_type = $2)
          AND ($3::bigint IS NULL OR t.match_id = $3)
          AND (
              $4::varchar IS NULL
              OR ht.name ILIKE $4 ESCAPE '\\'
              OR at.name ILIKE $4 ESCAPE '\\'
              OR t.selection_name ILIKE $4 ESCAPE '\\'
              OR t.market_name ILIKE $4 ESCAPE '\\'
          )
        GROUP BY t.result
        `,
        [
            filters.marketCode ?? null,
            filters.creationType ?? null,
            filters.matchId ?? null,
            toLikePattern(filters.search)
        ]
    );

    return result.rows;
}

export async function findTipWithMatchById(id, db = pool) {
    const result = await db.query(
        `
        SELECT
            t.id,
            t.match_id,
            t.source_odds_id,
            t.source_market_id,
            t.source_selection_id,
            t.market_code,
            t.market_name,
            t.selection_code,
            t.selection_name,
            t.line,
            t.odds,
            t.result,
            t.creation_type,
            t.odds_captured_at,
            t.published_at,
            t.settled_at,
            t.created_at,
            t.updated_at,
            m.source_match_id,
            m.starts_at,
            m.status AS match_status,
            m.home_score,
            m.away_score,
            ht.name AS home_team,
            at.name AS away_team,
            c.name AS competition
        FROM tips t
        JOIN matches m
            ON m.id = t.match_id
        JOIN teams ht
            ON ht.id = m.home_team_id
        JOIN teams at
            ON at.id = m.away_team_id
        LEFT JOIN competitions c
            ON c.id = m.competition_id
        WHERE t.id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

/**
 * Duplicate-import guard: the same TrueOdds selection (stable source odds id)
 * on the same local match is one tip.
 */
export async function findTipByMatchAndSourceOddsId(matchId, sourceOddsId, db = pool) {
    if (!sourceOddsId) {
        return null;
    }

    const result = await db.query(
        `
        SELECT id, match_id, source_odds_id, result, odds, created_at
        FROM tips
        WHERE match_id = $1
          AND source_odds_id = $2
        ORDER BY id
        LIMIT 1
        `,
        [matchId, sourceOddsId]
    );

    return result.rows[0] ?? null;
}


export async function updateTipResult(id, resultValue, db = pool) {
    const result = await db.query(
        `
        UPDATE tips
        SET
            result = $2::varchar,
            settled_at = CASE
                WHEN $2::varchar = 'pending' THEN NULL
                ELSE NOW()
            END
        WHERE id = $1
        RETURNING
            id,
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            result,
            creation_type,
            odds_captured_at,
            published_at,
            settled_at,
            created_at,
            updated_at
        `,
        [id, resultValue]
    );

    return result.rows[0] ?? null;
}

export async function markTipPublished(id, db = pool) {
    const result = await db.query(
        `
        UPDATE tips
        SET published_at = COALESCE(published_at, NOW())
        WHERE id = $1
        RETURNING
            id,
            match_id,
            source_odds_id,
            source_market_id,
            source_selection_id,
            market_code,
            market_name,
            selection_code,
            selection_name,
            line,
            odds,
            result,
            creation_type,
            odds_captured_at,
            published_at,
            settled_at,
            created_at,
            updated_at
        `,
        [id]
    );

    return result.rows[0] ?? null;
}
