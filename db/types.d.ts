/** @file connection.js - Types for database connection management */

import type { DatabaseSync, SQLInputValue, StatementSync, StatementResultingChanges } from "node:sqlite"

/**
 * Initialize the database connection and create tables if they don't exist.
 * @example
 * const db = init();
 */
export function init(): DatabaseSync

/**
 * Get the database instance (for internal use by other db modules).
 * Throws if database not initialized.
 * @example
 * const db = getDb();
 */
export function getDb(): DatabaseSync

/**
 * Close the database connection.
 * @example
 * close();
 */
export function close(): void

/**
 * Get or create a cached prepared statement.
 * @example
 * const stmt = getStmt('SELECT * FROM guests WHERE id = ?');
 */
export function getStmt(sql: string): StatementSync

/** @file sql.js - Types for SQL tagged template literal system */

/**
 * Bind a statement executor to the SQL system.
 * Must be called during init() before any queries execute.
 * This decouples sql.js from the connection layer for portability.
 */
export type bindExecutor = (getStmtFn: (sql: string) => StatementSync) => void

/**
 * SQL fragment with text and bound parameters.
 * Call .get(), .all(), or .run() to execute.
 */
export class SqlFragment {
  text: string
  params: SQLInputValue[]
  constructor(text: string, params: SQLInputValue[])
  get<T>(): T | undefined
  all<T>(): T[]
  run(): StatementResultingChanges
}

/** Factory function type for creating SqlFragment instances */
export type createFragment = (text: string, params: SQLInputValue[]) => SqlFragment

/**
 * Tagged template for building SQL fragments.
 * Scalar values become ? parameters. SqlFragment values compose inline.
 * @example
 * sql`SELECT * FROM guests WHERE id = ${id}`.get()
 */
export type sqlFn = (
  strings: TemplateStringsArray,
  ...values: (SQLInputValue | SqlFragment)[]
) => SqlFragment

export function sql(
  strings: TemplateStringsArray,
  ...values: (SQLInputValue | SqlFragment)[]
): SqlFragment

export namespace sql {
  /** Empty fragment for conditional composition (frozen) */
  const empty: Readonly<SqlFragment>
  /** Trusted raw SQL text — no parameter escaping */
  function raw(text: string): SqlFragment
  /** Join SQL fragments with a separator string */
  function join(fragments: SqlFragment[], separator?: string): SqlFragment
  /** Build an IN (...) clause from a list of values. Throws on empty array. */
  function list(values: SQLInputValue[]): SqlFragment
  // sql.if(condition, then, otherwise?) is typed via sqlIfFn — `if` is a reserved word in TS declarations
  /** Join fragments with " AND ", filtering out empty fragments */
  function and(fragments: SqlFragment[]): SqlFragment
  /** Join fragments with " OR ", filtering out empty fragments */
  function or(fragments: SqlFragment[]): SqlFragment
  /** Build multi-row VALUES clause: (?, ?), (?, ?). Throws on empty array. */
  function values(rows: SQLInputValue[][]): SqlFragment
  /** Build SET clause from object, skipping undefined values. Throws if all undefined. */
  function set(obj: Record<string, SQLInputValue | undefined>): SqlFragment
  /** Safe double-quote escaping for column/table names (SQLite convention) */
  function identifier(name: string): SqlFragment
}

export type sqlRawFn = (text: string) => SqlFragment
export type sqlJoinFn = (fragments: SqlFragment[], separator?: string) => SqlFragment
export type sqlListFn = (values: SQLInputValue[]) => SqlFragment
export type sqlIfFn = (condition: unknown, then: SqlFragment, otherwise?: SqlFragment) => SqlFragment
export type sqlAndFn = (fragments: SqlFragment[]) => SqlFragment
export type sqlOrFn = (fragments: SqlFragment[]) => SqlFragment
export type sqlValuesFn = (rows: SQLInputValue[][]) => SqlFragment
export type sqlSetFn = (obj: Record<string, SQLInputValue | undefined>) => SqlFragment
export type sqlIdentifierFn = (name: string) => SqlFragment

/** @file schema.js - Types for database schema and migrations */

/**
 * Create all tables if they don't exist.
 * @example
 * createTables(db);
 */
export function createTables(db: DatabaseSync): void

/**
 * Run database migrations for schema changes.
 * @example
 * runMigrations(db);
 */
export function runMigrations(db: DatabaseSync): void

/** @file sessions.js - Types for session database operations */

import type { Session } from "../types.js"

/**
 * Result of createSession (returns plaintext token to client).
 * @example
 * const result: CreateSessionResult = { token: 'abc', csrf_token: 'def', expires_at: '2025-01-21T00:00:00.000Z' };
 */
export interface CreateSessionResult {
  token: string
  csrf_token: string
  expires_at: string
}

/**
 * Internal: Hash a session token using SHA-256.
 * @example
 * const hash = hashToken(token);
 */
export function hashToken(token: string): string

/**
 * Create a new admin session.
 * @example
 * const { token, csrf_token, expires_at } = createSession();
 */
export function createSession(): CreateSessionResult

/**
 * Get a session by token (validates expiration and idle timeout).
 * Returns null if session is invalid or expired.
 * @example
 * const session = getSession(token);
 */
export function getSession(token: string): Session | null

/**
 * Update session activity timestamp.
 * @example
 * updateSessionActivity(token);
 */
export function updateSessionActivity(token: string): void

/**
 * Delete a session.
 * @example
 * deleteSession(token);
 */
export function deleteSession(token: string): void

/**
 * Rotate CSRF token for a session.
 * @example
 * const newCsrfToken = rotateCsrfToken(token);
 */
export function rotateCsrfToken(token: string): string

/**
 * Delete all expired sessions from the database.
 * @example
 * cleanExpiredSessions();
 */
export function cleanExpiredSessions(): void

/** @file accounts.js - Types for guest account database operations */

import type { Account, AccountSession, AccountSummary } from "../types.js"

export interface CreateAccountInput {
  guestId: number | null
  name: string
  relation?: string | null
  contactEmail?: string | null
  trusted: 0 | 1
}

/**
 * Create a guest account (computes name_normalized, normalizes contact email).
 * @example
 * const account = createAccount({ guestId: 1, name: "Dana Smith", trusted: 1 });
 */
export function createAccount(input: CreateAccountInput): Account

/**
 * Re-login lookup: the account previously registered against this household
 * guest record with this normalized name. Excludes soft-deleted accounts.
 */
export function findAccountByGuestAndName(
  guestId: number,
  nameNormalized: string,
): Account | undefined

export function getAccountById(id: number): Account | undefined

/** Most-recent non-deleted account with this recovery contact_email, or undefined. */
export function findAccountByContactEmail(
  email: string | null | undefined,
): Account | undefined

/** Admin Accounts view: accounts + per-account content counts + household source. */
export function listAccounts(options: {
  trusted?: boolean | null
  limit: number
  offset: number
}): AccountSummary[]

/** One live account with its household's guest name (the Accounts detail and
 *  the Review author card). Counts come from getModerationStatusCounts. */
export function getAccountSummary(
  id: number,
): Omit<AccountSummary, "post_count" | "pending_count"> | undefined

/** Total non-deleted accounts (optionally filtered by trusted) for pagination. */
export function countAccounts(options: { trusted?: boolean | null }): number

/** Set an account's trusted flag. Returns true if a row changed. */
export function setAccountTrusted(id: number, trusted: boolean): boolean

/** Soft-delete an account. Returns true if a row changed. */
export function softDeleteAccount(id: number): boolean

/** @file account-sessions.js - Types for guest session database operations */

/**
 * Create a guest session (returns plaintext token to client). Does NOT clear
 * other sessions — caps at GUEST_SESSION.MAX_SESSIONS_PER_ACCOUNT per account.
 */
export function createAccountSession(accountId: number): CreateSessionResult

/**
 * Get a guest session by token, joined with its account (validates absolute
 * expiration, idle timeout, and that the account isn't soft-deleted).
 */
export function getAccountSession(token: string): AccountSession | null

export function updateAccountSessionActivity(token: string): void

export function deleteAccountSession(token: string): void

