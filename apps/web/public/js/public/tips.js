(() => {
    'use strict';

    // Secondary/future selection-level surface. The public /tips route currently
    // redirects to /slips; keep this script aligned with the safe public tips API
    // for later selection history/detail work.
    const page = window.WachimbaTipsPage || {};
    const params = new URLSearchParams(window.location.search);
    const selectedDate = params.get('date') || page.selectedDate;
    const selectedResult = normalizeResult(params.get('result') || 'all');

    const els = {
        dateLabel: document.getElementById('tips-date-label'),
        previous: document.getElementById('previous-day'),
        today: document.getElementById('today-link'),
        next: document.getElementById('next-day'),
        summary: document.getElementById('tips-summary'),
        loading: document.getElementById('tips-loading'),
        empty: document.getElementById('tips-empty'),
        error: document.getElementById('tips-error'),
        retry: document.getElementById('tips-retry'),
        grid: document.getElementById('tips-grid'),
        tabs: [...document.querySelectorAll('[data-result-filter]')]
    };

    function normalizeResult(value) {
        return ['all', 'pending', 'won', 'lost', 'void'].includes(value) ? value : 'all';
    }

    function buildUrl(date, result) {
        const next = new URLSearchParams();

        if (date) next.set('date', date);
        if (result && result !== 'all') next.set('result', result);

        const query = next.toString();

        return query ? `/tips?${query}` : '/tips';
    }

    function addDays(dateString, days) {
        const date = new Date(`${dateString}T00:00:00Z`);

        date.setUTCDate(date.getUTCDate() + days);

        return date.toISOString().slice(0, 10);
    }

    function setHidden(node, hidden) {
        node.classList.toggle('is-hidden', hidden);
    }

    function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);

        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);

        return node;
    }

    function formatDisplayDate(dateString) {
        const date = new Date(`${dateString}T00:00:00Z`);

        if (Number.isNaN(date.getTime())) return dateString;

        return new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC'
        }).format(date);
    }

    function formatTime(value) {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return 'Time TBC';

        return new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function formatOdds(value) {
        const odds = Number(value);

        return Number.isFinite(odds) ? odds.toFixed(2) : '-';
    }

    function titleCase(value) {
        const text = String(value || '').replace(/_/g, ' ').trim();

        return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '-';
    }

    function predictionLabel(tip) {
        const marketCode = String(tip.marketCode || '').toUpperCase();
        const selectionCode = String(tip.selectionCode || '').toUpperCase();
        const line = tip.line === null || tip.line === undefined ? '' : ` ${tip.line}`;

        if (marketCode === 'MATCH_RESULT' || marketCode === '1X2') {
            if (selectionCode === 'HOME') return `${tip.match.homeTeam} to win`;
            if (selectionCode === 'AWAY') return `${tip.match.awayTeam} to win`;
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

        return tip.selectionName || titleCase(tip.selectionCode);
    }

    function scoreLine(match) {
        if (match.homeScore === null || match.awayScore === null) return null;

        return `${match.homeScore} - ${match.awayScore}`;
    }

    function renderChrome() {
        els.dateLabel.dateTime = selectedDate;
        els.dateLabel.textContent = formatDisplayDate(selectedDate);
        els.previous.href = buildUrl(addDays(selectedDate, -1), selectedResult);
        els.next.href = buildUrl(addDays(selectedDate, 1), selectedResult);
        els.today.href = buildUrl(page.selectedDate, selectedResult);

        for (const tab of els.tabs) {
            const result = tab.dataset.resultFilter;

            tab.href = buildUrl(selectedDate, result);
            tab.classList.toggle('is-active', result === selectedResult);
            if (result === selectedResult) {
                tab.setAttribute('aria-current', 'true');
            } else {
                tab.removeAttribute('aria-current');
            }
        }
    }

    function renderSummary(payload) {
        const counts = payload.counts || {};

        clear(els.summary);
        els.summary.append(
            el('span', 'summary-bar__item', `${payload.count} tip${payload.count === 1 ? '' : 's'}`),
            el('span', 'summary-bar__item', `${counts.pending ?? 0} Pending`),
            el('span', 'summary-bar__item', `${counts.won ?? 0} Won`),
            el('span', 'summary-bar__item', `${counts.lost ?? 0} Lost`),
            el('span', 'summary-bar__item', `${counts.void ?? 0} Void`)
        );
    }

    function renderTips(tips) {
        clear(els.grid);

        for (const tip of tips) {
            const card = el('article', 'tip-card');
            const header = el('div', 'tip-card__header');
            const score = scoreLine(tip.match);

            header.append(
                el('p', 'tip-card__competition', tip.match.competition || 'Competition TBC'),
                el('span', `status-pill status-pill--${tip.result}`, titleCase(tip.result))
            );

            const teams = el('div', 'tip-card__teams');
            teams.append(
                el('p', 'tip-card__team', tip.match.homeTeam),
                el('p', 'tip-card__versus', score || 'vs'),
                el('p', 'tip-card__team', tip.match.awayTeam)
            );

            const details = el('dl', 'tip-card__details');
            details.append(
                detail('Kickoff', formatTime(tip.match.startsAt)),
                detail('Prediction', predictionLabel(tip)),
                detail('Market', tip.marketName || titleCase(tip.marketCode)),
                detail('Odds', formatOdds(tip.odds), 'tip-card__odds')
            );

            card.append(header, teams, details);
            els.grid.appendChild(card);
        }
    }

    function detail(label, value, valueClass = '') {
        const row = el('div', 'tip-card__detail');

        row.append(
            el('dt', 'tip-card__label', label),
            el('dd', valueClass || 'tip-card__value', value)
        );

        return row;
    }

    async function loadTips() {
        setHidden(els.loading, false);
        setHidden(els.empty, true);
        setHidden(els.error, true);
        clear(els.grid);

        const query = new URLSearchParams({ date: selectedDate });
        if (selectedResult !== 'all') query.set('result', selectedResult);

        try {
            const response = await fetch(`/api/v1/public/tips?${query.toString()}`, {
                credentials: 'same-origin'
            });
            const payload = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(payload?.error || 'Tips could not be loaded right now.');
            }

            if (!payload || !Array.isArray(payload.tips)) {
                throw new Error('Tips could not be loaded right now.');
            }

            renderSummary(payload);
            renderTips(payload.tips);
            setHidden(els.empty, payload.tips.length > 0);
        } catch {
            clear(els.summary);
            els.summary.appendChild(el('span', null, 'Tips unavailable'));
            setHidden(els.error, false);
        } finally {
            setHidden(els.loading, true);
        }
    }

    els.retry.addEventListener('click', loadTips);
    renderChrome();
    loadTips();
})();
