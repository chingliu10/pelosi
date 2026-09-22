# Admin Performance Screen

Trustworthy betting performance for the admin, derived only from Pelosi's stored
published settled slips.

```text
/admin/performance            (server-rendered shell, admin session)
        |
        | GET /api/v1/performance?range=…           headline metrics (SQL aggregates)
        | GET /api/v1/performance/history?range=…   daily cumulative profit
        | GET /api/v1/slips?publicationStatus=published&result=settled&sort=settled
        v
PostgreSQL (slips)   --  no TrueOdds call anywhere on this screen
```

## Counting rules (unchanged)

Only slips with:

```text
publication_status = 'published'
AND result IN ('won', 'lost')
```

count towards performance. Draft, hidden, pending and void slips never do, and
performance is measured per **slip** (one wager), never per tip.

```text
unitsStaked      = SUM(stake_units)
totalReturnUnits = SUM(return_units)
profitUnits      = SUM(profit_units)
ROI              = profitUnits / unitsStaked * 100
winRate          = wins / settled published slips * 100
averageTotalOdds = AVG(total_odds)
```

Hiding a settled slip removes it from every metric; republishing it restores it.
When no eligible slip exists the endpoint keeps its original contract:
`totalSlips/wins/losses/unitsStaked/totalReturnUnits/profitUnits` are `0` and
`roiPercentage`, `winRatePercentage` and `averageTotalOdds` are `null` (the SQL
guards division with `NULLIF`).

## Headline metrics endpoint

```http
GET /api/v1/performance             all time (unchanged behaviour)
GET /api/v1/performance?range=7d    7 / 30 / 90 day windows
GET /api/v1/performance?range=30d
GET /api/v1/performance?range=90d
```

An unsupported value (`?range=1y`, `?range=banana`) returns
`400 {"error":"Invalid range. Allowed values: all, 7d, 30d, 90d"}`. The response
keeps every existing field and adds `range`.

### Which date the range filters on

**`settled_at`.** Performance is realised when a wager is graded, so the settlement
timestamp is the financially meaningful chronology. `created_at` would credit a
slip to when it was typed in, and `updated_at` would let an unrelated edit move a
slip into a recent window - both would distort recent ROI. Every published
won/lost slip in this database has a `settled_at` (checked before choosing it).

## Trend endpoint

```http
GET /api/v1/performance/history?range=all|7d|30d|90d
```

```json
{
  "period": "day",
  "range": "all",
  "points": [
    { "date": "2026-09-19", "slips": 1, "wins": 0, "losses": 1, "unitsStaked": 1, "totalReturnUnits": 0, "profitUnits": -1, "cumulativeProfitUnits": -1 },
    { "date": "2026-09-20", "slips": 2, "wins": 1, "losses": 1, "unitsStaked": 2, "totalReturnUnits": 2.7405, "profitUnits": 0.7405, "cumulativeProfitUnits": -0.2595 }
  ]
}
```

**Bucket strategy:** daily for every range. The settled history is small, and
daily buckets stay honest - no interpolation and no invented points. A coarser
(weekly/monthly) bucket can be added later if the history grows; the response
already reports `period`.

`cumulativeProfitUnits` is computed in SQL with a window function
(`SUM(SUM(profit_units)) OVER (ORDER BY bucket)`), so the browser never adds up
money itself. Dates are formatted by PostgreSQL (`to_char`) so a bucket label can
never shift by a day through a JavaScript/UTC conversion. Only eligible slips
produce buckets, and points are returned oldest-first.

## Recent settled results

```http
GET /api/v1/slips?publicationStatus=published&result=settled&sort=settled&limit=10
```

The performance screen reuses the existing (admin-authenticated) slips list rather
than a second results API. Two small backwards-compatible additions made that
possible:

| Filter | Meaning |
|---|---|
| `result=settled` | shorthand for `result IN ('won','lost')`; `pending/won/lost/void` still work, `results` is echoed in the response |
| `sort=settled` | newest settlement first (`settled_at DESC NULLS LAST`); the default stays `slip_date DESC` |

Invalid values (`sort=banana`) return `400`. Draft, hidden, pending and void slips
are excluded by the filters themselves.

## Page behaviour

| Section | Content |
|---|---|
| Range control | All time / 7 days / 30 days / 90 days, kept in the URL (`/admin/performance?range=30d`) |
| Metric cards | Profit, ROI, Win rate, Settled slips, Units staked, Average odds - formatted from the API, never recomputed |
| Cumulative profit | Locally built inline SVG: zero line, series line, per-point dots with tooltips, first/last date labels, min/max value labels, plus a screen-reader text list |
| Wins vs losses | Won / Lost counts, win rate and a proportional bar with text labels |
| Recent settled slips | Up to 10 published won/lost slips with odds, stake, return, profit, result pill and settled time |

Positive profit/ROI is shown in green, negative in red, zero neutral; the numbers
themselves always carry the sign, so nothing depends on colour alone.

States: `Loading performance…`, `Loading trend…`, `Loading results…`; empty states
"No published settled slips yet." and "Not enough settled slips for a trend yet."
(fewer than two daily buckets - a single settled slip is never drawn as a fake
trend); errors render inline for a failed summary, trend or results request,
including a session-expired panel with a sign-in link. `null` metrics render as
`—`, never `NaN%` or `Infinity`.

Layout reuses `admin.css`: metric cards in a responsive grid (auto-fit, two per row
below 1024px, one per row below 560px), the chart scales to its container and the
recent list becomes stacked cards on mobile. No horizontal overflow.

## Zero TrueOdds requirement

Performance is historical Pelosi data. The page, the service, the repository and
the routes contain no TrueOdds reference, no `/api/trueodds` request and no
`trueodds-client` import - asserted in the test suite, and verified at runtime by
running the API and the page with `TRUEODDS_BASE_URL` pointing at an unreachable
host (all four endpoints still return `200`).

## Files

```text
apps/web/src/routes/api/performance-routes.js        GET / and GET /history
apps/web/src/controllers/performance-controller.js   HTTP layer, 400/500 mapping
apps/web/src/services/performance-service.js         range allowlist + shaping
apps/web/src/repositories/performance-repository.js  aggregates + trend SQL
apps/web/src/routes/admin/admin-routes.js            GET /admin/performance
apps/web/src/controllers/admin-page-controller.js    page render + nav
apps/web/views/admin/performance.hbs
apps/web/public/js/admin/performance.js
apps/web/test/performance-admin.test.js
```

## Not built yet

Dashboard, league/market/team/odds-band breakdowns, bankroll projections,
betting recommendations, subscriber analytics, and any automatic settlement.
