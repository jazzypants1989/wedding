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
initMemoriesCount()

/**
 * Fill the landing "N moments shared so far" line from the public /api/config
 * counts (approved gallery photos + guestbook notes). Best-effort: any failure,
 * or a zero total, leaves the line hidden so nothing half-rendered shows.
 */
function initMemoriesCount() {
  const el = document.getElementById("memories-count")
  if (!el) return
  fetch("/api/config", { headers: { Accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : null))
    .then((cfg) => {
      const counts = cfg && cfg.counts
      if (!counts) return
      const total = (counts.photos || 0) + (counts.notes || 0)
      if (total <= 0) return
      el.textContent = `${total} photos & notes from our favorite people`
      el.hidden = false
    })
    .catch(() => {
      // Silent — the section reads fine without the tally.
    })
}

// Resolve the guest session, then surface any waiting thank-you card banner.
void loadSession().then(() => initThanksBanner())

// Defer effects until after first paint to avoid delaying LCP.
// Dynamic import prevents eager parsing/compilation of all 11 effect modules.
requestAnimationFrame(function () {
  import("../effects/main.js").then(function (m) {
    m.initEffectManager()
  })
})