/** Delete every session for an account (admin account-delete). */
export function deleteAccountSessionsForAccount(accountId: number): void

export function rotateAccountCsrfToken(token: string): string

export function cleanExpiredAccountSessions(): void

/** @file utils.js - Types for database utility functions */

import type { CommunicationType, CommunicationStatus, Guest } from "../types.js"

/**
 * Generate a random 8-character alphanumeric invite code.
 * @example
 * const code = generateInviteCode(); // "AbCd1234"
 */
export function generateInviteCode(): string

/**
 * Get the current timestamp in ISO format.
 * @example
 * const timestamp = now(); // "2025-01-20T12:00:00.000Z"
 */
export function now(): string

/**
 * Escape special characters for LIKE queries to prevent pattern injection.
 * Use with ESCAPE '\' clause in SQL.
 * @example
 * const safe = escapeLikePattern("50%"); // "50\%"
 */
export function escapeLikePattern(
  str: string | null | undefined,
): string | null | undefined

/**
 * Extract only digit characters from a string.
 * @example
 * const digits = extractDigits("(555) 123-4567"); // "5551234567"
 */
export function extractDigits(str: string): string

/**
 * Normalize a phone number to E.164 format (+XXXXXXXXXXX).
 * Returns null for invalid phone numbers.
 * @example
 * const phone = normalizePhone("555-123-4567"); // "+15551234567"
 */
export function normalizePhone(
  phone: string | null | undefined,
): string | null

/**
 * Normalize a name for matching: lowercase, trim, collapse whitespace.
 * @example
 * const name = normalizeName("  John   Doe  "); // "john doe"
 */
export function normalizeName(name: string | null | undefined): string

/**
 * Normalize an email address: trim, lowercase, return null for empty/invalid.
 */
export function normalizeEmail(email: string | null | undefined): string | null

/**
 * Calculate Levenshtein distance between two strings.
 * Used for fuzzy name matching (handles typos).
 * @example
 * const distance = levenshteinDistance("john", "jonh"); // 1
 */
export function levenshteinDistance(
  a: string | null | undefined,
  b: string | null | undefined,
  maxDistance?: number,
): number

/**
 * Execute a function within a database transaction.
 * Uses IMMEDIATE mode to acquire write lock at start.
 * Automatically commits on success, rolls back on error.
 * @example
 * const result = withTransaction((db) => { db.exec("INSERT..."); return true; });
 */
export function withTransaction<T>(fn: (db: DatabaseSync) => T): T

/**
 * The same transaction, opened on whichever connection `sql``` is bound to
 * rather than on `db/connection.js`'s singleton — so the identical code works
 * in the server and in a vision CLI that opened its own `DatabaseSync` and
 * called `bindExecutor` without ever calling `init()`.
 *
 * Same semantics as `withTransaction` otherwise: a bare BEGIN IMMEDIATE, no
 * savepoints, DOES NOT NEST. The callback takes no `db` argument, precisely
 * because "which connection" is the question this helper exists to stop asking.
 * @example
 * const faces = withBoundTransaction(() => { ...sql`` statements...; return n })
 */
export function withBoundTransaction<T>(fn: () => T): T

/**
 * Result from COUNT(*) query.
 * @example
 * const result: CountResult = { count: 5 };
 */
export interface CountResult {
  count: number
}

/**
 * Log a communication (email or SMS) to a guest.
 * @example
 * logCommunication(1, 'email', 'sent', 'Wedding invitation...');
 */
export function logCommunication(
  guestId: number,
  type: CommunicationType,
  status: CommunicationStatus,
  messagePreview?: string | null,
  errorMessage?: string | null,
): void

/**
 * Get the count of successful invites sent to a guest.
 * @example
 * const count = getInviteCountForGuest(1);
 */
export function getInviteCountForGuest(guestId: number): number

/**
 * Guest with match distance for search results.
 * @example
 * const match: GuestWithMatchDistance = { ...guest, matchDistance: 1 };
 */
export interface GuestWithMatchDistance extends Guest {
  matchDistance: number
}

/**
 * Search for guests by name with fuzzy matching (Levenshtein distance <= 2).
 * @example
 * const guests = searchGuestsByName('Jon Doe');
 */
export function searchGuestsByName(name: string): GuestWithMatchDistance[]

/**
 * Mask an email address for privacy.
 * @example
 * const masked = maskEmail('john@example.com'); // "j***@example.com"
 */
export function maskEmail(email: string | null | undefined): string | null

/**
 * Mask a phone number for privacy.
 * @example
 * const masked = maskPhone('+15551234567'); // "***-***-4567"
 */
export function maskPhone(phone: string | null | undefined): string | null

/**
 * Get a value from the generic app_state KV table, or null if unset.
 * @example
 * const ts = getAppState("moderation_last_digest_at");
 */
export function getAppState(key: string): string | null

/**
 * Upsert a value into the app_state KV table (refreshes updated_at).
 * @example
 * setAppState("moderation_last_digest_at", new Date().toISOString());
 */
export function setAppState(key: string, value: string): void

/** @file guestbook-entries.js - Types for guestbook entry database operations */

import type {
  GuestbookEntry,
  GuestbookFeedRow,
  ContentStatus,
  ModerationCounts,
} from "../types.js"

export interface CreateGuestbookEntryInput {
  accountId: number
  message: string
  status: ContentStatus
}

export interface GuestbookFeedOptions {
  /** The signed-in caller's account id, or null for anonymous requests. */
  callerId?: number | null
  /** Keyset cursor: only rows with id < before. Null = first page. */
  before?: number | null
  limit: number
}

/** Insert an entry and return the full row. */
export function createGuestbookEntry(
  input: CreateGuestbookEntryInput,
): GuestbookEntry

export function getGuestbookEntryById(id: number): GuestbookEntry | undefined

/**
 * Minimal visibility probe (id, account_id, status, is_own) for the comment
 * parent gate. Excludes soft-deleted rows; the caller gates on status.
 */
export function getGuestbookEntryForCaller(
  id: number,
  callerId?: number | null,
): TargetVisibilityRow | undefined

/**
 * The public feed: approved entries plus the caller's own pending ones,
 * newest-first (id DESC), keyset-paginated.
 */
export function getGuestbookFeed(
  options: GuestbookFeedOptions,
): GuestbookFeedRow[]

/**
 * A single feed row by id, gated by the same visibility rules as the feed
 * (approved, or the caller's own pending). Undefined when missing/deleted or
 * not visible to this caller. Powers the ?entry= deep link.
 */
export function getGuestbookFeedEntryById(
  id: number,
  callerId?: number | null,
): GuestbookFeedRow | undefined

/** Soft-delete an entry only if it belongs to accountId. Returns true if a row changed. */
export function softDeleteGuestbookEntry(
  id: number,
  accountId: number,
): boolean

/**
 * Pin (pinned=true) or unpin an approved, live entry for the "Favorites" strip.
 * Pin sets pinned_at=now only on an approved non-pinned row; unpin clears it.
 * Returns true if a row changed.
 */
export function setGuestbookPinned(id: number, pinned: boolean): boolean

/**
 * The admin-pinned "Favorites" set: approved, live, non-deleted author, newest
 * pinned first, capped by `limit`. Same row shape as the feed.
 */
export function getPinnedGuestbook(options: {
  callerId?: number | null
  limit: number
}): GuestbookFeedRow[]

/** Admin queue: pending entries oldest-first, offset-paginated. */
export function getGuestbookModerationQueue(options: {
  limit: number
  offset: number
}): GuestbookFeedRow[]

/** Count non-deleted pending guestbook entries. */
export function countPendingGuestbook(): number

/** Count of publicly visible (approved, live-account, non-deleted) guestbook
 *  entries — the notes half of the landing "moments shared" tally. */
export function countApprovedGuestbook(): number

/**
 * Transition an entry's status if its current status is in fromStatuses (and it
 * isn't soft-deleted); stamps reviewed_at. Returns true if a row changed.
 */
export function setGuestbookStatus(
  id: number,
  fromStatuses: ContentStatus[],
  toStatus: ContentStatus,
): boolean

/**
 * Pending counts across moderatable content types. Tolerates the media/comments
 * tables not existing yet (Phases 3/5) — those count 0 until their tables ship.
 */
