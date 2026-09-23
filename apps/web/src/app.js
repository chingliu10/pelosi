import 'dotenv/config';
import express from 'express';
import { engine } from 'express-handlebars';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import adminRoutes from './routes/admin/admin-routes.js';
import dashboardRoutes from './routes/api/admin/dashboard-routes.js';
import slipBuilderRoutes from './routes/api/admin/slip-builder-routes.js';
import authRoutes from './routes/api/auth-routes.js';
import performanceRoutes from './routes/api/performance-routes.js';
import publicRoutes from './routes/public/public-routes.js';
import publicSlipRoutes from './routes/api/public-slip-routes.js';
import publicTipRoutes from './routes/api/public-tip-routes.js';
import settlementRoutes from './routes/api/settlement-routes.js';
import slipRoutes from './routes/api/slip-routes.js';
import tipsRoutes from './routes/api/tips-routes.js';

const app = express();

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: false,
    layoutsDir: path.join(webRoot, 'views', 'layouts'),
    partialsDir: path.join(webRoot, 'views', 'partials')
}));
app.set('view engine', 'hbs');
app.set('views', path.join(webRoot, 'views'));

if (process.env.NODE_ENV === 'production') {
    // Required for secure cookies to be sent when running behind a proxy.
    app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createSessionMiddleware());
app.use(express.static(path.join(webRoot, 'public')));

// Customer-facing pages.
app.use('/', publicRoutes);

// Server-rendered admin screens (session protected, no TrueOdds calls here).
app.use('/admin', adminRoutes);

// Admin sessions (browser -> Pelosi). Separate from the TrueOdds API key,
// which is only ever used server-side (Pelosi -> TrueOdds).
app.use('/api/v1/auth', authRoutes);

// Slip management is admin-only (reads and writes).
app.use('/api/v1/slips', slipRoutes);

// Public follower API: published slips only.
app.use('/api/v1/public/slips', publicSlipRoutes);

// Public visitor API: tips visible through currently published slips only.
app.use('/api/v1/public/tips', publicTipRoutes);

// Public performance/history reads.
app.use('/api/v1/performance', performanceRoutes);

// Admin tips read API (Tips Manager + future slip builder).
app.use('/api/v1/tips', tipsRoutes);

// Admin dashboard overview (aggregates existing services, read-only).
app.use('/api/v1/admin/dashboard', dashboardRoutes);

// Admin temporary slip builder (server-side session backed).
app.use('/api/v1/admin/slip-builder', slipBuilderRoutes);

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
