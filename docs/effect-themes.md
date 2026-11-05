# Effect Themes

The visual-effect system ships a **menu of themes** rather than one baked-in
look. A theme picks a *subset* of the shared effect registry plus optional
per-effect config overrides and a brand color, so a re-skinner (or the future
no-code onboarding wizard, TODO.md Track 4) selects an identity instead of
editing source. This is Track 2 of the reusable-platform roadmap.

## How it fits together

| Concern | Lives in | Notes |
|---|---|---|
| Available effects | `public/effects/main.js` `EFFECT_DEFINITIONS` | Full registry `[{ id, create }]` of every factory. |
| Themes | `public/effects/themes.js` `EFFECT_THEMES` | `{ id, label, effectIds[], configs? }`. A theme selects a subset by id. |
| Effective config | `public/effects/config.js` `getEffectiveConfig(id)` | `defaults ⊕ activeTheme.configs[id] ⊕ localStorage["effect-config-override"][id]` (localStorage wins). No-regex deep-merge; corrupt JSON ignored. |
| Which effects run | `public/effects/main.js` `startEffects` | Resolves `getActiveTheme().effectIds` against the registry (order preserved, unknown ids skipped), then keeps those whose registry limit and effective `pages` key both allow this page. A missing `pages` means the landing page; see `DESIGN-SLOTS.md`. |
| Brand color | `public/styles/tokens.css` `:root[data-effect-theme="…"]` | Per-theme `--effect-brand[-dark]`. Flat `rgb()` form (so `brandAlpha` string-swap works; no `light-dark()` so effect colors don't shift in dark mode). Default `mermaid-disco` keeps the `:root` values. |
| Active theme selection | `SiteContent.theme` → server → `<html data-effect-theme>` | `content.js` default; `core/static.js` renders the `effectTheme` token; read on the client by `getActiveThemeId()`. |
| Admin picker | `public/pages/admin/site-content.js` + `api/admin/site-content.js` | `<select>` populated from `EFFECT_THEMES`; server validates against a `THEME_IDS` allowlist. |

Only the home page runs the ambient effect manager; `celebrate.js` (confetti)
reads `--effect-brand` on home/gallery/guestbook/rsvp — so `data-effect-theme`
is rendered onto all four pages' `<html>`.

## Shipped themes

- **mermaid-disco** (default) — the original full look (all 10 disco-era effects).
- **romantic** — `petals`, `hearts`, `namespark`(pink), `shimmer`(sunset), `dividers`, `entrance`; rose brand.
- **elegant** — `dust`, `namespark`(gold), `dividers`, `parallaxsparkles`(gold, sparse); champagne brand.
- **classic** — `namespark`(white) + faint `dividers`; near-quiet baseline; neutral brand.
- **celestial** — `starfield`, `shootingstars`, `aurora`, `namespark`(white), `dividers`; indigo brand.
- **garden** — `fireflies`, `leaves`, `petals`(blossom recolor), `namespark`(gold), `dividers`; green brand.
- **winter** — `snow`, `frost`, `namespark`(white), `dividers`; icy-blue brand.
- **coastal** — `bubbles`, `caustics`, `shimmer`(ocean), `namespark`(white), `dividers`; teal brand.

### Known limitation — light page background

The page background is a fixed light cream (not theme-driven — see *Palette depth*
below). So the pale, cool effects (`starfield`, `snow`, `bubbles`) read as soft
glimmers rather than bright marks against a night/ocean backdrop; the warm,
saturated themes (romantic, garden, elegant, mermaid-disco) pop hardest. Making
the page background theme-driven is the deferred palette-depth work.

## Adding an effect

New effects follow the factory contract `create(config) → { start, stop }`,
building DOM under an `.effect-layer` container (reuses `--z-effect-layer`),
animated by `effects.css`, using the shared helpers (`isMobile`, `randomFrom`,
`randomBetween`, `EFFECT_PALETTE`). Prefer pure CSS animation (like
`rose-petals`/`golden-dust`) over rAF where possible. Checklist:

1. `public/effects/<name>.js` — the factory. Scale density by `isMobile()`.
2. `public/effects/config.js` — an `EFFECT_CONFIGS` entry (its `defaults`).
3. `public/effects/main.js` — register `{ id, create }` in `EFFECT_DEFINITIONS`.
4. `public/effects/types.d.ts` — a `<Name>Config` interface + `create<Name>` signature.
5. `public/styles/effects.css` — the CSS block + keyframes; add the container class to the `@media print` hide list.
6. Add the id to a theme's `effectIds` (and optional `configs`) to make it run.

## Adding a theme

1. Append an entry to `EFFECT_THEMES` in `public/effects/themes.js` (id, label, effectIds, optional configs).
2. Add a `:root[data-effect-theme="<id>"]` brand block in `tokens.css` (skip if the default brand fits).
3. Add the id to `THEME_IDS` in `api/admin/site-content.js` (server can't import the browser module).
4. The admin dropdown updates automatically (it renders from `EFFECT_THEMES`).

## Hand-off catalog (future agents)

### Effects now built (ids in parens)

`starfield` (starfield), `shooting-stars` (shootingstars), `aurora-wash` (aurora),
`fireflies` (fireflies), `falling-leaves` (leaves), `snowfall` (snow),
`frost-shimmer` (frost), `bubbles-rising` (bubbles), `water-caustics` (caustics —
its CSS/type pre-existed; the factory is now built). All four catalog themes
(garden, celestial, winter, coastal) ship.

### Effects still to author

- **Romantic / Garden:** `warm-bokeh` (soft candlelight orbs), `dandelion-seeds`.
- **Celestial / Night:** `constellation-lines` (faint lines linking nearby stars).
- **Elegant extras:** `corner-flourish` (animated gold filigree in page corners, pure CSS), `soft-vignette-glow` (gentle breathing radial glow).

`aurora-wash` carries `polar` and `dusk` palettes beyond the default `aurora` —
reuse it for a future dusk/twilight theme instead of authoring a new gradient
effect.

### Palette depth (deferred)

Today a theme customizes color via one `--effect-brand` token plus per-effect
`configs` (leveraging the factories' `colorScheme`/`colorPalette`/`shimmerColor`
switches). The hardcoded accents in `EFFECT_PALETTE` (gold/pink/sky/blush/purple)
and the raw `rgba()` arrays in `disco`/`reflections`/`spotlight` are **not**
theme-driven. If a future theme needs a fully distinct accent palette, promote
those to `--effect-*` tokens per theme and add a no-regex `alpha(color, a)`
helper handling both hex and `rgb()` inputs.

### Related

- **Track 3b** (server-side `app_state` `effect_config` override + admin
  "Effects" tab) is the promote-studio-tuning-to-everyone path — out of scope
  here; should reuse a future generic `createOverrideStore`. The **read** side
  (`getEffectiveConfig` + the `effect-config-override` localStorage contract) is
  already live for Track 3a's per-browser live preview.
