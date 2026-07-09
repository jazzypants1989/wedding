/** @file The "Posting as {name} · Not you?" affordance for guest pages.
 *
 * Invite codes are per household and a phone gets shared, so two people can end
 * up on one signed-in session. This bar shows who's currently signed in and lets
 * the next person sign out + re-identify. Hidden while signed out (the auth sheet
 * handles first identification). Re-renders on every session change.
 */
/** @import * as Types from "./types.js" */

import { html } from "../pages/utils.js"
import { session, logout, onSessionChange } from "./guest-session.js"
import { openAuthSheet } from "./auth-sheet.js"

/** @type {Types.initGuestIdentity} */
export function initGuestIdentity(containerId = "guest-identity") {
  const container = document.getElementById(containerId)
  if (!container) return

  const render = () => {
    const account = session.account
    if (!account) {
      container.hidden = true
      container.textContent = ""
      return
    }
    container.innerHTML = html`
      <span class="guest-identity-label">Posting as
        <strong>${account.name}</strong></span>
      <button type="button" class="auth-link guest-identity-switch"
        data-guest-signout>Not you?</button>`
    container.hidden = false
  }

  container.addEventListener("click", (e) => {
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    if (!target.closest("[data-guest-signout]")) return
    void handleSignout()
  })

  onSessionChange(render)
  render()
}

async function handleSignout() {
  await logout()
  // Re-open the auth sheet so the next person on a shared device can identify
  // themselves; dismissing it just leaves them browsing signed-out.
  openAuthSheet()
}
