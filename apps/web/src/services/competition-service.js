import {
    createCompetition,
    findCompetitionById,
    findCompetitionBySourceCompetitionId,
    searchCompetitions,
    upsertCompetition
} from '../repositories/competition-repository.js';

function validateCompetitionData(data) {
    if (!data.sourceId) throw new Error('sourceId is required');
    if (!data.sourceCompetitionId) throw new Error('sourceCompetitionId is required');
    if (!data.sportId) throw new Error('sportId is required');
    if (!data.name) throw new Error('name is required');
}

export async function getCompetitionById(id) {
    return findCompetitionById(id);
}

export async function getCompetitionBySourceCompetitionId(sourceId, sourceCompetitionId) {
    return findCompetitionBySourceCompetitionId(sourceId, sourceCompetitionId);
}

export async function searchCompetition(searchTerm) {
    if (!searchTerm) {
        return [];
    }

    return searchCompetitions(searchTerm);
}

export async function addCompetition(data) {
    validateCompetitionData(data);
    return createCompetition(data);
}

export async function saveSourceCompetition(data) {
    validateCompetitionData(data);
    return upsertCompetition(data);
}
