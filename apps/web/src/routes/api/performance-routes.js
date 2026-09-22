import { Router } from 'express';
import {
    getPerformance,
    getPerformanceHistory
} from '../../controllers/performance-controller.js';

const router = Router();

// Public historical financial data - no session and no TrueOdds involvement.
router.get('/', getPerformance);
router.get('/history', getPerformanceHistory);

export default router;
