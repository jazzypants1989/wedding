/** @file Guestbook page entry point: nav/theme/session bootstrap + feed init */

import { initMobileNav } from "../../components/mobile-nav.js"
import { initThemeToggle } from "../../components/theme-toggle.js"
import { initAuthSheet } from "../../components/auth-sheet.js"
import { loadSession } from "../../components/guest-session.js"
import { initFeed } from "./feed.js"

async function boot() {
  initMobileNav()
  initThemeToggle()
  initAuthSheet()
  // Resolve who's signed in before wiring the composer so the write-gate doesn't
  // briefly treat a returning guest as anonymous. The public feed then loads.
  await loadSession()
  initFeed()
}

boot()
