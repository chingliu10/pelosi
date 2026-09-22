/**
 * Admin Slip Manager.
 *
 * Lists slips from GET /api/v1/slips (admin session), shows the stored legs of
 * the selected slip and publishes/hides it through the existing endpoints. All
 * financial values shown come from the backend - nothing is faked client-side.
 */
(() => {
    'use strict';

    const ui = window.PelosiAdminUI;

    const publicationFilters = [
        { key: 'all', label: 'All' },
        { key: 'draft', label: 'Draft' },
        { key: 'published', label: 'Published' },
        { key: 'hidden', label: 'Hidden' }
    ];

    const state = {
        publicationStatus: 'all',
        result: 'all',
        offset: 0,
        limit: 20,
        slips: [],
        pageCount: 0,
        loading: false,
        error: '',
        sessionExpired: false,
        selected: null,
        detailLoading: false,
        detailError: '',
        actionBusy: false,
        actionMessage: null,
        confirmHide: false
    };

    const els = {
        filters: document.getElementById('slip-filters'),
        resultFilter: document.getElementById('slip-result-filter'),
        feedback: document.getElementById('slips-feedback'),
        empty: document.getElementById('slips-empty'),
        list: document.getElementById('slips-list'),
        pager: document.getElementById('slips-pager'),
        prev: document.getElementById('slips-prev'),
        next: document.getElementById('slips-next'),
        range: document.getElementById('slips-range'),
        detail: document.getElementById('slip-detail')
    };

    /* ---------------- loading ---------------- */

    async function loadSlips() {
        state.loading = true;
        state.error = '';
        state.sessionExpired = false;
        render();

        const params = new URLSearchParams();

        if (state.publicationStatus !== 'all') params.set('publicationStatus', state.publicationStatus);
        if (state.result !== 'all') params.set('result', state.result);

        params.set('limit', String(state.limit));
        params.set('offset', String(state.offset));

        let response = null;

        try {
            response = await fetch(`/api/v1/slips?${params.toString()}`, { credentials: 'same-origin' });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, 'load slips'));
            }

            state.slips = payload.slips ?? [];
            state.pageCount = Number(payload.count ?? state.slips.length);
        } catch (error) {
            state.error = state.sessionExpired
                ? error.message
                : (response ? error.message : ui.networkFailure);
        } finally {
            state.loading = false;
            render();
        }
    }

    async function loadSlipDetail(slipId) {
        state.detailLoading = true;
        state.detailError = '';
        state.actionMessage = null;
        state.confirmHide = false;
        renderDetail();

        let response = null;

        try {
            response = await fetch(`/api/v1/slips/${encodeURIComponent(slipId)}`, { credentials: 'same-origin' });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(response.status === 404
                    ? 'Slip not found.'
                    : ui.friendlyFailure(response, payload, 'load the slip'));
            }

            state.selected = payload;
        } catch (error) {
            state.detailError = state.sessionExpired ? error.message : (error.message || 'Could not load the slip.');
            state.selected = null;
        } finally {
            state.detailLoading = false;
            renderDetail();
        }
    }

    /* ---------------- actions ---------------- */

    async function changePublication(action) {
        if (!state.selected || state.actionBusy) return;

        const slipId = state.selected.id;
        const endpoint = action === 'publish' ? 'publish' : 'hide';

        state.actionBusy = true;
        state.actionMessage = null;
        state.confirmHide = false;
        renderDetail();

        let response = null;

        try {
            response = await fetch(`/api/v1/slips/${slipId}/${endpoint}`, {
                method: 'POST',
                credentials: 'same-origin'
            });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, endpoint === 'publish' ? 'publish the slip' : 'hide the slip'));
            }

            state.selected = payload;
            state.actionMessage = {
                tone: 'success',
                text: endpoint === 'publish' ? 'Published successfully' : 'Slip hidden'
            };

            await refreshSelectedRow(payload);
        } catch (error) {
            state.actionMessage = {
                tone: 'error',
                text: error.message || 'The action failed.'
            };
        } finally {
            state.actionBusy = false;
            render();
        }
    }

    /**
     * Replaces the row in the current page with the backend response, or reloads
     * the page when the slip no longer matches the active filter.
     */
    async function refreshSelectedRow(slip) {
        const matchesFilter = state.publicationStatus === 'all'
            || state.publicationStatus === slip.publicationStatus;
        const index = state.slips.findIndex((row) => row.id === slip.id);

        if (!matchesFilter) {
            await loadSlips();
            return;
        }

        if (index === -1) {
            await loadSlips();
            return;
        }

        state.slips = state.slips.map((row) => (row.id === slip.id
            ? { ...row, publicationStatus: slip.publicationStatus, publishedAt: slip.publishedAt }
            : row));
    }

    /* ---------------- rendering ---------------- */

    function render() {
        renderFilters();
        renderFeedback();
        renderList();
        renderPager();
        renderDetail();
    }

    function renderFilters() {
        clear(els.filters);

        for (const filter of publicationFilters) {
            const active = state.publicationStatus === filter.key;
            const tab = ui.el('button', `tab${active ? ' is-active' : ''}`, filter.label);

            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(active));
            tab.addEventListener('click', () => {
                if (state.publicationStatus === filter.key) return;

                state.publicationStatus = filter.key;
                state.offset = 0;
                syncUrl();
                loadSlips();
            });

            els.filters.appendChild(tab);
        }

        els.resultFilter.value = state.result;
    }

    function renderFeedback() {
        if (state.sessionExpired) {
            els.feedback.className = 'feedback';
            clear(els.feedback);
            els.feedback.appendChild(ui.sessionExpiredAlert('/admin/slips'));
            return;
        }

        if (state.loading) {
            ui.setFeedback(els.feedback, 'Loading slips…', '');
            return;
        }

        if (state.error) {
            ui.setFeedback(els.feedback, state.error, 'error');
            return;
        }

        ui.setFeedback(els.feedback, state.pageCount > 0
            ? `${state.pageCount} slip${state.pageCount === 1 ? '' : 's'} shown.`
            : '', '');
    }

    function renderList() {
        clear(els.list);
        clear(els.empty);
        els.empty.hidden = true;

        if (state.loading || state.error || state.sessionExpired) return;

        if (state.slips.length === 0) {
            els.empty.hidden = false;

            const filtered = state.publicationStatus !== 'all' || state.result !== 'all';

            if (filtered) {
                els.empty.append(ui.el('p', null, 'No slips match these filters.'));

                const clearButton = ui.el('button', 'btn btn--ghost btn--sm', 'Clear filters');

                clearButton.type = 'button';
                clearButton.addEventListener('click', clearFilters);
                els.empty.appendChild(clearButton);
                return;
            }

            els.empty.append(ui.el('p', null, 'No slips yet.'));

            const link = ui.el('a', 'btn btn--primary btn--sm', 'Build your first slip');

            link.href = '/admin/slips/new';
            els.empty.appendChild(link);
            return;
        }

        for (const slip of state.slips) {
            els.list.appendChild(slipRow(slip));
        }
    }

    function slipRow(slip) {
        const selected = state.selected?.id === slip.id;
        const row = ui.el('li', `slip-card${selected ? ' is-active' : ''}`);
        const button = ui.el('button', 'slip-card__button');

        button.type = 'button';
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', `Show details for ${ui.slipLabel(slip)}`);

        const main = ui.el('div', 'slip-card__main');

        main.append(
            ui.el('p', 'tip-card__title', ui.slipLabel(slip)),
            ui.el('p', 'tip-card__meta', `${slip.legCount} selection${slip.legCount === 1 ? '' : 's'} • ${ui.formatDate(slip.slipDate)}`)
        );

        const details = ui.el('div', 'tip-card__details');

        details.append(
            ui.field('Total odds', ui.formatTotalOdds(slip.totalOdds), 'tabular'),
            ui.field('Stake', `${Number(slip.stakeUnits)}u`),
            ui.field('P/L', slip.profitUnits === null ? '—' : ui.formatUnits(slip.profitUnits), 'tabular'),
            ui.field('Published', slip.publishedAt ? ui.formatDate(slip.publishedAt) : '—')
        );

        const side = ui.el('div', 'tip-card__side');

        side.append(
            ui.el('span', `status-pill status-pill--${ui.statusTone(slip.result)}`, ui.formatLabel(slip.result)),
            ui.el('span', `status-pill status-pill--${ui.statusTone(slip.publicationStatus)}`, ui.formatLabel(slip.publicationStatus)),
            ui.el('span', 'tip-card__id', `Slip #${slip.id}`)
        );

        button.append(main, details, side);
        button.addEventListener('click', () => {
            if (state.selected?.id === slip.id) {
                state.selected = null;
                state.actionMessage = null;
                renderList();
                renderDetail();
                return;
            }

            syncUrl(slip.id);
            loadSlipDetail(slip.id);
        });

        row.appendChild(button);

        return row;
    }

    function renderPager() {
        const show = !state.loading && !state.error && !state.sessionExpired && (state.offset > 0 || state.pageCount >= state.limit);

        els.pager.hidden = !show;

        if (!show) return;

        const from = state.pageCount === 0 ? 0 : state.offset + 1;
        const to = state.offset + state.slips.length;

        els.range.textContent = `Showing ${from}–${to}`;
        els.prev.disabled = state.offset <= 0;
        // The list API is count-based, so a full page means there may be more.
        els.next.disabled = state.pageCount < state.limit;
    }

    function renderDetail() {
        clear(els.detail);

        if (state.sessionExpired) {
            els.detail.appendChild(ui.el('p', 'empty', 'Session expired.'));
            return;
        }

        if (state.detailLoading) {
            els.detail.appendChild(ui.el('p', 'empty', 'Loading slip…'));
            return;
        }

        if (state.detailError) {
            els.detail.appendChild(ui.el('p', 'empty', state.detailError));
            return;
        }

        const slip = state.selected;

        if (!slip) {
            els.detail.appendChild(ui.el('p', 'empty', 'Select a slip to review its legs.'));
            return;
        }

        els.detail.append(
            ui.el('p', 'preview__match', ui.slipLabel(slip)),
            ui.el('p', 'preview__meta', `Slip #${slip.id} • ${ui.formatDate(slip.slipDate)}`)
        );

        const rows = ui.el('dl', 'preview__rows');

        rows.append(
            ui.previewRow('Total odds', ui.formatTotalOdds(slip.totalOdds), 'preview__value--odds'),
            ui.previewRow('Stake', `${Number(slip.stakeUnits)}u`),
            ui.previewRow('Result', ui.formatLabel(slip.result)),
            ui.previewRow('Publication', ui.formatLabel(slip.publicationStatus)),
            ui.previewRow('Published', slip.publishedAt ? ui.formatDateTime(slip.publishedAt) : '—'),
            ui.previewRow('Return units', slip.returnUnits === null ? '—' : `${Number(slip.returnUnits).toFixed(2)}u`),
            ui.previewRow('Profit units', slip.profitUnits === null ? '—' : ui.formatUnits(slip.profitUnits)),
            ui.previewRow('Settled', slip.settledAt ? ui.formatDateTime(slip.settledAt) : '—'),
            ui.previewRow('Created', ui.formatDateTime(slip.createdAt))
        );

        els.detail.appendChild(rows);

        const legs = ui.el('div', 'legs');

        legs.appendChild(ui.el('h3', 'legs__title', `Legs (${slip.tips.length})`));

        slip.tips.forEach((tip, index) => {
            const leg = ui.el('div', 'leg');
            const body = ui.el('div', 'leg__body');
            const side = ui.el('div', 'leg__side');

            body.append(
                ui.el('p', 'leg__title', `${index + 1}. ${tip.match.homeTeam} vs ${tip.match.awayTeam}`),
                ui.el('p', 'leg__meta', `${ui.predictionLabel(tip)} • ${tip.marketName || ui.formatLabel(tip.marketCode)}`),
                ui.el('p', 'leg__meta', `${tip.match.competition || 'Competition unknown'} • ${ui.formatDateTime(tip.match.startsAt)}`)
            );

            side.append(
                ui.el('span', `status-pill status-pill--${ui.statusTone(tip.result)}`, ui.formatLabel(tip.result)),
                ui.el('span', 'leg__odds', `@ ${ui.formatOdds(tip.odds)}`)
            );

            leg.append(body, side);
            legs.appendChild(leg);
        });

        els.detail.appendChild(legs);

        if (state.actionMessage) {
            const alert = ui.el('div', `alert alert--${state.actionMessage.tone === 'error' ? 'error' : 'success'}`);

            alert.appendChild(ui.el('p', null, state.actionMessage.text));
            els.detail.appendChild(alert);
        }

        if (state.confirmHide) {
            const confirm = ui.el('div', 'confirm');

            confirm.append(
                ui.el('p', 'confirm__title', 'Hide this slip from public view?'),
                ui.el('p', 'confirm__text', 'The slip keeps its legs and its original published time.')
            );

            const actions = ui.el('div', 'confirm__actions');
            const cancel = ui.el('button', 'btn btn--ghost btn--sm', 'Cancel');
            const confirmButton = ui.el('button', 'btn btn--primary btn--sm', 'Hide slip');

            cancel.type = 'button';
            confirmButton.type = 'button';
            cancel.addEventListener('click', () => {
                state.confirmHide = false;
                renderDetail();
            });
            confirmButton.addEventListener('click', () => changePublication('hide'));

            actions.append(cancel, confirmButton);
            confirm.appendChild(actions);
            els.detail.appendChild(confirm);
        }

        const actions = ui.el('div', 'preview__actions');

        if (slip.publicationStatus === 'published') {
            const hide = ui.el('button', 'btn btn--ghost btn--block', state.actionBusy ? 'Hiding…' : 'Hide');

            hide.type = 'button';
            hide.disabled = state.actionBusy;
            hide.addEventListener('click', () => {
                state.confirmHide = true;
                renderDetail();
            });
            actions.appendChild(hide);
        } else {
            const label = slip.publicationStatus === 'hidden' ? 'Publish again' : 'Publish';
            const publish = ui.el('button', 'btn btn--primary btn--block', state.actionBusy ? 'Publishing…' : label);

            publish.type = 'button';
            publish.disabled = state.actionBusy;
            publish.addEventListener('click', () => changePublication('publish'));
            actions.appendChild(publish);
        }

        els.detail.append(
            actions,
            ui.el('p', 'muted-note', slip.result === 'pending'
                ? 'Settlement runs from the settlement screen (later task).'
                : 'Settled slips keep their stored financial values.')
        );
    }

    /* ---------------- interactions ---------------- */

    function clearFilters() {
        state.publicationStatus = 'all';
        state.result = 'all';
        state.offset = 0;
        syncUrl();
        loadSlips();
    }

    function syncUrl(slipId) {
        const params = new URLSearchParams();

        if (state.publicationStatus !== 'all') params.set('publicationStatus', state.publicationStatus);
        if (state.result !== 'all') params.set('result', state.result);
        if (slipId) params.set('slip', String(slipId));

        const query = params.toString();

        window.history.replaceState({}, '', query ? `/admin/slips?${query}` : '/admin/slips');
    }

    els.resultFilter.addEventListener('change', () => {
        state.result = els.resultFilter.value;
        state.offset = 0;
        syncUrl();
        loadSlips();
    });

    els.prev.addEventListener('click', () => {
        state.offset = Math.max(0, state.offset - state.limit);
        loadSlips();
    });

    els.next.addEventListener('click', () => {
        if (state.pageCount < state.limit) return;

        state.offset += state.limit;
        loadSlips();
    });

    /* ---------------- boot ---------------- */

    const initialParams = new URLSearchParams(window.location.search);
    const initialStatus = initialParams.get('publicationStatus');
    const initialResult = initialParams.get('result');
    const initialSlip = Number(initialParams.get('slip'));

    if (publicationFilters.some((filter) => filter.key === initialStatus)) {
        state.publicationStatus = initialStatus;
    }

    if (['pending', 'won', 'lost', 'void'].includes(initialResult)) {
        state.result = initialResult;
    }

    loadSlips();

    if (Number.isInteger(initialSlip) && initialSlip > 0) {
        loadSlipDetail(initialSlip);
    }
})();
