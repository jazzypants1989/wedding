# Deferred Work

Most of the follow-ups captured during the 2026-06-29 change-review cleanup were executed on 2026-07-02 (grand-entrance star restore, CSS tokenization + chevron fix, `SERVER` config object, CI install step, WAL-safe backup, `stop_grace_period`, pinned base image). What remains below is deferred deliberately — it needs a production/deploy decision or off-repo access, not a code edit.

Severity tags: 🔴 high · 🟡 medium · 🟢 low.

---

## 1. `TRUSTED_PROXIES` unset behind Traefik 🟡

Rate limiting only trusts `X-Forwarded-For` when `req.socket.remoteAddress` is in `SERVER.trustedProxies` (`core/rate-limit.js:62-77`; `getClientIp`). Behind Traefik every request's `remoteAddress` is the Traefik container's IP, which is **dynamic** on a Docker network. With `TRUSTED_PROXIES` unset, all clients collapse into one global rate-limit bucket. `core/env.js:35-46` warns about this at boot under `NODE_ENV=production`. It is set nowhere (`docker-compose.yml` sets only `NODE_ENV`/`PORT`/`BASE_URL`; the VPS `.env` would need it).

**Two ways to fix (pick at deploy time):**
- **Compose static IP (no code):** give the `traefik-public` network a fixed subnet, pin Traefik (or the wedding container) to a static address, and set `TRUSTED_PROXIES` to that exact IP in the VPS `.env`. Lowest risk.
- **CIDR in code:** extend `getClientIp` to trust a subnet range (no-regex, integer math on the octets) so the whole Docker network is trusted regardless of Traefik's assigned IP. Also revisit `TRUSTED_PROXY_DEPTH` (`rate-limit.js:71`, default 1).

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

The CI inline script (`.github/workflows/deploy.yml`) and `scripts/deploy.js` duplicate the same backup→pull→`compose up`→health-poll logic; both now call `docker exec wedding node scripts/backup-db.js`, so they're in sync, but drift is possible. `scripts/deploy.js:9-10` hardcodes `jesse@jovial-penguin-1:2420` and `deploy.yml:38` hardcodes port `2420`. Consider collapsing to one path (CI calls `scripts/deploy.js`, or the SSH step runs a committed remote script).

---

## 4. Verify VPS `.env` completeness 🟢

Compose uses `env_file: .env` on the VPS. The local `.env` leaves `TWILIO_PHONE_NUMBER`/`RESEND_API_KEY`/`FROM_EMAIL` empty; SMS/email paths gate on these (`services/twilio.js:9-11`, `services/email.js:10-11`). Confirm the production `.env` has everything it needs (incl. `ADMIN_PASSWORD_HASH`, and `TRUSTED_PROXIES` once §1 is decided). Deploy-environment check, not a code change.

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

## 11. `/studio` and `/demo` are publicly routable in production 🟡

`core/static.js` maps any extensionless path to `public/pages/<path>/index.html`, so `/studio` and
`/demo` serve in **every** environment with no gate — only a `robots: noindex` meta and a docs
convention mark them dev-only. Gate them behind `NODE_ENV` (or a `FEATURES` flag) in `serveStatic`,
or remove them, before/at launch. No `FEATURES` hook exists for this today (`api/config.js` exposes
only the guest-lookup flags).

---

## 12. Retire the change-review demo; consider an onboarding walkthrough 🟢

All 22 decisions in `change-review-decisions.json` are resolved (commit `fdb44d1`), so the
change-review demo machinery can be removed: `public/pages/demo/` (tracked, ships to prod),
`scripts/build-demo.js`, `scripts/demo-server.js`, `change-review-decisions.json`, the `demo:*` npm
scripts, and the stale local `public/_demo/` build (gitignored, but boot-scanned by `core/static.js`
and URL-reachable locally). Ambitious replacement worth considering: a **new-user
onboarding/walkthrough demo** that teaches how the app works — good portfolio value, and it would
surface behavior that currently only lives in the maintainer's head (see §13).

---

## 13. Documentation / self-explanatory-app debt 🟢

Several non-obvious app behaviors are undocumented and only known to the maintainer. Triage each:
fix some in the app itself (clearer UX) and document the rest, aiming for portfolio-grade clarity so
a newcomer can understand and run the project.
