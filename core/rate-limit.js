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

/**
 * True for RFC-1918 private ranges + loopback. In the Docker/Traefik deployment
 * the reverse proxy always connects from one of these, and its container IP is
 * dynamic — so trusting the private ranges lets us honor X-Forwarded-For without
 * pinning a static proxy IP. Public clients stay untrusted.
 * No regex: strip any IPv6-mapped prefix, then integer octet math.
 * @param {string} addr
 * @returns {boolean}
 */
function isPrivateAddress(addr) {
  // Docker often reports IPv4 peers as IPv6-mapped ("::ffff:10.0.0.5").
  const mapped = "::ffff:"
  const ip = addr.startsWith(mapped) ? addr.slice(mapped.length) : addr
  if (ip === "::1") return true // IPv6 loopback

  const octets = ip.split(".")
  if (octets.length !== 4) return false
  const nums = octets.map(Number)
  for (const n of nums) {
    if (!Number.isInteger(n) || n < 0 || n > 255) return false
  }
  const [a, b] = nums
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 127) return true // 127.0.0.0/8 loopback
  return false
}

/** @type {Types.getClientIp} */
function getClientIp(req) {
  const remoteAddr = req.socket?.remoteAddress || "unknown"

  // Trust X-Forwarded-For from private/loopback peers (Docker network) or any IP
  // explicitly listed in TRUSTED_PROXIES.
  if (isPrivateAddress(remoteAddr) || SERVER.trustedProxies.includes(remoteAddr)) {
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

  petition: createLimiter({
    name: "petition",
    windowMs: RATE_LIMITS.PETITION.windowMs,
    max: RATE_LIMITS.PETITION.max,
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

  accountRecover: createLimiter({
    name: "accountRecover",
    windowMs: RATE_LIMITS.ACCOUNT_RECOVER.windowMs,
    max: RATE_LIMITS.ACCOUNT_RECOVER.max,
  }),

  guestbookPost: createLimiter({
    name: "guestbookPost",
    windowMs: RATE_LIMITS.GUESTBOOK_POST.windowMs,
    max: RATE_LIMITS.GUESTBOOK_POST.max,
  }),

  contentDelete: createLimiter({
    name: "contentDelete",
    windowMs: RATE_LIMITS.CONTENT_DELETE.windowMs,
    max: RATE_LIMITS.CONTENT_DELETE.max,
  }),

  mediaCreate: createLimiter({
    name: "mediaCreate",
    windowMs: RATE_LIMITS.MEDIA_CREATE.windowMs,
    max: RATE_LIMITS.MEDIA_CREATE.max,
  }),

  publicRead: createLimiter({
    name: "publicRead",
    windowMs: RATE_LIMITS.PUBLIC_READ.windowMs,
    max: RATE_LIMITS.PUBLIC_READ.max,
  }),

  commentPost: createLimiter({
    name: "commentPost",
    windowMs: RATE_LIMITS.COMMENT_POST.windowMs,
    max: RATE_LIMITS.COMMENT_POST.max,
  }),

  reactionToggle: createLimiter({
    name: "reactionToggle",
    windowMs: RATE_LIMITS.REACTION_TOGGLE.windowMs,
    max: RATE_LIMITS.REACTION_TOGGLE.max,
  }),

  setup: createLimiter({
    name: "setup",
    windowMs: RATE_LIMITS.SETUP.windowMs,
    max: RATE_LIMITS.SETUP.max,
  }),

  thankYou: createLimiter({
    name: "thankYou",
    windowMs: RATE_LIMITS.THANK_YOU.windowMs,
    max: RATE_LIMITS.THANK_YOU.max,
  }),

  thankYouReply: createLimiter({
    name: "thankYouReply",
    windowMs: RATE_LIMITS.THANK_YOU_REPLY.windowMs,
    max: RATE_LIMITS.THANK_YOU_REPLY.max,
  }),

  adminThankYou: createLimiter({
    name: "adminThankYou",
    windowMs: RATE_LIMITS.ADMIN_THANK_YOU.windowMs,
    max: RATE_LIMITS.ADMIN_THANK_YOU.max,
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
