# Lighthouse / CWV Optimization Changes

## Layout fix

- **Added `height: auto` to the `img, picture` reset in `layout.css`** — The previous optimization pass added `width`/`height` HTML attributes to images for CLS prevention, but the CSS only had `max-width: 100%` without `height: auto`. This caused images (especially in the dress code gallery) to render at intrinsic size instead of scaling within their container. One line fix.

## Render-blocking resources (est. 830ms savings)

- **Self-hosted Google Fonts** — Downloaded DM Serif Display and Jost woff2 files to `public/fonts/`. Added `@font-face` declarations with `unicode-range` subsetting to `tokens.css`. Removed the external Google Fonts `<link>` and `preconnect` hints from all three HTML pages. Eliminates the render-blocking cross-origin CSS request and its chained font file downloads.

- **Font preloading** — Added `<link rel="preload">` for the latin woff2 subsets of both fonts so the browser starts downloading them immediately rather than waiting for CSS parsing.

## Inline theme-init with CSP support

- **Inlined `theme-init.js` at serve time** — The 4-line theme initialization script was a render-blocking request. The server now replaces the `<script src>` tag with an inline `<script>` when serving HTML, eliminating the network round-trip.

- **Configurable CSP strategy (`CSP_NONCE` env var)** — Two modes:
  - **Hash mode (default):** Static CSP with `script-src 'self' 'sha256-...'`. The inline script is allowed by its content hash. HTML ETag and gzip caching work normally.
  - **Nonce mode (`CSP_NONCE=true`):** Per-request nonce in `script-src 'self' 'nonce-xxx'`. For projects with dynamic inline scripts. Disables HTML caching since content changes per request.

- **Updated CSP directives** — Removed `fonts.googleapis.com` from `style-src` and `fonts.gstatic.com` from `font-src` since fonts are now self-hosted.

## Responsive images (est. 95 KiB savings)

- **Generated multiple sizes from original assets** — Used `cwebp` to create responsive webp images from the full-resolution originals recovered from git:
  - Hero/footer images: 414w, 828w (mobile), 768w, 1440w, 2880w (desktop)
  - Dress code images: 400w (1x), 800w/736w (2x)
  - Couple photo: 240w (1x), 480w (2x)

- **Added `srcset` and `sizes` to all images** — Browser picks the smallest image that fits the viewport and pixel density. Reduces download size significantly on mobile (e.g., 9 KiB instead of 65 KiB for dress code images on a phone).

- **Updated image preload hints** — Switched from single `href` to `imagesrcset`/`imagesizes` so the preloaded hero image matches what the browser would select from srcset.

## Deferred effects stylesheet

- **Loaded `effects.css` as `media="print"`** — Moved the effects stylesheet out of the critical render path. `main.js` swaps it to `media="all"` when the effect manager initializes, so the styles are only loaded after the page is interactive.

## CSS containment

- **Added `contain: layout style` to `.effect-layer`** — Tells the browser that DOM mutations inside effect layers (sparkles, trails, reflections, etc.) cannot affect the rest of the page. Reduces the scope of layout recalculations triggered by effect animations.

## Forced reflow fix

- **Cached viewport dimensions in `mirror-reflections.js`** — Replaced per-frame reads of `window.innerWidth`/`window.innerHeight` with cached values updated via a resize listener. Reading layout properties inside a `requestAnimationFrame` loop forces the browser to synchronously recalculate layout.

## Effects cleanup — AbortController pattern

- **Replaced manual listener/timer cleanup with `AbortController`** across `cursor-trail.js`, `disco-spotlight.js`, `grand-entrance.js`, `parallax-sparkles.js`, and `main.js`. Each effect now creates an `AbortController` on `start()` and passes `{ signal }` to all `addEventListener` and `setTimeout` calls. Calling `controller.abort()` on `stop()` tears down everything at once.

- **Added `cancellableDelay()` utility** in `main.js` — A `Promise`-based replacement for `setTimeout` that rejects with `AbortError` when the signal fires. This allowed `grand-entrance.js` and `disco-spotlight.js` to replace deeply nested `setTimeout` chains with flat `async`/`await` sequences.

