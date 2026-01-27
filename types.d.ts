/** @file Types for application-wide constants */

export interface GuestStatusMap {
  readonly PENDING: "pending"
  readonly INVITED: "invited"
  readonly RESPONDED: "responded"
}

export interface PetitionStatusMap {
  readonly PENDING: "pending"
  readonly APPROVED: "approved"
  readonly DENIED: "denied"
}

export interface CommunicationTypeMap {
  readonly EMAIL: "email"
  readonly SMS: "sms"
}

export interface CommunicationStatusMap {
  readonly SENT: "sent"
  readonly FAILED: "failed"
}

export interface SessionConfig {
  readonly DURATION_MS: number
  readonly IDLE_TIMEOUT_MS: number
  readonly CSRF_ROTATION_MS: number
}

export interface Limits {
  readonly PARTY_SIZE_MIN: number
  readonly PARTY_SIZE_MAX: number
  readonly EMAIL_MAX_LENGTH: number
  readonly NAME_MAX_LENGTH: number
  readonly NOTES_MAX_LENGTH: number
  readonly MESSAGE_MAX_LENGTH: number
  readonly RELATIONSHIP_MAX_LENGTH: number
}

export interface WeddingInfo {
  readonly COUPLE_NAMES: string
  readonly COUPLE_FIRST_NAMES: string
  readonly DATE: string
  readonly DATE_SHORT: string
  readonly LOCATION: string
  readonly VENUE: string
}

export interface EmailSubjects {
  readonly INVITE: string
  readonly REMINDER: string
}

export interface RateLimitConfig {
  readonly windowMs: number
  readonly max: number
}

export interface RateLimits {
  readonly RSVP: RateLimitConfig
  readonly LOOKUP: RateLimitConfig
  readonly ADMIN_LOGIN: RateLimitConfig
  readonly ADMIN_INVITE: RateLimitConfig
}

export interface RequestLimits {
  readonly MAX_BODY_SIZE: number
  readonly REQUEST_TIMEOUT_MS: number
}

export interface Pagination {
  readonly DEFAULT_PAGE_SIZE: number
  readonly MAX_PAGE_SIZE: number
}

export interface Brand {
  readonly PRIMARY_COLOR: string
  readonly SECONDARY_COLOR: string
  readonly BACKGROUND_COLOR: string
}

export const GUEST_STATUS: GuestStatusMap
export const PETITION_STATUS: PetitionStatusMap
export const COMMUNICATION_TYPE: CommunicationTypeMap
export const COMMUNICATION_STATUS: CommunicationStatusMap
export const SESSION: SessionConfig
export const LIMITS: Limits
export const WEDDING: WeddingInfo
export const EMAIL_SUBJECTS: EmailSubjects
export const RATE_LIMITS: RateLimits
export const REQUEST_LIMITS: RequestLimits
export const PAGINATION: Pagination
export const BRAND: Brand

export const GUEST_STATUS_VALUES: readonly ["pending", "invited", "responded"]
export const PETITION_STATUS_VALUES: readonly ["pending", "approved", "denied"]
export const COMMUNICATION_TYPE_VALUES: readonly ["email", "sms"]

export type GuestStatus = "pending" | "invited" | "responded"
export type PetitionStatus = "pending" | "approved" | "denied"
export type CommunicationType = "email" | "sms"
export type CommunicationStatus = "sent" | "failed"

export function isGuestStatus(value: unknown): value is GuestStatus
export function isPetitionStatus(value: unknown): value is PetitionStatus
export function isCommunicationType(value: unknown): value is CommunicationType

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
  [key: string]: string | number | null
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

export const PROJECT_ROOT: string
export const PORT: string | number
export const ADMIN_PASSWORD_HASH: string | undefined
export const BASE_URL: string
export const CONTACT_EMAIL: string
export const TRUSTED_PROXIES: string[]

/**
 * Validation result types
 * Discriminated union pattern for type-safe validation handling
 */


// Generic validation result - discriminated union
export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string }

// Service configuration check (no value returned)
export type ServiceConfiguredResult =
  | { valid: true }
  | { valid: false; error: string }

// Specific validation result aliases for clarity
export type PartySizeResult = ValidationResult<number>
export type EmailResult = ValidationResult<string | null>
export type PhoneResult = ValidationResult<string | null>
export type IdResult = ValidationResult<number>
export type IdArrayResult = ValidationResult<number[]>
export type InviteCodeResult = ValidationResult<string>
export type RequiredStringResult = ValidationResult<string>
export type GuestStatusResult = ValidationResult<GuestStatus>
export type CommunicationTypeResult = ValidationResult<CommunicationType>

// Optional string always succeeds
export type OptionalStringResult = { valid: true; value: string | null }

// Validation function options
export interface EmailValidationOptions {
  required?: boolean
}

export interface PhoneValidationOptions {
  required?: boolean
}

/**
 * Database entity types
 * These match the SQLite schema in server/core/db/schema.js
 */

// Database row types
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

// Query option types
export interface GetGuestsOptions {
  status?: GuestStatus
  search?: string
  limit?: number
  offset?: number
  includeDeleted?: boolean
  onlyDeleted?: boolean
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

export function handleFatalError(reason: unknown): void
export function handleGracefulShutdown(signal: string): void
export function setupShutdownHandlers(): void

/** @file setup-admin.js - Types for admin password setup script */

export function HashPassword(password: string): string

export function ValidatePasswordStrength(password: string): string | null

export function Prompt(question: string, hidden?: boolean): Promise<string>

export function OnData(char: string): void

export function Main(): Promise<void>
