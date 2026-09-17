import {
    createTeam,
    findTeamById,
    findTeamBySourceId,
    findTeamBySourceTeamId,
    searchTeamsByName,
    upsertTeam
} from '../repositories/team-repository.js';

function validateTeamData(data) {
    if (!data.sourceId) throw new Error('sourceId is required');
    if (!data.sourceTeamId) throw new Error('sourceTeamId is required');
    if (!data.sportId) throw new Error('sportId is required');
    if (!data.name) throw new Error('name is required');
}

export async function getTeamById(id) {
    return findTeamById(id);
}

export async function getTeamsBySourceId(sourceId) {
    return findTeamBySourceId(sourceId);
}

export async function getTeamBySourceTeamId(sourceId, sourceTeamId) {
    return findTeamBySourceTeamId(sourceId, sourceTeamId);
}

export async function searchTeams(searchTerm) {
    if (!searchTerm) {
        return [];
    }

    return searchTeamsByName(searchTerm);
}

export async function addTeam(data) {
    validateTeamData(data);
    return createTeam(data);
}

export async function saveSourceTeam(data) {
    validateTeamData(data);
    return upsertTeam(data);
}
