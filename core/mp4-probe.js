/** @file Duration and display dimensions for MP4/QuickTime, read straight from
 *  the container. Peer of mp4-meta.js, built on the same box primitives
 *  (mp4-boxes.js).
 *
 *  Exists so scripts/import-media.js can import videos without ffprobe: a video
 *  media row needs duration_seconds plus width/height, and the browser path gets
 *  those from a <video> element (media-processing.js) that a CLI has no access
 *  to. Everything needed lives in moov/mvhd and moov/trak/tkhd, so only the moov
 *  subtree is ever read — mdat, which is essentially the whole file, is skipped.
 *
 *  Zero-dep, no regex. Never throws: a truncated or non-ISO-BMFF file returns
 *  null and the caller decides what that means. */
/** @import * as Types from './types.js' */

import fs from "node:fs"

import { childBoxes, findChildBox, findTopLevelBox, readBox } from "./mp4-boxes.js"

// Handler type marking the trak that carries picture data (ISO/IEC 14496-12).
const VIDEO_HANDLER = "vide"
// tkhd trailing layout: [...matrix(36)][width(4)][height(4)], all fixed-point.
const TKHD_WIDTH_FROM_END = 8
const TKHD_HEIGHT_FROM_END = 4
const TKHD_MATRIX_FROM_END = 44
// A 16.16 fixed-point value is an integer scaled by 65536.
const FIXED_16_16 = 65536

/**
 * Read the version byte of a fullbox (version + 24-bit flags at contentStart).
 * @param {Buffer} buf @param {Types.Mp4Box} box @returns {number | null}
 */
function fullBoxVersion(buf, box) {
  if (box.contentStart + 4 > box.boxEnd) return null
  return buf.readUInt8(box.contentStart)
}

/**
 * moov/mvhd → duration in seconds. Layout after version/flags:
 *   v0: creation(4) modification(4) timescale(4) duration(4)
 *   v1: creation(8) modification(8) timescale(4) duration(8)
 * A zero timescale (or a duration of 0xFFFFFFFF, the "unknown" sentinel) yields
 * null rather than Infinity or a nonsense number.
 * @param {Buffer} buf @param {Types.Mp4Box} mvhd @returns {number | null}
 */
function readMvhdDuration(buf, mvhd) {
  const version = fullBoxVersion(buf, mvhd)
  if (version === null) return null
  const cs = mvhd.contentStart
  let timescale
  let duration
  if (version === 1) {
    if (cs + 32 > mvhd.boxEnd) return null
    timescale = buf.readUInt32BE(cs + 20)
    duration = buf.readUInt32BE(cs + 24) * 2 ** 32 + buf.readUInt32BE(cs + 28)
  } else {
    if (cs + 20 > mvhd.boxEnd) return null
    timescale = buf.readUInt32BE(cs + 12)
    duration = buf.readUInt32BE(cs + 16)
    if (duration === 0xffffffff) return null // "unknown duration" sentinel
  }
  if (!timescale || !Number.isFinite(duration)) return null
  return duration / timescale
}

/**
 * True when this trak's mdia/hdlr declares a video handler.
 * @param {Buffer} buf @param {Types.Mp4Box} trak @returns {boolean}
 */
function isVideoTrak(buf, trak) {
  const mdia = findChildBox(buf, trak, "mdia")
  if (!mdia) return false
  const hdlr = findChildBox(buf, mdia, "hdlr")
  if (!hdlr) return false
  // hdlr: version/flags(4) pre_defined(4) handler_type(4) ...
  const at = hdlr.contentStart + 8
  if (at + 4 > hdlr.boxEnd) return false
  return buf.toString("latin1", at, at + 4) === VIDEO_HANDLER
}

/**
 * tkhd → display dimensions, with the transform matrix applied for the quarter
 * turns cameras actually produce. A 90°/270° rotation has a zero diagonal and a
 * non-zero anti-diagonal, which means the stored width/height are swapped
 * relative to how the frame should be shown — exactly the case of an iPhone
 * clip recorded upright.
 * @param {Buffer} buf @param {Types.Mp4Box} tkhd
 * @returns {{ width: number, height: number, rotation: number } | null}
 */
function readTkhdDimensions(buf, tkhd) {
  const end = tkhd.boxEnd
  if (end - tkhd.contentStart < TKHD_MATRIX_FROM_END) return null
  const width = buf.readUInt32BE(end - TKHD_WIDTH_FROM_END) / FIXED_16_16
  const height = buf.readUInt32BE(end - TKHD_HEIGHT_FROM_END) / FIXED_16_16
  if (width <= 0 || height <= 0) return null

  // Matrix is [a b u; c d v; x y w] as 9 32-bit values; a/b/c/d are 16.16.
  const m = end - TKHD_MATRIX_FROM_END
  const a = buf.readInt32BE(m)
  const b = buf.readInt32BE(m + 4)
  const c = buf.readInt32BE(m + 12)
  const d = buf.readInt32BE(m + 16)
  const quarterTurn = a === 0 && d === 0 && b !== 0 && c !== 0
  const rotation = quarterTurn ? (b > 0 ? 90 : 270) : 0

  return quarterTurn
    ? { width: Math.round(height), height: Math.round(width), rotation }
    : { width: Math.round(width), height: Math.round(height), rotation }
}

/**
 * Pick the video trak's display dimensions. Falls back to the first trak with
 * usable dimensions when no hdlr says "vide" (some muxers omit it).
 * @param {Buffer} buf @param {Types.Mp4Box} moov
 * @returns {{ width: number, height: number, rotation: number } | null}
 */
function readVideoDimensions(buf, moov) {
  /** @type {{ width: number, height: number, rotation: number } | null} */
  let fallback = null
  for (const trak of childBoxes(buf, moov.contentStart, moov.boxEnd)) {
    if (trak.type !== "trak") continue
    const tkhd = findChildBox(buf, trak, "tkhd")
    if (!tkhd) continue
    const dims = readTkhdDimensions(buf, tkhd)
    if (!dims) continue
    if (isVideoTrak(buf, trak)) return dims
    if (!fallback) fallback = dims
  }
  return fallback
}

/** @type {Types.probeMp4} */
export async function probeMp4(filePath) {
  /** @type {import('node:fs/promises').FileHandle | undefined} */
  let fh
  try {
    fh = await fs.promises.open(filePath, "r")
    const { size: fileSize } = await fh.stat()
    const moovRange = await findTopLevelBox(fh, fileSize, "moov")
    if (!moovRange) return null

    const moovBuf = Buffer.alloc(moovRange.end - moovRange.start)
    const { bytesRead } = await fh.read(moovBuf, 0, moovBuf.length, moovRange.start)
    if (bytesRead < moovBuf.length) return null

    const moov = readBox(moovBuf, 0, moovBuf.length)
    if (!moov || moov.type !== "moov") return null

    const mvhd = findChildBox(moovBuf, moov, "mvhd")
    const durationSeconds = mvhd ? readMvhdDuration(moovBuf, mvhd) : null
    const dims = readVideoDimensions(moovBuf, moov)
    if (durationSeconds === null && !dims) return null

    return {
      durationSeconds,
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
      rotation: dims ? dims.rotation : 0,
    }
  } catch {
    // Unreadable, truncated, or not ISO-BMFF at all. The caller treats null as
    // "couldn't probe" and reports it per-file; never fail a whole import here.
    return null
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}
