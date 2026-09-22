import {
    getPublishedSlipPerformance,
    getPublishedSlipPerformanceHistory
} from '../repositories/performance-repository.js';

/**
 * Supported performance windows. `null` means all time, which is also the
 * default so `GET /api/v1/performance` keeps its original response.
 */
const rangeIntervals = new Map([
    ['all', null],
    ['7d', '7 days'],
    ['30d', '30 days'],
    ['90d', '90 days']
]);

export function resolvePerformanceRange(value) {
    const range = value === undefined || value === null || String(value).trim() === ''
        ? 'all'
        : String(value).trim().toLowerCase();

    if (!rangeIntervals.has(range)) {
        const error = new Error('Invalid range. Allowed values: all, 7d, 30d, 90d');
        error.status = 400;
        throw error;
    }

    return range;
}

/**
 * Headline performance metrics. Values are computed in PostgreSQL - the browser
 * only formats them.
 */
export async function getPublishedPerformance(rangeValue) {
    const range = resolvePerformanceRange(rangeValue);
    const performance = await getPublishedSlipPerformance(rangeIntervals.get(range));

    return {
        range,
        totalSlips: Number(performance.total_slips),
        wins: Number(performance.wins),
        losses: Number(performance.losses),
        unitsStaked: Number(performance.units_staked),
        totalReturnUnits: Number(performance.total_return_units),
        profitUnits: Number(performance.profit_units),
        roiPercentage: performance.roi_percentage === null
            ? null
            : Number(performance.roi_percentage),
        winRatePercentage: performance.win_rate_percentage === null
            ? null
            : Number(performance.win_rate_percentage),
        averageTotalOdds: performance.average_total_odds === null
            ? null
            : Number(performance.average_total_odds)
    };
}

/**
 * Cumulative profit trend. Buckets are daily for every range - the settled
 * history is small, and daily buckets stay honest (no interpolation, no
 * invented points). A coarser bucket can be added later if the history grows.
 */
export async function getPublishedPerformanceHistory(rangeValue) {
    const range = resolvePerformanceRange(rangeValue);
    const rows = await getPublishedSlipPerformanceHistory(rangeIntervals.get(range));

    return {
        period: 'day',
        range,
        points: rows.map((row) => ({
            date: toDateString(row.bucket),
            slips: Number(row.slips),
            wins: Number(row.wins),
            losses: Number(row.losses),
            unitsStaked: Number(row.units_staked),
            totalReturnUnits: Number(row.total_return_units),
            profitUnits: Number(row.profit_units),
            cumulativeProfitUnits: Number(row.cumulative_profit_units)
        }))
    };
}

function toDateString(value) {
    if (value instanceof Date) {
        // Defensive only: the repository returns an already formatted date.
        return value.toLocaleDateString('en-CA');
    }

    return String(value).slice(0, 10);
}
