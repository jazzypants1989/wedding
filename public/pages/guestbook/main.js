/** @file Guestbook page entry point: nav/theme/session bootstrap + feed init */

import { initMobileNav } from "../../components/mobile-nav.js"
import { initThemeToggle } from "../../components/theme-toggle.js"
import { initAuthSheet, openAuthRecovery } from "../../components/auth-sheet.js"
import { loadSession } from "../../components/guest-session.js"
import { initGuestIdentity } from "../../components/guest-identity.js"
import { initReactionBars } from "../../components/reaction-bar.js"
import { initCommentThreads } from "../../components/comment-thread.js"
import { initFeed } from "./feed.js"
import { stripQueryParam } from "../utils.js"

async function boot() {
  initMobileNav()
  initThemeToggle()
  initAuthSheet()
  // Resolve who's signed in before wiring the composer so the write-gate doesn't
  // briefly treat a returning guest as anonymous. The public feed then loads.
  await loadSession()
  // Show "Posting as {name} · Not you?" once we know who's signed in.
  initGuestIdentity()
  // One delegated listener each for every reaction bar / comment thread on the page.
  initReactionBars(document.body)
  initCommentThreads(document.body)
  initFeed()

  // An expired/used magic link redirects here with ?recover=expired — offer a
  // fresh link right away instead of leaving the guest to find the path again.
  const params = new URLSearchParams(location.search)
  if (params.get("recover") === "expired") {
    stripQueryParam("/guestbook", "recover")
    openAuthRecovery("That sign-in link had expired — enter your email and we'll send a fresh one.")
  }
}

boot()
