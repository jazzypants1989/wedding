/** @file Types for authentication module */

import type { IncomingMessage, ServerResponse } from "node:http"
import type { Guest, RSVPWithGuest } from "../db/types.js"

export interface SessionCookieData {
  token: string
  csrf_token: string
}

export interface CsrfRequest {
  headers: {
    "x-csrf-token"?: string | null
    [key: string]: string | string[] | null | undefined
  }
}

export function hashPassword(password: string): string

export function verifyPassword(
  password: string,
  stored: string | null | undefined,
): boolean

export function getAdminHash(): string | undefined

export interface WeddingFacts {
  coupleNames: string
  coupleFirstNames: string
  date: string
  dateShort: string
  location: string
  venue: string
}

export interface EmailSubjects {
  invite: string
  reminder: string
}

export function getWeddingFacts(): WeddingFacts
export function getEmailSubjects(): EmailSubjects

export function isSetupComplete(): boolean
export function initSetup(): void
export function verifySetupToken(provided: unknown): boolean
export function completeSetup(): void

export function parseCookies(
  cookieHeader: string | null | undefined,
): Record<string, string>

export function createSessionCookies(
  session: { token: string; csrf_token: string },
  secure?: boolean,
): string[]

export function clearSessionCookies(): string[]

export function validateCsrf(
  req: {
    headers: {
      "x-csrf-token"?: string | null
      [key: string]: string | string[] | null | undefined
    }
  },
  session: { csrf_token?: string } | null | undefined,
): boolean

/**
 * Log a CSRF double-submit failure and send a 403 carrying a machine-readable
 * `code: "CSRF"` so the client shows friendly copy without sniffing the message.
 */
export function sendCsrfError(
  req: IncomingMessage,
  res: ServerResponse,
  kind: "admin" | "guest",
): void

export interface RouteInfo {
  params: Record<string, string>
}

export interface AuthenticatedRouteInfo extends RouteInfo {
  session: Session
}

export type AdminHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
) => void | Promise<void>

export type WrappedHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
) => Promise<void>

export function withErrorHandling(handler: RouteHandler): WrappedHandler

export function withAdmin(handler: AdminHandler): WrappedHandler

/** Route info handed to a withAccount()-wrapped handler: the validated guest session. */
export interface AccountRouteInfo extends RouteInfo {
  account: AccountSession
}

export type AccountHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountRouteInfo,
) => void | Promise<void>

export function withAccount(handler: AccountHandler): WrappedHandler

/**
 * Normalized principal handed to a withAccountOrAdmin()-wrapped handler,
 * papering over the fact that an admin caller has no accounts row. Guest
 * uploads carry a real accountId; admin uploads carry accountId=null and are
 * implicitly trusted. Ownership: `principal.isAdmin || row.account_id === principal.accountId`.
 * See docs/post-wedding/03-media-pipeline.md §2.
 */
export interface Principal {
  isAdmin: boolean
  accountId: number | null
  trusted: boolean
  session: Session | AccountSession
}

export interface AccountOrAdminRouteInfo extends RouteInfo {
  principal: Principal
}

export type AccountOrAdminHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
) => void | Promise<void>

/**
 * Accepts EITHER a guest guest_session cookie OR an admin session cookie
 * (guest checked first), applying the matching CSRF check and cookie rotation,
 * and hands the handler a normalized {@link Principal}.
 */
export function withAccountOrAdmin(
  handler: AccountOrAdminHandler,
): WrappedHandler

/** Guest cookies — SameSite=Lax (deliberate deviation from admin Strict), Max-Age 180d. */
export function createAccountSessionCookies(
  session: { token: string; csrf_token: string },
  secure?: boolean,
): string[]

export function clearAccountSessionCookies(): string[]

/**
 * Parse the guest_session cookie and return the validated session, or null.
 * Never throws / never 401s — for public GETs that flag the caller's own
 * pending content. Lives in core/auth.js (not db/) to avoid an import cycle.
 */
export function getOptionalAccount(
  req: IncomingMessage,
): AccountSession | null

/** Parse the admin session cookie and return the validated session, or null. */
export function getOptionalAdmin(req: IncomingMessage): Session | null

