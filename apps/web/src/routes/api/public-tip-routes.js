import { Router } from 'express';
import {
    getPublicTipController,
    listPublicTipsController
} from '../../controllers/public-tip-controller.js';

const router = Router();

router.get('/', listPublicTipsController);
router.get('/:id', getPublicTipController);

export default router;
