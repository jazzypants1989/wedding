# Deferred Work

Forward-looking operations, deployment, and hardening items. Each needs a production/deploy
decision, off-repo access, an owner call, or a manual go-live step — not a quick code edit. The
**reusable-product roadmap** (themeable effects, no-code onboarding, content-as-data) lives in
`TODO.md`.

Severity tags: 🔴 high · 🟡 medium · 🟢 low.

---

## Deploy & operations

### Media pipeline go-live checklist 🔴

Serving 100MB uploads through Traefik needs proxy-side settings the repo can't set:
- **Traefik read timeout:** v3's `transport.respondingTimeouts.readTimeout` defaults to 60s and
  would kill slow uploads at the proxy. Set it to `0` or `≥10m` on the HTTPS entrypoint.
  (`server.requestTimeout` is already 600s in `server.js`.)
- **No buffering middleware** on the media router — it would spool the whole upload to proxy disk.
  Confirm none is attached in `docker-compose.yml` labels; re-check whenever middleware changes.
- **VPS free disk ≥ 50GB** (≈30GB at full scale). Tune in the VPS `.env`: `MEDIA_MIN_FREE_BYTES`
  (default 5GB), `MEDIA_MAX_TOTAL_BYTES` (default 45GB), `MEDIA_UNTRUSTED_QUOTA_BYTES` (default
  250MB).
- **Health wiring:** `GET /api/health` reports `uploadsFreeBytes` — connect it to whatever
  monitors the box.

### Off-host backups + retention 🟡

`scripts/backup-db.js` writes a WAL-consistent `VACUUM INTO` snapshot, pruned to the last 5 —
but all inside the `wedding-data` volume. That is point-in-time recovery, **not disaster
recovery**: lose the volume and every copy is gone. Still needed:
- **DB off the VPS:** copy the newest snapshot off-box (scp / object storage) on a deploy hook or
  a separate cron.
- **Media off-host:** uploads under `data/uploads/media/` are write-once, so a nightly
  `rsync -a --ignore-existing .../uploads/media/ backuphost:...` (plus the newest DB snapshot in
  the same cron) is the ideal backup. `--ignore-existing` keeps VPS-side deletes from propagating,
  which is correct for a backup. Deploy-time cron on the VPS; install and verify by hand.
- **Retention:** decide real daily/weekly retention beyond the rolling 5.
- **Restore drill:** actually restore from a snapshot into a throwaway environment once — an
  untested backup is a hope, not a backup.

(`scripts/export-archive.js` is the separate *whole-archive* export for eventual site sunset, not
the incremental nightly backup.)

### Post-launch smoke test 🔴

Before the post-wedding site goes live, on a real phone over cellular: register with a seeded
code, post a guestbook entry, upload one photo **and one ~30MB video**, react, comment, approve
from the admin queue, and play the video on iOS Safari via `/media/:key/video` (validates
Range/206 + the GPS-blanked variant; spot-check that the served bytes carry no coordinates).

### Monitoring & alerting 🟡

Beyond the health endpoint, there's no alerting. Decide and wire up: an uptime/health check that
pages someone on failure, a disk-headroom alert (before `MEDIA_MIN_FREE_BYTES` starts pausing
uploads), and a place errors surface. Cheap insurance for an unattended box during the window it
matters most.

### Consolidate the two deploy paths 🟢

The CI inline script (`.github/workflows/deploy.yml`) and `scripts/deploy.js` duplicate the same
backup → pull → `compose up` → health-poll logic; both call `docker exec wedding node
scripts/backup-db.js`, so they're in sync, but drift is possible. Both hardcode the host/port
(`scripts/deploy.js`, `deploy.yml`). Collapse to one path — CI invokes `scripts/deploy.js`, or the
SSH step runs a single committed remote script.

### Quarantine directory housekeeping 🟢

