/**
 * Gate for admin write endpoints.
 *
 * The session payload intentionally holds only the minimum identity
 * (`req.session.user = { id, role }`), never a password, hash or full row.
 */
export function requireAuth(req, res, next) {
    if (!req.session?.user?.id) {
        return res.status(401).json({
            error: 'Authentication required'
        });
    }

    next();
}
