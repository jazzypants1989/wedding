# TODO — Portfolio Foundation Pass

Three items pulled out of `DEFERRED.md` to be designed and built now, while doing a
portfolio-readiness cleanup. **Context:** the guestbook + gallery are built but **not yet live** on
the public site — the plan is more polish first, then launch. Since we're in here anyway, this pass
does the foundational refactors that make the codebase reusable and portfolio-grade rather than a
one-off.

The three, in build order:

1. **Content-config + timeline mode** — externalize all wedding-specific copy into one source and add
   a pre-/post-wedding mode. (DEFERRED §14 MVP; also resolves §5.3 tense + §15 footer.)
2. **`doctor` preflight script** — one zero-dep tool that kills the config-drift bug class. (DEFERRED
   §4/§1/§6 consolidation.)
3. **Architecture doc + Apache-2.0 license** — cheap, high-signal portfolio wins. (DEFERRED §13.)

Project constraints that bind all three: **zero runtime deps**, **no regex anywhere**, Node 22+, ESM
only with `.js` import extensions, JSDoc-typed and clean under both `tsc` configs. Match surrounding
style.

---

## 1. Content-config + timeline mode (DEFERRED §14 MVP)

### Why

Wedding-specific copy is hardcoded across HTML and JS (couple names, date, schedule, dress code,
registry link, page headings, footer). Two problems today:

- **Correctness:** the landing copy still reads pre-event ("Please join us…", the Schedule, "Wearing
  pink is encouraged") even though `countdown.js` and the Memories section already flipped to a
  post-wedding voice. A visitor gets mixed tense. (This is DEFERRED §5.3.)
- **Reusability:** none of it can be changed without editing source, so the repo is a one-off, not the
  self-hostable product DEFERRED §14 envisions.

The MVP here is small and independently valuable, and it's the data model everything else (§9 themes,
§10 studio-writes-config, the eventual no-code onboarding forms) will build on: **app content should be
data, not hardcoded strings.**

### The core idea: content as data + a timeline mode

Two pieces:

1. **A single content source** — every user-facing wedding string lives in one typed object.
2. **A timeline `mode`** — `"pre"` or `"post"`, derived from the wedding date (with an env override for
   preview), that selects which copy variant and which nav layout to show.

Countdown already does a mini version of this (it flips at the date). Generalize that one decision into
a site-wide mode instead of a per-component special case.

### Content schema (first cut)

Start with a checked-in, typed module `content.js` at the repo root (single source of truth, type-safe,
zero-dep). Design the shape so it can later be backed by the **existing `app_state` table** (see
Phasing) without callers changing.

```js
// content.js
/** @import * as Types from './types.js' */

/** @type {Types.SiteContent} */
export const CONTENT = Object.freeze({
  couple: {
    display: "Jordana & Jesse",       // canonical form (h1s, titles)
    monogram: "J&J",                  // mobile-logo, x4 pages
    fullNames: ["Jordana North", "Jesse Pence"], // meta description + registry slug
  },
  weddingDate: "2026-04-26T11:00:00-07:00", // ISO w/ start time + PDT offset; drives countdown AND mode
  weddingDateDisplay: "April 26, 2026",     // human string (8 hardcoded spots today) — or derive from ISO
  location: "Portland, OR",
  registry: { url: "https://www.honeyfund.com/site/north-pence-04-26-2026", label: "Open registry in a new window" },
  contactEmail: null, // null → fall back to SERVER.contactEmail (env), matching lightbox.js today
  // Copy that differs by timeline mode:
  landing: {
    pre:  { heroTagline: "Please join us…", dressCode: "Wearing pink is encouraged, but not required :)" },
    post: { heroTagline: "We're married! 💍", memoriesBody: "The big day has come and gone — relive it with us!" },
  },
  // Nav is duplicated 3×/page × 4 pages today — centralize it here:
  nav: {
    pre:  [{ href: "/", label: "Home" }, { href: "#schedule", label: "Schedule" }, { href: "/rsvp", label: "RSVP" }, /* … */],
    post: [{ href: "/", label: "Home" }, { href: "/guestbook", label: "Guestbook" }, { href: "/gallery", label: "Gallery" }],
  },
  footer: { githubUrl: "https://github.com/jazzypants1989/wedding" }, // null → hide link
})
```

