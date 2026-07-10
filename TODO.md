# Product Roadmap — Reusable Wedding-Site Platform

**North star:** turn this one couple's site into a self-hostable, no-code wedding-site
platform. A non-coder should be able to `docker run` the image, open a setup wizard, fill in
their names / schedule / registry, pick a look, and have a complete site — never touching
source. Everything below is a step toward that.

The foundation already exists: `content.js` is the single source of truth, all web-facing copy
is server-templated (`core/static.js`), and the full `SiteContent` is runtime-editable via an
`app_state` override (`core/site-content.js` + the admin "Site content" tab), stored **sparse**
so a saved site keeps tracking future default edits. The four tracks below build the rest.

Severity/effort tags: 🔴 large · 🟡 medium · 🟢 small.

---

## Track 1 — Finish content-as-data: migrate the remaining landing prose 🟡

Today `SiteContent` covers couple, date, location, registry, nav, and the welcome
heading/intro. The rest of the landing page is still hardcoded HTML in
`public/pages/index.html` — so a re-skinner still has to edit source for the biggest sections.
Migrate them into the `SiteContent` shape.

**What's still hardcoded (`public/pages/index.html`):**
- **Schedule** (`#schedule`, lines ~85–129): repeating `schedule-item`s — time, title, optional
  officiant/venue, address, one-or-more detail paragraphs, optional note.
- **Dress Code** (`#dress-code`, ~131–146): heading, a line of prose, and two figure images.
- **Section headings** ("Registry/Gifts", "Memories") and the footer event-details block.

**Approach:**
1. Extend `SiteContent` (`types.d.ts`) + defaults (`content.js`) with structured fields, e.g.
   `schedule: { title, items: [{ time, title, officiant?, venue?, address?, details: string[], note? }] }`
   and `dressCode: { title, body, images?: [...] }`. `diffFromDefaults` already handles arbitrary
   nesting + arrays, so sparse storage needs no changes.
2. Server-render the repeating structures into new tokens (`{{schedule}}`, `{{dressCode}}`) with a
   renderer that mirrors the existing `renderNav` pattern in `core/static.js` — escape every field
   the same way (nav labels/href are the reference). Decide per-field whether any need the
   trusted-HTML treatment `welcomeIntro` gets (default: escape everything).
3. Extend the admin **Site content** tab (`public/pages/admin/site-content.js`) with a repeatable
   schedule-item editor — reuse the nav-row editor already there as the template.
4. Add validators in `buildOverride` (`api/admin/site-content.js`) for the new fields (length caps,
   array bounds), matching the existing `reqStr`/`reqNav` style.

**Open decision — images.** Dress-code figures are fixed assets today. Either (a) keep images
fixed and make only text editable first (cheap), or (b) let admins upload them through the
existing media pipeline (richer, but couples the two systems). Recommend (a) now, (b) later.

**Why first:** Track 4 (no-code onboarding) can't capture "all site copy" until all site copy is
data. This unblocks it.

---

## Track 2 — Themeable effects: from one identity to a selectable set 🔴

The effect system is a clean registry (`EFFECT_DEFINITIONS` in `public/effects/main.js` +
per-effect `EFFECT_CONFIGS` + `EFFECT_PALETTE` in `config.js`) but it's hardwired to this
wedding's "disco-mermaid" look: `startEffects` (main.js:43) iterates the full effect list
unconditionally. Generalize into ~3 shippable **themes**, each bundling an effect subset + a
palette, with disco-mermaid as *one* option rather than the baked-in default.

**Approach:**
1. New `public/effects/themes.js`: `EFFECT_THEMES = [{ id, label, effectIds: [...], palette }]`.
   `EFFECT_DEFINITIONS` stays the full registry of *available* factories; a theme selects a
   subset by id.
2. `startEffects` resolves the active theme's `effectIds` → factories (from `EFFECT_DEFINITIONS`)
   instead of the hardcoded list.
3. Palette per theme: extend the CSS-token approach already in place (`--effect-brand[-dark]` in
   `tokens.css`, read by `config.js` + `celebrate.js`). A theme sets brand/accent tokens at boot;
   the JS palette (`EFFECT_PALETTE`) derives from them.
4. Make the active theme part of `SiteContent` (`theme: "mermaid-disco"`) so it's admin-selectable
   and captured by onboarding (Track 4). Default in `content.js`.
5. Author **≥2 more themes** beyond disco-mermaid — e.g. an *elegant/minimal* set (calm: sparkle
   dividers, name shimmer, subtle parallax) and a *none/quiet* set (no ambient effects). Curate
   effect subsets + palettes; verify each reads cleanly in light and dark.