export function getModerationCounts(): ModerationCounts

/** ISO timestamp of the oldest pending guestbook entry, or null if none. */
export function getOldestPendingGuestbookAt(): string | null

/** @file media.js - Types for media item database operations */

import type {
  Media,
  MediaKind,
  MediaSection,
  MediaStatus,
  MediaFeedRow,
  CuratedMediaSection,
} from "../types.js"

/** Result from a SUM(...) query. */
export interface SumResult {
  total: number
}

export interface MediaFeedOptions {
  /** The signed-in caller's account id, or null for anonymous requests. */
  callerId?: number | null
  /** Which gallery section to page through. */
  section: MediaSection
  /** Keyset cursor (guest section only): rows with id < before. Null = first page. */
  before?: number | null
  /** Keyset cursor (curated sections only): rows strictly after this
   *  (sort_order, id) position. Null = first page. */
  after?: CuratedFeedPosition | null
  limit: number
}

/** A position in a curated section's (sort_order, id) order. It is the values,
 *  not a row reference, so it stays meaningful after that row is deleted or moved. */
export interface CuratedFeedPosition {
  sortOrder: number
  id: number
}

/** A feed row plus its sort_order, which a curated page's cursor is built from. */
export interface MediaFeedPageRow extends MediaFeedRow {
  sort_order: number
}

/**
 * The public gallery feed for one section. Guest: approved + the caller's own
 * pending, newest-first (id DESC), keyset-paginated on id. Curated (official,
 * honeymoon): (sort_order, id) ascending, keyset-paginated on that pair. LEFT
 * JOIN accounts, so author_name is null for admin (curated) uploads.
 */
export function getMediaFeed(options: MediaFeedOptions): MediaFeedPageRow[]

/** One "Most loved" guest media row: enough to render a curation card plus its
 *  total reaction count (A3). */
export interface GuestMediaByReactionsRow {
  id: number
  file_key: string
  kind: string
  caption: string | null
  width: number | null
  height: number | null
  needs_display: number
  created_at: string
  author_name: string | null
  reaction_count: number
}

/** Approved GUEST media ranked by total reaction count, capped at `limit`
 *  (single page — reaction count isn't a stable keyset cursor). */
export function listGuestMediaByReactions(limit: number): GuestMediaByReactionsRow[]

/**
 * Single-item feed row (LEFT JOIN accounts + is_own) for ?item= deep links.
 * Excludes soft-deleted rows; the API applies the status visibility gate.
 */
export function getMediaFeedRowById(
  id: number,
  callerId?: number | null,
): MediaFeedRow | undefined

export interface CreateMediaRowInput {
  fileKey: string
  /** NULL for admin/official uploads. */
  accountId: number | null
  kind: MediaKind
  section: MediaSection
  /** Client-declared original size; persisted so in-flight rows press the quota. */
  originalBytes: number
}

/** Insert an 'uploading' media row and return the full row. */
export function createMediaRow(input: CreateMediaRowInput): Media
export function getMediaById(id: number): Media | undefined
export function getMediaByFileKey(fileKey: string): Media | undefined

/** Set a variant's byte size (variant resolved through a fixed column map;
 *  throws on an unknown variant). */
export function setMediaVariantBytes(id: number, variant: string, bytes: number): void

/** Record the sniff-derived storage extension on the original. */
export function setMediaOriginalExt(id: number, ext: string): void

/** Record the content hash of the file this row was imported from — the join
 *  key the vision pipeline matches detection runs against. Written at import
 *  time by scripts/lib/sink-local.js; ingest-faces.js's --backfill-manifest
 *  repairs rows that predate the stamp. */
export function setMediaSourceSha256(id: number, sha256: string): void

export interface FinalizeMediaInput {
  width: number | null
  height: number | null
  durationS?: number | null
  needsDisplay: boolean
  status: MediaStatus
}

/** Apply finalize metadata + flip status (only while still 'uploading'). */
export function finalizeMedia(id: number, input: FinalizeMediaInput): Media

/**
 * Transition a media row's status if its current status is in fromStatuses (and
 * it isn't soft-deleted); stamps reviewed_at. Returns true if a row changed.
 */
export function setMediaStatus(
  id: number,
  fromStatuses: MediaStatus[],
  toStatus: MediaStatus,
): boolean

/** All non-deleted media ids in one curated section (official | honeymoon), in
 *  display order (reorder validation). */
export function getCuratedMediaIds(section: CuratedMediaSection): number[]

/** Every non-deleted row of one curated section, any status, in display order:
 *  exactly the set getCuratedMediaIds names. Admin-only; never serve this publicly. */
export function getCuratedMediaForAdmin(section: CuratedMediaSection): MediaFeedRow[]

/** Rewrite one curated section's sort_order to the given id order (array index).
 *  Caller wraps in withTransaction; only that section's non-deleted rows are touched. */
export function setMediaSortOrders(ids: number[], section: CuratedMediaSection): void

/** MOVE a curated item (official ⇄ honeymoon) into the other curated section,
 *  appended at the end of its order. Returns true if a row changed (false when
 *  the item is missing, deleted, not curated, or already in `toSection`). */
export function moveCuratedMedia(id: number, toSection: CuratedMediaSection): boolean

/** MOVE an approved guest item into the official section, appended at the end.
 *  Returns true if a row changed (false if not an approved guest item). */
export function promoteMediaToOfficial(id: number): boolean

/** Set a media item's caption. Returns true if a row changed. */
export function updateMediaCaption(id: number, caption: string | null): boolean

/** Soft-delete (owner/admin gate is enforced in the API). Returns true if changed. */
export function softDeleteMedia(id: number): boolean

/** Soft-delete a section='content' row by file_key (site-content reconciliation
 *  when a dress-code image is dropped). Scoped to 'content' so it can never
 *  touch a gallery row. Returns true if a row was soft-deleted. */
export function softDeleteContentMediaByFileKey(fileKey: string): boolean

/** Soft-delete any media row by file_key (used by the quarantine-purge sweep to
 *  drop a rejected row from the byte sums once its files are deleted). Returns
 *  true if a row was soft-deleted. */
export function softDeleteMediaByFileKey(fileKey: string): boolean

/** Hard-delete an abandoned 'uploading' row (sweep only). */
export function hardDeleteMedia(id: number): void

/** Pending media count for the moderation digest/badge. */
export function countPendingMedia(): number

/** Distinct visible guest-upload contributors + totals for the gallery
 *  "Shared by" strip. `names` is capped at `limit` (contribution desc); `guests`
 *  is the true distinct count (may exceed names.length); `photos` is the total. */
export interface GuestContributors {
  photos: number
  guests: number
  names: string[]
}

export function getGuestContributors(limit?: number): GuestContributors

/** Count of publicly visible (approved, live-account, non-deleted) guest photos
 *  — the gallery half of the landing "moments shared" tally. */
export function countApprovedGuestMedia(): number

/** Sum of original_bytes across live rows (global disk guard). */
export function sumOriginalBytes(): number

/** Sum of original_bytes for one account (untrusted quota). */
export function sumOriginalBytesForAccount(accountId: number): number

export interface AbandonedUploadRow {
  id: number
  file_key: string
  original_ext: string | null
}

/** 'uploading' rows older than the given SQLite datetime modifier (e.g.
 *  '-6 hours') — swept as abandoned. */
export function getAbandonedUploads(modifier: string): AbandonedUploadRow[]

export interface FileKeyRow {
  file_key: string
}

/** Every file_key in the table (for orphan-file detection). */
export function getAllMediaFileKeys(): FileKeyRow[]

export interface IntegrityRow {
  id: number
  file_key: string
  kind: MediaKind
  section: MediaSection
  original_ext: string | null
  needs_display: 0 | 1
  poster_bytes: number | null
}

/** Finalized, non-deleted rows whose variant files should exist on disk. */
export function getFinalizedMediaForIntegrity(): IntegrityRow[]

/** @file comments.js - Types for comment database operations (Phase 5) */

// (ContentStatus is already imported by the guestbook-entries section above.)
import type {
  Comment,
  CommentFeedRow,
  CommentModerationRow,
  TargetType,
} from "../types.js"

