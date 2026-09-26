# Public Tips API

This is a secondary selection-level API. PELOSI primarily publishes
slips: a slip is the customer betting product, and a tip is one individual
selection/leg inside a slip.

Primary public routes:

```text
GET /slips
GET /slips/:id
GET /performance
GET /history
```

The legacy `/tips` page route currently redirects to `/slips`. The public tips
API remains intentionally available for future selection-level history,
analytics or individual selection detail:

```text
GET /api/v1/public/tips
GET /api/v1/public/tips/:id
```

Current product model:

```text
TIP  = one betting selection / leg
SLIP = the published customer product
```

## Visibility rule

Pelosi does not yet have a complete individual-tip publishing workflow. The safe
public rule is therefore:

```text
A tip is public only when it belongs to at least one currently published slip.
```

Implementation:

```sql
EXISTS (
    SELECT 1
    FROM slip_tips st
    JOIN slips s ON s.id = st.slip_id
    WHERE st.tip_id = tips.id
      AND s.publication_status = 'published'
)
```

Draft-only tips are private, hidden-only tips are private, unattached admin tips
are private, and tips attached to multiple published slips are returned once.
Hiding the only published slip removes that tip from public responses.

## API

```http
GET /api/v1/public/tips?date=YYYY-MM-DD&result=all
```

Filters:

| Query | Values | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | defaults to today's date in `APP_TIMEZONE` |
| `result` | `all`, `pending`, `won`, `lost`, `void` | default `all` |

Dates are based on `matches.starts_at`, not tip creation time. PostgreSQL groups
kickoffs with:

```sql
(matches.starts_at AT TIME ZONE APP_TIMEZONE)::date = $date::date
```

`APP_TIMEZONE` is an IANA timezone configured in `.env`; if omitted, Pelosi uses
`UTC`.

Public tips use stored Pelosi odds snapshots from `tips.odds`. The public API
does not fetch current TrueOdds odds.

Response shape:

```json
{
  "date": "2026-09-22",
  "result": "all",
  "timezone": "UTC",
  "tips": [
    {
      "id": 13,
      "result": "pending",
      "odds": 2.35,
      "marketCode": "MATCH_RESULT",
      "marketName": "Match Result",
      "selectionCode": "HOME",
      "selectionName": "Bangalore City FC",
      "line": null,
      "settledAt": null,
      "match": {
        "homeTeam": "Bangalore City FC",
        "awayTeam": "United Stars FC",
        "competition": "Bangalore Super Division",
        "startsAt": "2026-09-22T08:00:00.000Z",
        "status": "scheduled",
        "homeScore": null,
        "awayScore": null
      }
    }
  ],
  "count": 1,
  "counts": {
    "all": 1,
    "pending": 1,
    "won": 0,
    "lost": 0,
    "void": 0
  }
}
```

Public responses deliberately exclude TrueOdds/source identifiers,
`creationType`, admin metadata, session data, debug fields and database
implementation details.

## Dormant frontend files

```text
apps/web/views/layouts/public.hbs
apps/web/views/public/tips.hbs
apps/web/public/css/public.css
apps/web/public/js/public/site.js
apps/web/public/js/public/tips.js
```

The public `/tips` route redirects to `/slips`, so these files are kept as a
legacy/future secondary selection-level surface rather than as a primary
customer page. If re-enabled later, the browser code only calls
`/api/v1/public/tips`; it never calls the admin tips API or any TrueOdds
endpoint. Loading, empty and error states are rendered in the page shell, result
filters are kept in the URL, and cards show only stored data: competition,
teams, kickoff, prediction, market, odds snapshot and result.
