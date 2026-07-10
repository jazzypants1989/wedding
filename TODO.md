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

**Phase 1a — text migration: ✅ DONE.** All hardcoded landing copy now lives in `SiteContent`
and is admin-editable: schedule, dress-code prose, registry body + frame-note, memories, every
section heading, and the footer event heading (was: only couple/date/location/registry-url/nav/
welcome). Rendering is byte-identical to the old static HTML (verified). Landed:
`schedule`/`dressCode`/`registry.{title,body,frameNote}`/`memories`/`footer.eventHeading` +
`SiteContentScheduleItem`/`SiteContentImage` in `types.d.ts` + `content.js`; `renderSchedule` /
`renderDressCodeImages` next to `renderNav` in `core/static.js`; `reqSchedule`/`reqDressCode`/
`reqContentImage` validators in `api/admin/site-content.js`; a repeatable schedule-item card
editor in the admin **Site content** tab; integration coverage for the new validators + rendering.

Key facts that shaped it (for anyone extending):
- **Mode visibility is pure CSS** (`components.css` `[data-mode]`): pre hides `#memories`, post
  hides `#schedule`/`#dress-code`. So the new fields are **mode-agnostic single values** — the CSS
  keeps gating. Only the existing welcome `copy.pre/post` stays mode-aware.
- Repeating structures render via `{{schedule.items}}` / `{{dressCode.images}}` block-tokens
  (function-rendered like `{{nav.*}}`), not scalar tokens. Everything is `escapeHtml`'d.
- **`SiteContentImage` is an origin-agnostic descriptor** (`{ src, srcset?, sizes?, alt,
  caption?, width?, height? }`): defaults point at the static `/images/*` assets with their
  hand-authored srcset; a media-backed descriptor points at `/media/{file_key}/…`. The renderer
  never branches on origin.

**Phase 1b — dress-code images through the media pipeline: remaining.** Decided (with the
user): admin-uploaded dress-code images go through the existing media pipeline, gated by a new
**`section='content'`** (schema/trigger migration; gallery feeds already filter by `official`/
`guest`, so `content` is excluded from the gallery for free). Add a **responsive width ladder**
(e.g. `w400`/`w800`/`w1600`) **scoped to `section='content'` uploads only** — the guest gallery
keeps `display`+`thumb` to contain storage. Then a dress-code image manager in the Site-content
tab (reuse the `media-uploader` component; store the returned `file_key`-based descriptor with
admin-entered alt/caption). Files: `types.js` (VARIANT_SPEC, section enum), `db/schema.js`,
`db/media.js` (BYTES_COLUMN), `api/media.js` (putVariant/finalize `requiredVariants` by section),
`core/media-storage.js`, `core/media-serve.js`, `public/components/media-uploader.js`.
*Note:* this couple's current images are ≤800px, so `display`+`thumb` already reproduce their
srcset — the ladder is really for future large uploads / the no-code product.

**Not a security fix:** `copy.welcomeIntro` is injected raw (`RAW_TOKENS`) on purpose so the
couple can use inline `<em>`. Under the trust model (single deployment, two co-admins who are
the couple, no untrusted input) that's safe — do **not** add HTML-sanitization there. All *new*
fields are escaped by default (nothing new in `RAW_TOKENS`).

**Why first:** Track 4 (no-code onboarding) can't capture "all site copy" until all site copy is
data. Phase 1a unblocks it.

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
   the JS palette (`EFFECT_PALETTE`) derives from them. **Caveat (verified): the palette is only
   *partially* token-derived today.** Only `EFFECT_PALETTE.brand` comes from a token;
   `gold/white/blush/pink/sky/purple` are hardcoded literals, and many `EFFECT_CONFIGS` color
   arrays are raw `rgba(...)` strings (disco, reflections, spotlight). A real per-theme palette
   requires **de-hardcoding these into token-driven values first** — this is the bulk of the
   palette work, not "set two tokens at boot."
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

