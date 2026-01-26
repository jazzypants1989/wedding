/** @file Home page entry point */
import { initMobileNav } from "./mobile-nav.js"
import { initCountdown } from "./countdown.js"
import { initEffectManager } from "./effects/effect-manager.js"
import { initControlPanel } from "./effects/control-panel.js"

initMobileNav()
initCountdown()
initEffectManager()
initControlPanel()

const registrySection = document.getElementById("registry")
const frame = document.getElementById("registry-frame")
const registryLink = document.getElementById("registry-link")
if (registrySection && frame) {
  const observer = new IntersectionObserver((entries, obs) => {
    if (entries[0].isIntersecting) {
      frame.src = frame.dataset.src
      frame.hidden = false
      if (registryLink) registryLink.hidden = false
      obs.disconnect()
    }
  }, { rootMargin: "200px" })
  observer.observe(registrySection)
}
