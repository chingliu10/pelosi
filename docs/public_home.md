# Public Homepage

`GET /` is the PELOSI public homepage.

## Sections

The homepage is a server-rendered public shell that loads live data through
existing public APIs:

| Section | Purpose |
|---|---|
| Hero | Explains the product and links to `/slips` and `/performance` |
| Today's Slips | Compact preview of currently published slips |
| Performance Snapshot | All-time public performance summary |
| Recent Results | Newest published slip records |
| How It Works | Customer-facing explanation of published slips, stored odds and settlement |
| Transparency | Notes that public performance/history are based on published slip records |
| Final CTA | Links back to current slips and full performance |

## APIs Used

```http
GET /api/v1/public/slips?limit=3
GET /api/v1/public/slips/:id
GET /api/v1/performance?range=all
GET /api/v1/public/slips?scope=history&sort=published&limit=5
```

The homepage does not query the database directly and does not create its own
performance formulas. Financial values are formatted from the public performance
API response.

## Safety Rules

- No TrueOdds requests.
- No admin API requests.
- No internal `/api/v1/slips` or `/api/v1/tips` calls from the browser.
- No fake slips or placeholder performance values.
- Public copy uses PELOSI as the customer-facing brand.
- The page avoids guarantee language such as sure bets, risk-free claims or
  guaranteed winners.

## Empty and Error Behavior

Homepage sections load independently. If today's slips fail, performance and
recent history can still render. If one API has no data, that section shows a
normal empty state:

```text
No slips have been published for today yet.
No settled public slips yet.
No published history yet.
```

Errors are customer-safe and do not expose stack traces.
