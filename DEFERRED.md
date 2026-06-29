# Deferred Work

Work consciously punted during the `change-review-decisions.json` cleanup pass (2026-06-29). Each item was reviewed and **kept** in the working tree, but carries follow-up. This doc captures enough code-level context (file:line, snippets, gotchas) that a future agent can execute without re-discovering everything.

Severity tags: 🔴 high (blocking / data-loss / security) · 🟡 medium · 🟢 low / polish.

**Quick triage — do these first:**
1. 🔴 [CI deploy is broken](#5-cicd--docker-audit) — `typecheck` job fails (devDeps never installed), and `needs: test` means **no deploy ever runs**. One-line fix.
2. 🔴 [DB backup is WAL-inconsistent](#5-cicd--docker-audit) — deploy backup `cp`s only `wedding.db`, not the `-wal`/`-shm` sidecars.
3. 🟡 [`TRUSTED_PROXIES` unset behind Traefik](#5-cicd--docker-audit) — rate limiting collapses to one global bucket in production.

---

## 1. Grand entrance — restore the original look, performantly 🟡

**Status:** the box-shadow "wave" version is currently shipping. The review verdict was "drop," but a plain `git checkout` revert is unsafe (see caution) and you separately approved the new cancellation plumbing (`effects-abort-refactor`), so this needs a small reimplementation rather than a revert.

### What changed and why it looks different
The working-tree rewrite of `public/effects/grand-entrance.js` replaced ~345 per-sparkle DOM nodes with one `.grand-entrance-wave` div per wave whose `box-shadow` string carries every sparkle. Two original traits were lost:
- **Shape:** `box-shadow` clones only the element's box, not its `::before`/`::after` — so the cross/plus **star** becomes a plain round **dot**. (The `.grand-entrance-sparkle::before/::after` star CSS still exists at `public/styles/effects.css:589-599`; nothing creates elements that use it anymore.)
- **Twinkle:** the original gave each sparkle its own random `animationDuration` (0.8–2s) and `animationDelay` (0–0.5s). The wave shares **one** `animationDuration` for all sparkles → rigid lockstep instead of staggered shimmer.

`runGoldenReveal` (`grand-entrance.js:165-221`) was **not** converted — it still uses per-element star sparkles. Only `curtain`/`shower` regressed.

### Perf context (why the rewrite happened) — `LIGHTHOUSE_CHANGES.md:81-119`
- Mobile Lighthouse 90; remaining bottleneck is **Total Blocking Time from Style & Layout recalc = 4,035 ms** (Script Eval only 88 ms — "JS payload size is not the issue").
- Cause #3: grand entrance fires **5 waves × 69 sparkles = 345 DOM elements** (86 on mobile) during first load, exactly when TBT matters. Each sparkle is 3 render objects (div + `::before` + `::after`) ≈ **~1035 render objects** — that multiplier is what the box-shadow rewrite targeted.
- Constraint (LIGHTHOUSE_CHANGES.md:116-119, "What NOT to change"): *"keep the same visual result with fewer DOM nodes and less layout thrashing, not to remove effects."*

### ⚠️ Caution — do NOT `git checkout HEAD -- grand-entrance.js`
The working tree **deleted `mapSlider` from `public/effects/main.js`** (it exists only at HEAD, `main.js:138-149`). The HEAD version of `grand-entrance.js` imports `mapSlider`, so reverting the file alone throws at runtime. The change is a coupled set:
- `public/effects/grand-entrance.js` — the box-shadow rewrite + AbortController plumbing
- `public/effects/main.js` — `mapSlider` (deleted) → `cancellableDelay` (added, `main.js:147-164`)
- `public/effects/config.js:121-133` — entrance defaults reinterpreted: `sparkleIntensity` 50→69, `speed` 50→0.95 (HEAD treated these as 0–100 slider values fed through `mapSlider`; now they're raw), plus new `sparkleSizeRange: [3,8]` and `waveCount: 5`
- `public/effects/types.d.ts:268-275` — `GrandEntranceConfig` gained `sparkleSizeRange?`/`waveCount?`; `cancellableDelay` type added (line 81), `mapSlider` type removed
- `public/styles/effects.css:575-587` — the `.grand-entrance-wave` rule

### Keep the cancellation plumbing
`cancellableDelay(ms, signal)` (`main.js:147-164`) is the primitive the rewrite is built on — keep it. `start()` (`grand-entrance.js:234`) creates an `AbortController`; `stop()` (line 256) calls `controller.abort()`; every wait is `await cancellableDelay(ms, signal)` and every listener uses `{ signal }`. This is orthogonal to how a wave is rendered — leave it untouched.

### Recommended approach: pooled real-DOM star sparkles + hard mobile cap
Restores the exact original look (cross-star `::before`/`::after` + per-sparkle staggered twinkle) while bounding node count. Prefer this over canvas — canvas would force manual re-draw of the star + twinkle and abandon the surviving CSS keyframes.

1. **Rewrite `createSparkleWave` (`grand-entrance.js:50-75`)** back to per-element `.grand-entrance-sparkle` divs, restoring per-sparkle `style.animationDuration = randomBetween(0.8,2)` and `style.animationDelay = randomBetween(0,0.5)`. Drop the `shadows[]`/`box-shadow` construction. Keep using `sparkleSizeRange`/`colors`.
2. **Bound node count** (both levers already wired through config): tune `getSparkleCount()`/`waveCount` to stay well under 345 desktop / ~86 mobile, and add an absolute `Math.min(..., CAP)` on top of the existing mobile `* 0.25` factor (`grand-entrance.js:38`).
3. **Pool the nodes:** pre-allocate `count` divs once, and on each wave reposition + restart their animation (reset `animationName` / toggle a class) instead of `createElement` per wave — removes the per-wave allocation + style-recalc storm. The existing `animationend`→`remove` handler returns nodes to the pool instead.
4. **Push past the TBT window:** gate the first wave behind the existing stagger-start system (LIGHTHOUSE_CHANGES.md:113-119) or an initial `await cancellableDelay(...)` so the cascade begins after first-interactive.
5. **CSS:** no new CSS needed — `.grand-entrance-sparkle` (`effects.css:568-573`), its `::before`/`::after` (589-599), and the `grand-entrance-sparkle-fall` keyframes all survive. Once `createSparkleWave` stops emitting `.grand-entrance-wave`, **delete the dead rule at `effects.css:575-587`**.
6. **Config/types:** keep the working-tree shape (raw `sparkleIntensity`/`speed` + `sparkleSizeRange`/`waveCount`). Do **not** reintroduce `mapSlider`.
7. **`runGoldenReveal` needs no change** — confirm it shares the same cap/pool policy.

### Debug harness — keep `public/pages/demo/` until this is done
`scripts/build-demo.js` snapshots HEAD into `public/_demo/before/` (original star) and the working tree into `public/_demo/after/` (box-shadow) for a side-by-side. The snapshots are self-contained, so HEAD's `before` resolves `mapSlider` against its own `main.js`.

```
npm run demo        # build snapshots THEN serve  -> http://localhost:5050
npm run demo:build  # node scripts/build-demo.js  (regenerate snapshots/manifest only)
npm run demo:serve  # node scripts/demo-server.js (serve only; DEMO_PORT overrides 5050)
```
Open `http://localhost:5050`, find "Grand entrance", use Before/After + **Replay** (replay = teardown + fresh `start()`). The fullscreen runner (`demo/host.js`) opens one effect in a new tab via `?ver=before|after`. **Re-run `npm run demo:build` after each edit** — "after" is a snapshot, not live. Your goal: "After" visually matches "Before" while node counts stay low.

---

## 2. CSP flags → top-level config object 🟢

Preference: avoid scattered boolean flags; group config into one object.

### Current state
Today CSP mode is a single env-derived **boolean**, `CSP_NONCE` (`types.js:120`): `true` → per-request nonce mode, unset → static hash mode (cacheable). It's read in **6 branch sites** in `core/static.js`:
- `:216` nonce generation · `:219` CSP header selection (`buildNonceCsp(nonce)` vs `HASH_CSP`) · `:236` theme-init `<script nonce>` injection · `:247` ETag/gzip cache guard (nonce mode can't cache) · `:259` conditional-request skip · `:274` per-request gzip branch.

CSP machinery, all in `core/static.js`: `THEME_INIT_HASH` (`:48-50`), `INLINE_CSS_HASH` (`:54-61`), `CSP_DIRECTIVES` shared tail (`:63-72`), `HASH_CSP` static string (`:74-78`), `buildNonceCsp(nonce)` (`:80-87`).

### All env-derived constants (candidates to group) — `types.js:113-120`
`PROJECT_ROOT` (113), `PORT` (114), `ADMIN_PASSWORD_HASH` (115), `BASE_URL` (116), `CONTACT_EMAIL` (117), `TRUSTED_PROXIES` (118-119), `CSP_NONCE` (120). These are loose `export const`s with no wrapper. `CSP_NONCE` is the only boolean.

### Mirror to follow
`types.js` already has the desired idiom: `FEATURES = Object.freeze({ ENABLE_NAME_LOOKUP: false, ENABLE_EMAIL_LOOKUP: false })` (`types.js:84-96`), alongside frozen `SESSION`, `LIMITS`, `WEDDING`, `RATE_LIMITS`, etc. A new `CONFIG`/`SERVER = Object.freeze({...})` absorbing lines 114-120 would match the pattern; then the 6 `static.js` sites become `CONFIG.cspNonce`. Note `core/env.js` does warning-only validation (`RECOMMENDED_ENV_VARS`, `:16-33`) and exports nothing — the env→constant mapping lives in `types.js`, so that's where the config object belongs.

---

## 3. Admin chevron border cleanup 🟢

Flagged CSS (working tree, `public/pages/admin/admin.css:252-271`), the `.rsvp-toggle::after` expand/collapse chevron:
```css
.rsvp-toggle::after {
  content: "";
  display: inline-block;
  width: var(--spacing-sm);   /* 0.5rem */
  height: var(--spacing-sm);
  border-right: 2px solid var(--color-primary);    /* :257 — flagged, hardcoded */
  border-bottom: 2px solid var(--color-primary);   /* :258 — flagged, hardcoded */
  transform: rotate(45deg);
  transition: transform var(--duration-normal) ease;
  opacity: 0.8;
}
.rsvp-toggle[aria-expanded="true"]::after {
  transform: scale(1.5) rotate(225deg);            /* :269 */
  opacity: 1;
}
```
(Desktop hides it: `admin.css:776-778` `.rsvp-toggle::after { display: none }` inside `@media (min-width: 768px)`.)

### What's actually buggy/ugly
- **`scale(1.5)` on expand (`:269`) thickens the stroke:** scaling a border-drawn chevron scales its 2px borders too (→ ~3px effective), so the open-state glyph visibly fattens. The committed version avoided this with pure rotation.
- **Hardcoded `2px`** (`:257-258`) with no matching token (see §4) — and it's inconsistent with the committed chevron, which used `1.5px`.
- **Alignment is fragile:** the working-tree rule dropped `vertical-align` and relies on the parent `.rsvp-toggle` being `inline-flex; align-items:center` (`:247-248`).

### Committed vs working-tree (context)
Commit `5dbb861` ("fancy chevron gas station") changed a **different** selector, `.expand-indicator` (8×8px, `1.5px` borders, `0.6` opacity, expand via pure `rotate(-135deg)`, `vertical-align:middle`). The uncommitted working tree then **deleted** `.expand-indicator`/`.expandable-row`/`.row-details` and introduced the `.rsvp-toggle*` set. So the flagged code is the newer uncommitted version, not what `5dbb861` committed. Cleaner long-term fix: SVG/`mask` glyph or a font character instead of a rotated bordered square; at minimum tokenize the border width and replace `scale(1.5) rotate(225deg)` with a non-scaling rotation.

---

## 4. Reduce hard-coded px values 🟢

Preference noted repeatedly (`commit-chevron`, `commit-mobile-perf-pass`). Concentrated in `public/pages/admin/admin.css`.

### Token menu — `public/styles/tokens.css` (`:root`, lines 51-180)
- **Spacing** (111-115): `--spacing-xs` 4px · `-sm` 8px · `-md` 16px · `-lg` 24px · `-xl` 48px
- **Radius** (138-141): `--radius-sm` 4px · `-md` 8px · `-lg` 12px · `-full` 9999px
- **Containers** (130-135): `--container-sm` 400 · `-md` 500 · `-lg` 600 · `-content` 720 · `-modal-lg` 700 · `-max` 1200 (px)
- **Layout** (118-127): `--mobile-header-height` 56px; z-index set `--z-*` (40…1000)
- **Durations** (149-153): `--duration-instant` .15s · `-fast` .2s · `-normal` .3s · `-moderate` .4s · `-slow` .5s
- **Type** (171-179): `--text-xs`…`--text-4xl` · **Shadows** `--shadow-sm/md/lg` (144-146)
- **No token exists for: border-width, sub-4px spacing (2px/6px), breakpoints.**

### admin.css magic numbers, categorized
- **(b) Need a NEW token:** recurring `1px` borders (~12 sites) and `2px` (`:109, 126, 127, 257, 258, 367`) have no border-width token → add `--border-width: 1px` + `--border-width-thick: 2px`. Badge padding `2px 6px` (`:531, 621, 690, 704`) is sub-`--spacing-xs` → add `--spacing-2xs: 0.125rem` (2px) or a dedicated badge-padding token. The chevron's `2px` (§3) maps to the border-width token.
- **(a) Tokenizable once border-width token exists:** focus ring `outline: 2px` / `outline-offset: -2px` (`:126-127`), tab underline `2px` (`:109`), dropzone `2px dashed` (`:367`), all the `1px solid var(--color-border)` dividers (`:34, 100, 175, 465, 515, 568, 652`).
- **(c) Leave literal (one-off layout):** `minmax(180px/200px, 1fr)` grid tracks (`:61, 156`), `contain-intrinsic-size: auto 500px` (`:137`), `min-width: 100/120px` column mins (`:324, 327, 430`), `max-width: 150px` (`:407`), `max-height: 200/300px` scroll containers (`:455, 509, 642`), `min-height: 60px` (`:641`), breakpoint `768px` (`:721`).

### Effects px is NOT a tokenization target
`public/effects/*.js` px strings (e.g. `x + "px"`, `cursor-trail.js:69-70`, `disco-ball.js:61-62`) are **runtime unit suffixes** on config-driven values, not magic literals. All effects tuning numbers live unitless in `public/effects/config.js` (`EFFECT_CONFIGS[*].defaults`, header comment: "To tweak an effect: edit its `defaults` below"). Tune there; leave the `"px"` suffixes alone.

---

## 5. CI/CD + Docker audit 🔴🟡

`commit-cicd-deploy` (`2273e9a`) and `commit-docker-sms` (`3ade79e`) were kept but flagged "we definitely need to audit all of that." Files: `.github/workflows/deploy.yml`, `scripts/deploy.js`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`. Findings below cite lines.

### 🔴 HIGH — CI test job fails → deploys never run
`deploy.yml:21-25` runs `npm run typecheck` (`= tsc && tsc -p public/tsconfig.json`, `package.json:14`) and `npm test` after `setup-node@v4`, but there is **no `npm ci`/`npm install` step**. `typescript` is a devDependency (`package.json:35-36`) that's never installed → `tsc` doesn't exist → `test` job fails. Since `deploy` has `needs: test` (`deploy.yml:29`), the deploy job is permanently blocked. **Fix:** add `npm ci` (or `npm install`) before the typecheck step. (`npm test` itself uses only node built-ins and would pass.)

### 🔴 HIGH — SQLite backup is WAL-inconsistent
DB runs in WAL mode (`db/connection.js:28`). The deploy backup is a plain `docker exec wedding cp /app/data/wedding.db /app/data/wedding.db.backup` (`deploy.yml:50`, `scripts/deploy.js:28`) that **omits `wedding.db-wal`/`-shm`** → backup can be stale/inconsistent. **Fix:** use `sqlite3 .backup` / `VACUUM INTO`, or checkpoint then copy all three files.

### 🟡 MEDIUM — backup has no rotation, no off-host copy
Always overwrites a single `wedding.db.backup` living **inside the same `wedding-data` volume** (`docker-compose.yml:12`). Lose the volume, lose the backup. No timestamping, no off-VPS copy.

### 🟡 MEDIUM — `TRUSTED_PROXIES` unset behind Traefik → rate limiting collapses
Rate limiting only trusts `X-Forwarded-For` when `req.socket.remoteAddress ∈ TRUSTED_PROXIES` (`core/rate-limit.js:62-77`, `types.js:118-119`). Behind Traefik every request's `remoteAddress` is the Traefik container IP, so without `TRUSTED_PROXIES` set **all clients share one global bucket**. `core/env.js:35-46` warns about this at boot under `NODE_ENV=production`. It's set **nowhere** (`docker-compose.yml` only sets `NODE_ENV`/`PORT`/`BASE_URL`; local `.env` lacks it). Traefik's container IP is dynamic on a Docker network, so this needs a CIDR-aware trust or a fixed network address (also see `TRUSTED_PROXY_DEPTH`, `rate-limit.js:71`, defaults 1).

### 🟡 MEDIUM — no `stop_grace_period`; shutdown race
`server.js:78-79` handles SIGTERM/SIGINT, drains, and force-exits via a 10s timer (`:104-108`). Docker's default stop grace is also 10s before SIGKILL, and `docker-compose.yml` sets no `stop_grace_period` → Docker may SIGKILL mid-drain. **Fix:** `stop_grace_period: 15s`. (Positive: exec-form `CMD ["node","server.js"]` makes node PID 1, so it does receive SIGTERM.)

### 🟢 LOW
- **Unpinned base image:** `Dockerfile:1` `node:22-alpine` is a floating tag (not `latest`, but not digest-pinned) → non-reproducible rebuilds.
- **Two drifting deploy paths:** CI inline script (`deploy.yml:40-78`) and `scripts/deploy.js` duplicate the same backup→pull→`compose up`→healthpoll logic; `deploy.js:9-10` hardcodes `jesse@jovial-penguin-1:2420`. In sync now, maintained separately.
- **Verify VPS `.env` is complete:** compose uses `env_file: .env` (`docker-compose.yml:6`); local `.env` has `TWILIO_PHONE_NUMBER`/`RESEND_API_KEY`/`FROM_EMAIL` empty. SMS/email paths gate on these (`services/twilio.js:9-11`, `services/email.js:10-11`).

### Verified OK (no action)
Container runs **non-root** (`Dockerfile:14-18`); **healthcheck** real (`Dockerfile:21-22` → `api/health.js`); **DB volume persisted** (`docker-compose.yml:11-12,38-39`); `NODE_ENV=production` set → HSTS on (`core/http.js:12-14`); image doesn't bake `.env`/`data` (`.dockerignore:3,8`); no `npm install` of real deps anywhere (zero-dep design honored); no secrets in git (`.env` gitignored) or echoed in deploy logs; TLS/redirects via Traefik labels (`docker-compose.yml:15-36`).

### Env vars: app needs vs Docker sets
Docker sets only `NODE_ENV`/`PORT`/`BASE_URL` (`docker-compose.yml:8-10`). `ADMIN_PASSWORD_HASH`, `TWILIO_*`, `RESEND_API_KEY`, `FROM_EMAIL` come via `env_file: .env` on the VPS only. `TRUSTED_PROXIES`/`TRUSTED_PROXY_DEPTH` set nowhere (see MEDIUM). `DATABASE_PATH` defaults to `/app/data/wedding.db` (correct, on the volume). `CONTACT_EMAIL`/`CSP_NONCE` use defaults.
