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
  CONTENT: "content", // admin site-content images (e.g. dress-code); never in a gallery feed
  HONEYMOON: "honeymoon", // the couple's honeymoon photos: admin-curated + ordered, like official
})

// The admin-curated gallery sections: admin-only upload, auto-approved, one
// sort_order page each, and movable between each other by the admin. A guest
// upload can never land in one (api/media.js createSession).
export const CURATED_MEDIA_SECTIONS = Object.freeze([
  MEDIA_SECTION.OFFICIAL,
  MEDIA_SECTION.HONEYMOON,
])

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

// Digital thank-you cards (Phase 1). Reply is stored as columns on the card
// (reply_emoji/reply_message/replied_at), not the polymorphic `reactions`
// table — recipients authenticate by token and may have no account.
export const THANK_YOU_CARD_STATUS = Object.freeze({
  DRAFT: "draft",
  SENT: "sent",
  VIEWED: "viewed",
})

export const THANK_YOU_SENT_VIA = Object.freeze({
  EMAIL: "email",
  SMS: "sms",
  MANUAL: "manual",
  LINK: "link", // "copy link" delivery — marked sent without an email/SMS send
})

// Card theme allowlist — single source of truth shared with the visuals
// planner's EFFECT_THEMES (public/effects/themes.js). Kept as a plain literal
// list here (not imported from public/) so the backend has no dependency on
// frontend modules; a Phase 7 test asserts the two stay in sync.
export const THANK_YOU_THEME_VALUES = Object.freeze([
  "mermaid-disco",
  "romantic",
  "elegant",
  "classic",
  "celestial",
  "garden",
  "winter",
  "coastal",
  "celebration",
  "gratitude",
])

