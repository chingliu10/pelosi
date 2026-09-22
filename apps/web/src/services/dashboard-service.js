import { getPublishedPerformance } from './performance-service.js';
import { getSettlementQueue } from './settlement-service.js';
import { getSlips } from './slip-service.js';
import { getTips } from './tip-service.js';

/**
 * Admin dashboard overview.
 *
 * This is an aggregator: every number comes from the service that owns the rule
 * (tips, slips, settlement queue, performance). No dashboard SQL re-implements
 * those definitions and nothing here contacts TrueOdds - the dashboard is built
 * entirely from local Pelosi state.
 *
 * Each widget is loaded independently so one failing query degrades a single
 * card instead of blanking the whole page.
 */
const recentLimit = 5;

export async function getDashboardOverview() {
    const errors = {};

    const [pendingTips, draftSlips, publishedSlips, recentTips, recentSlips, settlement, performance] = await Promise.all([
        attempt('pendingTips', () => getTips({ result: 'pending', limit: 1 }), errors),
        attempt('draftSlips', () => getSlips({ publicationStatus: 'draft', limit: 1 }), errors),
        attempt('publishedSlips', () => getSlips({ publicationStatus: 'published', limit: 1 }), errors),
        attempt('recentTips', () => getTips({ limit: recentLimit }), errors),
        attempt('recentSlips', () => getSlips({ limit: recentLimit }), errors),
        attempt('settlementQueue', () => getSettlementQueue({ limit: recentLimit }), errors),
        attempt('performance', () => getPublishedPerformance('all'), errors)
    ]);

    return {
        summary: {
            pendingTips: pendingTips?.total ?? null,
            draftSlips: draftSlips?.total ?? null,
            publishedSlips: publishedSlips?.total ?? null,
            settlementMatches: settlement?.total ?? null
        },
        // Result breakdown comes from the same tips service call (its counts
        // intentionally ignore the `result` filter).
        tipCounts: pendingTips?.counts ?? null,
        performance: performance ?? null,
        recentTips: recentTips?.tips ?? null,
        recentSlips: recentSlips?.slips ?? null,
        settlementQueue: settlement?.matches ?? null,
        settlementQueueTotal: settlement?.total ?? null,
        limits: { recentActivity: recentLimit, settlementPreview: recentLimit },
        errors
    };
}

async function attempt(name, loader, errors) {
    try {
        return await loader();
    } catch (error) {
        errors[name] = 'unavailable';
        console.warn(`Dashboard widget "${name}" failed:`, error?.message);

        return null;
    }
}