The couple name needs **three** sub-fields, not one — the inventory found the display form
(`Jordana & Jesse`), a monogram (`J&J`, on 4 pages), and full legal names (meta + the registry URL
slug), plus a stray *reversed* `Jesse & Jordana` in the demo. Deriving `weddingDateDisplay` from the ISO
`weddingDate` (with `toLocaleDateString`) would remove the human/machine split entirely — recommended.

Declare `SiteContent` (and the nested shapes) in root `types.d.ts` so both server and any content-driven
frontend import one definition — same pattern the entity types already use.

### Timeline mode

```js
// derived, not stored
export function getTimelineMode(now = Date.now()) {
  if (process.env.SITE_MODE === "pre" || process.env.SITE_MODE === "post") return process.env.SITE_MODE
  return now < Date.parse(CONTENT.weddingDate) ? "pre" : "post"
}
```

- `SITE_MODE` env override lets the owner preview either mode regardless of the date (add to
  `.env.example` — and the `doctor` script in item 2 will then know about it).
- Nav bar and landing copy both switch on `mode`. This subsumes the countdown's ad-hoc flip and gives a
  single, testable source of truth.
- **§15 (footer consistency) falls out of this for free:** render the footer from `CONTENT.footer` on all
  four guest pages, so they stop drifting and the GitHub link becomes one config toggle (`null` to hide).

### Delivery mechanism (the real decision)

The pages are static HTML progressively enhanced by JS. Two options for getting content in:

- **(A) Client-fill via `/api/config`** — extend the existing `api/config.js` (which already returns
  `features` + `contactEmail`) to also return `content` + `mode`; JS populates the DOM on load. Lowest
  effort, reuses the existing endpoint and the existing `<noscript>` fallbacks. **Cost:** a brief FOUC on
  the landing hero (placeholder → real copy) and the countdown already has this shape anyway.
- **(B) Serve-time templating in `core/static.js`** — replace `{{placeholders}}` in the HTML as it's
  served. No FOUC, SEO-clean. **Cost:** adds a templating step to the static path (must stay no-regex —
  `split`/`join` on a delimiter), and complicates caching / the CSP hash mode.

**Recommendation:** ship **(A)** for the MVP (it matches how countdown/config already work and keeps
`static.js` simple), and note (B) as a future upgrade if FOUC or SEO on the landing page becomes a
concern. Keep the `<noscript>` blocks accurate under (A).

### Phasing

- **Phase A — MVP (this pass):** `content.js` + `getTimelineMode()` + `SiteContent` types; wire the
  landing page, nav, and footer to read from it; extend `/api/config`. Deletes the hardcoded-copy
  problem and closes §5.3 + §15. **This is the scope for now.**
- **Phase B — runtime-editable:** move content into the **`app_state` table** (already exists) behind the
  same `SiteContent` shape, and add an admin "Site content" tab to edit it. No caller changes if the
  schema held.
- **Phase C — no-code product (DEFERRED §14 full):** a first-run onboarding wizard that writes
  `app_state`, plus a shipped Docker image, so a non-coder self-hoster fills forms and never touches
  source. Depends on §9 (de-personalized/themeable effects) and §11 (gate `/studio` + `/demo`).

### Migration inventory (where the hardcoded copy lives today)

From a full codebase sweep, ranked by duplication (highest-value to centralize first):

1. **Couple names — ~14 occurrences**, several with variant forms. Canonical `Jordana & Jesse` in
   `index.html:7,77`, gallery/guestbook/rsvp `index.html:7,8,34`, `rsvp/index.html:198`; monogram `J&J`
   in `.mobile-logo` on all 4 pages; full names `Jordana North` / `Jesse Pence` only in
   `index.html:8` meta + the registry URL slug; the moderation-approve sentence repeats the names in
   `auth-sheet.js:81`, `gallery/upload.js:176`, `guestbook/feed.js:147`. **Inconsistencies to fix on
   the way:** img-alt/meta say `Jordana and Jesse`, the demo says the *reversed* `Jesse & Jordana`.
2. **Wedding date — human string `April 26, 2026` in 8 spots** (`index.html:7,8,78,206`, gallery/
   guestbook/rsvp `:35`, `rsvp:8`) **+ the machine form** `new Date("2026-04-26T11:00:00-07:00")` in
   **`public/pages/countdown.js:11`** (date + start time + PDT offset baked in). One source, derive both.
