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

interface AuditEvent {
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
  adminLogin: RateLimiter
  adminInvite: RateLimiter
  accountRegister: RateLimiter
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

import type { GuestStatus, CommunicationType, ValidationResult } from "../types.js"

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
  handler: RouteHandler,
  options?: { errorHandling?: boolean },
): void

/** Implementation signature for route() — used by @type in router.js */
export type routeImpl = (
  method: string,
  pattern: string,
  handler: RouteHandler | AdminHandler,
  options?: RouteOptions,
) => void
export function clearRoutes(): void
export function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean>
