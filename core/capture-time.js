/** @file A photo's EXIF capture time, read from its stored original, plus the
 *  strict shape check for one an importer declares. The twin scan matches on it
 *  (db/media-twins.js), so it is written at finalize and back-filled later.
 *  Pure JS over core/image-meta.js's header reader; no decoding, no regex. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import { readExifSummary } from "./image-meta.js"

/** A JPEG's EXIF sits in APP1 at the front of the file. PNG and WebP may put it
 *  after the pixels, so those are read whole (an original is size-capped). */
const JPEG_HEAD_BYTES = 256 * 1024

/** @type {Types.readCapturedAt} */
export function readCapturedAt(filePath, ext) {
  if (ext !== "jpg" && ext !== "png" && ext !== "webp") return null
  try {
    if (ext !== "jpg") return readExifSummary(fs.readFileSync(filePath)).capturedAt
    const fd = fs.openSync(filePath, "r")
    try {
      const buf = Buffer.alloc(JPEG_HEAD_BYTES)
      const n = fs.readSync(fd, buf, 0, JPEG_HEAD_BYTES, 0)
      return readExifSummary(buf.subarray(0, n)).capturedAt
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    // A missing or unreadable original has no capture time; never an error.
    return null
  }
}

/**
 * True when every character of `text` is a decimal digit.
 * @param {string} text @returns {boolean}
 */
function isDigits(text) {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/** @type {Types.parseCapturedAt} */
export function parseCapturedAt(value) {
  // Exactly what readExifSummary produces: "YYYY-MM-DD HH:MM:SS".
  if (typeof value !== "string" || value.length !== 19) return null
  const [date, time, extra] = value.split(" ")
  if (extra !== undefined || !date || !time) return null
  const d = date.split("-")
  const t = time.split(":")
  if (d.length !== 3 || t.length !== 3) return null
  const widths = [4, 2, 2, 2, 2, 2]
  const parts = [...d, ...t]
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].length !== widths[i] || !isDigits(parts[i])) return null
  }
  if (parts[0] === "0000") return null
  return value
}
