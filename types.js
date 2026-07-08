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

// Shared moderation status for user-generated content (guestbook entries in
// Phase 2; comments in Phase 5). Media has its own superset enum (adds
// `uploading`) defined when Phase 3 lands. See 00-overview reconciliation 2.
export const CONTENT_STATUS = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  HIDDEN: "hidden",
  REJECTED: "rejected",
})

// Media status is a superset of CONTENT_STATUS: it adds `uploading`, the
// pre-finalize state during which variant PUTs are accepted and the row is
// never publicly visible. See 00-overview reconciliation 2 / 8.
export const MEDIA_STATUS = Object.freeze({
  UPLOADING: "uploading",
  PENDING: "pending",
  APPROVED: "approved",
  HIDDEN: "hidden",
  REJECTED: "rejected",
})

export const MEDIA_KIND = Object.freeze({ IMAGE: "image", VIDEO: "video" })

export const MEDIA_SECTION = Object.freeze({
  OFFICIAL: "official", // admin-curated, explicitly ordered
  GUEST: "guest", // guest uploads, newest-first
})

// Polymorphic content targets — comments and reactions attach to either a
// guestbook entry or a media item (00-overview: single polymorphic tables with
// target_type + target_id). Stored in comments.target_type / reactions.target_type.
export const TARGET_TYPE = Object.freeze({
  GUESTBOOK: "guestbook",
  MEDIA: "media",
})

// Fixed reaction set, stored as stable keys — the server speaks keys and the
// frontend maps key→glyph via a constant. One per emoji per account per target,
// toggleable. See 00-overview reconciliation 4 / decision log.
export const REACTION_EMOJI = Object.freeze({
  HEART: "heart",
  CLAP: "clap",
  LAUGH: "laugh",
  HEART_EYES: "heart_eyes",
  CHEERS: "cheers",
  FIRE: "fire",
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
  GUESTBOOK_MESSAGE_MAX_LENGTH: 2000,
  COMMENT_MAX_LENGTH: 500,
})

export const GUEST_STATUS_VALUES = Object.values(GUEST_STATUS)
export const PETITION_STATUS_VALUES = Object.values(PETITION_STATUS)
export const COMMUNICATION_TYPE_VALUES = Object.values(COMMUNICATION_TYPE)
export const CONTENT_STATUS_VALUES = Object.values(CONTENT_STATUS)
export const MEDIA_STATUS_VALUES = Object.values(MEDIA_STATUS)
export const MEDIA_KIND_VALUES = Object.values(MEDIA_KIND)
export const MEDIA_SECTION_VALUES = Object.values(MEDIA_SECTION)
export const TARGET_TYPE_VALUES = Object.values(TARGET_TYPE)
export const REACTION_EMOJI_VALUES = Object.values(REACTION_EMOJI)

// Moderation digest cadence (owner decision 2026-07-06: digest-only). ~daily,
// generous of the hourly-tick drift so a run is never skipped by a few minutes.
export const MODERATION_NOTIFY = Object.freeze({
  DIGEST_INTERVAL_MS: 22 * 60 * 60 * 1000,
})

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
  ACCOUNT_RECOVER: { windowMs: 60 * 60 * 1000, max: 10 }, // 10 per hour per IP (recovery-email oracle guard)
  GUESTBOOK_POST: { windowMs: 60 * 60 * 1000, max: 10 }, // 10 posts/hour, keyed per account
  CONTENT_DELETE: { windowMs: 60 * 60 * 1000, max: 30 }, // 30 self-deletes/hour, keyed per account
  MEDIA_CREATE: { windowMs: 60 * 60 * 1000, max: 30 }, // 30 upload sessions/hour, keyed per account
  PUBLIC_READ: { windowMs: 60 * 1000, max: 120 }, // 120/min per IP, shared across public list GETs
  COMMENT_POST: { windowMs: 60 * 60 * 1000, max: 60 }, // 60 comments/hour, keyed per account
  REACTION_TOGGLE: { windowMs: 60 * 1000, max: 30 }, // 30 toggles/min, keyed per account
})

export const REQUEST_LIMITS = Object.freeze({
  MAX_BODY_SIZE: 1024 * 1024, // 1MB
  REQUEST_TIMEOUT_MS: 30000, // 30 seconds
})

// Per-variant byte caps and upload-session timing. Enforced both client-side
// (pre-upload reject) and server-side (mid-stream abort). See 03 §1 / §3.
export const MEDIA_LIMITS = Object.freeze({
  IMAGE_ORIGINAL_MAX: 30 * 1024 * 1024,
  VIDEO_ORIGINAL_MAX: 110 * 1024 * 1024, // 100MB cap + container slack
  DISPLAY_MAX: 4 * 1024 * 1024,
  THUMB_MAX: 500 * 1024,
  POSTER_MAX: 1024 * 1024,
  VIDEO_MAX_DURATION_S: 60,
  UPLOAD_IDLE_TIMEOUT_MS: 30_000,
  UPLOAD_ABSOLUTE_TIMEOUT_MS: 10 * 60_000,
  MAX_CONCURRENT_UPLOADS_PER_ACCOUNT: 3,
  HEAD_SNIFF_BYTES: 32, // bytes buffered for magic-byte sniffing
  ABANDONED_UPLOAD_MAX_AGE_MS: 6 * 60 * 60 * 1000, // sweep uploading rows older than this
  STAGING_PART_MAX_AGE_MS: 60 * 60 * 1000, // sweep tmp/*.part older than this
})

/** @param {string} name @param {number} dflt @returns {number} */
function envBytes(name, dflt) {
  const raw = process.env[name]
  if (!raw) return dflt
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : dflt
}

// Disk-guard thresholds (03 §6). Overridable per-deployment via .env.
export const MEDIA_STORAGE = Object.freeze({
  MIN_FREE_BYTES: envBytes("MEDIA_MIN_FREE_BYTES", 5 * 1024 * 1024 * 1024), // 5GB headroom
  MAX_TOTAL_BYTES: envBytes("MEDIA_MAX_TOTAL_BYTES", 45 * 1024 * 1024 * 1024), // 45GB total originals
  UNTRUSTED_QUOTA_BYTES: envBytes("MEDIA_UNTRUSTED_QUOTA_BYTES", 250 * 1024 * 1024), // 250MB per untrusted account
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

/** @type {Types.isContentStatus} */
export function isContentStatus(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (CONTENT_STATUS_VALUES).includes(value)
}

/** @type {Types.isMediaStatus} */
export function isMediaStatus(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (MEDIA_STATUS_VALUES).includes(value)
}

/** @type {Types.isMediaKind} */
export function isMediaKind(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (MEDIA_KIND_VALUES).includes(value)
}

/** @type {Types.isMediaSection} */
export function isMediaSection(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (MEDIA_SECTION_VALUES).includes(value)
}

/** @type {Types.isTargetType} */
export function isTargetType(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (TARGET_TYPE_VALUES).includes(value)
}

/** @type {Types.isReactionEmoji} */
export function isReactionEmoji(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (REACTION_EMOJI_VALUES).includes(value)
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
