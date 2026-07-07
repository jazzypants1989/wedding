/** @file SQLite-backed rate limiting */
/** @import * as Types from './types.js' */

import { SERVER, RATE_LIMITS } from "../types.js"
import { sql } from "../db/sql.js"

/** @type {Types.cleanExpired} */
function cleanExpired(name) {
  const now = Date.now()
  sql`DELETE FROM rate_limits WHERE limiter = ${name} AND reset_at <= ${now}`.run()
}

/** @type {Types.createLimiter} */
function createLimiter({ name, windowMs, max }) {
  setInterval(
    () => {
      try {
        cleanExpired(name)
      } catch (err) {
        console.error(`Rate limiter cleanup error for ${name}:`, err)
      }
    },
    5 * 60 * 1000,
  ).unref()

  return {
    check(key) {
      const now = Date.now()
      const resetAt = now + windowMs

      const result = sql`INSERT INTO rate_limits (key, limiter, count, reset_at)
        VALUES (${key}, ${name}, 1, ${resetAt})
        ON CONFLICT (key, limiter) DO UPDATE SET
          count = CASE
            WHEN rate_limits.reset_at <= ${now}
            THEN 1
            ELSE rate_limits.count + 1
          END,
          reset_at = CASE
            WHEN rate_limits.reset_at <= ${now}
            THEN excluded.reset_at
            ELSE rate_limits.reset_at
          END
        RETURNING count, reset_at`.get()

      const count = Number(result?.count ?? 1)
      const resultResetAt = Number(result?.reset_at ?? resetAt)

      return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        resetAt: resultResetAt,
      }
    },

    reset(key) {
      sql`DELETE FROM rate_limits WHERE key = ${key} AND limiter = ${name}`.run()
    },
  }
}

/** @type {Types.getClientIp} */
function getClientIp(req) {
  const remoteAddr = req.socket?.remoteAddress || "unknown"

  if (SERVER.trustedProxies.length > 0 && SERVER.trustedProxies.includes(remoteAddr)) {
    const forwarded = req.headers["x-forwarded-for"]
    if (forwarded) {
      const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded
      const parts = forwardedStr.split(",").map(s => s.trim())
      const depth = parseInt(process.env.TRUSTED_PROXY_DEPTH || "1", 10)
      return parts[Math.max(0, parts.length - depth)]
    }
  }

  return remoteAddr
}

const limiters = {
  rsvp: createLimiter({
    name: "rsvp",
    windowMs: RATE_LIMITS.RSVP.windowMs,
    max: RATE_LIMITS.RSVP.max,
  }),

  lookup: createLimiter({
    name: "lookup",
    windowMs: RATE_LIMITS.LOOKUP.windowMs,
    max: RATE_LIMITS.LOOKUP.max,
  }),

  adminLogin: createLimiter({
    name: "adminLogin",
    windowMs: RATE_LIMITS.ADMIN_LOGIN.windowMs,
    max: RATE_LIMITS.ADMIN_LOGIN.max,
  }),

  adminInvite: createLimiter({
    name: "adminInvite",
    windowMs: RATE_LIMITS.ADMIN_INVITE.windowMs,
    max: RATE_LIMITS.ADMIN_INVITE.max,
  }),

  accountRegister: createLimiter({
    name: "accountRegister",
    windowMs: RATE_LIMITS.ACCOUNT_REGISTER.windowMs,
    max: RATE_LIMITS.ACCOUNT_REGISTER.max,
  }),
}

/** @type {Types.clearAllStores} */
function clearAllStores() {
  sql`DELETE FROM rate_limits`.run()
}

/** @type {Types.cleanAllExpired} */
function cleanAllExpired() {
  const now = Date.now()
  sql`DELETE FROM rate_limits WHERE reset_at <= ${now}`.run()
}

export { createLimiter, getClientIp, limiters, clearAllStores, cleanAllExpired }
