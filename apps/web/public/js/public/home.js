(() => {
    'use strict';

    const ui = window.WachimbaPublicUI;
    const els = {
        snapshotSlips: document.getElementById('home-snapshot-slips'),
        snapshotProfit: document.getElementById('home-snapshot-profit'),
        snapshotResult: document.getElementById('home-snapshot-result'),
        slipsLoading: document.getElementById('home-slips-loading'),
        slipsEmpty: document.getElementById('home-slips-empty'),
        slipsError: document.getElementById('home-slips-error'),
        slipsGrid: document.getElementById('home-slips-grid'),
        performanceLoading: document.getElementById('home-performance-loading'),
        performanceEmpty: document.getElementById('home-performance-empty'),
        performanceError: document.getElementById('home-performance-error'),
        performanceMetrics: document.getElementById('home-performance-metrics'),
        historyLoading: document.getElementById('home-history-loading'),
        historyEmpty: document.getElementById('home-history-empty'),
        historyError: document.getElementById('home-history-error'),
        historyList: document.getElementById('home-history-list')
    };

    async function fetchJson(path) {
        const response = await fetch(path, { credentials: 'same-origin' });
        const payload = await ui.readJson(response);

        if (!response.ok || !payload || typeof payload !== 'object') {
            throw new Error(payload?.error || 'The section could not be loaded.');
        }

        return payload;
    }

    async function loadTodaySlips() {
        ui.setHidden(els.slipsLoading, false);
        ui.setHidden(els.slipsEmpty, true);
        ui.setHidden(els.slipsError, true);
        ui.clear(els.slipsGrid);

        try {
            const list = await fetchJson('/api/v1/public/slips?limit=3');

            els.snapshotSlips.textContent = String(list.count ?? list.slips.length);

            if (!Array.isArray(list.slips) || list.slips.length === 0) {
                ui.setHidden(els.slipsEmpty, false);
                return;
            }

            const details = await Promise.all(list.slips.slice(0, 3).map(async (slip) => {
                const response = await fetch(`/api/v1/public/slips/${encodeURIComponent(slip.id)}`, {
                    credentials: 'same-origin'
                });

                return response.ok ? ui.readJson(response) : null;
            }));

            for (const slip of details.filter(Boolean)) {
                els.slipsGrid.appendChild(slipCard(slip, 2));
            }
        } catch {
            els.snapshotSlips.textContent = ui.placeholder;
            ui.setHidden(els.slipsError, false);
        } finally {
            ui.setHidden(els.slipsLoading, true);
        }
    }

    async function loadPerformance() {
        ui.setHidden(els.performanceLoading, false);
        ui.setHidden(els.performanceEmpty, true);
        ui.setHidden(els.performanceError, true);
        ui.clear(els.performanceMetrics);

        try {
            const summary = await fetchJson('/api/v1/performance?range=all');

            els.snapshotProfit.textContent = ui.formatSignedUnits(summary.profitUnits);

            if (Number(summary.totalSlips) === 0) {
                ui.setHidden(els.performanceEmpty, false);
            }

            const cards = [
                ['Profit', ui.formatSignedUnits(summary.profitUnits), tone(summary.profitUnits)],
                ['ROI', ui.formatSignedPercent(summary.roiPercentage), tone(summary.roiPercentage)],
                ['Win Rate', ui.formatPercent(summary.winRatePercentage), 'neutral'],
                ['Settled Slips', ui.formatDecimal(summary.totalSlips, 0), 'neutral']
            ];

            for (const [label, value, cardTone] of cards) {
                const card = ui.el('article', `metric-card metric-card--${cardTone}`);

                card.append(
                    ui.el('p', 'metric-card__label', label),
                    ui.el('p', 'metric-card__value', value),
                    ui.el('p', 'metric-card__hint', label === 'Settled Slips' ? 'Published won/lost slips' : 'Backend performance value')
                );
                els.performanceMetrics.appendChild(card);
            }
        } catch {
            els.snapshotProfit.textContent = ui.placeholder;
            ui.setHidden(els.performanceError, false);
        } finally {
            ui.setHidden(els.performanceLoading, true);
        }
    }

    async function loadRecentResults() {
        ui.setHidden(els.historyLoading, false);
        ui.setHidden(els.historyEmpty, true);
        ui.setHidden(els.historyError, true);
        ui.clear(els.historyList);

        try {
            const history = await fetchJson('/api/v1/public/slips?scope=history&sort=published&limit=5');

            if (!Array.isArray(history.slips) || history.slips.length === 0) {
                els.snapshotResult.textContent = 'No history yet';
                ui.setHidden(els.historyEmpty, false);
                return;
            }

            els.snapshotResult.textContent = ui.formatLabel(history.slips[0].result);

            for (const slip of history.slips.slice(0, 5)) {
                els.historyList.appendChild(resultCard(slip));
            }
        } catch {
            els.snapshotResult.textContent = ui.placeholder;
            ui.setHidden(els.historyError, false);
        } finally {
            ui.setHidden(els.historyLoading, true);
        }
    }

    function tone(value) {
        const number = Number(value);

        if (!Number.isFinite(number) || number === 0) return 'neutral';

        return number > 0 ? 'positive' : 'negative';
    }

    function slipCard(slip, previewLimit) {
        const selections = ui.selectionsOf(slip);
        const visible = selections.slice(0, previewLimit);
        const hiddenCount = Math.max(0, selections.length - visible.length);
        const type = slip.slipType || ui.slipType(slip.legCount ?? selections.length);
        const card = ui.el('article', 'tip-card home-slip-card');
        const header = ui.el('div', 'tip-card__header');
        const preview = ui.el('div', 'selection-list');
        const details = ui.el('dl', 'tip-card__details tip-card__details--wide');
        const link = ui.el('a', 'view-link', 'View slip');

        header.append(
            ui.el('p', 'tip-card__competition', type.toUpperCase()),
            ui.el('span', `status-pill status-pill--${slip.result}`, ui.formatLabel(slip.result))
        );

        for (const selection of visible) {
            preview.appendChild(selectionSummary(selection));
        }

        if (hiddenCount > 0) {
            preview.appendChild(ui.el('p', 'selection-more', `+ ${hiddenCount} more selection${hiddenCount === 1 ? '' : 's'}`));
        }

        details.append(
            ui.field('Selections', `${selections.length}`),
            ui.field(ui.totalOddsLabel(slip), ui.formatOdds(slip.totalOdds), 'tip-card__odds')
        );

        link.href = `/slips/${encodeURIComponent(slip.id)}`;

        card.append(
            header,
            ui.el('h3', 'tip-card__team', slip.title || `Slip #${slip.id}`),
            preview,
            details,
            link
        );

        return card;
    }

    function resultCard(slip) {
        const type = slip.slipType || ui.slipType(slip.legCount);
        const card = ui.el('article', 'history-card home-result-card');
        const header = ui.el('div', 'tip-card__header');
        const details = ui.el('dl', 'tip-card__details tip-card__details--wide');
        const link = ui.el('a', 'view-link', 'View slip');

        header.append(
            ui.el('p', 'tip-card__competition', type.toUpperCase()),
            ui.el('span', `status-pill status-pill--${slip.result}`, ui.formatLabel(slip.result))
        );

        details.append(
            ui.field('Odds', ui.formatOdds(slip.totalOdds), 'tip-card__odds'),
            ui.field('Profit', slip.profitUnits === null ? ui.placeholder : ui.formatSignedUnits(slip.profitUnits)),
            ui.field('Published', ui.formatDateTime(slip.publishedAt))
        );

        link.href = `/slips/${encodeURIComponent(slip.id)}`;

        card.append(
            header,
            ui.el('h3', 'tip-card__team', slip.title || `Slip #${slip.id}`),
            details,
            link
        );

        return card;
    }

    function selectionSummary(selection) {
        const row = ui.el('div', 'selection-row');
        const main = ui.el('div', 'selection-row__main');

        main.append(
            ui.el('p', 'selection-row__match', ui.predictionLabel(selection)),
            ui.el('p', 'selection-row__pick', `${selection.match.homeTeam} vs ${selection.match.awayTeam}`)
        );
        row.append(main, ui.el('span', 'selection-row__odds', ui.formatOdds(selection.odds)));

        return row;
    }

    loadTodaySlips();
    loadPerformance();
    loadRecentResults();
})();
