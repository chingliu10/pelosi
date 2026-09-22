import { Router } from 'express';
import {
    getTip,
    listTips
} from '../../controllers/tips-controller.js';
import { requireAuth } from '../../middleware/require-auth.js';

const router = Router();

// Tips are internal/admin data for now, so both routes need an admin session.
router.get('/', requireAuth, listTips);
router.get('/:id', requireAuth, getTip);

export default router;
