# Pelosi Source API

TrueOdds exposes a small read-only API for Pelosi under:

```text
/api/v1
```

Pelosi should call this API from its backend only. Browsers should not call
TrueOdds directly.

## Authentication

Every request requires:

```http
Authorization: Bearer <TRUEODDS_INTERNAL_API_KEY>
```

Set the key in the TrueOdds environment:

```text
TRUEODDS_INTERNAL_API_KEY=replace-with-a-long-random-secret
```

Missing or invalid credentials return:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid API credentials."
  }
}
```

## Current Odds Definition

The API returns rows from `event_odds` where:

```sql
is_active = TRUE
```

The returned `oddsCapturedAt` value is `event_odds.last_fetched_at`.

Historical prices remain in TrueOdds odds history tables, but this API returns
the current active odds snapshot used by the TrueOdds UI.

## Identifiers

Match `id` is `events.event_id`, for example:

```text
sr:match:74165892
```

`trueOddsId` is also returned for local display/public routing, but Pelosi
should store `id` as `source_match_id`.

Markets use a composite key:

```text
market_id|market_specifier
```

Examples:

```text
1|
18|total=2.5
14|hcp=-1.5
```

Selections use `event_odds.id` as `sourceOddsId`. This is the safest exact
identifier for the selected odd row.

## Endpoints

### Search Matches

```http
GET /api/v1/matches/search?q=chelsea
```

Optional query params:

```text
dateFrom=2026-09-17
dateTo=2026-09-24
limit=20
```

`limit` defaults to `20` and is clamped to `100`.

Response:

```json
{
  "matches": [
    {
      "id": "sr:match:74165892",
      "trueOddsId": 10053,
      "startsAt": "2026-09-18T17:00:00.000Z",
      "status": "scheduled",
      "sport": {
        "id": "sr:sport:1",
        "name": "Football"
      },
      "competition": {
        "id": "sr:tournament:7",
        "name": "UEFA Champions League",
        "country": "International Clubs",
        "countryId": "sr:category:393"
      },
      "homeTeam": {
        "id": "sr:competitor:3052",
        "name": "Fenerbahce Istanbul",
        "country": "International Clubs"
      },
      "awayTeam": {
        "id": "sr:competitor:2702",
        "name": "Roma",
        "country": "International Clubs"
      },
      "score": {
        "home": null,
        "away": null
      }
    }
  ]
}
```

### Match Details

```http
GET /api/v1/matches/:matchId
```

`matchId` can be either `events.event_id` or `events.trueodds_id`.

Response:

```json
{
  "match": {
    "id": "sr:match:74165892",
    "trueOddsId": 10053,
    "startsAt": "2026-09-18T17:00:00.000Z",
    "status": "scheduled",
    "homeTeam": { "id": "...", "name": "..." },
    "awayTeam": { "id": "...", "name": "..." },
    "score": { "home": null, "away": null }
  }
}
```

Result fields used for settlement:

```text
status          "scheduled" | "live" | "finished" | ...
providerStatus  provider status, for example "Ended" | "AP" | "Not start"
score.home      final score, null until known
score.away      final score, null until known
finalResult     "H" | "D" | "A" | null
resultStatus    "Ended" | "manual" | "AP" | "AET" | "H1" | "Not Start" | "void" | null
```

This endpoint is Pelosi's primary settlement source: `matches.source_match_id`
maps directly onto `:matchId`, and a single request settles every pending Pelosi
tip of that match. Only `status = "finished"` together with
`resultStatus IN ("Ended", "manual")`, `finalResult IN ("H", "D", "A")` and a
complete score is settled automatically. `AP`, `AET`, `H1`, `Not Start` and
`void` require manual handling, and `/api/results` is not a settlement source.
See `docs/settlement.md`.

### Match Markets

```http
GET /api/v1/matches/:matchId/markets
```

Response:

```json
{
  "matchId": "sr:match:74165892",
  "markets": [
    {
      "id": "1|",
      "sourceMarketId": "1",
      "sourceMarketSpecifier": "",
      "code": "MATCH_RESULT",
      "name": "1X2",
      "line": null,
      "selections": [
        {
          "id": "12345",
          "sourceOddsId": "12345",
          "sourceSelectionId": "1",
          "code": "HOME",
          "name": "Chelsea",
          "odds": 1.75,
          "oddsCapturedAt": "2026-09-17T10:00:00.000Z"
        }
      ]
    }
  ]
}
```

### Resolve One Selection

```http
GET /api/v1/matches/:matchId/markets/:marketId/selections/:selectionId
```

Example:

```http
GET /api/v1/matches/sr:match:74165892/markets/18%7Ctotal%3D2.5/selections/12345
```

This verifies:

- match exists
- selected odd belongs to that match
- selected odd belongs to that market key
- selected odd is active

Response:

```json
{
  "match": {},
  "market": {},
  "selection": {},
  "oddsCapturedAt": "2026-09-17T10:00:00.000Z"
}
```

## Error Format

```json
{
  "error": {
    "code": "MATCH_NOT_FOUND",
    "message": "Match not found."
  }
}
```

## TrueOdds Tables Used

- `events`
- `event_odds`

This API does not create, update, or delete TrueOdds sporting data.

## Recommended Indexes

Existing TrueOdds migrations already include trigram indexes for archive team
search:

- `events_archive_home_team_trgm_idx`
- `events_archive_away_team_trgm_idx`

If Pelosi search becomes slow for competition/country searches, consider adding
similar trigram indexes for:

- `LOWER(tournament_name)`
- `LOWER(category_name)`
