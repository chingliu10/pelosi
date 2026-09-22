const { default: pool } = await import('../apps/web/src/db/postgres.js');

const users = await pool.query('SELECT id, email FROM users ORDER BY id');
const isTestAccount = (email) => /@example\.test$/i.test(email);
const doomed = users.rows.filter((user) => isTestAccount(user.email));

console.log('users before:', JSON.stringify(users.rows));
console.log('test accounts to remove:', JSON.stringify(doomed.map((user) => user.email)));

for (const user of doomed) {
    await pool.query(`DELETE FROM session WHERE sess -> 'user' ->> 'id' = $1`, [String(user.id)]);
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
}

// Remove any session rows whose user id no longer exists.
const orphanSessions = await pool.query(`
    DELETE FROM session
    WHERE sess -> 'user' ->> 'id' IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM users u WHERE u.id::text = sess -> 'user' ->> 'id'
      )
    RETURNING sid
`);

console.log('removed orphan sessions:', orphanSessions.rowCount);

const counts = await pool.query(`
    SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM session) AS sessions,
        (SELECT COUNT(*)::int FROM tips) AS tips,
        (SELECT COUNT(*)::int FROM slips) AS slips,
        (SELECT COUNT(*)::int FROM matches) AS matches
`);

console.log('final counts:', JSON.stringify(counts.rows[0]));

await pool.end();