export interface CSVRow {
  _lineNumber: number
  [key: string]: string | number
}

export type GuestForCSV = Partial<Guest> & { name: string; [key: string]: unknown }

export interface RSVPForCSV {
  name: string
  email?: string | null
  phone?: string | null
  attending?: number
  actual_party_size?: number | null
  dietary_restrictions?: string | null
  additional_info?: string | null
  message?: string | null
  submitted_at?: string
}

export function parseCSV(csvString: string): CSVRow[]
export function escapeCSVField(value: unknown): string
export function guestsToCSV(guests: GuestForCSV[]): string
export function rsvpsToCSV(rsvps: RSVPForCSV[]): string

export class AppError extends Error {
  constructor(message: string, statusCode?: number, code?: string)
  statusCode: number
  code: string
  isOperational: boolean
}

export class ValidationError extends AppError {
  constructor(message: string)
}

export class NotFoundError extends AppError {
  constructor(resource?: string)
}

export class ConflictError extends AppError {
  constructor(message: string)
}

export class AuthenticationError extends AppError {
  constructor(message?: string)
}

export class AuthorizationError extends AppError {
  constructor(message?: string)
}

export class PayloadTooLargeError extends AppError {
  constructor(message?: string)
}

export class LengthRequiredError extends AppError {
  constructor(message?: string)
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message?: string)
}

export class RateLimitError extends AppError {
  constructor(message?: string)
}

type Params<T> = ConstructorParameters<T>
export type AppErrorParams = Params<typeof AppError>
export type ValidationErrorParams = Params<typeof ValidationError>
export type NotFoundErrorParams = Params<typeof NotFoundError>
export type ConflictErrorParams = Params<typeof ConflictError>
export type AuthenticationErrorParams = Params<typeof AuthenticationError>
export type AuthorizationErrorParams = Params<typeof AuthorizationError>
export type PayloadTooLargeErrorParams = Params<typeof PayloadTooLargeError>
export type LengthRequiredErrorParams = Params<typeof LengthRequiredError>
export type UnsupportedMediaTypeErrorParams = Params<typeof UnsupportedMediaTypeError>
export type RateLimitErrorParams = Params<typeof RateLimitError>

export interface ErrorBody {
  error: string
  code?: string
}

export interface ResponseHeaders {
  [key: string]: string | number
}

export function parseBody(
  req: IncomingMessage,
  maxSize?: number,
): Promise<Record<string, unknown>>

export function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: object,
  extraHeaders?: Record<string, string | string[]>,
): void

export function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string,
  code?: string | null,
): void

export function checkRateLimit(
  res: ServerResponse,
  limiter: RateLimiter,
  key: string,
): boolean

export function sendCsv(
  res: ServerResponse,
  filename: string,
  content: string,
): void

export function addSecurityHeaders(headers: ResponseHeaders): ResponseHeaders

export function sanitize(str: unknown, maxLen?: number): string | null
export function isValidEmail(email: string | null | undefined): boolean

/** @file Types for audit logging */

export interface AuditEvent {
  action: string
  adminId?: string
  ip?: string
  resourceType?: string
  resourceId?: number | string
  details?: Record<string, unknown>
}

interface AuditActions {
  readonly LOGIN: "LOGIN"
  readonly LOGIN_FAILED: "LOGIN_FAILED"
  readonly LOGOUT: "LOGOUT"
  readonly GUEST_CREATE: "GUEST_CREATE"
  readonly GUEST_UPDATE: "GUEST_UPDATE"
  readonly GUEST_DELETE: "GUEST_DELETE"
  readonly GUEST_RESTORE: "GUEST_RESTORE"
  readonly GUEST_IMPORT: "GUEST_IMPORT"
  readonly GUEST_EXPORT: "GUEST_EXPORT"
  readonly PETITION_APPROVE: "PETITION_APPROVE"
  readonly PETITION_DENY: "PETITION_DENY"
  readonly PETITION_CREATE: "PETITION_CREATE"
  readonly BLOCKLIST_ADD: "BLOCKLIST_ADD"
  readonly BLOCKLIST_REMOVE: "BLOCKLIST_REMOVE"
  readonly INVITE_SEND: "INVITE_SEND"
  readonly INVITE_SEND_FAILED: "INVITE_SEND_FAILED"
  readonly MANUAL_SMS_MARK: "MANUAL_SMS_MARK"
  readonly RSVP_SUBMIT: "RSVP_SUBMIT"
  readonly CSRF_FAILURE: "CSRF_FAILURE"
  readonly ACCOUNT_REGISTER: "ACCOUNT_REGISTER"
  readonly ACCOUNT_LOGIN: "ACCOUNT_LOGIN"
  readonly ACCOUNT_LOGOUT: "ACCOUNT_LOGOUT"
}

