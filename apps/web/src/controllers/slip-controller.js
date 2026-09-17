import { getSlipById } from '../services/slip-service.js';

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
        console.error(error);

        res.status(500).json({
            error: 'Something went wrong'
        });
    }
}