# Admin UI — Create Tip From TrueOdds

The first admin screen of Wachimba Odds: search TrueOdds, pick a match, pick one
outcome and import it into Pelosi as a real pending tip.

```text
GET /admin/tips/new        (server-rendered shell, session protected)
        |
        | browser fetch (same-origin, session cookie)
        v
Pelosi API  /api/trueodds/matches/search
            /api/trueodds/matches/:trueOddsId/markets
            /api/trueodds/tips/import          (admin session required)
        v
trueodds-service.js -> trueodds-client.js -> TrueOdds
```

The browser never talks to TrueOdds and never sees `TRUEODDSAPIKEY`.

## Pages

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin` | redirects to `/admin/tips/new` |
| `GET` | `/admin/login` | sign-in form (redirects to the target page when already signed in) |
| `POST` | `/admin/logout` | destroys the session and returns to the sign-in page |
| `GET` | `/admin/tips/new` | the create-tip screen; anonymous browsers are redirected to `/admin/login?next=…` |

Only admin paths are accepted as a post-login redirect target, so the login page
cannot be used as an open redirect.

## Files

```text
apps/web/src/routes/admin/admin-routes.js          HTML routes
apps/web/src/controllers/admin-page-controller.js  rendering only, no TrueOdds calls
apps/web/src/middleware/require-admin-page.js      redirect-based session gate
apps/web/src/utils/admin-path.js                   safe redirect target
apps/web/views/layouts/admin.hbs                   admin shell (nav + account menu)
apps/web/views/admin/create-tip.hbs                the screen
apps/web/views/admin/login.hbs                     sign-in screen
apps/web/public/css/admin.css                      styling
apps/web/public/js/admin/create-tip.js             workflow (fetch, state, render)
apps/web/public/js/admin/login.js                  sign-in
```

`app.js` registers Handlebars (`views/`) and serves `public/` as static assets.

## Screen behaviour

1. **Search** — `GET /api/trueodds/matches/search?q=…&limit=50`. Results show
   home team, away team, competition, kickoff, status and the TrueOdds ID in a
   low-emphasis monospace line for admin debugging.
2. **Markets** — `GET /api/trueodds/matches/:trueOddsId/markets` for the chosen
   match. Market groups are rendered from whatever TrueOdds returns; nothing is
   hard-coded. Category tabs (`All`, `Match result`, `Goals`, `Double chance`,
   `BTTS`, `Handicap`, `Other`) are derived from the market `code` values that
   are actually present, so no unsupported mapping is invented.
3. **Selection** — clicking an outcome marks it active (`aria-pressed`) and
   fills the right-hand panel with match, market, prediction and odds.
4. **Import** — `POST /api/trueodds/tips/import` with the minimum identity:

   ```json
   { "matchId": "6278349", "sourceOddsId": "154886210", "creationType": "manual" }
   ```

   Odds, team names and market labels are never sent from the browser; Pelosi
   re-fetches the market and stores the odds snapshot it returns.
5. **Success** — the panel shows the tip ID, the returned odds snapshot,
   prediction, market and result, plus `Import another tip`,
   `View imported tips` (→ `/admin/tips`) and `Search another match`.

   If the selection was already imported Pelosi answers `409` and the panel
   says *"This selection has already been imported."* with a `View existing tip`
   link to `/admin/tips?tip=<id>`, which opens that tip's detail panel. No
   second tip row is created.

Loading (`Searching matches…`, `Loading markets…`, `Importing…`), empty
(`No matches found`, `No markets available for this match`, `No selection
chosen`) and error states are inline — no `alert()`. Buttons are disabled while
a request is in flight so a selection cannot be imported twice by double
clicking.

## Error handling

| Situation | What the admin sees |
|---|---|
| No results | `No matches found. Try a different team name.` |
| Match no longer bettable (404) | the server message, e.g. `This match is no longer available for betting.` |
| Selection no longer available (404) | `Requested market/selection is not present in the current TrueOdds markets response` |
| TrueOdds unreachable (5xx) | `TrueOdds is unavailable right now, so Pelosi could not … Please try again in a moment.` |
| Pelosi server unreachable | `Could not reach the Pelosi server. Check that it is running and try again.` |
| Session expired (401) | `Your admin session expired. Sign in again to import tips.` |
| Validation error (400) | the server message |

## Layout and accessibility

- Desktop: two columns — search/results/markets on the left, sticky selected-tip
  panel on the right. Below 1024px it becomes one column; below 560px the search
  field, buttons and selection cards stack with no horizontal overflow.
- Semantic structure (`header`/`nav`/`main`/`section`/`aside`, `h1`–`h3`),
  a visually hidden label for the search input, `role="status"` +
  `aria-live="polite"` feedback areas, `role="tablist"` market tabs,
  `aria-pressed` selection buttons, `aria-busy` while searching, visible focus
  rings and a skip link.
- Styling follows the Wachimba Odds direction: white surfaces, hairline gray
  borders, 12px card radius, minimal shadow, near-black text, restrained
  green/amber/red only for status.

## Tests

```text
cd apps/web && npm test
```

`apps/web/test/admin-ui.test.js` covers session protection and redirects, safe
redirect targets, the rendered shell, static assets, the "no API key in the
browser" guarantee, the API paths the browser script calls, element-id
consistency between views and scripts, and that the browser scripts parse. The
suite never calls TrueOdds.

## Known limitations

- Every main admin nav item is now a real link (Dashboard, Tips, Slips,
  Settlement, Performance); the dashboard is documented in
  [`admin_dashboard.md`](./admin_dashboard.md).
- Imported tips are reviewed on `GET /admin/tips`
  ([tips API and admin Tips Manager](./tips_api_and_admin_manager.md)).
- Slips are built and managed on `/admin/slips` and `/admin/slips/new`
  ([slip builder and manager](./admin_slips.md)).
- Editing and deleting tips is not part of the Tips Manager yet.
