/** @file Periodic media housekeeping, hooked into server.js's hourly interval.
 *  Hourly: purge abandoned upload sessions + stale staging files. Daily (every
 *  24th tick): a full integrity pass — quarantine files with no DB row, and log
 *  finalized rows whose expected variant files are missing. Never auto-hard-
 *  deletes content files. See docs/post-wedding/03-media-pipeline.md §2. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"
import {
  getAbandonedUploads,
  hardDeleteMedia,
  getAllMediaFileKeys,
  getFinalizedMediaForIntegrity,
} from "../db/media.js"
import {
  TMP_DIR,
  MEDIA_DIR,
  QUARANTINE_DIR,
  itemDir,
  variantExistsOnDisk,
} from "./media-storage.js"
import { MEDIA_LIMITS, expectedVariants } from "../types.js"

const HOURS = MEDIA_LIMITS.ABANDONED_UPLOAD_MAX_AGE_MS / 3_600_000

let tickCount = 0

/** @type {Types.cleanAbandonedUploads} */
export function cleanAbandonedUploads() {
  let rowsDeleted = 0
  let tmpDeleted = 0

  // 1. Abandoned 'uploading' rows (older than the cutoff): hard-delete the row
  //    (never went public, no audit value) and its item directory.
  for (const row of getAbandonedUploads(`-${HOURS} hours`)) {
    fs.rmSync(itemDir(row.file_key), { recursive: true, force: true })
    hardDeleteMedia(row.id)
    rowsDeleted++
  }

  // 2. Stale staging files: tmp/*.part older than STAGING_PART_MAX_AGE_MS.
  const cutoffMs = MEDIA_LIMITS.STAGING_PART_MAX_AGE_MS
  /** @type {string[]} */
  let entries = []
  try {
    entries = fs.readdirSync(TMP_DIR)
  } catch {
    // TMP_DIR not created yet — nothing to sweep.
  }
  for (const name of entries) {
    if (!name.endsWith(".part")) continue
    const p = path.join(TMP_DIR, name)
    try {
      const stat = fs.statSync(p)
      if (nowMs() - stat.mtimeMs > cutoffMs) {
        fs.rmSync(p, { force: true })
        tmpDeleted++
      }
    } catch {
      // Raced with another sweep / already gone.
    }
  }

  if (rowsDeleted > 0 || tmpDeleted > 0) {
    console.log(`media sweep: removed ${rowsDeleted} abandoned upload(s), ${tmpDeleted} stale staging file(s)`)
  }
  return { rowsDeleted, tmpDeleted }
}

/** @type {Types.runMediaIntegrityPass} */
export function runMediaIntegrityPass() {
  let quarantined = 0
  let missingVariants = 0

  // A. Files with no DB row → quarantine (never auto-hard-delete). Because rows
  //    are only ever soft-deleted, a directory with no matching row is genuine
  //    orphan/crash debris.
  const knownKeys = new Set(getAllMediaFileKeys().map((r) => r.file_key))
  /** @type {string[]} */
  let prefixes = []
  try {
    prefixes = fs.readdirSync(MEDIA_DIR)
  } catch {
    prefixes = []
  }
  for (const prefix of prefixes) {
    const prefixPath = path.join(MEDIA_DIR, prefix)
    /** @type {string[]} */
    let keys = []
    try {
      if (!fs.statSync(prefixPath).isDirectory()) continue
      keys = fs.readdirSync(prefixPath)
    } catch {
      continue
    }
    for (const key of keys) {
      if (knownKeys.has(key)) continue
      try {
        fs.mkdirSync(QUARANTINE_DIR, { recursive: true })
        fs.renameSync(path.join(prefixPath, key), path.join(QUARANTINE_DIR, key))
        quarantined++
        console.warn(`media integrity: quarantined orphan directory ${key}`)
      } catch {
        // Best-effort; log-and-continue.
      }
    }
  }

  // B. Finalized rows whose expected variant files are missing → log loudly.
  //    Expectations are computed per-row via the shared expectedVariants() (same
  //    source finalize gates on): video → poster, content images → the width
  //    ladder, needs_display HEIC fallbacks → original-only (no false alarms).
  for (const row of getFinalizedMediaForIntegrity()) {
    const expected = expectedVariants(row.kind, row.section, !!row.needs_display)
    for (const variant of expected) {
      if (!variantExistsOnDisk(row.file_key, variant, row.original_ext)) {
        missingVariants++
        console.error(
          `media integrity: row ${row.id} (${row.file_key}) missing ${variant} — admin attention needed`,
        )
      }
    }
  }

  if (quarantined > 0 || missingVariants > 0) {
    console.warn(`media integrity pass: ${quarantined} quarantined, ${missingVariants} missing variant(s)`)
  }
  return { quarantined, missingVariants }
}

/** @type {Types.runMediaMaintenance} */
export function runMediaMaintenance() {
  cleanAbandonedUploads()
  tickCount++
  if (tickCount % 24 === 0) runMediaIntegrityPass()
}

/** Current epoch ms. Wrapped so the module stays free of a raw Date.now() at top level. */
function nowMs() {
  return Date.now()
}
