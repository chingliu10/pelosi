import {
    createSlip,
    getSlipById,
    getSlips,
    hideSlip as hideSlipRecord,
    publishSlip as publishSlipRecord
} from '../services/slip-service.js';

export async function listSlips(req, res) {
    try {
        const slips = await getSlips(req.query);

        res.json(slips);
    } catch (error) {
        sendError(res, error);
    }
}

export async function createSlipController(req, res) {
    try {
        const slip = await createSlip(req.body);

        res.status(201).json(slip);
    } catch (error) {
        sendError(res, error);
    }
}

export async function getSlip(req, res) {
    try {
        const slip = await getSlipById(req.params.id);

        if (!slip) {
            return res.status(404).json({
                error: 'Slip not found'
            });
        }

        res.json(slip);
    } catch (error) {
        sendError(res, error);
    }
}

export async function publishSlip(req, res) {
    try {
        const slip = await publishSlipRecord(req.params.id);

        if (!slip) {
            return res.status(404).json({
                error: 'Slip not found'
            });
        }

        res.json(slip);
    } catch (error) {
        sendError(res, error);
    }
}

export async function hideSlip(req, res) {
    try {
        const slip = await hideSlipRecord(req.params.id);

        if (!slip) {
            return res.status(404).json({
                error: 'Slip not found'
            });
        }

        res.json(slip);
    } catch (error) {
        sendError(res, error);
    }
}

function sendError(res, error) {
    const status = resolveErrorStatus(error);

    if (status >= 500) {
        console.error(error);

        return res.status(status).json({
            error: 'Something went wrong'
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

    const message = String(error?.message || '');
    const isClientError = /required|Invalid|Duplicate|not found|positive integer/i.test(message);

    return isClientError ? 400 : 500;
}
