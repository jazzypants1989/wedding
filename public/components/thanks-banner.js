/** @file The signed-in "a card is waiting for you" nudge. After loadSession(),
 *  it asks GET /api/thank-you/mine and, if the guest has an un-viewed card that
 *  they haven't locally dismissed, prepends a quiet dismissible banner to
 *  #main-content linking straight to it. Dismissal persists per-token in
 *  localStorage so it doesn't nag on every visit. Uses the shared
 *  .pending-note / .note-nudge look (notice.js mechanics), not a toast. */
/** @import * as Types from "./types.js" */

import { html, api, getCoupleName } from "../pages/utils.js"
import { session } from "./guest-session.js"

/** localStorage key prefixes; the token makes dismissal per-card. The two
 *  variants (unopened "card waiting" vs. opened-but-unanswered nudge) use
 *  distinct prefixes so dismissing one never silences the other. */
const OPEN_PREFIX = "thanks-banner-dismissed:"
const NUDGE_PREFIX = "thanks-nudge-dismissed:"

/** @param {string} prefix @param {string} token @returns {boolean} */
function isDismissed(prefix, token) {
  try {
    return localStorage.getItem(prefix + token) !== null
  } catch {
    return false
  }
}

/** @param {string} prefix @param {string} token */
function remember(prefix, token) {
  try {
    localStorage.setItem(prefix + token, "1")
  } catch {
    // Private mode — the banner just reappears next visit; no harm.
  }
}

/** @type {typeof Types.initThanksBanner} */
export async function initThanksBanner() {
  // Depends on loadSession() having resolved; silently do nothing when signed out.
  if (!session.account) return

  const main = document.getElementById("main-content")
  if (!main) return

  /** @type {{ cards: Types.MyThankYouCard[] }} */
  let data
  try {
    data = /** @type {{ cards: Types.MyThankYouCard[] }} */ (
      await api("/api/thank-you/mine")
    )
  } catch {
    // /mine never 401s; any failure just means no banner this visit.
    return
  }

  const cards = Array.isArray(data.cards) ? data.cards : []

  // First un-opened, not-yet-dismissed card wins the "a card is waiting" banner.
  const unopened = cards.find(
    (c) => !c.viewed_at && !isDismissed(OPEN_PREFIX, c.token),
  )
  if (unopened) {
    mountBanner(main, unopened)
    return
  }

  // Otherwise: an opened card the guest never replied to — a gentle nudge to
  // send something back. Independently dismissible from the "waiting" banner.
  const unanswered = cards.find(
    (c) => c.viewed_at && !c.replied && !isDismissed(NUDGE_PREFIX, c.token),
  )
  if (unanswered) mountNudge(main, unanswered)
}

/** @param {HTMLElement} main @param {Types.MyThankYouCard} card */
function mountBanner(main, card) {
  const token = card.token
  const couple = getCoupleName()
  // Mention photos warmly when the card carries them — a small pull to open.
  const photoNote = card.has_photos ? " with photos" : ""
  const el = document.createElement("div")
  el.className = "pending-note note-nudge thanks-banner"
  el.innerHTML = html`
    <span>💌 ${couple} left you a thank-you card${photoNote} <a href="/thanks?card=${token}">→ Open it</a></span>
    <button type="button" class="note-dismiss" aria-label="Dismiss">&times;</button>`

  const dismiss = el.querySelector(".note-dismiss")
  if (dismiss instanceof HTMLElement) {
    dismiss.addEventListener("click", () => {
      remember(OPEN_PREFIX, token)
      el.remove()
    })
  }
  main.prepend(el)
}

/** The opened-but-unanswered nudge. Deep-links straight to the reply form via the
 *  #tc-reply hash (main.js auto-opens the card there).
 *  @param {HTMLElement} main @param {Types.MyThankYouCard} card */
function mountNudge(main, card) {
  const token = card.token
  const el = document.createElement("div")
  el.className = "pending-note note-nudge thanks-banner"
  el.innerHTML = html`
    <span>You opened 💌 — <a href="/thanks?card=${token}#tc-reply">send a little something back?</a></span>
    <button type="button" class="note-dismiss" aria-label="Dismiss">&times;</button>`

  const dismiss = el.querySelector(".note-dismiss")
  if (dismiss instanceof HTMLElement) {
    dismiss.addEventListener("click", () => {
      remember(NUDGE_PREFIX, token)
      el.remove()
    })
  }
  main.prepend(el)
}