The daily media sweep (`core/media-sweep.js`) moves DB-orphaned files into
`data/uploads/quarantine/` (`QUARANTINE_DIR` in `core/media-storage.js`) and, by design, **never
auto-hard-deletes** — it's a safety net, not a self-emptying trash. So it grows unbounded; someone
must periodically inspect and `rm -rf data/uploads/quarantine/*` once satisfied nothing there is
wanted, so it doesn't silently eat the disk headroom `MEDIA_MIN_FREE_BYTES` guards.

---

## Reusable-product roadmap

### De-personalize the shipped content defaults 🟡

The no-code onboarding wizard (`/setup`), the effective-content wiring
(`core/wedding-facts.js`), and the runnable container (`docs/self-host.md`) all
landed, so a self-hoster can stand the site up without touching source. **But the
checked-in defaults in `content.js` are still this couple's real copy** — the
karaoke schedule, the "we wear pink" dress code + its `/images/*` assets, the
Honeyfund registry, the welcome prose. The wizard overrides the essentials
(names, date, location, theme, registry, welcome), and everything else is
editable in `/admin`, but a fresh install still *starts* showing this wedding's
schedule/dress-code until the owner edits them.

Deliberately deferred (owner decision 2026-07-10): **do not swap the live site's
real copy for generic sample content yet** — the production deployment reads these
defaults, and a cut-over risks regressing the real wedding page during its live
window. When ready to make the repo a clean template:

- Replace `content.js` defaults with neutral sample copy (generic couple, placeholder
  schedule/dress-code/registry, and sample `/images/*` that ship in the repo).
- Move this wedding's real content into a seed the live deploy loads — e.g. a
  committed `site_content` `app_state` seed (JSON) applied on that box, or a
  `scripts/seed-content.js` run once against the production DB — so the live site
  is byte-for-byte unchanged while the shipped defaults go generic.
- Do the cut-over **after** the wedding's live window (or on a throwaway DB first),
  and re-run the smoke test in `docs/self-host.md`.

Everything else for the reusable product is done; this is the last, deliberate step.

## Configuration & hardening

### Production `.env` completeness + secret rotation 🟡

Run `npm run doctor` for the current drift/gaps.
- **Fill the production `.env`:** keys `.env.example` documents and the code reads may be missing;
  the SMS/email paths no-op on empty `TWILIO_PHONE_NUMBER` / `RESEND_API_KEY` / `FROM_EMAIL`
  (`services/twilio.js`, `services/email.js`). Keep `.env.example` as the source of truth.
- **Rotate secrets 🔴 (if live):** if the working `.env` holds real Twilio credentials, rotate
  them. (Gitignored — never committed — but treat any long-lived plaintext secret as rotatable.)

### Admin-authenticated tests skip in CI 🟡

Every admin integration suite (`accounts`, `media`, `guestbook`, `api`, `site-content`) gates its
authenticated tests on `TEST_ADMIN_PASSWORD`, because `adminLogin()` needs the server booted with
a matching `ADMIN_PASSWORD_HASH`. CI runs bare `npm test` with neither set, so **all** admin tests
silently skip — CI can go green while the admin surface is unexercised. Fix in the CI test step:
generate an `ADMIN_PASSWORD_HASH` for a known password (e.g. call `scripts/setup-admin.js`
non-interactively) and export it plus `TEST_ADMIN_PASSWORD` before `npm test`. Keep the per-suite
gate — don't un-gate one suite in isolation, or it becomes the lone admin test to run in CI and
fails for lack of a configured hash.

### `__Host-` prefix on guest cookies 🟢

`__Host-guest_session` would pin `Path=/` + `Secure` at the browser level. Deferred: the prefix
requires `Secure`, which complicates plain-HTTP localhost dev in some browsers, and production is
already HTTPS-only behind Traefik with `Path=/` set explicitly. Revisit only if the cookie surface
grows.

### Base-image & runtime update cadence 🟢

Zero npm dependencies keeps the supply-chain surface tiny, but the Docker base image and Node
runtime still need periodic security updates. Decide a cadence (e.g. rebuild on the Node 22 LTS
patch line) so the box doesn't drift onto an unpatched runtime.
