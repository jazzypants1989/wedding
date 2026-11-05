/** @file Dynamic media file server: GET/HEAD /media/:fileKey/:variant with
 *  Range support. Dispatched in server.js BEFORE serveStatic (it serves from
 *  the data volume, outside public/). Traversal is structurally impossible —
 *  paths are built only from a validated 32-hex key + a frozen variant + the
 *  DB ext. See docs/post-wedding/03-media-pipeline.md §7. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../types.js' */
/** @import { IncomingMessage } from 'node:http' */

import fs from "node:fs"
import { pipeline } from "node:stream"
import { getMediaByFileKey } from "../db/media.js"
import { getOptionalAccount, getOptionalAdmin } from "./auth.js"
import {
  variantDiskPath,
  resolveVariantFile,
  contentTypeForExt,
} from "./media-storage.js"
import { MEDIA_KIND, MEDIA_SECTION, MEDIA_STATUS } from "../types.js"

// Public variants anyone may fetch (subject to the approval gate); `original` is
// admin-only (image originals still carry EXIF GPS; video originals serve as the
// public `video` variant instead).
// Content-section responsive width ladder (image-only); publicly servable like
// display/thumb so the landing page can load dress-code figures by file_key.
const LADDER_VARIANTS = new Set(["w400", "w800", "w1600"])
const PUBLIC_VARIANTS = new Set(["display", "thumb", "poster", "video", ...LADDER_VARIANTS])
const ALL_VARIANTS = new Set(["display", "thumb", "poster", "video", "original", ...LADDER_VARIANTS])

/**
 * Parse a run of decimal digits. Rejects empty, non-digit, and > 15 digits
 * (overflow guard). No regex.
 * @param {string} str @returns {number | null}
 */
function parseDecimal(str) {
  if (str.length === 0 || str.length > 15) return null
  let n = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 48 || c > 57) return null
    n = n * 10 + (c - 48)
  }
  return n
}

/**
 * True when the string is one or more decimal digits (no length cap) — used to
 * tell "number too big to parse" apart from "not a number" so oversized values
 * can clamp per RFC 9110 instead of 416ing a satisfiable range.
 * @param {string} str @returns {boolean}
 */
