/** @file Admin session endpoints */
/** @import * as Types from './types.js' */

import { createSession, deleteSession, hashToken } from "../../db/sessions.js"
import { sendJson, parseBody } from "../../core/http.js"
import { limiters, getClientIp } from "../../core/rate-limit.js"
import { checkRateLimit } from "../../core/http.js"
import {
  verifyPassword,
  getAdminHash,
  parseCookies,
  createSessionCookies,
  clearSessionCookies,
} from "../../core/auth.js"
import { SERVER } from "../../types.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"

/** @type {Types.login} */
export async function login(req, res) {
  const clientIp = getClientIp(req)
  if (checkRateLimit(res, limiters.adminLogin, clientIp)) return

  // Effective hash: setup-wizard value (app_state) wins over the boot-time env.
  const adminHash = getAdminHash()
  if (!adminHash) {
    return sendJson(res, 503, {
      error: "Admin not configured. Run: node scripts/setup-admin.js",
    })
  }

  const body = await parseBody(req)

  const { password } = body
  if (!password || typeof password !== "string") {
    return sendJson(res, 400, { error: "Password required" })
  }

  if (!verifyPassword(password, adminHash)) {
    log({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      ip: clientIp,
      details: { reason: "invalid_password" },
    })
    return sendJson(res, 401, { error: "Invalid password" })
  }

  const session = createSession()

  log({
    action: AUDIT_ACTIONS.LOGIN,
    adminId: hashToken(session.token),
    ip: clientIp,
  })

  limiters.adminLogin.reset(clientIp)

  const isSecure = SERVER.baseUrl.startsWith("https")
  const cookies = createSessionCookies(session, isSecure)

  return sendJson(
    res,
    200,
    {
      success: true,
      message: "Logged in successfully",
    },
    { "Set-Cookie": cookies },
  )
}

/** @type {Types.logout} */
export async function logout(req, res) {
  const cookies = parseCookies(req.headers.cookie)
  const sessionToken = cookies.session

  if (sessionToken) {
    log({
      action: AUDIT_ACTIONS.LOGOUT,
      adminId: hashToken(sessionToken),
    })
    deleteSession(sessionToken)
  }

  const clearCookies = clearSessionCookies()
  return sendJson(
    res,
    200,
    {
      success: true,
      message: "Logged out successfully",
    },
    { "Set-Cookie": clearCookies },
  )
}
