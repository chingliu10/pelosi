import 'dotenv/config';
import express from 'express';
import { createSessionMiddleware } from './config/session.js';
import {
    getTrueOddsMatch,
    getTrueOddsMarkets,
    getTrueOddsResultById,
    getTrueOddsResults,
    importTrueOddsTip,
    searchTrueOddsMatches
} from './controllers/trueodds-controller.js';
import { requireAuth } from './middleware/require-auth.js';
import authRoutes from './routes/api/auth-routes.js';
import performanceRoutes from './routes/api/performance-routes.js';
import settlementRoutes from './routes/api/settlement-routes.js';
import slipRoutes from './routes/api/slip-routes.js';

const app = express();

if (process.env.NODE_ENV === 'production') {
    // Required for secure cookies to be sent when running behind a proxy.
    app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createSessionMiddleware());

app.get('/', (req, res) => {
    res.send('Pelosi server is running');
});

// Admin sessions (browser -> Pelosi). Separate from the TrueOdds API key,
// which is only ever used server-side (Pelosi -> TrueOdds).
app.use('/api/v1/auth', authRoutes);

// Slip reads are public; slip writes require an admin session.
app.use('/api/v1/slips', slipRoutes);

// Public performance/history reads.
app.use('/api/v1/performance', performanceRoutes);

// Settlement is admin-only.
app.use('/api/v1/settlement', settlementRoutes);

// Read-only TrueOdds proxies stay open; tip import is an admin write.
app.get('/api/trueodds/matches/search', searchTrueOddsMatches);
app.get('/api/trueodds/matches/:trueOddsId/markets', getTrueOddsMarkets);
app.get('/api/trueodds/matches/:matchId', getTrueOddsMatch);
app.get('/api/trueodds/results', getTrueOddsResults);
app.get('/api/trueodds/results/:trueOddsId', getTrueOddsResultById);
app.post('/api/trueodds/tips/import', requireAuth, importTrueOddsTip);

export default app;
