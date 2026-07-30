/** @file Unit tests for core/image-meta.js — the header reader and the lossless
 *  metadata filter that guarantees derived image variants carry no EXIF
 *  regardless of which resize backend produced them. */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  hasImageMetadata,
  readExifSummary,
  readImageHeader,
  stripImageMetadata,
} from "../../../core/image-meta.js"
import { sniffMagic } from "../../../core/sniff.js"
import {
  makeExifTiff,
  makeJpeg,
  makeJpegWithMetadata,
  makePng,
  makePngWithMetadata,
  makeWebp,
  makeWebpWithMetadata,
} from "../../media-fixtures.js"

/**
 * Every JPEG marker code in `buf` as a lowercase hex string, up to the scan.
 * @param {Buffer} buf @returns {string[]}
 */
function jpegMarkers(buf) {
  /** @type {string[]} */
  const seen = []
  let off = 2
  while (off + 3 < buf.length) {
    if (buf[off] !== 0xff) break
    const marker = buf[off + 1]
    seen.push(marker.toString(16).padStart(2, "0"))
    if (marker === 0xda || marker === 0xd9) break
    off += 2 + buf.readUInt16BE(off + 2)
  }
  return seen
}

/** @param {Buffer} buf @returns {string[]} fourcc of each RIFF chunk */
function webpChunks(buf) {
  /** @type {string[]} */
  const seen = []
  let off = 12
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString("latin1", off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    seen.push(fourcc)
    off += 8 + size + (size % 2)
  }
  return seen
}

/** @param {Buffer} buf @returns {string[]} type of each PNG chunk */
function pngChunks(buf) {
  /** @type {string[]} */
  const seen = []
  let off = 8
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off)
    seen.push(buf.toString("latin1", off + 4, off + 8))
    off += 12 + size
  }
  return seen
}

describe("readImageHeader", () => {
  it("reads JPEG dimensions from the start-of-frame segment", () => {
    const buf = makeJpegWithMetadata({ width: 4032, height: 3024 })
    assert.deepEqual(readImageHeader(buf), { format: "jpeg", width: 4032, height: 3024 })
  })

  it("reads JPEG dimensions past a large EXIF block", () => {
    // The SOF sits after APP1; a reader that only peeked at the first segment
    // would miss it.
    const buf = makeJpegWithMetadata({
      width: 800,
      height: 1200,
      exif: makeExifTiff({ orientation: 6, gps: true, capturedAt: "2026:06:14 15:04:05" }),
    })
    assert.deepEqual(readImageHeader(buf), { format: "jpeg", width: 800, height: 1200 })
  })

  it("reads PNG dimensions from IHDR", () => {
    const buf = makePngWithMetadata({ width: 640, height: 480 })
    assert.deepEqual(readImageHeader(buf), { format: "png", width: 640, height: 480 })
  })

  it("reads WebP dimensions from VP8X", () => {
    const buf = makeWebpWithMetadata({ width: 1999, height: 1333 })
    assert.deepEqual(readImageHeader(buf), { format: "webp", width: 1999, height: 1333 })
  })

  it("returns null for truncated or unrecognized input", () => {
    assert.equal(readImageHeader(Buffer.alloc(0)), null)
    assert.equal(readImageHeader(Buffer.from("not an image", "latin1")), null)
    assert.equal(readImageHeader(makeJpeg(64)), null) // magic bytes but no SOF
    assert.equal(readImageHeader(makePng(16)), null) // signature but no IHDR
    assert.equal(readImageHeader(makeWebp(16)), null) // header but no VP8*
  })
})

