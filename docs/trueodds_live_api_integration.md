# TrueOdds Live API Integration Notes

## Status

Pelosi now exposes backend-only proxy/integration routes for the live TrueOdds API:

```http
GET /api/trueodds/matches/search?q=Durazno%20FC
GET /api/trueodds/matches/:matchId
GET /api/trueodds/matches/:trueOddsId/markets
POST /api/trueodds/tips/import
```

These routes call the deployed TrueOdds server from the Pelosi backend. Browsers should call Pelosi, not TrueOdds directly.

## Configuration

Pelosi reads:

```text
TRUEODDS_BASE_URL
TRUEODDSAPIKEY
```

The `.env` value points at the documented v1 API:

```text
http://204.168.129.223/api/v1
```

The same server also serves the bettable feed used by the TrueOdds web UI under:

```text
http://204.168.129.223/api
```

Both are live. Pelosi calls `/api/v1` for search, exact match details, market
resolution and settlement lookup, and keeps `/api` for the bettable match feed,
its import odds source and the debug results feed.

Tip import re-fetches the current match markets from TrueOdds immediately before writing anything and snapshots the selected odds from that fresh server-side response. The authenticated `/api/v1/matches/:matchId/markets` endpoint is the authoritative source (it is what the admin screen displays); the deployed `/api/matches/:trueodds_id/markets` feed is only used when v1 is unavailable or does not contain the requested selection. The import response reports which feed was used in `marketsSource` and any fallback reason in `importWarnings`. See [`tips_api_and_admin_manager.md`](./tips_api_and_admin_manager.md).

## Working TrueOdds Endpoints

The live TrueOdds web UI uses these endpoints:

```http
GET /api/matches
GET /api/matches/:trueodds_id/markets
GET /api/results
```

The `/api/matches/:trueodds_id/markets` feed only serves bettable matches. It
answers `404 {"error":"This match is no longer available for betting."}` for
matches that already finished.

The documented `/api/v1/...` endpoints are now live on the deployed server and
are Pelosi's preferred read API:

```http
GET /api/v1/matches/search?q=Cristal
GET /api/v1/matches/:matchId
GET /api/v1/matches/:matchId/markets
GET /api/v1/matches/:matchId/markets/:marketId/selections/:selectionId
```

`GET /api/v1/matches/:matchId` is Pelosi's settlement source. It also works for
finished matches, which the `/api` markets feed refuses to serve, so it is the
fallback for tip import as well. The full settlement contract is documented in
[`settlement.md`](./settlement.md).

## Pelosi Routes

### Search Matches

```http
GET /api/trueodds/matches/search?q=Durazno%20FC
```

Optional query values currently passed through:

```text
time
sort
sports
market
selection
minOdds
maxOdds
country
league
limit
```

Pelosi maps `q` to the live TrueOdds `search` parameter.

### Get Match Markets

```http
GET /api/trueodds/matches/5580596/markets
```

For the currently deployed `/api` endpoint, the market endpoint requires `trueodds_id`, for example `5580596`.

### Get Match Detail

```http
GET /api/trueodds/matches/5580596
```

Pelosi calls:

```http
GET /api/v1/matches/:matchId
```

with `Authorization: Bearer TRUEODDSAPIKEY`.

This exact match-detail endpoint **is** Pelosi's primary settlement source. It
returns match status, score, `finalResult` and `resultStatus` for one match, and
`matches.source_match_id` maps directly onto it. The `/api/results` feed remains
debug/fallback functionality only and is never the settlement source. See
[`settlement.md`](./settlement.md) for the automatic settlement contract.

Verified with:

```http
GET /api/v1/matches/5630529
```

Observed result:

```json
{
  "match": {
    "id": "sr:match:72221274",
    "trueOddsId": "5630529",
    "status": "finished",
    "score": {
      "home": 0,
      "away": 0
    },
    "finalResult": "D",
    "resultStatus": "AP"
  }
}
```

### Import Tip From Current Markets

```http
POST /api/trueodds/tips/import
Content-Type: application/json
```

Body:

```json
{
  "matchId": "5580596",
  "sourceOddsId": "138484671",
  "creationType": "manual"
}
```

Preferred request field:

```text
sourceOddsId
```

That maps to TrueOdds `event_odds_id`.

For line markets or when the UI does not send `sourceOddsId`, the backend also supports exact market/selection matching fields such as:

```json
{
  "matchId": "5580596",
  "market": "totals",
  "selection": "over",
  "marketSpecifier": "total=2.5",
  "creationType": "manual"
}
```

Pelosi does not trust browser-sent names or odds for import. The backend calls:

```http
GET /api/matches/:trueodds_id/markets
```

and, when that feed refuses the match because it already finished, falls back to:

```http
GET /api/v1/matches/:matchId/markets
```

Then it finds exactly one matching outcome and saves the odds from that fresh
TrueOdds response. The response reports which feed was used in `marketsSource`.

### Settle Match From TrueOdds

```http
POST /api/v1/settlement/matches/:sourceMatchId
```

Pelosi calls `GET /api/v1/matches/:sourceMatchId`, classifies the result, and
settles every eligible pending tip of that match in one transaction. The full
contract lives in [`settlement.md`](./settlement.md).

## Actual Match Search Fields

Observed `/api/matches` match fields:

```text
trueodds_id
event_id
game_id
sport_name
start_time
start_date
country
league
home_team_name
away_team_name
match_status
filtered_count
more_outcomes_count
has_totals
has_handicap
has_double_chance
matched_odds
matched_count
one_x_two
goals
gg
```

