/** @file Image container reader + lossless metadata filter for JPEG, PNG and
 *  WebP. Pure JS, zero-dep, no regex — Buffer index reads and latin1 compares,
 *  the same house style as mp4-meta.js / mp4-boxes.js.
 *
 *  Why this exists: api/media.js records that public image variants
 *  (display/thumb/w*) are stored as-received, with EXIF removal relying on the
 *  browser's canvas re-encode and no server-side strip. A CLI importer
 *  (scripts/import-media.js) generates those variants with sips/magick/vips —
 *  all of which PRESERVE metadata by default, and sips has no strip flag at all
 *  — so it would publish EXIF-bearing bytes unless something strips them here.
 *  Running stripImageMetadata() over every derived variant makes that guarantee
 *  backend-independent.
 *
 *  stripImageMetadata is a container rewrite, not a re-encode: pixel data is
 *  copied byte-for-byte, so there is no generation loss. The ICC profile is
 *  deliberately KEPT — dropping it (what `magick -strip` does) makes Display-P3
 *  photos render desaturated as sRGB, and a colour profile carries no location
 *  data. */
/** @import * as Types from './types.js' */

// --- JPEG markers (the byte after 0xFF) ---
const M_SOI = 0xd8
const M_EOI = 0xd9
const M_SOS = 0xda
const M_APP0 = 0xe0
const M_APP1 = 0xe1
const M_APP2 = 0xe2
const M_APP15 = 0xef
const M_COM = 0xfe
const M_TEM = 0x01
const M_RST0 = 0xd0
const M_RST7 = 0xd7
// Start-of-frame markers carry the dimensions. 0xC4 (DHT), 0xC8 (JPG) and
// 0xCC (DAC) share the range but are not frame headers.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

// --- EXIF/TIFF ---
const EXIF_IDENT = "Exif\0\0"
const TAG_ORIENTATION = 0x0112
const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATETIME_ORIGINAL = 0x9003
/** Bytes per TIFF value, indexed by type code. 0 marks an unknown type. */
const TIFF_TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]

// --- PNG ---
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** Chunks carrying metadata rather than image data or colour management. */
const PNG_DROP_CHUNKS = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"])

// --- WebP ---
const WEBP_DROP_CHUNKS = new Set(["EXIF", "XMP "])
/** VP8X feature bits, MSB-first in the flags byte. */
const VP8X_FLAG_EXIF = 0x08
const VP8X_FLAG_XMP = 0x04

/**
 * Byte-compare `buf` at `at` against an ASCII literal, bounds-checked.
 * @param {Buffer} buf @param {number} at @param {string} ascii
 * @returns {boolean}
 */
