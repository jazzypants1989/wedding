/** @file Admin curated-gallery management (Phase 6): list a curated section
 *  (official or honeymoon) with its hidden rows, reorder it, move an item between
 *  those two, MOVE an approved guest item into official, edit captions, and
 *  soft-delete any media, and decide hidden photos in Gallery → Sort (show or
 *  keep hidden, marking them looked at). Also what still fits, for the bulk importer. Admin
 *  *uploads* are NOT here — they reuse the Phase 3 /api/media/*
 *  withAccountOrAdmin routes via adminFetch (reconciliation 7).
 *  All routes are {admin:true}. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import { sendJson, parseBody } from "../../core/http.js"
import { log, logBatch, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { validateId, ValidationError, NotFoundError, ConflictError } from "../../core/validation.js"
import { LIMITS, MEDIA_SECTION, MEDIA_STATUS, isCuratedMediaSection } from "../../types.js"
import { withTransaction } from "../../db/utils.js"
import { TMP_DIR, computeMediaCapacity, quarantineItemDir } from "../../core/media-storage.js"
import { getReservedBytes } from "../../core/upload.js"
import { toListItem } from "../media.js"
import {
  getMediaById,
  getCuratedMediaForAdmin,
  getCuratedMediaIds,
  setMediaSortOrders,
  setCuratedDecisions,
  moveCuratedMedia,
  promoteMediaToOfficial,
  updateMediaCaption,
  softDeleteMedia,
  sumOriginalBytes,
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

/** @type {Types.adminCuratedListHandler} */
export async function curated(req, res) {
  // A curated section as the couple manages it. The public feed can't serve this
  // job: it shows approved rows only, and reorder demands the full set.
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const section = url.searchParams.get("section") ?? MEDIA_SECTION.OFFICIAL
  if (!isCuratedMediaSection(section)) {
    throw new ValidationError("section must be 'official' or 'honeymoon'")
  }
  // Plus what Gallery → Sort reads: the capture time it groups moments by and
  // whether the photo has been decided there. Neither is in a public response.
  const items = getCuratedMediaForAdmin(section).map((row) => ({
    ...toListItem(row),
    captured_at: row.captured_at,
    decided_at: row.decided_at,
  }))
  return sendJson(res, 200, { items })
}

/** The most photos one decision may name: a whole moment, with room to spare. */
const DECIDE_MAX_IDS = 200

/** @type {Types.mediaDecideHandler} */
export async function decide(req, res, { session }) {
  const body = await parseBody(req)
  const rawIds = body.ids
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > DECIDE_MAX_IDS) {
    throw new ValidationError(`ids must be a non-empty array of at most ${DECIDE_MAX_IDS}`)
  }
  /** @type {number[]} */
  const ids = []
  for (const raw of rawIds) {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1) throw new ValidationError("ids must be positive integers")
    if (ids.includes(n)) throw new ValidationError("ids must not repeat")
    ids.push(n)
  }
  const status = body.status
  if (status !== MEDIA_STATUS.APPROVED && status !== MEDIA_STATUS.HIDDEN) {
    throw new ValidationError("status must be 'approved' or 'hidden'")
  }
  if (typeof body.decided !== "boolean") throw new ValidationError("decided must be true or false")
  const decided = body.decided

  // All or none: a photo deleted, rejected or moved out of the curated sets since
  // the page loaded refuses the whole decision, so the page never has to guess
  // which half went through.
  const outcome = withTransaction(() => {
    const result = setCuratedDecisions(ids, status, decided)
    if (result.changed !== ids.length) {
      throw new ConflictError("Some of these photos can no longer be changed here — reload")
    }
    return result
  })

  const ip = getClientIp(req)
  logBatch(
    ids.map((id) => ({
      action: AUDIT_ACTIONS.MEDIA_DECIDE,
      adminId: session?.token,
      ip,
      resourceType: "media",
      resourceId: id,
      details: { status, decided },
    })),
  )

  return sendJson(res, 200, { success: true, ids, status, decided_at: outcome.decidedAt })
}

/** @type {Types.adminMediaCapacityHandler} */
export async function capacity(req, res) {
  // Where the upload guard would stop a big import, so the importer's --dry-run
  // can say so before the first 507. statfs on TMP_DIR, as passesDiskGuard does.
  /** @type {number | null} */
  let freeBytes = null
  try {
    const s = fs.statfsSync(TMP_DIR)
    freeBytes = s.bavail * s.bsize
  } catch {
    // Unknown free space: only the total cap can be reported.
  }
  return sendJson(
    res,
    200,
    computeMediaCapacity({
      storedBytes: sumOriginalBytes(),
      freeBytes,
      reservedBytes: getReservedBytes(),
    }),
  )
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

  // Which curated section is being ordered. Absent means official — the only
  // one there was before honeymoon, so older callers (the HTTP import sink)
  // keep working unchanged. Anything else present is a 400, never a guess.
  const section = body.section === undefined ? MEDIA_SECTION.OFFICIAL : body.section
  if (!isCuratedMediaSection(section)) {
    throw new ValidationError("section must be 'official' or 'honeymoon'")
  }

  // The submitted set must be EXACTLY the section's current ids — no more, no
  // fewer, no duplicates, no foreign ids. This rejects a stale/tampered payload
  // (400) rather than silently reordering a subset.
  const current = getCuratedMediaIds(section)
  const currentSet = new Set(current)
  const seen = new Set()
  const mismatch = `ids must match the current ${section} set exactly`
  if (ids.length !== current.length) {
    throw new ValidationError(mismatch)
  }
  for (const id of ids) {
    if (!currentSet.has(id) || seen.has(id)) {
      throw new ValidationError(mismatch)
    }
    seen.add(id)
  }

  withTransaction(() => setMediaSortOrders(ids, section))

  log({
    action: AUDIT_ACTIONS.MEDIA_REORDER,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    details: { count: ids.length, section },
  })

  return sendJson(res, 200, { success: true, ids })
}

/** @type {Types.mediaSectionMoveHandler} */
export async function moveSection(req, res, { params, session }) {
  const idResult = validateId(params.id, "media ID")
  if (!idResult.valid) throw new ValidationError(idResult.error)

  const body = await parseBody(req)
  const section = body.section
  if (!isCuratedMediaSection(section)) {
    throw new ValidationError("section must be 'official' or 'honeymoon'")
  }

  // MOVE semantics, between the two curated sections only: the item leaves one
  // order and is appended to the other. Missing, deleted, a guest/content item,
  // or already in that section → 409 (promote is the guest → official path).
  const changed = moveCuratedMedia(idResult.value, section)
  if (!changed) {
    throw new ConflictError(
      `Cannot move — item must be a curated photo that isn't already in ${section}`,
    )
  }

  log({
    action: AUDIT_ACTIONS.MEDIA_SECTION_MOVE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: idResult.value,
    details: { section },
  })

  return sendJson(res, 200, { success: true, section })
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
