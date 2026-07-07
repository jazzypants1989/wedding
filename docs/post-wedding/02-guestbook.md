# Phase 2 — Guestbook End-to-End

**Goal**: `/guestbook` fully working: entries API with hybrid moderation, the page (feed, composer, pagination, pending states), the shared auth sheet + guest session components, extracted celebration helpers, a **minimal guestbook-only moderation tab** in the admin dashboard, and the moderation notification service. Page is reachable by URL only (nav lands in Phase 7 — deliberate soft launch).

**Prerequisites**: Phase 1 (accounts, `withAccount`, `getOptionalAccount`, test factories). **Read first**: `00-overview.md`,
`api/rsvp.js` + `api/lookup.js` (public endpoint anatomy), `api/admin/petitions.js` + `public/pages/admin/petitions.js` (the admin tab/badge/modal pattern to clone), `public/pages/rsvp/index.html` (page head/nav template; note the three shared stylesheet links must be byte-identical — `core/static.js` inlines them at serve time), `public/pages/utils.js` (`api()`, `html`` `, DOM helpers), `public/pages/rsvp/utils.js` (`fireConfetti`, `setButtonLoading` — to extract), `public/pages/rsvp/rsvp-form.js` (`miniSparkle` — to extract), `public/styles/tokens.css` + `components.css`, `services/email.js` + `services/templates.js`, `server.js` (hourly tick).

## 1. Schema (add to `createTables()`; triggers via `runMigrations` entry `add_guestbook_triggers`)

```sql
CREATE TABLE IF NOT EXISTS guestbook_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending|approved|hidden|rejected
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  deleted_at TEXT DEFAULT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
-- Serves admin/status-filtered lists. The public feed's OR-disjunction (approved OR own-pending)
-- makes SQLite prefer the PK scan — fine for keyset id DESC at this scale; don't expect this
-- index to appear in that EXPLAIN QUERY PLAN.
CREATE INDEX IF NOT EXISTS idx_guestbook_feed
  ON guestbook_entries(status, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guestbook_account ON guestbook_entries(account_id);
```

Triggers: status-enum BEFORE INSERT/UPDATE pair (clone `check_petition_status_*`), `auto_updated_at_guestbook_entries`.

Constants: `CONTENT_STATUS` frozen object + `_VALUES` + `isContentStatus` guard in `types.js`; `LIMITS.GUESTBOOK_MESSAGE_MAX_LENGTH: 2000`; `RATE_LIMITS.GUESTBOOK_POST: { windowMs: 60*60*1000, max: 10 }` (keyed `"acct:" + account_id`) and `CONTENT_DELETE: { windowMs: 60*60*1000, max: 30 }`.

## 2. API (new `api/guestbook.js`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/guestbook?before=&limit=` | public + `getOptionalAccount` | Keyset pagination, `id DESC`, default limit 20 (clamp ≤50) |
| POST | `/api/guestbook` | `{ account: true }` | rate-limited GUESTBOOK_POST |
| DELETE | `/api/guestbook/:id` | `{ account: true }` | own entries only; soft-delete |

GET returns approved entries **plus the caller's own pending ones** interleaved:

```sql
WHERE deleted_at IS NULL AND (status = 'approved' OR (status = 'pending' AND account_id = ${callerId}))
  AND (${before} IS NULL OR id < ${before})
ORDER BY id DESC LIMIT ${limit}
```

Response shape:

```json
{ "entries": [ { "id": 183, "message": "...", "author_name": "Aunt Carol", "author_trusted": true,
    "status": "approved", "created_at": "...", "is_own": false } ],
  "nextCursor": 164 }
```

`nextCursor` = last row's id, `null` when the page comes back short. (Reactions/comment counts join this response in Phase 5.)

POST: validate message via `validateRequiredString(…, LIMITS.GUESTBOOK_MESSAGE_MAX_LENGTH)`; `status = account.trusted ? 'approved' : 'pending'` (the single hybrid-moderation decision point); audit `GUESTBOOK_CREATE`; respond `201 { entry, status }`. (No notification call — the digest service (§3) discovers pending items on its own schedule.)

DELETE: verify `account_id` matches; rate-limited `CONTENT_DELETE` (account-keyed); set `deleted_at`; audit `GUESTBOOK_DELETE`.

Public GETs get a generous per-IP limiter (e.g. `PUBLIC_READ: { windowMs: 60*1000, max: 120 }` shared across the new public list endpoints) — every existing public endpoint is rate-limited; don't leave the new ones as the unexplained exception.

