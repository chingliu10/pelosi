import { Router } from 'express';
import {
    redirectTipsToSlips,
    renderHistoryPage,
    renderHomePage,
    renderPerformancePage,
    renderSlipsPage
} from '../../controllers/public-page-controller.js';

const router = Router();

router.get('/', renderHomePage);
router.get('/tips', redirectTipsToSlips);
router.get('/slips', renderSlipsPage);
router.get('/slips/:id', renderSlipsPage);
router.get('/performance', renderPerformancePage);
router.get('/history', renderHistoryPage);

export default router;
