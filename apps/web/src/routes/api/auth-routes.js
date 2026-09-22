import { Router } from 'express';
import {
    loginController,
    logoutController,
    meController
} from '../../controllers/auth-controller.js';

const router = Router();

router.post('/login', loginController);
router.get('/me', meController);
router.post('/logout', logoutController);

export default router;
