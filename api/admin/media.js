/** @file Admin curated-gallery management (Phase 6): reorder the official
 *  section, MOVE an approved guest item into it, edit captions, and soft-delete
 *  any media. Admin *uploads* are NOT here — they reuse the Phase 3
 *  /api/media/* withAccountOrAdmin routes via adminFetch (reconciliation 7).
 *  All routes are {admin:true}. */
/** @import * as Types from './types.js' */

import { sendJson, parseBody } from "../../core/http.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { validateId, ValidationError, NotFoundError, ConflictError } from "../../core/validation.js"
import { LIMITS } from "../../types.js"
import { withTransaction } from "../../db/utils.js"
import { quarantineItemDir } from "../../core/media-storage.js"
import {
  getMediaById,
  getOfficialMediaIds,
  setMediaSortOrders,
  promoteMediaToOfficial,
  updateMediaCaption,
  softDeleteMedia,
  listGuestMediaByReactions,
} from "../../db/media.js"
import { countCardsReferencingFileKey } from "../../db/thank-you-cards.js"

/** Default + hard cap for the "Most loved" curation page (A3). */
const LOVED_DEFAULT_LIMIT = 60
const LOVED_MAX_LIMIT = 200

/** @type {Types.adminGuestLovedHandler} */
export async function guestLoved(req, res) {
  // "Most loved" guest curation: approved guest media ranked by total reactions.
  // A single capped page (not a feed) — the count isn't a stable keyset cursor.
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const raw = parseInt(url.searchParams.get("limit") ?? "", 10)
  const limit = Number.isNaN(raw)
    ? LOVED_DEFAULT_LIMIT
    : Math.min(Math.max(raw, 1), LOVED_MAX_LIMIT)
  const items = listGuestMediaByReactions(limit).map((m) => ({
    id: m.id,
    file_key: m.file_key,
    kind: m.kind,
    caption: m.caption,
    author_name: m.author_name,
    needs_display: !!m.needs_display,
    reaction_count: m.reaction_count,
  }))
  return sendJson(res, 200, { items })
}

/** @type {Types.mediaReorderHandler} */
export async function reorder(req, res, { session }) {
  const body = await parseBody(req)
  const rawIds = body.ids
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new ValidationError("ids must be a non-empty array")
  }

  /** @type {number[]} */
  const ids = []
  for (const raw of rawIds) {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1) throw new ValidationError("ids must be positive integers")
    ids.push(n)
  }

  // The submitted set must be EXACTLY the current official ids — no more, no
  // fewer, no duplicates, no foreign ids. This rejects a stale/tampered payload
  // (400) rather than silently reordering a subset.
  const official = getOfficialMediaIds()
  const officialSet = new Set(official)
  const seen = new Set()
  if (ids.length !== official.length) {
    throw new ValidationError("ids must match the current official set exactly")
  }
  for (const id of ids) {
    if (!officialSet.has(id) || seen.has(id)) {
      throw new ValidationError("ids must match the current official set exactly")
    }
    seen.add(id)
  }

  withTransaction(() => setMediaSortOrders(ids))

  log({
    action: AUDIT_ACTIONS.MEDIA_REORDER,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    details: { count: ids.length },
  })

  return sendJson(res, 200, { success: true, ids })
}

/** @type {Types.mediaPromoteHandler} */
export async function promote(req, res, { params, session }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  // MOVE semantics: only an approved *guest* item can be promoted; it leaves the
  // guest feed. Anything else (missing, not approved, already official) → 409.
  const changed = promoteMediaToOfficial(idResult.value)
  if (!changed) {
    throw new ConflictError(
      "Cannot promote — item must be an approved guest photo that isn't already official",
    )
  }

  log({
    action: AUDIT_ACTIONS.MEDIA_PROMOTE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}

/** @type {Types.mediaCaptionHandler} */
export async function caption(req, res, { params, session }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const body = await parseBody(req)
  const raw = body.caption
  if (raw !== null && typeof raw !== "string") {
    throw new ValidationError("caption must be a string or null")
  }
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  if (trimmed.length > LIMITS.MESSAGE_MAX_LENGTH) {
    throw new ValidationError(`Caption must be ${LIMITS.MESSAGE_MAX_LENGTH} characters or fewer`)
  }
  const value = trimmed.length > 0 ? trimmed : null

  const changed = updateMediaCaption(idResult.value, value)
  if (!changed) throw new NotFoundError("Media")

  log({
    action: AUDIT_ACTIONS.MEDIA_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true, caption: value })
}

/** @type {Types.mediaReferencesHandler} */
export async function references(req, res, { params }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const row = getMediaById(idResult.value)
  if (!row || row.deleted_at) throw new NotFoundError("Media")

  // A destructive action (Remove / moderation Reject / Hide) silently strips this
  // photo from any thank-you card that embeds it (resolveMedia drops the
  // now-unapproved key). Surface the count so the confirm dialog can warn BEFORE
  // acting — especially for already-delivered (sent/viewed) cards.
  const counts = countCardsReferencingFileKey(row.file_key)
  return sendJson(res, 200, {
    cardRefs: counts.total,
    deliveredCardRefs: counts.delivered,
  })
}

/** @type {Types.mediaDeleteHandler} */
export async function remove(req, res, { params, session }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const row = getMediaById(idResult.value)
  if (!row || row.deleted_at) throw new NotFoundError("Media")

  // Soft-delete the row (kept for audit) and MOVE its files to quarantine
  // rather than hard-deleting — the ✕ sits inline in a dense reorder grid, so a
  // mis-click must be hand-recoverable (same posture as an admin Reject; the
  // daily sweep purges quarantine after MEDIA_QUARANTINE_TTL_DAYS).
  quarantineItemDir(row.file_key)
  softDeleteMedia(idResult.value)

  log({
    action: AUDIT_ACTIONS.MEDIA_DELETE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: idResult.value,
  })

  return sendJson(res, 200, { success: true })
}
