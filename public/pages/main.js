/** @file Home page entry point */
import { initMobileNav } from "./mobile-nav.js"
import { initCountdown } from "./countdown.js"
import { initEffectManager } from "./effects/effect-manager.js"
import { getElement, getIFrameElement } from "./utils.js"

initMobileNav()
initCountdown()
initEffectManager()

const registrySection = getElement("registry")
const frame = getIFrameElement("registry-frame")
const registryLink = getElement("registry-link")
const observer = new IntersectionObserver((entries, obs) => {
  if (entries[0].isIntersecting) {
    frame.src = frame.dataset.src || ""
    frame.hidden = false
    registryLink.hidden = false
    obs.disconnect()
  }
}, { rootMargin: "200px" })
observer.observe(registrySection)
