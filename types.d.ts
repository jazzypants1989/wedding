/** @file Types for application-wide constants */

export const GUEST_STATUS: {
  readonly PENDING: "pending"
  readonly INVITED: "invited"
  readonly RESPONDED: "responded"
}

export const PETITION_STATUS: {
  readonly PENDING: "pending"
  readonly APPROVED: "approved"
  readonly DENIED: "denied"
}

export const COMMUNICATION_TYPE: {
  readonly EMAIL: "email"
  readonly SMS: "sms"
}

export const COMMUNICATION_STATUS: {
  readonly SENT: "sent"
  readonly FAILED: "failed"
}

export const CONTENT_STATUS: {
  readonly PENDING: "pending"
  readonly APPROVED: "approved"
  readonly HIDDEN: "hidden"
  readonly REJECTED: "rejected"
}

export const MEDIA_STATUS: {
  readonly UPLOADING: "uploading"
  readonly PENDING: "pending"
  readonly APPROVED: "approved"
  readonly HIDDEN: "hidden"
  readonly REJECTED: "rejected"
}

export const MEDIA_KIND: {
  readonly IMAGE: "image"
  readonly VIDEO: "video"
}

export const MEDIA_SECTION: {
  readonly OFFICIAL: "official"
  readonly GUEST: "guest"
}

export const TARGET_TYPE: {
  readonly GUESTBOOK: "guestbook"
  readonly MEDIA: "media"
}

export const REACTION_EMOJI: {
  readonly HEART: "heart"
  readonly CLAP: "clap"
  readonly LAUGH: "laugh"
  readonly HEART_EYES: "heart_eyes"
  readonly CHEERS: "cheers"
  readonly FIRE: "fire"
}

export const MEDIA_LIMITS: {
  readonly IMAGE_ORIGINAL_MAX: number
  readonly VIDEO_ORIGINAL_MAX: number
  readonly DISPLAY_MAX: number
  readonly THUMB_MAX: number
  readonly POSTER_MAX: number
  readonly VIDEO_MAX_DURATION_S: number
  readonly UPLOAD_IDLE_TIMEOUT_MS: number
  readonly UPLOAD_ABSOLUTE_TIMEOUT_MS: number
  readonly MAX_CONCURRENT_UPLOADS_PER_ACCOUNT: number
  readonly HEAD_SNIFF_BYTES: number
  readonly ABANDONED_UPLOAD_MAX_AGE_MS: number
  readonly STAGING_PART_MAX_AGE_MS: number
}

export const MEDIA_STORAGE: {
  readonly MIN_FREE_BYTES: number
  readonly MAX_TOTAL_BYTES: number
  readonly UNTRUSTED_QUOTA_BYTES: number
}

export const MODERATION_NOTIFY: {
  readonly DIGEST_INTERVAL_MS: number
}

export const SESSION: {
  readonly DURATION_MS: number
  readonly IDLE_TIMEOUT_MS: number
  readonly CSRF_ROTATION_MS: number
}

export const GUEST_SESSION: {
  readonly DURATION_MS: number
  readonly IDLE_TIMEOUT_MS: number
  readonly CSRF_ROTATION_MS: number
  readonly MAX_SESSIONS_PER_ACCOUNT: number
}

export const LIMITS: {
  readonly PARTY_SIZE_MIN: number
  readonly PARTY_SIZE_MAX: number
  readonly EMAIL_MAX_LENGTH: number
  readonly NAME_MAX_LENGTH: number
  readonly NOTES_MAX_LENGTH: number
  readonly MESSAGE_MAX_LENGTH: number
  readonly RELATIONSHIP_MAX_LENGTH: number
  readonly ACCOUNT_NAME_MAX_LENGTH: number
  readonly GUESTBOOK_MESSAGE_MAX_LENGTH: number
  readonly COMMENT_MAX_LENGTH: number
}

export const WEDDING: {
  readonly COUPLE_NAMES: string
  readonly COUPLE_FIRST_NAMES: string
  readonly DATE: string
  readonly DATE_SHORT: string
  readonly LOCATION: string
  readonly VENUE: string
}

