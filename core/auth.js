/** @file Authentication module */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import { sendJson, sendError } from "./http.js"
import { AppError } from "./validation.js"
import {
  getSession,
  updateSessionActivity,
  rotateCsrfToken,
} from "../db/sessions.js"
import { SESSION, SERVER } from "../types.js"
import { log, AUDIT_ACTIONS } from "./utils.js"
import { getClientIp } from "./rate-limit.js"

/** @type {Types.hashPassword} */
function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  return salt.toString("hex") + ":" + hash.toString("hex")
}

/** @type {Types.verifyPassword} */
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false

  const [saltHex, hashHex] = stored.split(":")
  const salt = Buffer.from(saltHex, "hex")
  const hash = Buffer.from(hashHex, "hex")

  if (hash.length !== 64) return false

  const derived = crypto.scryptSync(password, salt, 64)
  return crypto.timingSafeEqual(hash, derived)
}

/** @type {Types.parseCookies} */
function parseCookies(cookieHeader) {
  /** @type {Record<string, string>} */
  const cookies = {}
  if (!cookieHeader) return cookies

  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...valueParts] = cookie.trim().split("=")
    if (name) {
      cookies[name] = valueParts.join("=")
    }
  })

  return cookies
}

/** @type {Types.createSessionCookies} */
function createSessionCookies(session, secure = false) {
  const maxAge = 24 * 60 * 60 // 24 hours in seconds
  const secureFlag = secure ? "; Secure" : ""

  return [
    // Session cookie - HttpOnly so JS can't access it
    `session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureFlag}`,
    // CSRF cookie - NOT HttpOnly so JS can read it for the header
    `csrf=${session.csrf_token}; Path=/; SameSite=Strict; Max-Age=${maxAge}${secureFlag}`,
  ]
}

/** @type {Types.clearSessionCookies} */
function clearSessionCookies() {
  return [
    "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    "csrf=; Path=/; SameSite=Strict; Max-Age=0",
  ]
}

/** @type {Types.validateCsrf} */
function validateCsrf(req, session) {
  const headerValue = req.headers["x-csrf-token"]
  const csrfHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!csrfHeader || !session || !session.csrf_token) return false

  try {
    const headerBuffer = Buffer.from(csrfHeader)
    const sessionBuffer = Buffer.from(session.csrf_token)

    if (headerBuffer.length !== sessionBuffer.length) return false
    return crypto.timingSafeEqual(headerBuffer, sessionBuffer)
  } catch {
    return false
  }
}

export {
  hashPassword,
  verifyPassword,
  parseCookies,
  createSessionCookies,
  clearSessionCookies,
  validateCsrf,
  withErrorHandling,
}

/** @type {Types.withErrorHandling} */
function withErrorHandling(handler) {
  return async (req, res, routeInfo) => {
    try {
      return await handler(req, res, routeInfo)
    } catch (err) {
      if (res.headersSent) {
        console.error("Error after response sent:", err)
        return
      }

      if (err instanceof AppError) {
        return sendError(res, err.statusCode, err.message, err.code)
      }

      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        return sendError(
          res,
          409,
          "A record with this value already exists",
          "DUPLICATE",
        )
      }

      console.error("Unexpected error:", err)
      return sendError(res, 500, "Internal server error", "INTERNAL_ERROR")
    }
  }
}

/** @type {Types.withAdmin} */
export function withAdmin(handler) {
  return withErrorHandling(async (req, res, routeInfo) => {
    const cookies = parseCookies(req.headers.cookie)
    const sessionToken = cookies.session

    if (!sessionToken) {
      return sendJson(res, 401, { error: "Authentication required" })
    }

    const session = getSession(sessionToken)
    if (!session) {
      return sendJson(res, 401, { error: "Session expired or invalid" })
    }

    updateSessionActivity(sessionToken)

    if (req.method && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      if (!validateCsrf(req, session)) {
        log({
          action: AUDIT_ACTIONS.CSRF_FAILURE,
          ip: getClientIp(req),
          details: { method: req.method, url: req.url },
        })
        return sendJson(res, 403, { error: "Invalid CSRF token" })
      }
    }

    let updatedSession = session
    if (session.csrf_rotated_at) {
      const rotatedAt = new Date(session.csrf_rotated_at)
      const csrfAge = Date.now() - rotatedAt.getTime()
      if (csrfAge > SESSION.CSRF_ROTATION_MS) {
        const newCsrfToken = rotateCsrfToken(sessionToken)
        const secureFlag = SERVER.baseUrl.startsWith("https") ? "; Secure" : ""
        res.setHeader(
          "Set-Cookie",
          `csrf=${newCsrfToken}; Path=/; SameSite=Strict; Max-Age=86400${secureFlag}`,
        )
        updatedSession = { ...session, csrf_token: newCsrfToken }
      }
    }

    return await handler(req, res, { ...routeInfo, session: updatedSession })
  })
}
