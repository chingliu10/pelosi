import { Router } from 'express';
import {
    listSettlementQueue,
    previewSettlement,
    settleMatch
} from '../../controllers/settlement-controller.js';
import { requireAuth } from '../../middleware/require-auth.js';

const router = Router();

// Read-only settlement monitor data (admin session required).
router.get('/matches', requireAuth, listSettlementQueue);
router.get('/matches/:sourceMatchId/preview', requireAuth, previewSettlement);

// The existing settlement engine.
router.post('/matches/:sourceMatchId', requireAuth, settleMatch);

export default router;
