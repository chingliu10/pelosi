# Admin Slips: Builder and Manager

The daily admin workflow for slips: pick pending tips, build a draft, then
publish, hide or republish from the Slips screen.

```text
/admin/tips        -> Tips Manager (see tips_api_and_admin_manager.md)
      | Build slip
      v
/admin/slips/new   -> Slip Builder  (pending tips -> draft slip)
      | Create draft
      v
/admin/slips       -> Slip Manager  (list -> detail -> publish / hide)
      |
      +-- /admin/slips/:id        redirect to /admin/slips?slip=<id>
```

The backend stays authoritative for every financial value: total odds, stake,
result, publication status, return and profit units.

## Slip creation rules (backend)

`POST /api/v1/slips` validates, inside one transaction:

| Rule | Result |
|---|---|
| `tipIds` array required, at least one entry | `400 tipIds is required` / `At least one tipId is required` |
| ids must be positive integers | `400 tipIds must contain positive integer IDs` |
| no duplicate ids | `400 Duplicate tipIds are not allowed` |
| every tip must exist | `400 Tip IDs not found: …` |
| every tip must be `pending` | `400 Only pending tips can be added to a new slip. Not pending: 5 (lost)` |
| no two tips from the same match (V1, no same-game parlays) | `400 A slip cannot contain multiple tips from the same match (tips 13 and 19 share match 13)` |

Then `total_odds = product(stored tips.odds)` (rounded to 4 dp), `stake_units = 1`,
`result = pending`, `publication_status = draft`. Anything the browser sends for
those fields is ignored. A rejected creation rolls back completely - no slip and
no `slip_tips` rows are left behind.

## Slip Builder (`/admin/slips/new`)

- Available tips come from `GET /api/v1/tips?result=pending` (stored Pelosi odds;
  no TrueOdds call, no fresh odds).
- Search and pagination use the existing `search`, `limit` and `offset` filters.
- Each row shows match, competition, prediction, market, stored odds, kickoff and
  status plus an `Add to slip` button.
- Selection state is a browser-side array of the loaded tip objects; a tip can be
  added once, `Remove` takes it out, and a second tip from a match already in the
  slip cannot be added (button disabled with a "Same match" hint). The backend
  rule above is still the authority.
- If a tip settles between loading and creating, the builder drops it from the
  selection and says so.
- Preview shows the selected legs, `Total odds (preview)` (the product of the
  stored odds), `Stake 1u` and an optional slip title.
- Create sends only:

  ```json
  { "title": "Today's Double", "tipIds": [13, 40], "creationType": "manual" }
  ```

  (`title` is omitted when empty.)
- On success the panel shows the backend values - slip id, selections, total
  odds, stake, status, publication - plus `View slip`, `Create another slip` and
  `Go to slips`.

## Slip Manager (`/admin/slips`)

- List from `GET /api/v1/slips` with `publicationStatus` (All / Draft /
  Published / Hidden) and an optional `result` filter, `limit`/`offset` paging.
- Rows show title or `Slip #id`, slip date, leg count, total odds, stake,
  profit/loss when settled, result pill and publication pill.
- Selecting a row loads `GET /api/v1/slips/:id` and renders the full detail:
  title, id, date, total odds, stake, result, publication, published time,
  return units, profit units and the legs in `leg_order`.
- Actions use the existing endpoints and always re-render from the response:

  | Slip state | Action | Endpoint | Feedback |
  |---|---|---|---|
  | draft | Publish | `POST /api/v1/slips/:id/publish` | `Published successfully` |
  | hidden | Publish again | `POST /api/v1/slips/:id/publish` | `Published successfully` |
  | published | Hide (with inline confirm) | `POST /api/v1/slips/:id/hide` | `Slip hidden` |

  Hiding asks first: *"Hide this slip from public view?"* with `Cancel` /
  `Hide slip` (an inline accessible panel - no browser `confirm()`).
  `published_at` keeps its original value through hide and republish.

## Admin vs public slip APIs

Before this task anonymous callers could read drafts and hidden slips. The
contract is now explicit:

| Endpoint | Auth | Visibility |
|---|---|---|
| `GET /api/v1/slips` | admin session | every publication status (management) |
| `GET /api/v1/slips/:id` | admin session | every publication status |
| `POST /api/v1/slips`, `/:id/publish`, `/:id/hide` | admin session | - |
| `GET /api/v1/public/slips` | none | **published only** |
| `GET /api/v1/public/slips/:id` | none | published only; draft/hidden answer `404` |

The unauthenticated slip endpoints were replaced by the `public` routes rather
than kept as ambiguous, visibility-by-cookie endpoints. `GET /api/v1/performance`
stays public and still counts published slips only.

## States

- Builder: `Loading tips…`, `No pending tips available.`, `No pending tips match
  this search.`, `Creating slip…`, `Slip not created`, session-expired panel.
- Manager: `Loading slips…`, `No slips yet.`, `No slips match these filters.`,
  `Slip not found.`, `Publishing…`, `Hiding…`, session-expired panel.
- Buttons are disabled while a request is in flight, so double clicks cannot
  create two slips or fire two publication actions.
- Desktop uses two columns; below 1024px the panels stack (tips → selected legs
  → preview → create) and slip rows become stacked cards with no horizontal
  scrolling.

## Tests

```text
cd apps/web && npm test
```

- `test/slips-api.test.js`: creation rules (valid create, stored-odds total,
  client-supplied values ignored, duplicate ids, unknown tip, settled tip,
  same-match), atomic rollback, anonymous 401s, admin draft visibility, and the
  public published-only contract including publish/hide/republish with a
  preserved `published_at`.
- `test/admin-ui.test.js`: session redirects, rendered builder/manager shells,
  functional + active Slips nav, the API calls each script makes, the create
  payload shape, the preview calculation, publish/hide wiring, empty/loading/
  error strings and the responsive CSS.

## Not built yet

Dashboard, public site, same-game parlays, editable stakes and slip
editing/deletion. The settlement monitor and the performance screen now exist -
see [`admin_settlement_monitor.md`](./admin_settlement_monitor.md) and
[`admin_performance.md`](./admin_performance.md).
