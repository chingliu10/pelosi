import {
    findSportByCode,
    findSportById
} from '../repositories/sport-repository.js';

export async function getSportById(id) {
    return findSportById(id);
}

export async function getSportByCode(code) {
    if (!code) {
        throw new Error('Sport code is required');
    }

    return findSportByCode(code);
}
