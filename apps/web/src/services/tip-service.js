import {
    createTip as createTipRecord,
    findTipById,
    findTipsByIds,
    findTipsByMatchId,
    listTips,
    markTipPublished,
    updateTipResult
} from '../repositories/tip-repository.js';

const allowedTipResults = new Set(['pending', 'won', 'lost', 'void']);
const allowedCreationTypes = new Set(['manual', 'automatic']);

function validateTipInput(data) {
    if (!data.matchId) throw new Error('matchId is required');
    if (!data.marketCode) throw new Error('marketCode is required');
    if (!data.selectionCode) throw new Error('selectionCode is required');

    const odds = Number(data.odds);
    if (!Number.isFinite(odds) || odds <= 1) {
        throw new Error('odds must be greater than 1');
    }

    if (data.result && !allowedTipResults.has(data.result)) {
        throw new Error('Invalid tip result');
    }

    if (data.creationType && !allowedCreationTypes.has(data.creationType)) {
        throw new Error('Invalid creation type');
    }
}

export async function createTip(data) {
    validateTipInput(data);

    return createTipRecord({
        ...data,
        odds: Number(data.odds),
        result: data.result ?? 'pending',
        creationType: data.creationType ?? 'manual'
    });
}

export async function getTipById(id) {
    return findTipById(id);
}

export async function getTipsByIds(ids) {
    return findTipsByIds(ids);
}

export async function getTipsByMatchId(matchId) {
    return findTipsByMatchId(matchId);
}

export async function getTips(filters = {}) {
    return listTips(filters);
}

export async function settleTip(id, resultValue) {
    if (!allowedTipResults.has(resultValue)) {
        throw new Error('Invalid tip result');
    }

    return updateTipResult(id, resultValue);
}

export async function publishTip(id) {
    return markTipPublished(id);
}
