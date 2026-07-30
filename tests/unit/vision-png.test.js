/** @file Unit test: the hand-written PNG encoder.
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
 */

import assert from "node:assert"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { after, test } from "node:test"

import { encodePng, writePng } from "../../scripts/vision/png-write.js"

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
