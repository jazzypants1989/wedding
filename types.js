/** @file Application-wide constants, enums, type guards, DB-native values, and limits */
/** @import * as Types from './types.js' */

import path from "node:path"
export const GUEST_STATUS = Object.freeze({
  PENDING: "pending",
  INVITED: "invited",
  RESPONDED: "responded",
})

export const PETITION_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  DENIED: "denied",
})

export const COMMUNICATION_TYPE = Object.freeze({
  EMAIL: "email",
  SMS: "sms",
})

export const COMMUNICATION_STATUS = Object.freeze({
  SENT: "sent",
  FAILED: "failed",
})

export const SESSION = Object.freeze({
  DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours absolute max
  IDLE_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes idle timeout
  CSRF_ROTATION_MS: 60 * 60 * 1000, // 1 hour CSRF token rotation
})

export const GUEST_SESSION = Object.freeze({
  DURATION_MS: 180 * 24 * 60 * 60 * 1000, // 180 days absolute
  IDLE_TIMEOUT_MS: 60 * 24 * 60 * 60 * 1000, // 60 days idle
  CSRF_ROTATION_MS: 24 * 60 * 60 * 1000, // 24h CSRF token rotation
  MAX_SESSIONS_PER_ACCOUNT: 10, // oldest trimmed on new login
})

export const LIMITS = Object.freeze({
  PARTY_SIZE_MIN: 1,
  PARTY_SIZE_MAX: 20,
  EMAIL_MAX_LENGTH: 254,
  NAME_MAX_LENGTH: 200,
  NOTES_MAX_LENGTH: 1000,
  MESSAGE_MAX_LENGTH: 1000,
  RELATIONSHIP_MAX_LENGTH: 200,
  ACCOUNT_NAME_MAX_LENGTH: 100,
})

export const GUEST_STATUS_VALUES = Object.values(GUEST_STATUS)
export const PETITION_STATUS_VALUES = Object.values(PETITION_STATUS)
export const COMMUNICATION_TYPE_VALUES = Object.values(COMMUNICATION_TYPE)

export const WEDDING = Object.freeze({
  COUPLE_NAMES: "Jesse & Jordana",
  COUPLE_FIRST_NAMES: "Jesse and Jordana",
  DATE: "April 26, 2026",
  DATE_SHORT: "04/26/2026",
  LOCATION: "Portland, OR",
  VENUE: "", // Fill in when decided
})

export const EMAIL_SUBJECTS = Object.freeze({
  INVITE: `You're Invited! ${WEDDING.COUPLE_NAMES}'s Wedding`,
  REMINDER: `Reminder: RSVP for ${WEDDING.COUPLE_NAMES}'s Wedding`,
})

export const RATE_LIMITS = Object.freeze({
  RSVP: { windowMs: 60 * 1000, max: 10 }, // 10 per minute
  LOOKUP: { windowMs: 60 * 1000, max: 3 }, // 3 per minute (strict)
  ADMIN_LOGIN: { windowMs: 60 * 1000, max: 3 }, // 3 per minute
  ADMIN_INVITE: { windowMs: 60 * 60 * 1000, max: 100 }, // 100 per hour
  ACCOUNT_REGISTER: { windowMs: 60 * 60 * 1000, max: 10 }, // 10 per hour per IP (invite-code oracle guard)
})

export const REQUEST_LIMITS = Object.freeze({
  MAX_BODY_SIZE: 1024 * 1024, // 1MB
  REQUEST_TIMEOUT_MS: 30000, // 30 seconds
})

export const PAGINATION = Object.freeze({
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
})

export const BRAND = Object.freeze({
  PRIMARY_COLOR: "#c1330d",
  SECONDARY_COLOR: "#355e3b",
  BACKGROUND_COLOR: "#eee6dc",
})

export const FEATURES = Object.freeze({
  /** Enable fuzzy name matching in guest lookup.
   *  When enabled, name matches require caller's contact info to match the
   *  found guest's contact info before returning an invite code.
   *  Default: false — lookup uses exact email/phone matching only.
   *  Enable for open-source deployments where guest names are individual
   *  (not couple-style like "Josh & Jessica"). */
  ENABLE_NAME_LOOKUP: false,
  /** Enable email as a lookup contact method.
   *  When false, the lookup form only accepts phone numbers.
   *  Default: false — phone-only lookup. */
  ENABLE_EMAIL_LOOKUP: false,
})

/** @type {Types.isGuestStatus} */
export function isGuestStatus(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (GUEST_STATUS_VALUES).includes(value)
}

/** @type {Types.isPetitionStatus} */
export function isPetitionStatus(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (PETITION_STATUS_VALUES).includes(value)
}

/** @type {Types.isCommunicationType} */
export function isCommunicationType(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (COMMUNICATION_TYPE_VALUES).includes(value)
}

const SERVER_PORT = process.env.PORT || 3000

/** Server/runtime configuration derived from the environment.
 *  Grouped into one frozen object (mirroring FEATURES above) instead of loose
 *  boolean/string flags scattered across modules. */
export const SERVER = Object.freeze({
  /** Absolute path to the project root. */
  projectRoot: import.meta.dirname,
  /** HTTP listen port. */
  port: SERVER_PORT,
  /** Scrypt hash of the admin password (set by `npm run setup`). */
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  /** Public base URL used in invite links and cookie Secure detection. */
  baseUrl: process.env.BASE_URL || `http://localhost:${SERVER_PORT}`,
  /** Reply-to / contact email surfaced to guests. */
  contactEmail: process.env.CONTACT_EMAIL || "contact@example.com",
  /** Reverse-proxy IPs whose X-Forwarded-For header we trust. */
  trustedProxies:
    process.env.TRUSTED_PROXIES?.split(",").map((s) => s.trim()) || [],
  /** true → per-request CSP nonce mode; false → static hash mode (cacheable). */
  cspNonce: process.env.CSP_NONCE === "true",
})
