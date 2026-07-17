/** @file Shared types for admin API endpoints */

import type { IncomingMessage, ServerResponse } from "node:http"
import type {
  AuthenticatedRouteInfo,
  WrappedHandler,
} from "../../core/types.js"
import type { Petition, PetitionStatus, BlocklistEntry } from "../../types.js"

/**
 * Sync handler that doesn't require route params.
 * @example
 * const handler: SyncHandler = (req, res) => { ... };
 */
export type SyncHandler = (req: IncomingMessage, res: ServerResponse) => void

/**
 * Async handler that doesn't require route params.
 * @example
 * const handler: AsyncHandler = async (req, res) => { ... };
 */
export type AsyncHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>

/**
 * Async handler that requires authentication but not route params.
 * @example
 * const handler: AuthedHandler = async (req, res, routeInfo) => { ... };
 */
export type AuthedHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
) => Promise<void>

/**
 * Async handler with route params.
 * @example
 * const handler: ParamsHandler = async (req, res, routeInfo) => { ... };
 */
export type ParamsHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
) => Promise<void>

/**
 * List handler for blocklist.
 * @example
 * await listHandler(req, res);
 */
export function listHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/**
 * Create handler for blocklist.
 * @example
 * await createHandler(req, res, routeInfo);
 */
export function createHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/**
 * Remove handler for blocklist.
 * @example
 * await removeHandler(req, res, routeInfo);
 */
export function removeHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

export const list: AsyncHandler
export const create: AuthedHandler
export const remove: ParamsHandler

/**
 * Input for checking if blocked.
 * @example
 * const input: IsBlockedInput = { email: 'test@example.com' };
 */
export interface IsBlockedInput {
  name?: string | null
  email?: string | null
  phone?: string | null
}

/**
 * Input for adding to blocklist.
 * @example
 * const input: AddToBlocklistInput = { email: 'block@example.com', reason: 'Spam' };
 */
export interface AddToBlocklistInput {
  name?: string | null
  email?: string | null
  phone?: string | null
  reason?: string | null
}

/**
 * Check if a person is blocked by name (fuzzy), email (exact), or phone (exact).
 * Returns the blocking entry if found, null otherwise.
 * @example
 * const entry = isBlocked({ email: 'blocked@example.com' });
 */
export function isBlocked(input: IsBlockedInput): BlocklistEntry | null

/**
 * Get all blocklist entries.
 * @example
 * const entries = getAllBlocklist();
 */
export function getAllBlocklist(): BlocklistEntry[]

/**
 * Add a person to the blocklist.
 * @example
 * const id = addToBlocklist({ email: 'block@example.com', reason: 'Spam' });
 */
export function addToBlocklist(input: AddToBlocklistInput): number

/**
 * Remove a person from the blocklist.
 * @example
 * const removed = removeFromBlocklist(1);
 */
export function removeFromBlocklist(id: number): boolean

/** @file Types for admin invite endpoints */

/**
 * Preview recipient.
 * @example
 * const recipient: PreviewRecipient = { id: 1, name: 'John', contact: 'john@example.com', messagePreview: '...' };
 */
export interface PreviewRecipient {
  id: number
  name: string
  contact: string | null
  messagePreview: string
}

/**
 * Preview skipped.
 * @example
 * const skipped: PreviewSkipped = { id: 1, name: 'John', reason: 'No email' };
 */
export interface PreviewSkipped {
  id: number
  name?: string
  reason: string
}

/**
 * Send result item.
 * @example
 * const item: SendResultItem = { id: 1, name: 'John' };
 */
export interface SendResultItem {
  id: number
  name: string
  error?: string
}

/**
 * Send skipped.
 * @example
 * const skipped: SendSkipped = { id: 1, name: 'John', reason: 'No phone' };
 */
export interface SendSkipped {
  id: number
  name?: string
  reason: string
}

/**
 * Send results.
 * @example
 * const results: SendResults = { sent: [], failed: [], skipped: [] };
 */
export interface SendResults {
  sent: SendResultItem[]
  failed: SendResultItem[]
  skipped: SendSkipped[]
}

/**
 * Config handler for invites.
 * @example
 * await configHandler(req, res);
 */
export function configHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/**
 * Preview handler for invites.
 * @example
 * await previewHandler(req, res);
 */
export function previewHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/**
 * Send handler for invites.
 * @example
 * await sendHandler(req, res, routeInfo);
 */
export function sendHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

export const config: AsyncHandler
export const preview: AsyncHandler
export const send: AuthedHandler

/** @file Types for admin petitions endpoints */

/**
 * List petitions handler.
 * @example
 * await listPetitions(req, res);
 */
