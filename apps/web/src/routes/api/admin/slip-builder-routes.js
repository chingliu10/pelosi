import { Router } from 'express';
import {
    addSlipBuilderSelection,
    clearSlipBuilder,
    getSlipBuilder,
    removeSlipBuilderSelection,
    saveSlipBuilder
} from '../../../controllers/slip-builder-controller.js';
import { requireAuth } from '../../../middleware/require-auth.js';

const router = Router();

router.get('/', requireAuth, getSlipBuilder);
router.post('/selections', requireAuth, addSlipBuilderSelection);
router.delete('/selections/:sourceOddsId', requireAuth, removeSlipBuilderSelection);
router.delete('/', requireAuth, clearSlipBuilder);
router.post('/save', requireAuth, saveSlipBuilder);

export default router;
