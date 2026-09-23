const defaultTimezone = 'UTC';

export function appTimezone() {
    return process.env.APP_TIMEZONE || defaultTimezone;
}

export function todayInAppTimezone(date = new Date(), timezone = appTimezone()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

export function assertValidDateString(value) {
    const text = String(value || '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw badRequest('Invalid date. Use YYYY-MM-DD.');
    }

    const [year, month, day] = text.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        throw badRequest('Invalid date. Use YYYY-MM-DD.');
    }

    return text;
}

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;

    return error;
}
