/** @file Home page entry point */
import { initMobileNav } from "../components/mobile-nav.js"
import { initCountdown } from "./countdown.js"
import { initThemeToggle } from "../components/theme-toggle.js"
import { initRegistryFrame } from "./registry.js"

initMobileNav()
initCountdown()
initThemeToggle()
initRegistryFrame()

// Defer effects until after first paint to avoid delaying LCP.
// Dynamic import prevents eager parsing/compilation of all 11 effect modules.
requestAnimationFrame(function () {
  import("../effects/main.js").then(function (m) {
    m.initEffectManager()
  })
})
