/** @file Media upload-session endpoints: create session (POST), stream a
 *  variant (PUT), finalize (POST), self-delete (DELETE). All mutations are
 *  wrapped with withAccountOrAdmin — a guest OR an admin principal. Rows stay
 *  'uploading' until finalize; nothing partial is ever publicly visible.
 *  See docs/post-wedding/03-media-pipeline.md §2. */
/** @import * as Types from './types.js' */
/** @import * as CoreTypes from '../core/types.js' */
/** @import * as GlobalTypes from '../types.js' */

import fs from "node:fs"
import crypto from "node:crypto"
import { sendJson, parseBody, checkRateLimit } from "../core/http.js"
import { limiters } from "../core/rate-limit.js"
import { getClientIp } from "../core/rate-limit.js"
import { getOptionalAccount } from "../core/auth.js"
import {
  streamToStaging,
  reserveUploadSlot,
  releaseUploadSlot,
  getReservedBytes,
} from "../core/upload.js"
import { contentTypeAgrees, extForSniff } from "../core/sniff.js"
import { blankVideoGps } from "../core/mp4-meta.js"
import {
  TMP_DIR,
  itemDir,
  variantDiskPath,
  variantExistsOnDisk,
  ensureUploadDirs,
} from "../core/media-storage.js"
import {
  createMediaRow,
  getMediaById,
  getMediaFeed,
  getMediaFeedRowById,
  setMediaVariantBytes,
  setMediaOriginalExt,
  finalizeMedia,
  updateMediaCaption,
  softDeleteMedia,
  sumOriginalBytes,
  sumOriginalBytesForAccount,
} from "../db/media.js"
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnsupportedMediaTypeError,
} from "../core/validation.js"
import {
  LIMITS,
  MEDIA_LIMITS,
  MEDIA_KIND,
  MEDIA_STATUS,
  MEDIA_SECTION,
  MEDIA_STORAGE,
  TARGET_TYPE,
  isMediaKind,
  expectedVariants,
} from "../types.js"
import { getWeddingFacts } from "../core/wedding-facts.js"
import { log, AUDIT_ACTIONS } from "../core/utils.js"
import { enrichSocial } from "./enrich.js"

// Per-variant streaming spec, keyed by variant then item kind. A variant absent
// for a kind (e.g. poster on an image) is structurally invalid → 400.
/** @type {Record<string, Partial<Record<GlobalTypes.MediaKind, { expectedKinds: string[], maxBytes: number }>>>} */
const VARIANT_SPEC = {
  original: {
    image: { expectedKinds: ["jpeg", "png", "webp", "heic"], maxBytes: MEDIA_LIMITS.IMAGE_ORIGINAL_MAX },
    video: { expectedKinds: ["mp4", "mov"], maxBytes: MEDIA_LIMITS.VIDEO_ORIGINAL_MAX },
  },
  display: { image: { expectedKinds: ["jpeg", "webp"], maxBytes: MEDIA_LIMITS.DISPLAY_MAX } },
  thumb: { image: { expectedKinds: ["jpeg", "webp"], maxBytes: MEDIA_LIMITS.THUMB_MAX } },
  poster: { video: { expectedKinds: ["jpeg", "webp"], maxBytes: MEDIA_LIMITS.POSTER_MAX } },
  // Content-section responsive width ladder (see expectedVariants / CONTENT_IMAGE_LADDER).
  w400: { image: { expectedKinds: ["jpeg", "webp"], maxBytes: MEDIA_LIMITS.W400_MAX } },
  w800: { image: { expectedKinds: ["jpeg", "webp"], maxBytes: MEDIA_LIMITS.W800_MAX } },
  w1600: { image: { expectedKinds: ["jpeg", "webp"], maxBytes: MEDIA_LIMITS.W1600_MAX } },
}

/**
 * @param {CoreTypes.Principal} principal
 * @param {GlobalTypes.Media} row
 * @returns {boolean}
 */
function owns(principal, row) {
  return principal.isAdmin || row.account_id === principal.accountId
}

