/** @file Guest session state + write-gating (the guest analog of an auth guard).
 *
 * A signed-out guest may browse freely; the account gate fires only when they
 * try to write. requireAccount() stashes the intended action and opens the auth
 * sheet — after a successful sign-in the stashed action replays automatically,
 * so a guest who tapped "Sign the guestbook" sees it land without re-tapping.
 */
/** @import * as Types from "./types.js" */

import { api } from "../pages/utils.js"
import { openAuthSheet } from "./auth-sheet.js"

/** @type {Types.GuestSessionState} */
export const session = { account: null }

/** @type {(() => void) | null} */
let pendingAction = null

/** @type {Types.loadSession} */
export async function loadSession() {
  try {
    const data = /** @type {Types.MeResponse} */ (await api("/api/account/me"))
    session.account = data.account || null
  } catch {
    // /api/account/me never 401s; treat any failure as signed-out.
    session.account = null
  }
  return session.account
}

/** @type {Types.requireAccount} */
export function requireAccount(action) {
  if (session.account) {
    action()
    return
  }
  pendingAction = action
  openAuthSheet()
}

/** @type {Types.replayPendingAction} */
export function replayPendingAction() {
  const action = pendingAction
  pendingAction = null
  if (action) action()
}

/** @type {Types.setAccount} */
export function setAccount(account) {
  session.account = account
}
