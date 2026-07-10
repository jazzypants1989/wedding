# Architecture

A wedding RSVP + guestbook + gallery site built as an exercise in constraint: **zero
runtime dependencies** and **no regular expressions**, on Node.js 22+. This document is a
public tour of how it fits together. (The exhaustive internal reference lives in
`CLAUDE.md`.)

## The two hard constraints

**Zero dependencies.** Only Node.js built-in modules are imported at runtime —
`node:http`, `node:sqlite`, `node:crypto`, `node:fs`, `node:zlib`, and friends. The only
dev dependencies are `typescript` and `@types/node`, used purely for type-checking and
never imported by shipped code. There is no build step: source runs as written.

**No regex.** All string manipulation uses string methods — `split`, `indexOf`,
`includes`, `startsWith`, `replaceAll`, `charCodeAt`. No `RegExp`, no regex literals. This
touches everything from CSV parsing to content-type sniffing to IP-range math, and it's a
surprisingly good forcing function for readable, intention-revealing string code.

Both constraints are interesting precisely because a normal app reaches for a dependency or
a regex within the first hour. Living without them shapes the whole codebase.

## Request lifecycle

```
node:http server  →  core/router.js  →  handler (api/*, core/static.js)
```

- **`server.js`** — the entry point. Creates the raw `node:http` server, wires a long
  `requestTimeout` for large uploads, dispatches to the router, serves `/media/*`
  dynamically before falling through to static files, and handles graceful shutdown.
- **`core/router.js`** — a declarative route table. Every API route is registered with
  `route(method, pattern, handler)`; there's no framework, just a small matcher.
- **`core/static.js`** — serves everything under `public/`. HTML responses are transformed
  on the way out: critical CSS is inlined, a Content-Security-Policy is applied (static
  hash mode by default, per-request nonce mode optionally), cache-busting query strings are
  added to asset URLs, and site content tokens are filled (see below). Deterministic
  transforms are memoized (ETag + gzip) so the work happens once per file.

Admin endpoints are wrapped in a `withAdmin()` middleware that enforces session auth and
CSRF; guest-account endpoints use analogous `withAccount()` / `withAccountOrAdmin()`
wrappers.

## Content as data

All wedding-specific copy — couple names, date, location, registry, navigation, and the
pre-/post-wedding copy variants — lives in a single frozen module, `content.js`. A derived
**timeline mode** (`"pre"` or `"post"`, from the wedding date with an env override) selects
which copy and navigation to show. The static server templates this into the HTML at serve
time via plain `{{token}}` string replacement (every scalar HTML-escaped except a small
allowlist of trusted-HTML copy fields), so pages render fully server-side (no
flash-of-unstyled-content, works with JS disabled, SEO-clean) while remaining a single
source of truth. This is the seed of turning the site into a reusable, re-skinnable
template.

The **effective** content is not just `content.js`, though: an admin can override any of it
at runtime. `core/site-content.js` resolves effective content = `content.js` defaults ⊕ a
stored override kept under the `site_content` key in `app_state`, deep-merged (nested objects
merge key-by-key; arrays replace wholesale). The admin "Site content" tab
(`api/admin/site-content.js`, behind `withAdmin`) validates a full submitted body, then stores
only the **diff from defaults** — so unchanged fields keep tracking future `content.js` edits,
and a submission equal to the defaults clears the override entirely. Every save calls
`onContentChanged()` (`core/static.js`), which re-resolves content, rebuilds the token map, and
evicts the memoized templated HTML so the next request re-templates — no redeploy needed.
Web-facing content is editable this way; the email/SMS constants (`types.js` `WEDDING`,
`EMAIL_SUBJECTS`) stay boot-resolved from `content.js` defaults (a documented boundary).

## Data model

SQLite in WAL mode, a single file at `data/wedding.db`, created automatically on first
start. Accessed through Node's built-in `node:sqlite` — no ORM, no driver dependency. A
small tagged-template query builder provides parameterized queries; `queryOne<T>` /
`queryAll<T>` give typed results.

