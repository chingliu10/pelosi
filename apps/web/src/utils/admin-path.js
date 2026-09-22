/**
 * Only admin paths may be used as a post-login redirect target, so the login
 * page cannot be turned into an open redirect.
 */
export function safeAdminPath(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed.startsWith('/admin')) {
        return null;
    }

    // Reject protocol-relative and backslash tricks such as //evil.example
    if (trimmed.startsWith('//') || trimmed.includes('\\') || trimmed.includes('://')) {
        return null;
    }

    return trimmed;
}
