# Admin Dashboard

The admin landing page: an operational overview built entirely from existing
Pelosi state.

```text
/admin                                  (server-rendered shell, admin session)
        |
        | GET /api/v1/admin/dashboard     one aggregated, read-only call
        v
dashboard-service.js
        |  reuses, never re-implements:
        |--> tip-service.getTips(...)                    pending tips, recent tips, result counts
        |--> slip-service.getSlips(...)                  draft / published counts, recent slips
        |--> settlement-service.getSettlementQueue(...)  local settlement queue
        |--> performance-service.getPublishedPerformance('all')
        v
PostgreSQL          (no TrueOdds request anywhere on this screen)
```

## The dashboard is an aggregator

Every number comes from the service that owns the rule, so the dashboard cannot
drift from the module pages:

| Dashboard value | Owning definition |
|---|---|
| Pending tips | `GET /api/v1/tips?result=pending` (`total`) |
| Draft slips | `GET /api/v1/slips?publicationStatus=draft` (`total`) |
| Published slips | `GET /api/v1/slips?publicationStatus=published` (`total`) |
| Settlement queue | `GET /api/v1/settlement/matches` (`total`) |
| Performance | `GET /api/v1/performance` (all time) |
| Recent tips / slips | the same tips and slips list services, limited to 5 |

No dashboard SQL re-implements tip, slip, publication, settlement or performance
rules, and the browser never recalculates a financial metric (ROI, win rate and
profit are formatted straight from the API response).

## API

```http
GET /api/v1/admin/dashboard     (admin session; 401 anonymously)
```

```json
{
  "summary": { "pendingTips": 8, "draftSlips": 2, "publishedSlips": 3, "settlementMatches": 6 },
  "tipCounts": { "all": 15, "pending": 8, "won": 3, "lost": 3, "void": 1 },
  "performance": { "range": "all", "totalSlips": 3, "wins": 1, "losses": 2, "profitUnits": -0.2595, "roiPercentage": -8.65, "winRatePercentage": 33.33 },
  "recentTips": [],
  "recentSlips": [],
  "settlementQueue": [],
  "settlementQueueTotal": 6,
  "limits": { "recentActivity": 5, "settlementPreview": 5 },
  "errors": {}
}
```

Each widget is loaded independently: if one query fails, the others still return
and the failing key is listed in `errors` (for example
`{ "performance": "unavailable" }`), which the page renders as a single inline
"unavailable" state instead of a blank dashboard.

## Page behaviour

| Section | Content |
|---|---|
| Summary cards | Pending tips, Draft slips, Settlement queue, Published slips - each links to its filtered module view |
| Needs attention | Settlement queue, draft slips and pending tips when they are non-zero; otherwise "You're all caught up." No fake urgency: a scheduled match is not an error, it is simply queue work |
| Quick actions | `+ Create tip`, `Build slip`, `Review settlement`, `View performance` |
| Performance — All time | Profit, ROI, Win rate, Settled slips, Units staked from the performance service, plus `View performance` |
| Awaiting settlement | Up to 5 queued matches (kickoff, pending tips, affected slips) with a `Review` link to `/admin/settlement?match=<sourceMatchId>` |
| Recent tips | Up to 5 newest tips (match, prediction, market, odds, result, created time) with `View all tips` |
| Recent slips | Up to 5 newest slips (title, legs, total odds, stake, publication, result) with `View all slips` |

Wording avoids timezone-dependent labels: the dashboard says *Recent tips*,
*Pending tips*, *Recent slips* and *Settlement queue*, never "today".

The Settlement Monitor accepts `?match=<sourceMatchId>`: it preselects the
matching queue row **without** loading its TrueOdds result, so the admin still
clicks `Check result` explicitly.

## States

- Loading: `Loading dashboard…` (a single request, so one page-level state).
- Empty: `No pending tips. Create a tip to get started.`, `No draft slips. Build a
  slip from pending tips.`, `No matches currently require settlement.`,
  `No published settled slips yet.`, `No tips imported yet. Create a tip to get
  started.`, `No slips yet. Build a slip from pending tips.`, `You're all caught up.`
- Errors: inline alerts for a failed dashboard request or a failed widget, a
  session-expired panel with a sign-in link, and a friendly message when the
  Pelosi server cannot be reached. No SQL text or stack traces are ever returned.

## Guarantees

- **Zero TrueOdds requests.** The dashboard service, controller, route and browser
  script contain no `trueodds-client` import, no `/api/trueodds` path and no
  `TRUEODDS` reference. TrueOdds is still only used by Create Tip and by the
  Settlement Monitor's explicit `Check result`.
- **Read-only.** No tips, slips, publications, settlements, users or money fields
  are written; only the ordinary session read happens. Asserted by comparing a
  database snapshot (row counts plus summed tip odds, slip odds, profit and stake)
  before and after repeated dashboard loads.
- **Consistent with the module pages.** Counts equal the tips, slips, settlement
  and performance service values, which the test suite asserts directly.

## Login landing

Signed-in admins land on `/admin`; the sign-in page's default `next` target and
the page-level session gate both use `/admin`, while an explicit
`?next=/admin/...` destination is still honoured.

## Files

```text
apps/web/src/services/dashboard-service.js            aggregation
apps/web/src/controllers/dashboard-controller.js      HTTP layer
apps/web/src/routes/api/admin/dashboard-routes.js     GET /api/v1/admin/dashboard
apps/web/src/routes/admin/admin-routes.js             GET /admin
apps/web/src/controllers/admin-page-controller.js     page render + nav
apps/web/views/admin/dashboard.hbs
apps/web/public/js/admin/dashboard.js
apps/web/test/dashboard.test.js
```

## Not built yet

Public/member dashboards, notifications, email summaries, league/market/odds-band
analytics, bankroll projections, editing or deleting tips and slips, scheduled
settlement and manual result overrides.
