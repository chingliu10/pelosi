import { Router } from 'express';
import { getPerformance } from '../../controllers/performance-controller.js';

const router = Router();

router.get('/', getPerformance);

export default router;
