# Public Today's Slips

The primary customer product is a published slip, not a loose tip.

```text
GET /slips
GET /slips/:id
GET /api/v1/public/slips
GET /api/v1/public/slips/:id
```

`GET /` renders the Wachimba Odds homepage; `GET /tips` redirects to `/slips`.
The public navigation also links to [`/performance`](./public_performance_history.md)
and [`/history`](./public_performance_history.md).

## Date Rule

The public feed uses the slip publication chronology:

```http
GET /api/v1/public/slips?date=YYYY-MM-DD
```

`date` filters `slips.published_at` interpreted in `APP_TIMEZONE`. A slip can
contain selections from several match dates, so Pelosi does not infer the public
slip date from the first or last leg kickoff. If `date` is omitted, the API uses
today in `APP_TIMEZONE`.

For Tanzania deployments:

```text
APP_TIMEZONE=Africa/Dar_es_Salaam
```

## Filters

```http
GET /api/v1/public/slips?date=2026-09-23&result=all
```

| Query | Values | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | defaults to today in `APP_TIMEZONE`; invalid dates return `400` |
| `result` | `all`, `pending`, `won`, `lost`, `void`, `settled` | default `all`; `settled` means won/lost for recent results |
| `scope` | `history` | optional all-date mode for `/history` |
| `sort` | `published`, `settled` | newest publication or newest settlement |
| `limit` / `offset` | same bounds as slip listing | V1 feed is small but paginated |

Rows are sorted by `published_at DESC, id DESC`.

## Slip Labels

Slip type is derived from leg count, never stored in a column:

```js
function slipTypeForCount(count) {
  if (count === 1) return 'Single';
  if (count === 2) return 'Double';
  if (count === 3) return 'Treble';
  return `${count}-Fold Accumulator`;
}
```

## Public Payload

The public list returns safe summary rows:

```json
{
  "date": "2026-09-23",
  "result": "all",
  "timezone": "UTC",
  "slips": [
    {
      "id": 12,
      "title": "Today's Double",
      "publishedAt": "2026-09-23T10:00:00.000Z",
      "result": "pending",
      "stakeUnits": 1,
      "totalOdds": 3.1,
      "returnUnits": null,
      "profitUnits": null,
      "settledAt": null,
      "legCount": 2,
      "slipType": "Double"
    }
  ]
}
```

Detail returns all selections in `leg_order`. Public selection data uses stored
Pelosi snapshots only: market, prediction, odds, result, kickoff, local match
status and local score when available.

The public API deliberately excludes TrueOdds source identifiers, admin session
data, `publicationStatus`, `creationType`, internal settlement reasons and debug
metadata.

## UI

The customer page uses a restrained light design: white cards, neutral borders,
dark typography, muted secondary text and text-labelled result pills. The feed
shows the first three selections for long accumulators, then a `+ N more
selections` note. `/slips/:id` shows the complete slip in leg order.

The browser only calls `/api/v1/public/slips` and `/api/v1/public/slips/:id`.
It never calls admin APIs or TrueOdds.
