# Pelosi Settlement

This document is the contract for Pelosi's automatic settlement. It covers
which TrueOdds result is allowed to settle a tip, how the local Pelosi match
result snapshot is maintained, what happens to accumulators, and what is
deliberately left for manual review.

Manual settlement endpoint:

```http
POST /api/v1/settlement/matches/:sourceMatchId
```

`sourceMatchId` is `matches.source_match_id` for the `trueodds` data source.

## Primary result source

Settlement uses the exact TrueOdds match details endpoint only:

```http
GET /api/v1/matches/:matchId
Authorization: Bearer ${TRUEODDSAPIKEY}
Accept: application/json
```

Rules:

- One `source_match_id` produces exactly one TrueOdds HTTP request per
  settlement run. Every eligible pending tip for that match is settled from
  that single response.
- Pelosi matches by stored source id. It never searches TrueOdds by team name
  for settlement.
- The paginated `/api/results` feed is debug/fallback functionality only. It is
  not the settlement source.

Example request:

```http
GET /api/v1/matches/5630529
```

```json
{
  "match": {
    "id": "sr:match:72221274",
    "trueOddsId": "5630529",
    "status": "finished",
    "providerStatus": "Ended",
    "score": { "home": 0, "away": 0 },
    "finalResult": "D",
    "resultStatus": "AP"
  }
}
```

## Result classification

Every settlement run classifies the TrueOdds payload into `SAFE_FINAL`,
`MANUAL_REVIEW`, `NOT_READY` or `VOID` before any database write happens.

### SAFE_FINAL

A match is `SAFE_FINAL` only when **all** of these hold:

```text
status        = "finished"
resultStatus  IN ("Ended", "manual")
finalResult   IN ("H", "D", "A")
score.home    is a number (not null)
score.away    is a number (not null)
```

`status = "finished"` on its own is never enough. A finished match with an
unsupported `resultStatus`, a missing `finalResult`, or an incomplete score is
manual review, not an automatic result.

### MANUAL_REVIEW

These states must never auto-settle:

```text
resultStatus: AP          after penalties (TrueOdds exposes the pre-penalty score)
resultStatus: AET         after extra time
resultStatus: H1          anomalous / unsafe for automatic settlement
resultStatus: Not Start   anomalous / unsafe for automatic settlement
resultStatus: <unknown>   any other value Pelosi does not recognise
status not "finished"     (when a result status is already present)
finalResult not H/D/A
score.home or score.away null
```

`AP` is the most important case: a match that went to penalties is reported
with the pre-penalty score, so a naive score comparison would produce a wrong
result. Match `5630529` (Brentford 0-0 Chelsea, `resultStatus = AP`) keeps
Tip 3 (`MATCH_RESULT` / `AWAY`) pending forever until a human decides.

### NOT_READY

The match has no final result yet: `status` is `scheduled`/`live`/`postponed`/
`cancelled`, or `resultStatus` is still `null`. Nothing is written.

### VOID

`resultStatus = "void"` (or an explicit `void` match status) means the event was
cancelled/abandoned/voided.

- Pending tips for that match are marked `result = 'void'` with
  `settled_at = NOW()`.
- Scores stay `null`. The local Pelosi match row is left unchanged, because
  `matches.status` has no unambiguous void/abandoned value (the check
  constraint allows only `scheduled`, `live`, `finished`, `postponed`,
  `cancelled`) and Pelosi refuses to invent a misleading final state. Void
  matches therefore need manual handling.
- Slips containing a void leg are reported as requiring manual void handling
  (see below).

## Local Pelosi match snapshot

For a `SAFE_FINAL` result the local match row is updated inside the same
transaction as the tip updates:

```text
matches.status      = 'finished'
matches.home_score  = TrueOdds score.home
matches.away_score  = TrueOdds score.away
```

That snapshot is written from `updateMatchScoreAndStatus(...)` in
`apps/web/src/repositories/match-repository.js`, so Pelosi no longer needs
TrueOdds to display an old score.

The snapshot is written even when the match has no pending tips, and it is
skipped when the stored row already matches (idempotent re-runs).

For `MANUAL_REVIEW`, `NOT_READY` and `VOID` results the local match row is
never overwritten with a final score or `finished` status.

## Supported markets (V1 automatic settlement)

Market codes are matched case-insensitively against the codes actually stored
in `tips.market_code`:

| Market code | Selection codes | Rule |
|---|---|---|
| `MATCH_RESULT`, `1X2` | `HOME`, `DRAW`, `AWAY` | `HOME` wins when `homeScore > awayScore`, `DRAW` when equal, `AWAY` when `awayScore > homeScore` |
| `DOUBLE_CHANCE` | `HOME_OR_DRAW`/`HOME_DRAW`/`1X`, `HOME_OR_AWAY`/`HOME_AWAY`/`12`, `DRAW_OR_AWAY`/`DRAW_AWAY`/`X2` | wins when the actual 1X2 outcome is included in the selection |
| `TOTAL_GOALS` | `OVER`, `UNDER` | `totalGoals = homeScore + awayScore`; `OVER` wins when `totalGoals > line`, `UNDER` wins when `totalGoals < line` |
| `BTTS`, `BOTH_TEAMS_TO_SCORE`, `GG_NG` | `YES`, `NO` | `YES` wins when both teams scored, `NO` wins when at least one did not |

