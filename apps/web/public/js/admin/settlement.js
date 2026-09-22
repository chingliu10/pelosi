/**
 * Admin Settlement Monitor.
 *
 * The queue comes from local Pelosi data only (GET /api/v1/settlement/matches),
 * so opening the screen never fans out TrueOdds requests. TrueOdds is contacted
 * exactly once when the admin checks a specific match, and settlement always
 * runs through the existing engine on the server.
 */
(() => {
    'use strict';

    const ui = window.PelosiAdminUI;

    const classificationLabels = {
        safe_final: 'Safe to settle',
        not_ready: 'Not finished yet',
        manual_review: 'Manual review required',
        void: 'Void result'
    };

    const classificationTones = {
        safe_final: 'won',
        not_ready: 'pending',
        manual_review: 'lost',
        void: 'void'
    };

    const state = {
        localStatus: 'all',
        search: '',
        offset: 0,
        limit: 20,
        matches: [],
        total: 0,
        loading: false,
        error: '',
        sessionExpired: false,
        selected: null,
        preview: null,
        previewLoading: false,
        previewError: '',
        settling: false,
        settleResult: null,
        settleError: '',
        refreshing: false
    };

    const els = {
        refresh: document.getElementById('queue-refresh'),
        searchForm: document.getElementById('queue-search-form'),
        searchInput: document.getElementById('queue-search-input'),
        statusFilter: document.getElementById('queue-status-filter'),
        feedback: document.getElementById('queue-feedback'),
        empty: document.getElementById('queue-empty'),
        list: document.getElementById('queue-list'),
        pager: document.getElementById('queue-pager'),
        prev: document.getElementById('queue-prev'),
        next: document.getElementById('queue-next'),
        range: document.getElementById('queue-range'),
        panel: document.getElementById('result-panel')
    };

    /* ---------------- queue (local data only) ---------------- */

    async function loadQueue() {
        state.loading = true;
        state.error = '';
        state.sessionExpired = false;
        render();

        const params = new URLSearchParams();

        if (state.localStatus !== 'all') params.set('localStatus', state.localStatus);
        if (state.search) params.set('search', state.search);

        params.set('limit', String(state.limit));
        params.set('offset', String(state.offset));

        let response = null;

        try {
            response = await fetch(`/api/v1/settlement/matches?${params.toString()}`, { credentials: 'same-origin' });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, 'load the settlement queue'));
            }

            state.matches = payload.matches ?? [];
            state.total = Number(payload.total ?? state.matches.length);
        } catch (error) {
            state.error = state.sessionExpired
                ? error.message
                : (response ? error.message : ui.networkFailure);
        } finally {
            state.loading = false;
            state.refreshing = false;
            render();
        }
    }

    /* ---------------- preview (one TrueOdds request, on demand) ---------------- */

    async function checkResult(match) {
        state.selected = match;
        state.preview = null;
        state.previewError = '';
        state.settleResult = null;
        state.settleError = '';
        state.previewLoading = true;
        render();

        let response = null;

        try {
            response = await fetch(
                `/api/v1/settlement/matches/${encodeURIComponent(match.sourceMatchId)}/preview`,
                { credentials: 'same-origin' }
            );
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, 'check the TrueOdds result'));
            }

            state.preview = payload;
        } catch (error) {
            state.previewError = state.sessionExpired
                ? error.message
                : (response ? error.message : ui.networkFailure);
        } finally {
            state.previewLoading = false;
            render();
        }
    }

    /* ---------------- settle (existing engine) ---------------- */

    async function settleMatch() {
        if (!state.selected || state.settling) return;

        state.settling = true;
        state.settleError = '';
        state.settleResult = null;
        renderPanel();

        let response = null;

        try {
            response = await fetch(
                `/api/v1/settlement/matches/${encodeURIComponent(state.selected.sourceMatchId)}`,
                { method: 'POST', credentials: 'same-origin' }
            );
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, 'settle the match'));
            }

            state.settleResult = payload;
            state.refreshing = true;
        } catch (error) {
            state.settleError = state.sessionExpired
                ? error.message
                : (response ? error.message : ui.networkFailure);
        } finally {
            state.settling = false;
            renderPanel();
        }

        if (state.settleResult) {
            // The queue counts change after settlement, so reload the local list.
            await loadQueue();
            state.refreshing = false;
            renderPanel();
        }
    }

    /* ---------------- rendering ---------------- */

    function render() {
        renderFeedback();
        renderQueue();
        renderPager();
        renderPanel();
    }

    function renderFeedback() {
        if (state.sessionExpired) {
            els.feedback.className = 'feedback';
            ui.clear(els.feedback);
            els.feedback.appendChild(ui.sessionExpiredAlert('/admin/settlement'));
            return;
        }

        if (state.loading) {
            ui.setFeedback(els.feedback, 'Loading settlement queue…', '');
            return;
        }

        if (state.error) {
            ui.setFeedback(els.feedback, state.error, 'error');
            return;
        }

        ui.setFeedback(els.feedback, state.total > 0
            ? `${state.total} match${state.total === 1 ? '' : 'es'} with pending tips.`
            : '', '');
    }

    function renderQueue() {
        ui.clear(els.list);
        ui.clear(els.empty);
        els.empty.hidden = true;

        if (state.loading || state.error || state.sessionExpired) return;

        if (state.matches.length === 0) {
            els.empty.hidden = false;

            const filtered = state.localStatus !== 'all' || state.search !== '';

            if (filtered) {
                els.empty.append(ui.el('p', null, 'No search results.'));

                const clearButton = ui.el('button', 'btn btn--ghost btn--sm', 'Clear filters');

                clearButton.type = 'button';
                clearButton.addEventListener('click', () => {
                    state.localStatus = 'all';
                    state.search = '';
                    state.offset = 0;
                    els.searchInput.value = '';
                    els.statusFilter.value = 'all';
                    loadQueue();
                });
                els.empty.appendChild(clearButton);
                return;
            }

            els.empty.append(ui.el('p', null, 'No matches currently require settlement.'));
            return;
        }

        for (const match of state.matches) {
            els.list.appendChild(queueRow(match));
        }
    }

    function queueRow(match) {
        const selected = state.selected?.matchId === match.matchId;
        const row = ui.el('li', `queue-card${selected ? ' is-active' : ''}`);
        const body = ui.el('div', 'tip-card__button tip-card__button--static');
        const main = ui.el('div', 'tip-card__main');

        main.append(
            ui.el('p', 'tip-card__title', `${match.homeTeam} vs ${match.awayTeam}`),
            ui.el('p', 'tip-card__meta', match.competition || 'Competition unknown'),
            ui.el('p', 'tip-card__meta', `Kickoff: ${ui.formatDateTime(match.startsAt)}`)
        );

        const details = ui.el('div', 'tip-card__details');

        details.append(
            ui.field('Pending tips', String(match.pendingTipCount)),
            ui.field('Affected slips', String(match.affectedPendingSlipCount)),
            ui.field('Local score', match.homeScore === null ? '—' : `${match.homeScore} - ${match.awayScore}`)
        );

        const side = ui.el('div', 'tip-card__side');
        const check = ui.el('button', 'btn btn--primary btn--sm', 'Check result');

        check.type = 'button';
        check.setAttribute('aria-label', `Check the TrueOdds result for ${match.homeTeam} vs ${match.awayTeam}`);
        check.disabled = state.previewLoading && selected;
        check.addEventListener('click', () => checkResult(match));

        side.append(
            ui.el('span', `status-pill status-pill--${ui.statusTone(match.localStatus)}`, ui.formatLabel(match.localStatus)),
            check
        );

        body.append(main, details, side);
        row.appendChild(body);

        return row;
    }

    function renderPager() {
        const show = !state.loading && !state.error && !state.sessionExpired && (state.offset > 0 || state.total > state.limit);

        els.pager.hidden = !show;

        if (!show) return;

        const from = state.total === 0 ? 0 : state.offset + 1;
        const to = state.offset + state.matches.length;

        els.range.textContent = `Showing ${from}–${to} of ${state.total}`;
        els.prev.disabled = state.offset <= 0;
        els.next.disabled = state.offset + state.limit >= state.total;
    }

    function renderPanel() {
        ui.clear(els.panel);

        if (state.sessionExpired) {
            els.panel.appendChild(ui.el('p', 'empty', 'Session expired.'));
            return;
        }

        if (!state.selected) {
            els.panel.appendChild(ui.el('p', 'empty', 'Choose a match and check its TrueOdds result.'));
            return;
        }

        els.panel.append(
            ui.el('p', 'preview__match', `${state.selected.homeTeam} vs ${state.selected.awayTeam}`),
            ui.el('p', 'preview__meta', state.selected.competition || 'Competition unknown')
        );

        if (state.previewLoading) {
            els.panel.appendChild(ui.el('p', 'empty', 'Checking TrueOdds result…'));
            return;
        }

        if (state.previewError) {
            const alert = ui.el('div', 'alert alert--error');

            alert.append(
                ui.el('p', 'alert__title', 'TrueOdds result unavailable'),
                ui.el('p', null, state.previewError)
            );
            els.panel.append(alert, checkAgainButton());
            return;
        }

        if (!state.preview) {
            els.panel.appendChild(ui.el('p', 'empty', 'No result checked yet.'));
            return;
        }

        const preview = state.preview;
        const classification = preview.status ?? 'manual_review';
        const alert = ui.el('div', `alert alert--${toneToAlert(classificationTones[classification] ?? 'void')}`);

        alert.append(
            ui.el('p', 'alert__title', classificationLabels[classification] ?? 'Manual review required'),
            ui.el('p', null, preview.reason)
        );
        els.panel.appendChild(alert);

        const rows = ui.el('dl', 'preview__rows');

        rows.append(
            ui.previewRow('TrueOdds status', preview.trueOdds?.status ?? '—'),
            ui.previewRow('Result status', preview.trueOdds?.resultStatus ?? '—'),
            ui.previewRow('Score', preview.trueOdds?.score
                ? `${preview.trueOdds.score.home ?? '—'} - ${preview.trueOdds.score.away ?? '—'}`
                : '—'),
            ui.previewRow('Final result', preview.trueOdds?.finalResult ?? '—'),
            ui.previewRow('Classification', classification),
            ui.previewRow('Local match', `${ui.formatLabel(preview.localMatch.status)}${preview.wouldUpdateLocalMatch ? ' (will be updated)' : ''}`)
        );

        els.panel.appendChild(rows);

        renderImpact(preview);

        if (state.settleError) {
            const error = ui.el('div', 'alert alert--error');

            error.append(
                ui.el('p', 'alert__title', 'Settlement failed'),
                ui.el('p', null, state.settleError)
            );
            els.panel.appendChild(error);
        }

        if (state.settleResult) {
            renderSettleResult(state.settleResult);
        }

        const actions = ui.el('div', 'preview__actions');

        if (preview.canAutoSettle) {
            const settle = ui.el('button', 'btn btn--primary btn--block', state.settling
                ? 'Settling match…'
                : (preview.actionLabel || 'Settle match'));

            settle.type = 'button';
            settle.disabled = state.settling;
            settle.addEventListener('click', settleMatch);
            actions.appendChild(settle);
        } else {
            actions.appendChild(checkAgainButton());
        }

        els.panel.append(
            actions,
            ui.el('p', 'muted-note', 'The preview is informational. Settlement re-validates the live TrueOdds result on the server.')
        );
    }

    function checkAgainButton() {
        const button = ui.el('button', 'btn btn--ghost btn--block', 'Check again');

        button.type = 'button';
        button.disabled = state.previewLoading;
        button.addEventListener('click', () => checkResult(state.selected));

        return button;
    }

    function renderImpact(preview) {
        const tipsTitle = ui.el('h3', 'legs__title', `Affected tips (${preview.pendingTipCount})`);

        els.panel.appendChild(tipsTitle);

        if (preview.pendingTips.length === 0) {
            els.panel.appendChild(ui.el('p', 'empty', 'No pending tips for this match.'));
        } else {
            const legs = ui.el('div', 'legs');

            for (const tip of preview.pendingTips) {
                const leg = ui.el('div', 'leg');
                const body = ui.el('div', 'leg__body');
                const side = ui.el('div', 'leg__side');

                body.append(
                    ui.el('p', 'leg__title', ui.predictionLabel({
                        ...tip,
                        match: {
                            homeTeam: state.selected.homeTeam,
                            awayTeam: state.selected.awayTeam
                        }
                    })),
                    ui.el('p', 'leg__meta', `${tip.marketName || ui.formatLabel(tip.marketCode)} • @ ${ui.formatOdds(tip.odds)}`),
                    ui.el('p', 'leg__meta', tip.reason)
                );

                side.append(
                    ui.el('span', `status-pill status-pill--${ui.statusTone(tip.predictedResult ?? tip.result)}`, tip.willAutoSettle
                        ? ui.formatLabel(tip.predictedResult)
                        : 'Manual review'),
                    ui.el('span', 'tip-card__id', `Tip #${tip.id}`)
                );

                leg.append(body, side);
                legs.appendChild(leg);
            }

            els.panel.appendChild(legs);
        }

        const slipsTitle = ui.el('h3', 'legs__title', `Affected pending slips (${preview.affectedPendingSlipCount})`);

        els.panel.appendChild(slipsTitle);

        if (preview.affectedSlips.length === 0) {
            els.panel.appendChild(ui.el('p', 'empty', 'No affected slips.'));
        } else {
            const legs = ui.el('div', 'legs');

            for (const slip of preview.affectedSlips) {
                const leg = ui.el('div', 'leg');
                const body = ui.el('div', 'leg__body');
                const side = ui.el('div', 'leg__side');

                body.append(
                    ui.el('p', 'leg__title', ui.slipLabel(slip)),
                    ui.el('p', 'leg__meta', `${slip.legCount} leg${slip.legCount === 1 ? '' : 's'} • total odds ${ui.formatTotalOdds(slip.totalOdds)}`)
                );

                side.append(
                    ui.el('span', `status-pill status-pill--${ui.statusTone(slip.result)}`, ui.formatLabel(slip.result)),
                    ui.el('span', 'tip-card__id', `Slip #${slip.id}`)
                );

                leg.append(body, side);
                legs.appendChild(leg);
            }

            els.panel.appendChild(legs);
        }

        for (const note of preview.notes ?? []) {
            els.panel.appendChild(ui.el('p', 'muted-note', note));
        }
    }

    function renderSettleResult(result) {
        const updated = result.tipsUpdated ?? [];
        const counts = {
            won: updated.filter((tip) => tip.result === 'won').length,
            lost: updated.filter((tip) => tip.result === 'lost').length,
            void: updated.filter((tip) => tip.result === 'void').length
        };
        const changed = Number(result.tipsChanged ?? 0);
        const tone = changed > 0 || result.localMatchUpdated || (result.slipsUpdated ?? []).length > 0
            ? 'success'
            : 'pending';
        const alert = ui.el('div', `alert alert--${tone}`);

        alert.append(
            ui.el('p', 'alert__title', changed > 0 ? 'Settlement complete' : 'Nothing changed'),
            ui.el('p', null, result.reason ?? '')
        );
        els.panel.appendChild(alert);

        const rows = ui.el('dl', 'preview__rows');

        rows.append(
            ui.previewRow('Status', ui.formatLabel(result.status)),
            ui.previewRow('Tips updated', String(changed)),
            ui.previewRow('Won', String(counts.won)),
            ui.previewRow('Lost', String(counts.lost)),
            ui.previewRow('Void', String(counts.void)),
            ui.previewRow('Slips recalculated', String((result.slipsUpdated ?? []).length)),
            ui.previewRow('Local match updated', result.localMatchUpdated ? 'Yes' : 'No')
        );

        if (result.localMatch) {
            rows.append(ui.previewRow(
                'Local snapshot',
                `${ui.formatLabel(result.localMatch.status)} ${result.localMatch.homeScore ?? '—'}-${result.localMatch.awayScore ?? '—'}`
            ));
        }

        els.panel.appendChild(rows);

        if (updated.length > 0) {
            const legs = ui.el('div', 'legs');

            legs.appendChild(ui.el('h3', 'legs__title', 'Tips updated'));

            for (const tip of updated) {
                const leg = ui.el('div', 'leg');
                const body = ui.el('div', 'leg__body');

                body.append(
                    ui.el('p', 'leg__title', `Tip #${tip.id}`),
                    ui.el('p', 'leg__meta', `${tip.marketCode} / ${tip.selectionCode} • @ ${ui.formatOdds(tip.odds)}`)
                );

                leg.append(body, ui.el('span', `status-pill status-pill--${ui.statusTone(tip.result)}`, ui.formatLabel(tip.result)));
                legs.appendChild(leg);
            }

            els.panel.appendChild(legs);
        }

        if ((result.tipsSkipped ?? []).length > 0) {
            const skipped = ui.el('div', 'legs');

            skipped.appendChild(ui.el('h3', 'legs__title', 'Left for manual review'));

            for (const tip of result.tipsSkipped) {
                const leg = ui.el('div', 'leg');
                const body = ui.el('div', 'leg__body');

                body.append(
                    ui.el('p', 'leg__title', `Tip #${tip.id}`),
                    ui.el('p', 'leg__meta', `${tip.marketCode} / ${tip.selectionCode} • ${tip.reason}`)
                );

                leg.append(body, ui.el('span', 'status-pill status-pill--pending', 'Manual review'));
                skipped.appendChild(leg);
            }

            els.panel.appendChild(skipped);
        }

        for (const slip of result.slipsRequiringManualReview ?? []) {
            els.panel.appendChild(ui.el('p', 'muted-note', `Slip #${slip.slipId}: ${slip.reason}`));
        }

        if (state.refreshing) {
            els.panel.appendChild(ui.el('p', 'muted-note', 'Refreshing settlement queue…'));
        }
    }

    function toneToAlert(tone) {
        if (tone === 'won') return 'success';
        if (tone === 'lost') return 'error';
        if (tone === 'pending') return 'pending';

        return 'pending';
    }

    /* ---------------- interactions ---------------- */

    els.refresh.addEventListener('click', () => {
        state.refreshing = true;
        renderPanel();
        loadQueue();
    });

    els.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        state.search = els.searchInput.value.trim();
        state.offset = 0;
        loadQueue();
    });

    els.statusFilter.addEventListener('change', () => {
        state.localStatus = els.statusFilter.value;
        state.offset = 0;
        loadQueue();
    });

    els.prev.addEventListener('click', () => {
        state.offset = Math.max(0, state.offset - state.limit);
        loadQueue();
    });

    els.next.addEventListener('click', () => {
        if (state.offset + state.limit >= state.total) return;

        state.offset += state.limit;
        loadQueue();
    });

    loadQueue();
})();
