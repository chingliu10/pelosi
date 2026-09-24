# Public Performance and History

Public customers can now inspect both current slip products and the historical
record:

```text
GET /slips
GET /slips/:id
GET /performance
GET /history
```

All public pages use stored Pelosi data only. None of them calls TrueOdds.

## Performance

`GET /performance` uses the existing public performance API:

```http
GET /api/v1/performance?range=all|7d|30d|90d
GET /api/v1/performance/history?range=all|7d|30d|90d
```

No second formula exists for the public site. The public page displays the exact
backend values for:

| Metric | Source |
|---|---|
| Profit | `profitUnits` |
| ROI | `roiPercentage` |
| Win rate | `winRatePercentage` |
| Settled slips | `totalSlips` |
| Units staked | `unitsStaked` |
| Average odds | `averageTotalOdds` |

Counting is slip-based:

```text
publication_status = 'published'
AND result IN ('won', 'lost')
```

Draft, hidden, pending and void slips do not count toward performance. A Double
with two winning selections is still one winning slip, not two wagers.

The range control keeps state in the URL:

```text
/performance?range=30d
```

The chart is a plain inline SVG built from
`GET /api/v1/performance/history`. It shows a zero baseline, chronological
cumulative profit points and a screen-reader text equivalent. If fewer than two
daily buckets exist, the page shows "Not enough settled slips for a trend yet."

Recent results use the public slip API, not the admin slip API:

```http
GET /api/v1/public/slips?scope=history&result=settled&sort=settled&limit=10
```

Each row links to `/slips/:id`.

## History

`GET /history` is the public archive of currently published slips. It does not
use a separate history table; the `slips` table is the record.

The browser reads:

```http
GET /api/v1/public/slips?scope=history&sort=published&limit=10&offset=0
```

`scope=history` means "do not default the list to today's publication date".
Without that scope, the public slips API keeps the Today's Slips behavior and
defaults `date` to today in `APP_TIMEZONE`.

History visibility:

| Slip status | Public history |
|---|---|
| `published` | visible |
| `draft` | hidden |
| `hidden` | hidden |

Hiding a previously public slip removes it from History immediately.
Republishing makes it visible again.

History filters:

```text
all
won
lost
void
pending
```

History sorts newest publication first:

```sql
ORDER BY published_at DESC NULLS LAST, id DESC
```

Cards show publication time in `APP_TIMEZONE`, slip type, title, selection count,
combined odds, result, stake, return/profit or pending potential return, a compact
selection preview, and a real `/slips/:id` anchor.

Long accumulators show the first three selections followed by `+ N more
selections`; the detail page remains the complete leg list.

## Public API Additions

The public slip list keeps its existing shape and gained backwards-compatible
query support:

| Query | Values | Purpose |
|---|---|---|
| `scope` | `history` | all published dates instead of today's date |
| `sort` | `published`, `settled` | publication chronology or recent settled results |
| `result` | `all`, `pending`, `won`, `lost`, `void`, `settled` | `settled` is won/lost |
| `limit` / `offset` | existing validated pagination | history paging |

Public responses still exclude source identifiers, admin/session data,
`publicationStatus`, `creationType`, internal settlement reasons and debug
metadata.

## Files

```text
apps/web/views/public/performance.hbs
apps/web/views/public/history.hbs
apps/web/public/js/public/ui.js
apps/web/public/js/public/performance.js
apps/web/public/js/public/history.js
apps/web/public/css/public.css
apps/web/src/controllers/public-page-controller.js
apps/web/src/routes/public/public-routes.js
```

## Not Built

Homepage, member authentication, subscriptions, paywalls, checkout, payments,
bookmaker links, comments, notifications, AI analysis and bankroll projections.
