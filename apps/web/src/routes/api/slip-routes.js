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

// Public read routes.
router.get('/', listSlips);
router.get('/:id', getSlip);

// Admin write routes.
router.post('/', requireAuth, createSlipController);
router.post('/:id/publish', requireAuth, publishSlip);
router.post('/:id/hide', requireAuth, hideSlip);

export default router;
