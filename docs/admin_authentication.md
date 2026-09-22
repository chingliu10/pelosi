# Admin Authentication (Session Based)

Pelosi uses **server-side sessions** for its two trusted admin users. There is
no JWT, no OAuth and no registration flow.

```text
browser
   |  POST /api/v1/auth/login  { email, password }
   v
controllers/auth-controller.js
   v
services/auth-service.js          bcrypt.compare
   v
repositories/user-repository.js   raw SQL -> users table
   v
PostgreSQL                        session row in the `session` table
   v
HttpOnly cookie (pelosi.sid) -> later requests send it back automatically
```

Two separate authentication systems exist and must not be confused:

| System | Protects | Secret |
|---|---|---|
| Pelosi admin session | admin browser -> Pelosi server | `SESSION_SECRET` |
| TrueOdds API key | Pelosi server -> TrueOdds server | `TRUEODDSAPIKEY` |

`TRUEODDSAPIKEY` stays server-side only and is never sent to a browser.

## Environment variables

```text
SESSION_SECRET         required, at least 32 characters, never hard-coded
SESSION_COOKIE_NAME    optional, defaults to "pelosi.sid"
NODE_ENV               "production" enables Secure cookies + trust proxy
```

If `SESSION_SECRET` is missing or too short the app refuses to start with
`SESSION_SECRET is required and must be at least 32 characters long`.

Generate one without committing it:

```text
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

See `apps/web/.env.example` for the full list of variables (placeholders only).

## Database

Migration `database/migrations/002_admin_users_and_sessions.sql` adds:

```text
users     id, email (lowercase, unique), password_hash, role, is_active, created_at, updated_at
session   sid, sess, expire   (connect-pg-simple's schema)
```

Passwords are stored as bcrypt hashes (`bcryptjs`, cost 10). No password and no
seeded user is ever committed; `users.password_hash` is the only credential
column and it never leaves the backend.

## Routes

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | public | `{ email, password }` -> `200 { user }`, or `401 Invalid credentials` |
| `GET` | `/api/v1/auth/me` | session | `200 { user: { id, email, role } }`, or `401` |
| `POST` | `/api/v1/auth/logout` | public | destroys the session, clears the cookie, `200 { success: true }` |

Login validates input (`400` when email or password is missing), looks the user
up by lowercase email, rejects unknown, inactive or wrong-password users with
the **same** generic `401 Invalid credentials` message (no account
enumeration), regenerates the session id (session fixation protection) and then
stores the minimum identity in the session:

```json
{ "user": { "id": 1, "role": "admin" } }
```

The session never contains the password, the password hash or the whole row.

## Protected endpoints

`requireAuth` (`apps/web/src/middleware/require-auth.js`) checks
`req.session?.user?.id` and answers `401 {"error":"Authentication required"}`
otherwise. It guards:

```text
POST /api/trueodds/tips/import
POST /api/v1/slips
POST /api/v1/slips/:id/publish
POST /api/v1/slips/:id/hide
POST /api/v1/settlement/matches/:sourceMatchId
```

Intentionally public (followers/future public site):

```text
GET  /api/v1/slips
GET  /api/v1/slips/:id
GET  /api/v1/performance
GET  /api/trueodds/matches/search
GET  /api/trueodds/matches/:matchId
GET  /api/trueodds/matches/:trueOddsId/markets
GET  /api/trueodds/results
GET  /api/trueodds/results/:trueOddsId
```

### Known public-exposure caveat (not fixed in this task)

The public slip reads are unfiltered by publication status:

```text
GET /api/v1/slips/5              -> 200 with a draft slip
GET /api/v1/slips/1              -> 200 with a hidden slip
GET /api/v1/slips?limit=100      -> includes draft and hidden slips
```

Fixing this needs a public/private read model (for example: only
`publication_status = 'published'` for anonymous readers, drafts/hidden for
sessions). That redesign is deliberately left to a later task; until then,
treat `GET /api/v1/slips*` as an internal/admin read surface even though it is
not session protected.

## Cookie behaviour

```text
name      pelosi.sid (SESSION_COOKIE_NAME)
httpOnly  true                 JavaScript cannot read the session id
sameSite  lax                  no cross-site cookie sending
secure    false in development over HTTP
          true when NODE_ENV=production (HTTPS only)
path      /
maxAge    7 days
```

`secure` follows `NODE_ENV`, so local HTTP development keeps working while
production requires HTTPS. In production the app also sets
`trust proxy` so Secure cookies work behind a reverse proxy.

## Creating the two admin users

Users are created in PostgreSQL with the one-time script (never hard-coded and
never inserted by a migration):

```text
cd apps/web
npm run create-admin-user -- --email admin1@example.com
npm run create-admin-user -- --email admin2@example.com
```

The password is read from the `ADMIN_USER_PASSWORD` environment variable (or
`--password`), hashed with bcrypt and never printed. `--update-password` resets
the password of an existing user:

```text
ADMIN_USER_PASSWORD='...' npm run create-admin-user -- --email admin1@example.com
npm run create-admin-user -- --email admin1@example.com --update-password
```

The email must be a valid address; it is stored lowercase so login is
case-insensitive. Passwords must be at least 10 characters.

## Tests

```text
cd apps/web && npm test
```

`apps/web/test/auth.test.js` starts the real app on an ephemeral port and keeps
cookies with a small jar helper (no extra test framework). It covers valid
login, wrong password, unknown user, inactive user, `/auth/me` before and after
login, session-id regeneration, logout, protected routes with and without a
session, public read routes, and that stored passwords are bcrypt hashes.

## Not implemented (later tasks)

- login rate limiting / lockouts
- registration, password reset, email verification, OAuth
- role-based authorization beyond `requireAuth` (the `role` column is already
  stored for that future work)
- filtering the public slip reads by publication status
- admin UI
