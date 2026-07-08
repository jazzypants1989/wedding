/** @file In-repo binary fixtures for media tests. Per CLAUDE.md we keep NO
 *  binary files in the repo — every fixture is a Buffer built here with just
 *  enough real structure (magic bytes / atom trees) to exercise the code path.
 *  Poster/mp4-meta GPS fixtures are added alongside their tests. */

/**
 * Minimal JPEG: SOI (FF D8) + APP0 marker (FF E0) + zero filler + EOI (FF D9).
 * @param {number} [n] total byte length (min 6)
 * @returns {Buffer}
 */
export function makeJpeg(n = 64) {
  const buf = Buffer.alloc(Math.max(n, 6), 0)
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[3] = 0xe0
  buf[buf.length - 2] = 0xff; buf[buf.length - 1] = 0xd9
  return buf
}

/**
 * Minimal PNG: the 8-byte signature followed by zero filler.
 * @param {number} [n] total byte length (min 8)
 * @returns {Buffer}
 */
export function makePng(n = 64) {
  const buf = Buffer.alloc(Math.max(n, 8), 0)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf)
  return buf
}

/**
 * Minimal WebP: "RIFF" ....(size).... "WEBP" then zero filler.
 * @param {number} [n] total byte length (min 12)
 * @returns {Buffer}
 */
export function makeWebp(n = 64) {
  const buf = Buffer.alloc(Math.max(n, 12), 0)
  buf.write("RIFF", 0, "latin1")
  buf.write("WEBP", 8, "latin1")
  return buf
}

/**
 * ISO BMFF ftyp box with the given major brand, then zero filler.
 * @param {string} brand 4-char major brand
 * @param {number} [n] total byte length (min 16)
 * @returns {Buffer}
 */
export function makeFtyp(brand, n = 64) {
  const buf = Buffer.alloc(Math.max(n, 16), 0)
  buf.writeUInt32BE(buf.length, 0) // box size (cosmetic — sniff ignores it)
  buf.write("ftyp", 4, "latin1")
  buf.write(brand, 8, "latin1")    // major brand
  buf.write(brand, 12, "latin1")   // first compatible brand
  return buf
}

/** @param {number} [n] @returns {Buffer} */
export function makeMp4(n = 64) {
  return makeFtyp("isom", n)
}

/** @param {number} [n] @returns {Buffer} */
export function makeHeic(n = 64) {
  return makeFtyp("heic", n)
}

/** @param {number} [n] @returns {Buffer} QuickTime .mov (brand "qt  ") */
export function makeMov(n = 64) {
  return makeFtyp("qt  ", n)
}

// --- MP4 atom-tree builders (for the GPS-blanking tests) ---

/** @param {number} n @returns {Buffer} */
function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n, 0)
  return b
}

/** @param {number} n @returns {Buffer} */
function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

/**
 * Build an ISO box: [size(4)][type(4)][payload]. `type` may be a 4-char string
 * or a 4-byte Buffer (for the ©xyz atom / numeric ilst indices).
 * @param {string | Buffer} type
 * @param {Buffer} payload
 * @returns {Buffer}
 */
function box(type, payload) {
  const typeBuf = Buffer.isBuffer(type) ? type : Buffer.from(type, "latin1")
  const header = Buffer.alloc(8)
  header.writeUInt32BE(8 + payload.length, 0)
  typeBuf.copy(header, 4)
  return Buffer.concat([header, payload])
}

/**
 * A minimal but structurally-valid MP4 carrying the SAME ISO6709 coordinate in
 * BOTH Apple GPS carriers: legacy moov/udta/©xyz and modern moov/meta
 * (mdta keys/ilst). `isoMeta` toggles the ISO fullbox (version/flags) vs
 * QuickTime-style meta layout.
 * @param {{ coord?: string, isoMeta?: boolean }} [opts]
 * @returns {{ buffer: Buffer, coord: string }}
 */
export function makeMp4WithGps(opts = {}) {
  const coord = opts.coord ?? "+12.3456-098.7654/"
  const isoMeta = opts.isoMeta !== false // default ISO fullbox layout
  const coordBuf = Buffer.from(coord, "latin1")

  // moov/udta/©xyz : [strLen(2)][lang(2)][string]
  const xyzType = Buffer.from([0xa9, 0x78, 0x79, 0x7a])
  const xyz = box(xyzType, Buffer.concat([u16(coordBuf.length), u16(0x55c4), coordBuf]))
  const udta = box("udta", xyz)

  // moov/meta : hdlr(mdta) + keys + ilst
  const hdlr = box("hdlr", Buffer.concat([
    Buffer.alloc(8), // version/flags(4) + pre_defined(4)
    Buffer.from("mdta", "latin1"), // handler_type
    Buffer.alloc(12), // reserved
  ]))
  const keyEntry = box("mdta", Buffer.from("com.apple.quicktime.location.ISO6709", "latin1"))
  const keys = box("keys", Buffer.concat([Buffer.alloc(4), u32(1), keyEntry])) // version/flags + count=1
  const dataBox = box("data", Buffer.concat([Buffer.alloc(8), coordBuf])) // type-indicator(4)+locale(4)+value
  const item = box(u32(1), dataBox) // atom type = key index 1 (big-endian)
  const ilst = box("ilst", item)
  const metaPayload = isoMeta
    ? Buffer.concat([Buffer.alloc(4), hdlr, keys, ilst]) // ISO fullbox: version/flags first
    : Buffer.concat([hdlr, keys, ilst]) // QuickTime-style: children immediately
  const meta = box("meta", metaPayload)

  const moov = box("moov", Buffer.concat([udta, meta]))
  const buffer = Buffer.concat([makeFtyp("isom", 16), moov])
  return { buffer, coord }
}