describe("readExifSummary", () => {
  it("reads orientation, GPS presence and capture time (big-endian)", () => {
    const buf = makeJpegWithMetadata({
      exif: makeExifTiff({ orientation: 6, gps: true, capturedAt: "2026:06:14 15:04:05" }),
    })
    assert.deepEqual(readExifSummary(buf), {
      orientation: 6,
      hasGps: true,
      capturedAt: "2026-06-14 15:04:05",
    })
  })

  it("reads little-endian TIFF identically", () => {
    const buf = makeJpegWithMetadata({
      exif: makeExifTiff({
        orientation: 8,
        gps: true,
        capturedAt: "2025:12:31 23:59:59",
        littleEndian: true,
      }),
    })
    assert.deepEqual(readExifSummary(buf), {
      orientation: 8,
      hasGps: true,
      capturedAt: "2025-12-31 23:59:59",
    })
  })

  it("handles every orientation value", () => {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const buf = makeJpegWithMetadata({ exif: makeExifTiff({ orientation }) })
      assert.equal(readExifSummary(buf).orientation, orientation, `orientation ${orientation}`)
    }
  })

  it("reports no GPS when the GPS IFD pointer is absent", () => {
    const buf = makeJpegWithMetadata({ exif: makeExifTiff({ orientation: 1, gps: false }) })
    assert.equal(readExifSummary(buf).hasGps, false)
  })

  it("defaults safely when there is no EXIF at all", () => {
    assert.deepEqual(readExifSummary(makeJpegWithMetadata({})), {
      orientation: 1,
      hasGps: false,
      capturedAt: null,
    })
  })

  it("reads EXIF from a PNG eXIf chunk and a WebP EXIF chunk", () => {
    const exif = makeExifTiff({ orientation: 3, gps: true, capturedAt: "2024:01:02 03:04:05" })
    for (const buf of [makePngWithMetadata({ exif }), makeWebpWithMetadata({ exif })]) {
      assert.deepEqual(readExifSummary(buf), {
        orientation: 3,
        hasGps: true,
        capturedAt: "2024-01-02 03:04:05",
      })
    }
  })

  it("rejects an unset camera clock rather than reporting year zero", () => {
    const buf = makeJpegWithMetadata({ exif: makeExifTiff({ capturedAt: "0000:00:00 00:00:00" }) })
    assert.equal(readExifSummary(buf).capturedAt, null)
  })

  it("never throws on malformed EXIF", () => {
    const exif = makeExifTiff({ orientation: 6, gps: true, capturedAt: "2026:06:14 15:04:05" })
    // Truncate the TIFF block at every length; each must yield safe defaults or
    // a partial-but-sane read, and none may throw.
    for (let cut = 0; cut < exif.length; cut++) {
      const buf = makeJpegWithMetadata({ exif: exif.subarray(0, cut) })
      const summary = readExifSummary(buf)
      assert.ok(summary.orientation >= 1 && summary.orientation <= 8, `cut ${cut}`)
    }
    // Garbage where a TIFF header should be.
    const noise = makeJpegWithMetadata({ exif: Buffer.alloc(120, 0xab) })
    assert.deepEqual(readExifSummary(noise), { orientation: 1, hasGps: false, capturedAt: null })
  })
})

describe("stripImageMetadata — JPEG", () => {
  const exif = makeExifTiff({ orientation: 6, gps: true, capturedAt: "2026:06:14 15:04:05" })

  it("drops EXIF, IPTC and comments but keeps JFIF, ICC and the image", () => {
    const buf = makeJpegWithMetadata({ exif, icc: true, iptc: true, comment: true })
    assert.deepEqual(jpegMarkers(buf), ["e0", "e1", "e2", "ed", "fe", "c0", "da"])

    const out = stripImageMetadata(buf)
    assert.deepEqual(jpegMarkers(out), ["e0", "e2", "c0", "da"])
    assert.equal(sniffMagic(out), "jpeg")
    assert.deepEqual(readImageHeader(out), readImageHeader(buf))
    assert.deepEqual(readExifSummary(out), { orientation: 1, hasGps: false, capturedAt: null })
    assert.equal(hasImageMetadata(out), false)
  })

  it("keeps the ICC profile bytes intact", () => {
    const buf = makeJpegWithMetadata({ exif, icc: true })
    const out = stripImageMetadata(buf)
    assert.ok(out.includes(Buffer.from("ICC_PROFILE\0", "latin1")), "ICC profile survives")
    assert.ok(!out.includes(Buffer.from("Exif\0\0", "latin1")), "EXIF identifier is gone")
  })

  it("drops a non-ICC APP2 (an MPF thumbnail) while keeping the real ICC one", () => {
    const buf = makeJpegWithMetadata({ exif, icc: true, mpf: true })
    const out = stripImageMetadata(buf)
    assert.deepEqual(jpegMarkers(out), ["e0", "e2", "c0", "da"])
    assert.ok(out.includes(Buffer.from("ICC_PROFILE\0", "latin1")))
    assert.ok(!out.includes(Buffer.from("MPF\0", "latin1")))
  })

  it("copies the scan data byte-for-byte", () => {
    const buf = makeJpegWithMetadata({ exif })
    const out = stripImageMetadata(buf)
    const scanIn = buf.subarray(buf.length - 50)
    const scanOut = out.subarray(out.length - 50)
    assert.deepEqual(scanOut, scanIn)
  })

  it("returns the same buffer when there is nothing to remove", () => {
    const clean = stripImageMetadata(makeJpegWithMetadata({ iptc: false, comment: false }))
    assert.equal(hasImageMetadata(clean), false)
    assert.equal(stripImageMetadata(clean), clean, "no copy when already clean")
  })
})