3. **Location `Portland, OR`** — 6 spots (every `wedding-info` line + meta).
4. **Nav link list** — duplicated **3× per page (mobile/desktop/footer) × 4 pages**, and the source of
   the **§15 GitHub-link inconsistency**: present in `index.html:218` + `rsvp/index.html:225`, absent in
   `guestbook/index.html:132-142` + `gallery/index.html:151-161`.
5. **Registry Honeyfund URL** — same URL hardcoded **twice** in `index.html` (fallback link `:186` +
   iframe `data-src :189`).
6. **Schedule** (`index.html:100-156`) and **Dress Code** (`index.html:160-171`) — landing-only prose
   (venues, addresses, times, officiant/host names). Bulkier; candidates for Phase B, not the MVP.
7. **Per-page headings/body** — Memories `index.html:196-201`, guestbook `:92-93`, gallery `:92`, RSVP
   greeting/intro, auth-sheet copy `auth-sheet.js:78-96`, `<noscript>` blocks. Mostly Phase B.

**Effects branding** (DEFERRED §9, out of scope here but note the coupling): `EFFECT_PALETTE.brand`
(`effects/config.js:9-17`), `name-shimmer.js:23` binds to the `.couple-names` element, and the
`Disco`/`Mermaid` labels are dev-facing (`studio/controls.js`) not guest copy.

**Precedent to match:** the gallery report-photo contact address is already externalized via
`/api/config` (`lightbox.js:18-27`) — so option (A) above isn't new machinery, it extends an existing
pattern. Align the `contactEmail` field with it.

### Open questions

- **Scope of the MVP surface:** recommend centralizing only **couple names + date + location + nav +
  footer + registry URL** (items 1–5 — the high-duplication facts) for the MVP, and leaving the bulkier
  landing Schedule/Dress-Code prose and per-page body copy (items 6–7) hardcoded until Phase B. That
  kills the worst duplication and both §5.3/§15 without turning into a full copy migration.
- **Derive or store the human date?** Recommend deriving `April 26, 2026` from the ISO `weddingDate` via
  `toLocaleDateString`, eliminating the 8-spot human/machine split rather than storing both.

### Definition of done (MVP)

- All landing/nav/footer wedding copy sourced from `content.js`; no wedding-specific literals left in
  the landing HTML/JS for those surfaces.
- `getTimelineMode()` drives landing copy + nav + countdown from one place; `SITE_MODE` override works.
- Footer renders from config identically on all four guest pages.
- `SiteContent` typed in root `types.d.ts`; both `tsc` configs clean.
- A unit test for `getTimelineMode()` (pre/post/override) and an integration assertion that
  `/api/config` returns `content` + `mode`.

---

## 2. `doctor` preflight script (DEFERRED §4 / §1 / §6)

### Why

Three separate DEFERRED items are the same root cause — **live config silently drifts from what the
code needs**, and the failure is invisible until something breaks in production:

- §4: working `.env` missing documented keys (`CONTACT_EMAIL`, `TRUSTED_PROXIES`, `NODE_ENV`,
  `MEDIA_*_BYTES`) — and, found this pass, `CSP_NONCE` is read in `types.js` but absent from
  `.env.example` (drift the other way).
- §1: `TRUSTED_PROXIES` unset behind Traefik → all guests collapse into one rate-limit bucket (one
  looping client can lock out the whole guest list — a self-inflicted DoS, not just a metric).
- §6: media deploy thresholds / disk headroom not verified before go-live.

A single zero-dep `npm run doctor` that *detects* the whole class is more leverage than filling keys by
hand once, and it's exactly the kind of no-dep tool this repo favors. It also becomes a launch-checklist
you can actually run.

### What it checks

Grouped output with `✓ / ⚠ / ✗` and a meaningful exit code (0 = ok, non-zero = has ✗):

