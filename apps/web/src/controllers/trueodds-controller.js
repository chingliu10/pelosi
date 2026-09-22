import {
    getMatchFromTrueOdds,
    getMarketsFromTrueOdds,
    getResultByTrueOddsIdFromTrueOdds,
    getResultsFromTrueOdds,
    importTipFromTrueOddsMarkets,
    searchMatchesFromTrueOdds
} from '../services/trueodds-service.js';

export async function searchTrueOddsMatches(req, res) {
    try {
        const result = await searchMatchesFromTrueOdds(req.query);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
}

export async function getTrueOddsMarkets(req, res) {
    try {
        const result = await getMarketsFromTrueOdds(req.params.trueOddsId);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
}

export async function getTrueOddsMatch(req, res) {
    try {
        const result = await getMatchFromTrueOdds(req.params.matchId);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
}

export async function importTrueOddsTip(req, res) {
    try {
        const result = await importTipFromTrueOddsMarkets(req.body);

        res.status(201).json(result);
    } catch (error) {
        if (error.existingTipId !== undefined && error.existingTipId !== null) {
            return res.status(error.status || 409).json({
                error: error.message,
                existingTipId: error.existingTipId
            });
        }

        sendError(res, error);
    }
}

export async function getTrueOddsResults(req, res) {
    try {
        const result = await getResultsFromTrueOdds(req.query);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
}

export async function getTrueOddsResultById(req, res) {
    try {
        const result = await getResultByTrueOddsIdFromTrueOdds(
            req.params.trueOddsId,
            req.query
        );

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
}

function sendError(res, error) {
    const status = error.status || (
        error.message.includes('required')
        || error.message.includes('Invalid')
        || error.message.includes('missing required fields')
            ? 400
            : 500
    );

    res.status(status).json({
        error: error.message
    });
}
