# Tips API and Admin Tips Manager

Everything an admin (or the upcoming slip builder) needs to read imported tips,
plus the backend rules that keep TrueOdds imports clean.

## Duplicate import protection

A TrueOdds selection is identified by the local match plus the stable source
odds id:

```text
tips.match_id + tips.source_odds_id
```

Migration `database/migrations/003_unique_imported_tip_selection.sql` adds:

```sql
CREATE UNIQUE INDEX uq_tips_match_source_odds
ON tips (match_id, source_odds_id)
WHERE source_odds_id IS NOT NULL;
```

The index is partial because two legacy dev tips have no `source_odds_id`. No
duplicate `(match_id, source_odds_id)` groups existed when the migration ran.

Behaviour of `POST /api/trueodds/tips/import`:

```text
new selection      -> 201 Created, one new pending tip with the odds snapshot
existing selection -> 409 Conflict, no new row:
                      { "error": "Tip already imported", "existingTipId": 13 }
```

The service checks inside the import transaction (after the match upsert) and
the unique index is the backstop for concurrent imports; a `23505` violation is
converted into the same `409` instead of a `500`.

## TrueOdds v1 is the authoritative import source

Tip import now reads the authenticated TrueOdds v1 API first - the same feed the
admin screen displays - so the stored odds are the odds the admin saw:

```text
GET /api/v1/matches/:matchId/markets     (primary)
GET /api/matches/:matchId/markets        (fallback only)
```

The legacy feed is used only when v1 is unavailable (`401/403/404`) or does not
contain the requested selection, and the response reports what happened:

```json
{
  "marketsSource": "trueodds-v1 /api/v1/matches/:matchId/markets",
  "importWarnings": []
}
```

Odds are always snapshotted at import time and never updated afterwards:

```text
admin sees 3.50 -> Pelosi stores 3.5000 forever
TrueOdds moves to 3.20 later -> the stored tip is still 3.5000
```

## Tips read API

```http
GET /api/v1/tips
GET /api/v1/tips/:id
```

Both require the admin session (`401 {"error":"Authentication required"}`)
otherwise because tips are internal data. The public customer-safe contract is
separate: `GET /api/v1/public/tips`, documented in
[`public_tips.md`](./public_tips.md).

### Filters

| Query | Values | Notes |
|---|---|---|
| `result` | `pending`, `won`, `lost`, `void` | invalid values return `400` |
| `matchId` | positive integer | local Pelosi match id |
| `marketCode` | tip market code, for example `MATCH_RESULT` | |
| `creationType` | `manual`, `automatic` | |
| `search` | free text (max 100 chars) | matches home team, away team, selection name and market name with `ILIKE`; `%` and `_` are escaped |
| `limit` | 1-100, default 50 | |
| `offset` | 0 or greater | |

### Response

```json
{
  "tips": [
    {
      "id": 13,
      "result": "pending",
      "creationType": "manual",
      "odds": 2.35,
      "marketCode": "MATCH_RESULT",
      "marketName": "1X2",
      "selectionCode": "HOME",
      "selectionName": "Bangalore City FC",
      "line": null,
      "oddsCapturedAt": "2026-09-22T05:38:33.736Z",
      "publishedAt": null,
      "settledAt": null,
      "createdAt": "2026-09-22T05:38:33.736Z",
      "match": {
        "id": 13,
        "sourceMatchId": "6278349",
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
  "total": 14,
  "limit": 50,
  "offset": 0,
  "counts": { "all": 14, "pending": 7, "won": 3, "lost": 3, "void": 1 },
  "result": null,
  "marketCode": null,
  "creationType": null,
  "matchId": null,
  "search": null
}
```

`count` is the page size, `total` is the number of matching rows, and `counts`
is computed with the same filters but **without** the `result` filter so the
status tabs can show every count in one request.

`GET /api/v1/tips/:id` returns one tip plus its source identifiers for
debugging:

```json
{ "source": { "oddsId": "154886210", "marketId": "1|", "selectionId": null } }
```

Both endpoints resolve everything in one joined query
(`tips` → `matches` → home team → away team → competition) - no N+1 lookups.

## Admin Tips Manager

```http
GET /admin/tips
```

Session protected like the rest of the admin screens (anonymous browsers are
redirected to `/admin/login?next=%2Fadmin%2Ftips`).

The page is a server-rendered shell; all data comes from `GET /api/v1/tips`
through the browser:

| Element | Behaviour |
|---|---|
| `+ Create tip` | links to `/admin/tips/new` |
| `Build slip` | links to `/admin/slips/new` (the slip builder - see [`admin_slips.md`](./admin_slips.md)) |
| Status tabs | All / Pending / Won / Lost / Void with live counts; switching a tab resets paging and updates the URL (`?result=`) |
| Search | `?search=` with a 350 ms debounce; submitting the form searches immediately |
| Tip rows | match, competition, prediction, market, odds, kickoff, status pill and tip id |
| Tip details panel | opens for the selected row: prediction, market, selection, odds snapshot, result, kickoff, settled time, source market code, created time and tip id |
| Pagination | Previous / Next with `limit`/`offset` and a `Showing x-y of n` line |
| Empty states | "No tips imported yet." + *Create your first tip*, or "No results matching search." + *Clear filters* |
| Loading / errors | "Loading tips…", "Failed to load tips…", and a "Session expired" panel with a sign-in link on `401` |

Filter and search state is kept in the URL, so `/admin/tips?tip=19` opens the
detail panel for that tip - which is what the create-tip screen links to when an
import is rejected as a duplicate.

Prediction labels are derived from the stored codes, for example
`MATCH_RESULT/HOME` → "<home team> to win", `TOTAL_GOALS/OVER` with line 2.5 →
"Over 2.5 goals", `BTTS/YES` → "Both teams to score".

## Related files

```text
database/migrations/003_unique_imported_tip_selection.sql
apps/web/src/routes/api/tips-routes.js
apps/web/src/controllers/tips-controller.js
apps/web/src/services/tip-service.js
apps/web/src/repositories/tip-repository.js
apps/web/src/services/trueodds-service.js       import + duplicate rule
apps/web/src/routes/admin/admin-routes.js       /admin/tips
apps/web/src/controllers/admin-page-controller.js
apps/web/views/admin/tips.hbs
apps/web/public/js/admin/tips.js
apps/web/test/tips-api.test.js
```

## Not built yet

Editing or deleting tips from the manager. Public customers currently consume
published slips at `/slips`; the public tips API remains available as a secondary
selection-level contract for later history/detail work. Subscriptions and member
accounts are later tasks.