Admin (minimal, expanded in Phase 6 — put in new `api/admin/moderation.js` so Phase 6 grows it in place):
- `GET /api/admin/moderation/queue?type=guestbook&limit=&offset=` (offset pagination like other admin lists)
- `GET /api/admin/moderation/counts` → `{ guestbook, media: 0, comments: 0, total }`
- `POST /api/admin/moderation/guestbook/:id/approve` | `/reject` | `/hide` (approve: pending|hidden→approved + `reviewed_at`; reject: pending→rejected; hide: approved→hidden). Validate `:type` against a fixed allowlist mapping to table names — **never interpolate the param into SQL**; branch per table or use `sql.identifier` from a fixed object.
- Audit `MODERATION_APPROVE/REJECT/HIDE`.

## 3. Notification service (new `services/moderation-notify.js`) — digest-only

**Owner decision 2026-07-06 (see `00-overview.md` + `review-adjudication.md`): digest-only.** There is
no immediate-email path, no cooldown, and content endpoints (guestbook POST, media finalize, comment
POST) never call this service — which is also what makes Phase 3 genuinely parallelizable with this
phase. The dashboard badge (§7) is the fast signal; this email is the backstop.

State in one `app_state` key `moderation_last_digest_at` (get/set helpers in `db/utils.js`). Constant in `types.js`:

```js
export const MODERATION_NOTIFY = Object.freeze({
  DIGEST_INTERVAL_MS: 22 * 60 * 60 * 1000,   // ~daily, tolerant of hourly-tick drift
})
```

- `maybeSendModerationDigest()`: called from the **existing hourly `setInterval` in `server.js`** (no new timer). Sends only if `emailService.isConfigured()` AND pending count > 0 AND >22h since last digest. Set the state timestamp **before** sending (a failed send retries next-day, not next-hour — deliberate; the badge is the fallback). Subject: `"Wedding site: N items awaiting review"`; body: counts per type + oldest-item age + link to `${SERVER.baseUrl}/admin`. Audit `MODERATION_EMAIL_SENT`.
- Counts query must tolerate the `media`/`comments` tables not existing yet (Phases 3/5) — guard with a `sqlite_master` check or count only tables that exist; this phase ships guestbook-only counts.
- Templates alongside `getDefaultInviteEmail` in `services/email.js`/`templates.js`, same escapeHtml styling.

## 4. Shared frontend components (new files in `public/components/`, types in `public/components/types.d.ts`)

