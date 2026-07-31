/** @file Unit test: the hand-written PNG encoder, and the decoder that reads
 *  its files back for the A/B rig (scripts/vision/redescribe-crops.js).
 *
 *  An encoder is the kind of code that produces a file which *looks* right in a
 *  hex dump and fails to open everywhere, so the assertions here are against the
 *  container spec rather than against "it produced some bytes": the signature,
 *  the IHDR fields, every chunk's CRC (which covers the type as well as the
 *  payload — the classic mistake), and an inflate of the IDAT payload back to
 *  the exact scanlines that went in.
 *
 *  There is also an optional decode through ImageMagick, which is the only
 *  assertion here that a *different* implementation agrees. It is skipped when
 *  magick is not installed, because a unit test that needs a system binary is a
 *  unit test that fails on someone else's machine for no reason.
 *
 *  The decodePng tests near the end hand-build tampered PNG buffers rather than
 *  going through encodePng for the filter-byte and CRC cases: encodePng only
 *  ever writes filter type 0 and a valid CRC, so the two failures decodePng
 *  exists to catch cannot be produced by the encoder that pairs with it.
 */

import assert from "node:assert"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { after, test } from "node:test"

import { encodePng, writePng } from "../../scripts/vision/png-write.js"
import { decodePng } from "../../scripts/vision/png-read.js"

/** @type {string[]} */
const madeDirs = []

after(() => {
  for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function workDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-png-"))
  madeDirs.push(dir)
  return dir
}

/**
 * A deterministic image with no two pixels alike, so a decode that is off by a
 * row, a column or a channel cannot accidentally still match.
 * @param {number} width @param {number} height
 */
function syntheticImage(width, height) {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      rgb[i] = (x * 7 + y * 3) & 0xff
      rgb[i + 1] = (x * 13 + 40) & 0xff
      rgb[i + 2] = (y * 29 + 11) & 0xff
    }
  }
  return { width, height, rgb }
}

/** Walk the chunk list, verifying each CRC as we go.
 *  @param {Buffer} buf */
function readChunks(buf) {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  /** @param {Buffer} bytes */
  const crc32 = (bytes) => {
    let c = -1
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ -1) >>> 0
  }

  const chunks = []
  let pos = 8
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString("latin1", pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + length)
    const stated = buf.readUInt32BE(pos + 8 + length)
    chunks.push({ type, data, crcOk: crc32(buf.subarray(pos + 4, pos + 8 + length)) === stated })
    pos += 12 + length
  }
  return chunks
}