function isAllDigits(str) {
  if (str.length === 0) return false
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** @type {Types.parseRange} */
export function parseRange(header, size) {
  if (!header || !header.startsWith("bytes=")) return null
  const spec = header.slice(6)
  if (spec.includes(",")) return null // multi-range → serve full 200
  const dash = spec.indexOf("-")
  if (dash === -1) return "invalid"
  const startStr = spec.slice(0, dash).trim()
  const endStr = spec.slice(dash + 1).trim()
  if (startStr === "") {
    // suffix: bytes=-N (last N bytes). A suffix longer than the file (including
    // one too long to parse) means "the whole file" per RFC 9110 §14.1.2.
    if (parseDecimal(endStr) === null && isAllDigits(endStr)) {
      return { start: 0, end: size - 1 }
    }
    const n = parseDecimal(endStr)
    if (n === null || n === 0) return "invalid"
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = parseDecimal(startStr)
  // An unparseably-large start is necessarily ≥ size → genuinely unsatisfiable.
  if (start === null) return "invalid"
  // An end past EOF clamps to size-1 (RFC 9110 §14.1.2) — including an end too
  // large for parseDecimal's overflow guard, which is by definition past EOF.
  const end =
    endStr === "" ? size - 1 : (parseDecimal(endStr) ?? (isAllDigits(endStr) ? size - 1 : null))
  if (end === null || start >= size || start > end) return "invalid"
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Validate a file_key: exactly 32 lowercase hex chars (charCode loop, no regex).
 * @param {string} key @returns {boolean}
 */
function isValidFileKey(key) {
  if (key.length !== 32) return false
  for (let i = 0; i < 32; i++) {
    const c = key.charCodeAt(i)
    const isDigit = c >= 48 && c <= 57
    const isLowerHex = c >= 97 && c <= 102
    if (!isDigit && !isLowerHex) return false
  }
  return true
}

/**
 * @param {string} variant
 * @param {GlobalTypes.MediaKind} kind
 * @returns {boolean}
 */
function variantValidForKind(variant, kind) {
  if (variant === "original") return true
  if (kind === MEDIA_KIND.VIDEO) return variant === "poster" || variant === "video"
  // image: display/thumb (gallery) or the content-section width ladder
  return variant === "display" || variant === "thumb" || LADDER_VARIANTS.has(variant)
}

/**
 * Resolve the on-disk file + Content-Type for a (row, variant), or null if the
 * variant file doesn't exist. The `video` variant maps to the original file but
 * is ALWAYS served as video/mp4 (Chromium won't play video/quicktime).
 * @param {GlobalTypes.Media} row @param {string} variant
 * @returns {{ path: string, contentType: string } | null}
 */
function resolveServable(row, variant) {
  if (variant === "video") {
    if (!row.original_ext) return null
    return {
      path: variantDiskPath(row.file_key, "original", row.original_ext),
      contentType: "video/mp4",
    }
  }
  if (variant === "original") {
    if (!row.original_ext) return null
    return {
      path: variantDiskPath(row.file_key, "original", row.original_ext),
      contentType: contentTypeForExt(row.original_ext),
    }
  }
  const resolved = resolveVariantFile(row.file_key, variant)
  return resolved ? { path: resolved.path, contentType: resolved.contentType } : null
}

/**
 * Is this the signed-in account that uploaded this still-pending row? An admin
 * upload's account_id is NULL, which no account session can match.
 * @param {IncomingMessage} req @param {GlobalTypes.Media} row
 * @returns {boolean}
 */
function isOwnPending(req, row) {
  if (row.status !== MEDIA_STATUS.PENDING) return false
  const account = getOptionalAccount(req)
  return account !== null && account.account_id === row.account_id
}

/** @type {Types.serveMedia} */
export function serveMedia(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Allow": "GET, HEAD" })
    res.end()
    return
  }

  const urlPath = (req.url ?? "/").split("?")[0]
  const parts = urlPath.split("/").filter((s) => s !== "") // ["media", key, variant]
  if (parts.length !== 3 || parts[0] !== "media") {
    res.writeHead(404).end()
    return
  }
  const fileKey = parts[1]
  const variant = parts[2]
  if (!isValidFileKey(fileKey) || !ALL_VARIANTS.has(variant)) {
    res.writeHead(404).end()
    return
  }

  const row = getMediaByFileKey(fileKey)
  // 404 (never 403) on anything the caller isn't allowed to see — don't confirm
  // existence. Admin may view any non-deleted item; the public sees approved only;
  // an uploader also sees their own pending row, so their tile isn't blank while it
  // waits. Only pending: their hidden or rejected row is as closed as anyone's.
  const isAdmin = getOptionalAdmin(req) !== null
  if (!row || row.deleted_at) {
    res.writeHead(404).end()
    return
  }
  if (!variantValidForKind(variant, row.kind)) {
    res.writeHead(404).end()
    return
  }
  const isPublicVariant = PUBLIC_VARIANTS.has(variant)
  const isVisible = row.status === MEDIA_STATUS.APPROVED || isOwnPending(req, row)
  if (!isAdmin && (!isPublicVariant || !isVisible)) {
    res.writeHead(404).end()
    return
  }

  const servable = resolveServable(row, variant)
  if (!servable) {
    // needs_display images legitimately lack display/thumb (client shows a
    // placeholder); a missing original/poster is stat-vs-row drift.
    res.writeHead(404).end()
    return
  }

  /** @type {fs.Stats} */
  let stat
  try {
    stat = fs.statSync(servable.path)
  } catch {
    console.warn("media file missing on disk:", servable.path)
    res.writeHead(404).end()
    return
  }
  const size = stat.size
  const etag = `"${fileKey}-${variant}"`

  /** @type {Record<string, string | number>} */
  const headers = {
    "Content-Type": servable.contentType,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    "ETag": etag,
  }
  if (variant === "original") {
    headers["Cache-Control"] = "private, no-store"
    headers["Content-Disposition"] = "attachment"
  } else if (row.status !== MEDIA_STATUS.APPROVED) {
    // Only an admin or the uploader reaches this line for a row that isn't public,
    // and a shared cache must not keep what it was shown: the long-lived public
    // header below would let a reverse proxy answer everyone else without asking the
    // gate above. no-cache plus the ETag keeps a grid cheap, as a 304, and asks the
    // gate again, so a photo rejected later stops showing for its uploader too.
    headers["Cache-Control"] = "private, no-cache"
  } else if (
    row.section === MEDIA_SECTION.OFFICIAL ||
    row.section === MEDIA_SECTION.HONEYMOON ||
    row.section === MEDIA_SECTION.CONTENT
  ) {
    // The file behind a file_key never changes, but its visibility does: the couple
    // hide curated photos, and a hidden one must disappear for prior viewers within
    // ~10 minutes. So no `immutable`; after max-age the browser (or a shared cache)
    // revalidates with the ETag, and that request passes the visibility gate above
    // before the 304 is considered, so a hidden photo answers 404. (Static images
    // under public/images are served by core/static.js, not here.)
    headers["Cache-Control"] = "public, max-age=600"
  } else {
    // A hidden guest photo must actually disappear for prior viewers within ~a day.
    headers["Cache-Control"] = "public, max-age=86400"
  }

  // If-None-Match is evaluated BEFORE Range (RFC 9110 §13.2.2): a matching
  // conditional with a Range present is a 304, not a 206.
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }

  // HEAD mirrors a GET-without-range: full headers, Content-Length, empty body.
  if (req.method === "HEAD") {
    headers["Content-Length"] = size
    res.writeHead(200, headers)
    res.end()
    return
  }

  const range = parseRange(req.headers.range ?? null, size)
  if (range === "invalid") {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` })
    res.end()
    return
  }

  if (range === null) {
    headers["Content-Length"] = size
    res.writeHead(200, headers)
    const rs = fs.createReadStream(servable.path)
    pipeline(rs, res, () => {}) // client-abort teardown; no fd leak
    return
  }

  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`
  headers["Content-Length"] = range.end - range.start + 1
  res.writeHead(206, headers)
  const rs = fs.createReadStream(servable.path, { start: range.start, end: range.end })
  pipeline(rs, res, () => {})
}
