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

export const LIMITS = Object.freeze({
  PARTY_SIZE_MIN: 1,
  PARTY_SIZE_MAX: 20,
  EMAIL_MAX_LENGTH: 254,
  NAME_MAX_LENGTH: 200,
  NOTES_MAX_LENGTH: 1000,
  MESSAGE_MAX_LENGTH: 1000,
  RELATIONSHIP_MAX_LENGTH: 200,
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

/** @type {Types.isGuestStatus} */
export function isGuestStatus(value) {
  return typeof value === "string" && value in GUEST_STATUS
}

/**
 * @param {unknown} value
 * @returns {value is Types.PetitionStatus}
 */
export function isPetitionStatus(value) {
  return typeof value === "string" && value in PETITION_STATUS
}

/**
 * @param {unknown} value
 * @returns {value is Types.CommunicationType}
 */
export function isCommunicationType(value) {
  return typeof value === "string" && value in COMMUNICATION_TYPE
}

export const PROJECT_ROOT = import.meta.dirname
export const PORT = process.env.PORT || 3000
export const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH
export const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "contact@example.com"
export const TRUSTED_PROXIES =
  process.env.TRUSTED_PROXIES?.split(",").map((s) => s.trim()) || []
