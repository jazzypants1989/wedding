# Post-Wedding Features: Architecture Overview

This directory specs two post-wedding features: a **guestbook** and a **media gallery** (photos + short videos), both with comments and emoji reactions. Each numbered spec (`01`–`07`) is a self-contained phase sized for one focused agent session. Read this overview first, then only the spec for your phase.

## Product requirements (decided by the owner — do not relitigate)

- **Viewing is public** (anyone with the URL). **Posting/uploading/commenting/reacting requires a guest account.**
- **Accounts are passwordless** with long-lived sessions (~months). Two registration paths:
  - Invite code + your own name → **trusted** account bound to the household guest record. Multiple family members can each register their own account against one household code.
  - Open registration form (name, optional relation/contact, no code) → instant **untrusted** account.
- **Hybrid moderation**: trusted content goes live instantly; untrusted content is held `pending` until the admin approves. **Approving an untrusted account's item auto-promotes the account to trusted** (owner decision 2026-07-06; the confirm dialog names all effects, and the admin can untrust). Admin can also `hide` previously-live content. Soft-delete (`deleted_at`) everywhere, matching the existing `guests.deleted_at` pattern.
- **Admin notifications**: digest-only (owner decision 2026-07-06, superseding the earlier immediate+digest design) — one ~daily email of outstanding pending items via the existing Resend service, plus the dashboard badge. No immediate-email path, no cooldown machinery.
- **Account recovery**: untrusted accounts that provided a contact email can request a magic-link re-login email (owner decision 2026-07-06). Phase 1 stores `contact_email`; Phase 6 ships the endpoints. Untrusted accounts without a contact email remain unrecoverable (accepted).
- **Gallery** has two sections: `official` (admin-curated, explicitly ordered) and `guest` (guest uploads, newest-first). Design scale: **thousands of items**. **Full-resolution originals are kept** but never served publicly (EXIF/GPS privacy). Video supported: ≤60s / ≤100MB, client-extracted poster frame.
- **Reactions**: fixed set ❤️ 👏 😂 😍 🥂 🔥, stored as stable keys `heart|clap|laugh|heart_eyes|cheers|fire`. One per emoji per account per item, toggleable. Comments + reactions apply to BOTH guestbook entries and media.
- **Site integration**: `/guestbook` and `/gallery` added alongside the existing site. Nav links + a small landing-page "Memories" section land in Phase 7 (soft launch by URL before that).

## Hard constraints (from CLAUDE.md — non-negotiable)

- **Zero npm dependencies.** Node 22+ builtins only (`node:sqlite`, `node:crypto`, `node:fs`, `node:stream`, …).
- **No regex anywhere.** String methods, `charCodeAt` range checks, `Buffer.indexOf`/`subarray` only.
- ESM with `.js` extensions; JSDoc types checked by `npx tsc --noEmit` (strict checkJs); per-directory `types.d.ts`; `/** @type {Types.fnName} */` annotation pattern; never `any` or `ts-ignore`.
- Reuse existing patterns exactly: declarative router (`core/router.js`), `sql`` ` tagged templates (`db/sql.js`), `createTables`/`runMigrations` (`db/schema.js`), `withAdmin`-style middleware (`core/auth.js`), SQLite rate limiting (`core/rate-limit.js`), `ValidationResult<T>` (`core/validation.js`), JSONL audit log (`core/utils.js`), `html`` ` templating + helpers (`public/pages/utils.js`), admin tab/modal patterns (`public/pages/admin/petitions.js` is the canonical clone source).
- All persistent data under `/app/data` (the `wedding-data` Docker volume).

## Architecture at a glance

```
New tables:      accounts, account_sessions, guestbook_entries, media,
                 comments (polymorphic), reactions (polymorphic), app_state (KV)
New middleware:  withAccount() — guest analog of withAdmin(); cookies guest_session/guest_csrf
New API:         /api/account/*, /api/guestbook*, /api/media* (list + upload session),
                 /api/comments, /api/reactions/toggle, /api/admin/{moderation,accounts,media}*
New serving:     GET /media/:fileKey/:variant — dynamic file server with Range support,
                 dispatched in server.js BEFORE serveStatic (bypasses static.js's boot snapshot)
New pages:       public/pages/guestbook/, public/pages/gallery/
New components:  public/components/{guest-session,auth-sheet,reaction-bar,comment-thread,
                 relative-time,celebrate,media-uploader,media-processing}.js
New services:    services/moderation-notify.js
Storage:         data/uploads/media/{key[0:2]}/{key}/{variant}.{ext} + data/uploads/tmp/
```

## Binding cross-slice reconciliations

These resolve conflicts between the three original design slices. **Do not deviate without updating every spec that references them.**

