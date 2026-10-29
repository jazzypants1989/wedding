/** @file Effect bootstrap for guest pages other than the landing page (which
 *  starts the manager itself from pages/main.js).
 *
 *  A page opts into its theme's ambience with one tag and no change to its own
 *  entry module:
 *
 *    <script type="module" src="/effects/autostart.js"></script>
 *
 *  Mirrors the landing page's deferral — wait for first paint, then import the
 *  manager — so effect modules never compete with the page's LCP. The page id
 *  comes from the URL, so registry entries limited to other pages (landing set
 *  pieces) sit out. Reduced motion is handled inside initEffectManager.
 *
 *  Not wired into any page yet: which pages get which ambience is the design
 *  round's decision (docs/post-wedding/DESIGN-SLOTS.md).
 */

import { effectPageFromPath } from "./pages.js"

const page = effectPageFromPath(location.pathname)
if (page) {
  requestAnimationFrame(() => {
    import("./main.js").then((m) => m.initEffectManager({ page }))
  })
}
