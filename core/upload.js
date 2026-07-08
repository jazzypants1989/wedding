/** @file Streaming upload write path for media originals + variants.
 *  Raw binary bodies stream straight to a staging file (never buffered whole
 *  in memory like parseBody), guarded by magic-byte sniffing, size caps, and
 *  idle/absolute timers, then atomically renamed into place by the caller.
 *  See docs/post-wedding/03-media-pipeline.md §3. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { MEDIA_LIMITS } from "../types.js"
import {
  ValidationError,
  PayloadTooLargeError,
  LengthRequiredError,
  UnsupportedMediaTypeError,
} from "./validation.js"
import { sniffMagic } from "./sniff.js"

// --- In-flight accounting (best-effort, module-level, reset on restart) ---
// The per-account concurrency cap is an abuse guard for guests; admin uploads
// (accountId null) are uncapped. reservedBytes lets the disk guard account for
// bytes committed by in-flight uploads that haven't hit the DB yet (ENOSPC race).
/** @type {Map<number, number>} */
const activeUploads = new Map()
let reservedBytes = 0

/** @type {Types.reserveUploadSlot} */
export function reserveUploadSlot(accountId, bytes) {
  if (accountId !== null) {
    const count = activeUploads.get(accountId) ?? 0
    if (count >= MEDIA_LIMITS.MAX_CONCURRENT_UPLOADS_PER_ACCOUNT) return false
    activeUploads.set(accountId, count + 1)
  }
  reservedBytes += bytes
  return true
}

/** @type {Types.releaseUploadSlot} */
export function releaseUploadSlot(accountId, bytes) {
  if (accountId !== null) {
    const count = activeUploads.get(accountId) ?? 0
    if (count <= 1) activeUploads.delete(accountId)
    else activeUploads.set(accountId, count - 1)
  }
  reservedBytes = Math.max(0, reservedBytes - bytes)
}

/** @type {Types.getReservedBytes} */
export function getReservedBytes() {
  return reservedBytes
}

/** @type {Types.streamToStaging} */
export async function streamToStaging(req, opts) {
  const declared = Number(req.headers["content-length"])
  // 411: a raw PUT with no length can't be size-guarded up front. ValidationError
  // would map to 400 and fail the 411 contract — hence the dedicated class.
  if (!Number.isInteger(declared) || declared <= 0) throw new LengthRequiredError()
  if (declared > opts.maxBytes) throw new PayloadTooLargeError()

  const stagingPath = path.join(
    opts.stagingDir,
    crypto.randomBytes(16).toString("hex") + ".part",
  )
  let bytes = 0
  /** @type {Types.SniffedType} */
  let sniffed = ""
  let headBuf = Buffer.alloc(0)
  const hash = crypto.createHash("sha256")

  // Idle timer (reset per chunk) + absolute timer — both destroy the socket on
  // fire, which rejects the pipeline() below and unlinks the partial file.
  /** @type {NodeJS.Timeout | null} */
  let idleTimer = null
  const absoluteTimer = setTimeout(
    () => req.destroy(new Error("Upload absolute timeout")),
    MEDIA_LIMITS.UPLOAD_ABSOLUTE_TIMEOUT_MS,
  )
  const clearTimers = () => {
    if (idleTimer) clearTimeout(idleTimer)
    clearTimeout(absoluteTimer)
  }
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(
      () => req.destroy(new Error("Upload idle timeout")),
      MEDIA_LIMITS.UPLOAD_IDLE_TIMEOUT_MS,
    )
  }
  resetIdle()

  const guard = new Transform({
    transform(chunk, _enc, cb) {
      resetIdle()
      bytes += chunk.length
      // Enforce both the variant cap and the client's own declared length.
      if (bytes > opts.maxBytes || bytes > declared) {
        return cb(new PayloadTooLargeError())
      }
      if (headBuf.length < MEDIA_LIMITS.HEAD_SNIFF_BYTES) {
        headBuf = Buffer.concat([headBuf, chunk]).subarray(
          0,
          MEDIA_LIMITS.HEAD_SNIFF_BYTES,
        )
        if (headBuf.length >= 12 && !sniffed) {
          sniffed = sniffMagic(headBuf)
          // Fail fast on a wrong type — don't spool the whole (bad) body first.
          if (!opts.expectedKinds.includes(sniffed)) {
            return cb(new UnsupportedMediaTypeError("Unsupported file type"))
          }
        }
      }
      hash.update(chunk)
      cb(null, chunk)
    },
  })

  // flags "wx" fails if the (random) path somehow exists; flush fsyncs the file
  // before close. The dir entry after rename isn't fsynced — accepted (the
  // hourly integrity pass + re-PUT idempotency cover a crash-after-rename).
  const ws = fs.createWriteStream(stagingPath, { flags: "wx", flush: true })
  try {
    await pipeline(req, guard, ws)
    if (bytes !== declared) {
      throw new ValidationError("Body shorter than Content-Length")
    }
    if (!sniffed || !opts.expectedKinds.includes(sniffed)) {
      throw new UnsupportedMediaTypeError("Unsupported file type")
    }
    return { stagingPath, bytes, sniffed, sha256: hash.digest("hex") }
  } catch (err) {
    // Await cleanup so the staging file is gone before the error propagates
    // (the hourly tmp sweep is the backstop if the unlink itself fails).
    await fs.promises.unlink(stagingPath).catch(() => {})
    throw err
  } finally {
    clearTimers()
  }
}
