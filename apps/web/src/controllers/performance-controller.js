import {
    getPublishedPerformance,
    getPublishedPerformanceHistory
} from '../services/performance-service.js';

export async function getPerformance(req, res) {
    try {
        const performance = await getPublishedPerformance(req.query.range);

        res.json(performance);
    } catch (error) {
        sendError(res, error);
    }
}

export async function getPerformanceHistory(req, res) {
    try {
        const history = await getPublishedPerformanceHistory(req.query.range);

        res.json(history);
    } catch (error) {
        sendError(res, error);
    }
}

function sendError(res, error) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

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
