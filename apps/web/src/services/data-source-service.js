import {
    findDataSourceByCode,
    findDataSourceById
} from '../repositories/data-source-repository.js';

export async function getDataSourceById(id) {
    return findDataSourceById(id);
}

export async function getDataSourceByCode(code) {
    if (!code) {
        throw new Error('Data source code is required');
    }

    return findDataSourceByCode(code);
}