**Already de-personalized (no action):** brand color is token-sourced; the studio's `Mermaid`/
`Disco` labels are effect *type* names; `name-shimmer.js`'s `.couple-names` binding is
content-templated. The real work here is the theme abstraction + authoring the alternates.

---

## Track 3 — Studio: live preview + promote-to-defaults 🟡

The effect studio (`/studio`, dev-only, prod-gated) tunes an in-memory config and only offers a
"Copy values" button (`studio.js:420`) that dumps a literal to the clipboard for manual paste
into `config.js`. Close both loops.

**3a — Live preview (per-browser, cheap):**
- Add `getEffectiveConfig(id)` = deep-merge of a `localStorage` override over `getDefaultConfig(id)`
  (`config.js`). `startEffects` (main.js:53) calls `getEffectiveConfig` instead of
  `getDefaultConfig`. The studio writes the tuned config to that `localStorage` key on change, so
  the tuner's *own* browser sees tuned values on the real pages — no rebuild.
- Studio buttons: "Save to my browser" + "Reset" alongside the existing "Copy values".

**3b — Promote to defaults (everyone sees it):** two options —
- **(Recommended) `app_state` override**, mirroring `site_content`: an `effect_config` key resolved
  server-side, edited from an admin "Effects" tab, served to the client. Consistent with the
  existing content-override architecture and directly reusable by the no-code product (admins tune
  effects without touching source). Effects read effective config = defaults ⊕ `app_state` override.
- **(Alternative) dev-only save endpoint** (non-production-gated) that rewrites `EFFECT_CONFIGS` in
  `config.js` — simpler mentally, but writes source and only helps a developer, not a self-hoster.

Recommend the `app_state` route: it turns studio tuning into a real product feature and reuses the
override + resolve + cache-evict machinery already built for site content.

---

## Track 4 — No-code onboarding wizard + shipped container 🔴 (capstone)

The payoff. A non-coder self-hoster runs the container, opens a setup wizard, and produces a
complete site entirely through forms. Depends on Tracks 1–3 (all copy is data, theme is
selectable, effects are tunable via `app_state`).

**Approach:**
1. **Replace the CLI admin-password setup.** Today `scripts/setup-admin.js` prompts on the
   terminal, hashes with scrypt, writes `ADMIN_PASSWORD_HASH=` into `.env`, and needs a **server
   restart** to take effect — a file-write + restart model a containerized no-code flow can't use.
   Move the admin hash into `app_state` (the same runtime-override store as `site_content`): the
   web wizard sets/changes the password live, no file, no restart. `core/auth.js` reads the hash
   from `app_state` first, falling back to the `ADMIN_PASSWORD_HASH` env var for backward compat.
   Reuse the existing scrypt hashing + `validatePasswordStrength` (lift them out of
   `setup-admin.js` into a shared module). The CLI script stays only as an optional fallback for
   advanced/headless setups (and as a way to generate a hash for CI — see DEFERRED "admin tests
   skip in CI").
2. **First-run detection:** no admin hash in `app_state`/env *and* no `site_content` override →
   route to a web `/setup` wizard; gate it so it disables itself once setup completes.
3. **Wizard steps** (each writes a sparse `app_state` override): set admin password → couple/date/
   location → schedule + dress code → registry → **theme pick** (Track 2) → nav → review & finish.
4. **De-personalize the shipped defaults:** `content.js` defaults should become *generic sample
   copy*, not "Jordana & Jesse". This couple's real content moves into a seed/override (or an
   `app_state` export). A fresh install then starts neutral and is filled entirely via the wizard.
   *(This is a deliberate cut-over — do it as the last step so nothing regresses meanwhile.)*
5. **Ship a runnable image:** the `Dockerfile` exists; publish a tagged image + a short
   "self-host in 5 minutes" doc (`docker run …` → open `/setup`). Keep the zero-dependency,
   Node-22-native constraints.

**Boundary already documented:** email/SMS constants (`types.js` `WEDDING` / `EMAIL_SUBJECTS`) stay
boot-resolved from defaults. If the wizard should own those too, lift them into the override at
this stage.

---

## Sequencing

```
Track 1 (content-as-data) ─┐
Track 2 (themes) ──────────┼──► Track 4 (no-code wizard + container)
Track 3b (effect app_state)┘
```

- **Track 1** and **Track 3a** (live preview) are independent and cheap — good warm-ups.
- **Track 2** is the biggest single lift (authoring alternate themes takes design taste, not just
  code).
- **Track 4** is the capstone; start it only once 1, 2, and 3b land, since it stitches them into
  one flow.
