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

export const THANK_YOU_CARD_STATUS: {
  readonly DRAFT: "draft"
  readonly SENT: "sent"
  readonly VIEWED: "viewed"
}

export const THANK_YOU_SENT_VIA: {
  readonly EMAIL: "email"
  readonly SMS: "sms"
  readonly MANUAL: "manual"
  readonly LINK: "link"
}

export const THANK_YOU_THEME_VALUES: readonly [
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
]

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
  readonly CONTENT: "content"
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
  readonly W400_MAX: number
  readonly W800_MAX: number
  readonly W1600_MAX: number
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
  readonly QUARANTINE_TTL_MS: number
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
  readonly ADDITIONAL_INFO_MAX_LENGTH: number
  readonly RELATIONSHIP_MAX_LENGTH: number
  readonly ACCOUNT_NAME_MAX_LENGTH: number
  readonly GUESTBOOK_MESSAGE_MAX_LENGTH: number
  readonly COMMENT_MAX_LENGTH: number
  readonly THANK_YOU_MESSAGE_MAX_LENGTH: number
  readonly THANK_YOU_REPLY_MAX_LENGTH: number
  readonly THANK_YOU_MEDIA_MAX_KEYS: number
  readonly THANK_YOU_EFFECTS_CONFIG_MAX_BYTES: number
  readonly GIFT_AMOUNT_MAX_LENGTH: number
}

export const RATE_LIMITS: {
  readonly RSVP: { readonly windowMs: number; readonly max: number }
  readonly LOOKUP: { readonly windowMs: number; readonly max: number }
  readonly PETITION: { readonly windowMs: number; readonly max: number }
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
  readonly SETUP: { readonly windowMs: number; readonly max: number }
  readonly THANK_YOU: { readonly windowMs: number; readonly max: number }
  readonly THANK_YOU_REPLY: { readonly windowMs: number; readonly max: number }
  readonly ADMIN_THANK_YOU: { readonly windowMs: number; readonly max: number }
}

export const REQUEST_LIMITS: {
  readonly MAX_BODY_SIZE: number
  readonly REQUEST_TIMEOUT_MS: number
}

export const PAGINATION: {
  readonly DEFAULT_PAGE_SIZE: number
  readonly MAX_PAGE_SIZE: number
}

