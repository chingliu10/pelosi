# Admin Settlement Monitor

The admin screen for settlement work: see which Pelosi matches still have pending
tips, check one match against the exact authenticated TrueOdds v1 result, and run
the **existing** settlement engine when the backend says it is safe.

```text
/admin/settlement
        |
        | 1. queue            GET  /api/v1/settlement/matches             (local data only)
        | 2. check result     GET  /api/v1/settlement/matches/:id/preview (one TrueOdds call)
        | 3. settle           POST /api/v1/settlement/matches/:id         (existing engine)
        v
settlement-service.js -> settlement-rules.js (same classifier) -> trueodds-client.js
```

Nothing about the settlement rules changed in this task: the monitor reuses
`classifyTrueOddsMatch`, `decideTipSettlement` and `evaluateSlipSettlement`, so the
screen can never disagree with the engine.

## Settlement queue

```http
GET /api/v1/settlement/matches          (admin session)
```

One grouped query over `matches → tips → slip_tips → slips` with joins to teams
and competition. It returns the local matches that still have `pending` tips:

```json
{
  "matches": [
    {
      "matchId": 9,
      "sourceMatchId": "6013445",
      "homeTeam": "Modena FC",
      "awayTeam": "Empoli",
      "competition": "Serie B",
      "startsAt": "2026-09-20T17:30:00.000Z",
      "localStatus": "finished",
      "homeScore": 2,
      "awayScore": 1,
      "pendingTipCount": 1,
      "affectedPendingSlipCount": 0
    }
  ],
  "count": 1,
  "total": 6,
  "limit": 50,
  "offset": 0,
  "localStatus": null,
  "search": null
}
```

`affectedPendingSlipCount` counts distinct **pending** slips that contain a pending
tip of that match. Matches whose tips are all settled are not queued.

Filters: `localStatus` (scheduled / live / finished / postponed / cancelled),
`search` (home team, away team, competition - LIKE wildcards escaped),
`limit` (1-100) and `offset`. Invalid values return `400`.

**No TrueOdds traffic:** the queue is built purely from Pelosi PostgreSQL, so
opening the screen with 50 queue rows makes exactly zero external requests. A
"ready/review" workflow filter is deliberately not offered because it would
require one TrueOdds call per row.

## Result preview (read-only)

```http
GET /api/v1/settlement/matches/:sourceMatchId/preview   (admin session)
```

```json
{
  "sourceMatchId": "5630529",
  "pelosiMatchId": 3,
  "status": "manual_review",
  "classification": "MANUAL_REVIEW",
  "canAutoSettle": false,
  "actionLabel": null,
  "reason": "TrueOdds resultStatus AP is not automatically settled",
  "trueOdds": {
    "id": "sr:match:72221274",
    "trueOddsId": "5630529",
    "status": "finished",
    "score": { "home": 0, "away": 0 },
    "finalResult": "D",
    "resultStatus": "AP"
  },
  "localMatch": { "id": 3, "status": "scheduled", "homeScore": null, "awayScore": null },
  "wouldUpdateLocalMatch": false,
  "pendingTipCount": 2,
  "affectedPendingSlipCount": 0,
  "pendingTips": [
    { "id": 3, "marketCode": "MATCH_RESULT", "willAutoSettle": false, "predictedResult": null, "reason": "TrueOdds resultStatus AP is not automatically settled" }
  ],
  "affectedSlips": [],
  "notes": []
}
```

Guarantees:

- exactly one TrueOdds request, only when the admin asks for that match;
- classification comes from the shared rules module, never from a second
  implementation;
- **no database writes** - tips, slips, the local match snapshot and historical
  odds are untouched (asserted by tests, including against real data);
- unknown Pelosi matches return `404`, TrueOdds failures return a clean message.

`status` values: `safe_final`, `not_ready`, `manual_review`, `void`.
`canAutoSettle` is true only when the engine can act on its own (`safe_final`, and
`void`, where the engine marks tips void). `actionLabel` is `Settle match`,
`Mark tips void`, or `null`.