export function log(event: AuditEvent): void
/** Write many audit events in a single file append (bulk moderation actions). */
export function logBatch(events: AuditEvent[]): void
export function cleanOldLogs(): void
export const AUDIT_ACTIONS: AuditActions

/** @file Types for SQLite-backed rate limiting */

import type { IncomingMessage } from "node:http"

/** Minimal request interface for getClientIp */
export interface IpRequest {
  socket?: { remoteAddress?: string } | null
  headers: {
    "x-forwarded-for"?: string | string[]
    [key: string]: string | string[] | undefined
  }
}

export interface RateLimitCheckResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

export interface RateLimiter {
  check(key: string): RateLimitCheckResult
  reset(key: string): void
}

export interface CreateLimiterOptions {
  name: string
  windowMs: number
  max: number
}

export interface Limiters {
  rsvp: RateLimiter
  lookup: RateLimiter
  petition: RateLimiter
  adminLogin: RateLimiter
  adminInvite: RateLimiter
  accountRegister: RateLimiter
  guestbookPost: RateLimiter
  contentDelete: RateLimiter
  mediaCreate: RateLimiter
  publicRead: RateLimiter
}
export const limiters: Limiters

export function cleanExpired(name: string): void
export function createLimiter(options: CreateLimiterOptions): RateLimiter
export function getClientIp(req: IpRequest): string
export function clearAllStores(): void
export function cleanAllExpired(): void

/** @file static.js - Static File Serving Utilities */

export function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean>

export function addCacheBusters(html: string): string

export interface MimeTypes {
  [ext: string]: string
}

export interface CacheControl {
  [ext: string]: string
}

export function escapeHtml(str: string): string

/** @file Types for centralized validation utilities */

import type {
  GuestStatus,
  CommunicationType,
  TargetType,
  ReactionEmoji,
  ValidationResult,
} from "../types.js"

export interface RequiredOptions {
  required?: boolean
}

export function validatePartySize(value: unknown): ValidationResult<number>

export function validateEmail(
  value: unknown,
  options?: RequiredOptions,
): ValidationResult<string | null>

export function validatePhone(
  value: unknown,
  options?: RequiredOptions,
): ValidationResult<string | null>

export function validateGuestStatus(
  value: unknown,
): ValidationResult<GuestStatus>

export function validateCommunicationType(
  value: unknown,
): ValidationResult<CommunicationType>

export function validateTargetType(
  value: unknown,
): ValidationResult<TargetType>

export function validateReactionEmoji(
  value: unknown,
): ValidationResult<ReactionEmoji>

export function validateRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): ValidationResult<string>

export function validateOptionalString(
  value: unknown,
  maxLength: number,
): { valid: true; value: string | null }

export function validateId(
  value: unknown,
  fieldName?: string,
): ValidationResult<number>

export function validateIdArray(
  value: unknown,
  fieldName?: string,
  maxLength?: number,
): ValidationResult<number[]>

export function validateInviteCode(value: unknown): ValidationResult<string>

export function validateServiceConfigured(type: CommunicationType): {
  valid: boolean
  error?: string
}

/** @file router.js - Types for HTTP router */

import type { IncomingMessage, ServerResponse } from "node:http"

export interface RouteSegment {
  value: string
  isParam: boolean
}

export interface ParsedPattern {
  segments: RouteSegment[]
  keys: string[]
}

export interface RouteContext {
  params: Record<string, string>
}

export interface RouteOptions {
  admin?: boolean
  account?: boolean
  accountOrAdmin?: boolean
  errorHandling?: boolean
}