export interface CreateCommentInput {
  /** NULL for a host/couple reply (admin-authored). */
  accountId: number | null
  targetType: TargetType
  targetId: number
  message: string
  status: ContentStatus
}

/** Insert a comment and return the full row. */
export function createComment(input: CreateCommentInput): Comment

export function getCommentById(id: number): Comment | undefined

/**
 * A target's thread: approved comments plus the caller's own pending ones,
 * oldest-first (id ASC). No keyset — comment volumes are small.
 */
export function getCommentsForTarget(options: {
  targetType: TargetType
  targetId: number
  callerId?: number | null
}): CommentFeedRow[]

/** Soft-delete a comment only if it belongs to accountId. Returns true if changed. */
export function softDeleteComment(id: number, accountId: number): boolean

/** Transition a comment's status if its current status is in fromStatuses. */
export function setCommentStatus(
  id: number,
  fromStatuses: ContentStatus[],
  toStatus: ContentStatus,
): boolean

/** Admin queue: pending comments oldest-first, offset-paginated (Phase 6 UI). */
export function getCommentModerationQueue(options: {
  limit: number
  offset: number
}): CommentModerationRow[]

/** Count non-deleted pending comments. */
export function countPendingComments(): number

/** Approved comment count per target id (feed enrichment). Empty ids → empty map. */
export function getCommentCounts(
  targetType: TargetType,
  ids: number[],
): Map<number, number>

/** @file reactions.js - Types for reaction database operations (Phase 5) */

import type { ReactionSummary } from "../types.js"

export interface ToggleReactionInput {
  accountId: number
  targetType: TargetType
  targetId: number
  emoji: string
}

/** Per-emoji totals for a single target (only emojis with ≥1 reaction). */
export function getReactionCounts(
  targetType: TargetType,
  targetId: number,
): { [emoji: string]: number }

/**
 * Toggle one emoji for one account/target: insert if absent (active=true), else
 * delete (active=false). Returns the new state + fresh counts for the target.
 */
export function toggleReaction(input: ToggleReactionInput): {
  active: boolean
  counts: { [emoji: string]: number }
}

/**
 * Per-target reaction summaries (count + caller's `mine`) for a page of ids
 * (feed enrichment). Empty ids → empty map.
 */
export function getReactionSummary(
  targetType: TargetType,
  ids: number[],
  callerId?: number | null,
): Map<number, ReactionSummary>

/** @file targets.js - Cross-target visibility gate for comments/reactions (Phase 5) */

/** Minimal row shape both target lookups return for the visibility check. */
export interface TargetVisibilityRow {
  id: number
  account_id: number | null
  status: ContentStatus
  is_own: 0 | 1
}

/**
 * Is a comment/reaction target visible to this caller? Approved is public; a
 * pending item only to its owner. False for missing/hidden/rejected/deleted.
 */
export function isTargetVisible(
  targetType: TargetType,
  targetId: number,
  callerId?: number | null,
): boolean

/** @file moderation.js - Cross-type moderation queries (Phase 6) */

import type { ModerationQueueRow, ModerationContentType } from "../types.js"

/**
 * Combined moderation queue across guestbook_entries, media, and comments.
 * `type` (optional) narrows to one table; `status` defaults to "pending".
 * `accountId` (optional) filters to one author. Offset-paginated, newest-first.
 */
export function getModerationQueue(options: {
  type?: ModerationContentType | null
  status?: string
  accountId?: number | null
  limit: number
  offset: number
}): ModerationQueueRow[]

/** One moderatable row by type + id, in ANY status, with the queue's
 *  projection (author, parent context). Undefined when it doesn't exist or its
 *  author was deleted. */
export function getModerationItem(
  type: ModerationContentType,
  id: number,
): ModerationQueueRow | undefined

/** How many of one author's posts sit in each status, counted over the same
 *  rows the queue shows. */
export interface ModerationStatusCounts {
  pending: number
  approved: number
  hidden: number
  rejected: number
}

/** Per-status post counts for one account (the author card, Accounts). */
export function getModerationStatusCounts(accountId: number): ModerationStatusCounts

/** Approve all of an account's pending items across the three tables (in a
 *  caller-supplied transaction). Returns the total number of rows released. */
export function approvePendingForAccount(accountId: number): number

/** Hide all of an account's approved content across the three tables (account
 *  soft-delete; reversible). Returns the total number of rows hidden. */
export function hideApprovedContentForAccount(accountId: number): number

/** @file gifts.js - Types for gift log database operations (Digital Thank-You Cards Phase 1) */

import type { Gift, GiftWithGuest } from "../types.js"

export interface CreateGiftInput {
  guestId: number
  description?: string | null
  amount?: string | null
  notes?: string | null
  receivedAt?: string | null
}

/** Insert a gift and return the full row. */
export function createGift(input: CreateGiftInput): Gift

export function getGiftById(id: number): Gift | undefined

/** Admin gift log: joined guest name + the most recent linked card's status. */
export function listGifts(): GiftWithGuest[]

export interface UpdateGiftFields {
  description?: string | null
  amount?: string | null
  notes?: string | null
  receivedAt?: string | null
}

/** Partial update. Returns true if a row changed (false if no fields given). */
export function updateGift(id: number, fields: UpdateGiftFields): boolean

/** Soft-delete a gift. Returns true if a row changed. */
export function softDeleteGift(id: number): boolean

/** Set/clear the physical-card-sent flag (stamps/clears physical_card_sent_at). */
export function setPhysicalCardSent(id: number, sent: boolean): boolean

/** @file thank-you-cards.js - Types for digital thank-you card database operations (Phase 1) */

import type {
  ThankYouCard,
  ThankYouCardWithGuest,
  ThankYouCardListRow,
  ThankYouCardReply,
  PublicThankYouCard,
  ThankYouCardForGuest,
  ThankYouSentVia,
  ThankYouCardStatus,
} from "../types.js"

export interface CreateThankYouCardInput {
  guestId: number
  giftId?: number | null
  message: string
  theme: string
  /** Opaque JSON value (backend never inspects its shape); undefined omits the column. */
  effectsConfig?: unknown
  /** Ordered media file_key list; undefined omits the column. */
  mediaKeys?: string[]
}

/** Insert a draft card with a freshly generated unique token. */
export function createThankYouCard(input: CreateThankYouCardInput): ThankYouCard

export function getCardById(id: number): ThankYouCard | undefined
export function getCardByToken(token: string): ThankYouCard | undefined

/** Token-auth public surface: sent/viewed only, joined recipient name. */
export function getPublicCardByToken(token: string): PublicThankYouCard | undefined

/** Read-only share surface: resolves the same sent/viewed rows as
 *  getPublicCardByToken but by the share_token column (no reply capability). */
export function getPublicCardByShareToken(
  shareToken: string,
): PublicThankYouCard | undefined

/** Admin list, joined guest name + contact, newest first. */
export function listCards(): ThankYouCardListRow[]

export interface UpdateCardFields {
  giftId?: number | null
  message?: string
  theme?: string
  effectsConfig?: unknown
  mediaKeys?: string[] | null
}

/** Partial draft-edit update. Returns true if a row changed. */
export function updateCard(id: number, fields: UpdateCardFields): boolean

/** draft -> sent. Returns true if a row changed (false if not currently draft). */
export function markCardSent(id: number, sentVia: ThankYouSentVia): boolean

/** Envelope-open beacon. One atomic UPDATE: bumps view_count/last_viewed_at on
 *  every hit, and on the first open of a still-'sent' card also flips it to
 *  'viewed' + stamps viewed_at. Returns undefined for a draft/unknown/deleted
 *  token (so the endpoint 404s). */
export function recordCardOpen(
  token: string,
): { viewed_at: string | null; view_count: number } | undefined

/** Compensating reset for a failed send / resend of an unopened card: sent ->
 *  draft (same token), clearing sent_via/sent_at. No-ops (returns false) once
 *  viewed_at is set. */
export function resetCardToDraft(id: number): boolean

/** Clone a card's authored content into a fresh draft with a new token (resend
 *  of an already-opened card). Returns the new card, or undefined if the source
 *  is gone. */
