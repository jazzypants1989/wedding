/** @file Import sink that writes media rows and variant files directly, by
 *  importing the server's own modules — the same thing scripts/seed-preview.js
 *  and scripts/seed-demo.js already do.
 *
 *  The reason this is not an HTTP client in disguise: there is nothing to
 *  duplicate. file_key generation, the on-disk layout, the sniff allowlist, the
 *  per-variant byte caps, the disk guard and the finalize completeness check all
 *  come from db/media.js, core/media-storage.js, core/sniff.js and
 *  api/media.js's exported VARIANT_SPEC. What it gains over the API is the two
 *  things the API genuinely cannot do: set sort_order exactly, and skip the
 *  network for a few hundred multi-megabyte originals.
 *
 *  Requires the server to be stopped, or at least not mid-write: SQLite is in
 *  WAL mode with a 5s busy timeout, so a concurrent writer means a stall, not
 *  corruption, but a long import next to a live server is not the intent. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import crypto from "node:crypto"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { VARIANT_SPEC } from "../../api/media.js"
import { blankVideoGps } from "../../core/mp4-meta.js"
import {
  TMP_DIR,
  ensureUploadDirs,
  itemDir,
  variantDiskPath,
  variantExistsOnDisk,
} from "../../core/media-storage.js"
import { contentTypeAgrees, extForSniff, sniffMagic } from "../../core/sniff.js"
import { close as closeDb, init as initDb } from "../../db/connection.js"
import {
  createMediaRow,
  finalizeMedia,
  getMediaById,
  getOfficialMediaIds,
  hardDeleteMedia,
  setMediaOriginalExt,
  setMediaSortOrders,
  setMediaVariantBytes,
  sumOriginalBytes,
  updateMediaCaption,
} from "../../db/media.js"
import { withTransaction } from "../../db/utils.js"
import { MEDIA_KIND, MEDIA_STATUS, MEDIA_STORAGE, expectedVariants } from "../../types.js"
import { MediaImportError } from "./media-errors.js"

/** Same 32 bytes core/upload.js buffers to sniff a stream. */
const SNIFF_BYTES = 32

/** Where the database lives, honouring the same override as every other script. */
function defaultDatabasePath() {
  return (
    process.env.DATABASE_PATH || path.join(import.meta.dirname, "..", "..", "data", "wedding.db")
  )
}

/**
 * Free bytes on the volume holding the uploads tree. Mirrors passesDiskGuard in
 * api/media.js, which statfs's TMP_DIR for the same reason: that is where the
 * bytes actually land.
 * @returns {number | null}
 */
function freeBytesOnDataVolume() {
  for (const dir of [TMP_DIR, path.dirname(TMP_DIR), process.cwd()]) {
    try {
      const s = fs.statfsSync(dir)
      return s.bavail * s.bsize
    } catch {
      // Directory may not exist yet on a fresh checkout — try the parent.
    }
  }
  return null
}

/**
 * Read the stored-originals total without initializing (and therefore
 * migrating) the database. --dry-run must not create a database that wasn't
 * there, nor run migrations against one that was.
 * @param {string} databasePath
 * @returns {{ storedBytes: number | null, message?: string }}
 */
