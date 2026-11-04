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

/** GET /api/admin/media/guest-loved — approved GUEST media ranked by total
 *  reaction count, each with its `reaction_count` (A3 "Most loved" curation).
 *  Optional ?limit (default 60, max 200). */
export function adminGuestLovedHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/media/curated?section= — every live row of a curated section,
 *  any status, in order: the set reorder accepts, which the public feed is not. */
export function adminCuratedListHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/media/capacity — stored bytes, the caps, and what still fits. */
export function adminMediaCapacityHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/media/reorder — { ids:number[], section?: "official" |
 *  "honeymoon" } → sort_order = index within that curated section (default
 *  official, so older callers keep working). */
export function mediaReorderHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/media/:id/section — { section: "official" | "honeymoon" }:
 *  MOVE a curated item into the other curated section, appended at the end. */
export function mediaSectionMoveHandler(
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

/** GET /api/admin/media/:id/references — thank-you card reference counts for
 *  this photo (pre-confirm warning that removal strips it from sent cards). */
export function mediaReferencesHandler(
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

/** @file thank-you.js (admin) - Types for gift log + digital thank-you card
 *  management + delivery endpoints (Phase 5/6). Named adminGift... /
 *  adminThankYou... (this namespace is flat across every api/admin/*.js
 *  module, and there's already a `list`/`create`/`send`/`config` bound
 *  elsewhere above). */

/** GET /api/admin/gifts — full gift log, joined guest name + latest linked
 *  card status. */
export function adminGiftsListHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/gifts — { guest_id, description?, amount?, notes?, received_at? }. */
export function adminGiftCreateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** PUT /api/admin/gifts/:id — partial update of the same fields. */
export function adminGiftUpdateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** DELETE /api/admin/gifts/:id — soft-delete. */
export function adminGiftDeleteHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/gifts/:id/physical-card — { sent: boolean }. */
export function adminGiftPhysicalCardHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** GET /api/admin/thank-you/export/gifts.csv — full gift ledger as CSV (sunset
 *  archive parity with `npm run export`). */
export function adminGiftsExportHandler(
  req: IncomingMessage,
  res: ServerResponse,
): void

/** GET /api/admin/thank-you/export/cards.csv — thank-you cards (incl. latest
 *  reply) as CSV. */
export function adminThankYouExportHandler(
  req: IncomingMessage,
  res: ServerResponse,
): void

/** GET /api/admin/thank-you — admin card list, joined guest name. */
export function adminThankYouListHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/thank-you/:id — single card, joined guest name. */
export function adminThankYouGetHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/thank-you — create a draft card; validates guest exists,
 *  message length, theme allowlist, effects_config JSON + byte cap,
 *  media_keys resolvability + count cap. */
export function adminThankYouCreateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** PUT /api/admin/thank-you/:id — draft-only edit (409 once sent/viewed). */
export function adminThankYouUpdateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** DELETE /api/admin/thank-you/:id — soft-delete (any status). */
export function adminThankYouDeleteHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/thank-you/:id/reply-seen — acknowledge the reply (clears
 *  the unread badge/digest gate for this card). */
export function adminThankYouReplySeenHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** GET /api/admin/thank-you/counts — { unreadReplies, drafts } for the tab badge. */
export function adminThankYouCountsHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/thank-you/replies — recent replies across ALL cards, newest
 *  first (the Inbox + Mailbox feed). Optional ?limit (default 50, max 200). */
export function adminThankYouRecentRepliesHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/thank-you/config — channel availability + default templates +
 *  the opt-in first-reply ping flag (replyPingEnabled). */
export function adminThankYouConfigHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/thank-you/config — { replyPingEnabled: boolean }; toggles the
 *  opt-in instant first-reply ping (app_state flag). */
export function adminThankYouSetConfigHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/thank-you/cards/:id/clear-reply — wipe the card's reply
 *  surface columns (history rows retained). Returns the updated card. */
export function adminThankYouClearReplyHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** A guest's approved content + gift/card ledger for the composer sidecar. */
export interface GuestStoryResponse {
  guest: { id: number; name: string }
  rsvpNote: string | null
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
    status: string
    sentAt: string | null
    viewedAt: string | null
    repliedAt: string | null
    replySeen: boolean
  }>
}

/** GET /api/admin/guests/:id/story — composer sidecar / guest detail panel. */
export function adminThankYouGuestStoryHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** GET /api/admin/guests/:id/photos — "Photos they're in": approved gallery
 *  media with a named face linked to this guest → `{ items: GuestPhoto[] }`. */
export function adminThankYouGuestPhotosHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/thank-you/preview — { cardId, type, customMessage? } →
 *  resolved recipient + message preview (or a skip reason). */
export function adminThankYouPreviewHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/thank-you/send — { cardId, type, customMessage? }; draft-only
 *  (409 once sent), rate-limited on the admin session token. */
export function adminThankYouSendHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/thank-you/:id/mark-sent — { via?: 'manual' | 'link' };
 *  copy-paste/copy-link delivery path (no communications-table log — that
 *  table's type enum is email|sms only; the audit log is the record here). */
export function adminThankYouMarkSentHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/thank-you/:id/resend — reset an unopened card to draft (same
 *  token) → { mode: 'reset', card }, or clone an opened card to a fresh draft
 *  (new token, original intact) → { mode: 'duplicate', card }. 409 for a draft. */
export function adminThankYouResendHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

export const listGifts: SyncHandler
export const createGift: AuthedHandler
export const updateGift: AuthedHandler
export const deleteGift: AuthedHandler
export const togglePhysicalCard: AuthedHandler
export const listCards: SyncHandler
export const getCard: AuthedHandler
export const createCard: AuthedHandler
export const updateCard: AuthedHandler
export const deleteCard: AuthedHandler
export const markReplySeen: AuthedHandler
export const clearReply: AuthedHandler
export const guestStory: AuthedHandler
export const counts: SyncHandler
export const sendConfig: SyncHandler
export const setConfig: AuthedHandler
export const sendPreview: SyncHandler
export const send: AuthedHandler
export const markSentManual: AuthedHandler
export const resendCard: AuthedHandler

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

/** @file people.js - Types for admin people endpoints (the photographed cast
 *  face tagging assigns to). Duplicate display names are legal; merge exists
 *  because of it; created_by/actors always derive from the admin session. */

/** GET /api/admin/people — every live person, display-name order, with the
 *  linked guest's name (null off-roster) and live identity/face counts.
 *  `?faces=<personId>` adds `personFaces: { personId, faces, total }` — that
 *  person's newest live faces as chips (capped), for the People page's grid. */
export function peopleListHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/people — { displayName, guestId?, notes?, confirmDuplicate? }.
 *  Refuses (409) a same-name create unless confirmDuplicate is true, naming the
 *  existing people, so creation is never a side effect of typing. */
export function personCreateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** PATCH /api/admin/people/:id — { displayName?, guestId?, notes? }. guestId is
 *  three-state: absent = untouched, null = unlink, number = link. */
export function personUpdateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/people/merge — { fromPersonId, intoPersonId }: fold one
 *  person into another. A merge is a fact about IDENTITIES: the source
 *  identity gets `merged_into` and is retired, no per-face event is written,
 *  and `resolveIdentity` reads through the redirect so every historical
 *  assignment still names what it named. Prototypes are computed on demand, so
 *  the redirect IS the rebuild. */
export function personMergeHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** DELETE /api/admin/people/:id — soft delete. Refuses (409, with a message
 *  the UI shows verbatim) while live identities still reference the person. */
export function personDeleteHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** @file faces.js - Types for admin face-assignment endpoints
 *  (docs/post-wedding/SPEC-vision-lab.md §10/§15). Clusters/matches are computed
 *  on demand, never persisted — see that file's module comment. */

/** A face box in source-image pixels, as every route below returns it. */
export interface FaceBoxOut {
  x: number
  y: number
  w: number
  h: number
}

/** GET /api/admin/faces/overview — tile counts + live groups over unidentified
 *  faces, largest first, each with a prototype-match suggestion when at least
 *  one identity is confirmed.
 *
 *  Each group carries its faces in TWO arrays. `media` (whose ids are
 *  `faceIds`) is what a bulk confirm may name; `setAsideMedia` is the members
 *  routing held back — shown by the review view's filmstrip, dimmed, and
 *  nameable only one at a time through `assign-one`. Keeping them apart is what
 *  makes "a bulk action can never name a face the admin was not shown as
 *  bulk-nameable" a property of the payload rather than of a client's
 *  filtering. `weld` is an ORDERING score only — see faces.js's `weldRisk` for
 *  why it is never rendered as a warning. */
/*  Each group also carries `candidates`: the nearest people from matchFace,
 *  nearest first, NO bar applied — the picker's numbered alternatives, never a
 *  suggestion. `?face=<id>` adds `anchor: { faceId, mediaId, state, personId,
 *  personName }` (state: unnamed | named | not_a_face | gone), so a deep link
 *  to a face that has left every group can say why. */
export function faceOverviewHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/faces/queue — the "ask" queue: unidentified faces with at
 *  least one candidate prototype, ranked by `unlocks` (distinct photos that
 *  would gain a name if this face were confirmed). Capped, `truncated` says so. */
export function faceQueueHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/faces/assign — { faceIds: number[], personId } → find-or-create
 *  a CONFIRMED identity for the person and append one `assign` event per face,
 *  one txn. Assigning by name is not an API shape.
 *
 *  BULK: refuses any face id whose `route_state` is `set_aside`, so an action
 *  over a group can never touch a face the queue did not show. Ungraded
 *  (`route_state IS NULL`) rows are allowed — that means "not yet graded", not
 *  "rejected". Use `assign-one` for a face the routing held back.
 *
 *  Returns `batchId`: every bulk mutation is one revocable `manual` batch, so
 *  naming a welded group by mistake is one revocation rather than N undos. */
export function faceAssignHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/faces/unassign — { faceIds: number[] } → append one `clear`
 *  event per face, in one revocable `manual` batch (`batchId` in the response).
 *  The earlier assign stays on record; clearing appends, never overwrites. */
export function faceUnassignHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/faces/not-a-face — { faceIds: number[] } → append one
 *  `not_a_face` event per face, in one revocable `manual` batch. The soft
 *  delete is that event's PROJECTION, so revoking the batch brings the rows
 *  back — a bulk dismissal is no longer a one-way door. */
export function faceNotAFaceHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** POST /api/admin/faces/assign-one — { faceId, personId | null } → the
 *  single-face escape hatch from the per-photograph view.
 *
 *  The ONE path that may name a `set_aside` face, and deliberately so: without
 *  it the routing filter would be a one-way door rather than a filter on
 *  attention, and a face the admin is looking straight at could not be named.
 *  Exactly one id, no group and no server-side selection, so a client bug costs
 *  one row. `personId: null` clears, making this its own undo — which is also
 *  why its event carries NO batch: a batch of one says nothing the event does
 *  not, and this route is already its own reversal. */
export function faceAssignOneHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** GET /api/admin/faces/propagations — must-link proposals: identities that
 *  could be carried onto an unidentified face in a near-duplicate frame.
 *  PROPOSALS only; nothing is applied by reading this. */
export function facePropagationsHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/faces/propagate — { toFaceIds: number[] } → apply those
 *  proposals. Each target gets a second-class `provenance='propagated'`
 *  identity for the same person, never the confirmed one, so a propagation can
 *  never seed a prototype. Proposals are re-derived server-side; a face that
 *  is no longer proposed is refused, not humoured.
 *
 *  Returns `batchId`, and this is the route the batch mechanism exists for: a
 *  bulk pass over MACHINE proposals, revocable wholesale. Revoking it later
 *  leaves any face a human has since corrected exactly as they left it. */
export function facePropagateHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** GET /api/admin/faces/batches — the assignment ledger's batch history,
 *  newest first, `?limit=` clamped to the server's ceiling.
 *
 *  Ids, kinds, actors, timestamps and counts. No face ids, no person names,
 *  nothing about a photograph: a list of DECISIONS, not of who they were about.
 *  Revoked batches are included — the list exists so an admin can find the pass
 *  that went wrong, and "already revoked, by whom, when" is part of that. */
export function faceBatchesHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/admin/faces/revoke — { batchId } → flag the batch revoked and
 *  re-project every face it touched. Returns `reprojected` (how many), the
 *  batch `kind`, `revokedAt`/`revokedBy`, and `alreadyRevoked`.
 *
 *  The route the batch mechanism exists for: without it, revocation was
 *  reachable only by importing `revokeBatch` into a test process. Revocation is
 *  a FLAG, not a compensating event, so a face an admin corrected by hand after
 *  the pass keeps that correction — the re-projection replays its history with
 *  the batch's events skipped, and the later manual event still wins.
 *
 *  The actor is the session's, never the body's. Re-revoking is permitted and
 *  is a bare re-projection: the original `revoked_at`/`revoked_by` stand (a
 *  schema trigger refuses to re-date them) and `alreadyRevoked` says so.
 *  Un-revoking is not offered, and cannot be: nothing would re-derive the
 *  projections on the way back, so reinstating a pass means running it again.
 *
 *  ⚠ The one write path in this module that opens NO transaction of its own —
 *  `revokeBatch` owns one and neither db/utils.js helper nests. */
export function faceRevokeHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

/** One photograph in GET /api/admin/faces/set-aside. Counts only — nothing here
 *  describes what the photograph shows. */
export interface SetAsidePhotoOut {
  mediaId: number
  fileKey: string
  /** Live faces on it graded `set_aside`. */
  setAsideFaces: number
  /** How many of those are still unnamed — the number that shrinks as the work
   *  is done, since naming a face never re-grades it. */
  unnamedSetAside: number
  /** Every live face on the photograph, ungraded ones included. */
  liveFaces: number
}

/** GET /api/admin/faces/set-aside — the photographs holding at least one live
 *  `set_aside` face, media id ascending, `?limit=&offset=` paged (defaults and
 *  ceiling from PAGINATION; the applied values come back in the response).
 *
 *  The only list in this file whose rows are PHOTOGRAPHS. It exists because
 *  every face list here filters `set_aside` out, so a photograph whose faces are
 *  all set aside — or all already named — appeared in none of them, nothing
 *  rendered an "Open photo" button for it, and `assignOne` was unreachable for
 *  its faces however deliberately the exemption had been built.
 *
 *  Ungraded faces (`route_state IS NULL`) never make a row on their own: they
 *  are shown and bulk-assignable already. They are still counted in `liveFaces`,
 *  so a row never understates the photograph. */
export function faceSetAsideHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/admin/media/:id/faces — EVERY live face in one photograph: the
 *  `chipOf` shape (faceId, mediaId, fileKey, original-pixel width/height, box)
 *  plus `personId`/`personName` (null when unidentified), `identityId`,
 *  `provenance` and `routeState`.
 *
 *  The only face list here that routing does not filter. `set_aside` faces and
 *  ungraded ones (`routeState: null`) both come back, because this is the view
 *  that makes them nameable through `assignOne` — filtering here would close
 *  the escape hatch the exemption exists for. `provenance` separates a name a
 *  human confirmed from one propagation carried across a near-duplicate frame. */
export function faceForMediaHandler(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AuthenticatedRouteInfo,
): Promise<void>

export const overview: SyncHandler
export const queue: SyncHandler
export const assign: AuthedHandler
export const unassign: AuthedHandler
export const notAFace: AuthedHandler
export const forMedia: ParamsHandler
