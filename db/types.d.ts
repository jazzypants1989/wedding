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

import type { Account, AccountSession } from "../types.js"

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
