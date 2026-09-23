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

const runId = Date.now();
const publicDate = '2031-06-15';
const otherDate = '2031-06-16';

let server = null;
let baseUrl = null;
let fixture = null;

async function request(path) {
    const response = await fetch(`${baseUrl}${path}`);
    const text = await response.text();
    let payload = null;

    try {
        payload = JSON.parse(text);
    } catch {
        payload = text;
    }

    return { status: response.status, body: payload };
}

async function insertSlip(client, title, status, tipIds) {
    const totalOdds = tipIds.length === 0 ? 2 : tipIds.reduce((total, tip) => total * Number(tip.odds), 1);
    const slip = await client.query(
        `
        INSERT INTO slips (title, slip_date, total_odds, stake_units, publication_status, published_at)
        VALUES ($1, $2, $3, 1, $4::varchar, CASE WHEN $4::varchar = 'published' THEN NOW() ELSE NULL END)
        RETURNING id
        `,
        [title, publicDate, Number(totalOdds.toFixed(4)), status]
    );

    for (const [index, tip] of tipIds.entries()) {
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
            sourceCompetitionId: `public-tips-competition-${runId}`,
            sportId: sport.id,
            name: `Public Tips League ${runId}`
        }, client);

        const teams = [];
        const matches = [];

        for (const suffix of ['a', 'b', 'c', 'd', 'e', 'f']) {
            const home = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `public-tips-${runId}-${suffix}-home`,
                sportId: sport.id,
                name: `Public ${suffix.toUpperCase()} Home ${runId}`
            }, client);
            const away = await upsertTeam({
                sourceId: source.id,
                sourceTeamId: `public-tips-${runId}-${suffix}-away`,
                sportId: sport.id,
                name: `Public ${suffix.toUpperCase()} Away ${runId}`
            }, client);
            const startsAt = suffix === 'f'
                ? `${otherDate}T10:30:00.000Z`
                : `${publicDate}T${suffix === 'd' ? '08' : (suffix === 'a' ? '12' : '15')}:00:00.000Z`;
            const match = await upsertMatch({
                sourceId: source.id,
                sourceMatchId: `public-tips-match-${runId}-${suffix}`,
                sportId: sport.id,
                competitionId: competition.id,
                homeTeamId: home.id,
                awayTeamId: away.id,
                startsAt,
                status: suffix === 'b' ? 'finished' : 'scheduled',
                homeScore: suffix === 'b' ? 2 : null,
                awayScore: suffix === 'b' ? 1 : null
            }, client);

            teams.push(Number(home.id), Number(away.id));
            matches.push({ suffix, id: Number(match.id), home, away });
        }

        const tipA = await createTip({
            matchId: matches[0].id,
            sourceOddsId: `public-tips-odds-${runId}-a`,
            sourceMarketId: `market-${runId}-a`,
            sourceSelectionId: `selection-${runId}-a`,
            marketCode: 'MATCH_RESULT',
            marketName: 'Match Result',
            selectionCode: 'HOME',
            selectionName: matches[0].home.name,
            odds: 2.35,
            result: 'pending'
        }, client);
        const tipB = await createTip({
            matchId: matches[1].id,
            sourceOddsId: `public-tips-odds-${runId}-b`,
            marketCode: 'MATCH_RESULT',
            marketName: 'Match Result',
            selectionCode: 'HOME',
            selectionName: matches[1].home.name,
            odds: 1.8,
            result: 'won'
        }, client);
        const tipC = await createTip({
            matchId: matches[2].id,
            sourceOddsId: `public-tips-odds-${runId}-c`,
            marketCode: 'TOTAL_GOALS',
            marketName: 'Total Goals',
            selectionCode: 'OVER',
            selectionName: 'Over 2.5',
            line: 2.5,
            odds: 1.9,
            result: 'lost'
        }, client);
        const tipD = await createTip({
            matchId: matches[3].id,
            sourceOddsId: `public-tips-odds-${runId}-d`,
            marketCode: 'BTTS',
            marketName: 'Both Teams To Score',
            selectionCode: 'YES',
            selectionName: 'Yes',
            odds: 1.7,
            result: 'void'
        }, client);
        const tipE = await createTip({
            matchId: matches[4].id,
            sourceOddsId: `public-tips-odds-${runId}-e`,
            marketCode: 'MATCH_RESULT',
            marketName: 'Match Result',
            selectionCode: 'AWAY',
            selectionName: matches[4].away.name,
            odds: 3.2,
            result: 'pending'
        }, client);
        const tipF = await createTip({
            matchId: matches[5].id,
            sourceOddsId: `public-tips-odds-${runId}-f`,
            marketCode: 'MATCH_RESULT',
            marketName: 'Match Result',
            selectionCode: 'HOME',
            selectionName: matches[5].home.name,
            odds: 2.05,
            result: 'pending'
        }, client);

        await client.query('UPDATE tips SET settled_at = NOW() WHERE id = ANY($1::bigint[])', [[tipB.id, tipC.id, tipD.id]]);

        const publishedA = await insertSlip(client, `Published A ${runId}`, 'published', [tipA]);
        const draftB = await insertSlip(client, `Draft B ${runId}`, 'draft', [tipB]);
        const hiddenC = await insertSlip(client, `Hidden C ${runId}`, 'hidden', [tipC]);
        const publishedD = await insertSlip(client, `Published D ${runId}`, 'published', [tipD]);
        const hiddenD = await insertSlip(client, `Hidden D ${runId}`, 'hidden', [tipD]);
        const publishedD2 = await insertSlip(client, `Published D2 ${runId}`, 'published', [tipD]);
        const publishedF = await insertSlip(client, `Published F ${runId}`, 'published', [tipF]);

        await client.query('COMMIT');

        return {
            competitionId: Number(competition.id),
            teamIds: teams,
            matchIds: matches.map((match) => match.id),
            tips: {
                published: Number(tipA.id),
                draftOnly: Number(tipB.id),
                hiddenOnly: Number(tipC.id),
                publishedAndHidden: Number(tipD.id),
                unattached: Number(tipE.id),
                otherDate: Number(tipF.id)
            },
            slips: {
                publishedA,
                draftB,
                hiddenC,
                publishedD,
                hiddenD,
                publishedD2,
                publishedF
            }
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
        await pool.query('DELETE FROM tips WHERE id = ANY($1::bigint[])', [Object.values(fixture.tips)]);
        await pool.query('DELETE FROM matches WHERE id = ANY($1::bigint[])', [fixture.matchIds]);
        await pool.query('DELETE FROM competitions WHERE id = $1', [fixture.competitionId]);
        await pool.query('DELETE FROM teams WHERE id = ANY($1::bigint[])', [fixture.teamIds]);
    }

    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }

    await pool.end();
});

