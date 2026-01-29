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

export const SESSION: {
  readonly DURATION_MS: number
  readonly IDLE_TIMEOUT_MS: number
  readonly CSRF_ROTATION_MS: number
}

export const LIMITS: {
  readonly PARTY_SIZE_MIN: number
  readonly PARTY_SIZE_MAX: number
  readonly EMAIL_MAX_LENGTH: number
  readonly NAME_MAX_LENGTH: number
  readonly NOTES_MAX_LENGTH: number
  readonly MESSAGE_MAX_LENGTH: number
  readonly RELATIONSHIP_MAX_LENGTH: number
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

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string }

export function handleFatalError(reason: unknown): void
export function handleGracefulShutdown(signal: string): void
export function setupShutdownHandlers(): void

export function HashPassword(password: string): string
export function ValidatePasswordStrength(password: string): string | null
export function Prompt(question: string, hidden?: boolean): Promise<string>
export function OnData(char: string): void
export function Main(): Promise<void>