export function duplicateCardToDraft(id: number): ThankYouCard | undefined

export interface SetCardReplyInput {
  /** Reply emoji; null/undefined both mean "no emoji" for this reply. */
  emoji?: string | null
  /** Reply message; null/undefined both mean "no message" for this reply. */
  message?: string | null
}

/** Record a recipient reply: appends to the reply history AND overwrites the
 *  card's latest-reply columns to reflect exactly this reply (no silent merge).
 *  Clears reply_seen_at so it re-surfaces as unread. Returns false for a
 *  contentless reply (neither emoji nor message) or a non-sent/viewed card. */
export function setCardReply(id: number, input: SetCardReplyInput): boolean

/** Admin "clear reply" lever: wipe the card's latest-reply surface columns
 *  (emoji/message/replied_at/reply_seen_at). The append-only reply history rows
 *  are retained. Returns true if a row changed. */
export function clearCardReply(id: number): boolean

/** Full reply thread for a card, oldest first. */
export function getCardReplies(cardId: number): ThankYouCardReply[]

/** Soft-delete a card. Returns true if a row changed. */
export function softDeleteCard(id: number): boolean

/** Sent/viewed cards for a guest (banner surfacing), newest sent first. */
export function getCardsForGuest(guestId: number): ThankYouCardForGuest[]

/** Reference counts for a gallery photo across non-deleted thank-you cards. */
export interface CardReferenceCounts {
  /** All non-deleted cards (any status) whose media_keys array holds the key. */
  total: number
  /** The sent/viewed subset — already delivered, so what a removal warning names. */
  delivered: number
}

/** Count non-deleted thank-you cards whose media_keys JSON array contains this
 *  file_key, broken out into total vs delivered (sent/viewed). Used to warn an
 *  admin before removing/rejecting a gallery photo embedded in already-sent
 *  cards (which then degrade gracefully via resolveMedia). */
export function countCardsReferencingFileKey(fileKey: string): CardReferenceCounts

/** Count of replied, not-yet-admin-seen, non-deleted cards (badge/digest). */
export function countUnreadReplies(): number

/** One reply in the cross-card "Mailbox" feed: the reply plus its card's guest
 *  name + token, and whether it's still unread (card not yet acked, or the reply
 *  landed after the last ack). */
export interface RecentReply {
  id: number
  cardId: number
  emoji: string | null
  message: string | null
  createdAt: string
  guestName: string
  cardToken: string
  unread: boolean
}

/** Recent replies across ALL non-deleted cards, newest first (Mailbox / Inbox).
 *  `limit` caps the page. */
export function getRecentReplies(limit: number): RecentReply[]

/** Mark a batch of replies as seen. Returns the number of rows changed. */
export function markRepliesSeen(ids: number[]): number

/** Whether the opt-in instant first-reply ping is enabled (app_state flag,
 *  default false). */
export function getReplyPingEnabled(): boolean

/** Enable/disable the opt-in instant first-reply ping (app_state flag). */
export function setReplyPingEnabled(enabled: boolean): void

/** Aggregated guest content for the thank-you composer sidecar / detail panel.
 *  Guestbook/media hang off the guest's linked account(s); a guest with no
 *  account yields null/empty for those. */
export interface GuestStoryData {
  guestbookEntry: { message: string; createdAt: string } | null
  media: Array<{ fileKey: string; kind: "image" | "video" }>
  gifts: Array<{
    id: number
    description: string | null
    amount: string | null
    receivedAt: string | null
    physicalCardSent: boolean
  }>
  cards: Array<{
    id: number
    status: ThankYouCardStatus
    sentAt: string | null
    viewedAt: string | null
    repliedAt: string | null
    replySeen: boolean
  }>
}

/** Gather a guest's approved guestbook/media plus their gift + card ledger. */
export function getGuestStory(guestId: number): GuestStoryData

/** @file guest-photos.js - "Photos they're in" for the thank-you composer */

/** One approved gallery item a guest appears in (via a named, roster-linked face). */
export interface GuestPhoto {
  id: number
  file_key: string
  kind: "image" | "video"
  section: "official" | "guest" | "honeymoon"
  width: number | null
  height: number | null
  needs_display: boolean
  created_at: string
  /** How many of the guest's faces are in it (a photo can hold two of their faces
   *  only by mistake, but the count is honest). */
  faces: number
}

/** Approved, live gallery media with a live face assigned (through a live,
 *  unmerged identity) to a live person linked to this guest. Most faces first. */
export function getMediaFeaturingGuest(guestId: number): GuestPhoto[]

/** @file account-recovery.js - Account recovery tokens (Phase 6) */

/** Store a single-use recovery token (hash only) with an expiry timestamp. */
export function createRecoveryToken(
  accountId: number,
  tokenHash: string,
  expiresAt: string,
): void

/**
 * Atomically redeem a recovery token: returns its account_id and marks it used,
 * or null if the token is unknown, already used, or expired.
 */
export function consumeRecoveryToken(tokenHash: string): number | null

/** @file people.js - Types for the photographed-cast table (schema.js
 *  `add_people`). A person is who a face belongs to; a guest is an invitation. */

import type { Person } from "../types.js"

export interface CreatePersonInput {
  displayName: string
  /** Optional link to a roster guest. NULL = off-roster. */
  guestId?: number | null
  /** From the authenticated admin session — never client-supplied. */
  createdBy?: string | null
  notes?: string | null
}

/** Insert a people row and return it. */
export function createPerson(input: CreatePersonInput): Person

/** Live person by id, or undefined. */
export function getPersonById(id: number): Person | undefined

/** One live person as the admin list shows them: linked guest name (null for
 *  off-roster), live identity count, live face count. */
export interface PersonListRow {
  id: number
  display_name: string
  guest_id: number | null
  guest_name: string | null
  notes: string | null
  identities: number
  faces: number
}

/** Every live person, display-name order (case-insensitive), for the admin
 *  datalist + management list. */
export function listPeople(): PersonListRow[]

/** Fold a display name to its comparison key (NFC, then lower-cased) — the one
 *  definition of "the same name", shared by duplicate detection and the admin
 *  UI's name resolution. */
export function nameKey(displayName: string): string

/** Case-insensitive exact display-name matches among live people, compared via
 *  `nameKey`. Duplicate names are legal; creation surfaces these rather than
 *  silently picking one. */
export function findLivePeopleByName(displayName: string): Person[]

export interface UpdatePersonInput {
  displayName?: string
  /** `null` unlinks the guest; `undefined` leaves the link untouched. */
  guestId?: number | null
  notes?: string | null
}

/** Patch a live person. Returns false if the person is missing/deleted. */
export function updatePerson(id: number, input: UpdatePersonInput): boolean

/** Soft-delete a person. The API layer refuses this while live identities
 *  reference them (person_id is NOT NULL, so they would point at a tombstone). */
export function softDeletePerson(id: number): boolean

/** How many live face_identities reference this person. */
export function liveIdentityCountForPerson(personId: number): number

/** @file media-faces.js - Types for face pipeline database operations
 *  (docs/post-wedding/SPEC-vision-lab.md §10) */

import type {
  MediaFace,
  FaceIdentity,
  FaceSource,
  FaceIdentityProvenance,
  RouteState,
} from "../types.js"

/** Pixel-space bounding box in the source image. */
export interface FaceBBox {
  x: number
  y: number
  w: number
  h: number
}

/** Exactly gateSignals()'s output shape (public/vision/gate.js). Every field
 *  optional/nullable — a caller may only have some signals, or none yet. */
export interface FaceGateSignals {
  score?: number | null
  boxPx?: number | null
  borderPx?: number | null
  eyeRatio?: number | null
  eyeAngle?: number | null
  alignScale?: number | null
  residual?: number | null
  outsideFraction?: number | null
  sharpness?: number | null
}

