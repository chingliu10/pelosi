import express from 'express';
import 'dotenv/config';
import pool from './db/postgres.js';
import { getSlip } from './controllers/slip-controller.js';

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send('Pelosi server is running');
});

app.get('/test/slip/:id', getSlip);

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
