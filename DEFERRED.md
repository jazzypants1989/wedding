# Deferred Work

What's below is deferred deliberately — each item needs a production/deploy decision, off-repo access, an owner copy/branding call, or a larger product effort, not a quick code edit.

Severity tags: 🔴 high · 🟡 medium · 🟢 low.

---

## 2. Backup: off-host copy + longer retention 🟡

`scripts/backup-db.js` now writes a WAL-consistent `VACUUM INTO` snapshot, timestamped, pruned to the **last 5** — all inside the `wedding-data` volume (`docker-compose.yml`). That's a real point-in-time backup but **not disaster recovery**: lose the volume and you lose every copy. Still deferred:
- Copy a snapshot **off the VPS** (e.g. `scp`/object storage) as part of deploy, or a separate cron.
- Decide real retention (daily/weekly) beyond the rolling 5.
- **Media tree off-host copy (Phase 3):** uploads under `data/uploads/media/` are write-once, so a nightly `rsync -a --ignore-existing .../uploads/media/ backuphost:...` (plus the newest DB `*.backup` in the same cron) is the ideal backup. `--ignore-existing` makes VPS-side deletes non-propagating, which is correct for a backup. **Status at Phase 7 launch: still deferred** — this is a deploy-time cron on the VPS, no repo code required; install and verify it by hand (Phase 7 §6 item 4) as part of go-live. `scripts/export-archive.js` (added Phase 7) is the complementary *whole-archive* export for eventual site sunset, not the incremental nightly backup.

---

## 6. Phase 3 media pipeline — deploy checklist 🔴

Shipped in Phase 3 (media upload + `/media` serving). Items requiring a production/deploy decision, not repo code:

- **Traefik read timeout:** v3's `transport.respondingTimeouts.readTimeout` defaults to 60s and would kill slow (100MB) uploads at the proxy. Set it to `0` or `≥10m` on the https entrypoint. (`server.requestTimeout` was already raised to 600s in `server.js`.)
- **No buffering middleware** on the media router (would spool 100MB to proxy disk). Confirmed none in the current `docker-compose.yml` labels; re-check if middleware is added.
- **VPS free disk ≥ 50GB** (estimate ~30GB at full scale). Set in the VPS `.env`: `MEDIA_MIN_FREE_BYTES` (default 5GB), `MEDIA_MAX_TOTAL_BYTES` (default 45GB), `MEDIA_UNTRUSTED_QUOTA_BYTES` (default 250MB).
- **Health check** now reports `uploadsFreeBytes` (`GET /api/health`) — wire it into whatever monitors the box.

---

## 8. Quarantine directory needs periodic manual emptying 🟢

