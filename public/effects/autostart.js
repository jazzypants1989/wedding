/** @file Effect bootstrap for guest pages other than the landing page (which
 *  starts the manager itself from pages/main.js).
 *
 *  A page opts into its theme's ambience with one tag and no change to its own
 *  entry module:
 *
 *    <script type="module" src="/effects/autostart.js"></script>
 *
 *  Mirrors the landing page's deferral: wait for first paint, then import the
 *  manager, so effect modules never compete with the page's LCP. The page id comes
 *  from the URL, and the manager starts only the effects placed on that page (the
 *  `pages` config key, inside the registry's limits).
 *
 *  Wired into guestbook, gallery and RSVP, each of which also carries effects.css
 *  and data-effect-config. Not on memory-book (it prints), admin, setup, studio or
 *  thanks; see docs/post-wedding/DESIGN-SLOTS.md.
 */

import { PLACEABLE_EFFECT_PAGES, effectPageFromPath } from "./pages.js"

const page = effectPageFromPath(location.pathname)
// Reduced motion would stop the manager anyway; this also spares the download.
const stillMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
if (page && PLACEABLE_EFFECT_PAGES.includes(page) && !stillMotion) {
  requestAnimationFrame(() => {
    import("./main.js").then((m) => m.initEffectManager({ page }))
  })
}
