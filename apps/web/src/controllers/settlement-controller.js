import {
    getSettlementQueue,
    previewMatchSettlement,
    settleMatchFromTrueOdds
} from '../services/settlement-service.js';

export async function listSettlementQueue(req, res) {
    try {
        const queue = await getSettlementQueue(req.query);

        res.json(queue);
    } catch (error) {
        sendError(res, error);
    }
}

export async function previewSettlement(req, res) {
    try {
        const preview = await previewMatchSettlement(req.params.sourceMatchId);

        res.json(preview);
    } catch (error) {
        sendError(res, error);
    }
}

export async function settleMatch(req, res) {
    try {
        const result = await settleMatchFromTrueOdds(req.params.sourceMatchId);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
}

function sendError(res, error) {
    const status = resolveErrorStatus(error);

    if (status >= 500) {
        console.error(error);

        return res.status(status).json({
            error: error.message === 'fetch failed'
                ? 'TrueOdds is unavailable right now. Please try again in a moment.'
                : error.message
        });
    }

    res.status(status).json({
        error: error.message
    });
}

function resolveErrorStatus(error) {
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) {
        return error.status;
    }

    return /required|Invalid/i.test(String(error?.message || '')) ? 400 : 500;
}