- **`guest-session.js`**: module-level mutable `session = { account: null }`, `loadSession()` (GET `/api/account/me` at page init), `requireAccount(action)` — runs action if signed in, else stashes it and opens the auth sheet; **the stashed action replays after successful sign-in** (a guest who tapped a button sees it land without re-tapping).
- **`auth-sheet.js`**: one `<dialog id="auth-sheet">` whose markup is injected by `initAuthSheet()` (pages don't duplicate 60 lines of HTML). Two panels:
  - *Panel 1 (default)*: heading "Who's celebrating?"; invite-code input (`autocapitalize="characters"`, maxlength 8) + required "Your name" input + Continue. The auto-capitalization is safe because registration's code lookup is `COLLATE NOCASE` (01 §6) — hand-typed case never matters. Helper copy: "Invite codes are per household — enter your own name so we know which of you is writing." Divider → "I don't have a code" → Panel 2.
  - *Panel 2*: name (required) + optional relation; notice (alert-warning, softened): "Since we can't match you to the guest list, your posts will appear after Jordana & Jesse approve them." Back link.
  - Both submit to `POST /api/account/register` (Panel 1 sends `code`). On `returning: true` show a brief "Welcome back, {name}!" state before closing.
  - Error states: unknown code → inline error "We couldn't find that code — check your invitation text or email" + `aria-invalid` + shake class; 429 → sheet-level alert + submit disabled 60s with countdown; network → alert, form stays filled, `setButtonLoading` reset.
  - Success: `closeModal` (focus returns to trigger), `miniSparkle` on the trigger, replay `pendingAction`.
  - Mobile: bottom-sheet styling (`margin: auto auto 0; width: 100%; border-radius: lg lg 0 0` under 768px).
- **`relative-time.js`**: `formatRelative(iso)` via `Intl.RelativeTimeFormat` (no regex) + `upgradeTimes(root)` for `<time datetime>` elements (title = absolute date via existing `formatDate`).
- **`celebrate.js`**: extract `fireConfetti` from `public/pages/rsvp/utils.js` and `miniSparkle` from `public/pages/rsvp/rsvp-form.js`; rsvp modules re-import from here (keep exports re-exported from their old homes if simpler — but prefer direct import updates). Move `.confetti-piece`/`.mini-sparkle`/`form-error-shake` CSS to a shared sheet (see §6).
- **`api()` change** (`public/pages/utils.js`): add `csrfCookie` option (default `"csrf"`); guest pages call with `csrfCookie: "guest_csrf"`. Admin path untouched.

## 5. Page (`public/pages/guestbook/`)

Files: `index.html`, `main.js` (nav/theme/session bootstrap/init), `feed.js`, `guestbook.css`, `types.d.ts`.

`index.html`: copy head + hero-small + nav blocks from `rsvp/index.html`; the three shared stylesheet `<link>`s byte-identical (serve-time inlining depends on it); `<script src="/components/theme-init.js"></script>` exactly; then `/styles/social.css` + `/pages/guestbook/guestbook.css` links; `<noscript>` warning; module entry `/pages/guestbook/main.js`.

Layout (mobile-first, `--container-content` column):
- Title + one-line invitation ("Leave us a note — we read every one 💗").
- **Composer card on top**: textarea + "Sign the guestbook" button. Not disabled when signed out — focusing/submitting triggers `requireAccount` (browse freely; gate only at write).
- **Feed**: newest-first `article.gb-entry` cards — author name (display font), `<time>` relative, message (`white-space: pre-line`, rendered through `html`` ` so it's escaped), footer placeholder for the Phase 5 reaction bar/comments.
- **Own pending entries**: rendered in place with reduced-opacity left border + `status-badge status-pending` chip "Awaiting approval — only you can see this". After an untrusted post, show a one-time dismissible note under the composer: "Thanks! Jordana & Jesse approve messages from new folks — yours will appear for everyone soon."
- **Pagination**: keyset "Load more" button that doubles as an IntersectionObserver sentinel (`rootMargin: "600px"`); auto-load stops after 5 automatic fetches until the user clicks once (keeps the footer reachable).
- Empty state: "No messages yet. Be the first to sign!" CTA focuses the composer. Errors: `alert alert-error` + retry.
- **Celebration**: `fireConfetti()` on the poster's first-ever entry (`localStorage.gbCelebrated` guard); `miniSparkle` on subsequent posts. Both already no-op under `prefers-reduced-motion`.
- Optimistic post: on 201, prepend the card locally (pending chip if held).

## 6. CSS

New `public/styles/social.css` (linked, **not** inlined — only the three canonical sheets get inlined): auth sheet, entry cards, pending chip, composer; plus relocated confetti/sparkle/shake rules. New `pages/guestbook/guestbook.css` for page-specific bits. Reuse `.card`, `.btn*`, `dialog` styles, `.alert*`, `.status-badge status-pending`, `.empty-state`. 44px touch targets.

## 7. Admin: minimal Moderation tab

Clone `petitions.js` wholesale into `public/pages/admin/moderation.js`: new `[role=tab]` button "Moderation" + `tab-moderation` panel in `admin/index.html`, badge `moderation-badge` fed by `/api/admin/moderation/counts` at login (next to `loadPetitionCount()`), lazy load on tab switch, table (Author | Message preview | Submitted | Actions Approve/Reject), confirm modals, `state.js` additions. Guestbook-only in this phase; Phase 6 expands it in place.

## 8. Tests

Integration (`tests/integration/guestbook.test.js`):
- Trusted account POST → 201 approved → visible in anonymous GET immediately.
- Untrusted POST → 201 pending → absent from anonymous GET; present flagged `is_own`+`pending` in the author's authed GET; present in admin queue.
- Approve → appears publicly; reject → gone from author's feed; hide (on approved) → gone publicly.
- POST without CSRF header → 403 (this is the deferred Phase 1 CSRF integration test).
- Keyset pagination: seed 45 entries, walk 3 pages, no duplicates/gaps, `nextCursor` null at end.
- Rate limit: 11th post in an hour from one account → 429.
- DELETE own → gone; DELETE someone else's → 403/404.

Unit: digest logic (seed `app_state`, mock email service via the existing `createEmailService(mockHttpClient)` pattern — no send when pending count is 0; no send when <22h since last digest; send + timestamp update when both conditions hold; timestamp set even when the send fails); message validation bounds.

## 9. Acceptance criteria / demo

- Two browsers side-by-side: one registers with a seeded invite code (trusted — post appears instantly with confetti), one via open registration (post held, pending chip visible to author only). Admin approves from the new tab; entry appears for everyone. Reduced-motion OS setting kills confetti/sparkles.
- All tests + tsc green. `/guestbook` renders correctly in both themes.