export const EMAIL_SUBJECTS: {
  readonly INVITE: string
  readonly REMINDER: string
}

export const RATE_LIMITS: {
  readonly RSVP: { readonly windowMs: number; readonly max: number }
  readonly LOOKUP: { readonly windowMs: number; readonly max: number }
  readonly ADMIN_LOGIN: { readonly windowMs: number; readonly max: number }
  readonly ADMIN_INVITE: { readonly windowMs: number; readonly max: number }
  readonly ACCOUNT_REGISTER: { readonly windowMs: number; readonly max: number }
  readonly ACCOUNT_RECOVER: { readonly windowMs: number; readonly max: number }
  readonly GUESTBOOK_POST: { readonly windowMs: number; readonly max: number }
  readonly CONTENT_DELETE: { readonly windowMs: number; readonly max: number }
  readonly MEDIA_CREATE: { readonly windowMs: number; readonly max: number }
  readonly PUBLIC_READ: { readonly windowMs: number; readonly max: number }
  readonly COMMENT_POST: { readonly windowMs: number; readonly max: number }
  readonly REACTION_TOGGLE: { readonly windowMs: number; readonly max: number }
}

export const REQUEST_LIMITS: {
  readonly MAX_BODY_SIZE: number
  readonly REQUEST_TIMEOUT_MS: number
}

export const PAGINATION: {
  readonly DEFAULT_PAGE_SIZE: number
  readonly MAX_PAGE_SIZE: number
}

export const BRAND: {
  readonly PRIMARY_COLOR: string
  readonly SECONDARY_COLOR: string
  readonly BACKGROUND_COLOR: string
}

export const FEATURES: {
  readonly ENABLE_NAME_LOOKUP: boolean
  readonly ENABLE_EMAIL_LOOKUP: boolean
}

export const GUEST_STATUS_VALUES: readonly ["pending", "invited", "responded"]
export const PETITION_STATUS_VALUES: readonly ["pending", "approved", "denied"]
export const COMMUNICATION_TYPE_VALUES: readonly ["email", "sms"]
export const CONTENT_STATUS_VALUES: readonly ["pending", "approved", "hidden", "rejected"]
export const MEDIA_STATUS_VALUES: readonly ["uploading", "pending", "approved", "hidden", "rejected"]
export const MEDIA_KIND_VALUES: readonly ["image", "video"]
export const MEDIA_SECTION_VALUES: readonly ["official", "guest"]
export const TARGET_TYPE_VALUES: readonly ["guestbook", "media"]
export const REACTION_EMOJI_VALUES: readonly [
  "heart",
  "clap",
  "laugh",
  "heart_eyes",
  "cheers",
  "fire",
]

export type GuestStatus = "pending" | "invited" | "responded"
export type PetitionStatus = "pending" | "approved" | "denied"
export type CommunicationType = "email" | "sms"
export type CommunicationStatus = "sent" | "failed"
export type ContentStatus = "pending" | "approved" | "hidden" | "rejected"
export type MediaStatus = "uploading" | "pending" | "approved" | "hidden" | "rejected"
export type MediaKind = "image" | "video"
export type MediaSection = "official" | "guest"
export type TargetType = "guestbook" | "media"
export type ReactionEmoji =
  | "heart"
  | "clap"
  | "laugh"
  | "heart_eyes"
  | "cheers"
  | "fire"

export function isGuestStatus(value: unknown): value is GuestStatus
export function isPetitionStatus(value: unknown): value is PetitionStatus
export function isCommunicationType(value: unknown): value is CommunicationType
export function isContentStatus(value: unknown): value is ContentStatus
export function isMediaStatus(value: unknown): value is MediaStatus
export function isMediaKind(value: unknown): value is MediaKind
export function isMediaSection(value: unknown): value is MediaSection
export function isTargetType(value: unknown): value is TargetType
export function isReactionEmoji(value: unknown): value is ReactionEmoji

