# Admin Slip Builder

The admin Slip Builder is the fast daily workflow:

```text
/admin/slips/new
  -> search TrueOdds through Pelosi
  -> add one or more selections to a server-side temporary slip
  -> save one private draft slip
```

`/admin/tips/new` still exists for operational one-off tip imports, but it is no
longer the primary slip-building workflow.

## Temporary builder API

All endpoints require the existing admin session.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/slip-builder` | Current temporary slip |
| `POST` | `/api/v1/admin/slip-builder/selections` | Add one TrueOdds selection |
| `DELETE` | `/api/v1/admin/slip-builder/selections/:sourceOddsId` | Remove one selection |
| `DELETE` | `/api/v1/admin/slip-builder` | Clear the temporary slip |
| `POST` | `/api/v1/admin/slip-builder/save` | Resolve current selections and create one draft slip |

The authoritative temporary identity is `matchId + sourceOddsId`. Display fields
are only safe UI snapshots. No TrueOdds API key is ever stored in the session.

The builder expires about 24 hours after the last meaningful update without
shortening the admin login session. The existing persistent session cookie has a
seven-day `maxAge`, is `HttpOnly`, uses `SameSite=Lax`, and is `Secure` in
production. Logging out destroys the server session, so the builder disappears.

## Save

Save reads the temporary builder from the session. The browser cannot inject
`tipIds`, odds, stake, result, or publication status.

Pelosi re-resolves every selection from TrueOdds before opening the PostgreSQL
transaction. Inside one transaction it upserts teams, competition and matches,
reuses an existing pending tip for the same local match and `source_odds_id`, or
creates a new pending tip with the save-time odds snapshot. Existing settled
duplicate selections are rejected. One draft slip is created with stake `1`,
pending result, private publication status, `slip_date` set to today's date in
`APP_TIMEZONE`, and leg order matching the builder.

If save fails, the temporary builder remains in the session. A successful save
clears it.

## Slip labels

Labels are display-only:

| Selection count | Label |
|---|---|
| 1 | Single |
| 2 | Double |
| 3 | Treble |
| 4 | 4-Fold Accumulator |
| 5 | 5-Fold Accumulator |
| N | N-Fold Accumulator |