export const MODERATION: {
  readonly APPROVE_ALL_MAX: number
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
export const MEDIA_SECTION_VALUES: readonly ["official", "guest", "content"]
export const TARGET_TYPE_VALUES: readonly ["guestbook", "media"]
export const REACTION_EMOJI_VALUES: readonly [
  "heart",
  "clap",
  "laugh",
  "heart_eyes",
  "cheers",
  "fire",
]
export const THANK_YOU_CARD_STATUS_VALUES: readonly ["draft", "sent", "viewed"]
export const THANK_YOU_SENT_VIA_VALUES: readonly ["email", "sms", "manual", "link"]
/** Every op the assignment ledger accepts. A frozen array rather than the
 *  NAME: "value" object the older enums use, because these values have no
 *  useful constant names — `FACE_ASSIGNMENT_OPS.NOT_A_FACE` would say nothing
 *  `"not_a_face"` does not. The schema trigger is the enforcement; this is for
 *  validating input that arrives as an unknown string. */
export const FACE_ASSIGNMENT_OPS: readonly [
  "assign",
  "clear",
  "not_a_face",
  "negative",
]

export type GuestStatus = "pending" | "invited" | "responded"
export type PetitionStatus = "pending" | "approved" | "denied"
export type CommunicationType = "email" | "sms"
export type CommunicationStatus = "sent" | "failed"
export type ContentStatus = "pending" | "approved" | "hidden" | "rejected"
export type MediaStatus = "uploading" | "pending" | "approved" | "hidden" | "rejected"
export type MediaKind = "image" | "video"
export type MediaSection = "official" | "guest" | "content"
export type TargetType = "guestbook" | "media"
export type ReactionEmoji =
  | "heart"
  | "clap"
  | "laugh"
  | "heart_eyes"
  | "cheers"
  | "fire"
export type ThankYouCardStatus = "draft" | "sent" | "viewed"
export type ThankYouSentVia = "email" | "sms" | "manual" | "link"
export type ThankYouTheme =
  | "mermaid-disco"
  | "romantic"
  | "elegant"
  | "classic"
  | "celestial"
  | "garden"
  | "winter"
  | "coastal"
  | "celebration"
  | "gratitude"

export function isGuestStatus(value: unknown): value is GuestStatus
export function isPetitionStatus(value: unknown): value is PetitionStatus
export function isCommunicationType(value: unknown): value is CommunicationType
export function isContentStatus(value: unknown): value is ContentStatus
export function isMediaStatus(value: unknown): value is MediaStatus
export function isMediaKind(value: unknown): value is MediaKind
export function isMediaSection(value: unknown): value is MediaSection
export function isTargetType(value: unknown): value is TargetType
export function isReactionEmoji(value: unknown): value is ReactionEmoji
export function isThankYouCardStatus(value: unknown): value is ThankYouCardStatus
export function isThankYouSentVia(value: unknown): value is ThankYouSentVia
export function isFaceAssignmentOp(value: unknown): value is FaceAssignmentOp

/** One rung of the content-image responsive width ladder. */
export interface ContentLadderVariant {
  readonly name: string
  readonly maxEdge: number
}
export const CONTENT_IMAGE_LADDER: readonly ContentLadderVariant[]
export const CONTENT_LADDER_VARIANT_NAMES: readonly string[]

/** The variant files a finalized row is expected to carry. */
export function expectedVariants(
  kind: MediaKind,
  section: MediaSection,
  needsDisplay: boolean,
): string[]

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
  additional_info: string | null
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
  /** Content-hash of the original bytes (bulk importer's manifest key) — the
   *  durable identifier a batch face-pipeline run reconciles against when it
   *  doesn't yet know a row's media_id. Null until the importer writes it. */
  source_sha256: string | null
  /** EXIF capture time, when the source image carried one. Null until the
   *  importer wiring lands (core/image-meta.js already reads it). */
  captured_at: string | null
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

/** Contributors strip for the guest section: distinct visible author names +
 *  totals. Attached to the FIRST guest page only (cheap aggregate, not re-run
 *  per keyset page). `names` is capped; `guests` is the true distinct total. */
export interface MediaContributors {
  photos: number
  guests: number
  names: string[]
}

/** Public GET /api/media response: a page of items + keyset cursor. The
 *  `contributors` aggregate rides along on the first guest page only. */
export interface MediaListResponse {
  items: MediaListItem[]
  nextCursor: number | null
  contributors?: MediaContributors
}

// --- Comments & reactions (Phase 5) — polymorphic over guestbook + media ---

export interface Comment {
  id: number
  /** NULL for a host/couple reply (admin-authored). */
  account_id: number | null
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
 *  `is_own`/`is_host` arrive as 0|1 from SQLite; the API maps them to booleans.
 *  `author_name` is NULL for host/couple replies (account_id NULL) — the API
 *  resolves it to the couple's display name. */
export interface CommentFeedRow {
  id: number
  account_id: number | null
  message: string
  status: ContentStatus
  created_at: string
  author_name: string | null
  is_own: 0 | 1
  is_host: 0 | 1
}

/** Public comment shape (booleans, no account_id leaked). `is_host` marks a
 *  couple/host reply (rendered with the host badge + accent). */
export interface CommentListItem {
  id: number
  message: string
  author_name: string
  status: ContentStatus
  created_at: string
  is_own: boolean
  is_host: boolean
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
  /** Comment rows only: a short snippet of the parent being commented on
   *  (the guestbook message or the media caption). NULL for guestbook/media rows
   *  and for a media parent with no caption. */
  parent_snippet: string | null
  /** Comment rows only: the parent author's display name (NULL for an official
   *  media parent with no account, or for non-comment rows). */
  parent_author: string | null
  /** Comment rows only: the parent media's file_key when the comment targets
   *  media (drives the thumbnail); NULL otherwise. */
  parent_file_key: string | null
  /** Comment rows only: the parent media's kind, to pick the right thumbnail
   *  variant (image → thumb, video → poster). NULL otherwise. */
  parent_kind: MediaKind | null
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

// --- Face pipeline (design: docs/post-wedding/SPEC-vision-lab.md §10) ---

/** Where a media_faces row's box/landmarks came from. The CLI pass is
 *  authoritative over upload-time detection (schema.js's precedence
 *  triggers enforce this at the DB layer). */
export type FaceSource = "cli" | "upload"

/** Whether a face_identities row was set by a human or auto-propagated from
 *  one. Propagated identities are second-class: never a recognition
 *  prototype seed, never treated as ground truth. */
export type FaceIdentityProvenance = "confirmed" | "propagated"

/**
 * One detected face (docs/post-wedding/SPEC-vision-lab.md §10). bbox/landmarks
 * are pixel coordinates in the source image; the nine `signal_*` columns are
 * exactly gateSignals()'s output shape (public/vision/gate.js), stored
 * unthresholded so cutoffs can be re-swept without re-running detection.
 * `descriptor` is nullable — detection-only rows (no recognition run, or
 * nothing recognisable) are valid. `source` is trigger-enforced ('cli' wins
 * over 'upload' for the same media_id — see schema.js).
 */
export interface MediaFace {
  id: number
  media_id: number
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  /** JSON-encoded array of 10 numbers (5 x,y landmark pairs), or null. */
  landmarks: string | null
  signal_score: number | null
  signal_boxPx: number | null
  signal_borderPx: number | null
  signal_eyeRatio: number | null
  signal_eyeAngle: number | null
  signal_alignScale: number | null
  signal_residual: number | null
  signal_outsideFraction: number | null
  signal_sharpness: number | null
  // Uint8Array, not Buffer: this file is included by public/tsconfig.json,
  // which has no node types on purpose — and node:sqlite returns Uint8Array
  // for BLOB columns anyway. A Buffer here would be both a leak and a lie.
  descriptor: Uint8Array | null
  model_version: string
  source: FaceSource
  face_identity_id: number | null
  /**
   * Which ingest run produced this row (schema.js `add_vision_provenance`).
   * NULL for every row written before ingest provenance existed, and for
   * upload-time detections, which have no run behind them. `model_version`
   * above names only the DESCRIPTOR SPACE; this names the detector, the engine
   * build, the thresholds and the route profile that drew the box.
   */
  ingest_id: number | null
  /**
   * Quality routing (schema.js `add_face_routing`). **NULL means NOT YET
   * GRADED** — a row written before routing existed, or by a path that did not
   * grade it — and it is a fourth case every consumer handles rather than
   * folds into a state. Never "rejected": a `set_aside` face is still stored,
   * still grouped and still nameable through the single-face escape hatch.
   */
  route_state: RouteState | null
  /** Which check decided. Null for `accept` and for ungraded rows. */
  route_reason: string | null
  /** Which cutoff table produced the grade (public/vision/route.js PROFILE).
   *  Without it a revised cutoff silently re-means every stored grade. */
  route_profile: string | null
  created_at: string
  updated_at: string
  /**
   * ⚠ THREE authors, not one (schema.js `add_face_ledger_integrity`):
   * db/face-assignments.js's `not_a_face` projection, the §10 precedence
   * triggers in `add_media_faces`, and `retireCliFaces` in
   * scripts/vision/ingest-faces.js. Anything that wants to UN-set it has to
   * establish which one wrote the value it is looking at.
   */
  deleted_at: string | null
  /**
   * The ledger's receipt for a retirement IT wrote: `projectFace` puts the same
   * timestamp in both columns, and may clear `deleted_at` only while the two
   * still match. NULL means the ledger holds no claim — every live row, every
   * row somebody else retired, and every row a later CLI generation has
   * superseded since (`media_faces_supersession_releases_ledger_claim`).
   *
   * Written by db/face-assignments.js and that trigger, and by nothing else.
   */
  ledger_retired_at: string | null
}

/** What the Faces tab does with a face. Mirrors public/vision/types.d.ts's
 *  RouteState — duplicated rather than imported because that file is the pure
 *  pipeline's and this one is the entity layer's, and neither may depend on
 *  the other. The trigger in schema.js `add_face_routing` is the enforcement. */
export type RouteState = "accept" | "ask" | "set_aside"

/**
 * A person in the photographed cast (schema.js `add_people` migration). NOT an
 * invitation: `guests` rows are one-per-party with an invite code, and many
 * people in the photographs are not on that roster at all. `guest_id` is the
 * optional link back to a roster row (NULL = off-roster: a partner recorded
 * under someone else's row, a child, the photographer, a vendor).
 */
export interface Person {
  id: number
  display_name: string
  guest_id: number | null
  /** Admin session that created the row — derived server-side, never client-supplied. */
  created_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/**
 * A confirmed (or auto-propagated) link from a face-recognition group to a
 * person. `person_id` is NOT NULL by design: an identity row IS the confirmed
 * link, not a placeholder that can exist before one (see schema.js comment for
 * the full reasoning). At most one LIVE identity per (person, provenance) —
 * enforced by a partial unique index, because code takes the first match.
 */
export interface FaceIdentity {
  id: number
  person_id: number
  confirmed_by: string | null
  confirmed_at: string | null
  provenance: FaceIdentityProvenance
  /**
   * The merge redirect (schema.js `add_vision_provenance`). NULL = a live
   * identity. Non-null = this identity was folded into another one and every
   * reader resolves through it (db/face-assignments.js `resolveIdentity`).
   *
   * A merge is a fact about IDENTITIES, not about faces — which is why it is
   * this one column rather than a per-face event. Assignment events keep
   * naming the identity they actually named, and stay true forever.
   */
  merged_into: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/**
 * One ingest run (schema.js `add_vision_provenance`) — the answer to "what
 * produced this face row". `media_faces.model_version` names the descriptor
 * space only; nothing recorded which detector, engine build, thresholds or
 * route profile drew the box, so a row from a superseded run was
 * indistinguishable from a current one.
 *
 * Immutable: a trigger blocks UPDATE. Re-running the pipeline writes a NEW
 * row, because editing this one would silently re-mean every face pointing at
 * it. DELETE is deliberately left open.
 */
export interface VisionIngest {
  id: number
  dataset_id: string
  /** Descriptor space only — embedder, output width, normalisation, mirror.
   *  Never the detector; detection provenance is what this whole row is. */
  model_version: string
  detector_sha256: string
  embedder_sha256: string
  engine_sha256: string
  /** 0 | 1 (trigger-enforced). SQLite has no boolean. */
  mirror_applied: number
  normalisation: string
  /** Which cutoff table the run graded under (public/vision/route.js PROFILE). */
  route_profile: string
  /** JSON-encoded ALLOWLISTED object — see VisionIngestConfig. */
  config_json: string
  created_at: string
}

/**
 * A JSON value as it may appear inside `VisionIngest.config_json`. Spelled out
 * rather than reached for as `any`, so a value that cannot survive a
 * JSON round-trip (undefined, a function, a Date) is a compile error at the
 * call site instead of a silently dropped key on disk.
 */
export type VisionIngestConfigValue =
  | string
  | number
  | boolean
  | null
  | readonly VisionIngestConfigValue[]
  | { readonly [key: string]: VisionIngestConfigValue }

/**
 * What goes in `config_json`: an ALLOWLIST, never a dump of a run's state.
 *
 * **Include:** engine version, onnxruntime version, detector/embedder/engine
 * sha256, detector and embedder channel order, detection resolution,
 * thresholds, top-K stage, normalisation mode, mirror setting, schema version.
 *
 * **Exclude, without exception:** filesystem paths, `$PHOTOS`, argv,
 * environment variables, person names, labels, and any count or distribution
 * measured from the photographs. This object travels to production, and this
 * repository is public — the same rule the vision reports already carry.
 *
 * The shape is open because the run's own config is the thing being recorded;
 * what is closed is the list above, and that is enforced by the caller
 * assembling this object field by field rather than spreading its config into
 * it.
 */
export interface VisionIngestConfig {
  readonly [key: string]: VisionIngestConfigValue
}

/**
 * What one assignment event does (schema.js `add_vision_provenance`).
 *
 *  - `assign` — this face is that identity. `identity_id` NOT NULL.
 *  - `clear` — this face is nobody (yet). `identity_id` NULL.
 *  - `not_a_face` — the box is not a face at all. `identity_id` NULL.
 *  - `negative` — this face is *not* that identity. `identity_id` NOT NULL.
 *
 * `negative` is a CONSTRAINT, not a state: replay skips it entirely, and it
 * feeds suggestion ranking instead (db/face-assignments.js `negativesForFace`).
 *
 * There is deliberately no `merge` op — a merge is a fact about identities,
 * recorded once on `face_identities.merged_into`.
 */
export type FaceAssignmentOp = "assign" | "clear" | "not_a_face" | "negative"

/** Why a batch of assignment events exists. The four the Phase 5 contract
 *  names; nothing at the database layer enforces this, so it is a compile-time
 *  agreement between the writers rather than a stored constraint. */
export type FaceAssignmentBatchKind =
  | "label-import"
  | "propagate"
  | "manual"
  | "merge-repair"

/**
 * A revocable batch of assignment events (schema.js `add_vision_provenance`).
 *
 * NOT append-only, unlike the events themselves: revocation is the one
 * legitimate update, and it is a FLAG rather than a compensating event
 * precisely so it stays reversible and so a later manual correction outranks
 * the bulk pass it corrected instead of disappearing with it.
 */
export interface FaceAssignmentBatch {
  batch_id: string
  kind: FaceAssignmentBatchKind
  /** core/utils.js `actorId()` — derived server-side, never client-supplied. */
  actor: string
  note: string | null
  created_at: string
  revoked_at: string | null
  revoked_by: string | null
}

/**
 * One event in the append-only ledger behind `media_faces.face_identity_id`
 * (schema.js `add_vision_provenance`).
 *
 * The column alone is a value with no history — a bulk propagate pass and a
 * human's deliberate correction look identical in it. Here they do not, so
 * revoking the pass is a filter over history rather than a destructive edit.
 *
 * **Ordering is by `id`, never by `created_at`**: the timestamp has one-second
 * resolution and a batch writes many events inside it, so "latest wins" by
 * time would be a coin toss. UPDATE is trigger-blocked; DELETE is not, because
 * hard-deleting a photo must be able to cascade through `media_faces` to here.
 */
export interface FaceAssignment {
  id: number
  face_id: number
  op: FaceAssignmentOp
  /** NOT NULL for `assign`/`negative`, NULL for `clear`/`not_a_face` —
   *  trigger-enforced on INSERT. */
  identity_id: number | null
  actor: string
  /** NULL for a one-off event that belongs to no batch, and therefore cannot
   *  be revoked in bulk. */
  batch_id: string | null
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

// --- Digital thank-you cards (Phase 1) ---

/** A gift-log row (the giver's guest_id, what they gave, admin-only amount). */
export interface Gift {
  id: number
  guest_id: number
  description: string | null
  /** Free-form, admin-only, NEVER surfaced on the card or any public endpoint. */
  amount: string | null
  notes: string | null
  received_at: string | null
  physical_card_sent: 0 | 1
  physical_card_sent_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Admin gift-log row: joined giver name + the most recent linked card's status
 *  (a gift may be re-composed, so this is the latest attempt, not a history). */
export interface GiftWithGuest extends Gift {
  guest_name: string
  digital_card_status: ThankYouCardStatus | null
}

/** A digital thank-you card. `token` is the magic-link auth (8-char, unique).
 *  `effects_config`/`media_keys` are opaque JSON text columns (parsed by the
 *  API layer, never by the DB layer). `reply_*` are simple columns rather than
 *  the polymorphic `reactions` table — recipients authenticate by token and
 *  may have no account. `reply_seen_at` tracks admin having seen the reply
 *  (unread badge/digest gate), independent of the guest-facing `viewed_at`. */
export interface ThankYouCard {
  id: number
  token: string
  /** Read-only public share credential (8-char alnum, unique). Resolves the card
   *  for a non-reply viewer; never echoed to a share-token access path. */
  share_token: string
  guest_id: number
  gift_id: number | null
  message: string
  theme: string
  effects_config: string | null
  media_keys: string | null
  status: ThankYouCardStatus
  sent_via: ThankYouSentVia | null
  sent_at: string | null
  viewed_at: string | null
  /** Total number of envelope-open beacon hits (every open, not just the first). */
  view_count: number
  /** Timestamp of the most recent envelope open (beacon), independent of viewed_at. */
  last_viewed_at: string | null
  /** Any single emoji, as its glyph (public/components/emoji.js). */
  reply_emoji: string | null
  reply_message: string | null
  replied_at: string | null
  reply_seen_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** One append-only entry in a card's reply history (thank_you_card_replies).
 *  The card row keeps the latest reply in its reply_* columns for badge/digest
 *  compatibility; this is the full thread, oldest-first when listed. */
export interface ThankYouCardReply {
  id: number
  card_id: number
  /** Any single emoji, as its glyph (public/components/emoji.js). */
  emoji: string | null
  message: string | null
  created_at: string
}

/** Admin list/detail row: joined recipient guest name. */
export interface ThankYouCardWithGuest extends ThankYouCard {
  guest_name: string
}

/** Public token-auth surface row: joined recipient name, never the gift amount. */
export interface PublicThankYouCard extends ThankYouCard {
  recipient_name: string
}

/** Minimal shape for the signed-in guest "card waiting" banner surfacing.
 *  Amount-free by construction — the banner only needs open/reply state and
 *  enough theme/media hints to compose its copy. */
export interface ThankYouCardForGuest {
  token: string
  sent_at: string | null
  viewed_at: string | null
  theme: string
  /** True when the card has at least one media key (drives "with N photos" copy). */
  has_photos: boolean
  /** True when the recipient has replied at least once. */
  replied: boolean
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

/** One entry in the landing-page Schedule. Optional lines are `null` (not
 *  omitted) so a validated override is always a complete object. */
export interface SiteContentScheduleItem {
  readonly time: string
  readonly title: string
  readonly officiant: string | null
  readonly venue: string | null
  readonly address: string | null
  readonly details: readonly string[]
  readonly note: string | null
}

/** Origin-agnostic image descriptor. Defaults point at static `/images/*`
 *  assets (with hand-authored srcset); an admin upload produces a descriptor
 *  whose src/srcset point at `/media/{file_key}/{variant}`. The renderer emits
 *  these verbatim and never branches on origin. */
export interface SiteContentImage {
  readonly src: string
  readonly srcset: string | null
  readonly sizes: string | null
  readonly alt: string
  readonly caption: string | null
  /** Intrinsic dimensions for CLS-free layout; null when unknown. */
  readonly width: number | null
  readonly height: number | null
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
  readonly schedule: {
    readonly title: string
    readonly items: readonly SiteContentScheduleItem[]
  }
  readonly dressCode: {
    readonly title: string
    readonly body: string
    readonly images: readonly SiteContentImage[]
  }
  readonly registry: {
    readonly title: string
    readonly body: string
    readonly frameNote: string
    readonly url: string
    readonly label: string
    /** Keep the registry section + nav links up in post mode. */
    readonly showAfterWedding: boolean
  }
  readonly memories: {
    readonly title: string
    readonly body: string
  }
  readonly contactEmail: string | null
  readonly nav: {
    readonly pre: readonly SiteContentNavLink[]
    readonly post: readonly SiteContentNavLink[]
  }
  readonly footer: {
    readonly githubUrl: string | null
    readonly eventHeading: string
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
/** Whether the registry section and its nav links render: always before the
 *  wedding, afterwards only when the couple opted in. */
export function isRegistryShown(mode: TimelineMode, registry?: SiteContent["registry"]): boolean

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
  schedule?: Partial<{ title: string; items: SiteContentScheduleItem[] }>
  dressCode?: Partial<{ title: string; body: string; images: SiteContentImage[] }>
  registry?: Partial<{
    title: string
    body: string
    frameNote: string
    url: string
    label: string
    showAfterWedding: boolean
  }>
  memories?: Partial<{ title: string; body: string }>
  contactEmail?: string | null
  nav?: Partial<{
    pre: SiteContentNavLink[]
    post: SiteContentNavLink[]
  }>
  footer?: Partial<{ githubUrl: string | null; eventHeading: string }>
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
// Prompt/OnData moved to scripts/types.d.ts alongside scripts/lib/prompt.js.
