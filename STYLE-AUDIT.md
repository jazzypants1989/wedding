# CSS & Style Audit Report

**Generated:** January 2026
**Scope:** All CSS files, HTML templates, and JS-CSS interactions
**Files Audited:**
- `public/styles/global.css` (1,230 lines)
- `public/styles/effects.css` (742 lines)
- `public/pages/admin/admin.css` (1,044 lines)
- `public/pages/index.html`
- `public/pages/rsvp/index.html`
- `public/pages/admin/index.html`
- All JS files in `public/pages/effects/` and `public/pages/rsvp/`

---

## Table of Contents

1. [File Inventory & Architecture](#1-file-inventory--architecture)
2. [CSS Custom Properties & Theming](#2-css-custom-properties--theming)
3. [Color System Issues](#3-color-system-issues)
4. [Typography & Type Scale](#4-typography--type-scale)
5. [Spacing & Layout](#5-spacing--layout)
6. [Responsive Design & Breakpoints](#6-responsive-design--breakpoints)
7. [Selector Patterns & Specificity](#7-selector-patterns--specificity)
8. [Accessibility](#8-accessibility)
9. [Animation & Performance](#9-animation--performance)
10. [Z-Index Management](#10-z-index-management)
11. [Code Duplication & DRY Violations](#11-code-duplication--dry-violations)
12. [CSS Reset & Normalization](#12-css-reset--normalization)
13. [Print Styles](#13-print-styles)
14. [Inline Styles & JS-CSS Coupling](#14-inline-styles--js-css-coupling)
15. [Class Naming Conventions](#15-class-naming-conventions)
16. [Button System](#16-button-system)
17. [Form System](#17-form-system)
18. [Admin vs Public Style Divergence](#18-admin-vs-public-style-divergence)
19. [Modern CSS Opportunities](#19-modern-css-opportunities)
20. [Alternative Approaches](#20-alternative-approaches)

---

## 1. File Inventory & Architecture

### Current Structure

```
public/
  styles/
    global.css      (1,230 lines) -- Main site styles + RSVP form
    effects.css     (742 lines)   -- Visual effects (sparkles, disco, shimmer, etc.)
  pages/
    admin/
      admin.css     (1,044 lines) -- Admin dashboard (standalone)
```

### Issues

**1.1 global.css is a monolith.**
At 1,230 lines, `global.css` contains the CSS reset, navigation, hero, content sections,
schedule, dress code, registry, RSVP forms, form animations, confetti, sparkles, and print
styles. This file serves two separate pages (index.html and rsvp/index.html) with no
splitting.

**Improvement:** Split into focused modules:
- `reset.css` -- Box-sizing reset, element normalization
- `tokens.css` -- Custom properties (colors, spacing, fonts, z-index)
- `layout.css` -- Navigation (mobile + desktop), hero, content sections, footer
- `components.css` -- Buttons, forms, radio labels, alerts
- `rsvp.css` -- RSVP-specific lookup form, petition form, success state
- `animations.css` -- All keyframes and animation utility classes

This would keep each file under 200-300 lines and allow the RSVP page to skip loading
schedule/dress-code/registry styles it doesn't use.

**1.2 admin.css is fully self-contained (good and bad).**
The admin stylesheet duplicates the entire CSS reset, font import, and custom property
definitions. While this isolation is intentional (the admin page loads only admin.css),
it means any change to the design system must be made in two places.

**Improvement:** Extract shared tokens and reset into a common file that both global.css
and admin.css import via `@import`. Since there's a zero-dependency constraint, CSS
`@import` works natively in the browser (though it adds a request). Alternatively, a
build-time concatenation script using Node.js built-ins could produce the final files.

**1.3 effects.css loads on the main page but not RSVP.**
The RSVP page (`rsvp/index.html`) only loads `global.css`. This means effect-related
classes defined in `global.css` (like `.confetti-piece`, `.mini-sparkle`) are in the
global file rather than effects.css where they logically belong.

**Improvement:** Move `.confetti-piece`, `.mini-sparkle`, and related keyframes from
global.css into effects.css, and either load effects.css on the RSVP page too or
create a `rsvp-animations.css` for RSVP-specific effects.

**1.4 Duplicate Google Fonts import.**
Both `global.css:1` and `admin.css:2` import the identical Google Fonts URL. If they
were ever loaded together (unlikely but possible), the browser would make a duplicate
request.

---

## 2. CSS Custom Properties & Theming

### Root Variables Inventory

#### global.css `:root`
```css
--color-primary: rgb(221, 115, 100)    /* Terracotta/coral */
--color-background: #eee6dc            /* Warm cream */
--color-text: #c1330d                  /* Dark rust */
--color-text-muted: #666               /* Gray */
--color-white: #fff
--font-display: "DM Serif Display", serif
--font-body: "Jost", sans-serif
--spacing-xs: 4px
--spacing-sm: 8px
--spacing-md: 16px
--spacing-lg: 24px
--spacing-xl: 48px
--mobile-header-height: 56px
--z-mobile-nav: 100
```

#### admin.css `:root`
```css
--color-primary: #c1330d               /* Different from global! */
--color-primary-dark: #9a2a0b
--color-background: #eee6dc
--color-card-bg: #fff
--color-text: #c1330d
--color-text-muted: #666
--color-border: #d4c9bc
--color-success: #2d6a4f
--color-warning: #b45309
--color-danger: #b91c1c
/* Same fonts and spacing as global */
```

### Issues

**2.1 `--color-primary` differs between files.**
- global.css: `rgb(221, 115, 100)` = `#dd7364` (lighter coral)
- admin.css: `#c1330d` (darker rust)

These are visually different colors serving the same semantic role. The admin primary
color happens to match the global `--color-text` value. This may be intentional (the
admin uses a more subdued palette), but it should be explicitly documented.

**2.2 Missing semantic color variables in global.css.**
The admin file has `--color-success`, `--color-warning`, `--color-danger`, and
`--color-border`. The global file has none of these, forcing hardcoded values for
success/error states throughout the RSVP form:
- `#b91c1c` (error red) appears 4 times
- `#166534` (success green) appears 3 times
- `rgba(34, 197, 94, 0.1)` (success background) appears 3 times
- `rgba(239, 68, 68, 0.1)` (error background) appears 3 times

**Improvement:** Add semantic color variables to global.css:
```css
--color-success: #166534;
--color-success-bg: rgba(34, 197, 94, 0.1);
--color-danger: #b91c1c;
--color-danger-bg: rgba(239, 68, 68, 0.1);
```

**2.3 Hardcoded rgba() values using raw color numbers.**
`rgba(193, 51, 13, ...)` appears 20+ times in global.css. This corresponds to `#c1330d`
(the text color), not `rgb(221, 115, 100)` (the declared primary). CSS custom properties
can't be decomposed into channels without `color-mix()` or the upcoming
`relative color syntax`, but the inconsistency should be noted.

**Improvement (modern CSS):** Use `color-mix()` for transparent variants:
```css
background-color: color-mix(in srgb, var(--color-text) 5%, transparent);
```
This is supported in all modern browsers since 2023.

**2.4 No font-size variables.**
Font sizes are hardcoded throughout (2.5rem, 1.5rem, 0.875rem, etc.) with no systematic
type scale. See Section 4 for details.

**2.5 No shadow or border-radius variables.**
Shadows appear in 8+ places with slightly varying values. Border-radius uses 4px, 8px,
and 9999px consistently but without variables.

**Improvement:**
```css
--radius-sm: 4px;
--radius-md: 8px;
--radius-full: 9999px;
--shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
--shadow-lg: 0 4px 20px rgba(0, 0, 0, 0.15);
```

**2.6 No transition-duration variables.**
Transition durations (0.2s, 0.3s, 0.4s, 0.5s) are scattered throughout. A scale would
allow global timing adjustments:
```css
--duration-fast: 0.15s;
--duration-normal: 0.3s;
--duration-slow: 0.5s;
```

---

## 3. Color System Issues

### Complete Color Inventory

**Brand colors:**
- `rgb(221, 115, 100)` / `#dd7364` -- Primary (global)
- `#c1330d` -- Primary (admin) / Text color (both)
- `#eee6dc` -- Background
- `#666` -- Muted text
- `#a02a0b` -- Button hover (hardcoded)
- `#9a2a0b` -- Primary dark (admin only)

**Semantic colors (scattered, not in variables):**
- `#b91c1c` -- Danger/error text (4 occurrences in global, variable in admin)
- `#166534` -- Success text (3 occurrences in global)
- `#065f46` -- Alternative success text (admin only)
- `#2d6a4f` -- Yet another success green (admin variable)
- `#92400e` -- Warning text (admin only)

**Status badge colors (admin, all hardcoded):**
- `#fef3c7` / `#92400e` -- Pending (yellow)
- `#e0e7ff` / `#3730a3` -- Invited (blue)
- `#d1fae5` / `#065f46` -- Responded/approved (green)
- `#e5e7eb` / `#6b7280` -- Archived (gray)
- `#fef2f2` / `#b91c1c` -- Error/denied (red)

**Effect colors (effects.css + JS, all hardcoded):**
- `#ffd700` -- Gold
- `#ff69b4` -- Hot pink
- `#ff6b9d` -- Light pink
- `#c44dff` -- Purple
- `#6bc5ff` -- Cyan
- `#45ffa5` -- Teal
- `#ffe74d` -- Yellow
- `#87ceeb` -- Sky blue
- `#ffe4e1` -- Misty rose
- `#f0c4b8` -- Light salmon
- `#ff8fa3` -- Salmon pink
- `#e8747c` -- Rose
- `#60efff` -- Bright cyan

### Issues

**3.1 Three different "success" greens exist.**
`#166534`, `#065f46`, and `#2d6a4f` are all used for success states. They're close but
not identical, creating visual inconsistency.

**3.2 WCAG contrast concern: primary text on background.**
The combination `#c1330d` on `#eee6dc` yields approximately 3.8:1 contrast ratio.
WCAG AA requires 4.5:1 for normal text. This passes for large text (18pt+ / 24px+)
but may fail for body text.

**Improvement:** Darken the text color slightly to `#a52b0a` or similar to achieve 4.5:1.

**3.3 Muted text contrast.**
`#666` on `#eee6dc` yields approximately 3.2:1. This fails WCAG AA for normal text.

**Improvement:** Darken to `#555` or `#595959` to meet 4.5:1.

**3.4 The primary color rgba() references don't match the primary variable.**
Throughout global.css, `rgba(193, 51, 13, ...)` is used for borders, shadows, and
backgrounds. But `rgb(193, 51, 13)` = `#c1330d`, which is `--color-text`, not
`--color-primary` (`rgb(221, 115, 100)` = `#dd7364`). The codebase appears to use
the text color's raw values when it intends to create transparent primary-colored
elements.

---

## 4. Typography & Type Scale

### Current Font Sizes

| Size     | rem   | px equiv | Usage |
|----------|-------|----------|-------|
| 3.75rem  | 3.75  | 60px     | Couple names (desktop) |
| 2.5rem   | 2.5   | 40px     | Couple names (mobile), stat values |
| 2rem     | 2.0   | 32px     | Section headings (h2), success title |
| 1.75rem  | 1.75  | 28px     | RSVP greeting |
| 1.5rem   | 1.5   | 24px     | Schedule titles, h3, mobile nav links, mobile logo |
| 1.25rem  | 1.25  | 20px     | Wedding info (desktop), countdown (desktop) |
| 1.125rem | 1.125 | 18px     | Large button text |
| 1.1rem   | 1.1   | 17.6px   | SMS guest header |
| 1rem     | 1.0   | 16px     | Body text, form inputs, buttons, many elements |
| 0.95rem  | 0.95  | 15.2px   | Petition subtext |
| 0.9rem   | 0.9   | 14.4px   | Registry link, SMS message, phone display |
| 0.875rem | 0.875 | 14px     | Nav links, schedule time, labels, pagination, etc. |
| 0.875em  |       |          | Code element |
| 0.8rem   | 0.8   | 12.8px   | Preview table, SMS placeholder tag, sent badge |
| 0.75rem  | 0.75  | 12px     | Dress code caption, stat detail, preview table th, radio small |
| 0.7rem   | 0.7   | 11.2px   | Tab badge |

### Issues

**4.1 No type scale in use.**
The 16 distinct font sizes show no consistent ratio or scale. A modular scale (e.g.,
1.25 ratio) would produce: 0.8rem, 1rem, 1.25rem, 1.563rem, 1.953rem, 2.441rem. The
current sizes are ad-hoc.

**Improvement:** Define a type scale using custom properties:
```css
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.25rem;    /* 20px */
--text-xl: 1.5rem;     /* 24px */
--text-2xl: 2rem;      /* 32px */
--text-3xl: 2.5rem;    /* 40px */
--text-4xl: 3.75rem;   /* 60px */
```

**4.2 Sizes 0.95rem, 0.9rem, and 1.1rem are odd values.**
These don't fit any standard scale and create near-imperceptible differences. 0.95rem
vs 1rem is a 0.8px difference at 16px base -- visually indistinguishable.

**4.3 Font weights loaded but underused.**
Google Fonts loads Jost at weights 300, 400, and 500. Weight 300 is used exactly once
(`.exact-time`). If 300 isn't visually important, removing it saves ~20KB of font data.

**4.4 Line heights are inconsistent.**
The base is 1.5 (good), but some elements use 1.6 (schedule details/notes) and others
use 1 (modal close button). A more systematic approach would be:
```css
--leading-tight: 1.25;
--leading-normal: 1.5;
--leading-relaxed: 1.75;
```

---

## 5. Spacing & Layout

### Current System

The spacing scale is well-defined and consistently used:
```
xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 48px
```

### Issues

**5.1 Gap between lg (24px) and xl (48px) is large.**
There's a 2x jump from 24px to 48px. Many designs benefit from a 32px step:
```css
--spacing-xl: 32px;   /* New */
--spacing-2xl: 48px;  /* Renamed from xl */
```

**5.2 No max-width variables.**
Content widths are hardcoded: `1200px` (main), `720px` (content-section), `500px`
(RSVP form), `400px` (lookup form, login card, dress-code figure), `600px` (registry
frame), `700px` (modal-lg). These could be variables:
```css
--max-width-xs: 400px;
--max-width-sm: 500px;
--max-width-md: 720px;
--max-width-lg: 1200px;
```

**5.3 Margin-bottom for hero image uses a percentage hack.**
`.hero-image` has `margin-bottom: -15%` to overlap the header section. This is fragile
and depends on the image's aspect ratio. A different image would shift the layout.

**Improvement:** Consider using a negative `translateY` on the header or `position:
relative; top: -X` for more predictable overlap.

**5.4 `.attending-details` max-height animation uses fixed 500px.**
The expanding form section animates `max-height` to 500px. If content ever exceeds this
(unlikely but possible with very long dietary restriction text), it would clip. A safer
approach uses a JS-measured height or a very large max-height (9999px) with
`overflow: hidden`.

---

## 6. Responsive Design & Breakpoints

### Current Breakpoints

Only ONE breakpoint is used: **768px**.

- global.css: `@media (min-width: 768px)` -- 11 queries (mobile-first)
- effects.css: `@media (min-width: 768px)` -- 1 query (mobile-first)
- admin.css: `@media (max-width: 768px)` -- 1 query (desktop-first)

### Issues

**6.1 Admin uses opposite breakpoint direction.**
global.css and effects.css are mobile-first (`min-width: 768px`), but admin.css uses
desktop-first (`max-width: 768px`). At exactly 768px, both conditions are true, which
could cause unexpected layering if files were ever combined.

**Improvement:** Convert admin.css to mobile-first for consistency, or use
`max-width: 767px` to avoid the boundary overlap.

**6.2 Only one breakpoint for all screen sizes.**
The single 768px breakpoint means:
- Phones (320px-767px) all get the same styles
- Tablets (768px-1023px) get desktop styles
- Large desktops (1440px+) get the same as tablets

**Missing breakpoint opportunities:**
- **Small mobile (< 375px):** The dress-code gallery and stat cards could benefit from
  reduced padding.
- **Tablet landscape (1024px):** Desktop nav could get more generous spacing.
- **Large screens (1440px+):** Content could use wider max-widths, and effects could
  scale up.

**6.3 Touch target sizes are below WCAG 2.5.8 minimum.**
WCAG recommends 44x44px minimum for interactive elements.

| Element | Current Size | Meets 44px? |
|---------|-------------|-------------|
| Hamburger icon | 24x24px | No |
| Radio input | 20x20px | No |
| Desktop nav links | ~14px font, 4+8px padding | Borderline |
| Tab buttons (admin) | 16+24px padding | Borderline |
| Modal close button | ~24px font | No (touch area) |

**Improvement:** Ensure all interactive elements have at least 44px in both dimensions,
via padding or min-width/min-height.

**6.4 Registry iframe has fixed 450px height.**
On small phones, 450px is over half the viewport. On large screens, it may be too
short for the embedded content. Consider `min-height: 300px; height: 60vh; max-height:
600px` for responsive sizing.

**6.5 No responsive images for retina displays.**
The `<picture>` elements provide mobile/desktop variants but no density descriptors
(`srcset="image.png 1x, image@2x.png 2x"`). Retina displays get the same resolution
as standard displays.

**6.6 `font-size: 0.875rem` on mobile tables in admin.**
The admin reduces table font-size on mobile, making already-small text even smaller.
This hurts readability on the devices that need it most.

---

## 7. Selector Patterns & Specificity

### Selector Statistics

| Metric | global.css | effects.css | admin.css |
|--------|-----------|-------------|-----------|
| Total selectors (approx) | 120 | 50 | 100 |
| Class selectors | 85 | 45 | 95 |
| Element selectors | 15 | 3 | 8 |
| ID selectors | 0 | 0 | 0 |
| Attribute selectors | 8 | 0 | 6 |
| Descendant combinators | 35+ | 15+ | 20+ |
| `!important` declarations | 4 | 2 | 0 |

### Issues

**7.1 No ID selectors (good).**
The codebase avoids ID selectors in CSS entirely. All styling uses classes.

**7.2 `!important` usage is mostly justified.**
- Reduced-motion media query (4 declarations): Justified -- must override all animations.
- Print styles (2 declarations): Justified -- must override display properties.
- `.trail-ring { background: transparent !important; }`: Unjustified -- this overrides
  an inherited `background-color` that could be avoided with a more specific selector
  or by not setting a default background on trail particles.

**7.3 Highest specificity selectors.**
```
.hamburger-icon.open .hamburger-line:nth-child(1)  -- (0, 4, 0)
.form-state--visible .form-group:nth-child(2)      -- (0, 3, 0)
.rsvp-success.form-state--visible h3               -- (0, 2, 1)
.form-group input[type="text"]                      -- (0, 1, 1) + attr
.radio-label:has(input:checked)                     -- (0, 2, 1)
```
These are reasonable. No specificity wars detected.

**7.4 Staggered animation selectors are verbose.**
Lines 969-999 in global.css define 8 separate selectors for staggered field entrance:
```css
.form-state--visible .form-group:nth-child(1) { animation-delay: 0.15s; }
.form-state--visible .form-group:nth-child(2) { animation-delay: 0.2s; }
/* ... through :nth-child(6) ... */
.form-state--visible > .btn--large { animation-delay: 0.45s; }
```

**Alternative:** Use a single CSS custom property set via `nth-child` or use
`animation-delay: calc(var(--i, 0) * 0.05s)` with `style="--i: N"` set in HTML or JS.

**7.5 `:has()` is used with fallback.**
`.radio-label:has(input:checked)` (global.css:807,1014) is modern CSS that requires
Firefox 121+ (Dec 2023). A JS fallback class `.radio-label--checked` exists. Good
progressive enhancement.

---

## 8. Accessibility

### Strengths

**8.1 prefers-reduced-motion: Excellent.**
The global reset disables all animations and transitions when the user prefers reduced
motion. This is comprehensive and correctly placed.

**8.2 Skip link: Present and functional.**
`.skip-link` is visually hidden but appears on focus. Both index.html and rsvp/index.html
include it.

**8.3 Screen-reader-only class: Correct implementation.**
`.sr-only` uses the canonical pattern (position absolute, 1x1px, overflow hidden, clip).

**8.4 ARIA attributes: Well-implemented.**
- Hamburger button: `aria-expanded`, `aria-label`
- Navigation: `aria-label`
- Admin tabs: `role="tablist"`, `role="tab"`, `aria-controls`, `aria-selected`
- Modals: `aria-labelledby`
- Alerts: `role="alert"`

**8.5 Form labels: All inputs have associated labels.**
Every `<input>`, `<select>`, and `<textarea>` has a `<label>` with a matching `for`
attribute.

### Issues

**8.1 Links are indistinguishable from text.**
```css
a {
  color: inherit;
  text-decoration: none;
}
```
This global reset removes all visual distinction between links and surrounding text.
Only `.registry-link a` adds underlines back. Navigation links rely solely on color
(which is the same as body text in many contexts).

**WCAG 1.4.1:** Links must be distinguishable from surrounding text by more than color
alone. At minimum, links should have underlines or other non-color indicators.

**Improvement:** Add `text-decoration: underline` to in-content links, or use a
`border-bottom` approach:
```css
.content-section a {
  text-decoration: underline;
  text-decoration-color: rgba(193, 51, 13, 0.3);
  text-underline-offset: 2px;
}
```

**8.2 Focus styles removed on form inputs without sufficient replacement in admin.**
Both files remove `outline: none` on focus. global.css provides a good replacement
(box-shadow ring + border color + subtle transform). But admin.css only provides
`border-color: var(--color-primary)` -- a subtle change that may be invisible to
users with low vision.

**Improvement:** Add box-shadow focus ring to admin.css form inputs:
```css
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(193, 51, 13, 0.15);
}
```

**8.3 Status badges use color only.**
Admin status badges (`.status-pending`, `.status-invited`, `.status-responded`,
`.status-archived`) differentiate states purely through background and text color.
Color-blind users cannot distinguish these.

**Improvement:** Prepend text labels or icons, or add patterns/borders.

**8.4 No prefers-contrast support.**
No `@media (prefers-contrast: more)` queries exist. Users who enable high-contrast
mode get no accommodation.

**Improvement:**
```css
@media (prefers-contrast: more) {
  :root {
    --color-text-muted: #333;
    --color-primary: #8b1a04;
  }
  .radio-label { border-width: 3px; }
}
```

**8.5 No prefers-color-scheme support.**
No dark mode support exists. The warm beige palette assumes a light environment.

**8.6 Some text sizes are too small.**
- `.tab-badge`: 0.7rem (11.2px) -- below recommended 12px minimum
- `.dress-code-caption`: 0.75rem (12px) -- borderline
- `.stat-detail`: 0.75rem (12px) -- borderline

**8.7 Missing role attributes on RSVP state containers.**
The RSVP loading, error, and success containers (`#rsvp-loading`, `#rsvp-error`,
`#rsvp-success`) lack `role="status"` or `aria-live` attributes. Screen readers won't
announce state changes.

---

## 9. Animation & Performance

### Animation Inventory

**global.css keyframes (10):**
| Name | Duration | Properties Animated | Performance |
|------|----------|-------------------|-------------|
| pulse | 2s infinite | opacity | Good (composite) |
| field-enter | 0.4s | transform, opacity | Good (composite) |
| radio-pop | 0.3s | transform | Good (composite) |
| greeting-entrance | 0.6s | transform, opacity | Good (composite) |
| btn-spin | 0.6s infinite | transform | Good (composite) |
| shake | 0.4s | transform | Good (composite) |
| result-reveal | 0.3s | transform, opacity | Good (composite) |
| success-title | 0.6s | transform, opacity | Good (composite) |
| confetti-fall | 1.2-2.7s | transform, opacity | Good (composite) |
| mini-sparkle-pop | 0.5s | transform, opacity | Good (composite) |

**effects.css keyframes (19):**
| Name | Duration | Properties Animated | Performance |
|------|----------|-------------------|-------------|
| twinkle | varies | transform, opacity | Good |
| disco-sway | 6s infinite | transform | Good |
| disco-spin | 4s infinite | transform (rotateY) | Good but 3D |
| ray-sweep | varies infinite | transform | Good |
| trail-fade | 600ms | transform, opacity | Good |
| shimmer-shift | 8s infinite | background-position | Acceptable |
| sparkle-burst-fall | varies | transform, opacity | Good |
| sparkle-divider-pulse | 1.5s infinite | transform, opacity | Good |
| name-shimmer | 8s infinite | background-position | Acceptable |
| caustics-move-1/2/3 | 8/11/15s infinite | background-position | Acceptable |
| text-glow-in | 1.5s | text-shadow | **Paint trigger** |
| parallax-sparkle-pulse | 3s infinite | transform, opacity | Good |
| grand-entrance-reveal | 1.2s | opacity | Good |
| grand-entrance-fade | 1s | opacity | Good |
| grand-entrance-sparkle-fall | 1.5s | transform, opacity | Good |
| grand-entrance-sparkle-radial | 2s | transform, opacity | Good |
| spotlight-sweep | 8s infinite | transform | Good |

**admin.css keyframes (2):**
| Name | Duration | Properties Animated | Performance |
|------|----------|-------------------|-------------|
| dialogFadeIn | 0.2s | transform, opacity | Good |
| spin | 0.8s infinite | transform | Good |

### Issues

**9.1 `will-change` is properly used on effect elements (good).**
Every continuously-animating element in effects.css declares `will-change`, which
promotes it to a compositor layer for GPU acceleration. This is well-done.

**9.2 text-shadow animation triggers paint.**
`@keyframes text-glow-in` animates `text-shadow`, which causes a paint operation on
every frame. Since it's a one-shot 1.5s animation, the impact is minimal, but it's the
only non-composite animation in the effects system.

**Alternative:** Use a pseudo-element with `filter: blur()` and animate its `opacity`
instead, keeping everything on the compositor.

**9.3 Mobile nav animates `height` (layout trigger).**
`.mobile-nav` transitions `height: 0` to `height: calc(100vh - 56px)`. Height changes
trigger layout recalculation on every frame of the transition.

**Alternative:** Use `transform: scaleY()` with `transform-origin: top` for a
compositor-only animation, or use `clip-path: inset(0 0 100% 0)` to
`clip-path: inset(0)`.

**9.4 `.attending-details` animates padding and margin-bottom.**
Transitioning `padding` and `margin-bottom` triggers layout on every frame.

**Alternative:** Use only `max-height` and `opacity`, or wrap content in an inner div
and animate `transform`.

**9.5 Disco ball box-shadow on animated element.**
`.disco-ball` has a dual box-shadow (`0 0 20px ... , 0 0 60px ...`) and is continuously
rotating via `rotateY`. The shadow must be repainted on each frame of the 3D rotation.

**Alternative:** Move the shadow to a non-animated wrapper, or use a static radial
gradient underneath instead of a box-shadow.

**9.6 Multiple infinite animations on page load.**
On the main page, these all start immediately:
- Sparkle stars (varying count)
- Disco ball sway (6s) + spin (4s)
- Disco rays (multiple, varying)
- Cursor trail (on mouse move)
- Mermaid shimmer (8s)
- Sparkle burst particles
- Sparkle dividers
- Name shimmer (8s)
- Caustics (3 layers, 8/11/15s)
- Parallax sparkles (on scroll)
- Spotlight sweep (8s)
- Mirror reflections

That's 12+ concurrent animation systems. On low-end mobile devices, this could cause
jank and battery drain.

**Improvement:** Consider lazy-loading effects (start them only when elements enter
the viewport), reducing density on mobile, or providing a user-controlled toggle to
disable effects entirely.

**9.7 No CSS containment.**
No elements use `contain: layout paint` or `content-visibility: auto`. For the admin
dashboard with its tables and cards, containment could provide measurable performance
improvement.

**Improvement:**
```css
.card { contain: layout paint style; }
.stat-card { contain: layout paint; }
.tab-content:not(.active) { content-visibility: hidden; }
```

---

## 10. Z-Index Management

### Current Z-Index Map

```
mermaid-shimmer              40
effect-layer                 50
disco-ball-wrapper           55
parallax layers              40-44 (set in JS)
mobile-nav                   99  (calc(var(--z-mobile-nav) - 1))
mobile-nav-wrapper           100 (var(--z-mobile-nav))
grand-entrance-overlay       100
mini-sparkle                 100
hamburger-button             101 (calc(var(--z-mobile-nav) + 1))
grand-entrance-sparkles      101
confetti container           1000 (set in JS)
skip-link                    1000
trail-particle               9999
```

### Issues

**10.1 `trail-particle` z-index of 9999 is dangerously high.**
This means cursor trail particles render above everything, including skip links,
modals, and the mobile navigation. If cursor trails are active while a dialog is open,
particles would appear above the dialog.

**Improvement:** Reduce to 60-65, above effects but below navigation.

**10.2 Z-index collisions at 100.**
Three unrelated elements share z-index 100: mobile-nav-wrapper, grand-entrance-overlay,
and mini-sparkle. While they're unlikely to overlap in practice, this indicates a lack
of systematic management.

**10.3 Only one z-index uses a variable.**
`--z-mobile-nav: 100` is the only z-index variable. All others are hardcoded.

**Improvement:** Define a complete z-index scale:
```css
--z-effects-back: 40;
--z-effects-mid: 50;
--z-effects-front: 60;
--z-nav: 100;
--z-overlay: 200;
--z-modal: 300;
--z-skip: 400;
```

**10.4 Confetti container z-index is set via inline styles in JS.**
`confetti.js` sets `z-index: 1000` via `style.cssText`. This bypasses any CSS-based
z-index management.

---

## 11. Code Duplication & DRY Violations

### Duplicated Patterns

**11.1 CSS reset duplicated in admin.css.**
Lines 24-42 of admin.css are identical to lines 32-44 of global.css (box-sizing reset,
html base styles, body styles). This is ~20 lines of exact duplication.

**11.2 Form group styles duplicated.**
Both files define `.form-group` with similar but not identical styles:
- global.css: `margin-bottom: var(--spacing-lg)`, more elaborate border/focus styles
- admin.css: `margin-bottom: var(--spacing-md)`, simpler border/focus styles

**11.3 Button base class duplicated.**
`.btn` is defined in both files with overlapping but different properties. The global
version uses BEM modifiers (`--primary`, `--secondary`, `--large`), while admin uses
separate classes (`btn-primary`, `btn-secondary`, `btn-danger`, `btn-sm`).

**11.4 Success/error result styles repeated 3 times in global.css.**
```css
.lookup-result--success { background-color: rgba(34, 197, 94, 0.1); color: #166534; }
.lookup-result--error   { background-color: rgba(239, 68, 68, 0.1); color: #b91c1c; }
.petition-result--success { /* identical */ }
.petition-result--error   { /* identical */ }
/* Plus .form-error with similar pattern */
```

**Improvement:** Create generic classes:
```css
.result--success { background-color: var(--color-success-bg); color: var(--color-success); }
.result--error   { background-color: var(--color-danger-bg); color: var(--color-danger); }
```

**11.5 Status badge colors repeated in admin.css.**
The status badge pattern (background + text color) is repeated for: pending, invited,
responded, archived, approved, denied. And separately for: import-stat success/warning/
error. These share the same color pairs.

**11.6 `rgba(193, 51, 13, 0.05)` appears 8 times in global.css.**
This specific transparent color is used for:
- `.schedule-note` background
- `.dress-code-caption` background
- `.rsvp-lookup` background
- `.rsvp-petition` background
- `.radio-label:has(input:checked)` background
- `.radio-label--checked` background (fallback)
- `.btn--secondary:hover` background
- `.attending-details` background (with 0.03 variant)

This should be a variable: `--color-primary-faint: rgba(193, 51, 13, 0.05)`.

---

## 12. CSS Reset & Normalization

### Current Reset (global.css)

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html { line-height: 1.5; -webkit-font-smoothing: antialiased; scroll-behavior: smooth; }
img, picture { display: block; max-width: 100%; }
ul, ol { list-style: none; }
a { color: inherit; text-decoration: none; }
button { font: inherit; background: none; border: none; cursor: pointer; }
```

### Issues

**12.1 Aggressive list reset.**
`list-style: none` on ALL `ul` and `ol` elements means any content lists (currently
none, but potentially added later) would need list-style explicitly re-added. This
also removes the implicit ARIA list role in some browsers (Safari).

**Alternative:** Only reset lists within known navigation contexts:
```css
nav ul, nav ol { list-style: none; }
```

**12.2 Link reset removes all affordance.**
Removing `color` and `text-decoration` from all links means every link needs explicit
styling. This is common in component-based designs but creates accessibility concerns
(see Section 8).

**12.3 Button reset is thorough (good).**
The button reset (`font: inherit; background: none; border: none; cursor: pointer;`)
is a reasonable baseline for custom-styled buttons.

**12.4 `-webkit-font-smoothing: antialiased` is controversial.**
This makes text thinner on macOS, which some designers prefer. However, it reduces
contrast for thin fonts and is not standard. The font "Jost" at weight 300 may be
particularly affected.

**Alternative:** Remove this property and let the OS handle font rendering, or apply
it selectively to display headings only.

---

## 13. Print Styles

### Current Implementation

global.css provides print styles that:
- Hide navigation, buttons, skip links
- Set body to 12pt, black on white
- Show link URLs via `a[href]::after`
- Prevent page breaks inside content sections and forms
- Hide the hero image

effects.css hides all effect layers in print.

### Issues

**13.1 Print styles are solid (good).**
This is one of the better-implemented aspects of the CSS. The `page-break-inside: avoid`
on content sections is particularly thoughtful.

**13.2 Missing: couple photo in print.**
The `.hero` and `.hero-image` are hidden, but the `.couple-photo` is not explicitly
addressed. It may or may not print depending on the browser.

**13.3 Admin has no print styles.**
The admin dashboard has no `@media print` block. Printing a guest list or RSVP summary
would include all UI chrome (tabs, buttons, filters).

**Improvement:** Add basic print styles to admin.css hiding the header, tabs, buttons,
and formatting tables for print.

---

## 14. Inline Styles & JS-CSS Coupling

### Effect System JS-CSS Interface

The effect system creates DOM elements via JavaScript and sets styles both through
CSS classes and inline `style` properties.

**Pattern used by effects:**
1. Create container: `className = "effect-layer disco-ball-wrapper"`
2. Set dynamic values via inline styles: `style.animationDuration`, `style.left`,
   `style.backgroundColor`, etc.
3. CSS provides base appearance and animations; JS provides randomized parameters.

### Specific Inline Style Patterns

**14.1 All effect JS files set inline styles extensively.**
- `sparkle-stars.js`: Sets `left`, `top`, `animationDuration`, `animationDelay`, `--scale`
- `disco-ball.js`: Sets `left`, `top`, `backgroundColor`, `borderRadius`
  (disco tile positioning)
- `cursor-trail.js`: Sets `left`, `top`, `backgroundColor`, `borderColor`
- `sparkle-burst.js`: Sets `animationDuration`, `animationDelay`, `left`,
  `backgroundColor`, `--burst-scale`, `--burst-drift`
- `sparkle-dividers.js`: Sets `left`, `backgroundColor`, `animationDelay`,
  `animationDuration`
- `name-shimmer.js`: Adds/removes shimmer classes via `classList`
- `caustics.js`: Adds child elements with classes
- `text-sparkle.js`: Adds/removes `.text-sparkle-in` class via IntersectionObserver
- `scroll-confetti.js`: Canvas-based (no CSS interaction)
- `parallax-sparkles.js`: Sets `width`, `height`, `left`, `top`, `backgroundColor`,
  `opacity`, `animationDuration`, `animationDelay`, `boxShadow`, `zIndex`, `transform`
- `disco-spotlight.js`: Sets `background` (conic-gradient), `animationDuration`,
  `animationDelay`, `animationDirection`
- `mirror-reflections.js`: Sets `width`, `height`, `left`, `top`, `backgroundColor`,
  `opacity`, `transform`

**14.2 confetti.js sets container styles entirely via `style.cssText`.**
```js
container.style.cssText =
  "position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden"
```
This bypasses CSS entirely for the confetti container.

**Improvement:** Define `.confetti-container` in CSS and use `className` instead.

**14.3 RSVP form JS uses classList extensively (good).**
`rsvp-form.js` and `lookup-form.js` toggle classes like `form-state--visible`,
`btn--loading`, `attending-details--open`, `form-error--shake` etc. This is the
preferred pattern.

**14.4 Some effect styles should be moved from JS to CSS.**
Properties like `pointer-events: none` and `position: fixed` on effect containers
are set in CSS via the `.effect-layer` class. But individual particle positioning
(random `left`, `top`, colors) reasonably requires JS. The current split is
generally appropriate for a dynamic effect system.

---

## 15. Class Naming Conventions

### Patterns Observed

**global.css uses BEM-like conventions:**
- Block: `.btn`, `.form-group`, `.radio-label`, `.content-section`
- Element: `.couple-names`, `.hero-image`, `.schedule-title`, `.dress-code-figure`
- Modifier: `.btn--primary`, `.btn--secondary`, `.btn--large`, `.btn--loading`
- State: `.form-state--visible`, `.attending-details--open`, `.radio-label--checked`
- Variant: `.hero--small`, `.countdown.wedding-day`

**admin.css uses flat class names:**
- `.btn-primary` (no double-dash)
- `.btn-sm` (no double-dash)
- `.tab-btn.active` (compound selector, not BEM)
- `.dashboard.active` (compound selector)
- `.status-pending` (flat)

**effects.css uses descriptive flat names:**
- `.sparkle-star`, `.disco-ball`, `.trail-particle`
- `.couple-names--shimmer` (BEM modifier)
- `.caustics-layer--1` (BEM-like with number)

### Issues

**15.1 Inconsistent modifier syntax.**
- global.css: `--` double dash (BEM): `.btn--primary`, `.form-state--visible`
- admin.css: single dash: `.btn-primary`, `.btn-sm`
- admin.css: compound class: `.tab-btn.active`

This mixing makes it hard to predict class names without checking each file.

**Improvement:** Standardize on BEM everywhere, or standardize on flat names
everywhere. Given the existing codebase leans BEM in the public site, adopt BEM
consistently.

**15.2 `.active` and `.open` are too generic.**
Classes like `.active` and `.open` have no namespace. If a component uses `.active`
for one purpose and another component uses it for a different purpose, conflicts arise.
The admin.css `.dashboard.active` is particularly fragile.

**Improvement:** Use namespaced state classes: `.dashboard--active`,
`.tab-btn--active`, `.mobile-nav--open`.

**15.3 Effect class names lack a common prefix.**
Classes like `.sparkle-star`, `.disco-ball`, `.trail-particle`, `.mermaid-shimmer` are
descriptive but share no common prefix. A prefix like `.fx-` or `.effect-` would make
them instantly identifiable:
```css
.fx-sparkle-star { }
.fx-disco-ball { }
.fx-trail-particle { }
```

---

## 16. Button System

### Current State

**global.css buttons:**
- `.btn` -- base (inline-block, padding, font, border-radius, transitions)
- `.btn--primary` -- filled coral
- `.btn--secondary` -- outlined
- `.btn--large` -- full-width, larger padding/font
- `.btn--loading` -- transparent text + spinner pseudo-element

**admin.css buttons:**
- `.btn` -- base (slightly different transitions, includes border: 1px solid transparent)
- `.btn-primary` -- filled rust red
- `.btn-secondary` -- outlined (hover fills)
- `.btn-danger` -- filled red
- `.btn-sm` -- smaller padding/font
- `.btn-link` -- text-only with underline

### Issues

**16.1 Different base `.btn` definitions.**
The two `.btn` classes are similar but not identical. Admin includes
`border: 1px solid transparent` in the base; global does not. Admin transitions include
`border-color`; global includes `transform` and `box-shadow`.

**16.2 Different modifier naming.**
`--primary` vs `-primary`. If these files ever share scope, they'd conflict.

**16.3 Admin secondary button has different hover behavior.**
In global.css, `.btn--secondary:hover` adds a subtle background tint. In admin.css,
`.btn-secondary:hover` fills entirely with the primary color and changes text to white.
These are significantly different interaction patterns.

**16.4 No focus-visible styles on buttons.**
Neither file defines `:focus-visible` on buttons. Keyboard users get the browser's
default focus ring (which the button reset may have removed in some browsers).

**Improvement:**
```css
.btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

---

## 17. Form System

### Current State

Form styles in global.css cover:
- `.form-group` layout (label + input stacking)
- Input/select/textarea styling with focus effects
- Radio labels with card-style appearance
- Attending details expand/collapse animation
- Form error display

Admin.css provides its own form system with:
- `.form-group` (different spacing)
- `.form-row` (grid layout for side-by-side fields)
- `.radio-group` and `.radio-label` (simpler, horizontal layout)
- `.checkbox-label`

### Issues

**17.1 Two incompatible form systems.**
The public and admin form systems share class names (`.form-group`, `.radio-label`)
but have different styles. The public `.radio-label` is a card-style element with
padding, background, border, and hover effects. The admin `.radio-label` is a simple
flex container with no visual treatment.

**17.2 Admin lacks `.form-row` equivalent in global.**
The admin has a convenient two-column form layout (`.form-row` with CSS Grid). The
public site has no equivalent -- all form fields are full-width.

**17.3 Public form inputs have a transform on focus.**
`transform: translateY(-1px)` on focus creates a slight "lift" effect. While visually
polished, it causes a layout shift that could be distracting for some users. This is
disabled by prefers-reduced-motion, which is good.

**17.4 `outline: none` on form inputs.**
Both files remove the outline. The global file provides adequate replacement focus
indicators. The admin file's replacement is weaker (see Section 8).

---

## 18. Admin vs Public Style Divergence

### Summary of Differences

| Feature | Public (global.css) | Admin (admin.css) |
|---------|-------------------|-------------------|
| Primary color | `rgb(221, 115, 100)` | `#c1330d` |
| Button modifiers | BEM (`--primary`) | Flat (`-primary`) |
| Button hover | Lift + shadow | Color fill |
| Form focus | Shadow + border + transform | Border only |
| Breakpoint direction | min-width (mobile-first) | max-width (desktop-first) |
| Reduced motion | Yes | No |
| Print styles | Yes | No |
| Status colors | Hardcoded inline | Variables |
| Loading spinner | Pseudo-element on button | Separate `.spinner` element |

### Issues

**18.1 Admin has no prefers-reduced-motion support.**
The admin page loads only admin.css, which has no reduced-motion media query. The
dialog animation and spinner will play even for users who disable animations.

**Improvement:** Add the same reduced-motion reset to admin.css.

**18.2 Admin has no print styles.**
See Section 13.

**18.3 Different interaction paradigms.**
The public site's buttons float up on hover with shadows. The admin's buttons fill
with color. Using both in the same session (e.g., visiting the site then the admin)
creates cognitive dissonance.

---

## 19. Modern CSS Opportunities

These improvements maintain the vanilla CSS / zero-dependency constraint while
leveraging features available in all modern browsers (2024+).

### Available Now

**19.1 `color-mix()` for transparent variants.**
Replace `rgba(193, 51, 13, 0.05)` with:
```css
color-mix(in srgb, var(--color-text) 5%, transparent)
```
This keeps transparency in sync with the variable. Supported since Chrome 111,
Firefox 113, Safari 16.2.

**19.2 `lch()` or `oklch()` for perceptually uniform color scales.**
Generate hover/active states from base colors:
```css
--color-primary: oklch(62% 0.15 30);
--color-primary-dark: oklch(45% 0.15 30);
--color-primary-light: oklch(80% 0.1 30);
```

**19.3 Container queries for component-level responsiveness.**
Instead of relying on viewport width, components could respond to their container:
```css
.card { container-type: inline-size; }

@container (max-width: 300px) {
  .card-header { flex-direction: column; }
}
```
Supported since Chrome 105, Firefox 110, Safari 16.

**19.4 `content-visibility: auto` for off-screen content.**
Admin tab content that's hidden could use `content-visibility: hidden` instead of
`display: none`, preserving layout calculations but skipping rendering.

**19.5 Scroll-driven animations.**
The parallax sparkle effect currently uses a JS scroll handler. CSS scroll-driven
animations could replace it:
```css
.parallax-sparkle-layer {
  animation: parallax-shift linear;
  animation-timeline: scroll();
}
```
Supported in Chrome 115+ and Firefox 115+. Safari pending.

**19.6 `@layer` for managing cascade.**
CSS cascade layers could organize the stylesheet into priorities:
```css
@layer reset, tokens, layout, components, effects, utilities;
```
This eliminates specificity concerns entirely.

**19.7 `accent-color` for form controls.**
Already partially used (`.radio-label input[type="radio"] { accent-color: ... }`).
Could extend to checkboxes and other controls.

**19.8 `:focus-visible` instead of `:focus`.**
Replace `:focus` styles with `:focus-visible` to show focus rings only for keyboard
navigation, not mouse clicks:
```css
.btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.btn:focus:not(:focus-visible) { outline: none; }
```

**19.9 `dvh` units for mobile viewport.**
The mobile nav uses `100vh` which doesn't account for the mobile browser chrome.
`100dvh` (dynamic viewport height) solves this:
```css
.mobile-nav.open {
  height: calc(100dvh - var(--mobile-header-height));
}
```

**19.10 Logical properties.**
Replace physical properties with logical equivalents for future RTL support:
- `margin-left` -> `margin-inline-start`
- `padding-top` -> `padding-block-start`
- `text-align: left` -> `text-align: start`

### Speculative (Emerging)

**19.11 `@scope` for component-scoped styles.**
Once widely supported, `@scope` could replace BEM prefixing:
```css
@scope (.rsvp-form) {
  .greeting { font-family: var(--font-display); }
  .intro { text-align: center; }
}
```

**19.12 `@starting-style` for entry animations.**
Could replace JS-triggered animation classes:
```css
dialog[open] {
  opacity: 1;
  transform: scale(1);

  @starting-style {
    opacity: 0;
    transform: scale(0.95);
  }
}
```

---

## 20. Alternative Approaches

### 20.1 Utility-First Hybrid

While a full utility-first approach (like Tailwind) is outside the project constraints,
a small set of utility classes could reduce repetition:

```css
/* Spacing utilities */
.mt-0 { margin-top: 0; }
.mt-sm { margin-top: var(--spacing-sm); }
.mt-md { margin-top: var(--spacing-md); }
.mb-lg { margin-bottom: var(--spacing-lg); }

/* Text utilities */
.text-center { text-align: center; }
.text-muted { color: var(--color-text-muted); }
.font-display { font-family: var(--font-display); }

/* Display utilities */
.flex { display: flex; }
.gap-sm { gap: var(--spacing-sm); }
.gap-md { gap: var(--spacing-md); }
```

This is already partially done (`.text-muted`, `.w-full`, `.nowrap` exist in admin.css).

### 20.2 Component-Based Architecture with `@layer`

Reorganize all CSS into layered components:

```css
@layer reset {
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
}

@layer tokens {
  :root { --color-primary: ...; }
}

@layer components.button {
  .btn { ... }
  .btn--primary { ... }
}

@layer components.form {
  .form-group { ... }
}
```

### 20.3 Data-Attribute Driven States

Instead of toggling classes in JS, use data attributes:

```css
/* Instead of .mobile-nav.open */
.mobile-nav[data-state="open"] { height: calc(100dvh - var(--mobile-header-height)); }

/* Instead of .tab-content.active */
.tab-content[data-active] { display: block; }

/* Instead of .attending-details--open */
.attending-details[data-expanded] { max-height: 500px; opacity: 1; }
```

This separates styling concerns (CSS classes for appearance) from state concerns
(data attributes for behavior).

### 20.4 CSS-Only Dark Mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #e8937f;
    --color-background: #1a1612;
    --color-text: #e8c4b8;
    --color-text-muted: #999;
    --color-white: #1a1612;
    --color-card-bg: #2a221c;
    --color-border: #3a322c;
  }

  .hero-image { filter: brightness(0.8); }
  .couple-photo { border-color: var(--color-background); }
}
```

The custom property system already in place would make dark mode relatively
straightforward -- most elements would automatically pick up new values.

### 20.5 Shared Design Token File

Create a `tokens.css` imported by both global.css and admin.css:

```css
/* tokens.css */
:root {
  /* Colors */
  --color-primary: rgb(221, 115, 100);
  --color-primary-dark: #a02a0b;
  --color-primary-faint: rgba(193, 51, 13, 0.05);
  --color-background: #eee6dc;
  --color-text: #c1330d;
  --color-text-muted: #555;  /* Darkened for contrast */
  --color-white: #fff;
  --color-border: #d4c9bc;
  --color-success: #166534;
  --color-success-bg: rgba(34, 197, 94, 0.1);
  --color-danger: #b91c1c;
  --color-danger-bg: rgba(239, 68, 68, 0.1);
  --color-warning: #92400e;
  --color-warning-bg: #fef3c7;

  /* Typography */
  --font-display: "DM Serif Display", serif;
  --font-body: "Jost", sans-serif;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-2xl: 2rem;
  --text-3xl: 2.5rem;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;

  /* Layout */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-full: 9999px;
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 4px 20px rgba(0, 0, 0, 0.15);

  /* Timing */
  --duration-fast: 0.15s;
  --duration-normal: 0.3s;
  --duration-slow: 0.5s;

  /* Z-Index */
  --z-effects-back: 40;
  --z-effects-mid: 50;
  --z-effects-front: 60;
  --z-nav: 100;
  --z-overlay: 200;
  --z-modal: 300;
  --z-skip: 400;

  /* Breakpoints (for documentation -- CSS can't use vars in media queries) */
  /* sm: 640px, md: 768px, lg: 1024px, xl: 1280px */
}
```

### 20.6 Reduced Effect Mode

Add a user-controlled toggle beyond prefers-reduced-motion:

```css
:root[data-effects="off"] .effect-layer,
:root[data-effects="off"] .mermaid-shimmer,
:root[data-effects="off"] .disco-ball-wrapper {
  display: none;
}

:root[data-effects="minimal"] .mermaid-shimmer,
:root[data-effects="minimal"] .disco-spotlight-container,
:root[data-effects="minimal"] .mirror-reflection-container {
  display: none;
}
```

This would let users enjoy the site without battery drain while still seeing key
decorative elements.

---

## Summary of All Issues by Priority

### Critical (Should Fix)

1. **Link accessibility** -- Links indistinguishable from text (WCAG violation)
2. **Color contrast** -- `#c1330d` on `#eee6dc` may fail WCAG AA for body text
3. **Muted text contrast** -- `#666` on `#eee6dc` fails WCAG AA
4. **Admin lacks prefers-reduced-motion** -- Animations play for all users
5. **Touch targets below 44px** -- Hamburger, radio inputs, nav links

### High (Should Improve)

6. **Primary color mismatch** between global and admin
7. **Hardcoded semantic colors** -- Success/error colors not in variables
8. **z-index 9999** on trail particles -- Can overlap important UI
9. **Layout-triggering animations** -- height, padding, margin transitions
10. **Admin focus indicators** -- Too subtle for accessibility
11. **Status badges color-only** -- No non-color differentiation

### Medium (Recommended)

12. **global.css monolith** -- Should be split into focused files
13. **No type scale system** -- 16 ad-hoc font sizes
14. **Duplicate code** -- Reset, forms, buttons defined in two places
15. **Inconsistent naming** -- BEM in public, flat in admin
16. **No CSS containment** -- Performance opportunity missed
17. **No shadow/radius variables** -- Maintenance burden
18. **Breakpoint direction inconsistency** -- min-width vs max-width
19. **No dark mode support** -- prefers-color-scheme not handled
20. **Missing button focus-visible** styles

### Low (Nice to Have)

21. **`color-mix()` for transparent variants** -- Modern replacement for hardcoded rgba
22. **`dvh` units** for mobile viewport height
23. **Container queries** for component-level responsiveness
24. **CSS layers** for cascade management
25. **Logical properties** for RTL readiness
26. **Shared design token file** -- Single source of truth
27. **Print styles for admin** -- Currently missing
28. **Font weight 300 audit** -- Possibly unnecessary download
29. **Spacing scale gap** (24px to 48px jump)
30. **Effect lazy-loading** -- Start effects on viewport entry