The per-tip preview uses the same decision function as settlement, so a push
(`totalGoals === line`), an unsupported market or an unknown selection code shows
`willAutoSettle: false` with the engine's own reason.

## Settling

The screen calls the existing endpoint - no new settlement path exists:

```http
POST /api/v1/settlement/matches/:sourceMatchId     (admin session)
```

The browser sends nothing but the source match id: no score, `finalResult` or
`resultStatus` is ever trusted from the client, and the server re-fetches and
re-classifies before any write. A preview that said "safe" five seconds earlier
does not authorise a write.

The UI reports only what the response contains: `tipsChanged`, the updated tips
grouped into won/lost/void, `tipsSkipped` (with the engine's reason, shown as
"Left for manual review"), `slipsUpdated`, `slipsRequiringManualReview`,
`localMatchUpdated` and the resulting local snapshot. When nothing changed it says
**"Nothing changed"** instead of claiming success, and it refreshes the queue
afterwards.

### Safety behaviours preserved

- **AP / AET / H1 / Not Start / unknown / not finished / incomplete score** →
  `manual_review` or `not_ready`; no settle button is offered and no mutation can
  happen even if the endpoint is called directly.
- **Void** → the engine marks the pending tips `void` and leaves the slip pending
  with a "manual void handling" note; the local match row is not rewritten and no
  accumulator void-leg rule is invented.
- **Unsupported markets** (handicap, corners, cards, props…) → never lost, shown
  as manual review.
- **Local match snapshot** → `matches.status/home_score/away_score` are updated
  only for a safe final result; source identifiers, tip odds and slip total odds
  are never touched.
- **Idempotency** → a second settlement call reports `tipsChanged: 0`, no duplicate
  money mutation and no changed odds; verified by tests and against real data.

## Page behaviour

| Element | Behaviour |
|---|---|
| Queue rows | home vs away, competition, kickoff, local status pill, pending tip count, affected pending slip count and a `Check result` button |
| `Check result` | one preview request for that match only; the queue never fans out |
| Result panel | TrueOdds status, resultStatus, score, final result, classification, local match, per-tip predictions and affected slips |
| `Settle match` / `Mark tips void` | shown only when the backend says `canAutoSettle`; disabled while the request is in flight |
| `Check again` | offered for not-ready/manual-review states (no settle button exists there) |
| `Refresh queue` | reloads local queue data only; there is no "settle all", no loop and no cron |

Loading states: `Loading settlement queue…`, `Checking TrueOdds result…`,
`Settling match…`, `Refreshing settlement queue…`. Empty states: "No matches
currently require settlement.", "No search results.", "No pending tips for this
match.", "No affected slips.". Errors (session expired, TrueOdds unavailable,
match not found, settlement blocked) render as inline admin alerts.

Layout reuses the existing admin CSS: two columns on desktop, stacked below
1024px, full-width actions below 560px.

## Test seam

`previewMatchSettlement(sourceMatchId, { fetchMatch })` and
`settleMatchFromTrueOdds(sourceMatchId, { fetchMatch })` accept an optional
TrueOdds fetch function. Production code always uses the real client; the tests
inject payloads (Ended / AP / AET / scheduled / void) so the mutation rules can be
proven deterministically without a live API.

## Tests

```text
cd apps/web && npm test
```

`test/settlement-monitor.test.js` covers the queue (auth, contents, settled-only
exclusion, filters, paging), the preview (auth, unknown match, safe final, AP,
AET, not ready, void, no mutation), settlement (safe final settles a supported tip
and recalculates the affected slip, unsupported market stays pending, local
snapshot update, odds unchanged, idempotency, AP/AET/no-op paths, void handling)
and live regression checks against the real Brentford vs Chelsea AP match when
TrueOdds is reachable. `test/admin-ui.test.js` covers the page, navigation, API
wiring, the "no automatic preview fan-out" guarantee, manual-review messaging and
the responsive CSS.

## Not built yet

Dashboard, bulk/"settle all", scheduled or background settlement, manual result
override, audit log and any public settlement surface. The performance screen now
exists - see [`admin_performance.md`](./admin_performance.md).