/**
 * Trim + length-clamp a raw caption; empty becomes null. Mirrors the admin
 * caption validator (api/admin/media.js) so guest and admin captions share a
 * ceiling. @param {unknown} raw @returns {string | null}
 */
function sanitizeCaption(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "string") throw new ValidationError("caption must be a string or null")
  const trimmed = raw.trim()
  if (trimmed.length > LIMITS.MESSAGE_MAX_LENGTH) {
    throw new ValidationError(`Caption must be ${LIMITS.MESSAGE_MAX_LENGTH} characters or fewer`)
  }
  return trimmed.length > 0 ? trimmed : null
}

/** @param {unknown} v @returns {number | null} */
function toIntOrNull(v) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** @param {unknown} v @returns {number | null} */
function toFloatOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Send an error for a PUT after draining the (unread) binary body, so the
 * socket stays usable and the client reliably receives the response.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {number} status @param {string} message @param {string} code
 */
function rejectPut(req, res, status, message, code) {
  req.resume()
  return sendJson(res, status, { error: message, code })
}

/**
 * Disk + quota guard (§6). Returns false and sends 507 if the upload can't be
 * accepted. declaredBytes is the client-declared original size.
 * @param {import('node:http').ServerResponse} res
 * @param {number} declaredBytes
 * @param {CoreTypes.Principal} principal
 */
function passesDiskGuard(res, declaredBytes, principal) {
  let free = Infinity
  try {
    const s = fs.statfsSync(TMP_DIR)
    free = s.bavail * s.bsize
  } catch {
    // If statfs fails, fall through to the DB-total guard below.
  }
  const send507 = () =>
    sendJson(res, 507, { error: "Storage is full — please try later", code: "INSUFFICIENT_STORAGE" })

  if (free - declaredBytes - getReservedBytes() < MEDIA_STORAGE.MIN_FREE_BYTES) {
    send507()
    return false
  }
  if (sumOriginalBytes() + declaredBytes > MEDIA_STORAGE.MAX_TOTAL_BYTES) {
    send507()
    return false
  }
  // Untrusted-account quota: open registration is instant, so a stranger with
  // the URL must not be able to fill the disk. Trusted accounts + admin skip it.
  if (!principal.trusted && principal.accountId !== null) {
    const used = sumOriginalBytesForAccount(principal.accountId)
    if (used + declaredBytes > MEDIA_STORAGE.UNTRUSTED_QUOTA_BYTES) {
      send507()
      return false
    }
  }
  return true
}

// ---- Gallery read endpoints (public) ------------------------------------

const GUEST_PAGE_MAX = 100
const OFFICIAL_PAGE_MAX = 500

/**
 * Parse the keyset cursor. Only a positive integer is a valid cursor; anything
 * else (absent, non-numeric, ≤0) means "first page" → null.
 * @param {string | null} value @returns {number | null}
 */
function parseCursor(value) {
  if (!value) return null
  const n = parseInt(value, 10)
  return Number.isNaN(n) || n < 1 ? null : n
}

/**
 * Clamp the page size to [1, max], defaulting to max when absent/invalid —
 * grid pages want to be as large as the section allows.
 * @param {string | null} value @param {number} max @returns {number}
 */
function clampLimit(value, max) {
  if (!value) return max
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n < 1) return max
  return Math.min(n, max)
}

/**
 * Map a raw feed row (SQLite 0|1 flags, nullable author) to the public item
 * shape (booleans; author_name coalesced to the couple's name for official
 * uploads, which have account_id NULL and thus no joined account row).
 * @param {GlobalTypes.MediaFeedRow} row @returns {GlobalTypes.MediaListItem}
 */
function toListItem(row) {
  return {
    id: row.id,
    file_key: row.file_key,
    kind: row.kind,
    section: row.section,
    status: row.status,
    caption: row.caption,
    width: row.width,
    height: row.height,
    duration_seconds: row.duration_seconds,
    needs_display: !!row.needs_display,
    author_name: row.author_name ?? getWeddingFacts().coupleNames,
    is_own: !!row.is_own,
    created_at: row.created_at,
  }
}

