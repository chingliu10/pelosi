import {
    createSessionContext,
    sessionCookieName,
    sessionCookieOptions
} from '../config/session.js';
import {
    currentUser,
    login,
    logout
} from '../services/auth-service.js';

export async function loginController(req, res) {
    try {
        const user = await login(req.body, createSessionContext(req));

        res.json({ user });
    } catch (error) {
        sendError(res, error);
    }
}

export async function meController(req, res) {
    try {
        const session = createSessionContext(req);
        const user = await currentUser(session);

        if (!user) {
            // The session may reference a deleted or deactivated user.
            if (session.getUser()) {
                await logout(session);
            }

            return res.status(401).json({
                error: 'Authentication required'
            });
        }

        res.json({ user });
    } catch (error) {
        sendError(res, error);
    }
}

export async function logoutController(req, res) {
    try {
        await logout(createSessionContext(req));
        res.clearCookie(sessionCookieName, sessionCookieOptions());

        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
}

function sendError(res, error) {
    const status = resolveErrorStatus(error);

    if (status >= 500) {
        console.error(error);

        return res.status(status).json({
            error: 'Something went wrong'
        });
    }

    res.status(status).json({
        error: error.message
    });
}

function resolveErrorStatus(error) {
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600) {
        return error.status;
    }

    return 500;
}
