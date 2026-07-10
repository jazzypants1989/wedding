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

/** Soft-delete an entry only if it belongs to accountId. Returns true if a row changed. */
export function softDeleteGuestbookEntry(
  id: number,
  accountId: number,
): boolean

/** Admin queue: pending entries oldest-first, offset-paginated. */
export function getGuestbookModerationQueue(options: {
  limit: number
  offset: number
}): GuestbookFeedRow[]

/** Count non-deleted pending guestbook entries. */
export function countPendingGuestbook(): number

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
  limit: number
}

/**
 * The public gallery feed for one section. Guest: approved + the caller's own
 * pending, newest-first (id DESC), keyset-paginated. Official: sort_order, id,
 * single page. LEFT JOIN accounts, so author_name is null for official uploads.
 */
export function getMediaFeed(options: MediaFeedOptions): MediaFeedRow[]

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

/** All official, non-deleted media ids in display order (reorder validation). */
export function getOfficialMediaIds(): number[]

/** Rewrite official items' sort_order to the given id order (array index).
 *  Caller wraps in withTransaction; only official non-deleted rows are touched. */
export function setMediaSortOrders(ids: number[]): void

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

/** Hard-delete an abandoned 'uploading' row (sweep only). */
export function hardDeleteMedia(id: number): void

/** Pending media count for the moderation digest/badge. */
export function countPendingMedia(): number

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
  accountId: number
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

/** Approve all of an account's pending items across the three tables (in a
 *  caller-supplied transaction). Returns the total number of rows released. */
export function approvePendingForAccount(accountId: number): number

/** Hide all of an account's approved content across the three tables (account
 *  soft-delete; reversible). Returns the total number of rows hidden. */
export function hideApprovedContentForAccount(accountId: number): number

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
