import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../src/app.js';
import pool from '../src/db/postgres.js';
import { findDataSourceByCode } from '../src/repositories/data-source-repository.js';
import { findSportByCode } from '../src/repositories/sport-repository.js';
import { upsertCompetition } from '../src/repositories/competition-repository.js';
import { upsertTeam } from '../src/repositories/team-repository.js';
import { upsertMatch } from '../src/repositories/match-repository.js';
import { createTip } from '../src/repositories/tip-repository.js';
import { slipTypeForCount } from '../src/utils/slip-type.js';

const runId = Date.now();
const publicDate = '2032-02-10';
const otherDate = '2032-02-11';

let server = null;
let baseUrl = null;
let fixture = null;

async function request(path) {
    const response = await fetch(`${baseUrl}${path}`);
    const text = await response.text();
    let body = null;

    try {
        body = JSON.parse(text);
    } catch {
        body = text;
    }

    return { status: response.status, body };
}

async function insertSlip(client, overrides, tips) {
    const data = {
        title: `Public Slip ${runId}`,
        slipDate: publicDate,
        totalOdds: tips.reduce((total, tip) => total * Number(tip.odds), 1),
        stakeUnits: 1,
        result: 'pending',
        returnUnits: null,
        profitUnits: null,
        publicationStatus: 'published',
        publishedAt: `${publicDate}T10:00:00.000Z`,
        settledAt: null,
        ...overrides
    };
    const slip = await client.query(
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
            data.title,
            data.slipDate,
            Number(data.totalOdds.toFixed(4)),
            data.stakeUnits,
            data.result,
            data.returnUnits,
            data.profitUnits,
            data.publicationStatus,
            data.publishedAt,
            data.settledAt
        ]
    );

    for (const [index, tip] of tips.entries()) {
        await client.query(
            'INSERT INTO slip_tips (slip_id, tip_id, leg_order) VALUES ($1, $2, $3)',
            [slip.rows[0].id, tip.id, index + 1]
        );
    }

    return Number(slip.rows[0].id);
}

