/**
 * Builds an `ILIKE` pattern for parameterized search filters.
 *
 * `%` and `_` from user input are escaped so they stay literal; the SQL using
 * this pattern must specify `ESCAPE '\'`.
 */
export function toLikePattern(search) {
    if (search === undefined || search === null || String(search).trim() === '') {
        return null;
    }

    const escaped = String(search).trim().replace(/[\\%_]/g, (character) => `\\${character}`);

    return `%${escaped}%`;
}
