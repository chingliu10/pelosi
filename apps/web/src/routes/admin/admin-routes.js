import { Router } from 'express';
import {
    logoutPage,
    renderCreateTipPage,
    renderDashboardPage,
    renderLoginPage,
    renderPerformancePage,
    renderSettlementPage,
    renderSlipBuilderPage,
    renderSlipsPage,
    redirectToDraftSlips,
    renderTipsPage,
    redirectToSlip
} from '../../controllers/admin-page-controller.js';
import { requireAdminPage } from '../../middleware/require-admin-page.js';

const router = Router();

// The dashboard is the admin landing page.
router.get('/', requireAdminPage, renderDashboardPage);

router.get('/login', renderLoginPage);
router.post('/logout', logoutPage);

// Admin screens require a session; unauthenticated browsers are redirected to
// the sign-in page instead of receiving a JSON 401.
router.get('/tips', requireAdminPage, renderTipsPage);
router.get('/tips/new', requireAdminPage, renderCreateTipPage);

router.get('/slips', requireAdminPage, renderSlipsPage);
router.get('/slips/new', requireAdminPage, renderSlipBuilderPage);
router.get('/slips/drafts', requireAdminPage, redirectToDraftSlips);
router.get('/slips/unpublished', requireAdminPage, redirectToDraftSlips);
router.get('/slips/:id', requireAdminPage, redirectToSlip);

router.get('/settlement', requireAdminPage, renderSettlementPage);
router.get('/performance', requireAdminPage, renderPerformancePage);

export default router;
