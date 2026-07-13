/** @file First-run setup endpoints (no-code onboarding).
 *
 *  GET  /api/setup — is setup still open? Returns { complete } and, while open,
 *                    the current effective content so the wizard can seed its form.
 *  POST /api/setup — finish setup: verify the one-time token, set the admin
 *                    password (app_state admin_hash), store the site-content diff,
 *                    and auto-login the owner. Token-gated, not admin-gated, since
 *                    there is no admin yet. Zero deps, no regex.
 */
/** @import * as Types from './types.js' */

import { parseBody, sendJson, checkRateLimit } from "../core/http.js"
import { limiters, getClientIp } from "../core/rate-limit.js"
import { ValidationError } from "../core/validation.js"
import { hashPassword, validatePasswordStrength } from "../core/password-policy.js"
import { verifySetupToken, isSetupComplete, completeSetup } from "../core/setup.js"
import { createSessionCookies } from "../core/auth.js"
import { createSession } from "../db/sessions.js"
import { setAppState } from "../db/utils.js"
import { sql } from "../db/sql.js"
import { buildOverride } from "./admin/site-content.js"
import { diffFromDefaults, getContent } from "../core/site-content.js"
import { onContentChanged } from "../core/static.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"
import { SERVER } from "../types.js"

const ADMIN_HASH_KEY = "admin_hash"
const SITE_CONTENT_KEY = "site_content"

/** @type {Types.status} */
export async function status(req, res) {
  const complete = isSetupComplete()
  if (complete) return sendJson(res, 200, { complete: true })
  // While open, hand the wizard the current (default) content to pre-fill its form.
  return sendJson(res, 200, { complete: false, content: getContent() })
}

/** @type {Types.submit} */
export async function submit(req, res) {
  const clientIp = getClientIp(req)
  // Brute-forcing a 256-bit token is infeasible, but rate-limit anyway so a
  // stuck/looping client can't hammer the endpoint. Its own bucket (not the
  // admin-login one) so a few token typos never lock the owner out of login.
  if (checkRateLimit(res, limiters.setup, clientIp)) return

  // Already onboarded → the token is gone; never re-open the wizard.
  if (isSetupComplete()) {
    return sendJson(res, 409, { error: "Setup is already complete" })
  }

  const body = await parseBody(req)

  // Token first, before any validation work, so an unauthorized caller learns
  // nothing about the payload shape.
  if (!verifySetupToken(body.token)) {
    log({ action: AUDIT_ACTIONS.SETUP_FAILED, ip: clientIp, details: { reason: "bad_token" } })
    return sendJson(res, 403, { error: "Invalid or expired setup token" })
  }

  const { password } = body
  if (typeof password !== "string") {
    return sendJson(res, 400, { error: "Password required" })
  }
  const pwError = validatePasswordStrength(password)
  if (pwError) {
    return sendJson(res, 400, { error: pwError })
  }

  // Validate the submitted content into a complete SiteContent (throws
  // ValidationError → 400 via the route's errorHandling wrapper).
  const content = body.content
  if (typeof content !== "object" || content === null) {
    throw new ValidationError("Site content is required")
  }
  const validated = buildOverride(/** @type {Record<string, unknown>} */ (content))

  // Store the content diff FIRST, then the admin hash. The hash is the
  // completion latch (isSetupComplete = !!getAdminHash), so writing it last means
  // a throw partway through leaves the wizard re-runnable rather than half
  // onboarded (an admin with no content). Storing content without an admin is
  // safe and idempotent — the install is still un-onboarded until the hash lands.
  //
  // Only the diff from shipped defaults is kept; an all-defaults submission
  // leaves no override so unchanged fields keep tracking future content.js edits.
  const sparse = diffFromDefaults(validated)
  if (Object.keys(sparse).length === 0) {
    sql`DELETE FROM app_state WHERE key = ${SITE_CONTENT_KEY}`.run()
  } else {
    setAppState(SITE_CONTENT_KEY, JSON.stringify(sparse))
  }
  onContentChanged()

  // Persist the admin password hash (read at request time by getAdminHash()).
  setAppState(ADMIN_HASH_KEY, hashPassword(password))

  // Latch setup complete + retire the one-time token so it can't be replayed.
  completeSetup()

  log({ action: AUDIT_ACTIONS.SETUP_COMPLETE, ip: clientIp, resourceType: "setup" })

  // Auto-login the owner so they land straight in the admin dashboard.
  const session = createSession()
  const isSecure = SERVER.baseUrl.startsWith("https")
  const cookies = createSessionCookies(session, isSecure)

  return sendJson(
    res,
    200,
    { success: true, message: "Setup complete" },
    { "Set-Cookie": cookies },
  )
}