1. **Media identity**: `media.id` is INTEGER AUTOINCREMENT PK (so polymorphic `comments.target_id`/`reactions.target_id` stay INTEGER), plus `file_key TEXT UNIQUE NOT NULL` — 32 lowercase hex from `crypto.randomBytes(16).toString("hex")` — used for storage paths and public URLs `/media/:fileKey/:variant`.
2. **Status enums**: media: `uploading | pending | approved | hidden | rejected`. Guestbook entries + comments: `pending | approved | hidden | rejected`. Separate `deleted_at` soft-delete on all content; **feeds filter both** (`status = 'approved' AND deleted_at IS NULL`).
3. **Canonical account API**: `POST /api/account/register` (body `{ code?, name, relation? }`; with code = trusted claim OR re-login; without = untrusted), `POST /api/account/logout`, `GET /api/account/me`. (Any references to `/api/guest/claim` etc. in older drafts are superseded.)
4. **Reactions API**: single `POST /api/reactions/toggle` `{ target_type, target_id, emoji }` → `{ active, counts }`. Server speaks emoji **keys**; the frontend maps key→glyph via a constant.
5. **Cookies**: guest = `guest_session` / `guest_csrf`, **SameSite=Lax** (guests arrive via links in texts/emails; Strict would drop the cookie on cross-site navigation and make every visit look logged-out). Admin keeps `session` / `csrf` (Strict). Same `X-CSRF-Token` header and `validateCsrf()` timing-safe comparison for both. `public/pages/utils.js api()` gains a `csrfCookie` option (default `"csrf"`) so guest pages send the guest token; admin wrapper keeps sending the admin one.
6. **No absolute paths in the DB**: media rows store `original_ext` + per-variant byte sizes + `needs_display`; filesystem paths are derived server-side from `file_key` + variant + ext.
7. **Admin upload auth**: the Phase 3 upload-session routes are wrapped with `withAccountOrAdmin()` (defined in Phase 3), not plain `withAccount()`. An admin session (`session` cookie) satisfies them with `account_id = NULL` rows; ownership checks are `row.account_id === principal.accountId` OR admin. (`withAccountOrAdmin` hands handlers a normalized `principal { isAdmin, accountId, trusted }` — the guest session object exposes `account_id`, never a bare `.id`; guest cookie takes precedence over admin when both are present.) Phase 6's admin upload reuses these exact routes via `adminFetch` — no mirror routes.
8. **Upload-session integrity**: variant PUTs and finalize require `status = 'uploading'` (else 409) — re-PUT idempotency spans only the upload window, so approved content can never be silently replaced. Finalize is idempotent: re-finalizing a finalized row is a no-op 200 returning current status (client retry safety).
9. **Public video variant**: video items expose a public `video` variant — the original file with GPS metadata (`©xyz` + mdta `location.ISO6709`) blanked in place at finalize — always served with `Content-Type: video/mp4`. Prototype-validated; see `review-adjudication.md`.

## Decision log (what was chosen and why)

