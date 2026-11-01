# Deferred Work

Forward-looking operations, deployment, and hardening items. Each needs a production/deploy
decision, off-repo access, an owner call, or a manual go-live step — not a quick code edit.

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
matters most. *(2026-07 UX pass: the moderation digest now retries ~hourly after a failed send
instead of silently skipping an interval, and the admin dashboard polls badge counts every 3
minutes — but external uptime/disk alerting is still unaddressed.)*

### Consolidate the two deploy paths 🟢

The CI inline script (`.github/workflows/deploy.yml`) and `scripts/deploy.js` duplicate the same
backup → pull → `compose up` → health-poll logic; both call `docker exec wedding node
scripts/backup-db.js`, so they're in sync, but drift is possible. Both hardcode the host/port
(`scripts/deploy.js`, `deploy.yml`). Collapse to one path — CI invokes `scripts/deploy.js`, or the
SSH step runs a single committed remote script.

### Quarantine directory housekeeping — done

Quarantine now empties itself and Reject is undoable. The daily sweep purges entries older than
`MEDIA_QUARANTINE_TTL_DAYS` (default 7) and only then frees their quota
(`core/media-sweep.js`); quota sums count quarantined bytes until that purge (`db/media.js`).
Undo of a Reject restores the files (`restoreQuarantinedItemDir` in `core/media-storage.js`).
Nothing to do here beyond choosing the TTL in the production `.env`.

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

### Local registry / honeyfund (with optional Stripe) 🟡

Today the registry is a single external link (`registry.url` → Honeyfund/etc.), and the setup
wizard **requires** it — there's no "no registry" and no first-party registry. Two related
pieces, deferred together:

- **Make the registry optional.** `buildOverride` (`api/admin/site-content.js`) currently
  requires `registry.{title,body,frameNote,url,label}` non-empty, and the wizard mirrors that
  (fast, up-front validation — no late 400). To support a registry-less site, loosen the
  validator (empty/absent `registry` → render nothing, drop the nav entry) and let the wizard
  skip the step. Owner decision (2026-07-10): defer this and fold it into the feature below
  rather than shipping a bare "optional link" toggle.
- **Build a first-party registry / honeyfund** the couple manages in-app instead of linking out:
  a list of gift/fund items (title, blurb, image, goal/price), shown on its **own page with a
  nav-bar entry** (`registry.mode: "external" | "builtin"` in `SiteContent`, so the landing
  section + `nav` render the internal page when built-in). Contributions via an **optional
  Stripe integration** — guests pay toward an item/fund; gate it behind env keys the same way
  Twilio/Resend are (`STRIPE_SECRET_KEY` / webhook secret), no-op when unset. Test keys are
  already on hand. Keep the zero-dependency constraint: talk to Stripe over the existing
  `services/http-client.js` (REST + webhook signature verify with `node:crypto`), not the npm
  SDK. Scope needs its own design pass (data model for items/contributions, refund/dispute
  posture, PCI surface — prefer Stripe Checkout/Payment Links so no card data touches this box).

### Non-coder onboarding & reusable-product polish 🟡

These surfaced during the UX overhaul (2026-07). They mainly help arbitrary
self-hosters and non-technical couples; the live wedding's own guest + admin
flows are handled. Grouped here so a future reusable-product pass can take them
together:

- **Visual theme picker.** Setup step 2 (`setup.js`) and the admin theme dropdown
  (`admin/index.html`) present the 8 themes as text-only radios/options with no
  swatch or preview — the couple picks the whole visual identity blind. Add
  thumbnails / live preview.
- **Setup-wizard de-jargon.** The one-time-token step points at "server logs"
  with no guidance for a non-deployer (`setup/index.html`); "prose" / "monogram"
  and "inline HTML like `<em>`" are unexplained. A plain-language pass on the
  whole wizard (the admin Site-content intro was already de-jargoned in the
  overhaul; the wizard is the remaining surface).
- **Date/time/timezone picker.** The wedding date is free-text
  ISO-8601-with-offset in both setup and admin Site-content; `Date.parse` accepts
  ambiguous input that then breaks the countdown timezone. Replace with a real
  picker.
- **Effects tab is a raw JSON textarea** (`admin/index.html`) with a four-step,
  cross-page, same-browser-only import dance (`effect-config.js`). Needs a
  friendly control surface and a connection from the theme choice to its implied
  effects.
- ~~**`.env` error copy in Send Invites**~~ *Done (2026-07 UX pass):* reworded for the
  couple ("Email sending isn't set up yet — whoever runs the server…", `invites.js`).
  The setup wizard's "server logs" guidance is still open.
- **Admin password self-service reset.** The login screen has no "forgot
  password" path (`admin/index.html`); recovery today means editing env config.
- **CSV template download.** Import lists the required columns
  (`admin/index.html`) but the couple must hand-build the header row; offer a
  downloadable template.
- **Optional / first-party registry.** The setup wizard still *requires* a
  registry (`setup.js`); cross-references the "Local registry / honeyfund" item
  above (make registry optional is folded into that feature).
- **Invite / manual-SMS placeholder parity.** The invite composer supports only
  `{name}` / `{url}` (`admin/index.html`); manual SMS also supports `{date}` /
  `{location}`. Unify the supported placeholders across both.

## Configuration & hardening

### Production `.env` completeness + secret rotation 🟡

Run `npm run doctor` for the current drift/gaps.
- **Fill the production `.env`:** keys `.env.example` documents and the code reads may be missing;
  the SMS/email paths no-op on empty `TWILIO_PHONE_NUMBER` / `RESEND_API_KEY` / `FROM_EMAIL`
  (`services/twilio.js`, `services/email.js`). Keep `.env.example` as the source of truth.
- **Rotate secrets 🔴 (if live):** if the working `.env` holds real Twilio credentials, rotate
  them. (Gitignored — never committed — but treat any long-lived plaintext secret as rotatable.)

### `__Host-` prefix on guest cookies 🟢

`__Host-guest_session` would pin `Path=/` + `Secure` at the browser level. Deferred: the prefix
requires `Secure`, which complicates plain-HTTP localhost dev in some browsers, and production is
already HTTPS-only behind Traefik with `Path=/` set explicitly. Revisit only if the cookie surface
grows.

### Base-image & runtime update cadence 🟢

Zero npm dependencies keeps the supply-chain surface tiny, but the Docker base image and Node
runtime still need periodic security updates. Decide a cadence (e.g. rebuild on the Node 22 LTS
patch line) so the box doesn't drift onto an unpatched runtime.
