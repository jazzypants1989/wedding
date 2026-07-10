import type { IncomingMessage, ServerResponse } from "node:http"
import type { RSVP, RSVPWithGuest, Stats } from "./types.js"
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
}

export function getConfig(req: IncomingMessage, res: ServerResponse): void

/** @file setup.js - Types for first-run onboarding endpoints */

export function status(req: IncomingMessage, res: ServerResponse): Promise<void>
export function submit(req: IncomingMessage, res: ServerResponse): Promise<void>

/** @file lookup.js - Types for guest lookup and petition endpoints */

/**
 * Send not found response.
 * @example
 * notFoundResponse(res);
 */
export function notFoundResponse(res: ServerResponse): void

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

/** POST /api/guestbook/:id/comments — post a comment (withAccount); hybrid moderation. */
export function commentCreateGuestbook(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountRouteInfo,
): Promise<void>

/** POST /api/media/:id/comments — post a comment (withAccount); hybrid moderation. */
export function commentCreateMedia(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountRouteInfo,
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

/** DELETE /api/media/:id — soft-delete own/admin item + unlink files. */
export function remove(
  req: IncomingMessage,
  res: ServerResponse,
  routeInfo: AccountOrAdminRouteInfo,
): Promise<void>