describe("stripImageMetadata — PNG", () => {
  it("drops eXIf/tEXt/tIME and keeps iCCP, IHDR and IDAT", () => {
    const exif = makeExifTiff({ orientation: 6, gps: true })
    const buf = makePngWithMetadata({ exif })
    assert.deepEqual(pngChunks(buf), ["IHDR", "iCCP", "eXIf", "tEXt", "tIME", "IDAT", "IEND"])

    const out = stripImageMetadata(buf)
    assert.deepEqual(pngChunks(out), ["IHDR", "iCCP", "IDAT", "IEND"])
    assert.equal(sniffMagic(out), "png")
    assert.deepEqual(readImageHeader(out), readImageHeader(buf))
    assert.equal(hasImageMetadata(out), false)
  })
})

describe("stripImageMetadata — WebP", () => {
  it("drops EXIF/XMP, keeps ICCP and VP8, and clears the VP8X feature bits", () => {
    const exif = makeExifTiff({ orientation: 6, gps: true })
    const buf = makeWebpWithMetadata({ exif })
    assert.deepEqual(webpChunks(buf), ["VP8X", "ICCP", "VP8 ", "EXIF", "XMP "])
    assert.equal(buf[20] & 0x08, 0x08, "input advertises EXIF")
    assert.equal(buf[20] & 0x04, 0x04, "input advertises XMP")

    const out = stripImageMetadata(buf)
    assert.deepEqual(webpChunks(out), ["VP8X", "ICCP", "VP8 "])
    assert.equal(sniffMagic(out), "webp")
    assert.deepEqual(readImageHeader(out), readImageHeader(buf))
    assert.equal(out[20] & 0x08, 0, "EXIF feature bit cleared")
    assert.equal(out[20] & 0x04, 0, "XMP feature bit cleared")
    assert.equal(out[20] & 0x20, 0x20, "ICC feature bit preserved")
    assert.equal(hasImageMetadata(out), false)
  })

  it("rewrites the RIFF size field to match the shortened body", () => {
    const buf = makeWebpWithMetadata({ exif: makeExifTiff({ gps: true }) })
    const out = stripImageMetadata(buf)
    assert.equal(out.readUInt32LE(4), out.length - 8, "RIFF size matches actual length")
    assert.ok(out.length < buf.length)
  })

  it("does not mutate the input buffer when clearing VP8X flags", () => {
    const buf = makeWebpWithMetadata({ exif: makeExifTiff({ gps: true }) })
    const before = Buffer.from(buf)
    stripImageMetadata(buf)
    assert.deepEqual(buf, before)
  })
})

describe("stripImageMetadata — robustness", () => {
  it("passes through formats it does not handle", () => {
    const heic = Buffer.from("00000018667479706865696300000000", "hex")
    assert.equal(stripImageMetadata(heic), heic)
    assert.equal(hasImageMetadata(heic), false)
  })

  it("never throws on truncated input", () => {
    const full = makeJpegWithMetadata({ exif: makeExifTiff({ gps: true }) })
    for (let cut = 0; cut < full.length; cut += 3) {
      const out = stripImageMetadata(full.subarray(0, cut))
      assert.ok(Buffer.isBuffer(out), `cut ${cut}`)
    }
    for (const fixture of [makePngWithMetadata({}), makeWebpWithMetadata({})]) {
      for (let cut = 0; cut < fixture.length; cut += 3) {
        assert.ok(Buffer.isBuffer(stripImageMetadata(fixture.subarray(0, cut))), `cut ${cut}`)
      }
    }
  })
})