test('public tips endpoint works without a session and admin tips stay protected', async () => {
    const publicTips = await request(`/api/v1/public/tips?date=${publicDate}`);
    const adminTips = await request('/api/v1/tips');

    assert.equal(publicTips.status, 200);
    assert.equal(adminTips.status, 401);
});

test('only tips attached to currently published slips are public', async () => {
    const response = await request(`/api/v1/public/tips?date=${publicDate}`);

    assert.equal(response.status, 200);

    const ids = response.body.tips.map((tip) => tip.id);

    assert.ok(ids.includes(fixture.tips.published));
    assert.ok(ids.includes(fixture.tips.publishedAndHidden));
    assert.equal(ids.includes(fixture.tips.draftOnly), false);
    assert.equal(ids.includes(fixture.tips.hiddenOnly), false);
    assert.equal(ids.includes(fixture.tips.unattached), false);
    assert.equal(ids.includes(fixture.tips.otherDate), false);
    assert.equal(ids.filter((id) => id === fixture.tips.publishedAndHidden).length, 1);
});

test('public response excludes source and internal fields while preserving stored odds', async () => {
    const response = await request(`/api/v1/public/tips?date=${publicDate}`);
    const tip = response.body.tips.find((row) => row.id === fixture.tips.published);
    const text = JSON.stringify(tip);

    assert.equal(tip.odds, 2.35);
    assert.equal(tip.selectionCode, 'HOME');
    assert.equal(tip.match.competition, `Public Tips League ${runId}`);
    assert.equal(text.includes('sourceOddsId'), false);
    assert.equal(text.includes('sourceMarketId'), false);
    assert.equal(text.includes('sourceSelectionId'), false);
    assert.equal(text.includes('creationType'), false);
    assert.equal(text.includes(`public-tips-odds-${runId}`), false);
});

