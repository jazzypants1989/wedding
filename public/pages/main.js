/** @file Home page entry point */
import { initMobileNav } from "./mobile-nav.js"
import { initCountdown } from "./countdown.js"
import { initEffectManager } from "./effects/effect-manager.js"
import { initControlPanel } from "./effects/control-panel.js"

initMobileNav()
initCountdown()
initEffectManager()
initControlPanel()
