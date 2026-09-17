import {
    createMatch,
    findMatchById,
    findMatchBySourceMatchId,
    searchMatches,
    updateMatchScoreAndStatus,
    upsertMatch
} from '../repositories/match-repository.js';

const allowedMatchStatuses = new Set([
    'scheduled',
    'live',
    'finished',
    'postponed',
    'cancelled'
]);

function validateMatchData(data) {
    if (!data.sourceId) throw new Error('sourceId is required');
    if (!data.sourceMatchId) throw new Error('sourceMatchId is required');
    if (!data.sportId) throw new Error('sportId is required');
    if (!data.homeTeamId) throw new Error('homeTeamId is required');
    if (!data.awayTeamId) throw new Error('awayTeamId is required');
    if (!data.startsAt) throw new Error('startsAt is required');
    if (data.homeTeamId === data.awayTeamId) {
        throw new Error('homeTeamId and awayTeamId must be different');
    }
    if (data.status && !allowedMatchStatuses.has(data.status)) {
        throw new Error('Invalid match status');
    }
}

export async function getMatchById(id) {
    return findMatchById(id);
}

export async function getMatchBySourceMatchId(sourceId, sourceMatchId) {
    return findMatchBySourceMatchId(sourceId, sourceMatchId);
}

export async function addMatch(data) {
    validateMatchData(data);
    return createMatch(data);
}

export async function saveSourceMatch(data) {
    validateMatchData(data);
    return upsertMatch(data);
}

export async function updateMatchResult(id, data) {
    if (!allowedMatchStatuses.has(data.status)) {
        throw new Error('Invalid match status');
    }
    if (data.homeScore !== null && data.homeScore !== undefined && data.homeScore < 0) {
        throw new Error('homeScore must be zero or greater');
    }
    if (data.awayScore !== null && data.awayScore !== undefined && data.awayScore < 0) {
        throw new Error('awayScore must be zero or greater');
    }

    return updateMatchScoreAndStatus(id, data);
}

export async function searchMatchList(searchTerm) {
    if (!searchTerm) {
        return [];
    }

    return searchMatches(searchTerm);
}
