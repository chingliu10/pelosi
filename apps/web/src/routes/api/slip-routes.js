import { Router } from 'express';
import {
    createSlipController,
    getSlip
} from '../../controllers/slip-controller.js';

const router = Router();

router.post('/', createSlipController);
router.get('/:id', getSlip);

export default router;