Important identifiers:

```text
trueodds_id
```

Used by the live TrueOdds web UI for routing and market lookup:

```text
/api/matches/:trueodds_id/markets
```

```text
event_id
```

Sportradar-style match identifier:

```text
sr:match:111111114427068
```

Pelosi stores `trueodds_id` as `matches.source_match_id` because this is the identifier used by the working TrueOdds markets endpoint.

## Actual Market Response Fields

Observed `/api/matches/:trueodds_id/markets` top-level fields:

```text
match
market_groups
```

Observed `match` fields:

```text
trueodds_id
event_id
game_id
sport_id
category_id
tournament_id
sport_name
start_time
start_date
country
league
home_team_id
home_team_name
away_team_id
away_team_name
match_status
```

Observed `market_groups` fields:

```text
market_id
market_title
market_category
market_category_slug
mobile_layout_class
market_specifier
outcomes
```

Observed `outcomes` fields:

```text
event_id
event_odds_id
market_id
market_name
market_desc
market_specifier
market_title
bet_type
pick_team
outcome_desc
home_team_name
away_team_name
league
country
odds
```

## Useful ID Mapping

Potential Pelosi mapping:

| Pelosi field | TrueOdds live field | Notes |
|---|---|---|
| `matches.source_match_id` | `trueodds_id` | Required for live `/markets` endpoint |
| reference event ID | `event_id` | Sportradar-style match ID |
| `teams.source_team_id` | `home_team_id` / `away_team_id` | Stable team IDs |
| `competitions.source_competition_id` | `tournament_id` | Stable competition ID |
| `tips.source_odds_id` | `event_odds_id` | Best exact selection/odds row ID |
| `tips.source_market_id` | `market_id` | Needs `market_specifier` too |
| market composite key | `market_id + '|' + market_specifier` | Example: `18|total=2.5` |
| `tips.odds` | `odds` | Returned as string in live payload |

## Stable Identifiers Required For Import

The documented TrueOdds Pelosi API exposes these stable identifiers:

| Entity | TrueOdds field | Pelosi target |
|---|---|---|
| Match | `match.id` | `matches.source_match_id` |
| Display match ID | `match.trueOddsId` | display/routing only |
| Home team | `match.homeTeam.id` | `teams.source_team_id` |
| Away team | `match.awayTeam.id` | `teams.source_team_id` |
| Competition | `match.competition.id` | `competitions.source_competition_id` |
| Competition country | `match.competition.countryId` | reference/display only for now |
| Market ID | `market.sourceMarketId` | part of `tips.source_market_id` |
| Market specifier | `market.sourceMarketSpecifier` | part of `tips.source_market_id` |
| Odds row | `selection.sourceOddsId` | `tips.source_odds_id` |
| Selection | `selection.sourceSelectionId` | `tips.source_selection_id` |

Pelosi stores the market as a composite key because the current schema has no separate `source_market_specifier` column:

```text
source_market_id = sourceMarketId + '|' + sourceMarketSpecifier
```

Example:

```text
18|total=2.5
```

## Current `/api` Import Requirement

The live `/api/matches/:trueodds_id/markets` response includes the stable
identifiers required for import, and the `/api/v1/matches/:matchId/markets`
fallback exposes the same identifiers in v1 form:

```text
trueodds_id
event_id
home_team_id
away_team_id
tournament_id
sport_id
category_id
event_odds_id
```

The import code validates these before opening a database transaction. Required import fields:

```text
event_id
trueodds_id
home_team_id
away_team_id
tournament_id or competition_id
event_odds_id
```

It does not invent IDs from names. If the deployed TrueOdds response lacks required team/competition source IDs, the import stops before opening a PostgreSQL transaction.

Current confirmed example:

```text
trueodds_id = 5630529
event_id = sr:match:72221274
home_team_id = sr:competitor:50
away_team_id = sr:competitor:38
tournament_id = sr:tournament:17
category_id = sr:category:1
```

## Tip Import Rule

Tip import uses the authenticated `/api/v1/matches/:matchId/markets` endpoint as
the authoritative source (the same feed the admin screen shows), with the
deployed `/api/matches/:trueodds_id/markets` feed only as a fallback when v1 is
unavailable or does not contain the requested selection.

The safe import flow is:

```text
1. Search match from TrueOdds.
2. Get markets for the selected match.
3. Admin selects an odd.
4. Pelosi re-fetches the match markets from TrueOdds v1 (fallback: deployed /api).
5. Pelosi finds exactly one requested outcome.
6. Pelosi validates required source IDs.
7. Pelosi upserts teams, competition, match.
8. Pelosi rejects the import with 409 when that selection is already imported.
9. Pelosi creates the tip odds snapshot.
```

The `/api/v1` resolve endpoint (single selection) is still not used by import.

## Tested Example

Search:

```http
GET /api/matches?search=Durazno%20FC&time=24&sort=kickoff
```

Found:

```text
Durazno FC vs Deportivo Colonia
TrueOdds ID: 5580596
Event ID: sr:match:111111114427068
League: Copa Uruguay
Country: Uruguay
```

Markets:

```http
GET /api/matches/5580596/markets
```

Example prices:

```text
Durazno FC @ 3.00
Draw @ 3.20
Deportivo Colonia @ 2.35
Over 2.5 @ 2.30
Under 2.5 @ 1.60
```
