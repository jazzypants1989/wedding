/** @file Home page entry point */
import { initMobileNav } from "../components/mobile-nav.js"
import { initCountdown } from "./countdown.js"
import { initThemeToggle } from "../components/theme-toggle.js"
import { initRegistryFrame } from "./registry.js"
import { loadSession } from "../components/guest-session.js"
import { initThanksBanner } from "../components/thanks-banner.js"

initMobileNav()
initCountdown()
initThemeToggle()
initRegistryFrame()

// Resolve the guest session, then surface any waiting thank-you card banner.
void loadSession().then(() => initThanksBanner())

// Defer effects until after first paint to avoid delaying LCP.
// Dynamic import prevents eager parsing/compilation of all 11 effect modules.
requestAnimationFrame(function () {
  import("../effects/main.js").then(function (m) {
    m.initEffectManager()
  })
})