**Pre-step worth doing first — generalize the override store.** `core/site-content.js` is a
bespoke resolver hardcoded to the `site_content` key. Both 3b (`effect_config`) and Track 4 (the
admin hash) want the *same* override + diff + resolve + cache-evict machinery. The helpers
(`deepMerge`, `diffFromDefaults`) are already exported and generic — they just default their base
to `CONTENT_DEFAULTS`. Extracting a `createOverrideStore(key, defaults, onChanged)` factory turns
three copy-pasted resolvers into one and directly serves the no-code product. Cheap, high-leverage.

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
   web wizard sets/changes the password live, no file, no restart. Reuse the existing scrypt
   hashing + `validatePasswordStrength` (lift them out of `setup-admin.js` into a shared module;
   note `hashPassword` lives in `core/auth.js` but isn't exported, and `validatePasswordStrength`
   exists only in `setup-admin.js`). The CLI script stays only as an optional fallback for
   advanced/headless setups (and as a way to generate a hash for CI — see DEFERRED "admin tests
   skip in CI").
   **⚠ Behavioral change, not just a new key:** `SERVER.adminPasswordHash` is *frozen at boot*
   from `process.env` (`types.js`), and the login path reads that snapshot (`api/admin/sessions.js`).
   Moving the hash to `app_state` means login must read it at **request time**, not from the boot
   snapshot — rewire those consumers, keeping the env var as a fallback for backward compat.
2. **First-run detection:** no admin hash in `app_state`/env *and* no `site_content` override →
   route to a web `/setup` wizard; gate it so it disables itself once setup completes.
   **⚠ First-run security:** an open `/setup` on a public container URL is an admin-takeover race —
   whoever hits it first claims the site. Solve it the way self-hosted apps do: print a **one-time
   setup token** to stdout/logs on first boot (the Jenkins `initialAdminPassword` pattern) and
   require it to complete setup. Design this in, don't discover it in production.
3. **Wizard steps** (each writes a sparse `app_state` override): set admin password → couple/date/
   location → schedule + dress code → registry → **theme pick** (Track 2) → nav → review & finish.
4. **De-personalize the shipped defaults:** `content.js` defaults should become *generic sample
   copy*, not "Jordana & Jesse". This couple's real content moves into a seed/override (or an
   `app_state` export). A fresh install then starts neutral and is filled entirely via the wizard.
   *(This is a deliberate cut-over — do it as the last step so nothing regresses meanwhile.)*
5. **Ship a runnable image:** the `Dockerfile` exists; publish a tagged image + a short
   "self-host in 5 minutes" doc (`docker run …` → open `/setup`). Keep the zero-dependency,
   Node-22-native constraints.

**Boundary — and a correctness bug in waiting:** email/SMS constants (`types.js` `WEDDING` /
`EMAIL_SUBJECTS`) are boot-resolved from `content.js` **defaults**, not the effective override.
For *this* couple that's harmless, but an onboarded self-hoster who sets their names via the
wizard would still send invites/SMS signed with the shipped sample couple's name. So for the
no-code product this isn't optional polish — wire these to the resolved (effective) content at
this stage.

---

## Sequencing

```
Track 1a ✅ ── Track 1b (media) ─┐
Track 2 (themes) ────────────────┼──► Track 4 (no-code wizard + container)
override-store → Track 3b ───────┘
```

- **Track 1a** (text migration) has landed. **Track 1b** (media-pipeline dress-code images),
  **Track 2** (themes), and **Track 3a** (live preview) are the independent remaining pieces —
  Track 2 and Track 3 are being taken up in parallel worktrees.
- The **override-store generalization** (Track 3b pre-step) is cheap and unblocks both 3b and
  Track 4's admin-hash move — do it before either.
- **Track 2** is the biggest single lift (authoring alternate themes takes design taste, not just
  code) — and remember the palette is only partially token-derived today (see Track 2 caveat).
- **Track 4** is the capstone; start it only once 1, 2, and 3b land, since it stitches them into
  one flow.
