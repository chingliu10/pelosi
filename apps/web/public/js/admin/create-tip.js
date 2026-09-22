/**
 * Admin: create tip from TrueOdds.
 *
 * Every data call goes through the Pelosi API (never TrueOdds directly), so the
 * TrueOdds API key stays on the server. The browser only ever sends the minimum
 * selection identity (match id + source odds id); Pelosi re-fetches the odds
 * and stores the snapshot.
 */
(() => {
    'use strict';

    const categoryLabels = {
        ALL: 'All',
        MATCH_RESULT: 'Match result',
        GOALS: 'Goals',
        DOUBLE_CHANCE: 'Double chance',
        BTTS: 'BTTS',
        HANDICAP: 'Handicap',
        OTHER: 'Other'
    };

    const state = {
        query: '',
        searching: false,
        searchError: '',
        searchNote: '',
        searched: false,
        matches: [],
        match: null,
        marketsLoading: false,
        marketsError: '',
        markets: [],
        category: 'ALL',
        selection: null,
        importing: false,
        importError: '',
        duplicate: null,
        imported: null
    };

    const els = {
        searchForm: document.getElementById('search-form'),
        searchInput: document.getElementById('search-input'),
        searchButton: document.getElementById('search-button'),
        searchFeedback: document.getElementById('search-feedback'),
        resultsCard: document.getElementById('results-card'),
        resultsCount: document.getElementById('results-count'),
        resultsList: document.getElementById('results-list'),
        resultsEmpty: document.getElementById('results-empty'),
        marketsCard: document.getElementById('markets-card'),
        matchSummary: document.getElementById('match-summary'),
        marketTabs: document.getElementById('market-tabs'),
        marketGroups: document.getElementById('market-groups'),
        marketsEmpty: document.getElementById('markets-empty'),
        marketsFeedback: document.getElementById('markets-feedback'),
        preview: document.getElementById('preview')
    };

    /* ---------------- helpers ---------------- */

    // Leaf helpers are shared with the other admin screens (ui-shared.js).
    // Only the page-specific helpers that deliberately differ stay local:
    // formatKickoff/formatStatus wording, the scheduled/live/finished status
    // tone, the market category mapping and the TrueOdds-specific 5xx message.
    const ui = window.PelosiAdminUI;
    const {
        el,
        clear,
        formatOdds,
        readJson,
        errorMessage,
        setFeedback,
        previewRow,
        networkFailure
    } = ui;

    function formatKickoff(value) {
        if (!value) {
            return 'Kickoff unknown';
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function formatStatus(value) {
        const status = String(value || 'unknown');

        return status.charAt(0).toUpperCase() + status.slice(1);
    }

    function statusTone(status) {
        const normalized = String(status || '').toLowerCase();

        if (['scheduled', 'not start'].includes(normalized)) return 'scheduled';
        if (['live', 'in progress'].includes(normalized)) return 'live';
        if (['finished', 'ended'].includes(normalized)) return 'finished';

        return '';
    }

    function categoryForCode(code) {
        switch (String(code || '').toUpperCase()) {
            case 'MATCH_RESULT':
            case '1X2':
                return 'MATCH_RESULT';
            case 'TOTAL_GOALS':
                return 'GOALS';
            case 'DOUBLE_CHANCE':
                return 'DOUBLE_CHANCE';
            case 'BTTS':
            case 'BOTH_TEAMS_TO_SCORE':
            case 'GG_NG':
                return 'BTTS';
            case 'HANDICAP':
                return 'HANDICAP';
            default:
                return 'OTHER';
        }
    }

    /**
     * Turns an API failure into something an admin can act on. 5xx responses
     * usually mean TrueOdds could not be reached from the Pelosi server.
     */
    function friendlyFailure(response, payload, action) {
        if (response.status === 404) {
            return errorMessage(payload, `Nothing found while trying to ${action}.`);
        }

        if (response.status >= 500) {
            return `TrueOdds is unavailable right now, so Pelosi could not ${action}. Please try again in a moment.`;
        }

        return errorMessage(payload, `Could not ${action} (HTTP ${response.status}).`);
    }

    /* ---------------- normalisation ---------------- */

    function normalizeMatch(raw) {
        const source = raw || {};

        return {
            trueOddsId: String(source.trueOddsId ?? source.trueodds_id ?? source.id ?? ''),
            eventId: source.id ?? source.event_id ?? null,
            home: source.homeTeam?.name ?? source.home_team_name ?? 'Home team',
            away: source.awayTeam?.name ?? source.away_team_name ?? 'Away team',
            competition: source.competition?.name ?? source.league ?? null,
            country: source.competition?.country ?? source.country ?? null,
            startsAt: source.startsAt ?? source.start_time ?? null,
            status: source.status ?? source.match_status ?? null
        };
    }

    function normalizeMarkets(payload) {
        const rawMarkets = Array.isArray(payload?.markets) ? payload.markets : [];

        return rawMarkets
            .map((market) => {
                const rawSelections = market.selections ?? market.outcomes ?? [];

                return {
                    id: String(market.id ?? market.sourceMarketId ?? market.name ?? Math.random()),
                    code: market.code ?? 'UNKNOWN',
                    name: market.name ?? market.market_title ?? market.market_name ?? market.code ?? 'Market',
                    line: market.line ?? null,
                    selections: rawSelections
                        .map((selection) => ({
                            sourceOddsId: String(
                                selection.sourceOddsId ?? selection.event_odds_id ?? selection.id ?? ''
                            ),
                            name: selection.name
                                ?? selection.outcomeName
                                ?? selection.outcome_desc
                                ?? selection.pick_team
                                ?? 'Selection',
                            odds: Number(selection.odds)
                        }))
                        .filter((selection) => selection.sourceOddsId && Number.isFinite(selection.odds))
                };
            })
            .filter((market) => market.selections.length > 0);
    }

    function marketsForCategory() {
        if (state.category === 'ALL') {
            return state.markets;
        }

        return state.markets.filter((market) => categoryForCode(market.code) === state.category);
    }

    function categoriesPresent() {
        const seen = [];

        for (const market of state.markets) {
            const category = categoryForCode(market.code);

            if (!seen.includes(category)) {
                seen.push(category);
            }
        }

        return seen;
    }

    /* ---------------- search ---------------- */

    async function runSearch(query) {
        state.query = query;
        state.searching = true;
        state.searchError = '';
        state.searchNote = '';
        state.searched = false;
        state.matches = [];
        renderSearch();
        renderResults();

        let response = null;

        try {
            response = await fetch(
                `/api/trueodds/matches/search?q=${encodeURIComponent(query)}&limit=50`,
                { credentials: 'same-origin' }
            );
            const payload = await readJson(response);

            if (!response.ok) {
                throw new Error(friendlyFailure(response, payload, 'search matches'));
            }

            state.matches = (payload?.matches ?? [])
                .map(normalizeMatch)
                .filter((match) => match.trueOddsId);
            state.searched = true;

            if (Array.isArray(payload?.integrationWarnings) && payload.integrationWarnings.length > 0) {
                state.searchNote = payload.integrationWarnings.join(' ');
            }
        } catch (error) {
            state.searchError = response ? (error.message || 'Search failed') : networkFailure;
        } finally {
            state.searching = false;
            renderSearch();
            renderResults();
        }
    }

    function renderSearch() {
        els.searchButton.disabled = state.searching;
        els.searchButton.textContent = state.searching ? 'Searching…' : 'Search';
        els.searchInput.setAttribute('aria-busy', String(state.searching));

        if (state.searching) {
            setFeedback(els.searchFeedback, 'Searching matches…', '');
            return;
        }

        if (state.searchError) {
            setFeedback(els.searchFeedback, state.searchError, 'error');
            return;
        }

        if (state.searchNote) {
            setFeedback(els.searchFeedback, state.searchNote, 'pending');
            return;
        }

        setFeedback(
            els.searchFeedback,
            state.searched ? `Showing ${state.matches.length} match${state.matches.length === 1 ? '' : 'es'} for “${state.query}”.` : '',
            ''
        );
    }

    /* ---------------- results ---------------- */

    function renderResults() {
        els.resultsCard.hidden = !state.searched;
        clear(els.resultsList);

        if (!state.searched) {
            els.resultsCount.textContent = '';
            els.resultsEmpty.hidden = true;
            return;
        }

        els.resultsCount.textContent = `${state.matches.length} result${state.matches.length === 1 ? '' : 's'}`;
        els.resultsEmpty.hidden = state.matches.length > 0;

        for (const match of state.matches) {
            els.resultsList.appendChild(matchResultItem(match));
        }
    }

    function matchResultItem(match) {
        const item = el('li', 'match-item');

        if (state.match?.trueOddsId === match.trueOddsId) {
            item.classList.add('is-active');
        }

        const body = el('div', 'match-item__body');
        const title = el('p', 'match-item__title', `${match.home} vs ${match.away}`);
        const meta = el('p', 'match-item__meta');
        const metaParts = [match.competition, formatKickoff(match.startsAt)].filter(Boolean);

        meta.textContent = metaParts.join(' • ');

        const statusRow = el('p', 'match-item__meta');
        const pill = el('span', `status-pill${statusTone(match.status) ? ` status-pill--${statusTone(match.status)}` : ''}`, formatStatus(match.status));

        statusRow.appendChild(pill);

        const idLine = el('span', 'match-item__id', ` TrueOdds ID ${match.trueOddsId}`);

        statusRow.appendChild(idLine);
        body.append(title, meta, statusRow);

        const action = el('button', 'btn btn--ghost btn--sm', 'View markets');

        action.type = 'button';
        action.setAttribute('aria-label', `View markets for ${match.home} vs ${match.away}`);
        action.addEventListener('click', () => loadMarkets(match));

        item.append(body, action);

        return item;
    }

    /* ---------------- markets ---------------- */

    async function loadMarkets(match) {
        state.match = match;
        state.selection = null;
        state.imported = null;
        state.importError = '';
        state.markets = [];
        state.marketsError = '';
        state.marketsLoading = true;
        state.category = 'ALL';
        renderResults();
        renderMarkets();
        renderPreview();

        els.marketsCard.hidden = false;
        els.marketsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

        let response = null;

        try {
            response = await fetch(
                `/api/trueodds/matches/${encodeURIComponent(match.trueOddsId)}/markets`,
                { credentials: 'same-origin' }
            );
            const payload = await readJson(response);

            if (!response.ok) {
                throw new Error(friendlyFailure(response, payload, 'load markets'));
            }

            state.markets = normalizeMarkets(payload);
        } catch (error) {
            state.marketsError = response ? (error.message || 'Markets unavailable') : networkFailure;
        } finally {
            state.marketsLoading = false;
            renderMarkets();
        }
    }

    function renderMarkets() {
        if (!state.match) {
            els.marketsCard.hidden = true;
            return;
        }

        els.marketsCard.hidden = false;
        renderMatchSummary();
        renderTabs();
        clear(els.marketGroups);

        if (state.marketsLoading) {
            setFeedback(els.marketsFeedback, 'Loading markets…', '');
            els.marketsEmpty.hidden = true;
            return;
        }

        if (state.marketsError) {
            setFeedback(els.marketsFeedback, state.marketsError, 'error');
            els.marketsEmpty.hidden = true;
            return;
        }

        const markets = marketsForCategory();

        els.marketsEmpty.hidden = markets.length > 0;
        setFeedback(els.marketsFeedback, markets.length > 0
            ? `${markets.length} market${markets.length === 1 ? '' : 's'} shown.`
            : '', '');

        for (const market of markets) {
            els.marketGroups.appendChild(marketGroup(market));
        }
    }

    function renderMatchSummary() {
        clear(els.matchSummary);

        const teams = el('p', 'match-summary__teams');

        teams.append(
            document.createTextNode(state.match.home),
            el('span', 'match-summary__vs', 'vs'),
            document.createTextNode(state.match.away)
        );

        const meta = el('p', 'match-summary__meta');

        meta.append(
            el('span', null, state.match.competition || 'Competition unknown'),
            el('span', null, `Kickoff: ${formatKickoff(state.match.startsAt)}`),
            el('span', null, `Status: ${formatStatus(state.match.status)}`)
        );

        els.matchSummary.append(teams, meta);
    }

    function renderTabs() {
        clear(els.marketTabs);

        if (state.marketsLoading || state.marketsError || state.markets.length === 0) {
            return;
        }

        const categories = ['ALL', ...categoriesPresent()];

        for (const category of categories) {
            const tab = el('button', `tab${state.category === category ? ' is-active' : ''}`, categoryLabels[category] ?? category);

            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(state.category === category));
            tab.addEventListener('click', () => {
                state.category = category;
                renderMarkets();
            });

            els.marketTabs.appendChild(tab);
        }
    }

    function marketGroup(market) {
        const group = el('section', 'market-group');
        const header = el('div', 'market-group__header');
        const title = el('h3', 'market-group__title', market.name);
        const code = el('span', 'market-group__code', market.code);

        header.append(title, code);

        const selections = el('div', 'selections');

        for (const selection of market.selections) {
            selections.appendChild(selectionButton(market, selection));
        }

        group.append(header, selections);

        return group;
    }

    function selectionButton(market, selection) {
        const isActive = state.selection?.market.id === market.id
            && state.selection?.selection.sourceOddsId === selection.sourceOddsId;
        const button = el('button', `selection${isActive ? ' is-active' : ''}`);

        button.type = 'button';
        button.setAttribute('aria-pressed', String(isActive));
        button.setAttribute('aria-label', `${selection.name} at odds ${formatOdds(selection.odds)}`);
        button.append(
            el('span', 'selection__name', selection.name),
            el('span', 'selection__odds', formatOdds(selection.odds))
        );
        button.addEventListener('click', () => {
            state.selection = { market, selection };
            state.imported = null;
            state.importError = '';
            state.duplicate = null;
            renderMarkets();
            renderPreview();
        });

        return button;
    }

    /* ---------------- preview and import ---------------- */

    function renderPreview() {
        clear(els.preview);

        if (state.imported) {
            renderImportSuccess();
            return;
        }

        if (!state.selection) {
            els.preview.appendChild(el(
                'p',
                'empty',
                state.match
                    ? 'No selection chosen. Pick an outcome from the markets list.'
                    : 'Choose a match and an outcome to preview the tip.'
            ));
            return;
        }

        const { market, selection } = state.selection;
        const match = state.match;

        els.preview.append(
            el('p', 'preview__match', `${match.home} vs ${match.away}`),
            el('p', 'preview__meta', match.competition || 'Competition unknown')
        );

        const rows = el('dl', 'preview__rows');

        rows.append(
            previewRow('Prediction', selection.name),
            previewRow('Market', market.name),
            previewRow('Odds', formatOdds(selection.odds), 'preview__value--odds'),
            previewRow('Kickoff', formatKickoff(match.startsAt)),
            previewRow('Status', formatStatus(match.status))
        );

        els.preview.appendChild(rows);

        if (state.importError) {
            const alert = el('div', 'alert alert--error');

            alert.append(
                el('p', 'alert__title', 'Import failed'),
                el('p', null, state.importError)
            );
            els.preview.appendChild(alert);
        }

        if (state.duplicate) {
            const alert = el('div', 'alert alert--pending');

            alert.append(
                el('p', 'alert__title', 'This selection has already been imported.'),
                el('p', null, state.duplicate.existingTipId
                    ? `Pelosi already has this selection as tip ${state.duplicate.existingTipId}.`
                    : 'Pelosi already has this selection.')
            );

            if (state.duplicate.existingTipId) {
                const link = el('a', 'alert__link', 'View existing tip');

                link.href = `/admin/tips?tip=${state.duplicate.existingTipId}`;
                alert.appendChild(link);
            }

            els.preview.appendChild(alert);
        }

        const actions = el('div', 'preview__actions');
        const importButton = el('button', 'btn btn--primary btn--block', state.importing ? 'Importing…' : 'Import tip');

        importButton.type = 'button';
        importButton.disabled = state.importing;
        importButton.addEventListener('click', importTip);
        actions.appendChild(importButton);

        const note = el('p', 'muted-note', 'Pelosi re-fetches the odds from TrueOdds and stores the snapshot.');

        els.preview.append(actions, note);
    }

    function renderImportSuccess() {
        const { tip, match, market, selection } = state.imported;
        const alert = el('div', 'alert alert--success');

        alert.append(
            el('p', 'alert__title', 'Tip imported'),
            el('p', null, `${match.home} vs ${match.away}`)
        );

        const rows = el('dl', 'preview__rows');

        rows.append(
            previewRow('Prediction', selection.name),
            previewRow('Market', market.name),
            previewRow('Odds snapshot', formatOdds(tip.odds), 'preview__value--odds'),
            previewRow('Tip ID', String(tip.id)),
            previewRow('Result', formatStatus(tip.result))
        );

        const actions = el('div', 'preview__actions');
        const another = el('button', 'btn btn--primary btn--block', 'Import another tip');
        const viewAll = el('a', 'btn btn--ghost btn--block', 'View imported tips');
        const backToSearch = el('button', 'btn btn--ghost btn--block', 'Search another match');

        viewAll.href = '/admin/tips';
        another.type = 'button';
        backToSearch.type = 'button';

        another.addEventListener('click', () => {
            state.imported = null;
            state.selection = null;
            state.duplicate = null;
            renderMarkets();
            renderPreview();
        });

        backToSearch.addEventListener('click', () => {
            state.imported = null;
            state.selection = null;
            state.duplicate = null;
            state.match = null;
            state.markets = [];
            els.marketsCard.hidden = true;
            renderResults();
            renderPreview();
            els.searchInput.focus();
            els.searchInput.select();
        });

        actions.append(another, viewAll, backToSearch);
        els.preview.append(alert, rows, actions, el('p', 'muted-note', 'The tip is pending until settlement.'));
    }

    async function importTip() {
        if (!state.match || !state.selection) {
            return;
        }

        const match = state.match;
        const { market, selection } = state.selection;

        state.importing = true;
        state.importError = '';
        state.duplicate = null;
        renderPreview();

        let response = null;

        try {
            response = await fetch('/api/trueodds/tips/import', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    matchId: match.trueOddsId,
                    sourceOddsId: selection.sourceOddsId,
                    creationType: 'manual'
                })
            });
            const payload = await readJson(response);

            if (response.status === 401) {
                throw new Error('Your admin session expired. Sign in again to import tips.');
            }

            if (response.status === 409) {
                state.duplicate = {
                    existingTipId: payload?.existingTipId ?? null
                };

                return;
            }

            if (!response.ok) {
                throw new Error(friendlyFailure(response, payload, 'import this tip'));
            }

            state.imported = {
                tip: payload.tip,
                match,
                market,
                selection
            };
        } catch (error) {
            state.importError = response ? (error.message || 'Import failed') : networkFailure;
        } finally {
            state.importing = false;
            renderPreview();
        }
    }

    /* ---------------- boot ---------------- */

    els.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const query = els.searchInput.value.trim();

        if (!query) {
            setFeedback(els.searchFeedback, 'Enter a team or match name to search.', 'error');
            els.searchInput.focus();
            return;
        }

        runSearch(query);
    });

    renderPreview();
    els.searchInput.focus();
})();
