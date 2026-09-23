(() => {
    'use strict';

    const ui = window.WachimbaPublicUI;
    const params = new URLSearchParams(window.location.search);
    const allowedResults = ['all', 'won', 'lost', 'void', 'pending'];
    const state = {
        result: allowedResults.includes(params.get('result')) ? params.get('result') : 'all',
        offset: Number.isInteger(Number(params.get('offset'))) && Number(params.get('offset')) > 0
            ? Number(params.get('offset'))
            : 0,
        limit: 10,
        timezone: ''
    };

    const els = {
        timezone: document.getElementById('history-timezone'),
        tabs: [...document.querySelectorAll('[data-result-filter]')],
        summary: document.getElementById('history-summary'),
        loading: document.getElementById('history-loading'),
        empty: document.getElementById('history-empty'),
        error: document.getElementById('history-error'),
        retry: document.getElementById('history-retry'),
        list: document.getElementById('history-list'),
        pager: document.getElementById('history-pager'),
        prev: document.getElementById('history-prev'),
        next: document.getElementById('history-next'),
        range: document.getElementById('history-range')
    };

    function historyUrl(result = state.result, offset = 0) {
        const query = new URLSearchParams();

        if (result !== 'all') query.set('result', result);
        if (offset > 0) query.set('offset', String(offset));

        const text = query.toString();

        return text ? `/history?${text}` : '/history';
    }

    function syncControls() {
        for (const tab of els.tabs) {
            const active = tab.dataset.resultFilter === state.result;

            tab.href = historyUrl(tab.dataset.resultFilter, 0);
            tab.classList.toggle('is-active', active);
            if (active) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        }
    }

    async function loadHistory() {
        syncControls();
        ui.setHidden(els.loading, false);
        ui.setHidden(els.empty, true);
        ui.setHidden(els.error, true);
        ui.setHidden(els.list, true);
        ui.setHidden(els.pager, true);
        ui.clear(els.list);
        ui.clear(els.summary);
        els.summary.appendChild(ui.el('span', null, 'Loading history...'));

        const query = new URLSearchParams({
            scope: 'history',
            sort: 'published',
            limit: String(state.limit),
            offset: String(state.offset)
        });

        if (state.result !== 'all') query.set('result', state.result);

        try {
            const response = await fetch(`/api/v1/public/slips?${query.toString()}`, { credentials: 'same-origin' });
            const payload = await ui.readJson(response);

            if (!response.ok || !Array.isArray(payload?.slips)) {
                throw new Error(payload?.error || 'History could not be loaded right now.');
            }

            state.timezone = payload.timezone || '';
            els.timezone.textContent = state.timezone ? `Publication times use ${state.timezone}.` : '';

            const details = await Promise.all(payload.slips.map(async (slip) => {
                const detailResponse = await fetch(`/api/v1/public/slips/${encodeURIComponent(slip.id)}`, {
                    credentials: 'same-origin'
                });

                return detailResponse.ok ? ui.readJson(detailResponse) : null;
            }));
            const slips = details.filter(Boolean);

            renderSummary(payload, slips);
            renderHistory(slips);
            renderPager(payload);

            els.empty.textContent = emptyText(state.result);
            ui.setHidden(els.empty, slips.length > 0);
            ui.setHidden(els.list, slips.length === 0);
        } catch (error) {
            ui.clear(els.summary);
            els.summary.appendChild(ui.el('span', null, 'History unavailable'));
            els.error.querySelector('span').textContent = error.message || 'History could not be loaded right now.';
            ui.setHidden(els.error, false);
        } finally {
            ui.setHidden(els.loading, true);
        }
    }

    function emptyText(result) {
        if (result === 'all') return 'No published slips yet.';

        return `No ${result} slips found.`;
    }

    function renderSummary(payload, slips) {
        ui.clear(els.summary);
        els.summary.append(
            ui.el('span', 'summary-bar__item', `${payload.total} published slip${payload.total === 1 ? '' : 's'}`),
            ui.el('span', 'summary-bar__item', `${slips.length} shown`)
        );
    }

    function renderHistory(slips) {
        for (const slip of slips) {
            els.list.appendChild(historyCard(slip));
        }
    }

    function renderPager(payload) {
        const hasPrevious = state.offset > 0;
        const hasNext = Number(payload.count) === state.limit;

        ui.setHidden(els.pager, !(hasPrevious || hasNext));

        if (hasPrevious || hasNext) {
            const from = payload.total === 0 ? 0 : state.offset + 1;
            const to = state.offset + Number(payload.count);

            els.range.textContent = `Showing ${from}-${to}`;
            els.prev.disabled = !hasPrevious;
            els.next.disabled = !hasNext;
        }
    }

    function historyCard(slip) {
        const selections = ui.selectionsOf(slip);
        const visibleSelections = selections.slice(0, 3);
        const hiddenCount = Math.max(0, selections.length - visibleSelections.length);
        const type = slip.slipType || ui.slipType(slip.legCount ?? selections.length);
        const card = ui.el('article', 'history-card');
        const header = ui.el('div', 'tip-card__header');
        const preview = ui.el('div', 'selection-list');
        const metrics = ui.el('dl', 'tip-card__details tip-card__details--wide');
        const link = ui.el('a', 'view-link', 'View slip');

        header.append(
            ui.el('p', 'tip-card__competition', type.toUpperCase()),
            ui.el('span', `status-pill status-pill--${slip.result}`, ui.formatLabel(slip.result))
        );

        for (const selection of visibleSelections) {
            preview.appendChild(selectionSummary(selection));
        }

        if (hiddenCount > 0) {
            preview.appendChild(ui.el('p', 'selection-more', `+ ${hiddenCount} more selection${hiddenCount === 1 ? '' : 's'}`));
        }

        metrics.append(
            ui.field('Published', ui.formatDateTime(slip.publishedAt, state.timezone)),
            ui.field('Selections', `${selections.length}`),
            ui.field(ui.totalOddsLabel(slip), ui.formatOdds(slip.totalOdds), 'tip-card__odds'),
            ...ui.moneyRows(slip).map(([label, value]) => ui.field(label, value))
        );

        link.href = `/slips/${encodeURIComponent(slip.id)}`;

        card.append(
            header,
            ui.el('h3', 'tip-card__team', slip.title || `Slip #${slip.id}`),
            preview,
            metrics,
            link
        );

        return card;
    }

    function selectionSummary(selection) {
        const row = ui.el('div', 'selection-row');
        const main = ui.el('div', 'selection-row__main');

        main.append(
            ui.el('p', 'selection-row__match', `${selection.match.homeTeam} vs ${selection.match.awayTeam}`),
            ui.el('p', 'selection-row__pick', ui.predictionLabel(selection))
        );
        row.append(
            main,
            ui.el('span', `status-pill status-pill--${selection.result}`, ui.formatLabel(selection.result)),
            ui.el('span', 'selection-row__odds', ui.formatOdds(selection.odds))
        );

        return row;
    }

    function go(offset) {
        state.offset = Math.max(0, offset);
        window.history.replaceState({}, '', historyUrl(state.result, state.offset));
        loadHistory();
    }

    els.prev.addEventListener('click', () => go(state.offset - state.limit));
    els.next.addEventListener('click', () => go(state.offset + state.limit));
    els.retry.addEventListener('click', loadHistory);
    loadHistory();
})();
