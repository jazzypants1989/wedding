# Phase 7 — Integration, Polish & Launch

**Goal**: make the features discoverable (nav + landing section), final QA across themes/motion/a11y/perf, docs and CLAUDE.md updates, deployment ops checklist walked. This is the launch gate.

**Prerequisites**: Phases 1–6 complete and deployed dark (URL-reachable, unlinked). **Read first**: `00-overview.md`, `03-media-pipeline.md` §8 (ops checklist),
`public/pages/index.html`, `public/pages/rsvp/index.html`, `public/pages/countdown.js` (or wherever countdown copy lives), `CLAUDE.md`, `DEFERRED.md`.

## 1. Navigation edits (exact file/block list)

Insert `Guestbook → /guestbook` and `Gallery → /gallery` before "RSVP". Every nav
list uses `<ul class="nav-list">` with `<a class="nav-link">` items; the current
page marks its own link `nav-link-active` (see the desktop "Home" link in
`index.html`).

| File | Blocks |
|---|---|
| `public/pages/index.html` | `#mobile-nav` list (`nav.mobile-nav`), `.desktop-nav` list, `.footer-nav` list (3 places, all present) |
| `public/pages/rsvp/index.html` | mobile + desktop + footer lists (all three present — footer-nav confirmed) |
| `public/pages/guestbook/index.html` | **ADD** the two links AND set Guestbook's own to `nav-link-active`. This did NOT ship in Phase 2 — the page's nav currently has only Home/Schedule/Dress Code/Registry/RSVP and no active state. Not a "verify". |
| `public/pages/gallery/index.html` | **ADD** the same, self-active on Gallery. Also missing from Phase 4 — ADD work, not verify. |
| `public/pages/admin/index.html` | none (optionally links next to "View Site" — skip unless trivial) |

`public/pages/demo/`, `public/pages/studio/`, `public/_demo/` are dev-only — untouched.

## 2. Landing page touchpoint (minimal, per the owner's add-alongside decision)

One short section after `#registry`:

```html
<section id="memories" class="content-section text-center">
  <h2>Memories</h2>
  <p>The big day has come and gone — relive it with us!</p>
  <p>
    <a href="/gallery" class="btn btn-primary">See the photos</a>
    <a href="/guestbook" class="btn btn-secondary">Sign our guestbook</a>
  </p>
</section>
```

No `#memories` anchor in nav lists (nav links go straight to the pages).

## 3. Small integrations

- **RSVP → auth-sheet prefill** (net-new — nothing exists today): the code currently flows only via the `?code=` URL param (`rsvp-form.js` reads `params.get("code")`), and `auth-sheet.js` `resetForm()` blanks `#auth-code`. Add `localStorage.setItem("rsvpCode", code)` when a valid code loads on the RSVP page, and have the auth sheet prefill `#auth-code` from `localStorage.getItem("rsvpCode")`. There is no `rsvpCode`/localStorage wiring to "hook up" — it's all new.
- **Countdown copy** (`public/pages/countdown.js`, imported by `public/pages/main.js`): the wedding date is hardcoded `2026-04-26`; once past, the code sets `innerHTML = "Today's the Day!"` + class `wedding-day` **permanently** (no past/"Married!" state), and that assignment overwrites the `#exact-time` span. Add a genuine post-wedding line (e.g. "We're married! 💍 / Relive the day below") and preserve `#exact-time` if it's still wanted — a small, self-contained change.
- **Effects tuning**: confirm confetti thresholds (first-post only), reaction sparkle intensity; consider a subtle entrance effect on the gallery (optional; must respect reduced motion).
- **404/error copy sweep** across the new pages (friendly, on-voice).

## 4. QA gate (all must pass)