/** Visible to this viewer? Approved is public; a pending item only to its owner. */
/** @param {GlobalTypes.MediaFeedRow} row @returns {boolean} */
function isVisible(row) {
  return (
    row.status === MEDIA_STATUS.APPROVED ||
    (!!row.is_own && row.status === MEDIA_STATUS.PENDING)
  )
}

/** @type {Types.list} */
export async function list(req, res) {
  // Generous per-IP limiter shared across public list endpoints.
  if (checkRateLimit(res, limiters.publicRead, getClientIp(req))) return

  const account = getOptionalAccount(req)
  const callerId = account ? account.account_id : null

  const urlObj = new URL(req.url ?? "/", `http://${req.headers.host}`)
  const sectionParam = urlObj.searchParams.get("section")
  // Public gallery feed serves only the two gallery sections. 'content' passes
  // isMediaSection() but is admin-only site-content (dress-code figures) and must
  // never be listable here — clamp anything else to the guest feed.
  const section =
    sectionParam === MEDIA_SECTION.OFFICIAL || sectionParam === MEDIA_SECTION.GUEST
      ? sectionParam
      : MEDIA_SECTION.GUEST
  const isOfficial = section === MEDIA_SECTION.OFFICIAL

  // Official is a single sort_order page (no cursor); guest is a keyset feed.
  const before = isOfficial ? null : parseCursor(urlObj.searchParams.get("before"))
  const limit = clampLimit(
    urlObj.searchParams.get("limit"),
    isOfficial ? OFFICIAL_PAGE_MAX : GUEST_PAGE_MAX,
  )

  const rows = getMediaFeed({ callerId, section, before, limit })
  const items = rows.map(toListItem)
  // Attach reaction summaries + comment counts (Phase 5). Guarded internally
  // against an empty page (sql.list throws on []).
  enrichSocial(items, TARGET_TYPE.MEDIA, callerId)
  // A full page means there may be more → last id is the next cursor. Official
  // never paginates, so it always reports nextCursor null.
  const nextCursor =
    !isOfficial && rows.length === limit ? rows[rows.length - 1].id : null

  return sendJson(res, 200, { items, nextCursor })
}

/** @type {Types.getOne} */
export async function getOne(req, res, { params }) {
  if (checkRateLimit(res, limiters.publicRead, getClientIp(req))) return

  const account = getOptionalAccount(req)
  const callerId = account ? account.account_id : null

  const id = Number(params.id)
  const row = Number.isInteger(id) ? getMediaFeedRowById(id, callerId) : undefined
  // Missing/deleted or not visible to this viewer → 404 (never confirm existence
  // of unmoderated content by id-guessing).
  if (!row || !isVisible(row)) throw new NotFoundError("Media")

  // Enrich the single item too so the lightbox ?item= deep-link shows reactions
  // + comment count immediately, before the grid backfills behind it.
  const item = toListItem(row)
  enrichSocial([item], TARGET_TYPE.MEDIA, callerId)
  return sendJson(res, 200, item)
}

/** @type {Types.createSession} */
export async function createSession(req, res, { principal }) {
  // Per-account create limit (admins uncapped).
  if (
    !principal.isAdmin &&
    checkRateLimit(res, limiters.mediaCreate, "acct:" + principal.accountId)
  ) {
    return
  }

  const body = await parseBody(req)
  if (!isMediaKind(body.kind)) {
    throw new ValidationError("kind must be 'image' or 'video'")
  }
  const kind = body.kind
  const originalBytes = toIntOrNull(body.originalBytes)
  if (originalBytes === null || originalBytes === 0) {
    throw new ValidationError("originalBytes required")
  }
  const cap =
    kind === MEDIA_KIND.IMAGE
      ? MEDIA_LIMITS.IMAGE_ORIGINAL_MAX
      : MEDIA_LIMITS.VIDEO_ORIGINAL_MAX
  if (originalBytes > cap) {
    return sendJson(res, 413, { error: "File is too large", code: "PAYLOAD_TOO_LARGE" })
  }

  // Only an admin may place an item outside the guest feed: the curated
  // 'official' gallery, or the 'content' section (site-content images such as
  // dress-code figures, which are image-only and never appear in a gallery feed).
  /** @type {GlobalTypes.MediaSection} */
  let section = MEDIA_SECTION.GUEST
  if (principal.isAdmin && body.section === MEDIA_SECTION.OFFICIAL) {
    section = MEDIA_SECTION.OFFICIAL
  } else if (principal.isAdmin && body.section === MEDIA_SECTION.CONTENT) {
    if (kind !== MEDIA_KIND.IMAGE) {
      throw new ValidationError("content section accepts images only")
    }
    section = MEDIA_SECTION.CONTENT
  }

  if (!passesDiskGuard(res, originalBytes, principal)) return

  const fileKey = crypto.randomBytes(16).toString("hex")
  ensureUploadDirs()
  fs.mkdirSync(itemDir(fileKey), { recursive: true })
  const row = createMediaRow({
    fileKey,
    accountId: principal.accountId,
    kind,
    section,
    originalBytes,
  })

  log({
    action: AUDIT_ACTIONS.MEDIA_CREATE,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: row.id,
    details: { kind, section },
  })

  return sendJson(res, 201, { id: row.id, fileKey })
}

