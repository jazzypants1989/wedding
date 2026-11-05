/**
 * @file The pixel half of black-and-white twin detection
 * (public/pages/admin/twin-detect.js) and the capture-time helpers the metadata
 * half matches on (core/capture-time.js). Fixtures are generated pixel arrays,
 * never photographs.
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  TONE_GRID,
  lumaCorrelation,
  measureTone,
  pairDirection,
  proposeTwins,
  toneKind,
} from "../../public/pages/admin/twin-detect.js"
import { parseCapturedAt, readCapturedAt } from "../../core/capture-time.js"
import { makeExifTiff, makeJpegWithMetadata, makePngWithMetadata } from "../media-fixtures.js"

/**
 * A TONE_GRID-square RGBA drawing: a colour gradient whose layout depends on
 * `seed`, so two seeds are two different scenes.
 * @param {number} seed @returns {Uint8ClampedArray}
 */
function scene(seed) {
  const rgba = new Uint8ClampedArray(TONE_GRID * TONE_GRID * 4)
  for (let y = 0; y < TONE_GRID; y++) {
    for (let x = 0; x < TONE_GRID; x++) {
      const i = (y * TONE_GRID + x) * 4
      // A brightness field with colour laid over it, as in a real scene: the
      // channels share their structure and differ in tint.
      const light = 120 + 90 * Math.sin((x + seed * 7) / 5) * Math.cos((y - seed * 3) / 4)
      rgba[i] = light * 1.15 + 18 * Math.sin((x * y + seed) / 40)
      rgba[i + 1] = light * 0.85
      rgba[i + 2] = light * 0.6 + 30 * Math.cos((x - y) / 9)
      rgba[i + 3] = 255
    }
  }
  return rgba
}

/**
 * The same drawing in black and white, through a channel mix that is not plain
 * luma — the way a photographer's conversion differs — plus a little noise.
 * @param {Uint8ClampedArray} rgba @returns {Uint8ClampedArray}
 */
function blackAndWhite(rgba) {
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const v = 0.5 * rgba[i] + 0.4 * rgba[i + 1] + 0.1 * rgba[i + 2]
    out[i] = v + ((i / 4) % 3) - 1
    out[i + 1] = v
    out[i + 2] = v + ((i / 4) % 2)
    out[i + 3] = 255
  }
  return out
}

/** @param {Uint8ClampedArray} rgba */
function tone(rgba) {
  const t = measureTone(rgba)
  assert.ok(t)
  return t
}

describe("twin detection over pixels", () => {
  it("tells a colour picture from its black-and-white copy", () => {
    const colour = scene(1)
    assert.strictEqual(toneKind(tone(colour)), "colour")
    assert.strictEqual(toneKind(tone(blackAndWhite(colour))), "gray")
    assert.strictEqual(measureTone(new Uint8ClampedArray(0)), null)
  })

  it("a copy's brightness lines up with its own frame better than a burst neighbour's", () => {
    const frame = tone(scene(1))
    const neighbour = tone(scene(4))
    const copy = tone(blackAndWhite(scene(1)))
    assert.ok(lumaCorrelation(copy.luma, frame.luma) > 0.9)
    assert.ok(
      lumaCorrelation(copy.luma, frame.luma) > lumaCorrelation(copy.luma, neighbour.luma),
    )
    assert.strictEqual(lumaCorrelation([5, 5, 5], [1, 2, 3]), 0, "a flat picture matches nothing")
  })

  it("pairs each copy in a burst with its own frame, each photo once", () => {
    const tones = new Map([
      [1, tone(scene(1))],
      [2, tone(scene(5))],
      [3, tone(blackAndWhite(scene(5)))],
      [4, tone(blackAndWhite(scene(1)))],
      [5, null], // a thumbnail that would not load
    ])
    const proposals = proposeTwins([{ members: [1, 2, 3, 4, 5].map((id) => ({ id })) }], tones)
    assert.deepStrictEqual(
      proposals.map((p) => [p.primaryId, p.twinId]).sort((a, b) => a[0] - b[0]),
      [
        [1, 4],
        [2, 3],
      ],
    )
  })

  it("proposes nothing for two colour photos, or two black-and-white ones", () => {
    const colours = new Map([
      [1, tone(scene(1))],
      [2, tone(scene(1))],
    ])
    assert.deepStrictEqual(proposeTwins([{ members: [{ id: 1 }, { id: 2 }] }], colours), [])
    const grays = new Map([
      [1, tone(blackAndWhite(scene(1)))],
      [2, tone(blackAndWhite(scene(1)))],
    ])
    assert.deepStrictEqual(proposeTwins([{ members: [{ id: 1 }, { id: 2 }] }], grays), [])
  })

  it("a by-hand pair keeps the chosen photo as colour unless the pixels plainly disagree", () => {
    const colour = tone(scene(2))
    const gray = tone(blackAndWhite(scene(2)))
    assert.deepStrictEqual(pairDirection({ id: 1, tone: gray }, { id: 2, tone: colour }), {
      primaryId: 2,
      twinId: 1,
    })
    assert.deepStrictEqual(pairDirection({ id: 1, tone: colour }, { id: 2, tone: gray }), {
      primaryId: 1,
      twinId: 2,
    })
    assert.deepStrictEqual(pairDirection({ id: 1, tone: null }, { id: 2, tone: colour }), {
      primaryId: 1,
      twinId: 2,
    })
  })
})

describe("capture time", () => {
  it("parseCapturedAt takes exactly the EXIF summary's shape", () => {
    assert.strictEqual(parseCapturedAt("2026-04-26 17:03:12"), "2026-04-26 17:03:12")
    for (const bad of [
      "2026-04-26T17:03:12",
      "2026:04:26 17:03:12",
      "2026-04-26 17:03",
      "0000-00-00 00:00:00",
      "2026-04-26 17:03:1x",
      " 2026-04-26 17:03:12",
      42,
      null,
      undefined,
    ]) {
      assert.strictEqual(parseCapturedAt(bad), null, String(bad))
    }
  })

  it("readCapturedAt reads a JPEG's and a PNG's EXIF, and is null for everything else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-time-"))
    try {
      const exif = makeExifTiff({ capturedAt: "2026:04:26 17:03:12" })
      const jpg = path.join(dir, "original.jpg")
      fs.writeFileSync(jpg, makeJpegWithMetadata({ exif }))
      assert.strictEqual(readCapturedAt(jpg, "jpg"), "2026-04-26 17:03:12")
      const png = path.join(dir, "original.png")
      fs.writeFileSync(png, makePngWithMetadata({ exif }))
      assert.strictEqual(readCapturedAt(png, "png"), "2026-04-26 17:03:12")
      const bare = path.join(dir, "bare.jpg")
      fs.writeFileSync(bare, makeJpegWithMetadata({ exif: null }))
      assert.strictEqual(readCapturedAt(bare, "jpg"), null)
      assert.strictEqual(readCapturedAt(path.join(dir, "missing.jpg"), "jpg"), null)
      assert.strictEqual(readCapturedAt(jpg, "heic"), null)
      assert.strictEqual(readCapturedAt(jpg, null), null)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
