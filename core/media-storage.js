/** @file Filesystem layout + path derivation for media storage. All paths are
 *  built server-side from a validated file_key + variant + ext — never stored
 *  absolute, never derived from a client filename. Lives under the same data
 *  volume as the DB so staging→final renames are atomic (same filesystem).
 *  See docs/post-wedding/03-media-pipeline.md §6. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"

const DB_PATH =
  process.env.DATABASE_PATH ||
  path.join(import.meta.dirname, "..", "data", "wedding.db")
const DATA_DIR = path.dirname(DB_PATH)

export const UPLOADS_DIR = path.join(DATA_DIR, "uploads")
export const TMP_DIR = path.join(UPLOADS_DIR, "tmp") // {rand16hex}.part staging
export const QUARANTINE_DIR = path.join(UPLOADS_DIR, "quarantine") // orphans
export const MEDIA_DIR = path.join(UPLOADS_DIR, "media") // {key[0:2]}/{key}/

// Public variants and the on-disk extensions each may carry, most-preferred
// first (display/thumb may be webp or jpeg; poster is jpeg). Used to resolve a
// variant file whose ext isn't in the DB.
/** @type {Record<string, string[]>} */
const PUBLIC_VARIANT_EXTS = {
  display: ["webp", "jpg"],
  thumb: ["webp", "jpg"],
  poster: ["jpg", "webp"],
  // Content-section responsive width ladder (same webp/jpeg encode as display/thumb).
  w400: ["webp", "jpg"],
  w800: ["webp", "jpg"],
  w1600: ["webp", "jpg"],
}

/** @type {Record<string, string>} */
const CONTENT_TYPE_BY_EXT = {
  jpg: "image/jpeg",
  webp: "image/webp",
  png: "image/png",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
}

/** @type {Types.ensureUploadDirs} */
export function ensureUploadDirs() {
  for (const dir of [TMP_DIR, QUARANTINE_DIR, MEDIA_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/** @type {Types.itemDir} */
export function itemDir(fileKey) {
  return path.join(MEDIA_DIR, fileKey.slice(0, 2), fileKey)
}

/** @type {Types.variantDiskPath} */
export function variantDiskPath(fileKey, variant, ext) {
  return path.join(itemDir(fileKey), variant + "." + ext)
}

/** @type {Types.quarantineItemDir} */
export function quarantineItemDir(fileKey) {
  const src = itemDir(fileKey)
  if (!fs.existsSync(src)) return
  fs.mkdirSync(QUARANTINE_DIR, { recursive: true })
  let dest = path.join(QUARANTINE_DIR, fileKey)
  // A prior quarantine of the same key (re-reject after manual restore) would
  // make the rename fail — pick a suffixed name instead of throwing.
  if (fs.existsSync(dest)) dest = dest + "-" + Date.now()
  fs.renameSync(src, dest)
  // Stamp the quarantine time so the sweep's TTL measures from now: renameSync
  // preserves the dir's mtime (original upload time), which would otherwise let
  // a long-ago-uploaded item be purged the instant it's rejected.
  try {
    const t = new Date()
    fs.utimesSync(dest, t, t)
  } catch {
    // Best-effort; a missed stamp only shortens this item's recovery window.
  }
}

/** @type {Types.restoreQuarantinedItemDir} */
export function restoreQuarantinedItemDir(fileKey) {
  // The inverse of quarantineItemDir, for an Undo of a reject (or "Move back to
  // review") before the sweep purges it. The newest copy wins when a key was
  // quarantined more than once ("<key>" or "<key>-<epochms>").
  const dest = itemDir(fileKey)
  if (fs.existsSync(dest)) return true
  /** @type {string[]} */
  let names = []
  try {
    names = fs.readdirSync(QUARANTINE_DIR)
  } catch {
    return false
  }
  let best = ""
  let bestStamp = -1
  for (const name of names) {
    let stamp = -1
    if (name === fileKey) stamp = 0
    else if (name.startsWith(fileKey + "-")) {
      const n = Number(name.slice(fileKey.length + 1))
      if (Number.isInteger(n) && n > 0) stamp = n
    }
    if (stamp > bestStamp) {
      best = name
      bestStamp = stamp
    }
  }
  if (!best) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.renameSync(path.join(QUARANTINE_DIR, best), dest)
  return true
}

/** @type {Types.contentTypeForExt} */
export function contentTypeForExt(ext) {
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream"
}

/** @type {Types.resolveVariantFile} */
export function resolveVariantFile(fileKey, variant) {
  const exts = PUBLIC_VARIANT_EXTS[variant]
  if (!exts) return null
  for (const ext of exts) {
    const p = variantDiskPath(fileKey, variant, ext)
    if (fs.existsSync(p)) return { path: p, ext, contentType: contentTypeForExt(ext) }
  }
  return null
}

/** @type {Types.variantExistsOnDisk} */
export function variantExistsOnDisk(fileKey, variant, originalExt) {
  if (variant === "original") {
    return !!originalExt && fs.existsSync(variantDiskPath(fileKey, "original", originalExt))
  }
  return resolveVariantFile(fileKey, variant) !== null
}
