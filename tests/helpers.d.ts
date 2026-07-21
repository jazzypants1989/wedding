/** @file Types for integration test helpers */

import type { DatabaseSync } from "node:sqlite"
import type {
  Guest,
  Petition,
  BlocklistEntry,
  GuestStatus,
  RSVP,
} from "../core/db/types.ts"

export type ApiData<T extends object = Record<string, unknown>> = T

export interface HealthResponse {
  status: string
  timestamp: string
}

export interface RSVPGetResponse {
  guest: Guest
  rsvp: RSVP | null
}

export interface RSVPPostResponse {
  success: boolean
  error?: string
}

export interface ErrorResponse {
  error: string
}

export interface StatsResponse {
  stats: {
    total_guests: number
    responded: number
    attending_yes: number
    [key: string]: unknown
  }
}

export interface GuestListResponse {
  guests: Guest[]
  pagination: { total: number; [key: string]: unknown }
}

export interface GuestResponse {
  guest: Guest
}

export interface PetitionResponse {
  success: boolean
  guest?: Guest
  error?: string
}

export interface BlocklistResponse {
  blocklist: BlocklistEntry[]
}

export interface BlocklistCreateResponse {
  id: number | bigint
}

export interface RSVPListResponse {
  rsvps: RSVP[]
}

export interface InvitableIdsResponse {
  guestIds: number[]
  pending: number
  invited: number
}

export interface PetitionListResponse {
  petitions: Petition[]
}

export interface ImportResponse {
  added: number
  skipped: { row: number; reason: string }[]
  errors: { row: number; error: string }[]
}

export interface ConfigResponse {
  sms: object
  email: object
}

export interface LookupBlockedResponse {
  found: boolean
  canPetition: boolean
}

export interface ManualSmsGuestsResponse {
  guests: { invite_code: string; [key: string]: unknown }[]
  defaultTemplate: unknown
  wedding: { date: unknown; location: unknown; [key: string]: unknown }
}

export interface ManualSmsMarkSentResponse {
  success: boolean
  guest: { id: number; status: string; [key: string]: unknown }
}

export interface ManualSmsBatchResponse {
  success: boolean
  summary: { sent: number; failed: number }
  results: {
    sent: unknown[]
    failed: { error: string; [key: string]: unknown }[]
  }
}

export const TEST_PORT: number
export const BASE_URL: string
/** Path to the per-run temp DB; dirname() is the server's data/uploads root. */
export const TEST_DB_PATH: string
/** Directory the spawned server writes its JSONL audit log to. */
export const TEST_AUDIT_DIR: string
/** Read every audit-log entry written so far, oldest first. */
export function readAuditLog(): Array<Record<string, any>>

export type StartServerFn = () => Promise<void>
export type StopServerFn = () => Promise<void>
export type GetTestDbFn = () => DatabaseSync

export interface TestGuestOverrides {
  invite_code?: string
  name?: string
  email?: string
  phone?: string | null
  party_size?: number
  status?: GuestStatus
  notes?: string | null
}

export interface TestGuest extends TestGuestOverrides {
  id: number | bigint
  name: string
  email: string
  phone: string | null
  party_size: number
  invite_code: string
  status: GuestStatus
  notes: string | null
}

export interface TestPetitionOverrides {
  name?: string
  email?: string
  phone?: string | null
  relationship?: string
  message?: string
  status?: string
}

export interface TestPetition extends TestPetitionOverrides {
  id: number | bigint
  name: string
  email: string
  phone: string | null
  relationship: string
  message: string
  status: string
}

export interface BlocklistOverrides {
  name?: string | null
  email?: string | null
  phone?: string | null
  reason?: string
}

export interface TestBlocklistEntry extends BlocklistOverrides {
  id: number | bigint
  name: string | null
  email: string | null
  phone: string | null
  reason: string
}

export interface AdminAuth {
  sessionCookie: string
  csrfCookie: string
  csrfToken: string
  cookieHeader: string
}

export interface AdminFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type CreateTestGuestFn = (
  db: DatabaseSync,
  overrides?: TestGuestOverrides
) => TestGuest
export type DeleteTestGuestFn = (db: DatabaseSync, inviteCode: string) => void
export type CreateTestPetitionFn = (
  db: DatabaseSync,
  overrides?: TestPetitionOverrides
) => TestPetition
export type DeleteTestPetitionFn = (
  db: DatabaseSync,
  id: number | bigint
) => void
export type AddToBlocklistFn = (
  db: DatabaseSync,
  overrides?: BlocklistOverrides
) => TestBlocklistEntry
export type RemoveFromBlocklistFn = (
  db: DatabaseSync,
  id: number | bigint
) => void
export type AdminLoginFn = (password?: string) => Promise<AdminAuth>
export type AdminFetchFn = (
  path: string,
  options: AdminFetchOptions,
  auth: AdminAuth
) => Promise<Response>
export type CleanupTestDataFn = (db: DatabaseSync) => void

export interface TestAccountOverrides {
  guest_id?: number | bigint | null
  name?: string
  relation?: string | null
  contact_email?: string | null
  trusted?: 0 | 1
}

export interface TestAccount {
  id: number | bigint
  guest_id: number | bigint | null
  name: string
  name_normalized: string
  relation: string | null
  contact_email: string | null
  trusted: 0 | 1
}

export interface AccountSessionAuth {
  token: string
  csrfToken: string | null
  cookieHeader: string | null
}

/** Minimal auth shape accountFetch needs (register results & session factories both satisfy it). */
export interface AccountFetchAuth {
  csrfToken: string | null
  cookieHeader: string | null
}

export interface AccountRegisterResult {
  status: number
  data: Record<string, unknown>
  csrfToken: string | null
  cookieHeader: string | null
}

export type CreateTestAccountFn = (
  db: DatabaseSync,
  overrides?: TestAccountOverrides
) => TestAccount
export type CreateTestAccountSessionFn = (
  db: DatabaseSync,
  accountId: number | bigint
) => { token: string; csrfToken: string; cookieHeader: string }
export type AccountRegisterFn = (
  body: Record<string, unknown>,
  options?: { ip?: string }
) => Promise<AccountRegisterResult>
export type AccountFetchFn = (
  path: string,
  options: AdminFetchOptions,
  auth: AccountFetchAuth
) => Promise<Response>

export const startServer: StartServerFn
export const stopServer: StopServerFn
export function startAuxServer(
  extraEnv: Record<string, string>,
  port: number,
): Promise<{ baseUrl: string; stop: () => Promise<void> }>
export const getTestDb: GetTestDbFn
export const createTestGuest: CreateTestGuestFn
export const deleteTestGuest: DeleteTestGuestFn
export const createTestPetition: CreateTestPetitionFn
export const deleteTestPetition: DeleteTestPetitionFn
export const addToBlocklist: AddToBlocklistFn
export const removeFromBlocklist: RemoveFromBlocklistFn
export const adminLogin: AdminLoginFn
export const adminFetch: AdminFetchFn
export const cleanupTestData: CleanupTestDataFn
export const createTestAccount: CreateTestAccountFn
export const createTestAccountSession: CreateTestAccountSessionFn
export const accountRegister: AccountRegisterFn
export const accountFetch: AccountFetchFn
