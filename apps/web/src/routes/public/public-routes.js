import { Router } from 'express';
import {
    redirectHomeToSlips,
    redirectTipsToSlips,
    renderHistoryPage,
    renderPerformancePage,
    renderSlipsPage
} from '../../controllers/public-page-controller.js';

const router = Router();

router.get('/', redirectHomeToSlips);
router.get('/tips', redirectTipsToSlips);
router.get('/slips', renderSlipsPage);
router.get('/slips/:id', renderSlipsPage);
router.get('/performance', renderPerformancePage);
router.get('/history', renderHistoryPage);

export default router;
