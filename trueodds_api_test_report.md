# TrueOdds API Test Report

## Summary

The TrueOdds server at:

```text
http://204.168.129.223
```

is reachable and serves the TrueOdds web UI.

The Pelosi `.env` contains both:

```text
TRUEODDSAPIKEY
TRUEODDS_BASE_URL
```

The API key was used for testing, but it is not written in this report.

## Important Finding

The root API documentation says Pelosi should use:

```text
/api/v1
```

However, the tested `/api/v1` endpoints currently return `404`.

The live TrueOdds web UI uses different working endpoints:

```text
/api/matches
/api/matches/:trueodds_id/markets
/api/results
```

So the documentation and the deployed API do not currently match.

## Working Endpoints Tested

### Search Upcoming Matches

```http
GET /api/matches?search=Durazno%20FC&time=24&sort=kickoff
```

Result:

```text
Durazno FC vs Deportivo Colonia
Country: Uruguay
League: Copa Uruguay
TrueOdds ID: 5580596
Event ID: sr:match:111111114427068
Start time: 2026-09-17T22:00:00.000Z
```

### Filter Matches By Market

These worked:

```http
GET /api/matches?search=Durazno%20FC&time=24&market=winner&selection=home
GET /api/matches?search=Durazno%20FC&time=24&market=totals&selection=over&minOdds=2.00&maxOdds=2.50
GET /api/matches?search=Durazno%20FC&time=24&market=doublechance&selection=home_draw
GET /api/matches?search=Durazno%20FC&time=24&market=handicap
```

### Match Markets

```http
GET /api/matches/5580596/markets
```

This returned 13 market groups for:

```text
Durazno FC vs Deportivo Colonia
```

Example markets:

```text
1X2:
Durazno FC @ 3.00
Draw @ 3.20
Deportivo Colonia @ 2.35

Double Chance:
Home or Away @ 1.32
Draw or Away @ 1.35
Home or Draw @ 1.54

Over/Under 2.5:
Over 2.5 @ 2.30
Under 2.5 @ 1.60

GG/NG:
Yes @ 1.93
No @ 1.75
```

### Results Search

```http
GET /api/results?team=Juventus&limit=100
```

This returned Juventus results, including matches from September 17, 2026.

Main Juventus result found:

```text
Juventus 5-0 NEC Nijmegen
League: UEFA Europa League
Time: 2026-09-17T19:00:00.000Z
Result page: /results/5573703
```

Another Juventus-named result found:

```text
AS Cittadella 2-0 Juventus FC
League: Serie C, Group A
Time: 2026-09-17T16:30:00.000Z
Result page: /results/5567460
```

## Endpoints That Did Not Work

The documented `/api/v1` endpoints returned `404`:

```http
GET /api/v1/matches/search?q=Durazno%20FC
GET /api/v1/matches/5580596
GET /api/v1/matches/5580596/markets
```

These also did not work:

```http
GET /api/matches/5580596
GET /api/matches/sr:match:111111114427068
GET /api/results/5574394
GET /api/results/5574394/markets
```

## Practical Integration Notes For Pelosi

For the current deployed TrueOdds server, Pelosi should probably use:

```text
GET /api/matches
GET /api/matches/:trueodds_id/markets
GET /api/results
```

The current deployed API does not match `apidocumentation.md`.

Before building permanent Pelosi integration, one of these should happen:

1. TrueOdds deploys the documented `/api/v1` API.
2. Pelosi updates its integration plan to use the currently working `/api/...` endpoints.
3. The API documentation is updated to describe the real deployed endpoints.

## Conclusion

The TrueOdds API/server is reachable and usable for searching matches, reading markets, and reading results.

The biggest issue is not connectivity or authentication. The biggest issue is endpoint mismatch:

```text
Documentation says: /api/v1/...
Live server uses:   /api/...
```
