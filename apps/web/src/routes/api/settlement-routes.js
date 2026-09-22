import { Router } from 'express';
import { settleMatch } from '../../controllers/settlement-controller.js';
import { requireAuth } from '../../middleware/require-auth.js';

const router = Router();

router.post('/matches/:sourceMatchId', requireAuth, settleMatch);

export default router;
