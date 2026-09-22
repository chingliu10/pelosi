/**
 * Admin Slip Builder.
 *
 * Loads pending tips from GET /api/v1/tips?result=pending (stored Pelosi odds -
 * never fresh TrueOdds odds), keeps the selection in browser state, previews the
 * accumulator and creates the draft through POST /api/v1/slips. The backend
 * remains authoritative for total odds, stake, result and publication status.
 */
(() => {
    'use strict';

    const ui = window.PelosiAdminUI;

    const state = {
        search: '',
        offset: 0,
        limit: 20,
        tips: [],
        total: 0,
        loading: false,
        error: '',
        sessionExpired: false,
        selected: [],
        title: '',
        creating: false,
        createError: '',
        created: null
    };

    const els = {
        searchForm: document.getElementById('builder-search-form'),
        searchInput: document.getElementById('builder-search-input'),
        feedback: document.getElementById('builder-feedback'),
        empty: document.getElementById('builder-empty'),
        available: document.getElementById('available-tips'),
        pager: document.getElementById('builder-pager'),
        prev: document.getElementById('builder-prev'),
        next: document.getElementById('builder-next'),
        range: document.getElementById('builder-range'),
        preview: document.getElementById('slip-preview')
    };

    /* ---------------- data ---------------- */

    async function loadTips() {
        state.loading = true;
        state.error = '';
        state.sessionExpired = false;
        render();

        const params = new URLSearchParams({ result: 'pending' });

        if (state.search) params.set('search', state.search);

        params.set('limit', String(state.limit));
        params.set('offset', String(state.offset));

        let response = null;

        try {
            response = await fetch(`/api/v1/tips?${params.toString()}`, { credentials: 'same-origin' });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, 'load pending tips'));
            }

            state.tips = payload.tips ?? [];
            state.total = Number(payload.total ?? state.tips.length);

            // A tip may have settled since it was added to the selection.
            const stale = state.selected.filter((selected) => {
                const fresh = state.tips.find((tip) => tip.id === selected.id);

                return fresh && fresh.result !== 'pending';
            });

            if (stale.length > 0) {
                state.selected = state.selected.filter((selected) => !stale.some((tip) => tip.id === selected.id));
                state.createError = `Removed ${stale.map((tip) => `tip ${tip.id}`).join(', ')}: no longer pending.`;
            }
        } catch (error) {
            state.error = state.sessionExpired
                ? error.message
                : (response ? error.message : ui.networkFailure);
        } finally {
            state.loading = false;
            render();
        }
    }

    /* ---------------- selection ---------------- */

    function isSelected(tip) {
        return state.selected.some((selected) => selected.id === tip.id);
    }

    function conflictsWithSelection(tip) {
        return state.selected.some((selected) => selected.match.id === tip.match.id);
    }

    function addTip(tip) {
        if (isSelected(tip) || conflictsWithSelection(tip)) return;

        state.selected = [...state.selected, tip];
        state.createError = '';
        render();
    }

    function removeTip(tipId) {
        state.selected = state.selected.filter((tip) => tip.id !== tipId);
        render();
    }

    function previewTotalOdds() {
        const total = state.selected.reduce((product, tip) => product * Number(tip.odds), 1);

        return state.selected.length === 0 ? 1 : total;
    }

    /* ---------------- creation ---------------- */

    async function createSlip() {
        if (state.selected.length === 0 || state.creating) return;

        state.creating = true;
        state.createError = '';
        renderPreview();

        const body = {
            tipIds: state.selected.map((tip) => tip.id),
            creationType: 'manual'
        };

        if (state.title.trim()) {
            body.title = state.title.trim();
        }

        let response = null;

        try {
            response = await fetch('/api/v1/slips', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.errorMessage(payload, `Could not create the slip (HTTP ${response.status}).`));
            }

            state.created = payload;
        } catch (error) {
            state.createError = error.message || 'Could not create the slip.';
        } finally {
            state.creating = false;
            render();
        }
    }

    /* ---------------- rendering ---------------- */

    function render() {
        renderFeedback();
        renderAvailableTips();
        renderPager();
        renderPreview();
    }

    function renderFeedback() {
        clear(els.feedback);

        if (state.sessionExpired) {
            els.feedback.className = 'feedback';
            els.feedback.appendChild(ui.sessionExpiredAlert('/admin/slips/new'));
            return;
        }

        if (state.loading) {
            ui.setFeedback(els.feedback, 'Loading tips…', '');
            return;
        }

        if (state.error) {
            ui.setFeedback(els.feedback, state.error, 'error');
            return;
        }

        if (state.createError) {
            ui.setFeedback(els.feedback, state.createError, 'error');
            return;
        }

        ui.setFeedback(els.feedback, state.tips.length > 0
            ? `${state.total} pending tip${state.total === 1 ? '' : 's'} available.`
            : '', '');
    }

    function renderAvailableTips() {
        clear(els.available);
        clear(els.empty);
        els.empty.hidden = true;

        if (state.loading || state.error || state.sessionExpired) return;

        if (state.tips.length === 0) {
            els.empty.hidden = false;

            if (state.search) {
                els.empty.append(ui.el('p', null, 'No pending tips match this search.'));

                const clearButton = ui.el('button', 'btn btn--ghost btn--sm', 'Clear search');

                clearButton.type = 'button';
                clearButton.addEventListener('click', () => {
                    state.search = '';
                    state.offset = 0;
                    els.searchInput.value = '';
                    loadTips();
                });
                els.empty.appendChild(clearButton);
                return;
            }

            els.empty.append(ui.el('p', null, 'No pending tips available.'));

            const link = ui.el('a', 'btn btn--primary btn--sm', 'Create a tip');

            link.href = '/admin/tips/new';
            els.empty.appendChild(link);
            return;
        }

        for (const tip of state.tips) {
            els.available.appendChild(tipRow(tip));
        }
    }

    function tipRow(tip) {
        const selected = isSelected(tip);
        const conflict = !selected && conflictsWithSelection(tip);
        const row = ui.el('li', `tip-card${selected ? ' is-active' : ''}`);
        const body = ui.el('div', 'tip-card__button tip-card__button--static');
        const main = ui.el('div', 'tip-card__main');

        main.append(
            ui.el('p', 'tip-card__title', `${tip.match.homeTeam} vs ${tip.match.awayTeam}`),
            ui.el('p', 'tip-card__meta', tip.match.competition || 'Competition unknown')
        );

        const details = ui.el('div', 'tip-card__details');

        details.append(
            ui.field('Prediction', ui.predictionLabel(tip)),
            ui.field('Market', tip.marketName || ui.formatLabel(tip.marketCode)),
            ui.field('Odds', ui.formatOdds(tip.odds), 'tabular'),
            ui.field('Kickoff', ui.formatDateTime(tip.match.startsAt))
        );

        const side = ui.el('div', 'tip-card__side');

        side.appendChild(ui.el('span', `status-pill status-pill--${ui.statusTone(tip.result)}`, ui.formatLabel(tip.result)));

        if (selected || conflict) {
            const label = selected ? 'Added' : 'Same match';
            const button = ui.el('button', 'btn btn--ghost btn--sm', label);

            button.type = 'button';
            button.disabled = true;
            side.appendChild(button);

            if (conflict) {
                side.appendChild(ui.el('span', 'tip-card__id', 'Already one tip from this match'));
            }
        } else {
            const add = ui.el('button', 'btn btn--primary btn--sm', 'Add to slip');

            add.type = 'button';
            add.setAttribute('aria-label', `Add ${ui.predictionLabel(tip)} to the slip`);
            add.addEventListener('click', () => addTip(tip));
            side.appendChild(add);
        }

        body.append(main, details, side);
        row.appendChild(body);

        return row;
    }

    function renderPager() {
        const show = !state.loading && !state.error && !state.sessionExpired && state.total > state.limit;

        els.pager.hidden = !show;

        if (!show) return;

        const from = state.total === 0 ? 0 : state.offset + 1;
        const to = Math.min(state.offset + state.tips.length, state.total);

        els.range.textContent = `Showing ${from}–${to} of ${state.total}`;
        els.prev.disabled = state.offset <= 0;
        els.next.disabled = state.offset + state.limit >= state.total;
    }

    function renderPreview() {
        clear(els.preview);

        if (state.created) {
            renderCreated();
            return;
        }

        if (state.sessionExpired) {
            els.preview.appendChild(ui.el('p', 'empty', 'Session expired.'));
            return;
        }

        const titleField = ui.el('div', 'field');
        const titleLabel = ui.el('label', 'field__label', 'Slip title (optional)');

        titleLabel.setAttribute('for', 'slip-title');
        titleField.appendChild(titleLabel);

        const titleInput = ui.el('input', 'input');

        titleInput.id = 'slip-title';
        titleInput.type = 'text';
        titleInput.placeholder = "Today's Double";
        titleInput.value = state.title;
        titleInput.maxLength = 150;
        titleInput.addEventListener('input', () => {
            state.title = titleInput.value;
        });
        titleField.appendChild(titleInput);
        els.preview.appendChild(titleField);

        if (state.selected.length === 0) {
            els.preview.appendChild(ui.el(
                'p',
                'empty',
                'No tips selected yet. Add pending tips from the list on the left.'
            ));
        } else {
            const list = ui.el('ul', 'selection-list');

            state.selected.forEach((tip, index) => {
                const item = ui.el('li', 'selection-item');
                const text = ui.el('div', 'selection-item__body');

                text.append(
                    ui.el('p', 'selection-item__title', `${index + 1}. ${tip.match.homeTeam} vs ${tip.match.awayTeam}`),
                    ui.el('p', 'selection-item__meta', `${ui.predictionLabel(tip)} • ${tip.marketName || ui.formatLabel(tip.marketCode)}`),
                    ui.el('p', 'selection-item__meta', `@ ${ui.formatOdds(tip.odds)}`)
                );

                const remove = ui.el('button', 'btn btn--ghost btn--sm', 'Remove');

                remove.type = 'button';
                remove.setAttribute('aria-label', `Remove ${ui.predictionLabel(tip)} from the slip`);
                remove.addEventListener('click', () => removeTip(tip.id));

                item.append(text, remove);
                list.appendChild(item);
            });

            els.preview.appendChild(list);

            const rows = ui.el('dl', 'preview__rows');

            rows.append(
                ui.previewRow('Selections', String(state.selected.length)),
                ui.previewRow('Total odds (preview)', ui.formatTotalOdds(previewTotalOdds()), 'preview__value--odds'),
                ui.previewRow('Stake', '1u')
            );

            els.preview.appendChild(rows);
        }

        if (state.createError) {
            const alert = ui.el('div', 'alert alert--error');

            alert.append(
                ui.el('p', 'alert__title', 'Slip not created'),
                ui.el('p', null, state.createError)
            );
            els.preview.appendChild(alert);
        }

        const actions = ui.el('div', 'preview__actions');
        const create = ui.el('button', 'btn btn--primary btn--block', state.creating ? 'Creating slip…' : 'Create draft');

        create.type = 'button';
        create.disabled = state.creating || state.selected.length === 0;
        create.addEventListener('click', createSlip);
        actions.appendChild(create);
        els.preview.append(actions, ui.el('p', 'muted-note', 'Pelosi calculates the stored total odds from the tip odds snapshots.'));
    }

    function renderCreated() {
        const slip = state.created;

        const alert = ui.el('div', 'alert alert--success');

        alert.append(
            ui.el('p', 'alert__title', 'Draft slip created'),
            ui.el('p', null, ui.slipLabel(slip))
        );

        const rows = ui.el('dl', 'preview__rows');

        rows.append(
            ui.previewRow('Slip', `#${slip.id}`),
            ui.previewRow('Selections', String(slip.tips?.length ?? state.selected.length)),
            ui.previewRow('Total odds', ui.formatTotalOdds(slip.totalOdds), 'preview__value--odds'),
            ui.previewRow('Stake', `${Number(slip.stakeUnits)}u`),
            ui.previewRow('Status', ui.formatLabel(slip.result)),
            ui.previewRow('Publication', ui.formatLabel(slip.publicationStatus))
        );

        const actions = ui.el('div', 'preview__actions');
        const view = ui.el('a', 'btn btn--primary btn--block', 'View slip');
        const another = ui.el('button', 'btn btn--ghost btn--block', 'Create another slip');
        const goToSlips = ui.el('a', 'btn btn--ghost btn--block', 'Go to slips');

        view.href = `/admin/slips?slip=${slip.id}`;
        goToSlips.href = '/admin/slips';
        another.type = 'button';
        another.addEventListener('click', () => {
            state.created = null;
            state.selected = [];
            state.title = '';
            state.createError = '';
            loadTips();
        });

        actions.append(view, another, goToSlips);
        els.preview.append(
            alert,
            rows,
            actions,
            ui.el('p', 'muted-note', 'The draft stays private until it is published from the Slips screen.')
        );
    }

    /* ---------------- interactions ---------------- */

    els.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        state.search = els.searchInput.value.trim();
        state.offset = 0;
        loadTips();
    });

    els.prev.addEventListener('click', () => {
        state.offset = Math.max(0, state.offset - state.limit);
        loadTips();
    });

    els.next.addEventListener('click', () => {
        if (state.offset + state.limit >= state.total) return;

        state.offset += state.limit;
        loadTips();
    });

    loadTips();
})();
