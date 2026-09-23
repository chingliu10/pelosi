/**
 * Admin Slip Builder.
 *
 * Search TrueOdds through Pelosi, add selections to a server-side session
 * builder, then save the temporary builder as one private draft slip.
 */
(() => {
    'use strict';

    const ui = window.PelosiAdminUI;
    const {
        el,
        clear,
        formatDateTime,
        formatOdds,
        formatTotalOdds,
        formatLabel,
        readJson,
        errorMessage,
        setFeedback,
        previewRow,
        networkFailure
    } = ui;

    const state = {
        searching: false,
        searched: false,
        query: '',
        searchError: '',
        matches: [],
        match: null,
        marketsLoading: false,
        marketsError: '',
        markets: [],
        builder: null,
        builderLoading: true,
        builderError: '',
        saveError: '',
        saving: false,
        saved: null,
        title: ''
    };

    const els = {
        searchForm: document.getElementById('builder-search-form'),
        searchInput: document.getElementById('builder-search-input'),
        searchButton: document.getElementById('builder-search-button'),
        feedback: document.getElementById('builder-feedback'),
        resultsCard: document.getElementById('builder-results-card'),
        resultsCount: document.getElementById('builder-results-count'),
        resultsList: document.getElementById('builder-results-list'),
        resultsEmpty: document.getElementById('builder-results-empty'),
        marketsCard: document.getElementById('builder-markets-card'),
        matchSummary: document.getElementById('builder-match-summary'),
        marketsFeedback: document.getElementById('builder-markets-feedback'),
        marketGroups: document.getElementById('builder-market-groups'),
        marketsEmpty: document.getElementById('builder-markets-empty'),
        preview: document.getElementById('slip-preview')
    };

    function friendlyFailure(response, payload, action) {
        if (response.status >= 500) {
            return `TrueOdds is unavailable right now, so Pelosi could not ${action}. Please try again.`;
        }

        return errorMessage(payload, `Could not ${action} (HTTP ${response.status}).`);
    }

    function normalizeMatch(raw) {
        const source = raw || {};

        return {
            trueOddsId: String(source.trueOddsId ?? source.trueodds_id ?? source.id ?? ''),
            home: source.homeTeam?.name ?? source.home_team_name ?? 'Home team',
            away: source.awayTeam?.name ?? source.away_team_name ?? 'Away team',
            competition: source.competition?.name ?? source.league ?? null,
            startsAt: source.startsAt ?? source.start_time ?? null,
            status: source.status ?? source.match_status ?? null
        };
    }

    function normalizeMarkets(payload) {
        const rawMarkets = Array.isArray(payload?.markets) ? payload.markets : [];

        return rawMarkets
            .map((market, index) => {
                const rawSelections = market.selections ?? market.outcomes ?? [];

                return {
                    id: String(market.id ?? market.sourceMarketId ?? market.name ?? index),
                    code: market.code ?? 'UNKNOWN',
                    name: market.name ?? market.market_title ?? market.market_name ?? market.code ?? 'Market',
                    selections: rawSelections
                        .map((selection) => ({
                            sourceOddsId: String(selection.sourceOddsId ?? selection.event_odds_id ?? selection.id ?? ''),
                            name: selection.name ?? selection.outcomeName ?? selection.outcome_desc ?? selection.pick_team ?? 'Selection',
                            odds: Number(selection.odds)
                        }))
                        .filter((selection) => selection.sourceOddsId && Number.isFinite(selection.odds))
                };
            })
            .filter((market) => market.selections.length > 0);
    }

    function predictionLabel(selection) {
        return selection?.selection?.name || formatLabel(selection?.selection?.code);
    }

    async function loadBuilder() {
        state.builderLoading = true;
        state.builderError = '';
        renderPreview();

        let response = null;

        try {
            response = await fetch('/api/v1/admin/slip-builder', { credentials: 'same-origin' });
            const payload = await readJson(response);

            if (response.status === 401) throw new Error('Your admin session expired.');
            if (!response.ok) throw new Error(friendlyFailure(response, payload, 'load your slip'));

            state.builder = payload;
        } catch (error) {
            state.builderError = response ? error.message : networkFailure;
        } finally {
            state.builderLoading = false;
            renderPreview();
        }
    }

    async function searchMatches(query) {
        state.searching = true;
        state.searched = false;
        state.query = query;
        state.searchError = '';
        state.matches = [];
        renderSearch();
        renderResults();

        let response = null;

        try {
            response = await fetch(`/api/trueodds/matches/search?q=${encodeURIComponent(query)}&limit=50`, {
                credentials: 'same-origin'
            });
            const payload = await readJson(response);

            if (!response.ok) throw new Error(friendlyFailure(response, payload, 'search matches'));

            state.matches = (payload?.matches ?? []).map(normalizeMatch).filter((match) => match.trueOddsId);
            state.searched = true;
        } catch (error) {
            state.searchError = response ? error.message : networkFailure;
        } finally {
            state.searching = false;
            renderSearch();
            renderResults();
        }
    }

    async function loadMarkets(match) {
        state.match = match;
        state.markets = [];
        state.marketsError = '';
        state.marketsLoading = true;
        renderResults();
        renderMarkets();

        let response = null;

        try {
            response = await fetch(`/api/trueodds/matches/${encodeURIComponent(match.trueOddsId)}/markets`, {
                credentials: 'same-origin'
            });
            const payload = await readJson(response);

            if (!response.ok) throw new Error(friendlyFailure(response, payload, 'load markets'));

            state.markets = normalizeMarkets(payload);
        } catch (error) {
            state.marketsError = response ? error.message : networkFailure;
        } finally {
            state.marketsLoading = false;
            renderMarkets();
        }
    }

    async function addSelection(selection) {
        state.saveError = '';

        let response = null;

        try {
            response = await fetch('/api/v1/admin/slip-builder/selections', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matchId: state.match.trueOddsId,
                    sourceOddsId: selection.sourceOddsId
                })
            });
            const payload = await readJson(response);

            if (response.status === 401) throw new Error('Your admin session expired.');
            if (!response.ok) throw new Error(errorMessage(payload, `Could not add selection (HTTP ${response.status}).`));

            state.builder = payload;
        } catch (error) {
            state.saveError = response ? error.message : networkFailure;
        } finally {
            renderMarkets();
            renderPreview();
        }
    }

    async function removeSelection(sourceOddsId) {
        const response = await fetch(`/api/v1/admin/slip-builder/selections/${encodeURIComponent(sourceOddsId)}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const payload = await readJson(response);

        if (response.ok) {
            state.builder = payload;
            state.saved = null;
            renderMarkets();
            renderPreview();
        }
    }

    async function clearBuilder() {
        const response = await fetch('/api/v1/admin/slip-builder', {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const payload = await readJson(response);

        if (response.ok) {
            state.builder = payload;
            state.saved = null;
            state.title = '';
            renderPreview();
            renderMarkets();
        }
    }

    async function saveSlip() {
        if (state.saving || !state.builder?.selectionCount) return;

        state.saving = true;
        state.saveError = '';
        renderPreview();

        let response = null;

        try {
            response = await fetch('/api/v1/admin/slip-builder/save', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: state.title })
            });
            const payload = await readJson(response);

            if (response.status === 401) throw new Error('Your admin session expired.');
            if (!response.ok) throw new Error(errorMessage(payload, `Could not save the slip (HTTP ${response.status}).`));

            state.saved = payload;
            state.builder = { selections: [], selectionCount: 0, previewTotalOdds: 1, slipType: null };
            state.title = '';
        } catch (error) {
            state.saveError = response ? error.message : networkFailure;
        } finally {
            state.saving = false;
            renderPreview();
        }
    }

    function renderSearch() {
        els.searchButton.disabled = state.searching;
        els.searchButton.textContent = state.searching ? 'Searching...' : 'Search';

        if (state.searching) return setFeedback(els.feedback, 'Searching matches...', '');
        if (state.searchError) return setFeedback(els.feedback, state.searchError, 'error');

        setFeedback(
            els.feedback,
            state.searched ? `Showing ${state.matches.length} match${state.matches.length === 1 ? '' : 'es'} for "${state.query}".` : '',
            ''
        );
    }

    function renderResults() {
        clear(els.resultsList);
        els.resultsCard.hidden = !state.searched;

        if (!state.searched) return;

        els.resultsCount.textContent = `${state.matches.length} result${state.matches.length === 1 ? '' : 's'}`;
        els.resultsEmpty.hidden = state.matches.length > 0;

        for (const match of state.matches) {
            const item = el('li', 'match-item');
            const body = el('div', 'match-item__body');
            const action = el('button', 'btn btn--ghost btn--sm', 'View markets');

            body.append(
                el('p', 'match-item__title', `${match.home} vs ${match.away}`),
                el('p', 'match-item__meta', [match.competition, formatDateTime(match.startsAt)].filter(Boolean).join(' - ')),
                el('p', 'match-item__meta', formatLabel(match.status || 'scheduled'))
            );
            action.type = 'button';
            action.addEventListener('click', () => loadMarkets(match));
            item.append(body, action);
            els.resultsList.appendChild(item);
        }
    }

    function renderMarkets() {
        if (!state.match) {
            els.marketsCard.hidden = true;
            return;
        }

        els.marketsCard.hidden = false;
        clear(els.matchSummary);
        clear(els.marketGroups);

        els.matchSummary.append(
            el('p', 'match-summary__teams', `${state.match.home} vs ${state.match.away}`),
            el('p', 'match-summary__meta', `${state.match.competition || 'Competition unknown'} - ${formatDateTime(state.match.startsAt)}`)
        );

        if (state.marketsLoading) {
            els.marketsEmpty.hidden = true;
            return setFeedback(els.marketsFeedback, 'Loading markets...', '');
        }

        if (state.marketsError) {
            els.marketsEmpty.hidden = true;
            return setFeedback(els.marketsFeedback, state.marketsError, 'error');
        }

        els.marketsEmpty.hidden = state.markets.length > 0;
        setFeedback(els.marketsFeedback, state.markets.length > 0 ? `${state.markets.length} market${state.markets.length === 1 ? '' : 's'} shown.` : '', '');

        for (const market of state.markets) {
            const group = el('section', 'market-group');
            const header = el('div', 'market-group__header');
            const selections = el('div', 'selections');

            header.append(el('h3', 'market-group__title', market.name), el('span', 'market-group__code', market.code));

            for (const selection of market.selections) {
                const added = state.builder?.selections?.some((item) => item.sourceOddsId === selection.sourceOddsId);
                const button = el('button', 'selection');

                button.type = 'button';
                button.disabled = added;
                button.append(
                    el('span', 'selection__name', selection.name),
                    el('span', 'selection__odds', added ? 'Added' : formatOdds(selection.odds))
                );
                button.addEventListener('click', () => addSelection(selection));
                selections.appendChild(button);
            }

            group.append(header, selections);
            els.marketGroups.appendChild(group);
        }
    }

    function renderPreview() {
        clear(els.preview);

        if (state.builderLoading) {
            els.preview.appendChild(el('p', 'empty', 'Loading your slip...'));
            return;
        }

        if (state.saved) return renderSaved();

        const titleField = el('div', 'field');
        const titleLabel = el('label', 'field__label', 'Slip title (optional)');
        const titleInput = el('input', 'input');

        titleLabel.setAttribute('for', 'slip-title');
        titleInput.id = 'slip-title';
        titleInput.type = 'text';
        titleInput.placeholder = 'Single Pick';
        titleInput.maxLength = 150;
        titleInput.value = state.title;
        titleInput.addEventListener('input', () => {
            state.title = titleInput.value;
        });
        titleField.append(titleLabel, titleInput);
        els.preview.appendChild(titleField);

        if (state.builderError) {
            els.preview.appendChild(el('p', 'empty', state.builderError));
            return;
        }

        const selections = state.builder?.selections ?? [];

        if (selections.length === 0) {
            els.preview.appendChild(el('p', 'empty', 'No selections yet. Search TrueOdds and add an outcome.'));
        } else {
            const list = el('ul', 'selection-list');

            selections.forEach((selection, index) => {
                const item = el('li', 'selection-item');
                const body = el('div', 'selection-item__body');
                const remove = el('button', 'btn btn--ghost btn--sm', 'Remove');

                body.append(
                    el('p', 'selection-item__title', `${index + 1}. ${selection.match.homeTeam} vs ${selection.match.awayTeam}`),
                    el('p', 'selection-item__meta', `${predictionLabel(selection)} - ${selection.market.name || formatLabel(selection.market.code)}`),
                    el('p', 'selection-item__meta', `@ ${formatOdds(selection.displayedOdds)}`)
                );
                remove.type = 'button';
                remove.addEventListener('click', () => removeSelection(selection.sourceOddsId));
                item.append(body, remove);
                list.appendChild(item);
            });

            const rows = el('dl', 'preview__rows');

            rows.append(
                previewRow('Type', state.builder.slipType),
                previewRow('Selections', String(state.builder.selectionCount)),
                previewRow('Total odds', formatTotalOdds(state.builder.previewTotalOdds), 'preview__value--odds'),
                previewRow('Expires', formatDateTime(state.builder.expiresAt))
            );
            els.preview.append(list, rows);
        }

        if (state.saveError) {
            const alert = el('div', 'alert alert--error');

            alert.append(el('p', 'alert__title', 'Slip not saved'), el('p', null, state.saveError));
            els.preview.appendChild(alert);
        }

        const actions = el('div', 'preview__actions');
        const save = el('button', 'btn btn--primary btn--block', state.saving ? 'Saving slip...' : 'Save slip');
        const clearButton = el('button', 'btn btn--ghost btn--block', 'Clear slip');

        save.type = 'button';
        save.disabled = state.saving || selections.length === 0;
        save.addEventListener('click', saveSlip);
        clearButton.type = 'button';
        clearButton.disabled = selections.length === 0;
        clearButton.addEventListener('click', clearBuilder);
        actions.append(save, clearButton);
        els.preview.append(actions, el('p', 'muted-note', 'Odds are re-checked with TrueOdds at save time. The draft stays private until published.'));
    }

    function renderSaved() {
        const slip = state.saved.slip;
        const alert = el('div', 'alert alert--success');
        const rows = el('dl', 'preview__rows');
        const actions = el('div', 'preview__actions');
        const view = el('a', 'btn btn--primary btn--block', 'View slip');
        const another = el('button', 'btn btn--ghost btn--block', 'Build another slip');
        const goToSlips = el('a', 'btn btn--ghost btn--block', 'Go to slips');

        alert.append(el('p', 'alert__title', 'Slip created'), el('p', null, `${slip.slipType} - ${slip.legCount} selection${slip.legCount === 1 ? '' : 's'}`));
        rows.append(
            previewRow('Slip', `#${slip.id}`),
            previewRow('Total odds', formatTotalOdds(slip.totalOdds), 'preview__value--odds'),
            previewRow('Stake', `${Number(slip.stakeUnits)}u`),
            previewRow('Publication', formatLabel(slip.publicationStatus))
        );
        view.href = `/admin/slips?slip=${slip.id}`;
        another.type = 'button';
        another.addEventListener('click', () => {
            state.saved = null;
            loadBuilder();
        });
        goToSlips.href = '/admin/slips';
        actions.append(view, another, goToSlips);
        els.preview.append(alert, rows, actions);
    }

    els.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const query = els.searchInput.value.trim();

        if (!query) {
            setFeedback(els.feedback, 'Enter a team or match name to search.', 'error');
            els.searchInput.focus();
            return;
        }

        searchMatches(query);
    });

    loadBuilder();
    renderSearch();
    renderResults();
    renderMarkets();
    els.searchInput.focus();
})();
