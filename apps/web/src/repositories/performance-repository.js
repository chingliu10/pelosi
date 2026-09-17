import pool from '../db/postgres.js';

export async function getPublishedSlipPerformance(db = pool) {
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
        `
    );

    return result.rows[0];
}
