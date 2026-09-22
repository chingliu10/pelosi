import test from 'node:test';
import assert from 'node:assert/strict';

import pool from '../src/db/postgres.js';
import {
    hideSlip,
    listSlips,
    publishSlip
} from '../src/repositories/slip-repository.js';
import { getPublishedSlipPerformance } from '../src/repositories/performance-repository.js';
import { getSlipById, getSlips } from '../src/services/slip-service.js';

/**
 * These tests run against the real Pelosi PostgreSQL schema inside a single
 * transaction that is rolled back at the end, so no test row is persisted.
 *
 * If PostgreSQL is not reachable the suite skips instead of failing.
 */
const testTitlePrefix = '[test] slip publication';

let client = null;

pool.on('error', () => {
    // Ignore idle-client errors so an unavailable database skips instead of
    // crashing the test process.
});

test.before(async () => {
    try {
        client = await pool.connect();
        await client.query('BEGIN');
    } catch {
        client = null;
    }
});

test.after(async () => {
    if (client) {
        await client.query('ROLLBACK');
        client.release();
    }

    await pool.end();
});

function requireClient(t) {
    if (!client) {
        t.skip('PostgreSQL is not available');
        return null;
    }

    return client;
}

async function insertSlip(db, overrides = {}) {
    const slip = {
        title: `${testTitlePrefix} fixture`,
        slipDate: '2026-01-01',
        totalOdds: 3,
        stakeUnits: 1,
        result: 'pending',
        returnUnits: null,
        profitUnits: null,
        publicationStatus: 'draft',
        publishedAt: null,
        settledAt: null,
        ...overrides
    };

    const result = await db.query(
        `
        INSERT INTO slips (
            title,
            slip_date,
            total_odds,
            stake_units,
            result,
            return_units,
            profit_units,
            publication_status,
            published_at,
            settled_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
        `,
        [
            slip.title,
            slip.slipDate,
            slip.totalOdds,
            slip.stakeUnits,
            slip.result,
            slip.returnUnits,
            slip.profitUnits,
            slip.publicationStatus,
            slip.publishedAt,
            slip.settledAt
        ]
    );

    return Number(result.rows[0].id);
}

async function readSlip(db, id) {
    const result = await db.query(
        `
        SELECT id, result, publication_status, published_at, return_units, profit_units, total_odds
        FROM slips
        WHERE id = $1
        `,
        [id]
    );

    return result.rows[0];
}

test('publish draft slip sets published status and published_at', async (t) => {
    const db = requireClient(t);
    if (!db) return;

    const slipId = await insertSlip(db);
    const draft = await readSlip(db, slipId);

    assert.equal(draft.publication_status, 'draft');
    assert.equal(draft.published_at, null);

    const published = await publishSlip(slipId, db);

    assert.equal(published.publication_status, 'published');
    assert.notEqual(published.published_at, null);
    assert.equal(published.result, 'pending');
    assert.equal(published.return_units, null);
    assert.equal(published.profit_units, null);
});

test('publishing an already published slip is idempotent', async (t) => {
    const db = requireClient(t);
    if (!db) return;

    const slipId = await insertSlip(db);
    const first = await publishSlip(slipId, db);
    const firstPublishedAt = await readSlip(db, slipId);

    const second = await publishSlip(slipId, db);
    const secondPublishedAt = await readSlip(db, slipId);

    assert.equal(second.publication_status, 'published');
    assert.equal(
        new Date(secondPublishedAt.published_at).toISOString(),
        new Date(firstPublishedAt.published_at).toISOString()
    );
    assert.equal(
        new Date(second.published_at).getTime(),
        new Date(first.published_at).getTime()
    );
});

test('hiding a published slip keeps published_at and money fields', async (t) => {
    const db = requireClient(t);
    if (!db) return;

    const slipId = await insertSlip(db, {
        result: 'won',
        totalOdds: 4,
        returnUnits: 4,
        profitUnits: 3,
        settledAt: '2026-01-03T12:00:00Z'
    });
    const published = await publishSlip(slipId, db);
    const publishedAt = published.published_at;

    const hidden = await hideSlip(slipId, db);
    const stored = await readSlip(db, slipId);

    assert.equal(hidden.publication_status, 'hidden');
    assert.equal(stored.publication_status, 'hidden');
    assert.equal(new Date(stored.published_at).toISOString(), new Date(publishedAt).toISOString());
    assert.equal(stored.result, 'won');
    assert.equal(Number(stored.return_units), 4);
    assert.equal(Number(stored.profit_units), 3);

    const legs = await db.query('SELECT COUNT(*) AS leg_count FROM slip_tips WHERE slip_id = $1', [slipId]);

    assert.equal(Number(legs.rows[0].leg_count), 0);
});

test('republishing a hidden slip preserves the original published_at', async (t) => {
    const db = requireClient(t);
    if (!db) return;

    const slipId = await insertSlip(db);
    const published = await publishSlip(slipId, db);
    await hideSlip(slipId, db);

    const republished = await publishSlip(slipId, db);
    const stored = await readSlip(db, slipId);

    assert.equal(republished.publication_status, 'published');
    assert.equal(
        new Date(stored.published_at).toISOString(),
        new Date(published.published_at).toISOString()
    );
});

