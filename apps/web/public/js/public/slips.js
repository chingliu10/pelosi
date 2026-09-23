(() => {
    'use strict';

    const root = document.querySelector('[data-page="public-slips"]');
    const slipId = root?.dataset.slipId || '';
    const params = new URLSearchParams(window.location.search);
    const state = {
        date: normalizeDate(params.get('date')) || todayString(),
        result: ['pending', 'won', 'lost', 'void'].includes(params.get('result')) ? params.get('result') : 'all',
        timezone: '',
        detailMode: Boolean(slipId)
    };

    const els = {
        timezone: document.getElementById('slips-timezone'),
        context: document.getElementById('slips-context'),
        prevDate: document.getElementById('slips-prev-date'),
        today: document.getElementById('slips-today'),
        nextDate: document.getElementById('slips-next-date'),
        tabs: [...document.querySelectorAll('[data-result-filter]')],
        summary: document.getElementById('slips-summary'),
        loading: document.getElementById('slips-loading'),
        empty: document.getElementById('slips-empty'),
        error: document.getElementById('slips-error'),
        retry: document.getElementById('slips-retry'),
        grid: document.getElementById('slips-grid'),
        detail: document.getElementById('slip-detail')
    };

    function el(tag, className, text) {
        const node = document.createElement(tag);

        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);

        return node;
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function setHidden(node, hidden) {
        node.classList.toggle('is-hidden', hidden);
    }

    function normalizeDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null;
    }

    function todayString() {
        return new Date().toISOString().slice(0, 10);
    }

    function shiftDate(dateString, days) {
        const date = new Date(`${dateString}T00:00:00.000Z`);

        date.setUTCDate(date.getUTCDate() + days);

        return date.toISOString().slice(0, 10);
    }

    function dateUrl(date, result = state.result) {
        const next = new URLSearchParams();

        next.set('date', date);
        if (result !== 'all') next.set('result', result);

        return `/slips?${next.toString()}`;
    }

    function detailUrl(id) {
        return `/slips/${encodeURIComponent(id)}`;
    }

    function slipType(count) {
        const legCount = Number(count);

        if (legCount === 1) return 'Single';
        if (legCount === 2) return 'Double';
        if (legCount === 3) return 'Treble';

        return `${legCount}-Fold Accumulator`;
    }

    function formatLabel(value) {
        const text = String(value ?? '').replace(/_/g, ' ').trim();

        return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '-';
    }

    function formatOdds(value) {
        const odds = Number(value);

        if (!Number.isFinite(odds)) return '-';

        return odds.toFixed(2).replace(/\.?0+$/, '');
    }

    function formatUnits(value) {
        const units = Number(value);

        if (!Number.isFinite(units)) return '-';

        return `${units.toFixed(2).replace(/\.?0+$/, '')}u`;
    }

    function formatSignedUnits(value) {
        const units = Number(value);

        if (!Number.isFinite(units)) return '-';

        return `${units > 0 ? '+' : ''}${formatUnits(units)}`;
    }

    function formatDateTime(value) {
        if (!value) return '-';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return String(value);

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(date);
    }

    function predictionLabel(selection) {
        const marketCode = String(selection.marketCode || '').toUpperCase();
        const selectionCode = String(selection.selectionCode || '').toUpperCase();
        const line = selection.line === null || selection.line === undefined ? '' : ` ${selection.line}`;
        const match = selection.match || {};

        if (marketCode === 'MATCH_RESULT' || marketCode === '1X2') {
            if (selectionCode === 'HOME') return `${match.homeTeam} to win`;
            if (selectionCode === 'AWAY') return `${match.awayTeam} to win`;
            if (selectionCode === 'DRAW') return 'Draw';
        }

        if (marketCode === 'TOTAL_GOALS') {
            if (selectionCode === 'OVER') return `Over${line} goals`;
            if (selectionCode === 'UNDER') return `Under${line} goals`;
        }

        if (['BTTS', 'BOTH_TEAMS_TO_SCORE', 'GG_NG'].includes(marketCode)) {
            if (selectionCode === 'YES') return 'Both teams to score';
            if (selectionCode === 'NO') return 'Both teams not to score';
        }

        return selection.selectionName || formatLabel(selection.selectionCode);
    }

    function selectionsOf(slip) {
        return Array.isArray(slip.selections) ? slip.selections : (Array.isArray(slip.tips) ? slip.tips : []);
    }

    function totalOddsLabel(slip) {
        return Number(slip.legCount ?? selectionsOf(slip).length) === 1 ? 'Total odds' : 'Combined odds';
    }

    function moneyRows(slip) {
        if (slip.result === 'pending') {
            const potential = Number(slip.stakeUnits) * Number(slip.totalOdds);

            return [
                ['Stake', formatUnits(slip.stakeUnits)],
                ['Potential return', Number.isFinite(potential) ? formatUnits(potential) : '-']
            ];
        }

        return [
            ['Stake', formatUnits(slip.stakeUnits)],
            ['Return', slip.returnUnits === null ? '-' : formatUnits(slip.returnUnits)],
            ['Profit', slip.profitUnits === null ? '-' : formatSignedUnits(slip.profitUnits)]
        ];
    }

    async function readJson(response) {
        const text = await response.text();

        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    function setLoading(message) {
        els.loading.textContent = message;
        els.loading.setAttribute('aria-busy', 'true');
        setHidden(els.loading, false);
        setHidden(els.empty, true);
        setHidden(els.error, true);
        setHidden(els.grid, true);
        setHidden(els.detail, true);
        clear(els.grid);
        clear(els.detail);
    }

    function showError(message) {
        clear(els.summary);
        els.summary.appendChild(el('span', null, 'Slips unavailable'));
        els.error.querySelector('span').textContent = message;
        setHidden(els.error, false);
        setHidden(els.loading, true);
    }

    function syncControls(payload) {
        const date = payload?.date || state.date;
        const result = payload?.result || state.result;

        if (payload?.timezone) {
            state.timezone = payload.timezone;
            els.timezone.textContent = `Publication date uses ${payload.timezone}.`;
        }

        els.prevDate.href = dateUrl(shiftDate(date, -1), result);
        els.today.href = dateUrl(todayString(), result);
        els.nextDate.href = dateUrl(shiftDate(date, 1), result);

        for (const tab of els.tabs) {
            const tabResult = tab.dataset.resultFilter;

            tab.href = dateUrl(date, tabResult);
            tab.classList.toggle('is-active', tabResult === result);
            if (tabResult === result) tab.setAttribute('aria-current', 'page');
            else tab.removeAttribute('aria-current');
        }

        els.context.textContent = `Published on ${date}${result === 'all' ? '' : `, ${result} slips only`}.`;
    }

    async function loadSlips() {
        state.detailMode = false;
        setLoading('Loading slips...');

        const query = new URLSearchParams();

        query.set('date', state.date);
        query.set('limit', '50');
        if (state.result !== 'all') query.set('result', state.result);

        try {
            const listResponse = await fetch(`/api/v1/public/slips?${query.toString()}`, { credentials: 'same-origin' });
            const list = await readJson(listResponse);

            if (!listResponse.ok || !Array.isArray(list?.slips)) {
                throw new Error(list?.error || 'Slips could not be loaded right now.');
            }

            syncControls(list);

            const details = await Promise.all(list.slips.map(async (slip) => {
                const response = await fetch(`/api/v1/public/slips/${encodeURIComponent(slip.id)}`, {
                    credentials: 'same-origin'
                });

                if (!response.ok) return null;

                return readJson(response);
            }));
            const slips = details.filter(Boolean);

            renderSummary(slips);
            renderSlips(slips);

            els.empty.textContent = emptyText(state.result);
            setHidden(els.empty, slips.length > 0);
            setHidden(els.grid, slips.length === 0);
        } catch (error) {
            showError(error.message || 'Slips could not be loaded right now.');
        } finally {
            setHidden(els.loading, true);
        }
    }

    async function loadSlipDetail() {
        state.detailMode = true;
        setLoading('Loading slip...');

        try {
            const response = await fetch(`/api/v1/public/slips/${encodeURIComponent(slipId)}`, {
                credentials: 'same-origin'
            });
            const slip = await readJson(response);

            if (!response.ok) {
                throw new Error(response.status === 404 ? 'Slip not found.' : 'Slip could not be loaded right now.');
            }

            syncControls({ date: state.date, result: state.result });
            renderSummary([slip]);
            renderDetail(slip);
            setHidden(els.detail, false);
        } catch (error) {
            showError(error.message || 'Slip could not be loaded right now.');
        } finally {
            setHidden(els.loading, true);
        }
    }

    function emptyText(result) {
        if (result === 'all') return 'No slips have been published for this date yet.';

        return `No ${result} slips for this date.`;
    }

    function renderSummary(slips) {
        const counts = slips.reduce((memo, slip) => {
            memo[slip.result] = (memo[slip.result] || 0) + 1;
            return memo;
        }, {});

        clear(els.summary);
        els.summary.appendChild(el('span', 'summary-bar__item', `${slips.length} slip${slips.length === 1 ? '' : 's'}`));

        for (const result of ['pending', 'won', 'lost', 'void']) {
            if (counts[result]) {
                els.summary.appendChild(el('span', 'summary-bar__item', `${counts[result]} ${formatLabel(result)}`));
            }
        }
    }

    function renderSlips(slips) {
        clear(els.grid);

        for (const slip of slips) {
            els.grid.appendChild(slipCard(slip));
        }
    }

    function slipCard(slip) {
        const selections = selectionsOf(slip);
        const visibleSelections = selections.slice(0, 3);
        const hiddenCount = Math.max(0, selections.length - visibleSelections.length);
        const type = slip.slipType || slipType(slip.legCount ?? selections.length);
        const card = el('article', 'tip-card slip-card-public');
        const header = el('div', 'tip-card__header');
        const list = el('div', 'selection-list');

        header.append(
            el('p', 'tip-card__competition', type.toUpperCase()),
            el('span', `status-pill status-pill--${slip.result}`, formatLabel(slip.result))
        );

        card.append(
            header,
            el('h2', 'tip-card__team', slip.title || `Slip #${slip.id}`),
            el('p', 'tip-card__meta', `${formatDateTime(slip.publishedAt)} - ${selections.length} selection${selections.length === 1 ? '' : 's'}`)
        );

        for (const selection of visibleSelections) {
            list.appendChild(selectionSummary(selection));
        }

        if (hiddenCount > 0) {
            list.appendChild(el('p', 'selection-more', `+ ${hiddenCount} more selection${hiddenCount === 1 ? '' : 's'}`));
            card.classList.add('slip-card-public--long');
        }

        card.append(list, totalsBlock(slip));

        const link = el('a', 'view-link', 'View slip');

        link.href = detailUrl(slip.id);
        card.appendChild(link);

        return card;
    }

    function selectionSummary(selection) {
        const row = el('div', 'selection-row');
        const main = el('div', 'selection-row__main');

        main.append(
            el('p', 'selection-row__match', `${selection.match.homeTeam} vs ${selection.match.awayTeam}`),
            el('p', 'selection-row__pick', predictionLabel(selection))
        );

        row.append(
            main,
            el('span', `status-pill status-pill--${selection.result}`, formatLabel(selection.result)),
            el('span', 'selection-row__odds', formatOdds(selection.odds))
        );

        return row;
    }

    function totalsBlock(slip) {
        const rows = el('dl', 'tip-card__details tip-card__details--wide');

        rows.appendChild(field(totalOddsLabel(slip), formatOdds(slip.totalOdds), 'tip-card__odds'));

        for (const [label, value] of moneyRows(slip)) {
            rows.appendChild(field(label, value));
        }

        return rows;
    }

    function field(label, value, valueClass) {
        const row = el('div', 'tip-card__detail');

        row.append(
            el('dt', 'tip-card__label', label),
            el('dd', valueClass || 'tip-card__value', value)
        );

        return row;
    }

    function renderDetail(slip) {
        const selections = selectionsOf(slip);
        const type = slip.slipType || slipType(slip.legCount ?? selections.length);
        const title = el('div', 'slip-detail__header');
        const metrics = el('dl', 'slip-detail__metrics');
        const legs = el('div', 'slip-detail__legs');

        clear(els.detail);

        const heading = el('h2', 'slip-detail__title', slip.title || `Slip #${slip.id}`);

        heading.id = 'slip-detail-title';

        title.append(
            el('p', 'tip-card__competition', type),
            heading,
            el('p', 'tip-card__meta', `${formatDateTime(slip.publishedAt)} - ${selections.length} selection${selections.length === 1 ? '' : 's'}`),
            el('span', `status-pill status-pill--${slip.result}`, formatLabel(slip.result))
        );

        metrics.appendChild(field(totalOddsLabel(slip), formatOdds(slip.totalOdds), 'tip-card__odds'));
        for (const [label, value] of moneyRows(slip)) {
            metrics.appendChild(field(label, value));
        }

        legs.appendChild(el('h3', 'slip-detail__section-title', 'Selections'));
        for (const selection of selections) {
            legs.appendChild(selectionDetail(selection));
        }

        els.detail.append(title, metrics, legs);
    }

    function selectionDetail(selection) {
        const article = el('article', 'selection-detail');
        const match = selection.match || {};
        const meta = [
            match.competition || 'Competition unknown',
            formatDateTime(match.startsAt)
        ];

        article.append(
            el('p', 'tip-card__competition', `Selection ${selection.legOrder}`),
            el('h3', 'selection-detail__match', `${match.homeTeam} vs ${match.awayTeam}`),
            el('p', 'tip-card__meta', meta.join(' - '))
        );

        const grid = el('dl', 'selection-detail__grid');

        grid.append(
            field('Prediction', predictionLabel(selection)),
            field('Market', selection.marketName || formatLabel(selection.marketCode)),
            field('Odds', formatOdds(selection.odds), 'tip-card__odds'),
            field('Status', formatLabel(selection.result))
        );

        if (match.homeScore !== null && match.homeScore !== undefined && match.awayScore !== null && match.awayScore !== undefined) {
            grid.appendChild(field('Final score', `${match.homeScore} - ${match.awayScore}`));
        }

        article.appendChild(grid);

        return article;
    }

    els.retry.addEventListener('click', () => {
        if (state.detailMode) loadSlipDetail();
        else loadSlips();
    });

    syncControls({ date: state.date, result: state.result });

    if (state.detailMode) loadSlipDetail();
    else loadSlips();
})();