export interface Guest {
  id: number
  name: string
  email: string | null
  phone: string | null
  party_size: number
  invite_code: string
  status: GuestStatus
  notes: string | null
  created_at: string
  updated_at: string
  last_invited_at: string | null
  deleted_at: string | null
}

export interface GuestWithInviteCount extends Guest {
  invite_count: number
}

export interface RSVP {
  id: number
  guest_id: number
  attending: 0 | 1
  actual_party_size: number | null
  dietary_restrictions: string | null
  message: string | null
  submitted_at: string
  updated_at: string
}

export interface RSVPWithGuest extends RSVP {
  name: string
  email: string | null
  phone: string | null
  max_party_size: number
  guest_deleted_at: string | null
}

export interface Session {
  token: string
  csrf_token: string
  created_at: string
  expires_at: string
  last_activity_at: string | null
  csrf_rotated_at: string | null
}

export interface Account {
  id: number
  guest_id: number | null
  name: string
  name_normalized: string
  relation: string | null
  contact_email: string | null
  trusted: 0 | 1
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** account_sessions row joined with its account (name/trusted/guest_id). */
export interface AccountSession {
  token: string
  account_id: number
  csrf_token: string
  created_at: string
  expires_at: string
  last_activity_at: string | null
  csrf_rotated_at: string | null
  name: string
  trusted: 0 | 1
  guest_id: number | null
}

export interface Petition {
  id: number
  name: string
  email: string
  phone: string | null
  relationship: string | null
  message: string | null
  status: PetitionStatus
  admin_notes: string | null
  created_at: string
  reviewed_at: string | null
}

export interface GuestbookEntry {
  id: number
  account_id: number
  message: string
  status: ContentStatus
  created_at: string
  updated_at: string
  reviewed_at: string | null
  deleted_at: string | null
}

/**
 * A media row. `file_key` (32 lowercase hex) drives storage paths and public
 * URLs; filesystem paths are always derived server-side from file_key + variant
 * + original_ext (never stored absolute). account_id is NULL for admin/official
 * uploads. See docs/post-wedding/03-media-pipeline.md §1.
 */
export interface Media {
  id: number
  file_key: string
  account_id: number | null
  kind: MediaKind
  section: MediaSection
  status: MediaStatus
  caption: string | null
  original_ext: string | null
  original_bytes: number | null
  display_bytes: number | null
  thumb_bytes: number | null
  poster_bytes: number | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  needs_display: 0 | 1
  sort_order: number
  created_at: string
  updated_at: string
  reviewed_at: string | null
  deleted_at: string | null
}

/**
 * A guestbook_entries row joined with its author account, as returned by the
 * feed and admin-queue queries. `author_trusted` / `is_own` arrive as 0|1 from
 * SQLite; the API layer maps them to booleans before responding.
 */
export interface GuestbookFeedRow {
  id: number
  account_id: number
  message: string
  status: ContentStatus
  created_at: string
  author_name: string
  author_trusted: 0 | 1
  is_own: 0 | 1
}

/** Public /api/guestbook response entry (booleans, no account_id leaked).
 *  `reactions`/`comment_count` are attached by Phase 5 feed enrichment. */
export interface GuestbookFeedEntry {
  id: number
  message: string
  author_name: string
  author_trusted: boolean
  status: ContentStatus
  created_at: string
  is_own: boolean
  reactions?: ReactionSummary
  comment_count?: number
}

/**
 * A media row joined with its author account, as returned by getMediaFeed.
 * The join is a LEFT JOIN — admin/official uploads have account_id NULL, so
 * `author_name` is nullable here (the API coalesces it to the couple's name).
 * `is_own` arrives as 0|1 from SQLite; the API maps it to a boolean.
 */
export interface MediaFeedRow {
  id: number
  file_key: string
  account_id: number | null
  kind: MediaKind
  section: MediaSection
  status: MediaStatus
  caption: string | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  needs_display: 0 | 1
  author_name: string | null
  is_own: 0 | 1
  created_at: string
}

/**
 * Public gallery item (booleans, no account_id leaked; author_name resolved).
 * URLs are built client-side as `/media/{file_key}/{variant}`.
 */
export interface MediaListItem {
  id: number
  file_key: string
  kind: MediaKind
  section: MediaSection
  status: MediaStatus
  caption: string | null
  width: number | null
  height: number | null
  duration_seconds: number | null
  needs_display: boolean
  author_name: string
  is_own: boolean
  created_at: string
  reactions?: ReactionSummary
  comment_count?: number
}

/** Public GET /api/media response: a page of items + keyset cursor. */
export interface MediaListResponse {
  items: MediaListItem[]
  nextCursor: number | null
}

// --- Comments & reactions (Phase 5) — polymorphic over guestbook + media ---

export interface Comment {
  id: number
  account_id: number
  target_type: TargetType
  target_id: number
  message: string
  status: ContentStatus
  created_at: string
  updated_at: string
  reviewed_at: string | null
  deleted_at: string | null
}

export interface Reaction {
  id: number
  account_id: number
  target_type: TargetType
  target_id: number
  emoji: ReactionEmoji
  created_at: string
}

/** A comments row joined with its author, as returned by getCommentsForTarget.
 *  `is_own` arrives as 0|1 from SQLite; the API maps it to a boolean. */
export interface CommentFeedRow {
  id: number
  account_id: number
  message: string
  status: ContentStatus
  created_at: string
  author_name: string
  is_own: 0 | 1
}

/** Public comment shape (booleans, no account_id leaked). */
export interface CommentListItem {
  id: number
  message: string
  author_name: string
  status: ContentStatus
  created_at: string
  is_own: boolean
}

/** A pending comment row for the moderation queue (includes its target). */
export interface CommentModerationRow {
  id: number
  account_id: number
  target_type: TargetType
  target_id: number
  message: string
  status: ContentStatus
  created_at: string
  author_name: string
  author_trusted: 0 | 1
  is_own: 0 | 1
}

/** One emoji's state on a target: total count + whether the caller reacted. */
export interface ReactionState {
  count: number
  mine: boolean
}

/** Per-target reaction summary keyed by emoji (only emojis with ≥1 reaction). */
export type ReactionSummary = { [emoji: string]: ReactionState }

/** Response of POST /api/reactions/toggle. `counts` are bare per-emoji totals
 *  (server speaks keys); the client reconciles `mine` from `active` locally. */
export interface ReactionToggleResponse {
  active: boolean
  counts: { [emoji: string]: number }
}

/** Pending counts per moderatable content type for the digest + dashboard badge. */
export interface ModerationCounts {
  guestbook: number
  media: number
  comments: number
  total: number
}

/** The three moderatable content types (Phase 6 combined queue / :type allowlist). */
export type ModerationContentType = "guestbook" | "media" | "comment"

/**
 * One row from the combined moderation queue (Phase 6). Every column is present
 * for every type; type-specific columns are NULL where they don't apply (message
 * for media; file_key/kind/caption/needs_display for text). `author_name` /
 * `author_trusted` are nullable because media LEFT JOINs accounts (official
 * uploads have account_id NULL). SQLite 0|1 flags; the API maps to booleans.
 */
export interface ModerationQueueRow {
  content_type: ModerationContentType
  id: number
  account_id: number | null
  author_name: string | null
  relation: string | null
  author_trusted: 0 | 1 | null
  status: ContentStatus | MediaStatus
  created_at: string
  message: string | null
  target_type: TargetType | null
  target_id: number | null
  file_key: string | null
  kind: MediaKind | null
  caption: string | null
  needs_display: 0 | 1 | null
}

/**
 * An account with per-account content counts + household source, for the admin
 * Accounts view (Phase 6). `guest_name` is the joined household guest name (null
 * for open registration). `post_count` sums live content across all three tables.
 */
export interface AccountSummary {
  id: number
  name: string
  relation: string | null
  trusted: 0 | 1
  guest_id: number | null
  contact_email: string | null
  created_at: string
  guest_name: string | null
  post_count: number
}

export interface BlocklistEntry {
  id: number
  name: string | null
  email: string | null
  phone: string | null
  reason: string | null
  created_at: string
}

export interface Communication {
  id: number
  guest_id: number
  type: CommunicationType
  status: CommunicationStatus
  message_preview: string | null
  error_message: string | null
  sent_at: string
}

export interface Stats {
  total_guests: number
  pending: number
  invited: number
  responded: number
  attending_yes: number
  attending_no: number
  total_headcount: number
  deleted_guests: number
}

export interface CreateGuestInput {
  name: string
  email?: string | null
  phone?: string | null
  party_size?: number
  notes?: string | null
}

export interface UpdateGuestInput {
  name?: string
  email?: string | null
  phone?: string | null
  party_size?: number
  notes?: string | null
  status?: GuestStatus
}

export const SERVER: {
  readonly projectRoot: string
  readonly port: string | number
  readonly adminPasswordHash: string | undefined
  readonly baseUrl: string
  readonly contactEmail: string
  readonly trustedProxies: string[]
  readonly cspNonce: boolean
}

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string }

