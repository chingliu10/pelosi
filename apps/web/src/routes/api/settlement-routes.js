import { Router } from 'express';
import { settleMatch } from '../../controllers/settlement-controller.js';

const router = Router();

router.post('/matches/:sourceMatchId', settleMatch);

export default router;
