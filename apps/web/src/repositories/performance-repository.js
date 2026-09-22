import pool from '../db/postgres.js';

/**
 * All-time (default) or ranged published-settlement performance.
 *
 * Counting rules are unchanged: only `publication_status = 'published'` slips
 * with `result IN ('won','lost')` contribute. Draft, hidden, pending and void
 * slips never do.
 *
 * The optional range filter uses `settled_at` - the moment the wager was
 * realised - not `updated_at`, so editing an old slip can never move it into a
 * recent window.
 *
 * @param {string|null} interval PostgreSQL interval such as '7 days', or null for all time
 */
export async function getPublishedSlipPerformance(interval = null, db = pool) {
    const result = await db.query(
        `
        SELECT
            COUNT(*) FILTER (
                WHERE result IN ('won', 'lost')
            ) AS total_slips,

            COUNT(*) FILTER (
                WHERE result = 'won'
            ) AS wins,

            COUNT(*) FILTER (
                WHERE result = 'lost'
            ) AS losses,

            COALESCE(
                SUM(stake_units) FILTER (
                    WHERE result IN ('won', 'lost')
                ),
                0
            ) AS units_staked,

            COALESCE(
                SUM(return_units) FILTER (
                    WHERE result IN ('won', 'lost')
                ),
                0
            ) AS total_return_units,

            COALESCE(
                SUM(profit_units) FILTER (
                    WHERE result IN ('won', 'lost')
                ),
                0
            ) AS profit_units,

            ROUND(
                (
                    SUM(profit_units) FILTER (
                        WHERE result IN ('won', 'lost')
                    )
                    /
                    NULLIF(
                        SUM(stake_units) FILTER (
                            WHERE result IN ('won', 'lost')
                        ),
                        0
                    )
                ) * 100,
                2
            ) AS roi_percentage,

            ROUND(
                (
                    COUNT(*) FILTER (
                        WHERE result = 'won'
                    )::numeric
                    /
                    NULLIF(
                        COUNT(*) FILTER (
                            WHERE result IN ('won', 'lost')
                        ),
                        0
                    )
                ) * 100,
                2
            ) AS win_rate_percentage,

            ROUND(
                AVG(total_odds) FILTER (
                    WHERE result IN ('won', 'lost')
                ),
                4
            ) AS average_total_odds
        FROM slips
        WHERE publication_status = 'published'
          AND ($1::varchar IS NULL OR settled_at >= NOW() - ($1)::interval)
        `,
        [interval]
    );

    return result.rows[0];
}

/**
 * Daily buckets of published settled slips with a SQL-computed running profit.
 * Only eligible slips are aggregated, and buckets are returned chronologically.
 */
export async function getPublishedSlipPerformanceHistory(interval = null, db = pool) {
    const result = await db.query(
        `
        SELECT
            -- Formatted in the database so the bucket label cannot be shifted by
            -- a JavaScript/UTC conversion of a timestamp at local midnight.
            to_char(date_trunc('day', settled_at), 'YYYY-MM-DD') AS bucket,
            COUNT(*)::int AS slips,
            COUNT(*) FILTER (WHERE result = 'won')::int AS wins,
            COUNT(*) FILTER (WHERE result = 'lost')::int AS losses,
            SUM(stake_units) AS units_staked,
            SUM(return_units) AS total_return_units,
            SUM(profit_units) AS profit_units,
            SUM(SUM(profit_units)) OVER (
                ORDER BY date_trunc('day', settled_at)
            ) AS cumulative_profit_units
        FROM slips
        WHERE publication_status = 'published'
          AND result IN ('won', 'lost')
          AND settled_at IS NOT NULL
          AND ($1::varchar IS NULL OR settled_at >= NOW() - ($1)::interval)
        GROUP BY date_trunc('day', settled_at)
        ORDER BY date_trunc('day', settled_at)
        `,
        [interval]
    );

    return result.rows;
}
