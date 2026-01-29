/** @file Home page entry point */
import { initMobileNav } from "../components/mobile-nav.js"
import { initCountdown } from "./countdown.js"
import { initThemeToggle } from "../components/theme-toggle.js"
import { initRegistryFrame } from "./registry.js"
import { initEffectManager } from "../effects/main.js"

initMobileNav()
initCountdown()
initEffectManager()
initThemeToggle()
initRegistryFrame()