export interface InsertFaceInput {
  mediaId: number
  bbox: FaceBBox
  /** 10 numbers (5 x,y landmark pairs), or null. */
  landmarks: number[] | null
  /** Nullable/omittable — a row may carry no graded signals yet. */
  signals?: FaceGateSignals | null
  /** Nullable — detection-only rows (no recognition run, or nothing
   *  recognisable) are valid. */
  descriptor?: Buffer | Uint8Array | null
  modelVersion: string
  source: FaceSource
  /** The routing grade, if the caller computed one. Null leaves the row
   *  ungraded, which is a legitimate state (detection-only rows, and any
   *  path that has no signals to grade from) rather than an omission. */
  route?: FaceRouteVerdict | null
  /** The `vision_ingests` row this face came out of. Null for an upload-time
   *  detection, which has no ingest run behind it, and for every row written
   *  before the `add_vision_provenance` migration. */
  ingestId?: number | null
}

/** What `setFaceRoute`/`insertFace` persist. Structurally the pipeline's
 *  RouteVerdict minus its ordering score — the score orders a live queue and
 *  is recomputed, so storing it would be a second copy to keep true. */
export interface FaceRouteVerdict {
  state: RouteState
  reason: string | null
  profile: string
}

/** Insert a face row and return the full row. Subject to the schema's §10
 *  precedence triggers: a 'cli' insert retires live 'upload' rows for the same
 *  media_id; an 'upload' insert arriving after a live 'cli' row is born
 *  already soft-deleted. */
export function insertFace(input: InsertFaceInput): MediaFace

export function getFaceById(id: number): MediaFace | undefined

/** Live (non-deleted) faces for one media row, id ascending. */
export function facesForMedia(mediaId: number): MediaFace[]

/** Soft-delete a face row. Returns true if a row changed. */
export function softDeleteFace(id: number): boolean

export interface CreateIdentityInput {
  personId: number
  confirmedBy?: string | null
  confirmedAt?: string | null
  /** Defaults to 'confirmed'. Propagated identities are second-class — see
   *  schema.js's add_media_faces migration comment. */
  provenance?: FaceIdentityProvenance
}

/** Insert a face_identities row and return the full row. At most one live row
 *  per (person, provenance) — idx_face_identities_person enforces it. */
export function createIdentity(input: CreateIdentityInput): FaceIdentity

export function getIdentityById(id: number): FaceIdentity | undefined

/** Live identities linked to one person, id ascending — at most one per
 *  provenance, which is what makes `.find(...)` over this deterministic. */
export function identitiesForPerson(personId: number): FaceIdentity[]

/** Person-merge primitive, and the whole of what a merge writes: set
 *  `face_identities.merged_into` so the source redirects to the target.
 *
 *  Returns true if the merge was recorded. **False means it was REFUSED** and
 *  nothing changed — the source is not live, or the target resolves to nobody
 *  or back to the source, which would close a cycle and make `resolveIdentity`
 *  throw for every identity in it, permanently.
 *
 *  Redirects stay ONE HOP DEEP: the source is pointed at
 *  `resolveIdentity(target)`, and everything that pointed at the source is
 *  repointed at the same survivor. That second half is what bounds the depth —
 *  a chain grows when a target is merged LATER, which is the ordinary case of
 *  folding one person into another repeatedly — and it is what leaves
 *  `resolveIdentity`'s hop bound free to mean "corrupt" rather than "deep".
 *
 *  Replaced `repointFaces`, which rewrote `media_faces.face_identity_id` on
 *  every affected row — a direct write to a column the ledger now owns, and a
 *  rewrite of history besides (an event that named A would afterwards sit
 *  beside a column saying B). No face row is touched here; `resolveIdentity`
 *  reads through the redirect instead. */
export function mergeIdentityInto(fromIdentityId: number, toIdentityId: number): boolean

/** Every face row — live OR soft-deleted — whose `face_identity_id` currently
 *  names one identity, ascending. Soft-deleted rows are included for the same
 *  reason `repointFaces` included them: a superseded row that resurfaces must
 *  not carry a reference nobody has re-resolved. */
export function faceIdsForIdentity(identityId: number): number[]

/** Person-merge primitive: move a live identity to another person. Subject to
 *  idx_face_identities_person — throws if the target person already has a live
 *  identity of the same provenance (merge consolidates first). */
export function setIdentityPerson(identityId: number, personId: number): boolean

/** Soft-delete an identity row (its media_faces.face_identity_id references
 *  are NOT cleared by this — only a hard delete/cascade does that; callers
 *  that want faces detached record a `clear` event through
 *  db/face-assignments.js's `recordAssignment`, which is the only writer of
 *  that column). Returns true if a row changed. */
export function softDeleteIdentity(id: number): boolean

/** Which of the given media ids have at least one live (non-deleted) face
 *  row. Empty input returns an empty set. */
export function mediaWithFaces(mediaIds: number[]): Set<number>

/** Pack a descriptor into its storage form: 4 bytes per float, little-endian,
 *  explicit (Buffer.writeFloatLE), independent of host endianness. */
export function descriptorToBlob(vector: Float32Array): Buffer

/** Inverse of descriptorToBlob. Accepts either a Buffer or the plain
 *  Uint8Array node:sqlite returns for a BLOB column. */
export function blobToDescriptor(blob: Uint8Array | Buffer): Float32Array

export interface FaceCounts {
  /** Live (non-deleted) rows, identified or not. */
  faces: number
  /** Live rows with a face_identity_id. */
  identified: number
  /** Live rows with no face_identity_id. */
  unidentified: number
  /** Soft-deleted rows ("not a face"). */
  notAFace: number
}

/** Counts for the admin overview tile row. SUM() over an empty table reads
 *  back as 0, not SQLite's native NULL. */
export function getFaceCounts(): FaceCounts

/** One live, undecided, descriptor-bearing face row — the shape group.js and
 *  assign.js need (bbox for display, model_version to partition descriptor
 *  spaces, descriptor to compute with). */
export interface UnidentifiedFaceRow {
  id: number
  media_id: number
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  model_version: string
  descriptor: Uint8Array
  /** Carried so the DISPLAY can filter on it. Null = not yet graded. */
  route_state: RouteState | null
  route_reason: string | null
}

/** Every live, undecided face with a descriptor, id ascending. Grouping and
 *  matching are computed on demand from this — nothing about a group is
 *  persisted (see the admin routes' module comment).
 *
 *  Returns every such face REGARDLESS of route state, on purpose: routing
 *  filters what an admin sees, never what the clustering sees. */
export function unidentifiedFacesWithDescriptors(): UnidentifiedFaceRow[]

/** One face's nine gate signals and its routing grade. The function D8 said
 *  was missing: nothing in db/media-faces.js selected a signal column, so the
 *  Faces tab could not tell a good detection from a bad one. Never carries a
 *  descriptor — this shape is returned to the admin UI as JSON. */
export interface FaceSignalRow {
  id: number
  media_id: number
  model_version: string
  signal_score: number | null
  signal_boxPx: number | null
  signal_borderPx: number | null
  signal_eyeRatio: number | null
  signal_eyeAngle: number | null
  signal_alignScale: number | null
  signal_residual: number | null
  signal_outsideFraction: number | null
  signal_sharpness: number | null
  route_state: RouteState | null
  route_reason: string | null
  route_profile: string | null
}

/** Signals + routing for a set of live face ids, id ascending. Empty input
 *  returns an empty array without touching the database. */
export function facesWithSignals(faceIds: number[]): FaceSignalRow[]

/** face id -> route_state, for the ids that are live rows. An id absent from
 *  the map is not a live face; an id mapping to null is a live face that has
 *  not been graded. Those are different failures and callers distinguish
 *  them. */
export function routeStatesOf(faceIds: number[]): Map<number, RouteState | null>

/** Record a routing grade, carrying the profile it was computed under.
 *  Returns true if a live row changed. */
export function setFaceRoute(id: number, verdict: FaceRouteVerdict): boolean

/** Live faces per route state. `ungraded` counts `route_state IS NULL` as a
 *  first-class bucket — a summary that drops them looks complete and is not. */
export interface RouteStateCounts {
  accept: number
  ask: number
  setAside: number
  ungraded: number
}

export function routeStateCounts(): RouteStateCounts

/** One photograph holding at least one live `set_aside` face — the row behind
 *  the Faces tab's "set aside" entry point. Never carries a descriptor. */