test("encodePng writes the PNG signature", () => {
  const png = encodePng(syntheticImage(4, 3))
  assert.deepEqual(
    Array.from(png.subarray(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  )
})

test("IHDR declares 8-bit truecolour RGB at the right size", () => {
  const png = encodePng(syntheticImage(17, 5))
  const [ihdr] = readChunks(png)
  assert.equal(ihdr.type, "IHDR")
  assert.equal(ihdr.data.length, 13)
  assert.equal(ihdr.data.readUInt32BE(0), 17)
  assert.equal(ihdr.data.readUInt32BE(4), 5)
  assert.equal(ihdr.data[8], 8, "bit depth")
  assert.equal(ihdr.data[9], 2, "colour type 2 = truecolour RGB")
  assert.equal(ihdr.data[10], 0, "deflate")
  assert.equal(ihdr.data[11], 0, "adaptive filtering")
  assert.equal(ihdr.data[12], 0, "no interlace")
})

test("chunk order is IHDR, IDAT, IEND and every CRC checks out", () => {
  const chunks = readChunks(encodePng(syntheticImage(9, 9)))
  assert.deepEqual(
    chunks.map((c) => c.type),
    ["IHDR", "IDAT", "IEND"],
  )
  for (const chunk of chunks) assert.ok(chunk.crcOk, `${chunk.type} CRC`)
  assert.equal(chunks[2].data.length, 0)
})

test("a corrupted byte makes the CRC check fail (the checker is not vacuous)", () => {
  const png = encodePng(syntheticImage(6, 6))
  // Flip a bit inside IHDR's payload. Byte 16 is the first byte of the width.
  png[16] ^= 0x01
  assert.equal(readChunks(png)[0].crcOk, false)
})

test("inflating IDAT round-trips to the exact scanlines, each with filter type 0", () => {
  const image = syntheticImage(11, 7)
  const idat = readChunks(encodePng(image)).find((c) => c.type === "IDAT")
  assert.ok(idat, "there is an IDAT chunk")
  const raw = zlib.inflateSync(idat.data)

  const stride = image.width * 3
  assert.equal(raw.length, image.height * (stride + 1))
  for (let y = 0; y < image.height; y++) {
    const at = y * (stride + 1)
    assert.equal(raw[at], 0, `filter byte on row ${y}`)
    assert.deepEqual(
      Array.from(raw.subarray(at + 1, at + 1 + stride)),
      Array.from(image.rgb.subarray(y * stride, (y + 1) * stride)),
      `row ${y}`,
    )
  }
})

test("a 1x1 image is a valid PNG", () => {
  const png = encodePng({ width: 1, height: 1, rgb: new Uint8Array([1, 2, 3]) })
  const chunks = readChunks(png)
  assert.equal(chunks[0].data.readUInt32BE(0), 1)
  assert.deepEqual(Array.from(zlib.inflateSync(chunks[1].data)), [0, 1, 2, 3])
})

test("a short buffer is refused rather than encoded as a partly black image", () => {
  assert.throws(
    () => encodePng({ width: 4, height: 4, rgb: new Uint8Array(4 * 4 * 3 - 1) }),
    (err) => err instanceof Error && err.message.includes("need 48"),
  )
})

test("bad dimensions are refused", () => {
  for (const bad of [
    { width: 0, height: 4 },
    { width: 4, height: 0 },
    { width: 2.5, height: 4 },
  ]) {
    assert.throws(
      () => encodePng({ ...bad, rgb: new Uint8Array(300) }),
      (err) => err instanceof Error && err.message.startsWith("encodePng: bad dimensions"),
    )
  }
})

test("writePng puts the same bytes on disk", () => {
  const image = syntheticImage(8, 8)
  const file = path.join(workDir(), "crop.png")
  writePng(image, file)
  assert.deepEqual(Array.from(fs.readFileSync(file)), Array.from(encodePng(image)))
})

test("ImageMagick decodes our PNG back to the source buffer (skipped without magick)", (t) => {
  let available = true
  try {
    execFileSync("magick", ["-version"], { stdio: "ignore" })
  } catch {
    available = false
  }
  if (!available) {
    t.skip("magick is not installed")
    return
  }

  const image = syntheticImage(13, 6)
  const file = path.join(workDir(), "decode.png")
  writePng(image, file)

  // PPM out, so the answer is self-describing: `-depth 8` because a Q16 build
  // writes maxval 65535 otherwise, which scripts/vision/pixels-cli.js exists to
  // catch and which would silently double every byte offset here.
  const ppm = execFileSync("magick", [file, "-depth", "8", "ppm:-"], {
    maxBuffer: 32 * 1024 * 1024,
  })
  const header = ppm.toString("latin1", 0, 32).split("\n")
  assert.equal(header[0], "P6")
  assert.equal(header[1], `${image.width} ${image.height}`)
  const bodyStart = ppm.indexOf(0x0a, ppm.indexOf(0x0a, ppm.indexOf(0x0a) + 1) + 1) + 1
  assert.deepEqual(
    Array.from(ppm.subarray(bodyStart, bodyStart + image.rgb.length)),
    Array.from(image.rgb),
  )
})

// ---------------------------------------------------------------------------
// decodePng — the read side of the round trip.
// ---------------------------------------------------------------------------

/**
 * A local CRC-32 + chunk builder, used only to rebuild a tampered IDAT chunk
 * with a valid CRC for the bad-filter-byte case below. A third, independent
 * copy of the same standard algorithm png-write.js and png-read.js each keep
 * their own of (see png-read.js's file header for why): a helper built on
 * either production implementation could not catch a bug in it.
 * @type {Int32Array}
 */
const DECODE_TEST_CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/** @param {Buffer} buf @returns {number} */
function decodeTestCrc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = DECODE_TEST_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** @param {string} type @param {Buffer} data @returns {Buffer} */
function buildChunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(decodeTestCrc32(Buffer.concat([head.subarray(4, 8), data])), 0)
  return Buffer.concat([head, data, crc])
}

/**
 * encodePng always writes exactly IHDR (25 bytes: 4 length + 4 type + 13
 * data + 4 crc) then one IDAT then IEND, so these offsets are fixed by the
 * encoder's own structure, not guessed at.
 * @param {Buffer} encoded
 */
function splitEncoded(encoded) {
  const signature = encoded.subarray(0, 8)
  const ihdrChunk = encoded.subarray(8, 33)
  const idatLen = encoded.readUInt32BE(33)
  const idatDataStart = 33 + 8
  const idatData = encoded.subarray(idatDataStart, idatDataStart + idatLen)
  const iendChunk = encoded.subarray(idatDataStart + idatLen + 4)
  return { signature, ihdrChunk, idatData, iendChunk }
}

test("decodePng round-trips a range of sizes, including 1x1 and odd widths", () => {
  const sizes = [
    { width: 1, height: 1 },
    { width: 1, height: 3 },
    { width: 3, height: 1 },
    { width: 5, height: 7 },
    { width: 112, height: 112 },
  ]
  for (const { width, height } of sizes) {
    const image = syntheticImage(width, height)
    const decoded = decodePng(encodePng(image))
    assert.equal(decoded.width, width, `${width}x${height} width`)
    assert.equal(decoded.height, height, `${width}x${height} height`)
    assert.deepEqual(Array.from(decoded.rgb), Array.from(image.rgb), `${width}x${height} pixels`)
  }
})

test("decodePng refuses a non-zero scanline filter byte", () => {
  const image = syntheticImage(4, 4)
  const { signature, ihdrChunk, idatData, iendChunk } = splitEncoded(encodePng(image))

  const raw = zlib.inflateSync(idatData)
  const tamperedRaw = Buffer.from(raw)
  // Byte 0 of the inflated stream is the first scanline's filter type.
  // encodePng only ever writes 0; 1 ("Sub") is a real PNG filter this
  // decoder deliberately does not implement.
  tamperedRaw[0] = 1
  const newIdatChunk = buildChunk("IDAT", zlib.deflateSync(tamperedRaw))

  const tampered = Buffer.concat([signature, ihdrChunk, newIdatChunk, iendChunk])
  assert.throws(
    () => decodePng(tampered),
    (err) => err instanceof Error && err.message.includes("filter type 0"),
  )
})

test("decodePng refuses a chunk whose CRC does not match", () => {
  const image = syntheticImage(4, 4)
  const encoded = encodePng(image)
  const corrupted = Buffer.from(encoded)
  // Byte 41 is the first byte of the IDAT chunk's compressed data (IHDR
  // occupies [8, 33); the next chunk's 8-byte length+type header occupies
  // [33, 41)) — flipping it invalidates the CRC the encoder stored, without
  // needing to know the compressed length.
  corrupted[41] ^= 0xff
  assert.throws(
    () => decodePng(corrupted),
    (err) => err instanceof Error && err.message.includes("CRC mismatch"),
  )
})

test("decodePng refuses a buffer with no PNG signature", () => {
  const notPng = Buffer.from("this is not a png file at all")
  assert.throws(
    () => decodePng(notPng),
    (err) => err instanceof Error && err.message.includes("bad signature"),
  )
})

test("decodePng checks colour type, bit depth and interlace rather than assuming them", () => {
  const width = 2
  const height = 2
  const { signature, idatData } = splitEncoded(encodePng(syntheticImage(width, height)))

  /** @param {(ihdr: Buffer) => void} mutate @returns {Buffer} */
  const withMutatedIhdr = (mutate) => {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8 // bit depth
    ihdr[9] = 2 // colour type
    ihdr[10] = 0 // compression method
    ihdr[11] = 0 // filter method
    ihdr[12] = 0 // interlace
    mutate(ihdr)
    return Buffer.concat([
      signature,
      buildChunk("IHDR", ihdr),
      buildChunk("IDAT", idatData),
      buildChunk("IEND", Buffer.alloc(0)),
    ])
  }

  assert.throws(
    () => decodePng(withMutatedIhdr((ihdr) => (ihdr[9] = 3))), // palette
    (err) => err instanceof Error && err.message.includes("colour type"),
  )
  assert.throws(
    () => decodePng(withMutatedIhdr((ihdr) => (ihdr[8] = 16))), // 16-bit samples
    (err) => err instanceof Error && err.message.includes("bit depth"),
  )
  assert.throws(
    () => decodePng(withMutatedIhdr((ihdr) => (ihdr[12] = 1))), // Adam7
    (err) => err instanceof Error && err.message.includes("interlace"),
  )
})
