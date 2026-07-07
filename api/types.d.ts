import type { IncomingMessage, ServerResponse } from "node:http"
import type { RSVP, RSVPWithGuest, Stats } from "./types.js"
import type { RouteInfo } from "../core/types.js"

/** @file health.js - Types for health check endpoint */

export function getHealth(req: IncomingMessage, res: ServerResponse): void

/** @file config.js - Types for public config endpoint */

export interface PublicConfig {
  features: {
    enableNameLookup: boolean
    enableEmailLookup: boolean
  }
}

export function getConfig(req: IncomingMessage, res: ServerResponse): void

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
