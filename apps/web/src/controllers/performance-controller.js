import { getPublishedPerformance } from '../services/performance-service.js';

export async function getPerformance(req, res) {
    try {
        const performance = await getPublishedPerformance();

        res.json(performance);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Something went wrong'
        });
    }
}
