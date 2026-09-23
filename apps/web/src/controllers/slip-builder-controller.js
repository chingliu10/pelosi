import {
    addBuilderSelection,
    clearBuilder,
    getBuilder,
    removeBuilderSelection,
    saveBuilderSlip
} from '../services/slip-builder-service.js';

export async function getSlipBuilder(req, res) {
    try {
        res.json(getBuilder(req));
    } catch (error) {
        sendError(res, error);
    }
}

export async function addSlipBuilderSelection(req, res) {
    try {
        const builder = await addBuilderSelection(req, req.body);

        await saveSession(req);
        res.json(builder);
    } catch (error) {
        sendError(res, error);
    }
}

export async function removeSlipBuilderSelection(req, res) {
    try {
        const builder = removeBuilderSelection(req, req.params.sourceOddsId);

        await saveSession(req);
        res.json(builder);
    } catch (error) {
        sendError(res, error);
    }
}

export async function clearSlipBuilder(req, res) {
    try {
        const builder = clearBuilder(req);

        await saveSession(req);
        res.json(builder);
    } catch (error) {
        sendError(res, error);
    }
}

export async function saveSlipBuilder(req, res) {
    try {
        const result = await saveBuilderSlip(req, req.body);

        await saveSession(req);
        res.status(201).json(result);
    } catch (error) {
        sendError(res, error);
    }
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((error) => (error ? reject(error) : resolve()));
    });
}

function sendError(res, error) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

    if (status >= 500) {
        console.error(error);

        return res.status(status).json({
            error: error.message === 'fetch failed'
                ? 'TrueOdds is unavailable right now. Please try again in a moment.'
                : 'Something went wrong'
        });
    }

    res.status(status).json({
        error: error.message
    });
}
