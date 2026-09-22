import { Router } from 'express';
import {
    getPublishedSlip,
    listPublishedSlips
} from '../../controllers/slip-controller.js';

const router = Router();

// Public, unauthenticated surface for the future follower website.
// Only slips with publication_status = 'published' are reachable here; drafts
// and hidden slips answer 404 rather than leaking their existence.
router.get('/', listPublishedSlips);
router.get('/:id', getPublishedSlip);

export default router;