async function createFixture() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const source = await findDataSourceByCode('trueodds', client);
        const sport = await findSportByCode('football', client);
        const competition = await upsertCompetition({
            sourceId: source.id,
            sourceCompetitionId: `public-slips-competition-${runId}`,
            sportId: sport.id,
            name: `Public Slips League ${runId}`
        }, client);

        const teams = [];
        const matches = [];
        const tips = [];

        for (let index = 1; index <= 10; index += 1) {
            const home = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `public-slips-${runId}-${index}-home`,
                sportId: sport.id,
                name: `Public Slip ${index} Home ${runId}`
            }, client);
            const away = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `public-slips-${runId}-${index}-away`,
                sportId: sport.id,
                name: `Public Slip ${index} Away ${runId}`
            }, client);
            const match = await upsertMatch({
                sourceId: source.id,
                sourceMatchId: `public-slips-match-${runId}-${index}`,
                sportId: sport.id,
                competitionId: competition.id,
                homeTeamId: home.id,
                awayTeamId: away.id,
                startsAt: `${publicDate}T${String(8 + index).padStart(2, '0')}:00:00.000Z`,
                status: index === 2 ? 'finished' : 'scheduled',
                homeScore: index === 2 ? 2 : null,
                awayScore: index === 2 ? 1 : null
            }, client);
            const tip = await createTip({
                matchId: match.id,
                sourceOddsId: `public-slips-odds-${runId}-${index}`,
                sourceMarketId: `public-slips-market-${runId}-${index}`,
                sourceSelectionId: `public-slips-selection-${runId}-${index}`,
                marketCode: index % 2 === 0 ? 'TOTAL_GOALS' : 'MATCH_RESULT',
                marketName: index % 2 === 0 ? 'Total Goals' : 'Match Result',
                selectionCode: index % 2 === 0 ? 'OVER' : 'HOME',
                selectionName: index % 2 === 0 ? 'Over 2.5' : home.name,
                line: index % 2 === 0 ? 2.5 : null,
                odds: Number((1.5 + index / 10).toFixed(2)),
                result: index === 2 ? 'won' : 'pending'
            }, client);

            teams.push(Number(home.id), Number(away.id));
            matches.push(Number(match.id));
            tips.push({ id: Number(tip.id), odds: Number(tip.odds) });
        }

        const slips = {
            single: await insertSlip(client, {
                title: `Single ${runId}`,
                publishedAt: `${publicDate}T12:00:00.000Z`
            }, tips.slice(0, 1)),
            double: await insertSlip(client, {
                title: `Double ${runId}`,
                publishedAt: `${publicDate}T13:00:00.000Z`,
                result: 'won',
                returnUnits: 2.72,
                profitUnits: 1.72,
                settledAt: `${publicDate}T18:00:00.000Z`
            }, tips.slice(0, 2)),
            treble: await insertSlip(client, {
                title: `Treble ${runId}`,
                publishedAt: `${publicDate}T14:00:00.000Z`,
                result: 'lost',
                returnUnits: 0,
                profitUnits: -1,
                settledAt: `${publicDate}T19:00:00.000Z`
            }, tips.slice(2, 5)),
            fourFold: await insertSlip(client, {
                title: `Four ${runId}`,
                publishedAt: `${publicDate}T15:00:00.000Z`,
                result: 'void',
                returnUnits: 1,
                profitUnits: 0,
                settledAt: `${publicDate}T20:00:00.000Z`
            }, tips.slice(4, 8)),
            fiveFold: await insertSlip(client, {
                title: `Five ${runId}`,
                publishedAt: `${publicDate}T16:00:00.000Z`
            }, tips.slice(5, 10)),
            draft: await insertSlip(client, {
                title: `Draft ${runId}`,
                publicationStatus: 'draft',
                publishedAt: null
            }, tips.slice(0, 1)),
            hidden: await insertSlip(client, {
                title: `Hidden ${runId}`,
                publicationStatus: 'hidden',
                publishedAt: `${publicDate}T17:00:00.000Z`
            }, tips.slice(0, 1)),
            otherDate: await insertSlip(client, {
                title: `Other Date ${runId}`,
                publishedAt: `${otherDate}T12:00:00.000Z`
            }, tips.slice(0, 1))
        };

        await client.query('COMMIT');

        return {
            competitionId: Number(competition.id),
            teamIds: teams,
            matchIds: matches,
            tipIds: tips.map((tip) => tip.id),
            slips
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

test.before(async () => {
    process.env.APP_TIMEZONE = 'UTC';
    fixture = await createFixture();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (fixture) {
        await pool.query('DELETE FROM slips WHERE id = ANY($1::bigint[])', [Object.values(fixture.slips)]);
        await pool.query('DELETE FROM tips WHERE id = ANY($1::bigint[])', [fixture.tipIds]);
        await pool.query('DELETE FROM matches WHERE id = ANY($1::bigint[])', [fixture.matchIds]);
        await pool.query('DELETE FROM competitions WHERE id = $1', [fixture.competitionId]);
        await pool.query('DELETE FROM teams WHERE id = ANY($1::bigint[])', [fixture.teamIds]);
    }

    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

test('slip type helper follows customer labels dynamically', () => {
    assert.equal(slipTypeForCount(1), 'Single');
    assert.equal(slipTypeForCount(2), 'Double');
    assert.equal(slipTypeForCount(3), 'Treble');
    assert.equal(slipTypeForCount(4), '4-Fold Accumulator');
    assert.equal(slipTypeForCount(5), '5-Fold Accumulator');
    assert.equal(slipTypeForCount(10), '10-Fold Accumulator');
});

test('public list uses published_at date filtering, result filtering and publication chronology', async () => {
    const all = await request(`/api/v1/public/slips?date=${publicDate}&limit=20`);
    const pending = await request(`/api/v1/public/slips?date=${publicDate}&result=pending&limit=20`);
    const other = await request(`/api/v1/public/slips?date=${otherDate}&limit=20`);

    assert.equal(all.status, 200);
    assert.deepEqual(all.body.slips.map((slip) => slip.id), [
        fixture.slips.fiveFold,
        fixture.slips.fourFold,
        fixture.slips.treble,
        fixture.slips.double,
        fixture.slips.single
    ]);
    assert.deepEqual(pending.body.slips.map((slip) => slip.id), [fixture.slips.fiveFold, fixture.slips.single]);
    assert.deepEqual(other.body.slips.map((slip) => slip.id), [fixture.slips.otherDate]);
    assert.equal(all.body.date, publicDate);
    assert.equal(all.body.timezone, 'UTC');
    assert.equal((await request('/api/v1/public/slips?date=banana')).status, 400);
});

test('public history scope lists all published slips newest first with filters and pagination', async () => {
    const all = await request('/api/v1/public/slips?scope=history&sort=published&limit=3');
    const next = await request('/api/v1/public/slips?scope=history&sort=published&limit=3&offset=3');
    const won = await request('/api/v1/public/slips?scope=history&result=won&sort=published&limit=20');
    const settled = await request('/api/v1/public/slips?scope=history&result=settled&sort=settled&limit=20');

    assert.equal(all.status, 200);
    assert.deepEqual(all.body.slips.map((slip) => slip.id), [
        fixture.slips.otherDate,
        fixture.slips.fiveFold,
        fixture.slips.fourFold
    ]);
    assert.deepEqual(next.body.slips.map((slip) => slip.id), [
        fixture.slips.treble,
        fixture.slips.double,
        fixture.slips.single
    ]);
    assert.equal(all.body.date, null);
    assert.equal(all.body.total >= 6, true);
    assert.ok(won.body.slips.some((slip) => slip.id === fixture.slips.double));
    assert.ok(won.body.slips.every((slip) => slip.result === 'won'));
    assert.ok(settled.body.slips.every((slip) => ['won', 'lost'].includes(slip.result)));
    assert.equal(settled.body.result, 'settled');
});

test('public detail exposes published slips only and keeps leg order with stored odds', async () => {
    const detail = await request(`/api/v1/public/slips/${fixture.slips.double}`);
    const draft = await request(`/api/v1/public/slips/${fixture.slips.draft}`);
    const hidden = await request(`/api/v1/public/slips/${fixture.slips.hidden}`);

    assert.equal(detail.status, 200);
    assert.equal(draft.status, 404);
    assert.equal(hidden.status, 404);
    assert.equal(detail.body.slipType, 'Double');
    assert.deepEqual(detail.body.selections.map((selection) => selection.legOrder), [1, 2]);
    assert.deepEqual(detail.body.selections.map((selection) => selection.odds), [1.6, 1.7]);
    assert.equal(detail.body.selections[1].match.status, 'finished');
    assert.equal(detail.body.selections[1].match.homeScore, 2);
    assert.equal(detail.body.selections[1].match.awayScore, 1);
});

test('public slip payload excludes source ids and admin metadata', async () => {
    const list = await request(`/api/v1/public/slips?date=${publicDate}&limit=20`);
    const detail = await request(`/api/v1/public/slips/${fixture.slips.single}`);
    const text = JSON.stringify({ list: list.body, detail: detail.body });

    assert.equal(text.includes('sourceOddsId'), false);
    assert.equal(text.includes('sourceMarketId'), false);
    assert.equal(text.includes('sourceSelectionId'), false);
    assert.equal(text.includes('publicationStatus'), false);
    assert.equal(text.includes('creationType'), false);
    assert.equal(text.includes(`public-slips-odds-${runId}`), false);
});

test('public slips do not depend on TrueOdds credentials', async () => {
    const previousBaseUrl = process.env.TRUEODDS_BASE_URL;
    const previousKey = process.env.TRUEODDSAPIKEY;

    delete process.env.TRUEODDS_BASE_URL;
    delete process.env.TRUEODDSAPIKEY;

    try {
        const response = await request(`/api/v1/public/slips?date=${publicDate}`);

        assert.equal(response.status, 200);
        assert.ok(Array.isArray(response.body.slips));
    } finally {
        if (previousBaseUrl === undefined) delete process.env.TRUEODDS_BASE_URL;
        else process.env.TRUEODDS_BASE_URL = previousBaseUrl;

        if (previousKey === undefined) delete process.env.TRUEODDSAPIKEY;
        else process.env.TRUEODDSAPIKEY = previousKey;
    }
});
