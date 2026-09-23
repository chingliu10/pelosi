(() => {
    'use strict';

    const ui = window.WachimbaPublicUI;
    const ranges = [
        { key: 'all', label: 'All time' },
        { key: '7d', label: '7 days' },
        { key: '30d', label: '30 days' },
        { key: '90d', label: '90 days' }
    ];
    const params = new URLSearchParams(window.location.search);
    const state = {
        range: ranges.some((range) => range.key === params.get('range')) ? params.get('range') : 'all'
    };

    const els = {
        rangeLinks: [...document.querySelectorAll('[data-range]')],
        loading: document.getElementById('performance-loading'),
        empty: document.getElementById('performance-empty'),
        error: document.getElementById('performance-error'),
        retry: document.getElementById('performance-retry'),
        metrics: document.getElementById('performance-metrics'),
        trendLoading: document.getElementById('trend-loading'),
        trendEmpty: document.getElementById('trend-empty'),
        trendChart: document.getElementById('trend-chart'),
        breakdown: document.getElementById('breakdown-panel'),
        recentLoading: document.getElementById('recent-loading'),
        recentEmpty: document.getElementById('recent-empty'),
        recentResults: document.getElementById('recent-results')
    };

    function syncRanges() {
        for (const link of els.rangeLinks) {
            const active = link.dataset.range === state.range;

            link.classList.toggle('is-active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
    }

    async function loadPerformance() {
        syncRanges();
        ui.setHidden(els.loading, false);
        ui.setHidden(els.error, true);
        ui.setHidden(els.empty, true);
        ui.setHidden(els.trendLoading, false);
        ui.setHidden(els.trendEmpty, true);
        ui.setHidden(els.recentLoading, false);
        ui.setHidden(els.recentEmpty, true);
        ui.clear(els.metrics);
        ui.clear(els.trendChart);
        ui.clear(els.breakdown);
        ui.clear(els.recentResults);

        try {
            const [summary, trend, recent] = await Promise.all([
                fetchJson(`/api/v1/performance?range=${encodeURIComponent(state.range)}`),
                fetchJson(`/api/v1/performance/history?range=${encodeURIComponent(state.range)}`),
                fetchJson('/api/v1/public/slips?scope=history&result=settled&sort=settled&limit=10')
            ]);

            renderMetrics(summary);
            renderBreakdown(summary);
            renderTrend(trend.points || []);
            await renderRecent(recent.slips || []);
        } catch (error) {
            els.error.querySelector('span').textContent = error.message || 'Performance could not be loaded right now.';
            ui.setHidden(els.error, false);
        } finally {
            ui.setHidden(els.loading, true);
            ui.setHidden(els.trendLoading, true);
            ui.setHidden(els.recentLoading, true);
        }
    }

    async function fetchJson(path) {
        const response = await fetch(path, { credentials: 'same-origin' });
        const payload = await ui.readJson(response);

        if (!response.ok || !payload || typeof payload !== 'object') {
            throw new Error(payload?.error || 'Performance could not be loaded right now.');
        }

        return payload;
    }

    function renderMetrics(summary) {
        if (Number(summary.totalSlips) === 0) {
            ui.setHidden(els.empty, false);
        }

        const cards = [
            ['Profit', ui.formatSignedUnits(summary.profitUnits), 'Sum of slip profit units', tone(summary.profitUnits)],
            ['ROI', ui.formatSignedPercent(summary.roiPercentage), 'Profit divided by units staked', tone(summary.roiPercentage)],
            ['Win Rate', ui.formatPercent(summary.winRatePercentage), 'Won slips divided by settled slips', 'neutral'],
            ['Settled Slips', ui.formatDecimal(summary.totalSlips, 0), 'Published won/lost slips', 'neutral'],
            ['Units Staked', ui.formatUnits(summary.unitsStaked), 'Stake across settled slips', 'neutral'],
            ['Average Odds', ui.formatDecimal(summary.averageTotalOdds, 2), 'Mean stored total odds', 'neutral']
        ];

        for (const [label, value, hint, cardTone] of cards) {
            const card = ui.el('article', `metric-card metric-card--${cardTone}`);

            card.append(
                ui.el('p', 'metric-card__label', label),
                ui.el('p', 'metric-card__value', value),
                ui.el('p', 'metric-card__hint', hint)
            );
            els.metrics.appendChild(card);
        }
    }

    function tone(value) {
        const number = Number(value);

        if (!Number.isFinite(number) || number === 0) return 'neutral';

        return number > 0 ? 'positive' : 'negative';
    }

    function renderBreakdown(summary) {
        const wins = Number(summary.wins || 0);
        const losses = Number(summary.losses || 0);
        const settled = wins + losses;
        const wonShare = settled === 0 ? 0 : (wins / settled) * 100;
        const rows = ui.el('dl', 'preview__rows');
        const bar = ui.el('div', 'breakdown');
        const won = ui.el('div', 'breakdown__segment breakdown__segment--won');
        const lost = ui.el('div', 'breakdown__segment breakdown__segment--lost');
        const legend = ui.el('div', 'breakdown__legend');

        rows.append(
            ui.field('Won', String(wins)),
            ui.field('Lost', String(losses)),
            ui.field('Win rate', ui.formatPercent(summary.winRatePercentage))
        );

        won.style.width = `${wonShare}%`;
        lost.style.width = `${100 - wonShare}%`;
        bar.setAttribute('aria-label', `Won ${wins} slips and lost ${losses} slips.`);
        bar.append(won, lost);
        legend.append(
            ui.el('span', 'breakdown__legend-item', `Won ${wins}`),
            ui.el('span', 'breakdown__legend-item', `Lost ${losses}`)
        );

        els.breakdown.append(rows, bar, legend);
    }

    function renderTrend(points) {
        if (points.length < 2) {
            els.trendEmpty.textContent = points.length === 0
                ? 'No published settled slips yet.'
                : 'Not enough settled slips for a trend yet.';
            ui.setHidden(els.trendEmpty, false);
            return;
        }

        els.trendChart.appendChild(buildChart(points));
    }

    function buildChart(points) {
        const width = 720;
        const height = 240;
        const padding = { top: 16, right: 16, bottom: 34, left: 52 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const values = points.map((point) => Number(point.cumulativeProfitUnits));
        const maxValue = Math.max(0, ...values);
        const minValue = Math.min(0, ...values);
        const span = maxValue - minValue || 1;
        const stepX = plotWidth / (points.length - 1);
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
            'aria-label': `Cumulative profit from ${points[0].date} to ${points[points.length - 1].date}: ${values.at(-1).toFixed(2)} units.`
        });
        const zeroY = scaleY(0);

        svg.append(
            node('line', { x1: padding.left, y1: zeroY, x2: width - padding.right, y2: zeroY, class: 'chart__zero' }),
            node('polyline', {
                points: points.map((point, index) => `${(padding.left + stepX * index).toFixed(2)},${scaleY(point.cumulativeProfitUnits).toFixed(2)}`).join(' '),
                class: 'chart__line'
            })
        );

        points.forEach((point, index) => {
            const dot = node('circle', {
                cx: padding.left + stepX * index,
                cy: scaleY(point.cumulativeProfitUnits),
                r: 3.5,
                class: 'chart__dot'
            });
            const title = node('title');

            title.textContent = `${point.date}: ${Number(point.cumulativeProfitUnits).toFixed(2)}u cumulative`;
            dot.appendChild(title);
            svg.appendChild(dot);
        });

        const firstLabel = node('text', { x: padding.left, y: height - 12, class: 'chart__label', 'text-anchor': 'start' });
        const lastLabel = node('text', { x: width - padding.right, y: height - 12, class: 'chart__label', 'text-anchor': 'end' });

        firstLabel.textContent = points[0].date;
        lastLabel.textContent = points.at(-1).date;
        svg.append(firstLabel, lastLabel);

        const wrapper = ui.el('div', 'chart__wrapper');
        const text = ui.el('ul', 'sr-only');

        for (const point of points) {
            text.appendChild(ui.el('li', null, `${point.date}: ${point.slips} settled slips, profit ${Number(point.profitUnits).toFixed(2)}u, cumulative ${Number(point.cumulativeProfitUnits).toFixed(2)}u.`));
        }

        wrapper.append(svg, text);

        return wrapper;
    }

    async function renderRecent(rows) {
        if (rows.length === 0) {
            ui.setHidden(els.recentEmpty, false);
            return;
        }

        const details = await Promise.all(rows.map(async (slip) => {
            const response = await fetch(`/api/v1/public/slips/${encodeURIComponent(slip.id)}`, { credentials: 'same-origin' });

            return response.ok ? ui.readJson(response) : null;
        }));

        for (const slip of details.filter(Boolean)) {
            els.recentResults.appendChild(historyCard(slip, 0));
        }
    }

    function historyCard(slip, previewCount) {
        const card = ui.el('article', 'history-card');
        const header = ui.el('div', 'tip-card__header');
        const body = ui.el('dl', 'tip-card__details tip-card__details--wide');
        const type = slip.slipType || ui.slipType(slip.legCount);
        const link = ui.el('a', 'view-link', 'View slip');

        header.append(
            ui.el('p', 'tip-card__competition', type.toUpperCase()),
            ui.el('span', `status-pill status-pill--${slip.result}`, ui.formatLabel(slip.result))
        );
        body.append(
            ui.field('Selections', `${slip.legCount}`),
            ui.field(ui.totalOddsLabel(slip), ui.formatOdds(slip.totalOdds), 'tip-card__odds'),
            ui.field('Stake', ui.formatUnits(slip.stakeUnits)),
            ui.field('Return', ui.formatUnits(slip.returnUnits)),
            ui.field('Profit', ui.formatSignedUnits(slip.profitUnits)),
            ui.field('Settled', ui.formatDateTime(slip.settledAt))
        );
        link.href = `/slips/${encodeURIComponent(slip.id)}`;

        card.append(
            header,
            ui.el('h3', 'tip-card__team', slip.title || `Slip #${slip.id}`),
            ui.el('p', 'tip-card__meta', `${slip.legCount} selection${slip.legCount === 1 ? '' : 's'}`),
            body,
            link
        );

        if (previewCount > 0) {
            card.appendChild(ui.el('p', 'selection-more', `${previewCount} selections hidden`));
        }

        return card;
    }

    els.retry.addEventListener('click', loadPerformance);
    loadPerformance();
})();