- **Both themes**: guestbook, gallery grid, lightbox (stage stays near-black in light mode — by design), upload tray, auth sheet, admin tabs. Screenshot pass.
- **Reduced motion**: no confetti/sparkles/shimmer/swipe animations anywhere new.
- **Keyboard + screen reader**: auth sheet focus trap + return focus; lightbox full keyboard pass; reaction buttons announce pressed state; feed/grid landmarks sane; 44px touch targets throughout.
- **Mobile viewport walk**: hamburger nav on all pages includes new links; FAB doesn't collide with theme toggle; bottom sheet + drawer behaviors.
- **Perf**: Lighthouse on `/gallery` (thumb sizes, CLS ≈ 0 via explicit dims, LCP sane); re-verify the 2k-item scroll check on the production build.
- **Full test suite + `npx tsc --noEmit`** green.

## 5. Docs & repo hygiene

- **CLAUDE.md** (note: it is `.gitignore`d in this repo — edit it locally; it won't show in `git status`): its Project Structure documents **none** of the ~30 new files. Add `api/{comments,media,reactions,enrich}.js`, `core/{upload,sniff,media-serve,media-storage,media-sweep,mp4-meta}.js`, `db/{accounts,account-sessions,comments,reactions,media,moderation,targets,account-recovery}.js`, `services/moderation-notify.js`, `public/pages/{guestbook,gallery}/`, `public/components/*`, `docs/post-wedding/`; the new tables list; the new env vars (all three: `MEDIA_MIN_FREE_BYTES`, `MEDIA_MAX_TOTAL_BYTES`, `MEDIA_UNTRUSTED_QUOTA_BYTES` — defined via `envBytes()` in repo-root `types.js`, exposed as `MEDIA_STORAGE.*`); the `server.requestTimeout` 600s note; and **fix the stale `public/pages/effects/` path in two places (effects actually live in `public/effects/`)**.
- **DEFERRED.md**: the off-host media rsync is already documented (§2) — mark it implemented-or-still-deferred at launch. Add a note on quarantine-dir manual emptying: the daily sweep (`core/media-sweep.js`) moves DB-orphaned files to `data/uploads/quarantine/` (`QUARANTINE_DIR` in `core/media-storage.js`) and never auto-hard-deletes, so someone must empty it periodically. DEFERRED.md does not mention this yet.
- **`docs/post-wedding/00-overview.md`**: final decision-log update — record anything that deviated during implementation.
- **`.env.example`**: add the new optional vars.
- **Export archive** (sunset insurance — this site will retire someday): new `scripts/export-archive.js` (does not exist yet) producing a self-contained tree — guestbook entries + comments + reactions as JSON **and** CSV, account roster, and the `data/uploads/media/` tree copied/hardlinked alongside an `index.json` mapping file_keys → captions/authors/dates. Note: `core/csv.js` today only serializes guests/RSVPs (`guestsToCSV`, `rsvpsToCSV`, plus generic `escapeCSVField`) — you'll write new per-entity serializers on top of `escapeCSVField`, not call a ready-made helper. One command turns an eventual domain-renewal scramble into a folder the couple keeps. Smoke-run it as part of this phase's acceptance.

## 6. Deployment / ops (walk the Phase 3 §8 checklist in production)

1. Traefik entrypoint `readTimeout` ≥ 10m (or 0) — **the** silent upload killer.
2. No buffering middleware on the router.
3. VPS disk ≥50GB free; env caps set.
4. Off-host rsync cron installed and verified (run once by hand, check the remote).
5. `/api/health` shows free-disk bytes.
6. Post-deploy smoke test: register (seeded code), post a guestbook entry, upload one real photo **and one ~30MB video from a phone on cellular** (validates the whole timeout chain), react, comment, approve something from the admin queue, play the video on iOS Safari via `/media/:key/video` (validates Range/206 + the GPS-blanked `video` variant end-to-end — also spot-check the served bytes carry no `©xyz`/ISO6709 coordinates).

## 7. Launch

Announce to guests (the couple's channel — text/email blast with the two links). Watch the moderation queue + audit logs for the first 48h; notifications are digest-only (one ~daily email + the dashboard badge), so plan on checking the admin queue directly during the launch burst.

## Acceptance criteria

Everything in §4 and §6 checked off; nav visible on every page; a guest with only the URL of the homepage can find, view, sign, upload, react, and comment on both surfaces from a phone.
