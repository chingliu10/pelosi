import pool from '../db/postgres.js';

export async function createSlip(data, db = pool) {
    const result = await db.query(
        `
        INSERT INTO slips (
            title,
            slip_date,
            total_odds,
            stake_units,
            creation_type
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
            id,
            title,
            slip_date,
            total_odds,
            stake_units,
            result,
            return_units,
            profit_units,
            creation_type,
            publication_status,
            published_at,
            settled_at,
            created_at,
            updated_at
        `,
        [
            data.title ?? null,
            data.slipDate,
            data.totalOdds,
            data.stakeUnits ?? 1,
            data.creationType ?? 'manual'
        ]
    );

    return result.rows[0];
}

export async function findSlipById(id, db = pool) {
    const result = await db.query(
        `
        SELECT
            id,
            title,
            slip_date,
            total_odds,
            stake_units,
            result,
            return_units,
            profit_units,
            creation_type,
            publication_status,
            published_at,
            settled_at,
            created_at,
            updated_at
        FROM slips
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function listSlips(filters = {}, db = pool) {
    const result = await db.query(
        `
        SELECT
            id,
            title,
            slip_date,
            total_odds,
            stake_units,
            result,
            return_units,
            profit_units,
            creation_type,
            publication_status,
            published_at,
            settled_at,
            created_at,
            updated_at
        FROM slips
        WHERE ($1::varchar IS NULL OR result = $1)
          AND ($2::varchar IS NULL OR publication_status = $2)
          AND ($3::varchar IS NULL OR creation_type = $3)
        ORDER BY slip_date DESC, id DESC
        LIMIT $4
        OFFSET $5
        `,
        [
            filters.result ?? null,
            filters.publicationStatus ?? null,
            filters.creationType ?? null,
            filters.limit ?? 50,
            filters.offset ?? 0
        ]
    );

    return result.rows;
}

export async function attachTipToSlip(slipId, tipId, legOrder, db = pool) {
    const result = await db.query(
        `
        INSERT INTO slip_tips (slip_id, tip_id, leg_order)
        VALUES ($1, $2, $3)
        RETURNING slip_id, tip_id, leg_order, created_at
        `,
        [slipId, tipId, legOrder]
    );

    return result.rows[0];
}

export async function attachTipsToSlip(slipId, orderedTipIds, db = pool) {
    if (orderedTipIds.length === 0) {
        return [];
    }

    const values = orderedTipIds
        .map((_, index) => `($1, $${index + 2}, ${index + 1})`)
        .join(', ');

    const result = await db.query(
        `
        INSERT INTO slip_tips (slip_id, tip_id, leg_order)
        VALUES ${values}
        RETURNING slip_id, tip_id, leg_order, created_at
        `,
        [slipId, ...orderedTipIds]
    );

    return result.rows;
}

export async function removeTipFromSlip(slipId, tipId, db = pool) {
    const result = await db.query(
        `
        DELETE FROM slip_tips
        WHERE slip_id = $1
          AND tip_id = $2
        RETURNING slip_id, tip_id, leg_order
        `,
        [slipId, tipId]
    );

    return result.rows[0] ?? null;
}

export async function updateSlipResult(id, data, db = pool) {
    const result = await db.query(
        `
        UPDATE slips
        SET
            result = $2,
            return_units = $3,
            profit_units = $4,
            settled_at = CASE
                WHEN $2 = 'pending' THEN NULL
                ELSE NOW()
            END
        WHERE id = $1
        RETURNING
            id,
            title,
            slip_date,
            total_odds,
            stake_units,
            result,
            return_units,
            profit_units,
            creation_type,
            publication_status,
            published_at,
            settled_at,
            created_at,
            updated_at
        `,
        [id, data.result, data.returnUnits ?? null, data.profitUnits ?? null]
    );

    return result.rows[0] ?? null;
}

export async function publishSlip(id, db = pool) {
    const result = await db.query(
        `
        UPDATE slips
        SET
            publication_status = 'published',
            published_at = COALESCE(published_at, NOW())
        WHERE id = $1
        RETURNING
            id,
            title,
            slip_date,
            total_odds,
            stake_units,
            result,
            return_units,
            profit_units,
            creation_type,
            publication_status,
            published_at,
            settled_at,
            created_at,
            updated_at
        `,
        [id]
    );

    return result.rows[0] ?? null;
}

export async function getSlipWithLegs(id, db = pool) {
    const result = await db.query(
        `
        SELECT
            s.id AS slip_id,
            s.title,
            s.slip_date,
            s.total_odds,
            s.stake_units,
            s.result AS slip_result,
            s.return_units,
            s.profit_units,
            s.creation_type AS slip_creation_type,
            s.publication_status,
            s.published_at AS slip_published_at,
            s.settled_at AS slip_settled_at,
            s.created_at AS slip_created_at,
            s.updated_at AS slip_updated_at,

            st.leg_order,

            t.id AS tip_id,
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
            t.result AS tip_result,
            t.creation_type AS tip_creation_type,
            t.odds_captured_at,
            t.published_at AS tip_published_at,
            t.settled_at AS tip_settled_at,

            m.starts_at,
            ht.name AS home_team,
            at.name AS away_team,
            c.name AS competition
        FROM slips s
        LEFT JOIN slip_tips st
            ON st.slip_id = s.id
        LEFT JOIN tips t
            ON t.id = st.tip_id
        LEFT JOIN matches m
            ON m.id = t.match_id
        LEFT JOIN teams ht
            ON ht.id = m.home_team_id
        LEFT JOIN teams at
            ON at.id = m.away_team_id
        LEFT JOIN competitions c
            ON c.id = m.competition_id
        WHERE s.id = $1
        ORDER BY st.leg_order
        `,
        [id]
    );

    return result.rows;
}

export async function findSlipsContainingTip(tipId, db = pool) {
    const result = await db.query(
        `
        SELECT
            s.id,
            s.title,
            s.slip_date,
            s.total_odds,
            s.stake_units,
            s.result,
            s.return_units,
            s.profit_units,
            s.creation_type,
            s.publication_status,
            s.published_at,
            s.settled_at,
            s.created_at,
            s.updated_at
        FROM slips s
        JOIN slip_tips st
            ON st.slip_id = s.id
        WHERE st.tip_id = $1
        ORDER BY s.slip_date DESC, s.id DESC
        `,
        [tipId]
    );

    return result.rows;
}
