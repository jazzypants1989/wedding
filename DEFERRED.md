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
- **Media tree off-host copy (Phase 3):** uploads under `data/uploads/media/` are write-once, so a nightly `rsync -a --ignore-existing .../uploads/media/ backuphost:...` (plus the newest DB `*.backup` in the same cron) is the ideal backup. `--ignore-existing` makes VPS-side deletes non-propagating, which is correct for a backup.

---

## 6. Phase 3 media pipeline — deploy checklist 🔴

Shipped in Phase 3 (media upload + `/media` serving). Items requiring a production/deploy decision, not repo code:

- **Traefik read timeout:** v3's `transport.respondingTimeouts.readTimeout` defaults to 60s and would kill slow (100MB) uploads at the proxy. Set it to `0` or `≥10m` on the https entrypoint. (`server.requestTimeout` was already raised to 600s in `server.js`.)
- **No buffering middleware** on the media router (would spool 100MB to proxy disk). Confirmed none in the current `docker-compose.yml` labels; re-check if middleware is added.
- **VPS free disk ≥ 50GB** (estimate ~30GB at full scale). Set in the VPS `.env`: `MEDIA_MIN_FREE_BYTES` (default 5GB), `MEDIA_MAX_TOTAL_BYTES` (default 45GB), `MEDIA_UNTRUSTED_QUOTA_BYTES` (default 250MB).
- **Health check** now reports `uploadsFreeBytes` (`GET /api/health`) — wire it into whatever monitors the box.

---

## 3. Two deploy paths, maintained separately 🟢

The CI inline script (`.github/workflows/deploy.yml`) and `scripts/deploy.js` duplicate the same backup→pull→`compose up`→health-poll logic; both now call `docker exec wedding node scripts/backup-db.js`, so they're in sync, but drift is possible. `scripts/deploy.js:9-10` hardcodes `jesse@jovial-penguin-1:2420` and `deploy.yml:38` hardcodes port `2420`. Consider collapsing to one path (CI calls `scripts/deploy.js`, or the SSH step runs a committed remote script).

---

## 4. Verify VPS `.env` completeness 🟢

Compose uses `env_file: .env` on the VPS. The local `.env` leaves `TWILIO_PHONE_NUMBER`/`RESEND_API_KEY`/`FROM_EMAIL` empty; SMS/email paths gate on these (`services/twilio.js:9-11`, `services/email.js:10-11`). Confirm the production `.env` has everything it needs (incl. `ADMIN_PASSWORD_HASH`, and `TRUSTED_PROXIES` once §1 is decided). Deploy-environment check, not a code change.

---

## 7. Static asset caching — rework immutable + no cache-busting 🟡

`core/static.js` serves `.css`/`.js`/images with `Cache-Control: public, max-age=31536000, immutable`, but asset URLs are **not** content-hashed or versioned (`/pages/admin/admin.css`, not `/pages/admin/admin.<hash>.css`). Consequence: after a deploy, a returning browser keeps serving the **stale** cached CSS/JS for up to a year (or until a hard refresh) — a new bundle silently doesn't reach existing visitors. This has bitten us more than once, including in dev (headless Chrome cached `admin.css` across screenshot runs and showed pre-edit styling until a fresh origin was used). Only `.html` is `no-cache`, so HTML updates land but the assets they reference may not.

Options to rework (pick one, ideally at build/deploy time to stay zero-runtime-dep):
- **Content-hashed asset names** (`admin.<sha>.css`) rewritten into the HTML at deploy — the gold standard; `immutable` becomes correct because the URL changes when the bytes change.
- **Version query string** tied to the git SHA / deploy id (`admin.css?v=<sha>`) injected into the HTML `<link>`/`<script>` tags — simpler, still busts caches per deploy.
- **Drop `immutable`, shorten `max-age`, add `ETag`/`Last-Modified` revalidation** for HTML-referenced assets so browsers at least re-validate cheaply.

Not urgent for the wedding's traffic, but any of the above prevents "I deployed a fix and users still see the old page." Note the client-facing analogue already documented for media: the 24h guest-media cache caveat (`03 §7`) — different layer (public media vs app shell), same family of problem.

---

## 5. `__Host-` cookie prefix on guest cookies 🟢

The 2026-07-06 design review of `docs/post-wedding/` suggested `__Host-guest_session` to pin
`Path=/` + `Secure` at the browser level. Deferred: the prefix requires the `Secure` attribute,
which complicates plain-HTTP localhost development in some browsers, and production is already
HTTPS-only behind Traefik with `Path=/` set explicitly. Revisit only if the cookie surface grows.
