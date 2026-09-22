/**
 * Shared browser helpers for the admin screens.
 *
 * Loaded before the per-page script so the Tips Manager, Slip Builder and Slip
 * Manager all format and render data the same way (no copy-pasted helpers).
 */
window.PelosiAdminUI = (() => {
    'use strict';

    const networkFailure = 'Could not reach the Pelosi server. Check that it is running and try again.';

    function el(tag, className, text) {
        const node = document.createElement(tag);

        if (className) node.className = className;

        if (text !== undefined && text !== null) node.textContent = String(text);

        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function formatDateTime(value) {
        if (!value) return '—';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return String(value);

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function formatDate(value) {
        if (!value) return '—';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return String(value);

        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
    }

    function formatOdds(value) {
        const odds = Number(value);

        return Number.isFinite(odds) ? odds.toFixed(2) : '—';
    }

    function formatTotalOdds(value) {
        const odds = Number(value);

        return Number.isFinite(odds) ? odds.toFixed(4) : '—';
    }

    function formatUnits(value) {
        const units = Number(value);

        if (!Number.isFinite(units)) return '—';

        return `${units > 0 ? '+' : ''}${units.toFixed(2)}u`;
    }

    function formatLabel(value) {
        const text = String(value ?? '').replace(/_/g, ' ').trim();

        return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '—';
    }

    function statusTone(value) {
        return ['pending', 'won', 'lost', 'void', 'draft', 'published', 'hidden'].includes(value)
            ? value
            : 'void';
    }

    function predictionLabel(tip) {
        const marketCode = String(tip.marketCode || '').toUpperCase();
        const selectionCode = String(tip.selectionCode || '').toUpperCase();
        const lineSuffix = tip.line === null || tip.line === undefined ? '' : ` ${tip.line}`;
        const match = tip.match ?? {};

        if (marketCode === 'MATCH_RESULT' || marketCode === '1X2') {
            if (selectionCode === 'HOME') return `${match.homeTeam} to win`;
            if (selectionCode === 'AWAY') return `${match.awayTeam} to win`;
            if (selectionCode === 'DRAW') return 'Draw';
        }

        if (marketCode === 'TOTAL_GOALS') {
            if (selectionCode === 'OVER') return `Over${lineSuffix} goals`;
            if (selectionCode === 'UNDER') return `Under${lineSuffix} goals`;
        }

        if (['BTTS', 'BOTH_TEAMS_TO_SCORE', 'GG_NG'].includes(marketCode)) {
            if (selectionCode === 'YES') return 'Both teams to score';
            if (selectionCode === 'NO') return 'Both teams not to score';
        }

        return tip.selectionName || formatLabel(tip.selectionCode);
    }

    function slipLabel(slip) {
        return slip.title || `Slip #${slip.id}`;
    }

    async function readJson(response) {
        const text = await response.text();

        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    function errorMessage(payload, fallback) {
        if (payload && typeof payload.error === 'string') return payload.error;
        if (payload && payload.error && typeof payload.error.message === 'string') return payload.error.message;

        return fallback;
    }

    /**
     * Turns an API failure into something an admin can act on. 5xx responses
     * usually mean a downstream/API problem, 404 keeps the server message.
     */
    function friendlyFailure(response, payload, action) {
        if (response.status === 404) {
            return errorMessage(payload, `Nothing found while trying to ${action}.`);
        }

        if (response.status >= 500) {
            return `The Pelosi server could not ${action} right now. Please try again in a moment.`;
        }

        return errorMessage(payload, `Could not ${action} (HTTP ${response.status}).`);
    }

    function setFeedback(node, message, tone) {
        node.textContent = message || '';
        node.classList.toggle('is-hidden', !message);
        node.classList.toggle('alert', Boolean(tone));
        node.classList.toggle('alert--error', tone === 'error');
        node.classList.toggle('alert--success', tone === 'success');
        node.classList.toggle('alert--pending', tone === 'pending');
    }

    function sessionExpiredAlert(nextPath) {
        const alert = el('div', 'alert alert--error');
        const link = el('a', 'alert__link', 'Go to sign in');

        link.href = `/admin/login?next=${encodeURIComponent(nextPath)}`;

        alert.append(
            el('p', 'alert__title', 'Session expired'),
            el('p', null, 'Sign in again to continue.'),
            link
        );

        return alert;
    }

    function previewRow(label, value, valueClass) {
        const row = el('div', 'preview__row');

        row.append(
            el('dt', 'preview__label', label),
            el('dd', `preview__value${valueClass ? ` ${valueClass}` : ''}`, value)
        );

        return row;
    }

    function field(label, value, modifier) {
        const wrapper = el('div', 'tip-card__field');

        wrapper.append(
            el('span', 'tip-card__field-label', label),
            el('span', `tip-card__field-value${modifier ? ` tip-card__field-value--${modifier}` : ''}`, value)
        );

        return wrapper;
    }

    return {
        networkFailure,
        el,
        clear,
        formatDate,
        formatDateTime,
        formatOdds,
        formatTotalOdds,
        formatUnits,
        formatLabel,
        statusTone,
        predictionLabel,
        slipLabel,
        readJson,
        errorMessage,
        friendlyFailure,
        setFeedback,
        sessionExpiredAlert,
        previewRow,
        field
    };
})();
