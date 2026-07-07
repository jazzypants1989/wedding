# Phase 7 — Integration, Polish & Launch

**Goal**: make the features discoverable (nav + landing section), final QA across themes/motion/a11y/perf, docs and CLAUDE.md updates, deployment ops checklist walked. This is the launch gate.

**Prerequisites**: Phases 1–6 complete and deployed dark (URL-reachable, unlinked). **Read first**: `00-overview.md`, `03-media-pipeline.md` §8 (ops checklist),
`public/pages/index.html`, `public/pages/rsvp/index.html`, `public/pages/countdown.js` (or wherever countdown copy lives), `CLAUDE.md`, `DEFERRED.md`.

## 1. Navigation edits (exact file/block list)

Insert `Guestbook → /guestbook` and `Gallery → /gallery` before "RSVP":

| File | Blocks |
|---|---|
| `public/pages/index.html` | `#mobile-nav` list, `.desktop-nav` list, `.footer-nav` list (3 places) |
| `public/pages/rsvp/index.html` | mobile + desktop lists (check footer-nav presence at edit time) |
| `public/pages/guestbook/index.html` | verify self-active state (`nav-link-active`) shipped in Phase 2 |
| `public/pages/gallery/index.html` | same, from Phase 4 |
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

- **RSVP → auth-sheet prefill**: on the RSVP page, when a valid code loads, `localStorage.setItem("rsvpCode", code)`; the auth sheet (Phase 2) prefills its code field from it.
- **Countdown copy**: verify post-wedding rendering (past-date state); adjust copy if it reads oddly ("Married!"-style line) — one-line change.
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

- **CLAUDE.md**: update Project Structure (new `api/` files, `core/{upload,sniff,media-serve}.js`, `db/{accounts,account-sessions}.js`, `services/moderation-notify.js`, `public/pages/{guestbook,gallery}/`, `public/components/*`, `docs/post-wedding/`), new tables list, new env vars (`MEDIA_MIN_FREE_BYTES`, `MEDIA_MAX_TOTAL_BYTES`), the `requestTimeout` note, and **fix the stale `public/pages/effects/` path (effects actually live in `public/effects/`)**.
- **DEFERRED.md**: record the off-host media rsync cron as implemented-or-still-deferred; note quarantine-dir manual emptying.
- **`docs/post-wedding/00-overview.md`**: final decision-log update — record anything that deviated during implementation.
- **`.env.example`**: add the new optional vars.
- **Export archive** (sunset insurance — this site will retire someday): new `scripts/export-archive.js` producing a self-contained tree — guestbook entries + comments + reactions as JSON **and** CSV (reuse `core/csv.js`), account roster, and the `data/uploads/media/` tree copied/hardlinked alongside an `index.json` mapping file_keys → captions/authors/dates. One command turns an eventual domain-renewal scramble into a folder the couple keeps. Smoke-run it as part of this phase's acceptance.

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
