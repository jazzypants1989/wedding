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

/** @type {Set<() => void>} Subscribers notified whenever `session.account` changes. */
const changeListeners = new Set()

/** @type {Types.onSessionChange} */
export function onSessionChange(listener) {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function notifySessionChange() {
  for (const listener of changeListeners) listener()
}

/** @type {Types.loadSession} */
export async function loadSession() {
  try {
    const data = /** @type {Types.MeResponse} */ (await api("/api/account/me"))
    session.account = data.account || null
  } catch {
    // /api/account/me never 401s; treat any failure as signed-out.
    session.account = null
  }
  notifySessionChange()
  return session.account
}

/** @type {Types.logout} */
export async function logout() {
  try {
    // Logout ignores CSRF server-side and never 401s, so a plain POST is enough.
    await api("/api/account/logout", { method: "POST" })
  } catch {
    // Best-effort: clear local state regardless so a guest on a shared device is
    // never trapped in a signed-in UI by a network blip.
  }
  session.account = null
  notifySessionChange()
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

/** @type {Types.cancelPendingAction} */
export function cancelPendingAction() {
  const had = pendingAction !== null
  pendingAction = null
  return had
}

/** @type {Types.setAccount} */
export function setAccount(account) {
  session.account = account
  notifySessionChange()
}