function readStoredBytes(databasePath) {
  if (!fs.existsSync(databasePath)) {
    return {
      storedBytes: null,
      message: `No database at ${databasePath} yet — it will be created on the first real import.`,
    }
  }
  let db
  try {
    db = new DatabaseSync(databasePath, { readOnly: true })
    const row = /** @type {{ total: number } | undefined} */ (
      db.prepare("SELECT COALESCE(SUM(original_bytes), 0) AS total FROM media WHERE deleted_at IS NULL").get()
    )
    return { storedBytes: row ? row.total : 0 }
  } catch (err) {
    return {
      storedBytes: null,
      message: `Couldn't read stored media totals: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    db?.close()
  }
}

/** @type {Types.createLocalSink} */
export function createLocalSink(options = {}) {
  const databasePath = options.databasePath ?? defaultDatabasePath()
  const readOnly = options.readOnly === true
  let opened = false

  /** Open the shared connection lazily, so --dry-run never triggers migrations. */
  function db() {
    if (readOnly) {
      throw new Error("sink-local is in read-only mode — no write path is available")
    }
    if (!opened) {
      // init() applies the server's pragmas, creates tables, runs migrations and
      // binds the sql`` executor. Doing it here rather than by hand keeps this
      // sink from drifting from the schema the server expects.
      initDb()
      ensureUploadDirs()
      opened = true
    }
  }

  /**
   * The row, or a hard failure. A missing row mid-import means the sink and the
   * database disagree, which is a bug rather than a per-file problem.
   * @param {number} id
   */
  function requireRow(id) {
    const row = getMediaById(id)
    if (!row) throw new Error(`Media row ${id} vanished mid-import`)
    return row
  }

  return {
    name: "local",

    async preflight() {
      const freeBytes = freeBytesOnDataVolume()
      const { storedBytes, message } = readStoredBytes(databasePath)
      if (freeBytes !== null && freeBytes < MEDIA_STORAGE.MIN_FREE_BYTES) {
        return {
          ok: false,
          freeBytes,
          storedBytes,
          message:
            `Only ${formatBytes(freeBytes)} free on the data volume, below the ` +
            `${formatBytes(MEDIA_STORAGE.MIN_FREE_BYTES)} headroom the server insists on ` +
            `(raise MEDIA_MIN_FREE_BYTES to override).`,
        }
      }
      if (storedBytes !== null && storedBytes >= MEDIA_STORAGE.MAX_TOTAL_BYTES) {
        return {
          ok: false,
          freeBytes,
          storedBytes,
          message:
            `Stored originals are already ${formatBytes(storedBytes)}, at the ` +
            `${formatBytes(MEDIA_STORAGE.MAX_TOTAL_BYTES)} cap (MEDIA_MAX_TOTAL_BYTES).`,
        }
      }
      return { ok: true, freeBytes, storedBytes, message }
    },

    async createSession({ kind, originalBytes, section }) {
      db()
      // Re-run the server's guard against live totals, not the preflight
      // snapshot: 200 originals move the number a lot as the run proceeds.
      if (sumOriginalBytes() + originalBytes > MEDIA_STORAGE.MAX_TOTAL_BYTES) {
        throw new MediaImportError(
          "SOURCE_TOO_LARGE",
          `Storage is full — stored originals would exceed the ${formatBytes(MEDIA_STORAGE.MAX_TOTAL_BYTES)} cap.`,
        )
      }
      const free = freeBytesOnDataVolume()
      if (free !== null && free - originalBytes < MEDIA_STORAGE.MIN_FREE_BYTES) {
        throw new MediaImportError(
          "SOURCE_TOO_LARGE",
          `Storage is full — less than ${formatBytes(MEDIA_STORAGE.MIN_FREE_BYTES)} would be left free.`,
        )
      }

      const fileKey = crypto.randomBytes(16).toString("hex")
      fs.mkdirSync(itemDir(fileKey), { recursive: true })
      // accountId null is what withAccountOrAdmin gives an admin principal, so
      // these rows look exactly like admin uploads through the modal.
      const row = createMediaRow({ fileKey, accountId: null, kind, section, originalBytes })
      return { id: row.id, fileKey }
    },

    async putVariant(id, variant, file) {
      db()
      const row = requireRow(id)
      const spec = VARIANT_SPEC[variant]?.[row.kind]
      if (!spec) {
        throw new MediaImportError(
          "VARIANT_FORMAT_MISMATCH",
          `${variant} is not a valid variant for a ${row.kind} — the server would reject it with 400.`,
        )
      }
      if (file.bytes > spec.maxBytes) {
        throw new MediaImportError(
          "VARIANT_TOO_LARGE",
          `${variant} is ${formatBytes(file.bytes)}, over the ${formatBytes(spec.maxBytes)} the server allows.`,
        )
      }

      // Sniff the bytes about to be stored and apply the server's two gates:
      // the per-variant kind allowlist, and Content-Type agreeing with content.
      const head = Buffer.alloc(SNIFF_BYTES)
      const fd = fs.openSync(file.path, "r")
      try {
        fs.readSync(fd, head, 0, SNIFF_BYTES, 0)
      } finally {
        fs.closeSync(fd)
      }
      const sniffed = sniffMagic(head)
      if (!spec.expectedKinds.includes(sniffed)) {
        throw new MediaImportError(
          "VARIANT_FORMAT_MISMATCH",
          `${variant} sniffed as ${sniffed || "an unrecognized format"}; the server accepts ${spec.expectedKinds.join(", ")} here.`,
        )
      }
      if (!contentTypeAgrees(file.contentType, sniffed)) {
        throw new MediaImportError(
          "VARIANT_FORMAT_MISMATCH",
          `${variant}'s Content-Type ${file.contentType} disagrees with its ${sniffed} bytes.`,
        )
      }

      const ext = extForSniff(sniffed)
      const dest = variantDiskPath(row.file_key, variant, ext)
      fs.mkdirSync(itemDir(row.file_key), { recursive: true })
      // Copy, never rename: for `original` the source is the user's own photo
      // library, and for derived variants it is a work dir that gets disposed.
      fs.copyFileSync(file.path, dest)
      const bytes = fs.statSync(dest).size

      if (variant === "original") {
        setMediaOriginalExt(row.id, ext)
        setMediaVariantBytes(row.id, "original", bytes)
      } else {
        setMediaVariantBytes(row.id, variant, bytes)
      }
      return { bytes }
    },

    async finalize(id, input) {
      db()
      const row = requireRow(id)

      // The same completeness check finalize() runs, so a missing variant is
      // caught here rather than surfacing later as a broken gallery tile.
      for (const variant of expectedVariants(row.kind, row.section, false)) {
        if (!variantExistsOnDisk(row.file_key, variant, row.original_ext)) {
          throw new MediaImportError(
            "BACKEND_FAILED",
            `${variant} never landed on disk for media ${row.id} — refusing to finalize an incomplete row.`,
          )
        }
      }

      // A video's original becomes the public `video` variant only once its GPS
      // atoms are blanked in place. api/media.js does this at finalize; so must
      // this, or the CLI would publish location data the API strips.
      if (row.kind === MEDIA_KIND.VIDEO && row.original_ext) {
        await blankVideoGps(variantDiskPath(row.file_key, "original", row.original_ext))
      }

      // One transaction for the whole state change: an interrupted finalize
      // leaves the row 'uploading', which the abandoned-upload sweep collects.
      const finalized = withTransaction(() => {
        const result = finalizeMedia(row.id, {
          width: input.width,
          height: input.height,
          durationS: input.durationS,
          needsDisplay: false,
          status: MEDIA_STATUS.APPROVED,
        })
        if (input.caption !== null) updateMediaCaption(row.id, input.caption)
        return result
      })
      return { id: finalized.id, status: finalized.status }
    },

    async discard(id) {
      if (readOnly) return
      db()
      const row = getMediaById(id)
      if (!row) return
      // Never went public and carries no audit value, so remove it outright —
      // the same disposal the abandoned-upload sweep and the finalize quota
      // violation path use.
      fs.rmSync(itemDir(row.file_key), { recursive: true, force: true })
      hardDeleteMedia(row.id)
    },

    async applyOrder(orderedIds) {
      if (orderedIds.length === 0) return { ok: true }
      db()
      // Exact, unlike the HTTP sink: sort_order is a column, and this is the
      // same helper the admin reorder endpoint calls. Ids the importer did not
      // create keep their existing order by being appended in current order —
      // an import must not reshuffle photos that were already curated.
      const existing = getOfficialMediaIds()
      const imported = new Set(orderedIds)
      const untouched = existing.filter((id) => !imported.has(id))
      const ids = [...untouched, ...orderedIds.filter((id) => existing.includes(id))]
      withTransaction(() => setMediaSortOrders(ids))
      return { ok: true }
    },

    async close() {
      if (opened) {
        closeDb()
        opened = false
      }
    },
  }
}

/**
 * Human-readable byte count. Duplicated from media-variants.js rather than
 * exported from it: it is four lines and this module has no other reason to
 * depend on the variant builder.
 * @param {number} bytes @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
