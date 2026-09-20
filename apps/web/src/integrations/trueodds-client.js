const defaultTimeoutMs = 15000;

function getTrueOddsApiBaseUrl() {
    const configuredUrl = process.env.TRUEODDS_BASE_URL;

    if (!configuredUrl) {
        throw new Error('TRUEODDS_BASE_URL is required');
    }

    return configuredUrl.replace(/\/+$/, '');
}

function getTrueOddsLegacyApiBaseUrl() {
    const url = new URL(getTrueOddsApiBaseUrl());
    const normalizedPath = url.pathname.replace(/\/+$/, '');

    if (normalizedPath === '/api/v1') {
        url.pathname = '/api';
    }

    return url.toString().replace(/\/+$/, '');
}

async function requestTrueOdds(baseUrl, path, query = {}) {
    const apiKey = process.env.TRUEODDSAPIKEY;

    if (!apiKey) {
        throw new Error('TRUEODDSAPIKEY is required');
    }

    const url = new URL(baseUrl + path);

    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, value);
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), defaultTimeoutMs);

    try {
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json'
            },
            signal: controller.signal
        });

        const text = await response.text();
        let data = null;

        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = { raw: text };
            }
        }

        if (!response.ok) {
            const message = data?.error?.message || data?.error || `TrueOdds request failed with status ${response.status}`;
            const error = new Error(message);
            error.status = response.status;
            error.response = data;
            throw error;
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
}

export async function searchTrueOddsMatches(query) {
    return requestTrueOdds(getTrueOddsApiBaseUrl(), '/matches/search', query);
}

export async function searchTrueOddsLegacyMatches(query) {
    return requestTrueOdds(getTrueOddsLegacyApiBaseUrl(), '/matches', query);
}

export async function getTrueOddsMatchMarkets(matchId) {
    return requestTrueOdds(getTrueOddsApiBaseUrl(), `/matches/${encodeURIComponent(matchId)}/markets`);
}

export async function getTrueOddsMatch(matchId) {
    return requestTrueOdds(getTrueOddsApiBaseUrl(), `/matches/${encodeURIComponent(matchId)}`);
}

export async function getTrueOddsLegacyMatchMarkets(trueOddsId) {
    return requestTrueOdds(getTrueOddsLegacyApiBaseUrl(), `/matches/${encodeURIComponent(trueOddsId)}/markets`);
}

export async function getTrueOddsResults(query) {
    return requestTrueOdds(getTrueOddsLegacyApiBaseUrl(), '/results', query);
}

export async function resolveTrueOddsSelection(matchId, marketId, selectionId) {
    return requestTrueOdds(
        getTrueOddsApiBaseUrl(),
        `/matches/${encodeURIComponent(matchId)}/markets/${encodeURIComponent(marketId)}/selections/${encodeURIComponent(selectionId)}`
    );
}
