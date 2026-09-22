import { createSessionContext } from '../config/session.js';
import { currentUser, logout } from '../services/auth-service.js';
import { safeAdminPath } from '../utils/admin-path.js';

const defaultAdminPath = '/admin';

const sharedAdminScript = '/js/admin/ui-shared.js';

const navItems = [
    { key: 'dashboard', label: 'Dashboard', available: true, href: '/admin' },
    { key: 'tips', label: 'Tips', available: true, href: '/admin/tips' },
    { key: 'slips', label: 'Slips', available: true, href: '/admin/slips' },
    { key: 'settlement', label: 'Settlement', available: true, href: '/admin/settlement' },
    { key: 'performance', label: 'Performance', available: true, href: '/admin/performance' }
];

function buildNav(activeKey) {
    return navItems.map((item) => ({
        ...item,
        active: item.key === activeKey
    }));
}

/**
 * Renders the admin shell. This controller never talks to TrueOdds: the page
 * is a shell and every data call happens from the browser against the existing
 * Pelosi API routes.
 */
export async function renderCreateTipPage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));

        res.render('admin/create-tip', {
            layout: 'admin',
            pageTitle: 'Create tip',
            pageScripts: [sharedAdminScript, '/js/admin/create-tip.js'],
            nav: buildNav('tips'),
            user
        });
    } catch (error) {
        next(error);
    }
}

export async function renderDashboardPage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));

        res.render('admin/dashboard', {
            layout: 'admin',
            pageTitle: 'Dashboard',
            pageScripts: [sharedAdminScript, '/js/admin/dashboard.js'],
            nav: buildNav('dashboard'),
            user
        });
    } catch (error) {
        next(error);
    }
}

export async function renderTipsPage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));

        res.render('admin/tips', {
            layout: 'admin',
            pageTitle: 'Tips',
            pageScripts: [sharedAdminScript, '/js/admin/tips.js'],
            nav: buildNav('tips'),
            user
        });
    } catch (error) {
        next(error);
    }
}

export async function renderSlipsPage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));

        res.render('admin/slips', {
            layout: 'admin',
            pageTitle: 'Slips',
            pageScripts: [sharedAdminScript, '/js/admin/slips.js'],
            nav: buildNav('slips'),
            user
        });
    } catch (error) {
        next(error);
    }
}

export async function renderSlipBuilderPage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));

        res.render('admin/slip-builder', {
            layout: 'admin',
            pageTitle: 'Build slip',
            pageScripts: [sharedAdminScript, '/js/admin/slip-builder.js'],
            nav: buildNav('slips'),
            user
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Friendly deep link: /admin/slips/12 opens the manager with slip 12 selected.
 */
export function redirectToSlip(req, res) {
    const slipId = Number(req.params.id);

    if (!Number.isInteger(slipId) || slipId <= 0) {
        return res.redirect(302, '/admin/slips');
    }

    res.redirect(302, `/admin/slips?slip=${slipId}`);
}

export async function renderSettlementPage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));

        res.render('admin/settlement', {
            layout: 'admin',
            pageTitle: 'Settlement',
            pageScripts: [sharedAdminScript, '/js/admin/settlement.js'],
            nav: buildNav('settlement'),
            user
        });
    } catch (error) {
        next(error);
    }
}

export async function renderPerformancePage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));

        res.render('admin/performance', {
            layout: 'admin',
            pageTitle: 'Performance',
            pageScripts: [sharedAdminScript, '/js/admin/performance.js'],
            nav: buildNav('performance'),
            user
        });
    } catch (error) {
        next(error);
    }
}

export async function renderLoginPage(req, res, next) {
    try {
        const user = await currentUser(createSessionContext(req));
        const nextPath = safeAdminPath(req.query.next) ?? defaultAdminPath;

        if (user) {
            return res.redirect(302, nextPath);
        }

        res.render('admin/login', {
            layout: 'admin',
            pageTitle: 'Sign in',
            pageScripts: [sharedAdminScript, '/js/admin/login.js'],
            nav: [],
            user: null,
            nextPath
        });
    } catch (error) {
        next(error);
    }
}

export async function logoutPage(req, res, next) {
    try {
        await logout(createSessionContext(req));

        res.redirect(302, '/admin/login');
    } catch (error) {
        next(error);
    }
}
