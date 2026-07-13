/** @file First-run setup state: one-time token + completion gate.
 *
 *  A fresh, un-onboarded install (no admin password hash in `app_state` and none
 *  in the `ADMIN_PASSWORD_HASH` env) opens a public `/setup` wizard so the owner
 *  can configure the site with no code. An open `/setup` on a public URL is an
 *  admin-takeover race, so — mirroring Jenkins' `initialAdminPassword` — we print
 *  a one-time setup token to stdout at boot and require it to finish setup.
 *
 *  The token is held in memory only (never persisted): generated at boot when the
 *  install is un-onboarded, printed once, and cleared the moment setup completes.
 *  A restart before finishing prints a fresh token. Once an admin hash exists
 *  (wizard finished, or an existing env-configured deploy) setup is complete, the
 *  token is null, and the wizard is disabled. Zero deps, no regex.
 */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { getAdminHash } from "./auth.js"

/** @type {string | null} in-memory one-time setup token, or null once complete */
let setupToken = null

/** Latches true once setup is complete and never reverts (an install never
 *  un-onboards). Lets isSetupComplete() skip a per-request app_state read on the
 *  hot path once onboarded — it's called on every request in server.js. */
let setupComplete = false

/** True once an admin password hash exists (wizard finished OR env-configured).
 *  This is the gate that disables the wizard and suppresses the token. Latches so
 *  the steady state doesn't hit the DB on every request; only an un-onboarded
 *  install (pre-setup, transient) still reads app_state each call.
 *  @type {Types.isSetupComplete} */
export function isSetupComplete() {
  if (setupComplete) return true
  if (getAdminHash()) setupComplete = true
  return setupComplete
}

/** Generate + print the one-time token when the install is un-onboarded. Called
 *  once at boot after the DB is up. No-op (and prints nothing) when setup is
 *  already complete, so existing env-configured deploys are untouched.
 *  @type {Types.initSetup} */
export function initSetup() {
  if (isSetupComplete()) {
    setupToken = null
    return
  }
  setupToken = crypto.randomBytes(32).toString("hex")
  console.log(
    "\n" +
      "========================================================================\n" +
      "  FIRST-RUN SETUP REQUIRED\n" +
      "  This site has no admin password yet. Open /setup and paste this token\n" +
      "  to configure it (shown once; a restart prints a new one):\n\n" +
      "      " + setupToken + "\n" +
      "========================================================================\n",
  )
}

/** Constant-time check of a client-supplied token against the in-memory one.
 *  False when setup is complete (token null) or the value doesn't match.
 *  @type {Types.verifySetupToken} */
export function verifySetupToken(provided) {
  if (!setupToken || typeof provided !== "string") return false
  const a = Buffer.from(setupToken)
  const b = Buffer.from(provided)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Latch setup complete and clear the token so it can't be replayed after the
 *  wizard finishes.
 *  @type {Types.completeSetup} */
export function completeSetup() {
  setupComplete = true
  setupToken = null
}
