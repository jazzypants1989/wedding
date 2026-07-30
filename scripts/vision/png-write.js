/** @file A PNG encoder, in a few dozen lines, for one job: the aligned 112x112
 *  crops have to be openable in a browser by the labelling page.
 *
 *  Why this exists rather than a dependency or a subprocess:
 *
 *  - **A subprocess per crop is the wrong shape.** The batch produces thousands
 *    of 112x112 buffers. Spawning ImageMagick for each is milliseconds of fork
 *    and exec against microseconds of actual work, and it would make the crop
 *    writer the slowest stage in a pipeline whose expensive stage is supposed to
 *    be a neural network.
 *  - **A dependency is not available.** CLAUDE.md's zero-dependency rule, and an
 *    encoder is code that executes in our process — tier 1, we write it.
 *  - **It is genuinely small.** PNG's container is length/type/payload/CRC
 *    chunks; the pixel format we need is the simplest one it has (8-bit RGB,
 *    no interlace, no palette, no alpha); and `node:zlib` already ships the only
 *    hard part. Filter type 0 on every scanline is left deliberately: filters
 *    buy compression, and these files are scratch under tmp/ that get deleted
 *    when the run is read.
 *
 *  No regex, per CLAUDE.md — there are no strings here to be tempted by anyway.
 */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import zlib from "node:zlib"

/** The eight-byte PNG signature, fixed by the spec. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const BIT_DEPTH = 8
/** Colour type 2 is truecolour RGB with no alpha — exactly our buffer layout. */
const COLOUR_TYPE_RGB = 2

/**
 * Standard CRC-32 table (reflected, polynomial 0xEDB88320), built once.
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
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * One PNG chunk: length, four-byte type, payload, CRC of type+payload.
 *
 * The CRC covers the type as well as the data — a detail that is easy to get
 * wrong and that every decoder checks, so a mistake here would produce a file
 * that looks fine in a hex dump and fails to open everywhere.
 * @param {string} type four ASCII characters
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** @type {Types.encodePng} */
export function encodePng(image) {
  const { width, height, rgb } = image
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`encodePng: bad dimensions ${width}x${height}`)
  }
  const needed = width * height * 3
  // A short buffer would encode as a PNG full of zeroes past the truncation
  // point, which is a silently wrong image rather than a failure. Refuse.
  if (rgb.length < needed) {
    throw new Error(`encodePng: ${rgb.length} bytes for ${width}x${height} (need ${needed})`)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = BIT_DEPTH
  ihdr[9] = COLOUR_TYPE_RGB
  ihdr[10] = 0 // compression: deflate, the only defined value
  ihdr[11] = 0 // filter method: the only defined value
  ihdr[12] = 0 // interlace: none

  // Each scanline is prefixed by its filter type byte. Zero means "no filter",
  // so the raw stream is the source rows with one 0 spliced in front of each.
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1)
    raw[dst] = 0
    for (let i = 0; i < stride; i++) raw[dst + 1 + i] = rgb[y * stride + i]
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/** @type {Types.writePng} */
export function writePng(image, filePath) {
  fs.writeFileSync(filePath, encodePng(image))
}
