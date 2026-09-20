import { Router } from 'express';
import {
    createSlipController,
    getSlip,
    hideSlip,
    listSlips,
    publishSlip
} from '../../controllers/slip-controller.js';

const router = Router();

router.get('/', listSlips);
router.post('/', createSlipController);
router.get('/:id', getSlip);
router.post('/:id/publish', publishSlip);
router.post('/:id/hide', hideSlip);

export default router;