function matchesAt(buf, at, ascii) {
  if (at < 0 || at + ascii.length > buf.length) return false
  for (let i = 0; i < ascii.length; i++) {
    if (buf[at + i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

/** @param {Buffer} buf @returns {boolean} */
function isJpeg(buf) {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === M_SOI && buf[2] === 0xff
}

/** @param {Buffer} buf @returns {boolean} */
function isPng(buf) {
  if (buf.length < PNG_SIGNATURE.length) return false
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return false
  }
  return true
}

/** @param {Buffer} buf @returns {boolean} */
function isWebp(buf) {
  return buf.length >= 12 && matchesAt(buf, 0, "RIFF") && matchesAt(buf, 8, "WEBP")
}

/**
 * Walk JPEG marker segments from just past the SOI, calling `visit` with each
 * one. Returns at SOS (entropy-coded data follows, which is not marker-parsable
 * without decoding) or EOI. `visit` returning false stops the walk early.
 *
 * `segEnd` is one past the segment; for a standalone marker it is start + 2.
 * @param {Buffer} buf
 * @param {(marker: number, start: number, segEnd: number) => boolean | void} visit
 * @returns {number} offset where the walk stopped (SOS/EOI marker, or buf.length)
 */
function walkJpegSegments(buf, visit) {
  let off = 2
  while (off + 1 < buf.length) {
    // Fill bytes: any number of 0xFF may precede a marker code.
    if (buf[off] !== 0xff) return off
    let markerAt = off
    while (markerAt + 1 < buf.length && buf[markerAt + 1] === 0xff) markerAt++
    const marker = buf[markerAt + 1]
    if (marker === M_SOS || marker === M_EOI) return markerAt
    if (marker === M_TEM || (marker >= M_RST0 && marker <= M_RST7)) {
      if (visit(marker, markerAt, markerAt + 2) === false) return markerAt
      off = markerAt + 2
      continue
    }
    if (markerAt + 4 > buf.length) return markerAt
    const length = buf.readUInt16BE(markerAt + 2)
    // The length field counts itself, so anything under 2 is malformed.
    if (length < 2) return markerAt
    const segEnd = markerAt + 2 + length
    if (segEnd > buf.length) return markerAt
    if (visit(marker, markerAt, segEnd) === false) return markerAt
    off = segEnd
  }
  return buf.length
}

/**
 * Dimensions from the first start-of-frame segment.
 * @param {Buffer} buf @returns {{ width: number, height: number } | null}
 */
function readJpegDimensions(buf) {
  /** @type {{ width: number, height: number } | null} */
  let dims = null
  walkJpegSegments(buf, (marker, start, segEnd) => {
    if (!SOF_MARKERS.has(marker)) return
    // SOF payload: precision(1) height(2) width(2) componentCount(1)
    if (start + 9 > segEnd) return false
    dims = { width: buf.readUInt16BE(start + 7), height: buf.readUInt16BE(start + 5) }
    return false
  })
  return dims
}

/**
 * Byte range of the TIFF block inside a JPEG's APP1 "Exif\0\0" segment.
 * @param {Buffer} buf @returns {{ start: number, end: number } | null}
 */
function findJpegExif(buf) {
  /** @type {{ start: number, end: number } | null} */
  let found = null
  walkJpegSegments(buf, (marker, start, segEnd) => {
    if (marker !== M_APP1) return
    if (!matchesAt(buf, start + 4, EXIF_IDENT)) return
    found = { start: start + 4 + EXIF_IDENT.length, end: segEnd }
    return false
  })
  return found
}

/**
 * Iterate PNG chunks after the 8-byte signature.
 * Layout per chunk: length(4) type(4) data(length) crc(4).
 * @param {Buffer} buf
 * @param {(type: string, start: number, chunkEnd: number, dataStart: number, dataLength: number) => boolean | void} visit
 */
function walkPngChunks(buf, visit) {
  let off = PNG_SIGNATURE.length
  while (off + 8 <= buf.length) {
    const length = buf.readUInt32BE(off)
    const type = buf.toString("latin1", off + 4, off + 8)
    const chunkEnd = off + 12 + length
    if (length > buf.length || chunkEnd > buf.length) return
    if (visit(type, off, chunkEnd, off + 8, length) === false) return
    if (type === "IEND") return
    off = chunkEnd
  }
}

/**
 * Iterate RIFF chunks after the 12-byte WebP header. `chunkEnd` includes the
 * pad byte an odd-sized payload carries; `dataLength` does not.
 * @param {Buffer} buf
 * @param {(fourcc: string, start: number, chunkEnd: number, dataStart: number, dataLength: number) => boolean | void} visit
 */
function walkWebpChunks(buf, visit) {
  // Trust the RIFF size field over buf.length when it is the smaller of the two:
  // a truncated download should not read past what actually arrived, and trailing
  // junk after the declared size is not part of the image.
  const declared = buf.readUInt32LE(4) + 8
  const end = Math.min(buf.length, declared)
  let off = 12
  while (off + 8 <= end) {
    const fourcc = buf.toString("latin1", off, off + 4)
    const dataLength = buf.readUInt32LE(off + 4)
    const padded = dataLength + (dataLength % 2)
    const chunkEnd = off + 8 + padded
    if (chunkEnd > end) return
    if (visit(fourcc, off, chunkEnd, off + 8, dataLength) === false) return
    off = chunkEnd
  }
}

/**
 * WebP canvas dimensions, from whichever of VP8X / VP8 / VP8L comes first.
 * @param {Buffer} buf @returns {{ width: number, height: number } | null}
 */
function readWebpDimensions(buf) {
  /** @type {{ width: number, height: number } | null} */
  let dims = null
  walkWebpChunks(buf, (fourcc, start, chunkEnd, dataStart, dataLength) => {
    if (fourcc === "VP8X" && dataLength >= 10) {
      // flags(1) reserved(3) canvasWidth-1(3, LE) canvasHeight-1(3, LE)
      const w = buf.readUIntLE(dataStart + 4, 3) + 1
      const h = buf.readUIntLE(dataStart + 7, 3) + 1
      dims = { width: w, height: h }
      return false
    }
    if (fourcc === "VP8 " && dataLength >= 10) {
      // frame tag(3) start code 9D 01 2A(3) width(2, LE) height(2, LE);
      // the top 2 bits of each are a scaling hint, not size.
      if (buf[dataStart + 3] !== 0x9d || buf[dataStart + 4] !== 0x01 || buf[dataStart + 5] !== 0x2a) {
        return false
      }
      dims = {
        width: buf.readUInt16LE(dataStart + 6) & 0x3fff,
        height: buf.readUInt16LE(dataStart + 8) & 0x3fff,
      }
      return false
    }
    if (fourcc === "VP8L" && dataLength >= 5 && buf[dataStart] === 0x2f) {
      // signature(1) then 14 bits width-1, 14 bits height-1, packed LE.
      const bits = buf.readUInt32LE(dataStart + 1)
      dims = {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      }
      return false
    }
    return undefined
  })
  return dims
}

/**
 * Byte range of a WebP EXIF chunk's TIFF payload.
 * @param {Buffer} buf @returns {{ start: number, end: number } | null}
 */
function findWebpExif(buf) {
  /** @type {{ start: number, end: number } | null} */
  let found = null
  walkWebpChunks(buf, (fourcc, start, chunkEnd, dataStart, dataLength) => {
    if (fourcc !== "EXIF") return undefined
    // Some encoders prefix the redundant "Exif\0\0" identifier; skip it if present.
    const offset = matchesAt(buf, dataStart, EXIF_IDENT) ? EXIF_IDENT.length : 0
    found = { start: dataStart + offset, end: dataStart + dataLength }
    return false
  })
  return found
}

/**
 * Byte range of a PNG eXIf chunk's TIFF payload.
 * @param {Buffer} buf @returns {{ start: number, end: number } | null}
 */
function findPngExif(buf) {
  /** @type {{ start: number, end: number } | null} */
  let found = null
  walkPngChunks(buf, (type, start, chunkEnd, dataStart, dataLength) => {
    if (type !== "eXIf") return undefined
    const offset = matchesAt(buf, dataStart, EXIF_IDENT) ? EXIF_IDENT.length : 0
    found = { start: dataStart + offset, end: dataStart + dataLength }
    return false
  })
  return found
}

/**
 * A bounds-checked reader over one TIFF block, carrying its endianness. Every
 * accessor returns null rather than throwing on a short or out-of-range read,
 * because EXIF in the wild is frequently truncated or self-inconsistent.
 * @param {Buffer} buf @param {number} start @param {number} end
 * @returns {{ le: boolean, u16: (at: number) => number | null, u32: (at: number) => number | null, ascii: (at: number, len: number) => string | null, end: number, start: number } | null}
 */
function tiffReader(buf, start, end) {
  if (start + 8 > end || end > buf.length) return null
  const order = buf.toString("latin1", start, start + 2)
  if (order !== "II" && order !== "MM") return null
  const le = order === "II"
  const u16 = (/** @type {number} */ at) => {
    if (at < start || at + 2 > end) return null
    return le ? buf.readUInt16LE(at) : buf.readUInt16BE(at)
  }
  const u32 = (/** @type {number} */ at) => {
    if (at < start || at + 4 > end) return null
    return le ? buf.readUInt32LE(at) : buf.readUInt32BE(at)
  }
  const ascii = (/** @type {number} */ at, /** @type {number} */ len) => {
    if (at < start || at + len > end) return null
    return buf.toString("latin1", at, at + len)
  }
  if (u16(start + 2) !== 42) return null
  return { le, u16, u32, ascii, start, end }
}

/**
 * Visit the entries of the IFD at absolute offset `ifdAt`.
 * Entry layout: tag(2) type(2) count(4) valueOrOffset(4).
 * @param {ReturnType<typeof tiffReader>} t
 * @param {number} ifdAt
 * @param {(tag: number, type: number, count: number, valueAt: number) => void} visit
 */
function walkIfd(t, ifdAt, visit) {
  if (!t) return
  const count = t.u16(ifdAt)
  if (count === null) return
  for (let i = 0; i < count; i++) {
    const entryAt = ifdAt + 2 + i * 12
    const tag = t.u16(entryAt)
    const type = t.u16(entryAt + 2)
    const valueCount = t.u32(entryAt + 4)
    if (tag === null || type === null || valueCount === null) return
    const typeSize = type < TIFF_TYPE_SIZE.length ? TIFF_TYPE_SIZE[type] : 0
    if (typeSize === 0) continue
    const totalBytes = typeSize * valueCount
    // Values of 4 bytes or fewer sit inline in the entry; longer ones are at an
    // offset measured from the start of the TIFF block.
    let valueAt = entryAt + 8
    if (totalBytes > 4) {
      const offset = t.u32(entryAt + 8)
      if (offset === null) continue
      valueAt = t.start + offset
    }
    visit(tag, type, valueCount, valueAt)
  }
}

/**
 * "YYYY:MM:DD HH:MM:SS" (EXIF's format) → "YYYY-MM-DD HH:MM:SS", which sorts
 * identically but reads as a date. Returns null for anything else. No regex.
 * @param {string} raw @returns {string | null}
 */
function normalizeExifDate(raw) {
  const trimmed = raw.split("\0")[0].trim()
  const parts = trimmed.split(" ")
  if (parts.length !== 2) return null
  const date = parts[0].split(":")
  if (date.length !== 3) return null
  if (date[0].length !== 4 || date[1].length !== 2 || date[2].length !== 2) return null
  // A camera that never had its clock set writes all zeroes.
  if (date[0] === "0000") return null
  for (const segment of date) {
    for (let i = 0; i < segment.length; i++) {
      const c = segment.charCodeAt(i)
      if (c < 48 || c > 57) return null
    }
  }
  return date[0] + "-" + date[1] + "-" + date[2] + " " + parts[1]
}

/**
 * Locate the TIFF block for whichever container this is.
 * @param {Buffer} buf @returns {{ start: number, end: number } | null}
 */
function findExifBlock(buf) {
  if (isJpeg(buf)) return findJpegExif(buf)
  if (isPng(buf)) return findPngExif(buf)
  if (isWebp(buf)) return findWebpExif(buf)
  return null
}

/** @type {Types.readImageHeader} */
export function readImageHeader(buf) {
  if (isJpeg(buf)) {
    const dims = readJpegDimensions(buf)
    return dims ? { format: "jpeg", width: dims.width, height: dims.height } : null
  }
  if (isPng(buf)) {
    // IHDR is required to be the first chunk: length(4) "IHDR" data at 16.
    if (buf.length < 24 || !matchesAt(buf, 12, "IHDR")) return null
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    if (width <= 0 || height <= 0) return null
    return { format: "png", width, height }
  }
  if (isWebp(buf)) {
    const dims = readWebpDimensions(buf)
    return dims ? { format: "webp", width: dims.width, height: dims.height } : null
  }
  return null
}

/** @type {Types.readExifSummary} */
export function readExifSummary(buf) {
  /** @type {Types.ExifSummary} */
  const summary = { orientation: 1, hasGps: false, capturedAt: null }
  try {
    const block = findExifBlock(buf)
    if (!block) return summary
    const t = tiffReader(buf, block.start, block.end)
    if (!t) return summary
    const ifd0Offset = t.u32(block.start + 4)
    if (ifd0Offset === null) return summary

    /** @type {number | null} */
    let exifIfdAt = null
    walkIfd(t, block.start + ifd0Offset, (tag, type, count, valueAt) => {
      if (tag === TAG_ORIENTATION) {
        const value = t.u16(valueAt)
        // Values outside 1-8 are meaningless; treat them as "no rotation".
        if (value !== null && value >= 1 && value <= 8) summary.orientation = value
      } else if (tag === TAG_GPS_IFD) {
        summary.hasGps = true
      } else if (tag === TAG_EXIF_IFD) {
        const offset = t.u32(valueAt)
        if (offset !== null) exifIfdAt = t.start + offset
      }
    })

    if (exifIfdAt !== null) {
      walkIfd(t, exifIfdAt, (tag, type, count, valueAt) => {
        if (tag !== TAG_DATETIME_ORIGINAL) return
        const raw = t.ascii(valueAt, Math.min(count, 32))
        if (raw) summary.capturedAt = normalizeExifDate(raw)
      })
    }
  } catch {
    // Malformed EXIF is common and never worth failing an import over — report
    // the defaults, which are also the safe answer (no rotation, no GPS claim).
    return { orientation: 1, hasGps: false, capturedAt: null }
  }
  return summary
}

/**
 * True for a JPEG APP segment that should survive: APP0 only when it is a real
 * JFIF header, APP2 only when it is an ICC profile. Everything else in the APP
 * range (EXIF and XMP in APP1, IPTC in APP13, MPF thumbnails in APP2, camera
 * maker notes) is metadata we drop.
 * @param {Buffer} buf @param {number} marker @param {number} start
 * @returns {boolean}
 */
function keepJpegAppSegment(buf, marker, start) {
  const payloadAt = start + 4
  if (marker === M_APP0) {
    return matchesAt(buf, payloadAt, "JFIF\0") || matchesAt(buf, payloadAt, "JFXX\0")
  }
  if (marker === M_APP2) return matchesAt(buf, payloadAt, "ICC_PROFILE\0")
  return false
}

/**
 * @param {Buffer} buf @returns {Buffer}
 */
function stripJpeg(buf) {
  /** @type {Buffer[]} */
  const parts = [buf.subarray(0, 2)] // SOI
  let dropped = false
  const stoppedAt = walkJpegSegments(buf, (marker, start, segEnd) => {
    const isApp = marker >= M_APP0 && marker <= M_APP15
    if ((isApp && !keepJpegAppSegment(buf, marker, start)) || marker === M_COM) {
      dropped = true
      return
    }
    parts.push(buf.subarray(start, segEnd))
  })
  if (!dropped) return buf
  // From SOS onward is entropy-coded scan data plus EOI — copy verbatim.
  parts.push(buf.subarray(stoppedAt))
  return Buffer.concat(parts)
}

/**
 * @param {Buffer} buf @returns {Buffer}
 */
function stripPng(buf) {
  /** @type {Buffer[]} */
  const parts = [buf.subarray(0, PNG_SIGNATURE.length)]
  let dropped = false
  walkPngChunks(buf, (type, start, chunkEnd) => {
    if (PNG_DROP_CHUNKS.has(type)) {
      dropped = true
      return
    }
    parts.push(buf.subarray(start, chunkEnd))
  })
  return dropped ? Buffer.concat(parts) : buf
}

/**
 * @param {Buffer} buf @returns {Buffer}
 */
function stripWebp(buf) {
  /** @type {Buffer[]} */
  const parts = []
  let dropped = false
  walkWebpChunks(buf, (fourcc, start, chunkEnd, dataStart) => {
    if (WEBP_DROP_CHUNKS.has(fourcc)) {
      dropped = true
      return
    }
    if (fourcc === "VP8X") {
      // Clear the EXIF/XMP feature bits, or decoders will look for chunks that
      // are no longer there. Copy first — the input buffer may be shared.
      const chunk = Buffer.from(buf.subarray(start, chunkEnd))
      const flagsAt = dataStart - start
      chunk[flagsAt] = chunk[flagsAt] & ~(VP8X_FLAG_EXIF | VP8X_FLAG_XMP)
      parts.push(chunk)
      return
    }
    parts.push(buf.subarray(start, chunkEnd))
  })
  if (!dropped) return buf
  const body = Buffer.concat(parts)
  // RIFF size counts the "WEBP" fourcc plus every chunk, but not itself or the
  // leading "RIFF".
  const header = Buffer.alloc(12)
  header.write("RIFF", 0, "latin1")
  header.writeUInt32LE(4 + body.length, 4)
  header.write("WEBP", 8, "latin1")
  return Buffer.concat([header, body])
}

/** @type {Types.stripImageMetadata} */
export function stripImageMetadata(buf) {
  try {
    if (isJpeg(buf)) return stripJpeg(buf)
    if (isPng(buf)) return stripPng(buf)
    if (isWebp(buf)) return stripWebp(buf)
  } catch {
    // A rewrite that throws means the container confused the parser. Returning
    // the input unchanged is wrong-but-safe for pixels; callers that need the
    // guarantee check hasImageMetadata() afterwards and fail the file there.
    return buf
  }
  return buf
}

/** @type {Types.hasImageMetadata} */
export function hasImageMetadata(buf) {
  if (isJpeg(buf)) {
    let found = false
    walkJpegSegments(buf, (marker, start) => {
      const isApp = marker >= M_APP0 && marker <= M_APP15
      if ((isApp && !keepJpegAppSegment(buf, marker, start)) || marker === M_COM) {
        found = true
        return false
      }
      return undefined
    })
    return found
  }
  if (isPng(buf)) {
    let found = false
    walkPngChunks(buf, (type) => {
      if (!PNG_DROP_CHUNKS.has(type)) return undefined
      found = true
      return false
    })
    return found
  }
  if (isWebp(buf)) {
    let found = false
    walkWebpChunks(buf, (fourcc) => {
      if (!WEBP_DROP_CHUNKS.has(fourcc)) return undefined
      found = true
      return false
    })
    return found
  }
  return false
}
