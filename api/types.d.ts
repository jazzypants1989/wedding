import type { IncomingMessage, ServerResponse } from "node:http"
import type { RSVP, RSVPWithGuest, Stats, PetitionStatus } from "./types.js"
import type { RouteInfo, AccountRouteInfo } from "../core/types.js"

/** @file health.js - Types for health check endpoint */

export function getHealth(req: IncomingMessage, res: ServerResponse): void

/** @file config.js - Types for public config endpoint */

export interface PublicConfig {
  features: {
    enableNameLookup: boolean
    enableEmailLookup: boolean
  }
  /** Reply-to / contact address surfaced to guests (gallery report mailto). */
  contactEmail: string
  /** Timeline mode + couple display name for client-side use. */
  mode: string
  coupleDisplay: string
  /** Guestbook display options from site content. */
  guestbook: {
    showFavorites: boolean
  }
  /** Public "moments shared" tally (approved guest photos + guestbook notes). */
  counts: {
    photos: number
    notes: number
  }
}

export function getConfig(req: IncomingMessage, res: ServerResponse): void

/** @file setup.js - Types for first-run onboarding endpoints */

export function status(req: IncomingMessage, res: ServerResponse): Promise<void>
export function submit(req: IncomingMessage, res: ServerResponse): Promise<void>

/** @file lookup.js - Types for guest lookup and petition endpoints */

/**
 * Send not found response, optionally carrying the caller's prior petition
 * status so the client can show accurate copy (pending/denied/none).
 * @example
 * notFoundResponse(res);
 * notFoundResponse(res, "denied");
 */
export function notFoundResponse(
  res: ServerResponse,
  petitionStatus?: PetitionStatus | null,
): void

/**
 * Lookup guest handler.
 * @example
 * await lookup(req, res);
 */
export function lookup(req: IncomingMessage, res: ServerResponse): Promise<void>

/**
 * Petition handler.
 * @example
 * await petition(req, res);
 */