| Decision | Choice | Why |
|---|---|---|
| Upload protocol | Raw binary PUT per variant, grouped by upload session (POST create → PUT variants → POST finalize) | A hand-rolled no-regex streaming multipart parser is the single most bug-prone component possible; raw bodies need zero parsing, give per-variant retry/progress, and are idempotent. Base64 JSON rejected outright (+33% size, full buffering). |
| Originals privacy | Never served publicly; admin-only download | Phone originals carry EXIF GPS of guests' homes. Display/thumb/poster are canvas re-encodes → EXIF stripped automatically. Also cuts public bandwidth ~16×. |
| Guest sessions | New `account_sessions` table, NOT the admin `sessions` table | `createSession()` deletes all rows (single-admin design); guests need N concurrent sessions across devices. |
| Guest cookie SameSite | Lax (admin stays Strict) | See reconciliation 5. CSRF double-submit still enforced on all mutations. |
| Comments/reactions shape | Single polymorphic tables (`target_type` + `target_id`) with BEFORE INSERT existence triggers | Two tables doubles routes/queries/types/moderation paths. SQLite can't do polymorphic FKs; triggers give equivalent protection; handlers pre-check with SELECT so triggers are backstop only. |
| Public feed pagination | Keyset (`?before=<id>&limit=`) on `id DESC`; admin lists stay offset | Thousands of rows with live inserts: offset pages drift and duplicate. AUTOINCREMENT ids are insertion-ordered. |
| Gallery virtualization | CSS `content-visibility: auto` on 100-item batch sections + lazy images; no JS windowing | Zero-dep, scroll-anchor-stable, tested pattern; JS batch-recycling fallback spec'd but deferred until profiling demands it. |
| Curated reorder | Up/down + move-to-top buttons, not drag | Zero-dep touch drag-and-drop with a11y is a full session of risk; buttons are keyboard-accessible for free at curated-list scale. |
| Reaction storage | Emoji keys (`heart`…), UNIQUE(account, target, emoji), toggle = INSERT ON CONFLICT DO NOTHING else DELETE | Stable keys survive encoding issues; the toggle is atomic without a transaction. |
| Notification throttle state | New generic `app_state` KV table | Cooldown/digest timestamps must survive restarts; smallest DB-native home. |
| Re-login | Same invite code + same normalized name → same account | Passwordless recovery for trusted users; enabled by partial unique index on `(guest_id, name_normalized)`. |
| Timeouts | `server.requestTimeout` 30s → 600s globally; parseBody keeps its own 30s/1MB; uploads add idle (30s) + absolute (10min) timers | Node has no per-route requestTimeout override; 100MB on a slow uplink takes minutes. Every non-upload body path keeps tight limits. |
| Public video bytes | `video` variant = original with GPS atoms blanked in place at finalize; served as `video/mp4` | Videos have no client re-encode, so the original is the only content; in-place blanking (spaces over the `©xyz` and mdta ISO6709 values) preserves every offset — no re-mux. `video/mp4` because Chromium won't play `video/quicktime`. Prototype-validated (`review-adjudication.md`). |
| Registration code lookup | `COLLATE NOCASE` | Codes are mixed-case but hand-typed on phones (auth sheet auto-capitalizes); zero case-folded collisions verified, 62⁸ space keeps it that way. RSVP's link-driven lookup stays BINARY. |
| Guest-media caching | `max-age=86400` + ETag/304 for guest-section variants; `immutable` 1yr for official only | A hidden photo must actually disappear for prior viewers within ~a day; revalidation traffic at this scale is nil. |
| Moderation notifications | Digest-only | Owner decision: the couple checks the site daily; one email path, one `app_state` key, no cooldown corners. |
| Trust lifecycle | Auto-trust on first approval; magic-link recovery via optional `contact_email` | Queue sees each stranger once instead of every-item-forever; recovery fixes cleared-cookie orphaning with ~30 lines on the existing hashToken + Resend patterns. |
| Register response codes | 201 on account creation (both paths), 200 on re-login (`returning: true`) | Unambiguous for clients and tests. |

## Glossary

- **trusted / untrusted**: account flag. Trusted = registered with a valid invite code (or promoted by admin). Trusted content skips moderation.
- **held / pending**: content awaiting admin approval. Visible only to its author (flagged `is_own`) and admins.
- **hidden**: previously-approved content pulled by the admin (reversible). **rejected**: pending content declined (never went live). Both distinct from `deleted_at` (author self-delete or hard admin removal).
- **official / guest sections**: gallery split. Official = admin-curated, ordered by `sort_order`. Guest = uploads, newest-first.
- **variants**: files per media item — `original` (private), `display` (≤2000px public), `thumb` (≤400px public), `poster` (video frame, public), `video` (video items only: the original's bytes after in-place GPS blanking, public, served as `video/mp4` — no separate file on disk).
- **file_key**: 32-hex server-generated id used in storage paths and `/media/` URLs.
- **upload session**: the create→PUT-variants→finalize lifecycle of one media item; row status `uploading` until finalized.

## Phase index & dependencies

| Phase | Spec | Depends on | Ships |
|---|---|---|---|
| 1 | `01-accounts.md` | — | Accounts, guest sessions, withAccount, /api/account/* (API only) |
| 2 | `02-guestbook.md` | 1 | /guestbook end-to-end + auth sheet + minimal moderation tab + notify service |
| 3 | `03-media-pipeline.md` | 1 (parallel with 2) | Upload session endpoints, storage, /media serving with Range, client processing module |
| 4 | `04-gallery.md` | 1, 3 (+auth sheet from 2) | /gallery grid + lightbox + upload tray |
| 5 | `05-comments-reactions.md` | 2, 4 | Comments + reactions APIs + shared UI on both surfaces |
| 6 | `06-admin-moderation.md` | 2–5 | Full moderation queue, accounts view, curated gallery manager |
| 7 | `07-launch-polish.md` | all | Nav, landing section, QA, CLAUDE.md update, launch |

## Baseline definition-of-done for EVERY phase

1. `npm test` green (existing + new tests; integration server runs on port 3001 with a temp DB — see `tests/helpers.js`).
2. `npx tsc --noEmit` clean.
3. No regex, no new npm dependencies, no `any`/`ts-ignore`.
4. The phase's manual demo performed and its acceptance criteria checked off.
5. New entity types added to root `types.d.ts` + runtime constants/guards to `types.js`; layer types to the right per-directory `types.d.ts`.
6. Audit actions logged for every state-changing operation (see each spec's list).
