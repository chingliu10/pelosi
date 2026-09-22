import { Router } from 'express';
import { getDashboard } from '../../../controllers/dashboard-controller.js';
import { requireAuth } from '../../../middleware/require-auth.js';

const router = Router();

// Operational overview: admin session required, no TrueOdds involvement.
router.get('/', requireAuth, getDashboard);

export default router;
