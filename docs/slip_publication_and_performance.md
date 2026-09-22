# Slip Publication and Public Performance

This document covers the backend lifecycle that turns a created slip into
publishable public history and ROI reporting:

```text
tip -> slip -> draft -> published -> settlement -> performance
                       |
                       +-> hidden (excluded from public listing/performance)
```

Settlement itself is documented separately in [`settlement.md`](./settlement.md).
Publication is deliberately independent of settlement.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/slips` | **Admin** list of slips (light rows with `legCount`), all publication statuses |
| `POST` | `/api/v1/slips` | Create a slip from stored tips |
| `GET` | `/api/v1/slips/:id` | **Admin** full slip with legs, matches and money fields |
| `POST` | `/api/v1/slips/:id/publish` | Publish a slip (draft or hidden) |
| `POST` | `/api/v1/slips/:id/hide` | Hide a slip without deleting it |
| `GET` | `/api/v1/public/slips` | Public list: **published only** |
| `GET` | `/api/v1/public/slips/:id` | Public detail: published only, otherwise `404` |
| `GET` | `/api/v1/performance` | Public ROI/profit/win-rate derived from published slips |
| `GET` | `/api/v1/performance/history` | Public daily cumulative-profit trend (see [`admin_performance.md`](./admin_performance.md)) |

Slip management is admin-only: `GET /api/v1/slips` and `GET /api/v1/slips/:id`
require the admin session (`401` otherwise) so drafts and hidden slips are never
exposed anonymously. The public follower surface lives under
`/api/v1/public/slips` and only ever returns published slips. See
[`admin_slips.md`](./admin_slips.md).

Routers:

```text
apps/web/src/routes/api/slip-routes.js          mounted at /api/v1/slips
apps/web/src/routes/api/performance-routes.js   mounted at /api/v1/performance
```

## Listing slips

```http
GET /api/v1/slips
GET /api/v1/slips?publicationStatus=published
GET /api/v1/slips?result=won&limit=20&offset=0
```

Supported optional filters (validated, `400` on bad values):

```text
publicationStatus   draft | published | hidden
result              pending | won | lost | void | settled   (settled = won or lost)
creationType        manual | automatic
sort                slip_date (default) | settled  (newest settlement first)
limit               1-100 (default 50)
offset              >= 0 (default 0)
```

`result=settled` plus `sort=settled` is what the admin Performance screen uses for
its "Recent settled slips" panel, so no second results API was needed.

Response:

```json
{
  "slips": [
    {
      "id": 3,
      "title": "Ended settlement test - both legs must win",
      "slipDate": "2026-09-19T21:00:00.000Z",
      "totalOdds": 2.7405,
      "stakeUnits": 1,
      "result": "won",
      "returnUnits": 2.7405,
      "profitUnits": 1.7405,
      "creationType": "manual",
      "publicationStatus": "published",
      "publishedAt": "2026-09-20T20:27:22.515Z",
      "settledAt": "2026-09-20T20:14:49.941Z",
      "legCount": 2,
      "createdAt": "2026-09-20T20:14:49.046Z",
      "updatedAt": "2026-09-20T20:14:49.941Z"
    }
  ],
  "count": 1,
  "limit": 50,
  "offset": 0,
  "publicationStatus": "published",
  "result": null
}
```

The list intentionally returns light rows plus `legCount`; the nested tip/match
structure stays on `GET /api/v1/slips/:id`. No separate public-history
repository exists or is needed - the admin list takes `?publicationStatus=` and
the public list is the published-only `GET /api/v1/public/slips`.

## Publishing

```http
POST /api/v1/slips/:id/publish
```

```text
publication_status = 'published'
published_at       = COALESCE(published_at, NOW())
```

- A pending slip **can** be published. Publication is not settlement, so
  `result`, `return_units`, `profit_units`, `total_odds` and `stake_units` are
  never touched.
- Idempotent: publishing an already published slip keeps the original
  `published_at`. The timestamp is never reset on repeat calls.
- Re-publishing a hidden slip only flips `publication_status` back to
  `published`; the original `published_at` is preserved as historical evidence
  of the first publication.
- There is no separate publication-history table (deliberately out of scope).

## Hiding

```http
POST /api/v1/slips/:id/hide
```

```text
publication_status = 'hidden'
```

- The slip, its legs and its tips are never deleted; hiding is retained for
  audit/history.
- `result`, `return_units`, `profit_units`, `total_odds`, `stake_units` and
  `settled_at` are untouched.
- `published_at` is preserved, so the platform keeps the record of when the
  slip was originally shown to followers.
- Hidden slips disappear from `GET /api/v1/public/slips` and from performance.

## Performance

```http
GET /api/v1/performance
```

```json
{
  "totalSlips": 3,
  "wins": 1,
  "losses": 2,
  "unitsStaked": 3,
  "totalReturnUnits": 2.7405,
  "profitUnits": -0.2595,
  "roiPercentage": -8.65,
  "winRatePercentage": 33.33,
  "averageTotalOdds": 3.3014
}
```

Field names map to the metric names used elsewhere in the project:

| Metric | Field | Definition |
|---|---|---|
| counted slips | `totalSlips` | published slips with `result IN ('won','lost')` |
| wins / losses | `wins`, `losses` | published slips with that result |
| turnover | `unitsStaked` | `SUM(stake_units)` over counted slips |
| returns | `totalReturnUnits` | `SUM(return_units)` over counted slips |
| profit | `profitUnits` | `SUM(profit_units)` over counted slips |
| ROI | `roiPercentage` | `profit_units / units_staked * 100`, `ROUND(..., 2)` |
| win rate | `winRatePercentage` | `wins / counted slips * 100`, `ROUND(..., 2)` |
| average odds | `averageTotalOdds` | `AVG(total_odds)` over counted slips, `ROUND(..., 4)` |

### Scope rules

- Only `publication_status = 'published'` slips are counted. Drafts are
  excluded, and hidden slips are excluded.
- `pending` slips are published-visible once published but are never counted as
  a win or a loss, and they add nothing to stake, return, profit, ROI, win rate
  or average odds.
- `void` slips are excluded from the win/loss accounting as well. Pelosi has no
  documented void accounting rule (see `settlement.md`), so nothing is invented
  here; a void slip simply does not appear in the financial metrics.
- Ratios are protected with `NULLIF(..., 0)`, so an empty history returns
  `null` ROI / win rate / average odds instead of dividing by zero, and the
  numeric values are rounded in PostgreSQL.

The metrics are derived from the `slips` ledger in a single aggregate query in
`apps/web/src/repositories/performance-repository.js`. There is no performance
table.

## Error handling

| Case | Status | Body |
|---|---|---|
| `GET /api/v1/slips/999999` | `404` | `{"error":"Slip not found"}` |
| `POST /api/v1/slips/999999/publish` | `404` | `{"error":"Slip not found"}` |
| `POST /api/v1/slips/999999/hide` | `404` | `{"error":"Slip not found"}` |
| `GET /api/v1/slips?publicationStatus=banana` | `400` | `{"error":"Invalid publicationStatus. Allowed values: draft, published, hidden"}` |
| `GET /api/v1/slips?limit=abc` | `400` | `{"error":"Invalid limit. Must be an integer"}` |
| `GET /api/v1/slips/abc` | `400` | `{"error":"Invalid slip id"}` |
| unexpected database error | `500` | `{"error":"Something went wrong"}` |

Database errors are logged server-side and never returned as stack traces.

## Tests

```text
cd apps/web && npm test
```

`apps/web/test/slip-publication.test.js` runs against the real schema inside a
transaction that is rolled back, so it verifies publish / idempotent publish /
hide / republish, list filters and leg counts, and the performance scope rules
without leaving test rows behind. It skips automatically when PostgreSQL is not
reachable.

## Not implemented (later tasks)

- admin authentication for publish/hide/performance endpoints
- admin and public UI
- subscriptions, payments, rollover
- publication history / audit table
- date-range or per-competition performance breakdowns