1. **`.env` ↔ `.env.example` diff** — keys in the example missing from `.env` (⚠), and keys the code
   reads that are in neither (there's a known one: `CSP_NONCE`). Parse both by splitting lines on the
   first `=`, ignoring blank/`#` lines. **No regex.**
2. **Prod-required** (when `NODE_ENV=production`): `TRUSTED_PROXIES` set (✗ if not — this is §1),
   `ADMIN_PASSWORD_HASH` set, `BASE_URL` not `localhost`.
3. **Weak/placeholder values:** `contactEmail` still the `contact@example.com` default (⚠),
   `TEST_ADMIN_PASSWORD` present under prod (✗), obviously-placeholder Twilio/Resend values.
4. **Disk headroom (§6):** `fs.statfs()` on the uploads dir vs `MEDIA_MIN_FREE_BYTES`; warn if the box
   is already below the guard, and echo the three `MEDIA_*` values in effect.
5. **Runtime:** Node `>= 22` (matches `engines` + `.nvmrc`); optionally DB reachable + migrations
   current.

### Design

- `scripts/doctor.js`, wired as `"doctor": "node scripts/doctor.js"` in `package.json`.
- Reuse/absorb the `RECOMMENDED_ENV_VARS` knowledge already in `core/env.js` so there's one list of
  "what matters," not two. `env.js` warns at boot; `doctor` gives the full report on demand.
- Pure Node built-ins (`node:fs`, `node:os`, `node:path`). String parsing only — no regex.
- Human-readable by default; consider a `--json` flag later for CI.

### Bundled code fix — §1 rate-limit CIDR (do alongside)

The `doctor` script *detects* the `TRUSTED_PROXIES` gap; the actual *fix* is a small code change so the
gap can't bite behind Docker: extend `getClientIp` (`core/rate-limit.js`) to trust the **RFC-1918
private ranges** via integer octet math (parse IP → 32-bit int, compare against `10/8`, `172.16/12`,
`192.168/16`). Safe because the container is only reachable through Traefik on the private Docker
network, and it removes the brittle "pin a static Traefik IP" deploy step entirely. No-regex (octet
`split(".")` + `Number`). Keep `TRUSTED_PROXIES` as an explicit override.

### Definition of done

- `npm run doctor` runs clean on a well-configured `.env`, and flags each seeded problem (remove a key,
  set a placeholder, run under `NODE_ENV=production` without `TRUSTED_PROXIES`) with the right severity
  and exit code.
- `CSP_NONCE` and `SITE_MODE` (from item 1) added to `.env.example`.
- `getClientIp` trusts RFC-1918 by default; a unit test covers in-range / out-of-range IPs.
- Both `tsc` configs clean; a unit test for the `.env` diff parser.

---

## 3. Architecture doc + Apache-2.0 license (DEFERRED §13)

### Why

Cheap, high-signal portfolio wins. The richest architecture doc (`CLAUDE.md`) is **gitignored and
untracked**, so a visitor to the repo sees none of the thinking. And there's no license file — worse,
`package.json` currently says `"license": "ISC"`, which contradicts the owner's intended Apache-2.0.

Per the owner: **no heavyweight `CONTRIBUTING` doc** ("be nice" covers it) — the valuable pieces are a
tracked architecture doc and a correct license.

### Architecture doc

- Add `docs/architecture.md`, distilled from `CLAUDE.md` but **public-safe** (no secrets, no VPS
  hostnames/ports, no admin surface hints beyond what's already public).
- Suggested sections: project one-liner + the two hard constraints (**zero-dep**, **no-regex**) and why
  they're interesting; request lifecycle (`server.js` → `core/router.js` → handler); the data model +
  SQLite-via-`node:sqlite` + trigger-enforced invariants; the media pipeline (streaming upload → sniff →
  variants → Range/206 serve → GPS blanking); auth (admin sessions + guest accounts + magic-link
  recovery); and **"full type safety without TypeScript compilation"** (the `checkJs` + JSDoc story) —
  that last one is a genuine portfolio talking point.
- Link it from `README.md` (a short "Architecture" section pointing to the doc), addressing DEFERRED §4.4
  README-quality notes too.

### License

- Add a top-level `LICENSE` file with the standard **Apache-2.0** text.
- Change `package.json` `"license": "ISC"` → `"Apache-2.0"`.
- Optional: an SPDX header convention note in the architecture doc; a `NOTICE` file only if we want
  attribution boilerplate (probably skip for a personal project).
- This is also a prerequisite for the DEFERRED §14 "others can self-host" direction — you can't ship a
  reusable product without a clear license.

### Definition of done

- `docs/architecture.md` committed and linked from `README.md`; contains no secrets/hosts.
- `LICENSE` (Apache-2.0) present; `package.json` license field matches.
- `CLAUDE.md` stays as the internal/agent doc; the public architecture doc is the tracked, sanitized
  distillation (not a copy-paste — trim maintainer-only + deploy-secret content).

---

## Sequencing note

Item 1 introduces `SITE_MODE` and item 2's `doctor` should know about it, so build **1 before 2** (or add
the env key first). Item 3 is independent and can land anytime. None of these touch live guest data — the
guestbook/gallery aren't public yet — so they're safe to iterate on before launch.