Core tables: guests, rsvps, communications, sessions, petitions, blocklist, rate_limits,
plus the post-wedding social layer — accounts, account_sessions, account_recovery_tokens,
guestbook_entries, media, comments, reactions.

Two patterns are worth calling out:

- **Trigger-enforced invariants.** SQLite has no polymorphic foreign keys, so comments and
  reactions (which can attach to a guestbook entry *or* a media item) use `BEFORE INSERT`
  triggers that verify the target exists. Status enums and party-size bounds are enforced by
  triggers too — the database rejects invalid rows regardless of the calling code.
- **Soft deletes.** Guests, accounts, guestbook entries, media, and comments carry a
  `deleted_at` column instead of being hard-deleted; feeds filter on
  `status = 'approved' AND deleted_at IS NULL`.

## Media pipeline

Guest photo/video uploads stream through a zero-dependency pipeline:

```
streaming upload  →  magic-byte sniff  →  variant generation  →  Range/206 serve  →  GPS blanking
```

- Uploads are written to disk as they stream in (no full-file buffering), with per-account
  quotas and disk-headroom guards.
- Content type is verified by **magic-byte sniffing** (reading the first bytes), not by
  trusting the client's declared type — done with byte comparisons, no regex.
- Originals live in a write-once `uploads/` tree keyed by a derived file key; a periodic
  sweep moves orphaned files to quarantine rather than hard-deleting them.
- The media server supports HTTP Range requests (`206 Partial Content`) so video seeks and
  iOS Safari playback work.
- Video originals have their GPS/location metadata blanked in place before serving, so
  uploaders don't leak where a clip was filmed.

## Authentication

Three distinct identities, all built on `node:crypto`:

- **Admin** — a single password (scrypt hash with random salt, timing-safe comparison).
  Sessions are cookie-based with a 24-hour expiration and 30-minute idle timeout; CSRF uses
  a double-submit cookie with rotating tokens.
- **Guest accounts** — lightweight accounts for the post-wedding guestbook/gallery, with
  several concurrent sessions allowed per account.
- **Magic-link recovery** — single-use, hashed recovery tokens let a guest re-establish
  access by email.

Rate limiting is SQLite-backed and per-IP, applied to every public endpoint. Behind a
reverse proxy, the client IP is recovered from `X-Forwarded-For` only for trusted peers —
RFC-1918 private ranges (integer octet math, no regex) plus any explicitly configured
proxies.

## Full type safety without TypeScript compilation

This is the part most worth stealing. Every source file is plain JavaScript, yet the whole
project is type-checked under TypeScript's `strict` mode. The trick is **`checkJs`**:
`tsconfig.json` sets `checkJs: true`, `strict: true`, `noEmit: true`, and types are supplied
via **JSDoc annotations**.

- Each layer (`core/`, `db/`, `api/`, `services/`, and the frontend under `public/`) has its
  own `types.d.ts` declaring that layer's interfaces and function signatures.
- Implementations reference those declarations: a module opens with
  `/** @import * as Types from './types.js' */`, and each exported function is annotated
  `/** @type {Types.functionName} */` — the parameter and return types are inferred from the
  single declaration, so signatures never drift between declaration and code.
- Shared entity types (Guest, RSVP, Media, …) live in one root `types.d.ts` imported by both
  backend and frontend, preventing type divergence across the stack.

The result: full editor autocomplete, refactoring safety, and `strictNullChecks` correctness
— with no compile step, no emitted output, and no runtime cost. `npm run typecheck` validates
both the server and `public/` configs.

## Testing

Tests use the built-in `node --test` runner. Unit tests cover `core/`, `db/`, and
`services/` helpers directly; integration tests start a real server on a separate port with
its own test database and exercise endpoints end to end. No test framework dependency.

## Operability

- `GET /api/health` reports status plus a free-disk gauge for the uploads volume.
- `npm run doctor` is a preflight config check: it diffs `.env` against `.env.example` and
  the set of variables the code actually reads, verifies production-required settings, warns
  on placeholder values, and checks upload disk headroom — exiting non-zero on any hard
  failure.
- `npm run export` produces a self-contained archive (JSON + CSV + a hardlinked media tree)
  for eventually sunsetting the live site into a static keepsake.
