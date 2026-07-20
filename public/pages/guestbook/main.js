/** @file Guestbook page entry point: nav/theme/session bootstrap + feed init */

import { initMobileNav } from "../../components/mobile-nav.js"
import { initThemeToggle } from "../../components/theme-toggle.js"
import { initAuthSheet, openAuthRecovery } from "../../components/auth-sheet.js"
import { loadSession, session } from "../../components/guest-session.js"
import { showToast } from "../../components/toast.js"
import { initGuestIdentity } from "../../components/guest-identity.js"
import { initReactionBars } from "../../components/reaction-bar.js"
import { initCommentThreads } from "../../components/comment-thread.js"
import { startRelativeTimeTicker } from "../../components/relative-time.js"
import { initThanksBanner } from "../../components/thanks-banner.js"
import { initFeed, openEntry } from "./feed.js"
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
  // Surface any waiting thank-you card for the signed-in guest.
  void initThanksBanner()
  // One delegated listener each for every reaction bar / comment thread on the page.
  initReactionBars(document.body)
  initCommentThreads(document.body)
  const firstPage = initFeed()
  // Keep "just now" / "2 minutes ago" fresh while the feed sits open.
  startRelativeTimeTicker()

  // A shared ?entry= link scrolls to and highlights that one note once the feed
  // has painted (openEntry fetches + prepends it if it's past the first page).
  const params = new URLSearchParams(location.search)
  const entryParam = params.get("entry")
  if (entryParam) {
    const id = Number(entryParam)
    stripQueryParam("/guestbook", "entry")
    if (Number.isInteger(id) && id > 0) {
      void firstPage.then(() => openEntry(id))
    }
  }

  // A magic link that signed the guest in redirects here with ?recover=success —
  // greet them so the sign-in visibly "worked" instead of a silent page load.
  const recover = params.get("recover")
  if (recover === "success") {
    stripQueryParam("/guestbook", "recover")
    const name = session.account ? session.account.name : null
    showToast(name ? `Welcome back, ${name}! 💗` : "You're signed in — welcome back! 💗")
  } else if (recover === "expired") {
    // An expired/used magic link — offer a fresh link right away instead of
    // leaving the guest to find the path again.
    stripQueryParam("/guestbook", "recover")
    openAuthRecovery("That sign-in link had expired — enter your email and we'll send a fresh one.")
  }
}

boot()
