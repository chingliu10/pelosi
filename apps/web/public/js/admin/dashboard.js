/**
 * Admin Dashboard.
 *
 * One authenticated call to GET /api/v1/admin/dashboard, which aggregates the
 * existing tips, slips, settlement-queue and performance services. Nothing here
 * recalculates those rules and nothing on this screen contacts TrueOdds - the
 * dashboard is built entirely from local Pelosi state.
 */
(() => {
    'use strict';

    const ui = window.PelosiAdminUI;

    const placeholder = '—';
    const quickActions = [
        { label: '+ Create tip', href: '/admin/tips/new', primary: true },
        { label: 'Build slip', href: '/admin/slips/new' },
        { label: 'Review settlement', href: '/admin/settlement' },
        { label: 'View performance', href: '/admin/performance' }
    ];

    const state = {
        loading: true,
        error: '',
        sessionExpired: false,
        data: null
    };

    const els = {
        refresh: document.getElementById('dashboard-refresh'),
        feedback: document.getElementById('dashboard-feedback'),
        summaryCards: document.getElementById('summary-cards'),
        attention: document.getElementById('attention-list'),
        quickActions: document.getElementById('quick-actions'),
        performance: document.getElementById('performance-snapshot'),
        queueEmpty: document.getElementById('queue-preview-empty'),
        queue: document.getElementById('queue-preview'),
        recentTipsEmpty: document.getElementById('recent-tips-empty'),
        recentTips: document.getElementById('recent-tips'),
        recentSlipsEmpty: document.getElementById('recent-slips-empty'),
        recentSlips: document.getElementById('recent-slips')
    };

    /* ---------------- data ---------------- */

    async function load() {
        state.loading = true;
        state.error = '';
        state.sessionExpired = false;
        render();

        let response = null;

        try {
            response = await fetch('/api/v1/admin/dashboard', { credentials: 'same-origin' });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, 'load the dashboard'));
            }

            if (!payload || typeof payload !== 'object') {
                throw new Error('The dashboard response could not be read.');
            }

            state.data = payload;
        } catch (error) {
            state.error = state.sessionExpired
                ? error.message
                : (response ? error.message : ui.networkFailure);
        } finally {
            state.loading = false;
            render();
        }
    }

    /* ---------------- formatting ---------------- */

    function isNumber(value) {
        return value !== null && value !== undefined && Number.isFinite(Number(value));
    }

    function formatSigned(value, suffix = '', decimals = 2) {
        if (!isNumber(value)) return placeholder;

        const number = Number(value);

        return `${number > 0 ? '+' : ''}${number.toFixed(decimals)}${suffix}`;
    }

    function formatPlain(value, suffix = '', decimals = 2) {
        if (!isNumber(value)) return placeholder;

        return `${Number(value).toFixed(decimals)}${suffix}`;
    }

    function toneOf(value) {
        if (!isNumber(value)) return 'neutral';

        const number = Number(value);

        if (number > 0) return 'positive';
        if (number < 0) return 'negative';

        return 'neutral';
    }

    function count(value) {
        return isNumber(value) ? String(Number(value)) : placeholder;
    }

    /* ---------------- rendering ---------------- */

    function render() {
        renderFeedback();

        if (state.loading) {
            return;
        }

        renderSummary();
        renderAttention();
        renderQuickActions();
        renderPerformance();
        renderQueue();
        renderRecentTips();
        renderRecentSlips();
    }

    function renderFeedback() {
        if (state.sessionExpired) {
            els.feedback.className = 'feedback';
            ui.clear(els.feedback);
            els.feedback.appendChild(ui.sessionExpiredAlert('/admin'));
            return;
        }

        if (state.loading) {
            ui.setFeedback(els.feedback, 'Loading dashboard…', '');
            return;
        }

        if (state.error) {
            ui.setFeedback(els.feedback, state.error, 'error');
            return;
        }

        ui.setFeedback(els.feedback, '', '');
    }

    function renderSummary() {
        ui.clear(els.summaryCards);

        if (state.loading || state.error || state.sessionExpired) {
            return;
        }

        const summary = state.data?.summary ?? {};
        const cards = [
            {
                label: 'Pending tips',
                value: count(summary.pendingTips),
                hint: summary.pendingTips === 0
                    ? 'No pending tips. Create a tip to get started.'
                    : 'Tips waiting for a result',
                href: '/admin/tips?result=pending',
                linkLabel: 'View tips',
                failed: state.data?.errors?.pendingTips
            },
            {
                label: 'Draft slips',
                value: count(summary.draftSlips),
                hint: summary.draftSlips === 0
                    ? 'No draft slips. Build a slip from pending tips.'
                    : 'Slips waiting to be published',
                href: '/admin/slips?publicationStatus=draft',
                linkLabel: 'View slips',
                failed: state.data?.errors?.draftSlips
            },
            {
                label: 'Settlement queue',
                value: isNumber(summary.settlementMatches) ? `${summary.settlementMatches} matches` : placeholder,
                hint: summary.settlementMatches === 0
                    ? 'No matches currently require settlement.'
                    : 'Matches with pending tips',
                href: '/admin/settlement',
                linkLabel: 'Review settlement',
                failed: state.data?.errors?.settlementQueue
            },
            {
                label: 'Published slips',
                value: count(summary.publishedSlips),
                hint: 'Visible to followers',
                href: '/admin/slips?publicationStatus=published',
                linkLabel: 'View slips',
                failed: state.data?.errors?.publishedSlips
            }
        ];

        for (const card of cards) {
            const element = ui.el('div', 'metric-card');

            element.append(
                ui.el('p', 'metric-card__label', card.label),
                ui.el('p', 'metric-card__value', card.failed ? placeholder : card.value),
                ui.el('p', 'metric-card__hint', card.failed ? 'Unavailable right now.' : card.hint)
            );

            if (!card.failed) {
                const link = ui.el('a', 'metric-card__link', card.linkLabel);

                link.href = card.href;
                element.appendChild(link);
            }

            els.summaryCards.appendChild(element);
        }
    }

    function renderAttention() {
        ui.clear(els.attention);

        if (state.loading || state.error || state.sessionExpired) {
            return;
        }

        const summary = state.data?.summary ?? {};
        const items = [];

        if (Number(summary.settlementMatches) > 0) {
            items.push({
                text: `${summary.settlementMatches} match${summary.settlementMatches === 1 ? '' : 'es'} in the settlement queue`,
                href: '/admin/settlement',
                label: 'Review'
            });
        }

        if (Number(summary.draftSlips) > 0) {
            items.push({
                text: `${summary.draftSlips} draft slip${summary.draftSlips === 1 ? '' : 's'} waiting for publication`,
                href: '/admin/slips?publicationStatus=draft',
                label: 'View'
            });
        }

        if (Number(summary.pendingTips) > 0) {
            items.push({
                text: `${summary.pendingTips} pending tip${summary.pendingTips === 1 ? '' : 's'} available for slips`,
                href: '/admin/slips/new',
                label: 'Build slip'
            });
        }

        if (items.length === 0) {
            els.attention.appendChild(ui.el('p', 'empty', 'You\'re all caught up.'));
            return;
        }

        const list = ui.el('ul', 'attention-list');

        for (const item of items) {
            const row = ui.el('li', 'attention-item');
            const link = ui.el('a', 'btn btn--ghost btn--sm', item.label);

            link.href = item.href;
            row.append(ui.el('span', 'attention-item__text', item.text), link);
            list.appendChild(row);
        }

        els.attention.appendChild(list);
    }

    function renderQuickActions() {
        ui.clear(els.quickActions);

        if (state.loading || state.error || state.sessionExpired) {
            return;
        }

        for (const action of quickActions) {
            const link = ui.el('a', `btn ${action.primary ? 'btn--primary' : 'btn--ghost'} btn--block`, action.label);

            link.href = action.href;
            els.quickActions.appendChild(link);
        }
    }

    function renderPerformance() {
        ui.clear(els.performance);

        if (state.loading || state.error || state.sessionExpired) {
            return;
        }

        const performance = state.data?.performance;

        if (!performance) {
            els.performance.appendChild(ui.el('p', 'empty', 'Performance unavailable right now.'));
            return;
        }

        if (Number(performance.totalSlips) === 0) {
            els.performance.appendChild(ui.el('p', 'empty', 'No published settled slips yet.'));
        }

        const rows = ui.el('dl', 'preview__rows');

        rows.append(
            ui.previewRow('Profit', formatSigned(performance.profitUnits, 'u')),
            ui.previewRow('ROI', isNumber(performance.roiPercentage) ? formatSigned(performance.roiPercentage, '%') : placeholder),
            ui.previewRow('Win rate', isNumber(performance.winRatePercentage) ? formatPlain(performance.winRatePercentage, '%') : placeholder),
            ui.previewRow('Settled slips', formatPlain(performance.totalSlips, '', 0)),
            ui.previewRow('Units staked', formatPlain(performance.unitsStaked, 'u'))
        );

        const tone = ui.el('p', `dashboard-tone dashboard-tone--${toneOf(performance.profitUnits)}`);

        tone.textContent = isNumber(performance.profitUnits)
            ? `${Number(performance.profitUnits) >= 0 ? 'Profit' : 'Loss'} of ${Math.abs(Number(performance.profitUnits)).toFixed(2)}u across ${formatPlain(performance.totalSlips, '', 0)} settled slips`
            : 'No settled results yet';

        els.performance.append(rows, tone);
    }

    function renderQueue() {
        ui.clear(els.queue);
        ui.clear(els.queueEmpty);
        els.queueEmpty.hidden = true;

        if (state.loading || state.error || state.sessionExpired) {
            return;
        }

        const matches = state.data?.settlementQueue;

        if (matches === null || matches === undefined) {
            els.queue.appendChild(ui.el('p', 'empty', 'Settlement queue unavailable right now.'));
            return;
        }

        if (matches.length === 0) {
            els.queueEmpty.hidden = false;
            els.queueEmpty.textContent = 'No matches currently require settlement.';
            return;
        }

        const list = ui.el('ul', 'dashboard-list');

        for (const match of matches) {
            const row = ui.el('li', 'dashboard-row');
            const body = ui.el('div', 'dashboard-row__body');

            body.append(
                ui.el('p', 'dashboard-row__title', `${match.homeTeam} vs ${match.awayTeam}`),
                ui.el('p', 'dashboard-row__meta', match.competition || 'Competition unknown'),
                ui.el('p', 'dashboard-row__meta', `Kickoff: ${ui.formatDateTime(match.startsAt)} • ${match.pendingTipCount} pending tip${match.pendingTipCount === 1 ? '' : 's'} • ${match.affectedPendingSlipCount} affected slip${match.affectedPendingSlipCount === 1 ? '' : 's'}`)
            );

            const side = ui.el('div', 'dashboard-row__side');
            const link = ui.el('a', 'btn btn--ghost btn--sm', 'Review');

            link.href = `/admin/settlement?match=${encodeURIComponent(match.sourceMatchId)}`;
            side.append(
                ui.el('span', `status-pill status-pill--${ui.statusTone(match.localStatus)}`, ui.formatLabel(match.localStatus)),
                link
            );

            row.append(body, side);
            list.appendChild(row);
        }

        els.queue.appendChild(list);
    }

    function renderRecentTips() {
        ui.clear(els.recentTips);
        ui.clear(els.recentTipsEmpty);
        els.recentTipsEmpty.hidden = true;

        if (state.loading || state.error || state.sessionExpired) {
            return;
        }

        const tips = state.data?.recentTips;

        if (tips === null || tips === undefined) {
            els.recentTips.appendChild(ui.el('p', 'empty', 'Recent tips unavailable right now.'));
            return;
        }

        if (tips.length === 0) {
            els.recentTipsEmpty.hidden = false;
            els.recentTipsEmpty.textContent = 'No tips imported yet. Create a tip to get started.';
            return;
        }

        const list = ui.el('ul', 'dashboard-list');

        for (const tip of tips) {
            const row = ui.el('li', 'dashboard-row');
            const body = ui.el('div', 'dashboard-row__body');

            body.append(
                ui.el('p', 'dashboard-row__title', `${tip.match.homeTeam} vs ${tip.match.awayTeam}`),
                ui.el('p', 'dashboard-row__meta', `${ui.predictionLabel(tip)} • ${tip.marketName || ui.formatLabel(tip.marketCode)}`),
                ui.el('p', 'dashboard-row__meta', `@ ${ui.formatOdds(tip.odds)} • added ${ui.formatDateTime(tip.createdAt)}`)
            );

            const side = ui.el('div', 'dashboard-row__side');

            side.append(
                ui.el('span', `status-pill status-pill--${ui.statusTone(tip.result)}`, ui.formatLabel(tip.result)),
                ui.el('span', 'tip-card__id', `Tip #${tip.id}`)
            );

            row.append(body, side);
            list.appendChild(row);
        }

        els.recentTips.appendChild(list);
    }

    function renderRecentSlips() {
        ui.clear(els.recentSlips);
        ui.clear(els.recentSlipsEmpty);
        els.recentSlipsEmpty.hidden = true;

        if (state.loading || state.error || state.sessionExpired) {
            return;
        }

        const slips = state.data?.recentSlips;

        if (slips === null || slips === undefined) {
            els.recentSlips.appendChild(ui.el('p', 'empty', 'Recent slips unavailable right now.'));
            return;
        }

        if (slips.length === 0) {
            els.recentSlipsEmpty.hidden = false;
            els.recentSlipsEmpty.textContent = 'No slips yet. Build a slip from pending tips.';
            return;
        }

        const list = ui.el('ul', 'dashboard-list');

        for (const slip of slips) {
            const row = ui.el('li', 'dashboard-row');
            const body = ui.el('div', 'dashboard-row__body');

            body.append(
                ui.el('p', 'dashboard-row__title', ui.slipLabel(slip)),
                ui.el('p', 'dashboard-row__meta', `${slip.legCount} selection${slip.legCount === 1 ? '' : 's'} • total odds ${ui.formatTotalOdds(slip.totalOdds)} • stake ${Number(slip.stakeUnits)}u`),
                ui.el('p', 'dashboard-row__meta', `Slip date ${ui.formatDate(slip.slipDate)}`)
            );

            const side = ui.el('div', 'dashboard-row__side');

            side.append(
                ui.el('span', `status-pill status-pill--${ui.statusTone(slip.publicationStatus)}`, ui.formatLabel(slip.publicationStatus)),
                ui.el('span', `status-pill status-pill--${ui.statusTone(slip.result)}`, ui.formatLabel(slip.result)),
                ui.el('span', 'tip-card__id', `Slip #${slip.id}`)
            );

            row.append(body, side);
            list.appendChild(row);
        }

        els.recentSlips.appendChild(list);
    }

    /* ---------------- interactions ---------------- */

    els.refresh.addEventListener('click', load);

    load();
})();
