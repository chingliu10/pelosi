import {
    getPublicTipById,
    getPublicTips
} from '../services/public-tip-service.js';

export async function listPublicTipsController(req, res) {
    try {
        const payload = await getPublicTips(req.query);

        res.json(payload);
    } catch (error) {
        sendError(res, error);
    }
}

export async function getPublicTipController(req, res) {
    try {
        const tip = await getPublicTipById(req.params.id);

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
    const status = Number.isInteger(error?.status) ? error.status : 500;

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