- **Why:** Prevents memory leaks from orphaned event listeners and timers when effects are toggled. The previous pattern required tracking every handler reference and timer ID individually, which was error-prone.

## Utility export

- **Exported `getTypedElement` from `utils.js`** — Was previously private. Needed by `main.js` to safely grab the `effects-css` link element for the media swap. Also reformatted one-liner typed-element wrappers to multi-line.

## Files changed

- `public/styles/layout.css` — `height: auto` on img/picture reset
- `public/styles/tokens.css` — `@font-face` declarations
- `public/styles/effects.css` — `contain: layout style` on effect layers
- `public/fonts/` — 5 woff2 files (new directory)
- `public/images/` — 11 new responsive webp sizes
- `public/pages/index.html` — font preloads, srcset, deferred effects.css, removed Google Fonts
- `public/pages/rsvp/index.html` — font preloads, removed Google Fonts
- `public/pages/admin/index.html` — font preloads, removed Google Fonts
- `public/pages/utils.js` — exported `getTypedElement`
- `public/effects/main.js` — effects-css media swap, `cancellableDelay()`, AbortController for module listeners
- `public/effects/cursor-trail.js` — AbortController cleanup
- `public/effects/disco-spotlight.js` — AbortController + async/await
- `public/effects/grand-entrance.js` — AbortController + async/await, extracted `initSparkleContainer`
- `public/effects/parallax-sparkles.js` — AbortController cleanup
- `public/effects/mirror-reflections.js` — cached viewport dimensions, resize listener
- `public/effects/types.d.ts` — `cancellableDelay` type declaration
- `core/static.js` — CSP hash/nonce modes, inline script injection
- `types.js` — `CSP_NONCE` env var export

---

## Current bottleneck: Style & Layout (TBT)

Mobile Lighthouse is at 90. The remaining bottleneck is **Total Blocking Time** caused by Style & Layout recalculation (4,035ms). Script evaluation is only 88ms — JS payload size is not the issue. The problem is the effects system creating too many simultaneously-animated DOM elements during page load.

### Profiling summary

| Category              | Time     |
|-----------------------|----------|
| Style & Layout        | 4,035 ms |
| Other                 | 989 ms   |
| Rendering             | 192 ms   |
| Script Evaluation     | 88 ms    |
| Parse HTML & CSS      | 29 ms    |
| Script Parsing & Comp | 6 ms     |

### Root causes

**1. Disco ball tiles (~100+ animated elements)**
`disco-ball.js` creates a grid of `<div class="disco-tile">` elements (88px ball / 8px pitch = ~11×11 = ~121 tiles), each with its own `disco-tile-shimmer` CSS animation. On mobile, ball shrinks to 75% (66px) but still produces ~64 tiles.

**2. Parallax sparkle layer count**
`parallax-sparkles.js` builds 5 layers × `density * (0.6 + depth*0.4)` sparkles. On mobile (density 17 × 0.3 = ~5 per layer × 5 layers ≈ 25), on desktop (~85 total). Each sparkle has a `parallax-sparkle-pulse` animation plus optional `box-shadow` glow.

**3. Grand entrance particle storms during load**
`grand-entrance.js` fires 5 waves × 69 sparkles = 345 DOM elements (86 on mobile) during the first seconds of page load, exactly when TBT matters most.

**4. Sparkle burst during load**
`sparkle-burst.js` immediately creates 60 particles (30 on mobile) with CSS animations on load.

**5. Mirror reflections rAF style writes**
`mirror-reflections.js` runs a `requestAnimationFrame` loop writing `style.opacity` and `style.transform` to 10–22 elements every 33ms. Each write can trigger style recalculation.

**6. All effects start during the TBT measurement window**
`main.js` uses `requestIdleCallback` to stagger starts, but with 11 effects queued, they all initialize within the first few seconds — the exact window Lighthouse measures for TBT.

### What NOT to change

- The effects look great. The goal is to keep the same visual result with fewer DOM nodes and less layout thrashing, not to remove effects.
- The stagger-start pattern in `main.js` is sound; it just needs to push more work past the TBT window.
- `contain: layout style` on `.effect-layer` is already in place.