The daily media sweep (`core/media-sweep.js`) reconciles the DB against the disk and **moves DB-orphaned files** (a `file_key` with no live row — e.g. an abandoned upload whose row was pruned, or a hard-removed item's leftover bytes) into `data/uploads/quarantine/` (`QUARANTINE_DIR`, defined in `core/media-storage.js`). By design it **never auto-hard-deletes** — quarantine is a safety net, not a trash can that self-empties. Consequence: the directory grows unboundedly and someone must empty it periodically (inspect, then `rm -rf data/uploads/quarantine/*`) once satisfied nothing there is wanted. No code change needed; this is an ops reminder. Not urgent at wedding scale, but note it so quarantine doesn't silently consume the disk headroom that `MEDIA_MIN_FREE_BYTES` is guarding.

---

## 3. Two deploy paths, maintained separately 🟢

The CI inline script (`.github/workflows/deploy.yml`) and `scripts/deploy.js` duplicate the same backup→pull→`compose up`→health-poll logic; both now call `docker exec wedding node scripts/backup-db.js`, so they're in sync, but drift is possible. `scripts/deploy.js:9-10` hardcodes `jesse@jovial-penguin-1:2420` and `deploy.yml:38` hardcodes port `2420`. Consider collapsing to one path (CI calls `scripts/deploy.js`, or the SSH step runs a committed remote script). Re-confirmed still-open in the 2026-07 UX/DX pass.

---

## 4. `.env` completeness + secret rotation 🟡

Deploy-environment checks, not code changes — run `npm run doctor` for the current drift/gaps:

- **Fill the working/production `.env`:** it's missing keys `.env.example` documents and the code reads; SMS/email paths gate on the empty `TWILIO_PHONE_NUMBER`/`RESEND_API_KEY`/`FROM_EMAIL` (`services/twilio.js`, `services/email.js`). Keep `.env.example` as source of truth.
- **Rotate secrets 🔴 (if live):** the working `.env` holds real-looking plaintext Twilio SID + auth token and an admin password hash. Gitignored (never committed), but rotate the Twilio creds if real.

---

## 5. `__Host-` cookie prefix on guest cookies 🟢

The 2026-07-06 design review of `docs/post-wedding/` suggested `__Host-guest_session` to pin
`Path=/` + `Secure` at the browser level. Deferred: the prefix requires the `Secure` attribute,
which complicates plain-HTTP localhost development in some browsers, and production is already
HTTPS-only behind Traefik with `Path=/` set explicitly. Revisit only if the cookie surface grows.

---

## 9. Effects system — generalize into reusable themes 🟢

The visual effects (`public/effects/`) are a clean registry (`EFFECT_DEFINITIONS` + the
`EffectInstance` factory contract), but they're hardcoded to this wedding's "disco-mermaid"
identity — not reusable as-is for a portfolio where others won't want that specific look. Future
work: refactor into ~3 shippable **themes**, each bundling an appropriate effect set, with
mermaid-disco as one selectable theme rather than the baked-in default. De-personalize the
hardcoded touchpoints along the way: the `Jordana & Jesse` / "— Wedding" copy in
`public/pages/studio/index.html`; the `.couple-names` selector in `public/effects/name-shimmer.js`;
`EFFECT_PALETTE.brand` in `public/effects/config.js`; the "Mermaid"/"Disco" labels in
`public/pages/studio/controls.js`.

Re-confirmed in the 2026-07 UX/DX pass — the copy de-personalization is the cheap first step ahead of the full theme refactor, and it's a prerequisite for the reusable-product direction in §14.

**First step done (2026-07):** the brand color is now single-sourced from the CSS token
`--effect-brand` (`public/styles/tokens.css`), read by `public/effects/config.js` via
`getComputedStyle` (a plain, non-`light-dark` token so canvas fills stay theme-independent and
render identically); the `disco-spotlight.js` fallback derives its rgba from the same source. The
studio's `Jordana & Jesse` / "— Wedding" copy now templates from `content.js` (`{{couple.display}}`).
**Also done (2026-07):** the remaining hardcoded brand touchpoints now single-source from the
tokens — `public/components/celebrate.js` confetti reads `--effect-brand`/`--effect-brand-dark`, and
the two `public/styles/effects.css` literals use `color-mix(in srgb, var(--effect-brand) …)`.
`brandAlpha` (`public/effects/config.js`) degrades to the opaque brand color if the token isn't in
`rgb()` form (documented at the token). **Still open:** the full ~3-theme refactor; the
`var(--color-primary, rgb(221,115,100))` shimmer fallback in `effects.css:347-351` (deliberate — it
tracks the `light-dark` primary and duplicates the literal only as a fallback); `name-shimmer.js`
still binds `.couple-names` (fine — the element is content-templated); the dev-only `Mermaid`/`Disco`
labels in `controls.js` are effect *type* names, left as-is.

---

## 10. Effect studio → live page wiring 🟡

The studio (`/studio`) tunes an in-memory config and only offers a "Copy values" button that dumps
a `defaults` literal to the clipboard for manual paste into `public/effects/config.js`. Wanted, in
both directions:
- **Live preview:** the studio writes tuned config to `localStorage`; the effect manager
  (`startEffects` in `public/effects/main.js`) merges those overrides over `getDefaultConfig(id)` so
  the tuner's own browser shows tuned values on the real page — no rebuild, per-browser.
- **Promote to defaults:** a path to persist a liked tuning as the shipped default every visitor
  sees — an improved copy-into-`config.js` flow, or a dev-only (non-production-gated) save endpoint
  that rewrites `config.js`.

---

## 11. `/studio` and `/demo` are publicly routable in production 🟡 ✅ DONE

**Resolved (2026-07).** `serveStatic` (`core/static.js`) now gates a `DEV_ONLY_PAGES` set
(currently `{studio}`): when `NODE_ENV === "production"` the first path segment is checked and dev
pages `return false` → 404 like any missing route. `/demo` was removed entirely (see §12). Verified
by booting with and without the flag (`/studio` 200 in dev, 404 in prod; real pages stay 200).

---

## 12. Retire the change-review demo; consider an onboarding walkthrough 🟢 ✅ DONE

**Resolved (2026-07).** All change-review demo machinery removed: `public/pages/demo/`,
`scripts/build-demo.js`, `scripts/demo-server.js`, `change-review-decisions.json`, the `demo:*` npm
scripts, the README row, the `tsconfig`/`public/tsconfig` excludes, the stale `public/_demo/` build,
and the `.gitignore` rules. Nothing in the production runtime imported any of it. The ambitious
**new-user onboarding/walkthrough demo** replacement remains a possible future direction (unbuilt).

---

## 14. Pre-/post-wedding modes + no-code onboarding (reusable wedding-site product) 🟢

The content-config MVP is in place: `content.js` (single source of truth) + timeline `mode`
(`getTimelineMode` / `SITE_MODE`) + serve-time templating drive the landing copy and nav swap. The
larger reusable-product direction remains:

- **Phase B — runtime-editable content ✅ DONE (2026-07):** the full `SiteContent` (incl. nav arrays)
  is now runtime-editable. `core/site-content.js` resolves effective content = `content.js` defaults ⊕
  an `app_state` `site_content` override (deep-merge; arrays replaced wholesale), re-resolved at boot
  and on save (`onContentChanged` in `core/static.js` rebuilds tokens + evicts memoized HTML). Admin
  "Site content" tab (`api/admin/site-content.js` + `public/pages/admin/site-content.js`) edits it
  behind `withAdmin`. The override is now stored **sparse** (only fields differing from `content.js`
  defaults, via `diffFromDefaults`), so unchanged fields keep tracking future default edits and an
  all-defaults save clears the override; templated scalars are HTML-escaped (trusted-HTML copy fields
  excepted) and the resolver guards prototype keys. **Still open in Phase B:** the landing prose not yet in the `SiteContent` shape
  (Schedule, Dress Code, per-page body copy) — migrate those to make them editable too. Documented
  boundary: `types.js` `WEDDING`/`EMAIL_SUBJECTS` (email/SMS) stay boot-resolved from `content.js`
  defaults — web-facing content is editable, email templates are not (lift later if wanted).
- **Phase C — no-code onboarding:** a first-run wizard that captures *all* site copy into `app_state`,
  plus a shipped Docker container, so a non-coder self-hoster fills forms and never touches source.
  Ties into §9 (de-personalize/themeable effects) and §11 (gate `/studio`/`/demo`).

Scope is large; captured as a product direction, not a launch task.

---

## 16. Post-wedding launch smoke test 🔴 (ops, Phase 7 §6)

On a real phone over cellular: register with a seeded code, post a guestbook entry, upload one photo
**and one ~30MB video**, react, comment, approve from the admin queue, and play the video on iOS Safari
via `/media/:key/video` (validates Range/206 + the GPS-blanked variant; spot-check that the served
bytes carry no coordinates). Manual go-live verification, no repo code.

---

## 17. Admin-authenticated integration tests are skipped in CI 🟡

Every admin integration suite (`accounts`, `media`, `guestbook`, `api`, `site-content`) gates its
authenticated tests on `process.env.TEST_ADMIN_PASSWORD`, because `adminLogin()` needs the server
booted with a matching `ADMIN_PASSWORD_HASH`. Locally that's set from `.env` (so they run and pass);
in CI (`.github/workflows/deploy.yml` runs bare `npm test`) neither var is set, so **all** admin tests
silently skip — CI can go green while the admin surface is unexercised. Fix (deploy/CI decision, not
per-suite code): in the CI test step, generate an `ADMIN_PASSWORD_HASH` for a known password and export
it plus `TEST_ADMIN_PASSWORD` before `npm test` (e.g. a small step calling `scripts/setup-admin.js`
non-interactively, or a committed test-only hash env). Kept the per-suite gate consistent rather than
un-gating one suite (which would then be the lone admin test to run in CI — and it would fail with no
hash configured).
