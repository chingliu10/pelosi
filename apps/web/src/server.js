import 'dotenv/config';
import app from './app.js';
import pool from './db/postgres.js';

const PORT = process.env.PORT || 3000;

try {
    const result = await pool.query('SELECT NOW()');

    console.log(
        'PostgreSQL connected:',
        result.rows[0].now
    );
} catch (error) {
    console.error('PostgreSQL connection failed:', error.message);
    process.exit(1);
}

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