export const SESSION = Object.freeze({
  DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours absolute max
  IDLE_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes idle timeout
  CSRF_ROTATION_MS: 60 * 60 * 1000, // 1 hour CSRF token rotation
  MAX_CONCURRENT: 5, // admin logins kept at once; a 6th signs out the longest-idle
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
  ADDITIONAL_INFO_MAX_LENGTH: 500,
  RELATIONSHIP_MAX_LENGTH: 200,
  ACCOUNT_NAME_MAX_LENGTH: 100,
  GUESTBOOK_MESSAGE_MAX_LENGTH: 2000,
  COMMENT_MAX_LENGTH: 500,
  THANK_YOU_MESSAGE_MAX_LENGTH: 2000,
  THANK_YOU_REPLY_MAX_LENGTH: 500,
  THANK_YOU_MEDIA_MAX_KEYS: 12,
  // effects_config is opaque JSON text (backend never parses its shape beyond
  // JSON.parse validity); size is capped so a card row can't carry unbounded
  // JSON. Enforced at admin write-time (api/admin/thank-you.js, Phase 3).
  THANK_YOU_EFFECTS_CONFIG_MAX_BYTES: 16384,
  // Gift amount is free-form admin-only text ("$100", "KitchenAid mixer", a
  // blank) — never summed, never shown on the card. Short cap just guards
  // against pasting something absurd into the field.
  GIFT_AMOUNT_MAX_LENGTH: 100,
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
export const THANK_YOU_CARD_STATUS_VALUES = Object.values(THANK_YOU_CARD_STATUS)
export const THANK_YOU_SENT_VIA_VALUES = Object.values(THANK_YOU_SENT_VIA)

// What one event in the face-assignment ledger can do (schema.js
// `add_vision_provenance`). A frozen array rather than the NAME: "value" shape
// above, because these values have no useful constant names —
// FACE_ASSIGNMENT_OPS.NOT_A_FACE would say nothing "not_a_face" does not.
//
// `negative` ("this face is NOT that person") is a constraint, not a state:
// replay skips it, and it feeds suggestion ranking instead. There is
// deliberately no `merge` op — a merge is a fact about identities, recorded
// once on face_identities.merged_into.
export const FACE_ASSIGNMENT_OPS = Object.freeze([
  "assign",
  "clear",
  "not_a_face",
  "negative",
])

// Moderation digest cadence (owner decision 2026-07-06: digest-only). ~daily,
// generous of the hourly-tick drift so a run is never skipped by a few minutes.
export const MODERATION_NOTIFY = Object.freeze({
  DIGEST_INTERVAL_MS: 22 * 60 * 60 * 1000,
})

// Server-side wedding facts (email/SMS templates, media default author name) and
// email subjects now live in core/wedding-facts.js, which reads the *effective*
// site content (defaults ⊕ runtime override) at call time — so an onboarded
// self-hoster's invites carry their couple's name, not the sample defaults. Kept
// out of this low-level constants module to avoid pulling the DB in here.

export const RATE_LIMITS = Object.freeze({
  RSVP: { windowMs: 60 * 1000, max: 10 }, // 10 per minute
  LOOKUP: { windowMs: 60 * 1000, max: 3 }, // 3 per minute (strict)
  // Own bucket: a guest whose lookups struck out shouldn't arrive at the
  // petition form already rate-limited (lookup retries used to eat this budget).
  PETITION: { windowMs: 60 * 1000, max: 3 }, // 3 per minute
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
  SETUP: { windowMs: 60 * 60 * 1000, max: 20 }, // 20 first-run setup attempts/hour per IP
  THANK_YOU: { windowMs: 60 * 1000, max: 20 }, // 20/min per IP — public GET /api/thank-you/:token
  THANK_YOU_REPLY: { windowMs: 60 * 60 * 1000, max: 10 }, // 10 replies/hour per IP (token is the auth)
  ADMIN_THANK_YOU: { windowMs: 60 * 60 * 1000, max: 100 }, // 100/hour, keyed on admin session token
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
  // Responsive width-ladder variants (content section only). Byte caps scale
  // with the long-edge target, roughly tracking THUMB_MAX..DISPLAY_MAX.
  W400_MAX: 500 * 1024,
  W800_MAX: 1536 * 1024,
  W1600_MAX: 4 * 1024 * 1024,
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
  // Rejected media is set aside in quarantine/ (mis-click recovery) but still
  // counts against the caps above until this window elapses, when the daily
  // sweep deletes it and drops the row from the byte sums.
  QUARANTINE_TTL_MS:
    envBytes("MEDIA_QUARANTINE_TTL_DAYS", 7) * 24 * 60 * 60 * 1000,
})

// Hourly WAL-safe database snapshot (db/snapshot.js), written beside the database
// so the nightly file-level volume backup always contains a clean copy.
export const DB_SNAPSHOT = Object.freeze({
  INTERVAL_MS: 60 * 60 * 1000,
  INITIAL_DELAY_MS: 5 * 60 * 1000, // first one a few minutes after boot
  KEEP: 24, // a day of hourly snapshots
})

// Responsive width ladder for content-section images (e.g. dress-code figures).
// Long-edge caps; scoped to section='content' so the thousands of guest gallery
// uploads keep the lean display+thumb pair and don't pay the ladder's storage.
// The client mirrors these names + edges in its processing config (there is a
// keep-in-sync note there — types.js can't be imported client-side).
export const CONTENT_IMAGE_LADDER = Object.freeze([
  Object.freeze({ name: "w400", maxEdge: 400 }),
  Object.freeze({ name: "w800", maxEdge: 800 }),
  Object.freeze({ name: "w1600", maxEdge: 1600 }),
])
export const CONTENT_LADDER_VARIANT_NAMES = Object.freeze(
  CONTENT_IMAGE_LADDER.map((v) => v.name),
)

/**
 * The variant files a finalized row is expected to carry — the single source of
 * truth shared by `finalize` (which gates the upload) and the daily integrity
 * sweep (which flags missing files). Video → poster; content images → the width
 * ladder; guest/official images → display+thumb (or original-only when the
 * client couldn't decode a display, e.g. desktop-Chrome HEIC).
 * @type {Types.expectedVariants}
 */
export function expectedVariants(kind, section, needsDisplay) {
  if (kind === MEDIA_KIND.VIDEO) return ["original", "poster"]
  if (section === MEDIA_SECTION.CONTENT) {
    return ["original", ...CONTENT_LADDER_VARIANT_NAMES]
  }
  return needsDisplay ? ["original"] : ["original", "display", "thumb"]
}

export const PAGINATION = Object.freeze({
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
})

export const MODERATION = Object.freeze({
  // Hard ceiling on one approve-all sweep — far above any realistic queue. When
  // a backlog exceeds this, the handler returns a `remaining` count so the
  // client can keep sweeping until drained.
  APPROVE_ALL_MAX: 5000,
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

/** @type {Types.isCuratedMediaSection} */
export function isCuratedMediaSection(value) {
  return (
    typeof value === "string" &&
    /** @type {readonly string[]} */ (CURATED_MEDIA_SECTIONS).includes(value)
  )
}

/** @type {Types.isTargetType} */
export function isTargetType(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (TARGET_TYPE_VALUES).includes(value)
}

/** @type {Types.isReactionEmoji} */
export function isReactionEmoji(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (REACTION_EMOJI_VALUES).includes(value)
}

/** @type {Types.isThankYouCardStatus} */
export function isThankYouCardStatus(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (THANK_YOU_CARD_STATUS_VALUES).includes(value)
}

/** @type {Types.isThankYouSentVia} */
export function isThankYouSentVia(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (THANK_YOU_SENT_VIA_VALUES).includes(value)
}

/** @type {Types.isFaceAssignmentOp} */
export function isFaceAssignmentOp(value) {
  return typeof value === "string" && /** @type {readonly string[]} */ (FACE_ASSIGNMENT_OPS).includes(value)
}

const SERVER_PORT = process.env.PORT || 3000

/** Public base URL with any trailing slash(es) stripped once, so callers can
 *  safely concatenate `${baseUrl}/thanks` etc. without producing `//thanks`
 *  in emailed/SMS links. No regex — trim slashes with string methods. */
let NORMALIZED_BASE_URL = process.env.BASE_URL || `http://localhost:${SERVER_PORT}`
while (NORMALIZED_BASE_URL.endsWith("/")) {
  NORMALIZED_BASE_URL = NORMALIZED_BASE_URL.slice(0, -1)
}

/** Server/runtime configuration derived from the environment.
 *  Grouped into one frozen object (mirroring FEATURES above) instead of loose
 *  boolean/string flags scattered across modules. */
export const SERVER = Object.freeze({
  /** Absolute path to the project root. */
  projectRoot: import.meta.dirname,
  /** HTTP listen port. */
  port: SERVER_PORT,
  /** Address to listen on. Unset means every interface, which a container needs. */
  bindHost: process.env.BIND_HOST || undefined,
  /** Scrypt hash of the admin password (set by `npm run setup`). */
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
  /** Public base URL used in invite links and cookie Secure detection
   *  (trailing slashes stripped — see NORMALIZED_BASE_URL above). */
  baseUrl: NORMALIZED_BASE_URL,
  /** Reply-to / contact email surfaced to guests. */
  contactEmail: process.env.CONTACT_EMAIL || "contact@example.com",
  /** Reverse-proxy IPs whose X-Forwarded-For header we trust. */
  trustedProxies:
    process.env.TRUSTED_PROXIES?.split(",").map((s) => s.trim()) || [],
  /** true → per-request CSP nonce mode; false → static hash mode (cacheable). */
  cspNonce: process.env.CSP_NONCE === "true",
})
