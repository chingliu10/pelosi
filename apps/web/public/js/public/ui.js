window.WachimbaPublicUI = (() => {
    'use strict';

    const placeholder = '-';

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

    function slipType(count) {
        const legCount = Number(count);

        if (legCount === 1) return 'Single';
        if (legCount === 2) return 'Double';
        if (legCount === 3) return 'Treble';

        return `${legCount}-Fold Accumulator`;
    }

    function formatLabel(value) {
        const text = String(value ?? '').replace(/_/g, ' ').trim();

        return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : placeholder;
    }

    function formatOdds(value) {
        const odds = Number(value);

        if (!Number.isFinite(odds)) return placeholder;

        return odds.toFixed(2).replace(/\.?0+$/, '');
    }

    function formatDecimal(value, decimals = 2) {
        const number = Number(value);

        if (!Number.isFinite(number)) return placeholder;

        return number.toFixed(decimals);
    }

    function formatUnits(value) {
        const units = Number(value);

        if (!Number.isFinite(units)) return placeholder;

        return `${units.toFixed(2)}u`;
    }

    function formatSignedUnits(value) {
        const units = Number(value);

        if (!Number.isFinite(units)) return placeholder;

        return `${units > 0 ? '+' : ''}${units.toFixed(2)}u`;
    }

    function formatSignedPercent(value) {
        const number = Number(value);

        if (!Number.isFinite(number)) return placeholder;

        return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
    }

    function formatPercent(value) {
        const number = Number(value);

        if (!Number.isFinite(number)) return placeholder;

        return `${number.toFixed(2)}%`;
    }

    function formatDateTime(value, timezone) {
        if (!value) return placeholder;

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return String(value);

        const options = {
            dateStyle: 'medium',
            timeStyle: 'short'
        };

        if (timezone) options.timeZone = timezone;

        return new Intl.DateTimeFormat(undefined, options).format(date);
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

    async function readJson(response) {
        const text = await response.text();

        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }

    function field(label, value, valueClass) {
        const row = el('div', 'tip-card__detail');

        row.append(
            el('dt', 'tip-card__label', label),
            el('dd', valueClass || 'tip-card__value', value)
        );

        return row;
    }

    function moneyRows(slip) {
        if (slip.result === 'pending') {
            const potential = Number(slip.stakeUnits) * Number(slip.totalOdds);

            return [
                ['Stake', formatUnits(slip.stakeUnits)],
                ['Potential return', Number.isFinite(potential) ? formatUnits(potential) : placeholder]
            ];
        }

        return [
            ['Stake', formatUnits(slip.stakeUnits)],
            ['Return', slip.returnUnits === null ? placeholder : formatUnits(slip.returnUnits)],
            ['Profit', slip.profitUnits === null ? placeholder : formatSignedUnits(slip.profitUnits)]
        ];
    }

    return {
        placeholder,
        el,
        clear,
        setHidden,
        slipType,
        formatLabel,
        formatOdds,
        formatDecimal,
        formatUnits,
        formatSignedUnits,
        formatSignedPercent,
        formatPercent,
        formatDateTime,
        predictionLabel,
        selectionsOf,
        totalOddsLabel,
        readJson,
        field,
        moneyRows
    };
})();
