import { Router } from 'express';
import {
    createSlipController,
    getSlip,
    hideSlip,
    listSlips,
    publishSlip
} from '../../controllers/slip-controller.js';
import { requireAuth } from '../../middleware/require-auth.js';

const router = Router();

// Admin slip management: reads and writes both require the admin session.
// Anonymous published-only reads live on /api/v1/public/slips.
router.get('/', requireAuth, listSlips);
router.get('/:id', requireAuth, getSlip);

router.post('/', requireAuth, createSlipController);
router.post('/:id/publish', requireAuth, publishSlip);
router.post('/:id/hide', requireAuth, hideSlip);

export default router;
