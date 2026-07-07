# Phase 6 — Full Admin Moderation & Curation

**Goal**: grow the Phase 2 minimal tab into the complete moderation system (combined queue for all content types, filters, previews, bulk actions, account trust management) plus the curated-gallery manager (official uploads, reorder, captions, promote-to-official).

**Prerequisites**: Phases 2–5. **Read first**: `00-overview.md`,
`public/pages/admin/petitions.js` + `guests.js` (table/modal/pagination patterns), `public/pages/admin/moderation.js` (Phase 2 minimal version — expand in place), `public/pages/admin/{index.html,main.js,state.js,utils.js,admin.css}`, `api/admin/moderation.js` (Phase 2 version), `public/components/media-uploader.js` + `media-processing.js` (reused for admin uploads).

## 1. API (expand `api/admin/moderation.js`; new `api/admin/accounts.js`, `api/admin/media.js` — all `{ admin: true }` except the two public `/api/account/recover*` routes, which live in `api/account.js`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/moderation/queue?type=&status=&limit=&offset=` | Combined items across guestbook/media/comments (offset pagination, admin-list style). `type` filter optional. |
| GET | `/api/admin/moderation/counts` | `{ guestbook, media, comments, total }` pending — feeds the badge |
| POST | `/api/admin/moderation/:type/:id/approve` | pending\|hidden → approved (+`reviewed_at`) |
| POST | `/api/admin/moderation/:type/:id/reject` | pending → rejected |
| POST | `/api/admin/moderation/:type/:id/hide` | approved → hidden |
| POST | `/api/admin/moderation/bulk` | `{ action: "approve"\|"reject", items: [{type,id},…] }` in one transaction |
| GET | `/api/admin/accounts?trusted=&limit=&offset=` | Accounts + per-account content counts + source (household guest name via `guest_id` join, or "open registration") |
| POST | `/api/admin/accounts/:id/trust` | `trusted=1`; body `{ approve_pending?: boolean }` → bulk-approve their pending items across all three tables in one `withTransaction` |
| POST | `/api/admin/accounts/:id/untrust` | `trusted=0` (future content held; existing untouched) |
| DELETE | `/api/admin/accounts/:id` | Soft-delete account + delete its sessions + hide its approved content |
| — | (admin uploads) | No admin-specific upload routes: the Phase 3 `/api/media/*` session routes are `withAccountOrAdmin` (binding reconciliation 7), so the admin drives the exact same create/PUT/finalize flow via `adminFetch`, passing `section:'official'` at create; rows get `account_id: NULL` and finalize auto-approves |
| POST | `/api/admin/media/reorder` | `{ ids: number[] }` → `sort_order = array index`, one transaction |
| POST | `/api/admin/media/:id/promote` | **Move** a guest item into the official section (set `section='official'`, `sort_order = MAX(sort_order)+1` — appends at the end, same insertion behavior as admin-upload finalize). The item **leaves the guest feed** — this is a move, not a copy; label the button "Move to official" so the semantics are honest |
| POST | `/api/account/recover` | Public, rate-limited (share ACCOUNT_REGISTER's limiter shape): body `{ email }` → if an account with that `contact_email` exists, email a one-time re-login link (signed token via the existing `hashToken` pattern, 1h expiry, single use) through Resend. Always respond 200 (no account-existence oracle). `GET /api/account/recover/:token` → creates a session + sets guest cookies + redirects to `/guestbook`. Owner decision 2026-07-06 — this is the recovery path for untrusted accounts; the auth sheet gets a small "Lost access? Recover by email" link |
| PATCH | `/api/admin/media/:id` | `{ caption }` inline caption edit |
| DELETE | `/api/admin/media/:id` | Soft-delete any media |
| GET | `/media/:fileKey/original` | Already gated admin-only in Phase 3 — surface the download link in the detail modal here |

`:type` validated against a fixed allowlist (`guestbook|media|comment`) mapped to table names through a frozen object — never interpolated into SQL. Audit: `MODERATION_APPROVE/REJECT/HIDE/UNHIDE`, `ACCOUNT_TRUST/UNTRUST/DELETE`, `MEDIA_CREATE/DELETE/REORDER`, `ACCOUNT_RECOVER_REQUEST/ACCOUNT_RECOVER_LOGIN`.

Untrust/trust semantics: trust flips future inserts to auto-approve (the decision point reads `account.trusted` at insert time); `approve_pending` handles the backlog explicitly.

**Auto-trust on approval (owner decision 2026-07-06, default behavior)**: approving any item whose
author is untrusted promotes that account (`trusted=1`) as part of the same transaction — the queue
sees each stranger once, not every-item-forever. The approve confirm dialog names both effects
("Approve this item and trust Dana Smith — their future posts go live instantly"). Applies to
single approve and bulk approve. Admin can untrust afterward; reject does not touch trust.

**Files on terminal states (03 §6)**: reject unlinks the item's variant files (row kept for audit);
hide keeps files (reversible). Account soft-delete hides content but does not unlink (reversible
until the items are individually rejected/deleted).

## 2. Moderation tab (expand `public/pages/admin/moderation.js`)

- **Badge**: total pending, loaded at login next to `loadPetitionCount()`; refreshed after every action.
- **Sub-toggle pills** (manual-SMS Focus/List pattern): **Queue** | **Accounts**.
- **Queue view**: filters (type select, status select — pending default). Table: ☑ | Preview | Type | Author (+trusted/untrusted badge) | Submitted | Actions.
  - Preview cell: 56px thumb for media (from `/media/{key}/thumb`), truncated text for messages/comments. Click → **detail modal**: full text / `display` image / video playback, author info + relation + "Promote to trusted" + original-download link (media), Approve / Reject / Hide.
  - **Bulk**: header checkbox + "Approve selected" / "Reject selected" appearing when ≥1 checked (mostly a first-days affordance — auto-trust means repeat bursts from one person stop reaching the queue). No bulk hide.
  - Approve **auto-trusts** untrusted authors (§1) — the confirm dialog names the account and both effects. The detail modal additionally offers "Approve & release their other pending items" (bulk-approves the same author's backlog in the same transaction).
  - **Hide caveat (documented limitation)**: guest media is publicly cached for up to 24h (03 §7 Cache-Control split), so people who already viewed a now-hidden photo may keep seeing it from their browser cache for up to ~a day. Hide is removal from the site, not remote deletion from devices. Say so in the hide confirm dialog copy.
- **Accounts view**: table — Name | Source | Trusted (toggle btn) | Posts | Created. Trust confirm modal: "Their held content will go live and future posts skip review." Untrust mirror. Row action View → their content list (filter queue by account — pass `account_id` as an extra queue filter param; add it to the GET).

## 3. Gallery tab (new `public/pages/admin/gallery-admin.js`)

- Grid of official items (~120px thumbs): position number, **↑ / ↓ / "Move to top"** buttons (binding decision: no drag — zero-dep touch DnD is a session of risk; buttons are keyboard-accessible for free), inline caption input (Enter/blur saves via PATCH), Remove.
- Reorder: mutate the local array, re-render, debounce one `POST /api/admin/media/reorder` with the full ordered id list.
- **"Add official photos"**: `media-uploader.js` + `media-processing.js` in a `modal-lg` dialog with the same tray UI, targeting the admin upload session. (Admin is on desktop — HEIC-from-Chrome caveat applies; surface the failure copy from Phase 4.)
- "Promote to official" also reachable from the queue detail modal.

Wiring: two tab buttons + panels in `admin/index.html`, `init*()` + lazy-load branches in `main.js` `switchTab`, state arrays + getters in `state.js` (`currentModeration`, `currentAccounts`, `currentCurated`), CSS appended to `admin.css` (preview cell, curated grid, tray-in-modal).

## 4. Tests

Integration:
- Queue returns all three types interleaved; type/status/account filters work; counts match.
- Approve/reject/hide state machine: illegal transitions rejected (e.g. reject on approved → 400).
- Bulk approve 20 mixed items in one call → all approved, one audit entry per item (or one bulk entry — pick and document).
- Trust with `approve_pending` → account trusted AND their pending items across all tables approved atomically.
- Approve an untrusted author's item → item approved AND account now trusted; their next post auto-approves. Reject → trust untouched.
- Reject a media item → variant files unlinked, row kept.
- Untrust → subsequent post by that account is pending.
- Account soft-delete → sessions dead (401), approved content hidden.
- Reorder: post shuffled ids → official list order matches; missing/foreign ids → 400.
- Promote → item appears in official listing at the end AND no longer appears in the guest feed (move semantics).
- Admin media upload session end-to-end (the Phase 3 routes via `adminFetch` — dual-auth per reconciliation 7): create with `section:'official'` → PUT → finalize auto-approves with `account_id NULL`.
- Recovery: request with a known `contact_email` → link token works once, creates a session; unknown email → same 200; expired/reused token → 4xx.

Manual demo: seed a burst of 10 untrusted uploads + 3 messages; triage everything from the queue in under a minute (bulk approve 8, reject 2, approve&trust the message author); reorder officials and reload to confirm persistence.

## 5. Acceptance criteria

- Every content type reachable and actionable in ≤2 clicks from the queue.
- Badge counts correct after each action without a page reload.
- All tests + tsc green; existing admin tests untouched and green.
