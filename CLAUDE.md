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
