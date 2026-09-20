import {
    createSlip,
    getSlipById
} from '../services/slip-service.js';

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
        console.error(error);

        res.status(500).json({
            error: 'Something went wrong'
        });
    }
}

function sendError(res, error) {
    const isClientError = error.message.includes('required')
        || error.message.includes('Invalid')
        || error.message.includes('Duplicate')
        || error.message.includes('not found')
        || error.message.includes('positive integer');

    res.status(isClientError ? 400 : 500).json({
        error: error.message
    });
}