test('date filtering uses match starts_at and validates dates', async () => {
    const today = await request(`/api/v1/public/tips?date=${publicDate}`);
    const tomorrow = await request(`/api/v1/public/tips?date=${otherDate}`);

    assert.equal(today.body.tips.some((tip) => tip.id === fixture.tips.otherDate), false);
    assert.deepEqual(tomorrow.body.tips.map((tip) => tip.id), [fixture.tips.otherDate]);
    assert.equal((await request('/api/v1/public/tips?date=22/09/2026')).status, 400);
    assert.equal((await request('/api/v1/public/tips?date=banana')).status, 400);
    assert.equal((await request('/api/v1/public/tips?date=2026-15-99')).status, 400);
});

test('result filter works and public tips sort chronologically', async () => {
    const all = await request(`/api/v1/public/tips?date=${publicDate}`);
    const pending = await request(`/api/v1/public/tips?date=${publicDate}&result=pending`);
    const voidOnly = await request(`/api/v1/public/tips?date=${publicDate}&result=void`);

    assert.deepEqual(all.body.tips.map((tip) => tip.id), [
        fixture.tips.publishedAndHidden,
        fixture.tips.published
    ]);
    assert.deepEqual(pending.body.tips.map((tip) => tip.id), [fixture.tips.published]);
    assert.deepEqual(voidOnly.body.tips.map((tip) => tip.id), [fixture.tips.publishedAndHidden]);
    assert.equal((await request(`/api/v1/public/tips?date=${publicDate}&result=banana`)).status, 400);
});

test('hiding and republishing slips updates public visibility safely', async () => {
    await pool.query("UPDATE slips SET publication_status = 'hidden' WHERE id = $1", [fixture.slips.publishedA]);

    const hiddenOnlyPublishedSlip = await request(`/api/v1/public/tips?date=${publicDate}`);
    assert.equal(hiddenOnlyPublishedSlip.body.tips.some((tip) => tip.id === fixture.tips.published), false);

    await pool.query("UPDATE slips SET publication_status = 'hidden' WHERE id = $1", [fixture.slips.publishedD]);

    const stillPublicThroughSecondPublishedSlip = await request(`/api/v1/public/tips?date=${publicDate}`);
    assert.ok(stillPublicThroughSecondPublishedSlip.body.tips.some((tip) => tip.id === fixture.tips.publishedAndHidden));

    await pool.query("UPDATE slips SET publication_status = 'hidden' WHERE id = $1", [fixture.slips.publishedD2]);

    const noPublishedSlipLeft = await request(`/api/v1/public/tips?date=${publicDate}`);
    assert.equal(noPublishedSlipLeft.body.tips.some((tip) => tip.id === fixture.tips.publishedAndHidden), false);

    await pool.query("UPDATE slips SET publication_status = 'published' WHERE id = $1", [fixture.slips.publishedA]);
    await pool.query("UPDATE slips SET publication_status = 'published' WHERE id = $1", [fixture.slips.publishedD]);

    const restored = await request(`/api/v1/public/tips?date=${publicDate}`);
    assert.ok(restored.body.tips.some((tip) => tip.id === fixture.tips.published));
    assert.ok(restored.body.tips.some((tip) => tip.id === fixture.tips.publishedAndHidden));
});

test('public tip detail obeys the same visibility rule', async () => {
    const publicTip = await request(`/api/v1/public/tips/${fixture.tips.published}`);
    const draftOnly = await request(`/api/v1/public/tips/${fixture.tips.draftOnly}`);
    const hiddenOnly = await request(`/api/v1/public/tips/${fixture.tips.hiddenOnly}`);
    const unattached = await request(`/api/v1/public/tips/${fixture.tips.unattached}`);

    assert.equal(publicTip.status, 200);
    assert.equal(publicTip.body.id, fixture.tips.published);
    assert.equal(draftOnly.status, 404);
    assert.equal(hiddenOnly.status, 404);
    assert.equal(unattached.status, 404);
});

test('public endpoint has no TrueOdds dependency', async () => {
    const previousBaseUrl = process.env.TRUEODDS_BASE_URL;
    const previousKey = process.env.TRUEODDSAPIKEY;

    delete process.env.TRUEODDS_BASE_URL;
    delete process.env.TRUEODDSAPIKEY;

    try {
        const response = await request(`/api/v1/public/tips?date=${publicDate}`);

        assert.equal(response.status, 200);
        assert.ok(Array.isArray(response.body.tips));
    } finally {
        if (previousBaseUrl === undefined) delete process.env.TRUEODDS_BASE_URL;
        else process.env.TRUEODDS_BASE_URL = previousBaseUrl;

        if (previousKey === undefined) delete process.env.TRUEODDSAPIKEY;
        else process.env.TRUEODDSAPIKEY = previousKey;
    }
});
