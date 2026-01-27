# Wedding RSVP System

## Core Principles

### No Regex
All string manipulation must use string methods (`split`, `indexOf`, `includes`, `startsWith`, `replaceAll`, `charCodeAt`, etc.). No `RegExp` constructors or regex literals (`/pattern/`) allowed anywhere in the codebase.

### Zero Dependencies
Only Node.js built-in modules. No npm packages. Dev dependencies (`@types/node`, `typescript`) are for type checking only and are never imported at runtime.

### Node.js 22+ Required
Uses native SQLite (`node:sqlite`), ESM modules, and `process.loadEnvFile()`.

## Commands

- `npm start` - Run server on port 3000
- `npm test` - Run integration tests
- `npm run test:unit` - Run unit tests
- `npm run test:all` - Run all tests
- `npm run setup` - Set admin password (interactive)
- `npm run seed` - Seed preview data for manual testing

## Project Structure

```
server.js              Entry point - HTTP server, routing dispatch, graceful shutdown
types.js               Constants, enums, limits, type guards (LIMITS, SESSION, RATE_LIMITS, etc.)
core/
  env.js               Loads .env, warns about missing vars (imported first by server.js)
  router.js            Declarative route table - all API routes registered here
  static.js            Static file serving from public/ (also initializes DB on import)
  auth.js              Scrypt hashing, session cookies, CSRF validation, withAdmin middleware
  http.js              JSON response helpers, body parsing, input sanitization, email validation
  rate-limit.js        SQLite-backed per-IP rate limiting
  validation.js        Reusable validators for email, phone, party size, invite codes, etc.
  errors.js            AppError class
  log.js               JSONL audit logging to data/audit/ with 30-day retention
  csv.js               CSV parsing
  utils.js             String utilities
api/
  health.js            GET /api/health
  rsvp.js              GET/POST /api/rsvp/:code - guest RSVP flow
  lookup.js            POST /api/lookup, POST /api/petition - guest self-service
  admin/               All admin endpoints (require withAdmin auth middleware)
    sessions.js        Login/logout
    invites.js         Send invitations via email/SMS
    rsvps.js           View/export RSVPs
    petitions.js       Approve/deny guest petitions
    blocklist.js       Manage petition blocklist
  guests/
    data.js            CRUD + stats for guest records
    export.js          CSV export
    import.js          CSV import
db/
  connection.js        SQLite init, pragmas, query helpers (queryOne, queryAll)
  schema.js            Table creation, triggers, migrations
  sessions.js          Session CRUD, expiration, CSRF rotation
  utils.js             Invite code generation, phone normalization, name fuzzy matching
services/
  email.js             Resend API integration
  twilio.js            Twilio SMS integration
  templates.js         Email/SMS templates
  retry.js             Retry logic with exponential backoff
public/
  pages/index.html     Landing page (/, served as root)
  pages/rsvp/          RSVP page (/rsvp?code=INVITE_CODE)
  pages/admin/         Admin dashboard (/admin)
  pages/effects/       Visual effects system
  styles/              CSS
  images/              Static images
scripts/
  setup-admin.js       Interactive admin password setup
  seed-preview.js      Seed test guests for previewing the RSVP flow
tests/
  integration/         Full server integration tests (port 3001)
  unit/                Unit tests for core/ and services/
  helpers.js           Test server, DB setup, test data factories
  unit-helpers.js      Mocks and assertion utilities
```

## Code Style

- ESM only (`import`/`export`, no `require`). Always use `.js` extensions in imports.
- JSDoc type annotations with `@import` for type imports and `@type` for function signatures.
- Soft-delete pattern: `deleted_at` column instead of hard delete on guests.
- Declarative routing: all routes registered in `core/router.js` via `route(method, pattern, handler)`.
- Admin endpoints wrapped with `withAdmin()` middleware for auth + CSRF.
- Validation functions return `{ valid: boolean, value?, error? }` objects.

## Type System

This project achieves full type safety without TypeScript compilation. All source is plain JavaScript, type-checked by TypeScript in `checkJs` mode via `tsconfig.json` (`strict: true`, `noEmit: true`, `noImplicitAny: true`, `strictNullChecks: true`). Dev dependencies `@types/node` and `typescript` are never imported at runtime.

### Type Definition File Layout

Every major directory has its own `types.d.ts` scoped to that layer:

```
types.d.ts              Shared entity interfaces (Guest, RSVP, Petition, Session, etc.),
                        status enums, config types, validation result types
types.js                Runtime constants (GUEST_STATUS, LIMITS, SESSION, etc.) and
                        type guard functions — implements what types.d.ts declares
core/types.d.ts         Auth (SessionCookieData, CsrfRequest), routing (Route, RouteHandler),
                        errors (AppError hierarchy), validation (ValidationResult<T>),
                        rate limiting, CSV, response helpers, audit logging
db/types.d.ts           Database functions (queryOne<T>, queryAll<T>), schema,
                        session management, utility functions (generateInviteCode, etc.)
services/types.d.ts     Email (EmailOptions, SendResult), SMS (SendSMSResult),
                        retry (RetryResult<T>), templates, HTTP client
api/types.d.ts          API-specific types (UpsertRsvpInput, GetAllRsvpsOptions)
public/pages/types.d.ts Frontend API responses (StatsResponse, GuestsResponse, etc.),
                        DOM utilities (assertElement, getElement, escapeHtml), state types
public/pages/rsvp/types.d.ts    RSVP form state, fetch helpers, lookup/petition/RSVP form types
public/pages/admin/types.d.ts   Admin dashboard module types (guests, invites, petitions,
                                 blocklist, CSV import, modals, auth)
public/pages/effects/types.d.ts Effect system (EffectInstance, EffectDefinition),
                                 per-effect config types, style enums
```

