/** @file SQLite-backed rate limiting */
/** @import * as Types from './types.js' */

import { getDb } from "../db/connection.js"
import { TRUSTED_PROXIES } from "../types.js"

/** @type {Types.cleanExpired} */
function cleanExpired(name) {
  const db = getDb()
  const now = Date.now()
  db.prepare("DELETE FROM rate_limits WHERE limiter = ? AND reset_at <= ?").run(
    name,
    now,
  )
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
      const db = getDb()
      const now = Date.now()
      const resetAt = now + windowMs

      const result = db
        .prepare(
          `
        INSERT INTO rate_limits (key, limiter, count, reset_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT (key, limiter) DO UPDATE SET
          count = CASE
            WHEN rate_limits.reset_at <= ?
            THEN 1
            ELSE rate_limits.count + 1
          END,
          reset_at = CASE
            WHEN rate_limits.reset_at <= ?
            THEN excluded.reset_at
            ELSE rate_limits.reset_at
          END
        RETURNING count, reset_at
      `,
        )
        .get(key, name, resetAt, now, now)

      const count = Number(result?.count ?? 1)
      const resultResetAt = Number(result?.reset_at ?? resetAt)

      return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        resetAt: resultResetAt,
      }
    },

    reset(key) {
      getDb()
        .prepare("DELETE FROM rate_limits WHERE key = ? AND limiter = ?")
        .run(key, name)
    },
  }
}

/** @type {Types.getClientIp} */
function getClientIp(req) {
  const remoteAddr = req.socket?.remoteAddress || "unknown"

  if (TRUSTED_PROXIES.length > 0 && TRUSTED_PROXIES.includes(remoteAddr)) {
    const forwarded = req.headers["x-forwarded-for"]
    if (forwarded) {
      const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded
      return forwardedStr.split(",")[0].trim()
    }
  }

  return remoteAddr
}

const limiters = {
  rsvp: createLimiter({
    name: "rsvp",
    windowMs: 60 * 1000,
    max: 10,
  }),

  lookup: createLimiter({
    name: "lookup",
    windowMs: 60 * 1000,
    max: 3,
  }),

  adminLogin: createLimiter({
    name: "adminLogin",
    windowMs: 60 * 1000,
    max: 3,
  }),

  adminInvite: createLimiter({
    name: "adminInvite",
    windowMs: 60 * 60 * 1000,
    max: 100,
  }),
}

/** @type {Types.clearAllStores} */
function clearAllStores() {
  getDb().prepare("DELETE FROM rate_limits").run()
}

/** @type {Types.cleanAllExpired} */
function cleanAllExpired() {
  const db = getDb()
  const now = Date.now()
  db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(now)
}

export { createLimiter, getClientIp, limiters, clearAllStores, cleanAllExpired }