Nothing outside this table is auto-settled. Handicaps, corners, cards, player
props, shots, unknown markets and unknown selection codes are reported in
`tipsSkipped` and stay `pending`.

`UNKNOWN` / unsupported never means lost.

### Push / equal line

When `totalGoals === line` there is no push rule in Pelosi, so the tip is
reported as `TOTAL_GOALS push handling is not defined` and stays `pending` for
manual review.

## Tip updates

A safely settled tip only changes:

```text
tips.result      ('won' | 'lost' | 'void')
tips.settled_at  NOW()
```

These are never modified by settlement:

```text
tips.odds
tips.source_odds_id
tips.source_market_id
tips.source_selection_id
tips.odds_captured_at
```

Historical odds snapshots are permanent.

## Slip recalculation

After tips are updated, Pelosi recalculates only the slips that contain a tip
changed in that run.

```text
any leg lost          -> slip lost    return_units = 0            profit_units = -stake_units
every leg won         -> slip won     return_units = stake_units * total_odds
                                      profit_units = return_units - stake_units
otherwise             -> slip pending return_units = null         profit_units = null
```

`slips.total_odds` is never recalculated during ordinary settlement. It stays
the stored product of the tip odds snapshots.

### Void leg rule (not defined yet)

Pelosi has no documented void-leg accumulator rule. A slip that contains a
`void` leg is therefore reported as:

```json
{
  "slipsRequiringManualReview": [
    {
      "slipId": 5,
      "reason": "Slip contains a void leg and void-leg accumulator rules are not defined"
    }
  ]
}
```

Such a slip is not finalized and its odds are not silently recalculated. Void
handling for accumulators (reducing the odds, voiding the slip, or returning the
stake) is a separate future task and must be defined before it is automated.

## Transaction boundary

```text
validate sourceMatchId
    -> find the Pelosi match in the trueodds data source
    -> ONE TrueOdds GET /api/v1/matches/:matchId
    -> classify the result
    -> if no database write is needed: return
    -> pool.connect()
    -> BEGIN
    -> update the local match snapshot (SAFE_FINAL only)
    -> update every eligible pending tip
    -> recalculate the affected slips
    -> COMMIT
    -> release()
```

The external HTTP request always happens before the transaction is opened, and
every write in the run uses the same checked-out client. Any failure rolls the
whole run back, so a partially settled match cannot be left behind.

## Response shape

```json
{
  "sourceMatchId": "5630529",
  "pelosiMatchId": 3,
  "status": "manual_review",
  "classification": "MANUAL_REVIEW",
  "reason": "TrueOdds resultStatus AP is not automatically settled",
  "trueOddsEndpoint": "/api/v1/matches/:matchId",
  "trueOddsMatch": { "status": "finished", "score": { "home": 0, "away": 0 }, "finalResult": "D", "resultStatus": "AP" },
  "pendingTipsFound": 2,
  "tipsChanged": 0,
  "tipsUpdated": [],
  "tipsSkipped": [
    { "id": 3, "marketCode": "MATCH_RESULT", "selectionCode": "AWAY", "reason": "TrueOdds resultStatus AP is not automatically settled" }
  ],
  "localMatchUpdated": false,
  "localMatch": null,
  "slipsUpdated": [],
  "slipsRequiringManualReview": [],
  "notes": []
}
```

`status` is the lowercase form of the classification: `safe_final`,
`manual_review`, `not_ready` or `void`.

## Idempotency

- Only tips with `result = 'pending'` are ever considered, so an already
  settled tip is never mutated by a later run.
- The local match snapshot is skipped when the stored values already match.
- Re-running settlement for a settled match returns `tipsChanged: 0`, leaves
  `settled_at` untouched and does not rewrite slips.

## Import workflow note

Importing a tip re-fetches the markets and snapshots the odds server-side:

```http
POST /api/trueodds/tips/import
```

It prefers the deployed bettable feed `GET /api/matches/:id/markets`. That feed
refuses finished matches ("This match is no longer available for betting."), so
when it fails Pelosi falls back to the documented
`GET /api/v1/matches/:matchId/markets`, which still returns the stored markets
and the final score. Either way the same validation, upsert and odds-snapshot
code runs, and `marketsSource` in the response records which feed was used.

## Implementation map

```text
apps/web/src/routes/api/settlement-routes.js       POST /api/v1/settlement/matches/:sourceMatchId
apps/web/src/controllers/settlement-controller.js  HTTP layer
apps/web/src/services/settlement-service.js        orchestration, transaction, local snapshot
apps/web/src/services/settlement-rules.js          pure classification/market/slip rules
apps/web/src/integrations/trueodds-client.js       GET /api/v1/matches/:matchId
apps/web/test/settlement-rules.test.js             node:test unit tests
```

Run the tests with:

```text
cd apps/web && npm test
```

## Deliberately not implemented

- scheduled/cron settlement
- handicap, corners, cards, player props and shots settlement
- void-leg accumulator recalculation
- a dedicated void/abandoned value in `matches.status`
- admin authentication for the settlement endpoint