export function petition(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** @file rsvp.js - Types for RSVP endpoints & RSVP database operations */

export function get(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

export function post(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** Input for upserting an RSVP */
export interface UpsertRsvpInput {
  attending: boolean
  actual_party_size: number | null
  dietary_restrictions: string | null
  additional_info?: string | null
  message: string | null
}

/** Options for getAllRsvps */
export interface GetAllRsvpsOptions {
  includeDeleted?: boolean
}

/**
 * Get an RSVP by guest ID.
 * @example
 * const rsvp = getRsvpByGuestId(1);
 */
export function getRsvpByGuestId(guestId: number): RSVP | undefined

/**
 * Create or update an RSVP for a guest.
 * @example
 * const success = upsertRsvp(1, { attending: true, actual_party_size: 2 });
 */
export function upsertRsvp(guestId: number, input: UpsertRsvpInput): boolean

/**
 * Get all RSVPs with guest information.
 * @example
 * const rsvps = getAllRsvps();
 * const rsvps = getAllRsvps({ includeDeleted: true });
 */
export function getAllRsvps(options?: GetAllRsvpsOptions): RSVPWithGuest[]

/**
 * Get RSVP statistics.
 * @example
 * const stats = getStats();
 */
export function getStats(): Stats

/** @file account.js - Types for guest account endpoints */

import type { Account } from "./types.js"

/** Public projection of an account safe to return in API responses. */
export interface PublicAccount {
  id: number
  name: string
  relation: string | null
  trusted: 0 | 1
}

export function publicAccount(account: Account): PublicAccount

/** POST /api/account/register — trusted claim / re-login / untrusted open signup. */
export function register(req: IncomingMessage, res: ServerResponse): Promise<void>

/** POST /api/account/logout — clears guest cookies, deletes session; 200 always. */
export function logout(req: IncomingMessage, res: ServerResponse): Promise<void>

/** GET /api/account/me — cheap whoami; { account } or { account: null }, never 401. */
export function me(req: IncomingMessage, res: ServerResponse): Promise<void>

/** POST /api/account/recover — magic-link request; always 200 (no existence oracle). */
export function recover(req: IncomingMessage, res: ServerResponse): Promise<void>

/** GET /api/account/recover/:token — redeem a one-time link → session + 302 /guestbook. */
export function recoverConsume(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** @file guestbook.js - Types for public guestbook endpoints */

/** GET /api/guestbook — public keyset feed; interleaves the caller's own pending entries. */
export function guestbookList(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** GET /api/guestbook/:id — a single visible entry (public); powers ?entry= deep links. */
export function guestbookGetOne(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** POST /api/guestbook — sign the guestbook (withAccount); hybrid moderation on trust. */
export function guestbookCreate(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountRouteInfo,
): Promise<void>

/** DELETE /api/guestbook/:id — soft-delete own entry (withAccount). */
export function guestbookRemove(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountRouteInfo,
): Promise<void>

/** @file comments.js - Types for public comment endpoints (Phase 5). The list/
 *  create handlers are thin per-target wrappers binding the target type. */

/** GET /api/guestbook/:id/comments — public thread (getOptionalAccount inside). */
export function commentListGuestbook(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** GET /api/media/:id/comments — public thread (getOptionalAccount inside). */
export function commentListMedia(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** POST /api/guestbook/:id/comments — post a comment (withAccountOrAdmin): a
 *  guest under hybrid moderation, or the couple as an auto-approved host reply. */
export function commentCreateGuestbook(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>

/** POST /api/media/:id/comments — post a comment (withAccountOrAdmin): a guest
 *  under hybrid moderation, or the couple as an auto-approved host reply. */
export function commentCreateMedia(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>

/** DELETE /api/comments/:id — soft-delete own comment (withAccount). */
export function commentRemove(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountRouteInfo,
): Promise<void>

/** @file reactions.js - Types for the reaction toggle endpoint (Phase 5) */

/** POST /api/reactions/toggle — toggle one emoji on a target (withAccount). */
export function reactionToggle(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountRouteInfo,
): Promise<void>

/** @file media.js - Types for media upload-session + gallery read endpoints */

import type { AccountOrAdminRouteInfo, RouteInfo } from "../core/types.js"

/** GET /api/media — public gallery feed for a section (getOptionalAccount inside). */
export function list(req: IncomingMessage, res: ServerResponse): Promise<void>

/** GET /api/media/:id — public single item; same visibility gate as the list → 404. */
export function getOne(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** POST /api/media — open an upload session (guest or admin principal). */
export function createSession(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>

/** PUT /api/media/:id/:variant — stream a raw variant body into staging. */
export function putVariant(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>

/** POST /api/media/:id/finalize — verify variants, blank video GPS, flip status. */
export function finalize(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>

/** PATCH /api/media/:id/caption — set the caption on the caller's own item. */
export function setCaption(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>

/** DELETE /api/media/:id — soft-delete own/admin item + unlink files. */
export function remove(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>

/** @file thank-you.js - Types for public digital thank-you card endpoints
 *  (Phase 3). Token is the auth for get/reply — no account required; amount/
 *  gift data is never returned here (admin-only, a later phase). */

import type { MediaKind, ThankYouCardForGuest } from "./types.js"

/** A resolved media item on a public card response — just enough for the
 *  card page to build /media/:file_key/:variant URLs. */
export interface ThankYouCardMediaItem {
  file_key: string
  kind: MediaKind
  width: number | null
  height: number | null
  needs_display: boolean
}

/** The recipient's reply, when present. */
export interface ThankYouCardReplyView {
  emoji: string | null
  message: string | null
  replied_at: string
}

/** GET /api/thank-you/:token response — scoped to what the card page needs.
 *  NEVER includes gift/amount data. */
export interface PublicThankYouCardResponse {
  recipient_name: string
  message: string
  theme: string
  effects_config: Record<string, unknown> | null
  media: ThankYouCardMediaItem[]
  reply: ThankYouCardReplyView | null
  viewed_at: string | null
  /** True only for the primary (reply-capable) token; false for the read-only
   *  share token. */
  canReply: boolean
  /** The raw read-only share token, present ONLY on the primary access path (so
   *  the page can build the forward link). Never sent to a share-token viewer. */
  shareToken?: string
}

/** POST /api/thank-you/:token/reply response. */
export interface ThankYouReplyResponse {
  success: true
  reply: ThankYouCardReplyView
}

/** GET /api/thank-you/mine response — signed-in "card waiting" banner data. */
export interface MyThankYouCardsResponse {
  cards: ThankYouCardForGuest[]
}

/** POST /api/thank-you/:token/opened response — engagement-timeline beacon. */
export interface ThankYouOpenedResponse {
  viewed_at: string | null
  view_count: number
}

/** GET /api/thank-you/:token — public, token-authed; read-only (never mutates).
 *  Named thankYouGet (not `get`) — api/types.d.ts is one flat namespace across
 *  every api/*.js module, and rsvp.js already owns the bare `get`. */
export function thankYouGet(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** POST /api/thank-you/:token/opened — envelope-open beacon: first open flips
 *  sent->viewed; every open bumps view_count/last_viewed_at. */
export function thankYouOpened(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** POST /api/thank-you/:token/reply — one-tap emoji + optional short message; appends. */
export function thankYouReply(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: RouteInfo,
): Promise<void>

/** GET /api/thank-you/mine — signed-in "card waiting" banner surfacing; never 401s. */
export function thankYouMine(req: IncomingMessage, res: ServerResponse): Promise<void>

/** @file studio.js - Types for the dev-only Sound lab decision endpoint.
 *  Named soundDecisionGet/Save (not bare get/post) — api/types.d.ts is one flat
 *  namespace and rsvp.js already owns `get`/`post`. */

/** Per-beat choice map: beat id → "synth:<beat>" | "sample:<file-id>" | "none". */
export interface SoundDecisionChoices {
  [beat: string]: string
}

/** Per-beat snapshot of the synth cue slider values (for exact reproduction). */
export interface SoundDecisionSynthParams {
  [beat: string]: Record<string, number>
}

/** The cleaned, storable decision input (server adds version + savedAt on write). */
export interface SoundDecisionInput {
  choices: SoundDecisionChoices
  masterLevel: number
  notes: string
  decidedBy: string
  synthParams: SoundDecisionSynthParams
}

/** Discriminated validation result for a decision POST body. */
export type SoundDecisionValidation =
  | { valid: true; value: SoundDecisionInput }
  | { valid: false; error: string }

/** Strict whitelist validation of a decision POST body (exported for tests). */
export function validateSoundDecision(body: unknown): SoundDecisionValidation

/** GET /api/studio/sound-decision — stored decision or { exists:false }; 404 in prod. */
export function soundDecisionGet(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>

/** POST /api/studio/sound-decision — validate + atomically persist; 404 in prod. */
export function soundDecisionSave(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>
