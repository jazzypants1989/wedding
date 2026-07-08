/** @file In-place GPS blanking for MP4/QuickTime video originals. Called by
 *  media finalize before a video's bytes may be served publicly. Blanks both
 *  Apple GPS carriers with spaces (0x20) WITHOUT moving any byte — no re-mux —
 *  so every atom offset is preserved. Zero-dep, no regex (Buffer index reads +
 *  latin1 type compares). Prototype-validated; see review-adjudication.md B1
 *  and docs/post-wedding/03-media-pipeline.md §7.5. */
/** @import * as Types from './types.js' */

import fs from "node:fs"

// The mdta key whose value is the ISO6709 lat/long string iPhones write.
const LOCATION_KEY = "com.apple.quicktime.location.ISO6709"
// Legacy udta atom type: 0xA9 'x' 'y' 'z'  (latin1: "©xyz").
const XYZ_TYPE = "©xyz"
// Containers we descend into looking for udta/©xyz and meta.
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "udta"])
const SPACE = 0x20

/**
 * @typedef {{ start: number, type: string, headerSize: number, contentStart: number, boxEnd: number }} Box
 */

/**
 * Read a box header at `offset`. Handles 32-bit sizes, size=1 (64-bit
 * largesize) and size=0 (extends to `end`). Returns null on malformed input.
 * @param {Buffer} buf
 * @param {number} offset
 * @param {number} end
 * @returns {Box | null}
 */
function readBox(buf, offset, end) {
  if (offset + 8 > end) return null
  let size = buf.readUInt32BE(offset)
  const type = buf.toString("latin1", offset + 4, offset + 8)
  let headerSize = 8
  if (size === 1) {
    if (offset + 16 > end) return null
    const hi = buf.readUInt32BE(offset + 8)
    const lo = buf.readUInt32BE(offset + 12)
    size = hi * 2 ** 32 + lo
    headerSize = 16
  } else if (size === 0) {
    size = end - offset
  }
  const boxEnd = offset + size
  if (size < headerSize || boxEnd > end || boxEnd <= offset) return null
  return { start: offset, type, headerSize, contentStart: offset + headerSize, boxEnd }
}

/**
 * Iterate the child boxes in [start, end). Stops cleanly at the first malformed
 * header rather than throwing.
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} end
 * @returns {Box[]}
 */
function childBoxes(buf, start, end) {
  /** @type {Box[]} */
  const boxes = []
  let offset = start
  while (offset + 8 <= end) {
    const box = readBox(buf, offset, end)
    if (!box) break
    boxes.push(box)
    offset = box.boxEnd
  }
  return boxes
}

/**
 * Blank [from, to) with spaces and record the region.
 * @param {Buffer} buf
 * @param {number} from
 * @param {number} to
 * @param {string} type
 * @param {Types.BlankedRegion[]} regions
 */
function blank(buf, from, to, type, regions) {
  if (to <= from || from < 0 || to > buf.length) return
  buf.fill(SPACE, from, to)
  regions.push({ start: from, end: to, type })
}

/**
 * Legacy moov/udta/©xyz: payload = 2-byte string length + 2-byte language +
 * ISO6709 string. Blank the string bytes only.
 * @param {Buffer} buf @param {Box} xyz @param {Types.BlankedRegion[]} regions
 */
function blankXyz(buf, xyz, regions) {
  if (xyz.contentStart + 4 > xyz.boxEnd) return
  const strLen = buf.readUInt16BE(xyz.contentStart)
  const from = xyz.contentStart + 4
  const to = Math.min(from + strLen, xyz.boxEnd)
  blank(buf, from, to, "©xyz", regions)
}

/**
 * Where a meta box's children begin: QuickTime-style metas start immediately;
 * ISO fullbox metas prefix a 4-byte version/flags. Detect via the hdlr first
 * child (adjudication B1.2).
 * @param {Buffer} buf @param {Box} meta @returns {number}
 */