Entity types in root `types.d.ts` are the single source of truth — both backend and frontend import from there, preventing type divergence.

### JSDoc Annotation Patterns

Every `.js` file follows the same conventions:

**1. Module-level type import (always first)**

```js
/** @import * as Types from './types.js' */
```

This makes the `.d.ts` types available without a runtime import. Use `'./types.js'` (with `.js` extension) matching the ESM import convention.

**2. Function typing with `@type`**

Declare the function signature in `types.d.ts`, then reference it:

```js
/** @type {Types.validatePartySize} */
export function validatePartySize(value) {
  // parameters and return type inferred from the declaration
}
```

This is the primary pattern — almost every exported function uses it. Do not repeat `@param`/`@returns` when `@type` already provides the full signature.

**3. Inline variable typing**

```js
/** @type {Record<string, string>} */
const cookies = {}

/** @type {Types.RsvpFormState} */
const state = { inviteCode: null, guestData: null }
```

**4. Generic type casts**

When TypeScript can't infer through a boundary (e.g., database queries):

```js
return /** @type {T | undefined} */ (
  getDb().prepare(sql).get(...params)
)
```

**5. `@param`/`@returns` for standalone functions**

Only used when the function isn't declared in a `.d.ts` file (rare — mainly type guards and small internal helpers):

```js
/**
 * @param {unknown} value
 * @returns {value is Types.GuestStatus}
 */
export function isGuestStatus(value) {
  return typeof value === "string" && value in GUEST_STATUS
}
```

### Key Type Patterns

**Discriminated union for validation results:**

```ts
// In types.d.ts
type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string }
```

All validators in `core/validation.js` return this shape. Callers check `result.valid` to narrow the type and access either `value` or `error`.

**Type guards for runtime narrowing:**

`types.js` exports `isGuestStatus()`, `isPetitionStatus()`, and `isCommunicationType()` — each uses the `value is Type` return annotation so TypeScript narrows after the check.

**Generic database helpers:**

`queryOne<T>()` and `queryAll<T>()` in `db/connection.js` accept a type parameter so callers get typed results:

```js
const guest = queryOne("SELECT * FROM guests WHERE id = ?", id)
// guest is Guest | undefined
```

**Error class hierarchy:**

`core/types.d.ts` declares `AppError` with subclasses (`ValidationError`, `NotFoundError`, `ConflictError`, etc.), each with a discriminated `code` field.

### Adding New Types

When adding a new module or feature:

1. Add entity/shared types to `types.d.ts` (root) if they cross layer boundaries.
2. Add function signatures to the appropriate layer's `types.d.ts` (`core/`, `db/`, `api/`, etc.).
3. In the `.js` implementation, add `/** @import * as Types from './types.js' */` at the top.
4. Annotate each exported function with `/** @type {Types.functionName} */`.
5. For frontend modules, add response/state types to the relevant `public/pages/**/types.d.ts`.

Do not use `@param`/`@returns` on functions that already have a `@type` annotation — it's redundant and can cause conflicts.

## Database

SQLite in WAL mode at `data/wedding.db`. Auto-created on first server start.

**Tables:** guests, rsvps, communications, sessions, blocklist, petitions, rate_limits, migrations

**Key constraints enforced by triggers:**
- Guest status must be `pending | invited | responded`
- Party size must be 1-20
- Petition status must be `pending | approved | denied`

**Pragmas:** `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-64000`

## Security

- Rate limiting on all public endpoints (SQLite-backed, per-IP)
- Scrypt password hashing with random salt (timing-safe comparison)
- Session tokens with 24-hour expiration, 30-minute idle timeout
- CSRF double-submit cookie with 1-hour token rotation
- Input sanitization and length limits on all fields
- CSP, X-Frame-Options, X-Content-Type-Options headers on HTML responses
- `TRUSTED_PROXIES` config for correct IP extraction behind reverse proxies

## Environment Variables

Required in `.env` (see `.env.example`):
- `ADMIN_PASSWORD_HASH` - Generated by `npm run setup`
- `BASE_URL` - Used in invite links (defaults to `http://localhost:3000`)

Optional:
- `PORT` - Server port (default: 3000)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` - For SMS
- `RESEND_API_KEY`, `FROM_EMAIL` - For email
- `TRUSTED_PROXIES` - Comma-separated proxy IPs (for production)
- `NODE_ENV` - Set to `production` for HSTS and proxy warnings

## Testing

Tests use Node.js built-in test runner (`node --test`). Integration tests start a real server on port 3001 with a separate test database. Test helpers provide `createTestGuest()`, `createTestPetition()`, and `adminLogin()` factories.