/** @type {Types.putVariant} */
export async function putVariant(req, res, { params, principal }) {
  const id = Number(params.id)
  const variant = params.variant
  const row = Number.isInteger(id) ? getMediaById(id) : undefined
  // 404 (not 403) for missing or not-owned — never confirm someone else's item.
  if (!row || !owns(principal, row)) {
    return rejectPut(req, res, 404, "Not found", "NOT_FOUND")
  }
  // Variant PUTs and finalize require 'uploading'. Once finalized, variants are
  // immutable — this is the moderation-bypass gate (00-overview reconciliation 8).
  if (row.status !== MEDIA_STATUS.UPLOADING) {
    return rejectPut(req, res, 409, "Upload already finalized", "CONFLICT")
  }
  const spec = VARIANT_SPEC[variant]?.[row.kind]
  if (!spec) {
    return rejectPut(req, res, 400, "Invalid variant for this item", "VALIDATION_ERROR")
  }

  const declared = Number(req.headers["content-length"])
  const validDeclared = Number.isInteger(declared) && declared > 0
  const isOriginal = variant === "original"
  // Reserve a concurrency slot + byte reservation only for the (large) original;
  // the small derived variants don't count against the cap or the disk guard.
  let reserved = false
  if (isOriginal && validDeclared) {
    reserved = reserveUploadSlot(principal.accountId, declared)
    if (!reserved) {
      return rejectPut(req, res, 429, "Too many concurrent uploads", "RATE_LIMIT_EXCEEDED")
    }
  }

  try {
    const result = await streamToStaging(req, {
      maxBytes: spec.maxBytes,
      expectedKinds: spec.expectedKinds,
      stagingDir: TMP_DIR,
    })
    // The declared Content-Type must also agree with the sniffed bytes.
    if (!contentTypeAgrees(req.headers["content-type"], result.sniffed)) {
      fs.promises.unlink(result.stagingPath).catch(() => {})
      throw new UnsupportedMediaTypeError("Content-Type does not match file")
    }

    const ext = extForSniff(result.sniffed)
    const dest = variantDiskPath(row.file_key, variant, ext)
    fs.mkdirSync(itemDir(row.file_key), { recursive: true })
    await fs.promises.rename(result.stagingPath, dest)

    if (isOriginal) {
      setMediaOriginalExt(row.id, ext)
      setMediaVariantBytes(row.id, "original", result.bytes)
    } else {
      setMediaVariantBytes(row.id, variant, result.bytes)
    }

    return sendJson(res, 200, {
      variant,
      bytes: result.bytes,
      sha256: result.sha256,
    })
  } finally {
    if (reserved) releaseUploadSlot(principal.accountId, declared)
  }
}

