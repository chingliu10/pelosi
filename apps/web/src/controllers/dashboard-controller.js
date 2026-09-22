import { getDashboardOverview } from '../services/dashboard-service.js';

export async function getDashboard(req, res) {
    try {
        const dashboard = await getDashboardOverview();

        res.json(dashboard);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: 'Something went wrong'
        });
    }
}