export interface SetAsideMediaRow {
  media_id: number
  file_key: string
  /** Live faces on this photograph graded `set_aside`. */
  set_aside_faces: number
  /** How many of those still carry no identity — the number that moves as the
   *  work is done. `set_aside_faces` never does: naming a face does not
   *  re-grade it. */
  unnamed_set_aside: number
  /** EVERY live face on the photograph, ungraded ones included, so a row can
   *  never understate how many faces the photograph actually holds. */
  live_faces: number
}

/** The photographs with at least one live `set_aside` face, media id ascending.
 *
 *  These are the photographs no other list in the Faces tab can reach: groups
 *  and the ask queue are lists of FACES and both filter `set_aside` out, so one
 *  whose faces are all set aside (or all already named) appears nowhere and its
 *  faces cannot be opened at all.
 *
 *  An ungraded face (`route_state IS NULL`) never puts a photograph in this list
 *  — ungraded is shown and bulk-assignable already, so it needs no entry point —
 *  but ungraded faces are still counted in `live_faces`, so the arithmetic on a
 *  listed row describes the whole photograph.
 *
 *  Ordered by the immutable media id, so paging stays stable while faces are
 *  being named. */
export function setAsideMedia(options: { limit: number; offset: number }): SetAsideMediaRow[]

/** How many photographs `setAsideMedia` can return in total, for paging. */
export function countSetAsideMedia(): number

/** One face belonging to a CONFIRMED (never 'propagated') identity, restricted
 *  to a single descriptor model version. `person_name` is always present;
 *  `guest_id`/`guest_name` come off a LEFT JOIN and are null for an off-roster
 *  person — every consumer must handle that. */
export interface ConfirmedIdentityFaceRow {
  identity_id: number
  person_id: number
  person_name: string
  guest_id: number | null
  guest_name: string | null
  face_id: number
  descriptor: Uint8Array
}

/** Every live face confirmed to a guest, for ONE model_version — the material
 *  a prototype is built from. Descriptors from a different model_version are
 *  never mixed in; call once per version in play. */
export function confirmedIdentityFaces(modelVersion: string): ConfirmedIdentityFaceRow[]

/** One live, descriptor-bearing face inside a multi-photo frame class, with
 *  the frame key and whatever identity it currently carries. Both identified
 *  and unidentified rows: propagation needs the former as sources, the latter
 *  as targets, and needs to see a taken box in order to refuse it. */
export interface PropagationFaceRow {
  id: number
  media_id: number
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  face_identity_id: number | null
  descriptor: Uint8Array
  frame_root_sha256: string
}

/** Faces eligible for must-link propagation, for ONE model_version. Restricted
 *  to frame classes holding more than one photograph — a lone photo has no
 *  neighbouring frame to propagate into. */
export function facesForPropagation(modelVersion: string): PropagationFaceRow[]

/** media_id -> frame key, for counting distinct FRAMES rather than distinct
 *  rows. A media row with no CLI-assigned frame root is its own frame. Empty
 *  input returns an empty map. */
export function frameKeysByMediaId(mediaIds: number[]): Map<number, string>

/** Every descriptor model version on a live face row, ascending. Any
 *  computation over distances must partition by this first. */
export function faceModelVersions(): string[]

/** media_id -> the file key and ORIGINAL pixel dimensions a face chip needs to
 *  crop a thumbnail to one box client-side. Without the dimensions the box
 *  cannot be mapped onto a thumbnail and the UI shows the whole photo. */
export function mediaChipInfo(
  mediaIds: number[],
): Map<number, { fileKey: string; width: number | null; height: number | null }>

/** media_id -> the confirmed identities already placed in that photograph.
 *  The "who else is in this frame" half of the co-occurrence prior. */
export function confirmedIdentitiesPerMedia(): Map<number, Set<number>>

/** How many distinct photographs each pair of confirmed identities shares.
 *  `identity_a < identity_b` always, so each pair appears once. */
export interface CooccurrenceRow {
  identity_a: number
  identity_b: number
  frames: number
}

/** Co-occurrence counts over CONFIRMED identities only. Orders suggestions;
 *  never decides one. Propagated identities are excluded so an unreviewed
 *  guess cannot become the evidence for the next guess. */
export function confirmedCooccurrence(): CooccurrenceRow[]

/** One live face on one photo, with the identified person's id/name if any
 *  (LEFT JOIN, so an unidentified face still gets a row with both null).
 *  Never carries the descriptor column. */
export interface FaceWithNameRow {
  id: number
  media_id: number
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  face_identity_id: number | null
  /** Null = ungraded (ingested before quality routing). NOT a filter — the
   *  per-photograph view shows every state, `set_aside` included, because it
   *  is the one place a held-back face can be named. */
  route_state: RouteState | null
  /** The identity's provenance, or null when the face is unidentified. A
   *  `propagated` name is a machine's inference carried across a
   *  near-duplicate frame; a `confirmed` one is a human's. */
  provenance: FaceIdentityProvenance | null
  person_id: number | null
  person_name: string | null
}

/** Live faces for one photo, id ascending, each carrying the identified
 *  person's name if any. The descriptor is never selected. */
export function facesForMediaWithNames(mediaId: number): FaceWithNameRow[]

/** @file vision-ingests.js - Ingest provenance (schema.js
 *  `add_vision_provenance`). One row per pipeline run: what produced a face,
 *  as opposed to `media_faces.model_version`, which names only the descriptor
 *  space the face was embedded into. */

import type { VisionIngest, VisionIngestConfig } from "../types.js"

export interface CreateIngestInput {
  datasetId: string
  /** Descriptor space only — embedder, width, normalisation, mirror. Never the
   *  detector: the detector is what this row records. */
  modelVersion: string
  detectorSha256: string
  embedderSha256: string
  engineSha256: string
  /** Stored as 0/1; SQLite has no boolean. */
  mirrorApplied: boolean
  normalisation: string
  routeProfile: string
  /** The ALLOWLISTED config object (see VisionIngestConfig) — serialised here,
   *  so callers never hand-roll the JSON. Never a path, never argv, never a
   *  number measured from the photographs. */
  config: VisionIngestConfig
}

/** Insert an ingest row and return it. A PLAIN statement with no transaction
 *  of its own — every caller is already inside one (db/utils.js
 *  `withTransaction` is a bare BEGIN IMMEDIATE and does not nest). */
export function createIngest(input: CreateIngestInput): VisionIngest

export function getIngestById(id: number): VisionIngest | undefined

/** Every ingest recorded against one descriptor space, id ascending. */
export function ingestsForModelVersion(modelVersion: string): VisionIngest[]

/** The three facts a `model_version` string is a NAME FOR. If two runs disagree
 *  on any of them, the same string means two different descriptor spaces. */
export interface ModelVersionTriple {
  embedderSha256: string
  normalisation: string
  mirrorApplied: boolean
}

/** Throw if `modelVersion` has already been recorded against a DIFFERENT
 *  (embedder, normalisation, mirror) triple.
 *
 *  `model_version` is what every distance computation partitions on, so a
 *  reused string silently mixes two descriptor spaces inside one comparison —
 *  and that failure looks like a slightly worse recogniser rather than like a
 *  bug, which is exactly why it needs a hard check instead of a convention.
 *  Identical reuse is fine and expected: a second run of the same models. */
export function assertModelVersionInvariant(
  modelVersion: string,
  triple: ModelVersionTriple,
): void

/** @file face-assignments.js - The append-only ledger behind
 *  `media_faces.face_identity_id` (schema.js `add_vision_provenance`).
 *
 *  Nothing else may write `face_identity_id` once this exists:
 *  `recordAssignment` appends the event AND materialises the column in one
 *  call, and `projectFace` is the single definition of "materialise". Two
 *  implementations of one rule is how they drift. */

import type {
  FaceAssignment,
  FaceAssignmentBatch,
  FaceAssignmentBatchKind,
  FaceAssignmentOp,
  FaceBatchRevocation,
} from "../types.js"

export interface CreateBatchInput {
  /** Caller-chosen, and the primary key — so making it unique (a uuid, a run
   *  id) is the caller's job. */
  batchId: string
  kind: FaceAssignmentBatchKind
  /** core/utils.js `actorId()`. Never from the client. */
  actor: string
  note?: string | null
}