export function listPetitions(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/**
 * GET /api/admin/petitions/counts — pending/approved/denied counts only (the
 * badge poll used to fetch the full pending list just to read one number).
 */
export function petitionCountsHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/**
 * Approve petition handler.
 * @example
 * await approvePetition(req, res, routeInfo);
 */
export function approvePetition(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/**
 * Deny petition handler.
 * @example
 * await denyPetition(req, res, routeInfo);
 */
export function denyPetition(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

export const list: AsyncHandler
export const approve: ParamsHandler
export const deny: ParamsHandler

/** @file moderation.js - Types for admin moderation endpoints (Phase 2: guestbook-only) */

/** GET /api/admin/moderation/queue?type=&limit=&offset= — pending items to review. */
export function moderationQueueHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/moderation/counts — pending counts per content type + total. */
export function moderationCountsHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/moderation/bulk — { action, items:[{type,id}] } in one txn. */
export function moderationBulkHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/moderation/approve-all — approve the entire pending backlog
 * (not just the client's loaded page) in one transaction. */
export function moderationApproveAllHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** @file accounts.js - Types for admin account-management endpoints (Phase 6) */

/** GET /api/admin/accounts?trusted=&limit=&offset= — accounts + counts + source. */
export function accountsListHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/accounts/:id/trust — trust (+ optional approve_pending backlog). */
export function accountTrustHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/accounts/:id/untrust — untrust (future content held). */
export function accountUntrustHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** DELETE /api/admin/accounts/:id — soft-delete + kill sessions + hide content. */
export function accountDeleteHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** @file media.js (admin) - Types for curated-gallery management (Phase 6) */

/** POST /api/admin/media/reorder — { ids:number[] } → sort_order = index. */
export function mediaReorderHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/media/:id/promote — MOVE an approved guest item to official. */
export function mediaPromoteHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** PATCH /api/admin/media/:id — { caption } inline caption edit. */
export function mediaCaptionHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** DELETE /api/admin/media/:id — soft-delete any media + unlink files. */
export function mediaDeleteHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/**
 * Input for creating a petition.
 * @example
 * const input: CreatePetitionInput = { name: 'John', email: 'john@example.com' };
 */
export interface CreatePetitionInput {
  name: string
  email: string
  phone?: string | null
  relationship?: string | null
  message?: string | null
}

/**
 * Options for getAllPetitions.
 * @example
 * const options: GetAllPetitionsOptions = { status: 'pending' };
 */
export interface GetAllPetitionsOptions {
  status?: PetitionStatus
}

/**
 * Options for countPetitions.
 * @example
 * const options: CountPetitionsOptions = { status: 'pending' };
 */
export interface CountPetitionsOptions {
  status?: PetitionStatus
}

/**
 * Result from COUNT(*) query.
 * @example
 * const result: CountResult = { count: 10 };
 */
export interface CountResult {
  count: number
}

/**
 * Options for approvePetition.
 * @example
 * const options: ApprovePetitionOptions = { partySize: 2, adminNotes: 'Approved' };
 */
export interface ApprovePetitionOptions {
  partySize?: number
  adminNotes?: string | null
}

/**
 * Result of approvePetition.
 * @example
 * const result: ApprovePetitionResult = { id: 1, invite_code: 'ABC123' };
 */
export interface ApprovePetitionResult {
  id: number | bigint
  invite_code: string
}

/**
 * Create a new petition.
 * @example
 * const id = createPetition({ name: 'John Doe', email: 'john@example.com' });
 */
export function createPetition(input: CreatePetitionInput): number | bigint

/**
 * Get a petition by ID.
 * @example
 * const petition = getPetitionById(1);
 */
export function getPetitionById(id: number): Petition | undefined

/**
 * Get a pending petition by email.
 * @example
 * const petition = getPetitionByEmail('john@example.com');
 */
export function getPetitionByEmail(email: string): Petition | undefined

/**
 * Get the most recent petition for an email regardless of status (used to tell
 * a returning guest whether their request is pending/denied, not just pending).
 */
export function getLatestPetitionByEmail(email: string): Petition | undefined

/**
 * Get all petitions with optional status filter.
 * @example
 * const petitions = getAllPetitions({ status: 'pending' });
 */
export function getAllPetitions(options?: GetAllPetitionsOptions): Petition[]

/**
 * Count petitions with optional status filter.
 * @example
 * const count = countPetitions({ status: 'pending' });
 */
export function countPetitions(options?: CountPetitionsOptions): number

/**
 * Update petition status and admin notes.
 * @example
 * const updated = updatePetitionStatus(1, 'denied', 'Not invited');
 */
export function updatePetitionStatus(
  id: number,
  status: PetitionStatus,
  adminNotes?: string | null,
): boolean

/**
 * Approve a petition atomically: create guest and update petition status.
 * @example
 * const { id, invite_code } = approvePetitionDb(1, { partySize: 2 });
 */
export function approvePetitionDb(
  petitionId: number,
  options?: ApprovePetitionOptions,
): ApprovePetitionResult

/**
 * RSVP list handler.
 * @example
 * RSVPListHandler(req, res);
 */
export function RSVPListHandler(req: IncomingMessage, res: ServerResponse): void

/**
 * RSVP export handler.
 * @example
 * RSVPExportHandler(req, res);
 */
export function RSVPExportHandler(
  req: IncomingMessage,
  res: ServerResponse,
): void

export const list: SyncHandler
export const exportCSV: SyncHandler

/**
 * Login handler.
 * @example
 * await login(req, res);
 */
export function login(req: IncomingMessage, res: ServerResponse): Promise<void>

/**
 * Logout handler.
 * @example
 * await logout(req, res);
 */
export function logout(req: IncomingMessage, res: ServerResponse): Promise<void>