export interface Route {
  method: string
  segments: RouteSegment[]
  keys: string[]
  handler: RouteHandler
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  context: RouteContext,
) => Promise<void> | void

export function parseRoutePattern(pattern: string): ParsedPattern
export function matchRoute(
  urlPath: string,
  segments: RouteSegment[],
): string[] | null
export function route(
  method: string,
  pattern: string,
  handler: AdminHandler,
  options: { admin: true },
): void
export function route(
  method: string,
  pattern: string,
  handler: AccountHandler,
  options: { account: true },
): void
export function route(
  method: string,
  pattern: string,
  handler: AccountOrAdminHandler,
  options: { accountOrAdmin: true },
): void
export function route(
  method: string,
  pattern: string,
  handler: RouteHandler,
  options?: { errorHandling?: boolean },
): void

/** Implementation signature for route() — used by @type in router.js */
export type routeImpl = (
  method: string,
  pattern: string,
  handler: RouteHandler | AdminHandler | AccountHandler | AccountOrAdminHandler,
  options?: RouteOptions,
) => void
export function clearRoutes(): void
export function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean>

// --- Media content sniffing (core/sniff.js) ---

/** Result of magic-byte sniffing; "" means unrecognized/rejected. */
export type SniffedType = "jpeg" | "png" | "webp" | "heic" | "mp4" | "mov" | ""

/** Detect a media type from the leading bytes of a file (needs >= 12 bytes). */
export function sniffMagic(buf: Buffer): SniffedType

/** Storage extension for a sniff result (jpeg -> jpg, etc.); "" if unknown. */
export function extForSniff(sniffed: string): string

/** True if a declared Content-Type header agrees with the sniffed bytes. */
export function contentTypeAgrees(
  contentType: string | undefined,
  sniffed: SniffedType,
): boolean

// --- Streaming upload write path (core/upload.js) ---

export interface StreamToStagingOpts {
  /** Hard byte cap for this variant (413 on exceed). */
  maxBytes: number
  /** Acceptable sniff results for this variant (415 on mismatch). */
  expectedKinds: string[]
  /** Directory for the {rand}.part staging file (same fs as final location). */
  stagingDir: string
}

export interface StreamToStagingResult {
  stagingPath: string
  bytes: number
  sniffed: SniffedType
  sha256: string
}

/**
 * Stream a raw request body to a staging file, guarding size (411/413),
 * magic-byte type (415), and idle/absolute timeouts. Unlinks the partial file
 * on any failure. Caller renames stagingPath into place on success.
 */
export function streamToStaging(
  req: IncomingMessage,
  opts: StreamToStagingOpts,
): Promise<StreamToStagingResult>

/** Reserve a concurrency slot (guests capped) + byte reservation. false = at cap. */
export function reserveUploadSlot(accountId: number | null, bytes: number): boolean

/** Release a previously-reserved slot; MUST be called in a finally. */
export function releaseUploadSlot(accountId: number | null, bytes: number): void

/** Current in-flight reserved bytes (for the disk guard). */
export function getReservedBytes(): number

// --- Video GPS blanking (core/mp4-meta.js) ---

/** A byte range that was blanked (filled with spaces), for logging. */
export interface BlankedRegion {
  start: number
  end: number
  /** Which carrier: "©xyz" (legacy udta) or "mdta" (modern meta/keys/ilst). */
  type: string
}

/**
 * Blank both Apple GPS carriers in an MP4/QuickTime file IN PLACE (spaces over
 * the values, offsets unchanged). Returns the blanked regions ([] for a
 * GPS-free file, which is a byte-exact no-op). Never throws.
 */
export function blankVideoGps(filePath: string): BlankedRegion[]

// --- Media storage layout (core/media-storage.js) ---

/** Create tmp/quarantine/media upload directories at boot (mkdir -p). */
export function ensureUploadDirs(): void

/** Directory for one item: media/{key[0:2]}/{key}. */
export function itemDir(fileKey: string): string

/** Absolute path for a variant file: {itemDir}/{variant}.{ext}. */
export function variantDiskPath(fileKey: string, variant: string, ext: string): string

