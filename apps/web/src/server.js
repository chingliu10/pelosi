import express from 'express';
import 'dotenv/config';
import pool from './db/postgres.js';
import { getSlip } from './controllers/slip-controller.js';
import settlementRoutes from './routes/api/settlement-routes.js';
import slipRoutes from './routes/api/slip-routes.js';
import {
    getTrueOddsMatch,
    getTrueOddsMarkets,
    getTrueOddsResultById,
    getTrueOddsResults,
    importTrueOddsTip,
    searchTrueOddsMatches
} from './controllers/trueodds-controller.js';

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send('Pelosi server is running');
});

app.get('/test/slip/:id', getSlip);
app.use('/api/v1/slips', slipRoutes);
app.use('/api/v1/settlement', settlementRoutes);
app.get('/api/trueodds/matches/search', searchTrueOddsMatches);
app.get('/api/trueodds/matches/:trueOddsId/markets', getTrueOddsMarkets);
app.get('/api/trueodds/matches/:matchId', getTrueOddsMatch);
app.get('/api/trueodds/results', getTrueOddsResults);
app.get('/api/trueodds/results/:trueOddsId', getTrueOddsResultById);
app.post('/api/trueodds/tips/import', importTrueOddsTip);

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
