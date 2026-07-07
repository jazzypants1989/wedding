# Phase 1 — Guest Accounts & Sessions Foundation

**Goal**: passwordless guest identity. Schema, session lifecycle, `withAccount()` middleware, `/api/account/*` endpoints, rate limits, test factories. API only — no frontend in this phase.

**Prerequisites**: none. **Read first**: `00-overview.md`, then
`db/schema.js`, `db/sessions.js` (template for the new session module), `db/sql.js`, `db/utils.js` (`normalizeName`, `withTransaction`), `core/auth.js` (withAdmin, cookies, CSRF), `core/router.js`, `core/rate-limit.js`, `core/validation.js`, `types.js`, `types.d.ts`, `core/types.d.ts`, `db/types.d.ts`, `api/admin/sessions.js`, `api/rsvp.js` (public endpoint anatomy), `tests/helpers.js`, `server.js` (hourly interval, lines ~61–68).

## 1. Schema (add to `createTables()` in `db/schema.js`; triggers gated by one `runMigrations` entry, e.g. `add_account_triggers`)

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guest_id INTEGER,                       -- NULL for open (untrusted) registration
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,          -- normalizeName(name); enables re-login match
  relation TEXT,
  contact_email TEXT,                     -- optional; enables Phase 6 magic-link recovery for untrusted accounts
  trusted INTEGER NOT NULL DEFAULT 0 CHECK(trusted IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT DEFAULT NULL,
  FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_guest_id ON accounts(guest_id);
CREATE INDEX IF NOT EXISTS idx_accounts_deleted_at ON accounts(deleted_at);
-- One account per (household guest record, person name); allows re-login by code+name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_guest_name
  ON accounts(guest_id, name_normalized)
  WHERE guest_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS account_sessions (
  token TEXT PRIMARY KEY,                 -- SHA256 hex of bearer token (existing hashToken())
  account_id INTEGER NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP,
  csrf_rotated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_account_sessions_account_id ON account_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_account_sessions_expires_at ON account_sessions(expires_at);

CREATE TABLE IF NOT EXISTS app_state (    -- generic KV; used by Phase 2 notifications
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Trigger (copy the `auto_updated_at_guests` pattern): `auto_updated_at_accounts` — AFTER UPDATE, `WHEN NEW.updated_at = OLD.updated_at`, sets `updated_at = datetime('now')`.

## 2. Constants & types

`types.js`:

```js
export const GUEST_SESSION = Object.freeze({
  DURATION_MS: 180 * 24 * 60 * 60 * 1000,    // 180 days absolute
  IDLE_TIMEOUT_MS: 60 * 24 * 60 * 60 * 1000, // 60 days idle
  CSRF_ROTATION_MS: 24 * 60 * 60 * 1000,     // 24h
  MAX_SESSIONS_PER_ACCOUNT: 10,
})
// RATE_LIMITS additions:
//   ACCOUNT_REGISTER: { windowMs: 60*60*1000, max: 10 }   (per IP)
// LIMITS additions:
//   ACCOUNT_NAME_MAX_LENGTH: 100   (relation reuses RELATIONSHIP_MAX_LENGTH)
```

Root `types.d.ts`: `Account` interface (id, guest_id, name, name_normalized, relation, contact_email, trusted 0|1, created_at, updated_at, deleted_at), `AccountSession` (session row + joined `account_id, name, trusted, guest_id`). `core/types.d.ts`: `AccountRouteInfo { params; account: AccountSession }`, `AccountHandler`, `withAccount`, `createAccountSessionCookies`, `clearAccountSessionCookies`, extend `RouteOptions` with `account?: boolean`. `db/types.d.ts`: signatures for the new db modules below.

## 3. New module `db/accounts.js`

- `createAccount({ guestId, name, relation, contactEmail, trusted })` — computes `name_normalized` via existing `normalizeName` (`db/utils.js`), normalizes `contactEmail` via existing `normalizeEmail`, INSERTs, returns row.
- `findAccountByGuestAndName(guestId, nameNormalized)` — the re-login lookup (excludes `deleted_at`).
- `getAccountById(id)`.

## 4. New module `db/account-sessions.js` (template: `db/sessions.js`)

`createAccountSession(accountId)`:
- token = `crypto.randomBytes(32).toString("hex")` (plaintext returned once), stored as `hashToken(token)`; csrf likewise random.
- `expires_at = now + GUEST_SESSION.DURATION_MS`.
- **Do NOT copy the admin `DELETE FROM sessions`** — instead cap per account:

```sql
DELETE FROM account_sessions WHERE account_id = ${accountId} AND token NOT IN (
  SELECT token FROM account_sessions WHERE account_id = ${accountId}
  ORDER BY created_at DESC, rowid DESC LIMIT 10
);
```

The `rowid DESC` tiebreak is load-bearing: `created_at` has second granularity, and on ties SQLite's
pick is arbitrary — without the tiebreak the trim can delete the session it just created (and the
cap unit test, whose rows share one timestamp, is guaranteed flaky).

`getAccountSession(token)` — hash, then join:
`SELECT s.*, a.id AS account_id, a.name, a.trusted, a.guest_id FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ${hash} AND a.deleted_at IS NULL` — plus absolute-expiry and idle checks against `GUEST_SESSION` (mirror `getSession`'s date math). A soft-deleted account instantly invalidates its sessions.

Also: `updateAccountSessionActivity(token)`, `rotateAccountCsrfToken(token)`, `deleteAccountSession(token)`, `cleanExpiredAccountSessions()` (**wire into the existing hourly `setInterval` in `server.js`** next to `cleanExpiredSessions()` — easy to forget), `getOptionalAccount(req)` (parse cookie, return session-or-null; never 401s; for public GETs that include the caller's own pending items in later phases).

## 5. `withAccount()` in `core/auth.js` (parallel to `withAdmin`, lines ~134–179)

- Cookie `guest_session`; 401 `"Sign in to participate"` if absent; 401 `"Session expired or invalid"` if lookup fails.
- `updateAccountSessionActivity` on every request.
- CSRF on POST/PUT/DELETE/PATCH via the existing `validateCsrf(req, session)` (same `X-CSRF-Token` header, timing-safe). Failure → 403 + audit `CSRF_FAILURE` with `details.kind = "guest"`.
- CSRF rotation after `GUEST_SESSION.CSRF_ROTATION_MS`, Set-Cookie writes **`guest_csrf`** (not `csrf`).
- Calls handler with `{ ...routeInfo, account: session }`.

Cookie helpers (mirror `createSessionCookies`):

```
guest_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=15552000[; Secure]
guest_csrf=<csrf>;     Path=/; SameSite=Lax; Max-Age=15552000[; Secure]
```

SameSite=**Lax** is a deliberate deviation from admin's Strict (guests arrive from links in texts/emails; Strict makes every arrival look logged out). Comment this at the definition. Admin and guest cookies coexist in one browser; logout of one never touches the other.

Router: add `account?: boolean` to `RouteOptions` and one branch in `route()` (`core/router.js` ~line 76): `else if (options.account) wrappedHandler = withAccount(handler)`.

## 6. Endpoints (new `api/account.js`, registered in `core/router.js`)

| Method | Path | Auth | Limit |
|---|---|---|---|
| POST | `/api/account/register` | public (`errorHandling: true`) | ACCOUNT_REGISTER by `getClientIp` |
| POST | `/api/account/logout` | public | — |
| GET | `/api/account/me` | public | — |

`register` body `{ code?, name, relation?, contact? }`:
1. `validateRequiredString(name, "Name", LIMITS.ACCOUNT_NAME_MAX_LENGTH)`; `validateOptionalString(relation, LIMITS.RELATIONSHIP_MAX_LENGTH)`; `contact` optional — if present, `validateEmail` then `normalizeEmail`, stored as `contact_email` (it exists solely to enable Phase 6 magic-link recovery).
2. **Code path**: `validateInviteCode(code)` → guest lookup **`COLLATE NOCASE`** (codes are mixed-case but hand-typed on phones where the auth sheet auto-capitalizes; the RSVP flow's BINARY lookup is untouched — its codes arrive via links). Not found → generic 404 `"Invite code not found"` (same wording as `/api/rsvp/:code` — no new oracle; never distinguish wrong-code vs deleted-guest). Then `findAccountByGuestAndName(guest.id, normalizeName(name))`:
   - found → **re-login**: new session for the existing account, respond **200** with `returning: true`;
   - not found → `createAccount({ guestId: guest.id, trusted: 1, ... })` → **201**. This is how multiple household members share one code.
3. **Open path** (no code): `createAccount({ guestId: null, trusted: 0, ... })` → **201**. No dedupe (nothing to dedupe on — accepted risk).
4. `createAccountSession(account.id)` → Set-Cookie both guest cookies → `{ success, account: { id, name, relation, trusted }, returning }`. Status is **201 for both create paths, 200 for re-login** — tests assert this split.
5. Audit `ACCOUNT_REGISTER` / `ACCOUNT_LOGIN` (re-login), with IP; failed code attempts audited with `details: { reason: "invalid_code" }`.

`logout`: delete session row (if valid cookie), clear both guest cookies, 200 regardless.
`me`: `getOptionalAccount(req)` → `200 { account }` or `200 { account: null }` (cheap whoami for page bootstrap — do not 401).

New AUDIT_ACTIONS (`core/utils.js` + type): `ACCOUNT_REGISTER, ACCOUNT_LOGIN, ACCOUNT_LOGOUT` (ACCOUNT_TRUST/UNTRUST/DELETE come in Phase 6).

## 7. Tests

Factories in `tests/helpers.js` (mirror `createTestGuest`/`adminLogin`/`adminFetch` shapes):
- `createTestAccount(db, overrides)` — direct insert, computes `name_normalized`, defaults untrusted.
- `createTestAccountSession(db, accountId)` — fabricates hashed session row, returns `{ token, csrfToken, cookieHeader }`.
- `accountRegister(body)` — HTTP registration, extracts `guest_session`/`guest_csrf` from `getSetCookie()`, returns auth bundle.
- `accountFetch(path, options, auth)` — guest cookie header + `X-CSRF-Token`.
- Extend `cleanupTestData` to clear accounts/account_sessions/app_state.

Integration (`tests/integration/accounts.test.js`):
- Valid code + name → 201 trusted, cookies set, `me` returns account.
- Same code, two different names → two distinct account ids.
- Same code + same name (case/whitespace variants) → same account id, 200 + `returning: true`.
- **Code case variants** (`lower()`/`upper()` of a seeded code) → same guest resolved (the `COLLATE NOCASE` lookup).
- Invalid code → 404 with the generic message.
- No code → 201 untrusted account created instantly; optional `contact` stored normalized, invalid `contact` → 400.
- Mutating request without `X-CSRF-Token` → 403 (use any Phase-1-testable route, or defer full check to Phase 2 and test via a temporary echo of withAccount on logout… simplest: make logout require the session cookie but not CSRF, and add the CSRF integration test in Phase 2's POST /api/guestbook; unit-test `withAccount` CSRF directly here with `mockRequest`).
- 11th registration from one IP within an hour → 429 (`X-Forwarded-For` trick from existing rate-limit tests).
- Admin + guest sessions coexist: `adminLogin` + `accountRegister`, then hit one admin route and `me`, assert both resolve correctly.
- Soft-delete the account row directly → next `me`/authed call is unauthenticated.

Unit: session expiry math with backdated `created_at`/`last_activity_at`; per-account 10-session cap trimming; `withAccount` 401/403 branches via `mockRequest`/`mockResponse` (`tests/unit-helpers.js`).

## 8. Acceptance criteria

- All tests above green; `npx tsc --noEmit` clean; no regex/deps.
- `server.js` hourly interval calls `cleanExpiredAccountSessions()`.
- Demo (curl): register with a seeded invite code (`npm run seed`), capture cookies, call `me`, logout, `me` → null.

## Risks to watch

- Registration endpoint is a new invite-code oracle → the 10/h/IP limit and generic 404 wording are load-bearing.
- `normalizeName` matching: "Cathy" ≠ "Kathy" creates a second account — intended; the `returning` flag lets later UI say "Welcome back".
- Untrusted accounts without a `contact_email` are unrecoverable (no credential); document in code comment. Those **with** one get magic-link recovery in Phase 6 — Phase 1 only stores the address.
- **Impersonation-by-shared-code is an accepted risk**: re-login is code + name, so anyone holding a household's code can open an existing family member's account by typing their name — sessions, pending items, and delete rights included. Acceptable for a wedding-guest audience; do not "fix" it with credentials.
