import {
    getTipById,
    getTips
} from '../services/tip-service.js';

export async function listTips(req, res) {
    try {
        const tips = await getTips(req.query);

        res.json(tips);
    } catch (error) {
        sendError(res, error);
    }
}

export async function getTip(req, res) {
    try {
        const tip = await getTipById(req.params.id);

        if (!tip) {
            return res.status(404).json({
                error: 'Tip not found'
            });
        }

        res.json(tip);
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
    const isClientError = /required|Invalid/i.test(message);

    return isClientError ? 400 : 500;
}
