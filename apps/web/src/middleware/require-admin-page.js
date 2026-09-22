import { safeAdminPath } from '../utils/admin-path.js';

/**
 * Session gate for server-rendered admin pages.
 *
 * The JSON API middleware (requireAuth) answers 401; a browser should instead
 * be sent to the sign-in page and returned to the page it asked for.
 */
export function requireAdminPage(req, res, next) {
    if (req.session?.user?.id) {
        return next();
    }

    const target = safeAdminPath(req.originalUrl) ?? '/admin';

    res.redirect(302, `/admin/login?next=${encodeURIComponent(target)}`);
}