/** Timeline mode — pre- or post-wedding (content.js getTimelineMode). */
export type TimelineMode = "pre" | "post"

export interface SiteContentNavLink {
  readonly href: string
  readonly label: string
}

export interface SiteContentCopyVariant {
  readonly welcomeHeading: string
  readonly welcomeIntro: string
}

/** Single source of truth for wedding copy (content.js CONTENT). */
export interface SiteContent {
  readonly couple: {
    readonly display: string
    readonly first: string
    readonly monogram: string
    readonly fullNames: readonly string[]
  }
  readonly weddingDate: string
  readonly location: string
  /** Visual effect theme id (public/effects/themes.js EFFECT_THEMES). */
  readonly theme: string
  readonly registry: {
    readonly url: string
    readonly label: string
  }
  readonly contactEmail: string | null
  readonly nav: {
    readonly pre: readonly SiteContentNavLink[]
    readonly post: readonly SiteContentNavLink[]
  }
  readonly footer: {
    readonly githubUrl: string | null
  }
  readonly copy: {
    readonly pre: SiteContentCopyVariant
    readonly post: SiteContentCopyVariant
  }
}

export function formatWeddingDate(iso?: string): string
export function formatWeddingDateShort(iso?: string): string

// core/site-content.js — runtime-editable content resolver
export function deepMergeContent(
  base: SiteContent,
  override: SiteContentOverride,
): SiteContent
export function resolveSiteContent(): SiteContent
/** Sparse diff of a full validated content object against the shipped defaults —
 *  only fields that differ are kept, so unchanged fields still track future
 *  `content.js` default edits. Arrays are compared/stored wholesale. */