function metaChildrenStart(buf, meta) {
  const qt = readBox(buf, meta.contentStart, meta.boxEnd)
  if (qt && qt.type === "hdlr") return meta.contentStart
  const iso = readBox(buf, meta.contentStart + 4, meta.boxEnd)
  if (iso && iso.type === "hdlr") return meta.contentStart + 4
  // Fall back to whichever position parses as a box at all.
  return qt ? meta.contentStart : meta.contentStart + 4
}

/**
 * Parse a `keys` fullbox into an ordered list of key names (1-based index =
 * position + 1). Each entry: [size][namespace(4)][key_name].
 * @param {Buffer} buf @param {Box} keys @returns {string[]}
 */
function parseKeys(buf, keys) {
  let off = keys.contentStart + 4 // skip version/flags
  if (off + 4 > keys.boxEnd) return []
  const count = buf.readUInt32BE(off)
  off += 4
  /** @type {string[]} */
  const names = []
  for (let i = 0; i < count; i++) {
    const entry = readBox(buf, off, keys.boxEnd)
    if (!entry) break
    names.push(buf.toString("latin1", entry.contentStart, entry.boxEnd))
    off = entry.boxEnd
  }
  return names
}

/**
 * Blank the ilst `data` payloads whose parent atom type (a big-endian 1-based
 * key index) is in `indices`. data payload begins after its 8-byte
 * type-indicator + locale header.
 * @param {Buffer} buf @param {Box} ilst @param {Set<number>} indices
 * @param {Types.BlankedRegion[]} regions
 */
function blankIlst(buf, ilst, indices, regions) {
  for (const item of childBoxes(buf, ilst.contentStart, ilst.boxEnd)) {
    const idx = buf.readUInt32BE(item.start + 4) // the 4 "type" bytes ARE the index
    if (!indices.has(idx)) continue
    for (const data of childBoxes(buf, item.contentStart, item.boxEnd)) {
      if (data.type !== "data") continue
      const from = data.contentStart + 8 // skip type-indicator(4) + locale(4)
      blank(buf, from, data.boxEnd, "mdta", regions)
    }
  }
}

/**
 * Modern moov/meta (mdta): collect location key indices from `keys`, then blank
 * the matching `ilst` values. Keeping the key name intact preserves the
 * keys/ilst index correspondence.
 * @param {Buffer} buf @param {Box} meta @param {Types.BlankedRegion[]} regions
 */
function processMeta(buf, meta, regions) {
  const start = metaChildrenStart(buf, meta)
  /** @type {string[] | null} */
  let keyNames = null
  /** @type {Box | null} */
  let ilst = null
  for (const child of childBoxes(buf, start, meta.boxEnd)) {
    if (child.type === "keys") keyNames = parseKeys(buf, child)
    else if (child.type === "ilst") ilst = child
  }
  if (!keyNames || !ilst) return
  /** @type {Set<number>} */
  const indices = new Set()
  keyNames.forEach((name, i) => {
    if (name === LOCATION_KEY) indices.add(i + 1)
  })
  if (indices.size === 0) return
  blankIlst(buf, ilst, indices, regions)
}

/**
 * Recurse a container box, dispatching to the ©xyz / meta handlers.
 * @param {Buffer} buf @param {Box} box @param {Types.BlankedRegion[]} regions
 */
function walk(buf, box, regions) {
  for (const child of childBoxes(buf, box.contentStart, box.boxEnd)) {
    if (child.type === XYZ_TYPE) blankXyz(buf, child, regions)
    else if (child.type === "meta") processMeta(buf, child, regions)
    else if (CONTAINERS.has(child.type)) walk(buf, child, regions)
  }
}

/** @type {Types.blankVideoGps} */
export function blankVideoGps(filePath) {
  const buf = fs.readFileSync(filePath)
  /** @type {Types.BlankedRegion[]} */
  const regions = []
  try {
    for (const box of childBoxes(buf, 0, buf.length)) {
      if (box.type === "moov") walk(buf, box, regions)
    }
  } catch {
    // Never fail finalize over weird-but-servable metadata — keep whatever was
    // already blanked and move on.
  }
  if (regions.length > 0) fs.writeFileSync(filePath, buf)
  return regions
}
