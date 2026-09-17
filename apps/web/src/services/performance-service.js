import { getPublishedSlipPerformance } from '../repositories/performance-repository.js';

export async function getPublishedPerformance() {
    const performance = await getPublishedSlipPerformance();

    return {
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
