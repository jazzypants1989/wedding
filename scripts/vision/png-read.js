/** @file The other half of png-write.js: decode exactly what it emits — 8-bit
 *  truecolour RGB (colour type 2), no interlace, filter type 0 on every
 *  scanline — and refuse everything else loudly instead of guessing at it.
 *
 *  Why this exists rather than a dependency: the redescribe rig
 *  (scripts/vision/redescribe-crops.js) has to read the crops session1.js
 *  already wrote back off disk, and CLAUDE.md's zero-dependency rule puts a
 *  PNG decoder in the same tier as the encoder it pairs with — code that
 *  executes in our process, so we write it.
 *
 *  The CRC-32 table here is a SEPARATE implementation from png-write.js's, not
 *  an import of it. That is deliberate: this decoder has to be able to catch a
 *  corrupt file regardless of what wrote it, and importing the encoder's own
 *  CRC table would mean a bug in that table validates as fine on both sides of
 *  the round trip and is never caught by either.
 *
 *  No regex, per CLAUDE.md — chunk framing is length/type/payload/CRC fields
 *  read with Buffer's own integer readers.
 */
/** @import * as Types from './types.js' */

import zlib from "node:zlib"

/** The eight-byte PNG signature, fixed by the spec. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const BIT_DEPTH = 8
/** Colour type 2 is truecolour RGB with no alpha — the only layout this reads. */
const COLOUR_TYPE_RGB = 2
const INTERLACE_NONE = 0
/** Filter type 0 ("None") on every scanline — the only one png-write.js emits. */
const FILTER_NONE = 0

/**
 * Standard CRC-32 table (reflected, polynomial 0xEDB88320), built once. See
 * the file header for why this is not shared with png-write.js's copy.
 * @type {Int32Array}
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/**
 * CRC-32 of a buffer, as an unsigned 32-bit number.
 * @param {Buffer | Uint8Array} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * Walk signature + chunks, verifying every chunk's CRC as it goes so a
 * corrupted file fails loudly here rather than feeding a subtly wrong buffer
 * into the embedder later. Stops at IEND; anything after it is ignored, same
 * as every other decoder.
 * @param {Buffer} buf
 * @returns {Array<{ type: string, data: Buffer }>}
 */
function readChunks(buf) {
  if (buf.length < SIGNATURE.length || !buf.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new Error("decodePng: bad signature — this is not a PNG file")
  }

  /** @type {Array<{ type: string, data: Buffer }>} */
  const chunks = []
  let pos = SIGNATURE.length
  while (pos < buf.length) {
    if (pos + 8 > buf.length) {
      throw new Error(`decodePng: truncated chunk header at byte ${pos}`)
    }
    const length = buf.readUInt32BE(pos)
    const type = buf.toString("latin1", pos + 4, pos + 8)
    const dataStart = pos + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buf.length) {
      throw new Error(`decodePng: truncated ${type} chunk (declares ${length} bytes, file ends first)`)
    }

    const data = buf.subarray(dataStart, dataEnd)
    const crcStored = buf.readUInt32BE(dataEnd)
    // The CRC covers the type as well as the data, same as png-write.js.
    const crcComputed = crc32(buf.subarray(pos + 4, dataEnd))
    if (crcComputed !== crcStored) {
      throw new Error(
        `decodePng: ${type} chunk CRC mismatch (stored ${crcStored.toString(16)}, computed ` +
          `${crcComputed.toString(16)}) — corrupt file`,
      )
    }

    chunks.push({ type, data })
    pos = dataEnd + 4
    if (type === "IEND") break
  }
  return chunks
}

/** @type {Types.decodePng} */
export function decodePng(buffer) {
  const chunks = readChunks(buffer)
  const first = chunks[0]
  if (!first || first.type !== "IHDR") {
    throw new Error(`decodePng: expected IHDR as the first chunk, got ${first ? first.type : "nothing"}`)
  }

  const ihdr = first.data
  if (ihdr.length !== 13) {
    throw new Error(`decodePng: IHDR is ${ihdr.length} bytes, expected 13`)
  }
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]
  const colourType = ihdr[9]
  const compressionMethod = ihdr[10]
  const filterMethod = ihdr[11]
  const interlace = ihdr[12]

  if (width < 1 || height < 1) {
    throw new Error(`decodePng: bad dimensions ${width}x${height}`)
  }
  if (colourType !== COLOUR_TYPE_RGB) {
    throw new Error(
      `decodePng: colour type ${colourType} — this decoder only handles 2 (truecolour RGB, no alpha)`,
    )
  }
  if (bitDepth !== BIT_DEPTH) {
    throw new Error(`decodePng: bit depth ${bitDepth} — this decoder only handles 8`)
  }
  if (compressionMethod !== 0) {
    throw new Error(`decodePng: compression method ${compressionMethod} — the spec defines only 0`)
  }
  if (filterMethod !== 0) {
    throw new Error(`decodePng: filter method ${filterMethod} — the spec defines only 0`)
  }
  if (interlace !== INTERLACE_NONE) {
    throw new Error(`decodePng: interlace method ${interlace} — this decoder only handles 0 (no interlace)`)
  }

  const idatChunks = chunks.filter((c) => c.type === "IDAT").map((c) => c.data)
  if (idatChunks.length === 0) {
    throw new Error("decodePng: no IDAT chunk — nothing to decompress")
  }
  const compressed = idatChunks.length === 1 ? idatChunks[0] : Buffer.concat(idatChunks)

  /** @type {Buffer} */
  let raw
  try {
    raw = zlib.inflateSync(compressed)
  } catch (err) {
    throw new Error(
      `decodePng: IDAT is not a valid zlib stream — ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // Each scanline is prefixed by its filter type byte. png-write.js only ever
  // emits 0 ("None"); anything else means this PNG came from somewhere else,
  // and this decoder does not implement the other four filters.
  const stride = width * 3
  const expected = height * (stride + 1)
  if (raw.length !== expected) {
    throw new Error(
      `decodePng: inflated ${raw.length} bytes, expected ${expected} for ${width}x${height} ` +
        `(stride+1 per row)`,
    )
  }

  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1)
    const filterType = raw[rowStart]
    if (filterType !== FILTER_NONE) {
      throw new Error(
        `decodePng: this decoder only handles filter type 0 (got ${filterType}) — ` +
          `was this PNG written by an external tool?`,
      )
    }
    rgb.set(raw.subarray(rowStart + 1, rowStart + 1 + stride), y * stride)
  }

  return { width, height, rgb }
}
