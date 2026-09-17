import pool from '../db/postgres.js';

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
            result,
            creation_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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

export async function listTips(filters = {}, db = pool) {
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
        WHERE ($1::varchar IS NULL OR result = $1)
          AND ($2::varchar IS NULL OR market_code = $2)
          AND ($3::varchar IS NULL OR creation_type = $3)
        ORDER BY created_at DESC
        LIMIT $4
        OFFSET $5
        `,
        [
            filters.result ?? null,
            filters.marketCode ?? null,
            filters.creationType ?? null,
            filters.limit ?? 50,
            filters.offset ?? 0
        ]
    );

    return result.rows;
}

export async function updateTipResult(id, resultValue, db = pool) {
    const result = await db.query(
        `
        UPDATE tips
        SET
            result = $2,
            settled_at = CASE
                WHEN $2 = 'pending' THEN NULL
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