test('slip listing supports publicationStatus/result filters and leg counts', async (t) => {
    const db = requireClient(t);
    if (!db) return;

    const publishedId = await insertSlip(db, { publicationStatus: 'published', title: `${testTitlePrefix} published` });
    const draftId = await insertSlip(db, { title: `${testTitlePrefix} draft` });
    const hiddenId = await insertSlip(db, { publicationStatus: 'hidden', title: `${testTitlePrefix} hidden` });
    const lostId = await insertSlip(db, {
        publicationStatus: 'published',
        result: 'lost',
        stakeUnits: 1,
        totalOdds: 2.5,
        returnUnits: 0,
        profitUnits: -1,
        settledAt: '2026-01-04T12:00:00Z'
    });

    await db.query('INSERT INTO slip_tips (slip_id, tip_id, leg_order) VALUES ($1, 1, 1)', [publishedId]);

    const publishedRows = await listSlips({ publicationStatus: 'published', limit: 100 }, db);
    const publishedIds = publishedRows.map((row) => Number(row.id));

    assert.ok(publishedIds.includes(publishedId));
    assert.ok(publishedIds.includes(lostId));
    assert.ok(!publishedIds.includes(draftId));
    assert.ok(!publishedIds.includes(hiddenId));
    assert.ok(publishedRows.every((row) => row.publication_status === 'published'));

    const hiddenRows = await listSlips({ publicationStatus: 'hidden', limit: 100 }, db);

    assert.ok(hiddenRows.map((row) => Number(row.id)).includes(hiddenId));

    const lostRows = await listSlips({ result: 'lost', limit: 100 }, db);
    const lostRow = lostRows.find((row) => Number(row.id) === lostId);

    assert.ok(lostRow);
    assert.ok(lostRows.every((row) => row.result === 'lost'));

    const publishedRow = publishedRows.find((row) => Number(row.id) === publishedId);

    assert.equal(Number(publishedRow.leg_count), 1);
});

test('performance counts only published settled slips', async (t) => {
    const db = requireClient(t);
    if (!db) return;

    const before = await getPublishedSlipPerformance(null, db);

    await insertSlip(db, {
        title: `${testTitlePrefix} draft winner`,
        result: 'won',
        totalOdds: 9,
        returnUnits: 9,
        profitUnits: 8,
        settledAt: '2026-01-05T12:00:00Z'
    });
    await insertSlip(db, {
        title: `${testTitlePrefix} hidden winner`,
        publicationStatus: 'hidden',
        result: 'won',
        totalOdds: 8,
        returnUnits: 8,
        profitUnits: 7,
        settledAt: '2026-01-05T12:00:00Z'
    });
    await insertSlip(db, {
        title: `${testTitlePrefix} published pending`,
        publicationStatus: 'published',
        result: 'pending'
    });
    await insertSlip(db, {
        title: `${testTitlePrefix} published void`,
        publicationStatus: 'published',
        result: 'void',
        totalOdds: 3,
        stakeUnits: 1,
        returnUnits: 1,
        profitUnits: 0,
        settledAt: '2026-01-05T12:00:00Z'
    });
    await insertSlip(db, {
        title: `${testTitlePrefix} published winner`,
        publicationStatus: 'published',
        result: 'won',
        totalOdds: 4,
        stakeUnits: 1,
        returnUnits: 4,
        profitUnits: 3,
        settledAt: '2026-01-05T12:00:00Z'
    });
    await insertSlip(db, {
        title: `${testTitlePrefix} published loser`,
        publicationStatus: 'published',
        result: 'lost',
        totalOdds: 2.5,
        stakeUnits: 2,
        returnUnits: 0,
        profitUnits: -2,
        settledAt: '2026-01-05T12:00:00Z'
    });

    const after = await getPublishedSlipPerformance(null, db);
    const delta = (field) => Number(after[field]) - Number(before[field]);

    assert.equal(delta('total_slips'), 2, 'only the published won/lost slips are counted');
    assert.equal(delta('wins'), 1);
    assert.equal(delta('losses'), 1);
    assert.equal(delta('units_staked'), 3);
    assert.equal(delta('total_return_units'), 4);
    assert.equal(delta('profit_units'), 1);

    const profitUnits = Number(after.profit_units);
    const unitsStaked = Number(after.units_staked);
    const totalSlips = Number(after.total_slips);
    const wins = Number(after.wins);

    assert.ok(Math.abs(Number(after.roi_percentage) - (profitUnits / unitsStaked) * 100) < 0.01);
    assert.ok(Math.abs(Number(after.win_rate_percentage) - (wins / totalSlips) * 100) < 0.01);
    assert.ok(Number(after.average_total_odds) > 1);
});

test('invalid slip filters and slip ids are rejected without touching the database', async () => {
    await assert.rejects(() => getSlips({ publicationStatus: 'nope' }), (error) => error.status === 400);
    await assert.rejects(() => getSlips({ result: 'maybe' }), (error) => error.status === 400);
    await assert.rejects(() => getSlips({ creationType: 'robot' }), (error) => error.status === 400);
    await assert.rejects(() => getSlips({ limit: 'abc' }), (error) => error.status === 400);
    await assert.rejects(() => getSlips({ limit: 500 }), (error) => error.status === 400);
    await assert.rejects(() => getSlips({ offset: -1 }), (error) => error.status === 400);
    await assert.rejects(() => getSlipById('abc'), (error) => error.status === 400);
    await assert.rejects(() => getSlipById(-5), (error) => error.status === 400);
});
