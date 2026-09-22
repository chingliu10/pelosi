/**
 * Admin Performance screen.
 *
 * Every figure comes from Pelosi's stored published settled slips:
 *   GET /api/v1/performance?range=<all|7d|30d|90d>          headline metrics (server-computed)
 *   GET /api/v1/performance/history?range=<range>           daily cumulative profit
 *   GET /api/v1/slips?publicationStatus=published&result=settled&sort=settled
 *
 * No TrueOdds request is made anywhere on this screen - performance is
 * historical Pelosi financial data. The browser formats values but never
 * recalculates the metrics.
 */
(() => {
    'use strict';

    const ui = window.PelosiAdminUI;

    const ranges = [
        { key: 'all', label: 'All time' },
        { key: '7d', label: '7 days' },
        { key: '30d', label: '30 days' },
        { key: '90d', label: '90 days' }
    ];
    const recentLimit = 10;
    const placeholder = '—';

    const state = {
        range: 'all',
        summary: null,
        summaryLoading: false,
        summaryError: '',
        history: null,
        historyLoading: false,
        historyError: '',
        recent: null,
        recentLoading: false,
        recentError: '',
        sessionExpired: false
    };

    const els = {
        range: document.getElementById('performance-range'),
        metricsFeedback: document.getElementById('metrics-feedback'),
        metricsEmpty: document.getElementById('metrics-empty'),
        metricCards: document.getElementById('metric-cards'),
        trendFeedback: document.getElementById('trend-feedback'),
        trendEmpty: document.getElementById('trend-empty'),
        trendChart: document.getElementById('trend-chart'),
        trendHint: document.getElementById('trend-hint'),
        recentFeedback: document.getElementById('recent-feedback'),
        recentEmpty: document.getElementById('recent-empty'),
        recentCount: document.getElementById('recent-count'),
        recentList: document.getElementById('recent-list'),
        breakdownPanel: document.getElementById('breakdown-panel')
    };

    /* ---------------- loading ---------------- */

    async function loadAll() {
        state.summaryLoading = true;
        state.historyLoading = true;
        state.recentLoading = true;
        state.summaryError = '';
        state.historyError = '';
        state.recentError = '';
        state.sessionExpired = false;
        render();

        // One request per section per range change - never one per slip.
        await Promise.all([loadSummary(), loadHistory(), loadRecent()]);
    }

    async function loadSummary() {
        await fetchSection(
            `/api/v1/performance?range=${encodeURIComponent(state.range)}`,
            (payload) => { state.summary = payload; },
            (message) => { state.summaryError = message; },
            (loading) => { state.summaryLoading = loading; }
        );
    }

    async function loadHistory() {
        await fetchSection(
            `/api/v1/performance/history?range=${encodeURIComponent(state.range)}`,
            (payload) => { state.history = payload; },
            (message) => { state.historyError = message; },
            (loading) => { state.historyLoading = loading; }
        );
    }

    async function loadRecent() {
        const params = new URLSearchParams({
            publicationStatus: 'published',
            result: 'settled',
            sort: 'settled',
            limit: String(recentLimit)
        });

        await fetchSection(
            `/api/v1/slips?${params.toString()}`,
            (payload) => { state.recent = payload; },
            (message) => { state.recentError = message; },
            (loading) => { state.recentLoading = loading; }
        );
    }

    async function fetchSection(path, onSuccess, onError, setLoading) {
        let response = null;

        try {
            response = await fetch(path, { credentials: 'same-origin' });
            const payload = await ui.readJson(response);

            if (response.status === 401) {
                state.sessionExpired = true;
                throw new Error('Your admin session expired.');
            }

            if (!response.ok) {
                throw new Error(ui.friendlyFailure(response, payload, 'load performance data'));
            }

            if (!payload || typeof payload !== 'object') {
                throw new Error('The performance response could not be read.');
            }

            onSuccess(payload);
        } catch (error) {
            onError(state.sessionExpired ? error.message : (response ? error.message : ui.networkFailure));
        } finally {
            setLoading(false);
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

    function trendTone(value) {
        if (!isNumber(value)) return 'neutral';

        const number = Number(value);

        if (number > 0) return 'positive';
        if (number < 0) return 'negative';

        return 'neutral';
    }

    /* ---------------- rendering ---------------- */

    function render() {
        renderRanges();
        renderMetrics();
        renderBreakdown();
        renderTrend();
        renderRecent();
    }

    function renderRanges() {
        ui.clear(els.range);

        for (const range of ranges) {
            const active = state.range === range.key;
            const button = ui.el('button', `tab${active ? ' is-active' : ''}`, range.label);

            button.type = 'button';
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(active));
            button.disabled = state.summaryLoading && active;
            button.addEventListener('click', () => {
                if (state.range === range.key) return;

                state.range = range.key;
                syncUrl();
                loadAll();
            });

            els.range.appendChild(button);
        }
    }

    function renderMetrics() {
        ui.clear(els.metricCards);
        ui.clear(els.metricsEmpty);
        els.metricsEmpty.hidden = true;

        if (state.sessionExpired) {
            els.metricsFeedback.className = 'feedback';
            ui.clear(els.metricsFeedback);
            els.metricsFeedback.appendChild(ui.sessionExpiredAlert('/admin/performance'));
            return;
        }

        if (state.summaryLoading) {
            ui.setFeedback(els.metricsFeedback, 'Loading performance…', '');
            return;
        }

        if (state.summaryError) {
            ui.setFeedback(els.metricsFeedback, state.summaryError, 'error');
            return;
        }

        ui.setFeedback(els.metricsFeedback, '', '');

        const summary = state.summary;

        if (!summary) return;

        if (summary.totalSlips === 0) {
            els.metricsEmpty.hidden = false;
            els.metricsEmpty.textContent = 'No published settled slips yet.';
        }

        const cards = [
            {
                label: 'Profit',
                value: formatSigned(summary.profitUnits, 'u'),
                tone: trendTone(summary.profitUnits),
                hint: 'Sum of slip profit units'
            },
            {
                label: 'ROI',
                value: isNumber(summary.roiPercentage) ? formatSigned(summary.roiPercentage, '%') : placeholder,
                tone: trendTone(summary.roiPercentage),
                hint: 'Profit ÷ units staked'
            },
            {
                label: 'Win rate',
                value: isNumber(summary.winRatePercentage) ? formatPlain(summary.winRatePercentage, '%') : placeholder,
                tone: 'neutral',
                hint: 'Won ÷ settled slips'
            },
            {
                label: 'Settled slips',
                value: formatPlain(summary.totalSlips, '', 0),
                tone: 'neutral',
                hint: 'Published won/lost slips'
            },
            {
                label: 'Units staked',
                value: formatPlain(summary.unitsStaked, 'u'),
                tone: 'neutral',
                hint: 'Stake across settled slips'
            },
            {
                label: 'Average odds',
                value: formatPlain(summary.averageTotalOdds, '', 2),
                tone: 'neutral',
                hint: 'Mean stored total odds'
            }
        ];

        for (const card of cards) {
            const element = ui.el('div', `metric-card metric-card--${card.tone}`);

            element.append(
                ui.el('p', 'metric-card__label', card.label),
                ui.el('p', 'metric-card__value', card.value),
                ui.el('p', 'metric-card__hint', card.hint)
            );

            els.metricCards.appendChild(element);
        }
    }

    function renderBreakdown() {
        ui.clear(els.breakdownPanel);

        if (state.summaryLoading || state.summaryError || state.sessionExpired || !state.summary) {
            els.breakdownPanel.appendChild(ui.el('p', 'empty', state.summaryError || 'Loading performance…'));
            return;
        }

        const { wins, losses, winRatePercentage, totalSlips } = state.summary;
        const settled = wins + losses;
        const wonShare = settled === 0 ? 0 : (wins / settled) * 100;

        const rows = ui.el('dl', 'preview__rows');

        rows.append(
            ui.previewRow('Won', String(wins)),
            ui.previewRow('Lost', String(losses)),
            ui.previewRow('Settled slips', String(totalSlips)),
            ui.previewRow('Win rate', isNumber(winRatePercentage) ? `${Number(winRatePercentage).toFixed(2)}%` : placeholder)
        );

        const bar = ui.el('div', 'breakdown');
        const won = ui.el('div', 'breakdown__segment breakdown__segment--won');
        const lost = ui.el('div', 'breakdown__segment breakdown__segment--lost');

        won.style.width = `${wonShare}%`;
        lost.style.width = `${100 - wonShare}%`;
        bar.setAttribute(
            'aria-label',
            `Won ${wins} of ${settled} settled slips, lost ${losses}`
        );
        bar.append(won, lost);

        const legend = ui.el('div', 'breakdown__legend');

        legend.append(
            ui.el('span', 'breakdown__legend-item', `Won ${wins}`),
            ui.el('span', 'breakdown__legend-item', `Lost ${losses}`)
        );

        els.breakdownPanel.append(rows, bar, legend);

        if (settled === 0) {
            els.breakdownPanel.appendChild(ui.el('p', 'muted-note', 'No published settled slips yet.'));
        }
    }

    function renderTrend() {
        ui.clear(els.trendChart);
        ui.clear(els.trendEmpty);
        els.trendEmpty.hidden = true;

        if (state.historyError) {
            ui.setFeedback(els.trendFeedback, state.historyError, 'error');
            return;
        }

        if (state.historyLoading) {
            ui.setFeedback(els.trendFeedback, 'Loading trend…', '');
            return;
        }

        ui.setFeedback(els.trendFeedback, '', '');

        const points = state.history?.points ?? [];

        if (points.length < 2) {
            els.trendEmpty.hidden = false;
            els.trendEmpty.textContent = points.length === 0
                ? 'No published settled slips yet.'
                : 'Not enough settled slips for a trend yet.';
            return;
        }

        els.trendChart.appendChild(buildChart(points));
    }

    /**
     * Minimal inline SVG line chart: zero line, cumulative profit series, start
     * and end labels, plus a text description for screen readers.
     */
    function buildChart(points) {
        const width = 720;
        const height = 240;
        const padding = { top: 16, right: 16, bottom: 34, left: 52 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const values = points.map((point) => point.cumulativeProfitUnits);
        const maxValue = Math.max(0, ...values);
        const minValue = Math.min(0, ...values);
        const span = maxValue - minValue || 1;
        const stepX = points.length === 1 ? 0 : plotWidth / (points.length - 1);
        const scaleY = (value) => padding.top + plotHeight - ((value - minValue) / span) * plotHeight;
        const svgNamespace = 'http://www.w3.org/2000/svg';
        const node = (tag, attributes = {}) => {
            const element = document.createElementNS(svgNamespace, tag);

            for (const [name, value] of Object.entries(attributes)) {
                element.setAttribute(name, String(value));
            }

            return element;
        };

        const svg = node('svg', {
            viewBox: `0 0 ${width} ${height}`,
            class: 'chart__svg',
            role: 'img',
            'aria-label': `Cumulative profit from ${points[0].date} to ${points[points.length - 1].date}: ${values[values.length - 1].toFixed(2)} units across ${points.reduce((total, point) => total + point.slips, 0)} settled slips.`
        });

        const zeroY = scaleY(0);

        svg.append(
            node('line', { x1: padding.left, y1: zeroY, x2: width - padding.right, y2: zeroY, class: 'chart__zero' }),
            node('line', { x1: padding.left, y1: padding.top, x2: padding.left, y2: height - padding.bottom, class: 'chart__axis' })
        );

        const valueLabel = (value, y) => node('text', {
            x: padding.left - 8,
            y: y + 4,
            class: 'chart__label chart__label--y',
            'text-anchor': 'end'
        });
        const maxLabel = valueLabel(maxValue, scaleY(maxValue));
        const minLabel = valueLabel(minValue, scaleY(minValue));

        maxLabel.textContent = `${maxValue.toFixed(2)}u`;
        minLabel.textContent = `${minValue.toFixed(2)}u`;
        svg.append(maxLabel, minLabel);

        const coordinates = points.map((point, index) => [
            padding.left + stepX * index,
            scaleY(point.cumulativeProfitUnits)
        ]);

        svg.appendChild(node('polyline', {
            points: coordinates.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' '),
            class: 'chart__line'
        }));

        coordinates.forEach(([x, y], index) => {
            const dot = node('circle', { cx: x, cy: y, r: 3.5, class: 'chart__dot' });
            const title = node('title');

            title.textContent = `${points[index].date}: ${points[index].cumulativeProfitUnits.toFixed(2)}u cumulative (${points[index].slips} slip${points[index].slips === 1 ? '' : 's'})`;
            dot.appendChild(title);
            svg.appendChild(dot);
        });

        const firstLabel = node('text', {
            x: padding.left,
            y: height - 12,
            class: 'chart__label',
            'text-anchor': 'start'
        });
        const lastLabel = node('text', {
            x: width - padding.right,
            y: height - 12,
            class: 'chart__label',
            'text-anchor': 'end'
        });

        firstLabel.textContent = points[0].date;
        lastLabel.textContent = points[points.length - 1].date;
        svg.append(firstLabel, lastLabel);

        const wrapper = ui.el('div', 'chart__wrapper');
        const table = ui.el('ul', 'visually-hidden');

        for (const point of points) {
            table.appendChild(ui.el(
                'li',
                null,
                `${point.date}: ${point.slips} settled slip${point.slips === 1 ? '' : 's'}, profit ${point.profitUnits.toFixed(2)}u, cumulative ${point.cumulativeProfitUnits.toFixed(2)}u`
            ));
        }

        wrapper.append(svg, table);

        return wrapper;
    }

    function renderRecent() {
        ui.clear(els.recentList);
        ui.clear(els.recentEmpty);
        els.recentEmpty.hidden = true;
        els.recentCount.textContent = '';

        if (state.recentError) {
            ui.setFeedback(els.recentFeedback, state.recentError, 'error');
            return;
        }

        if (state.recentLoading) {
            ui.setFeedback(els.recentFeedback, 'Loading results…', '');
            return;
        }

        ui.setFeedback(els.recentFeedback, '', '');

        const slips = state.recent?.slips ?? [];

        if (slips.length === 0) {
            els.recentEmpty.hidden = false;
            els.recentEmpty.textContent = 'No published settled slips yet.';
            return;
        }

        els.recentCount.textContent = `${slips.length} shown`;

        for (const slip of slips) {
            els.recentList.appendChild(recentRow(slip));
        }
    }

    function recentRow(slip) {
        const row = ui.el('li', 'slip-card');
        const body = ui.el('div', 'tip-card__button tip-card__button--static');
        const main = ui.el('div', 'tip-card__main');

        main.append(
            ui.el('p', 'tip-card__title', ui.slipLabel(slip)),
            ui.el('p', 'tip-card__meta', `${slip.legCount} selection${slip.legCount === 1 ? '' : 's'} • settled ${ui.formatDateTime(slip.settledAt)}`)
        );

        const details = ui.el('div', 'tip-card__details');

        details.append(
            ui.field('Odds', ui.formatTotalOdds(slip.totalOdds), 'tabular'),
            ui.field('Stake', `${Number(slip.stakeUnits)}u`),
            ui.field('Return', slip.returnUnits === null ? placeholder : `${Number(slip.returnUnits).toFixed(2)}u`),
            ui.field('Profit', slip.profitUnits === null ? placeholder : ui.formatUnits(slip.profitUnits), 'tabular')
        );

        const side = ui.el('div', 'tip-card__side');

        side.append(
            ui.el('span', `status-pill status-pill--${ui.statusTone(slip.result)}`, ui.formatLabel(slip.result)),
            ui.el('span', 'tip-card__id', `Slip #${slip.id}`)
        );

        body.append(main, details, side);
        row.appendChild(body);

        return row;
    }

    /* ---------------- interactions ---------------- */

    function syncUrl() {
        const query = state.range === 'all' ? '' : `?range=${encodeURIComponent(state.range)}`;

        window.history.replaceState({}, '', `/admin/performance${query}`);
    }

    const initialRange = new URLSearchParams(window.location.search).get('range');

    if (ranges.some((range) => range.key === initialRange)) {
        state.range = initialRange;
    }

    loadAll();
})();