/** @type {Types.finalize} */
export async function finalize(req, res, { params, principal }) {
  const id = Number(params.id)
  const row = Number.isInteger(id) ? getMediaById(id) : undefined
  if (!row || !owns(principal, row)) throw new NotFoundError("Media")

  // Idempotent: re-finalizing an already-finalized row is a no-op 200 returning
  // the current status (client retries finalize after network errors).
  if (row.status !== MEDIA_STATUS.UPLOADING) {
    return sendJson(res, 200, { id: row.id, status: row.status })
  }

  const body = await parseBody(req)
  const displayMissing = row.kind === MEDIA_KIND.IMAGE && body.displayMissing === true
  const width = toIntOrNull(body.width)
  const height = toIntOrNull(body.height)
  const durationS = row.kind === MEDIA_KIND.VIDEO ? toFloatOrNull(body.durationS) : null
  // Optional guest-supplied caption (validated before any disk work).
  const caption = sanitizeCaption(body.caption)

  // Verify every required variant landed on disk. Content-section images require
  // the full responsive ladder; a displayMissing (undecodable) content upload
  // therefore fails here — admins must upload a decodable image.
  for (const variant of expectedVariants(row.kind, row.section, displayMissing)) {
    if (!variantExistsOnDisk(row.file_key, variant, row.original_ext)) {
      throw new ConflictError(`Missing required variant: ${variant}`)
    }
  }

  // A video's original becomes the public `video` variant only after its GPS
  // atoms are blanked in place here.
  if (row.kind === MEDIA_KIND.VIDEO && row.original_ext) {
    const regions = blankVideoGps(variantDiskPath(row.file_key, "original", row.original_ext))
    log({
      action: AUDIT_ACTIONS.MEDIA_FINALIZE,
      ip: getClientIp(req),
      resourceType: "media",
      resourceId: row.id,
      details: { gpsBlanked: regions.length },
    })
  }

  // Hybrid moderation: admin/trusted → live; untrusted → held pending.
  const status =
    principal.isAdmin || principal.trusted
      ? MEDIA_STATUS.APPROVED
      : MEDIA_STATUS.PENDING

  const finalized = finalizeMedia(row.id, {
    width,
    height,
    durationS,
    needsDisplay: displayMissing,
    status,
  })

  if (caption !== null) updateMediaCaption(row.id, caption)

  if (row.kind !== MEDIA_KIND.VIDEO) {
    log({
      action: AUDIT_ACTIONS.MEDIA_FINALIZE,
      ip: getClientIp(req),
      resourceType: "media",
      resourceId: row.id,
      details: { status, needsDisplay: displayMissing },
    })
  }

  return sendJson(res, 200, { id: finalized.id, status: finalized.status })
}

/** @type {Types.setCaption} */
export async function setCaption(req, res, { params, principal }) {
  const id = Number(params.id)
  const row = Number.isInteger(id) ? getMediaById(id) : undefined
  // Own item only (admins edit captions via the curated-gallery manager). A
  // deleted row 404s. This exists so a caption typed in the upload tray still
  // lands when a fast trusted upload finalized before the guest finished typing.
  if (!row || !owns(principal, row) || row.deleted_at) throw new NotFoundError("Media")

  const body = await parseBody(req)
  const caption = sanitizeCaption(body.caption)
  updateMediaCaption(row.id, caption)

  log({
    action: AUDIT_ACTIONS.MEDIA_UPDATE,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: row.id,
  })

  return sendJson(res, 200, { id: row.id, caption })
}

/** @type {Types.remove} */
export async function remove(req, res, { params, principal }) {
  if (
    !principal.isAdmin &&
    checkRateLimit(res, limiters.contentDelete, "acct:" + principal.accountId)
  ) {
    return
  }

  const id = Number(params.id)
  const row = Number.isInteger(id) ? getMediaById(id) : undefined
  if (!row || !owns(principal, row) || row.deleted_at) throw new NotFoundError("Media")

  // Soft-delete the row (kept for audit) but unlink the variant files — a guest
  // who regrets a photo must not need to contact the couple. Matches guestbook
  // self-delete, plus the file removal.
  fs.rmSync(itemDir(row.file_key), { recursive: true, force: true })
  softDeleteMedia(row.id)

  log({
    action: AUDIT_ACTIONS.MEDIA_DELETE,
    ip: getClientIp(req),
    resourceType: "media",
    resourceId: row.id,
  })

  return sendJson(res, 200, { success: true })
}