export function diffFromDefaults(full: SiteContent, base?: SiteContent): SiteContentOverride
export function getContent(): SiteContent
export function getMode(now?: number): TimelineMode
export function getTimelineMode(now?: number, weddingDate?: string): TimelineMode

/** Deep-partial of SiteContent — the shape stored as a runtime override in
 *  app_state (`site_content`) and merged over CONTENT defaults. */
export type SiteContentOverride = {
  couple?: Partial<{
    display: string
    first: string
    monogram: string
    fullNames: string[]
  }>
  weddingDate?: string
  location?: string
  theme?: string
  registry?: Partial<{ url: string; label: string }>
  contactEmail?: string | null
  nav?: Partial<{
    pre: SiteContentNavLink[]
    post: SiteContentNavLink[]
  }>
  footer?: Partial<{ githubUrl: string | null }>
  copy?: Partial<{
    pre: Partial<SiteContentCopyVariant>
    post: Partial<SiteContentCopyVariant>
  }>
}

export function handleFatalError(reason: unknown): void
export function handleGracefulShutdown(signal: string): void
export function setupShutdownHandlers(): void

export function HashPassword(password: string): string
export function ValidatePasswordStrength(password: string): string | null
export function Prompt(question: string, hidden?: boolean): Promise<string>
export function OnData(char: string): void
export function Main(): Promise<void>