/** Move an item's directory into quarantine/ (recoverable by hand) instead of
 * deleting it. No-op when the directory doesn't exist. */
export function quarantineItemDir(fileKey: string): void

/** Content-Type for a storage extension (jpg -> image/jpeg, etc.). */
export function contentTypeForExt(ext: string): string

export interface ResolvedVariantFile {
  path: string
  ext: string
  contentType: string
}

/** Find an existing display/thumb/poster file (ext unknown), or null. */
export function resolveVariantFile(
  fileKey: string,
  variant: string,
): ResolvedVariantFile | null

/** True if a variant file exists on disk (original needs its DB ext). */
export function variantExistsOnDisk(
  fileKey: string,
  variant: string,
  originalExt: string | null,
): boolean

// --- Media serving (core/media-serve.js) ---

/**
 * Parse an HTTP Range header against a known size. Returns null (ignore, serve
 * 200), "invalid" (416), or a resolved { start, end } (inclusive) for 206.
 */
export function parseRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | null | "invalid"

/** Serve GET/HEAD /media/:fileKey/:variant with Range support. */
export function serveMedia(req: IncomingMessage, res: ServerResponse): void

// --- Media housekeeping (core/media-sweep.js) ---

/** Purge abandoned upload sessions + stale staging files. Returns counts. */
export function cleanAbandonedUploads(): { rowsDeleted: number; tmpDeleted: number }

/** Daily integrity pass: quarantine orphan files, log missing variants. */
export function runMediaIntegrityPass(): {
  quarantined: number
  missingVariants: number
  purged: number
}

/** Hourly maintenance entry point (runs the integrity pass every 24th tick). */
export function runMediaMaintenance(): void

// --- Generic override store (core/override-store.js) ---

/** True for a mergeable plain object (not array, not null). */
export function isPlainObject(v: unknown): v is Record<string, unknown>

/** Deep-merge a JSON override onto a clone of `base`: nested plain objects
 *  recurse, arrays/scalars/null replace wholesale, `undefined` is ignored,
 *  prototype keys are skipped. Returns a new object the same shape as `base`. */
export function deepMerge<T>(base: T, override: Record<string, unknown>): T

/** Sparse diff of `full` against `base` — only keys whose values differ are
 *  kept (nested objects recurse; arrays compared/stored wholesale), so
 *  unchanged keys still track future default edits. */
export function diffFromDefaults<T>(full: T, base: T): Record<string, unknown>

/** An app_state-backed override store: caches `defaults ⊕ stored override`,
 *  re-resolved on demand. `getOverride()` returns the raw parsed override (the
 *  sparse blob) for serving to the client; `get()` returns the merged value. */
export interface OverrideStore<T> {
  readonly key: string
  readonly defaults: T
  resolve(): T
  get(): T
  getOverride(): Record<string, unknown> | null
}

/** Build an OverrideStore over the given app_state `key` + shipped `defaults`.
 *  `onChanged` (if given) fires with the freshly-resolved value on each
 *  resolve() — used to rebuild derived caches. */
export function createOverrideStore<T>(
  key: string,
  defaults: T,
  onChanged?: (effective: T) => void,
): OverrideStore<T>

// --- Effect config schema (core/effect-config-schema.js) ---

/** The accepted value shape for one effect config key. `count` is a
 *  non-negative element/loop count (bounded to keep an override from hanging a
 *  visitor's browser); `numberArray` is a fixed-arity numeric range pair. */
export type EffectKeySpec =
  | { kind: "number"; min: number; max: number }
  | { kind: "count"; min: number; max: number }
  | { kind: "string" }
  | { kind: "numberArray"; min: number; max: number; minItems: number; maxItems: number }
  | { kind: "stringArray"; maxItems: number }

// --- Effect config store (core/effect-config.js) ---

/** Re-resolve the effect-config override from app_state (`effect_config`).
 *  Called at boot and after an admin save. Returns the sparse override map. */
export function resolveEffectConfig(): Record<string, unknown>

/** The raw sparse effect-config override map `{ [effectId]: Partial<config> }`,
 *  or null when no override is stored. Serialized into the page for the client's
 *  layered getEffectiveConfig. */
export function getEffectConfigOverride(): Record<string, unknown> | null
