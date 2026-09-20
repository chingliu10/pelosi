import { settleMatchFromTrueOdds } from '../services/settlement-service.js';

export async function settleMatch(req, res) {
    try {
        const result = await settleMatchFromTrueOdds(req.params.sourceMatchId);

        res.json(result);
    } catch (error) {
        const status = error.status || (error.message.includes('required') ? 400 : 500);

        res.status(status).json({
            error: error.message
        });
    }
}