/** Insert one revocable batch. `kind` is enum-checked by
 *  `check_face_assignment_batches_kind_insert` (schema.js
 *  `add_face_ledger_integrity`), so an unrecognised one throws rather than
 *  becoming a revocable unit nobody can explain. Everything except
 *  `revoked_at`/`revoked_by` is frozen from here on, and those two move only
 *  with the batch's revocation history (`revokeBatch` / `reinstateBatch`). */
export function createBatch(input: CreateBatchInput): FaceAssignmentBatch

export function getBatch(batchId: string): FaceAssignmentBatch | undefined

export interface RecordAssignmentInput {
  faceId: number
  op: FaceAssignmentOp
  /** Required for `assign`/`negative`, absent/null for `clear`/`not_a_face` —
   *  trigger-enforced, so a disagreement throws rather than storing a state
   *  nobody can replay. */
  identityId?: number | null
  /** core/utils.js `actorId()`. Never from the client. */
  actor: string
  /** Null for a one-off event, which is therefore not bulk-revocable. */
  batchId?: string | null
  reason?: string | null
}

/** Append one event AND project the face, in one call. Plain statements, no
 *  transaction of its own: every write path in api/admin/faces.js is already
 *  inside a `withTransaction`, which is a bare BEGIN IMMEDIATE and does not
 *  nest. Returns the appended row. */
export function recordAssignment(input: RecordAssignmentInput): FaceAssignment

/** Every event for one face, id ascending — the audit view. Includes revoked
 *  batches' events and `negative` events, both of which replay skips: this is
 *  the history, not the verdict. */
export function assignmentsForFace(faceId: number): FaceAssignment[]

/** Follow `face_identities.merged_into` to the live identity at the end of the
 *  chain. Returns null for a null input, for an identity that does not exist,
 *  and for a chain that ends at a soft-deleted row.
 *
 *  Compresses what it walks: a chain longer than one hop is collapsed onto its
 *  endpoint on the way out, so reading heals it. `mergeIdentityInto` keeps new
 *  ones one hop deep in the first place; this is for what came before that and
 *  for anything written by hand.
 *
 *  **Throws rather than looping** if the chain exceeds its hop bound. With both
 *  compressions in place that bound is only reachable by a cycle, which is
 *  corrupt data — and an infinite loop inside a request is worse than an
 *  error. */
export function resolveIdentity(identityId: number | null): number | null

export interface ReplayOptions {
  /** Replay as if this batch had never happened — the preview half of
   *  `revokeBatch`, and the reason projection cannot be a trigger (SQL cannot
   *  express "replay excluding batch X"). */
  ignoreBatchId?: string | null
}

/** What the ledger says a face currently is. */
export interface FaceReplayResult {
  /** The LIVE identity id, already resolved through any merges. Null when the
   *  face is unassigned, or when its identity has been deleted. */
  identityId: number | null
  /** The box is not a face at all. Materialises as a soft delete. */
  notAFace: boolean
}

/** Replay one face's events, newest first, and return the first survivor.
 *
 *  Skipped: events in a revoked batch, events in `ignoreBatchId`, and every
 *  `negative` event (a constraint on what the face is NOT, never a state).
 *  No survivor → `{ identityId: null, notAFace: false }`. */
export function replayFace(faceId: number, opts?: ReplayOptions): FaceReplayResult

/** Materialise `replayFace` onto `media_faces` (`face_identity_id` and
 *  `deleted_at`), and return what it wrote. The SINGLE definition of
 *  "materialise" — a trigger was considered and rejected, because it cannot
 *  express "replay excluding batch X" and the logic would then exist twice.
 *
 *  `deleted_at` has three authors (this projection, schema.js's §10 precedence
 *  triggers, and `retireCliFaces`'s `--replace` path), so a retirement written
 *  here leaves a receipt in `media_faces.ledger_retired_at` and only a
 *  retirement whose receipt still matches is ever undone. */
export function projectFace(faceId: number, opts?: ReplayOptions): FaceReplayResult

/** Flag a batch revoked and re-project every face it touched. Returns how many
 *  faces were re-projected.
 *
 *  Reversible by construction: revocation is a flag, not a compensating event,
 *  so a later manual correction on the same face simply outranks the revoked
 *  bulk one and SURVIVES the revocation. Throws if the batch does not exist.
 *  Re-revoking an already-revoked batch re-projects without overwriting who
 *  revoked it and when, and appends no history. A fresh revocation appends a
 *  `revoke` row to `face_batch_revocations` in the same transaction. */
export function revokeBatch(batchId: string, actor: string): number

/** `revokeBatch` in reverse: append a `reinstate` row, clear the flag, and
 *  re-project every face the batch touched, in one transaction. Returns how
 *  many faces were re-projected.
 *
 *  A face corrected by hand after the batch keeps that correction — replay is
 *  newest-id first, and the batch's events are older. Throws if the batch does
 *  not exist or is not revoked: reinstating a live batch is refused, never a
 *  no-op, so the history only ever records a reinstatement of a revocation. */
export function reinstateBatch(batchId: string, actor: string): number

/** A batch's revoke/reinstate history, oldest first. Empty for a batch that
 *  was never revoked. */
export function batchRevocationHistory(batchId: string): FaceBatchRevocation[]

/** One row of `recentBatches` — a batch plus how much of the ledger hangs off
 *  it. Nothing here describes a photograph or a person: an id, a kind, an
 *  eight-hex-character actor, two timestamps and two counts. */
export interface FaceBatchSummary {
  batch_id: string
  kind: FaceAssignmentBatchKind
  /** core/utils.js `actorId()` — eight hex characters of a session-token
   *  digest, which identifies a session and authenticates nobody. */
  actor: string
  note: string | null
  created_at: string
  /** Null while the batch still counts. Never re-dated while it stands, and
   *  cleared only by a recorded reinstatement — schema.js's
   *  `face_assignment_batches_revocation_follows_history`. */
  revoked_at: string | null
  revoked_by: string | null
  /** Events still on the batch. Zero is legitimate: `face_assignments.face_id`
   *  is ON DELETE CASCADE, so hard-deleting the faces empties a batch without
   *  removing it. */
  events: number
  /** Distinct faces those events touch — what revoking would re-project. */
  faces: number
}

/** The most recent batches, newest first, for the Faces tab's undo affordance
 *  and for anyone auditing what a bulk pass did. Revoked batches are INCLUDED:
 *  the list is a history, and "this was already taken back, by whom and when"
 *  is the answer that stops a second attempt. */
export function recentBatches(limit: number): FaceBatchSummary[]

/** Identity ids this face has been declared NOT to be, ascending — for
 *  suggestion ranking. Resolved through merges (a negative against an identity
 *  since folded into another still applies to the live one) and filtered of
 *  revoked batches, for the same reasons replay is. */
export function negativesForFace(faceId: number): number[]

/** @file snapshot.js - Consistent database snapshots */

export interface SnapshotOptions {
  /** Skip (not fail) when free space beside the database, less the database size, is below this. */
  minFreeBytes?: number
  /** Clock override for the filename stamp (tests). */
  now?: Date
}

export interface SnapshotResult {
  /** Absolute path of the new snapshot; null when skipped. */
  created: string | null
  /** File names removed by pruning. */
  pruned: string[]
  /** Why nothing was written, when skipped. */
  skipped?: string
}

/**
 * Write `<base>.<YYYYMMDD-HHMMSS>.backup` beside the database via VACUUM INTO (temp name,
 * then rename) and prune to the newest `keep`. Throws a clear Error on failure.
 */
export function snapshotDatabase(
  dbPath: string,
  keep: number,
  options?: SnapshotOptions,
): SnapshotResult

export interface SnapshotScheduleOptions {
  dbPath: string
  keep: number
  intervalMs: number
  initialDelayMs: number
  minFreeBytes: number
  enabled: boolean
  log?: Pick<Console, "log" | "warn" | "error">
}

/** Run snapshots after an initial delay, then on an interval, never overlapping and never
 *  throwing. Returns a stop function, or null when disabled. Timers are unref'd. */
export function startSnapshotSchedule(options: SnapshotScheduleOptions): (() => void) | null
