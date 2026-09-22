/**
 * Admin Tips Manager.
 *
 * Reads the authenticated Pelosi tips API (GET /api/v1/tips) and renders the
 * imported predictions with result filters, search and pagination.
 */
(() => {
    'use strict';

    const pageSize = 20;
    const searchDebounceMs = 350;
    const filterOrder = ['all', 'pending', 'won', 'lost', 'void'];
    const filterLabels = {
        all: 'All',
        pending: 'Pending',
        won: 'Won',
        lost: 'Lost',
        void: 'Void'
    };

    const state = {
        result: 'all',
        search: '',
        offset: 0,
        limit: pageSize,
        tips: [],
        total: 0,
        counts: null,
        loading: false,
        error: '',
        sessionExpired: false,
        selectedTip: null,
        highlightedTipId: null
    };

    const els = {
        searchForm: document.getElementById('tips-search-form'),
        searchInput: document.getElementById('tips-search-input'),
        searchButton: document.getElementById('tips-search-button'),
        filters: document.getElementById('tips-filters'),
        feedback: document.getElementById('tips-feedback'),
        empty: document.getElementById('tips-empty'),
        list: document.getElementById('tips-list'),
        pager: document.getElementById('tips-pager'),
        prev: document.getElementById('tips-prev'),
        next: document.getElementById('tips-next'),
        range: document.getElementById('tips-range'),
        detail: document.getElementById('tip-detail')
    };

    /* ---------------- helpers (shared with the slip screens) ---------------- */

    const ui = window.PelosiAdminUI;
    const {
        el,
        clear,
        formatDateTime,
        formatOdds,
        formatLabel,
        predictionLabel,
        statusTone,
        setFeedback,
        previewRow
    } = ui;

    function buildQuery() {
        const params = new URLSearchParams();

        if (state.result !== 'all') params.set('result', state.result);
        if (state.search) params.set('search', state.search);

        params.set('limit', String(state.limit));
        params.set('offset', String(state.offset));

        return params.toString();
    }

    function syncUrl() {
        const params = new URLSearchParams();

        if (state.result !== 'all') params.set('result', state.result);
        if (state.search) params.set('search', state.search);

        const query = params.toString();

        window.history.replaceState({}, '', query ? `/admin/tips?${query}` : '/admin/tips');
    }

    /* ---------------- loading ---------------- */

    async function loadTips() {
        state.loading = true;
        state.error = '';
        state.sessionExpired = false;
        render();

        let response = null;

        try {
            response = await fetch(`/api/v1/tips?${buildQuery()}`, { credentials: 'same-origin' });
            const payload = await response.json().catch(() => null);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(
                    (typeof payload?.error === 'string' && payload.error)
                    || `Failed to load tips (HTTP ${response.status}).`
                );
            }

            state.tips = payload.tips ?? [];
            state.total = Number(payload.total ?? state.tips.length);
            state.counts = payload.counts ?? null;

            // A tip id from the URL (for example the "View existing tip" link)
            // opens its detail panel.
            if (state.highlightedTipId !== null) {
                const match = state.tips.find((tip) => tip.id === state.highlightedTipId);

                if (match) state.selectedTip = match;
            }
        } catch (error) {
            if (state.sessionExpired) {
                state.error = error.message;
            } else if (response) {
                state.error = error.message || 'Failed to load tips.';
            } else {
                state.error = 'Failed to load tips. Check that the Pelosi server is running.';
            }
        } finally {
            state.loading = false;
            render();
        }
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

        for (const key of filterOrder) {
            const active = state.result === key;
            const tab = el('button', `tab${active ? ' is-active' : ''}`);
            const count = state.counts ? state.counts[key] : null;

            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(active));
            tab.append(el('span', null, filterLabels[key]));

            if (count !== null && count !== undefined) {
                tab.appendChild(el('span', 'tab__count', count));
            }

            tab.addEventListener('click', () => {
                if (state.result === key) return;

                state.result = key;
                state.offset = 0;
                state.selectedTip = null;
                syncUrl();
                loadTips();
            });

            els.filters.appendChild(tab);
        }
    }

    function renderFeedback() {
        if (state.sessionExpired) {
            els.feedback.className = 'feedback';
            clear(els.feedback);
            els.feedback.appendChild(ui.sessionExpiredAlert('/admin/tips'));
            return;
        }

        if (state.loading) {
            setFeedback(els.feedback, 'Loading tips…', '');
            return;
        }

        if (state.error) {
            setFeedback(els.feedback, state.error, 'error');
            return;
        }

        setFeedback(els.feedback, '', '');
    }

    function renderList() {
        clear(els.list);
        renderEmpty();

        if (state.loading || state.error || state.sessionExpired) return;

        for (const tip of state.tips) {
            els.list.appendChild(tipRow(tip));
        }
    }

    function renderEmpty() {
        const hasFilters = state.result !== 'all' || state.search !== '';

        els.empty.hidden = true;
        clear(els.empty);

        if (state.loading || state.error || state.sessionExpired || state.tips.length > 0) {
            return;
        }

        els.empty.hidden = false;

        if (hasFilters) {
            els.empty.append(
                el('p', null, 'No results matching search.'),
                (() => {
                    const button = el('button', 'btn btn--ghost btn--sm', 'Clear filters');

                    button.type = 'button';
                    button.addEventListener('click', clearFilters);

                    return button;
                })()
            );
            return;
        }

        els.empty.append(
            el('p', null, 'No tips imported yet.'),
            (() => {
                const link = el('a', 'btn btn--primary btn--sm', 'Create your first tip');

                link.href = '/admin/tips/new';

                return link;
            })()
        );
    }

    function tipRow(tip) {
        const row = el('li', `tip-card${state.selectedTip?.id === tip.id ? ' is-active' : ''}`);
        const button = el('button', 'tip-card__button');

        button.type = 'button';
        button.setAttribute('aria-pressed', String(state.selectedTip?.id === tip.id));
        button.setAttribute('aria-label', `Show details for ${tip.match.homeTeam} vs ${tip.match.awayTeam}`);

        const main = el('div', 'tip-card__main');

        main.append(
            el('p', 'tip-card__title', `${tip.match.homeTeam} vs ${tip.match.awayTeam}`),
            el('p', 'tip-card__meta', tip.match.competition || 'Competition unknown')
        );

        const details = el('div', 'tip-card__details');

        details.append(
            tipCardField('Prediction', predictionLabel(tip)),
            tipCardField('Market', tip.marketName || formatLabel(tip.marketCode)),
            tipCardField('Odds', formatOdds(tip.odds), 'tabular'),
            tipCardField('Kickoff', formatDateTime(tip.match.startsAt))
        );

        const side = el('div', 'tip-card__side');

        side.append(
            el('span', `status-pill status-pill--${statusTone(tip.result)}`, formatLabel(tip.result)),
            el('span', 'tip-card__id', `Tip ${tip.id}`)
        );

        button.append(main, details, side);
        button.addEventListener('click', () => {
            state.selectedTip = state.selectedTip?.id === tip.id ? null : tip;
            renderList();
            renderDetail();
        });

        row.appendChild(button);

        return row;
    }

    function tipCardField(label, value, modifier) {
        const field = el('div', 'tip-card__field');

        field.append(
            el('span', 'tip-card__field-label', label),
            el('span', `tip-card__field-value${modifier ? ` tip-card__field-value--${modifier}` : ''}`, value)
        );

        return field;
    }

    function renderPager() {
        const showPager = !state.loading && !state.error && !state.sessionExpired && state.total > state.limit;

        els.pager.hidden = !showPager;

        if (!showPager) return;

        const from = state.total === 0 ? 0 : state.offset + 1;
        const to = Math.min(state.offset + state.tips.length, state.total);

        els.range.textContent = `Showing ${from}–${to} of ${state.total}`;
        els.prev.disabled = state.offset <= 0;
        els.next.disabled = state.offset + state.limit >= state.total;
    }

    function renderDetail() {
        clear(els.detail);

        const tip = state.selectedTip;

        if (!tip) {
            els.detail.appendChild(el('p', 'empty', 'Select a tip to see its details.'));
            return;
        }

        els.detail.append(
            el('p', 'preview__match', `${tip.match.homeTeam} vs ${tip.match.awayTeam}`),
            el('p', 'preview__meta', tip.match.competition || 'Competition unknown')
        );

        const rows = el('dl', 'preview__rows');

        rows.append(
            previewRow('Prediction', predictionLabel(tip)),
            previewRow('Market', tip.marketName || formatLabel(tip.marketCode)),
            previewRow('Selection', tip.selectionName || formatLabel(tip.selectionCode)),
            previewRow('Odds snapshot', formatOdds(tip.odds), 'preview__value--odds'),
            previewRow('Result', formatLabel(tip.result)),
            previewRow('Kickoff', formatDateTime(tip.match.startsAt)),
            previewRow('Settled', formatDateTime(tip.settledAt)),
            previewRow('Source', formatLabel(tip.marketCode)),
            previewRow('Created', formatDateTime(tip.createdAt)),
            previewRow('Tip ID', String(tip.id))
        );

        els.detail.appendChild(rows);
        els.detail.appendChild(el('p', 'muted-note', 'Historical odds are never changed after import.'));

        if (tip.result === 'pending') {
            const note = el('p', 'muted-note', 'Settlement runs from the settlement screen (later task).');

            els.detail.appendChild(note);
        }
    }

    /* ---------------- interactions ---------------- */

    function clearFilters() {
        state.result = 'all';
        state.search = '';
        state.offset = 0;
        state.selectedTip = null;
        els.searchInput.value = '';
        syncUrl();
        loadTips();
    }

    function applySearch(value) {
        const search = value.trim();

        if (search === state.search) return;

        state.search = search;
        state.offset = 0;
        state.selectedTip = null;
        syncUrl();
        loadTips();
    }

    let searchTimer = null;

    els.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        window.clearTimeout(searchTimer);
        applySearch(els.searchInput.value);
    });

    els.searchInput.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => applySearch(els.searchInput.value), searchDebounceMs);
    });

    els.prev.addEventListener('click', () => {
        state.offset = Math.max(0, state.offset - state.limit);
        state.selectedTip = null;
        loadTips();
    });

    els.next.addEventListener('click', () => {
        if (state.offset + state.limit >= state.total) return;

        state.offset += state.limit;
        state.selectedTip = null;
        loadTips();
    });

    /* ---------------- boot ---------------- */

    const initialParams = new URLSearchParams(window.location.search);
    const initialResult = initialParams.get('result');
    const initialTip = Number(initialParams.get('tip'));

    if (filterOrder.includes(initialResult)) {
        state.result = initialResult;
    }

    state.search = (initialParams.get('search') ?? '').trim();
    els.searchInput.value = state.search;

    if (Number.isInteger(initialTip) && initialTip > 0) {
        state.highlightedTipId = initialTip;
    }

    loadTips();
})();
