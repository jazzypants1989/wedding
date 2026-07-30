/** @file Unit test: the perceptual frame hash, the second level of dedup.
 *
 *  The property that matters is asymmetric, so both halves are asserted here:
 *  a re-encode of one frame must stay CLOSE (or the near-duplicates it is meant
 *  to find slip through, collapse the same-person distances and forge a good
 *  separation number), and two different frames must stay FAR (or real faces get
 *  written off as duplicates and the measurement quietly shrinks).
 *
 *  Every buffer here is generated procedurally. No image file is opened.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json) — same pattern as vision-align.test.js.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { averageHash, hammingDistance } from "../../public/vision/frame-hash.js"

function clamp8(v) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

/** Build an RgbImage from a per-pixel function returning [r,g,b]. */
function make(width, height, fn) {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x / (width - 1 || 1), y / (height - 1 || 1))
      const i = (y * width + x) * 3
      rgb[i] = clamp8(r)
      rgb[i + 1] = clamp8(g)
      rgb[i + 2] = clamp8(b)
    }
  }
  return { width, height, rgb }
}

/** Deterministic pseudo-noise in [-1, 1]; a seeded LCG, not Math.random. */
function noiseField(seed) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 2147483648 - 1
  }
}

/**
 * A synthetic "scene" defined in normalised coordinates, so it can be rendered
 * at any resolution — which is how the re-encode case is simulated without
 * touching a photograph.
 */
function scene(u, v) {
  const blob = Math.exp(-((u - 0.32) ** 2 + (v - 0.4) ** 2) / 0.02) * 190
  const band = v > 0.72 ? 70 : 0
  const ramp = u * 60
  return [blob + band + ramp, blob * 0.7 + band + 20, 40 + band * 0.5 + ramp * 0.5]
}

const HORIZONTAL_GRADIENT = (u) => [u * 255, u * 255, u * 255]

// --- averageHash shape ---

test("averageHash is 64 lowercase hex characters at the default size 16", () => {
  const hash = averageHash(make(120, 90, HORIZONTAL_GRADIENT))
  assert.equal(hash.length, 64)
  for (let i = 0; i < hash.length; i++) {
    assert.ok("0123456789abcdef".includes(hash[i]), `non-hex character ${hash[i]} at ${i}`)
  }
})

test("averageHash length tracks the requested size", () => {
  const image = make(64, 64, (u, v) => [u * 255, v * 255, 128])
  assert.equal(averageHash(image, 8).length, 16) // 64 bits
  assert.equal(averageHash(image, 4).length, 4) // 16 bits
  assert.equal(averageHash(image, 32).length, 256) // 1024 bits
})

test("averageHash refuses sizes it cannot express in whole nibbles", () => {
  const image = make(16, 16, () => [10, 20, 30])
  assert.throws(() => averageHash(image, 0))
  assert.throws(() => averageHash(image, 3.5))
  assert.throws(() => averageHash(image, 3)) // 9 cells is not a whole number of nibbles
})

test("averageHash of a flat image is all ones", () => {
  // Every cell equals the mean and the test is `>=`, so a featureless frame gets
  // a recognisable signature rather than an arbitrary one.
  assert.equal(averageHash(make(80, 60, () => [128, 128, 128])), "f".repeat(64))
  assert.equal(averageHash(make(80, 60, () => [3, 3, 3])), "f".repeat(64))
})

test("averageHash is deterministic: identical buffers hash identically", () => {
  const a = make(200, 150, scene)
  const b = make(200, 150, scene)
  assert.notEqual(a.rgb, b.rgb)
  assert.equal(averageHash(a), averageHash(b))
  assert.equal(hammingDistance(averageHash(a), averageHash(b)), 0)
})

// --- what it must distinguish ---

test("a horizontal flip of a gradient inverts every bit", () => {
  const gradient = make(160, 120, HORIZONTAL_GRADIENT)
  const flipped = make(160, 120, (u) => HORIZONTAL_GRADIENT(1 - u))

  const distance = hammingDistance(averageHash(gradient), averageHash(flipped))
  // A left-to-right ramp puts every cell on the opposite side of the mean once
  // mirrored, so all 256 bits differ. This is the maximum the hash can report,
  // and it is the sanity check that the bits are laid out in the order claimed.
  assert.equal(distance, 256)
})

test("a vertical gradient is unchanged by a horizontal flip", () => {
  const image = make(160, 120, (u, v) => [v * 255, v * 255, v * 255])
  const flipped = make(160, 120, (u, v) => [v * 255, v * 255, v * 255])
  assert.equal(hammingDistance(averageHash(image), averageHash(flipped)), 0)
  // ...and it is a different hash from the horizontal one, i.e. the hash is not
  // accidentally row- or column-blind.
  assert.notEqual(averageHash(image), averageHash(make(160, 120, HORIZONTAL_GRADIENT)))
})

test("a re-encode-like perturbation keeps the distance small", () => {
  const original = make(240, 180, scene)
  const noise = noiseField(20260729)
  const reencoded = {
    width: original.width,
    height: original.height,
    rgb: new Uint8Array(original.rgb.length),
  }
  for (let i = 0; i < original.rgb.length; i++) {
    reencoded.rgb[i] = clamp8(original.rgb[i] + noise() * 3)
  }

  const distance = hammingDistance(averageHash(original), averageHash(reencoded))
  assert.ok(distance >= 0)
  assert.ok(distance <= 8, `+-3 per channel should barely move the hash, got ${distance}`)
})

test("a uniform exposure shift does not move the hash at all", () => {
  // The threshold is the frame's own mean, so a global offset cancels. This is
  // the property that makes the hash survive an export at a different profile.
  const original = make(200, 150, scene)
  const brighter = {
    width: original.width,
    height: original.height,
    rgb: original.rgb.map((v) => clamp8(v * 0.9 + 12)),
  }
  assert.equal(averageHash(original), averageHash(brighter))
})

test("the same scene rendered at a different resolution hashes close", () => {
  // The actual case this module exists for: one frame, delivered twice, resized.
  // The area-average downsample is what makes this hold; nearest-neighbour
  // sampling would alias and scatter the low bits.
  const large = make(400, 300, scene)
  const small = make(160, 120, scene)
  const distance = hammingDistance(averageHash(large), averageHash(small))
  assert.ok(distance >= 0 && distance <= 8, `resize should be near-invariant, got ${distance}`)
})

test("an unrelated synthetic image is far away", () => {
  const a = make(240, 180, scene)
  const b = make(240, 180, (u, v) => {
    const checker = (Math.floor(u * 6) + Math.floor(v * 6)) % 2 === 0 ? 230 : 25
    return [checker, 255 - checker, (u + v) * 120]
  })
  const distance = hammingDistance(averageHash(a), averageHash(b))
  assert.ok(distance > 60, `unrelated frames should be far apart, got ${distance}`)
})

test("the near/far gap is wide enough for a cutoff to exist", () => {
  const original = make(320, 240, scene)
  const noise = noiseField(4242)
  const reencoded = {
    width: original.width,
    height: original.height,
    rgb: original.rgb.map((v) => clamp8(v + noise() * 3)),
  }
  const other = make(320, 240, (u, v) => [255 - v * 200, u * 200, 60 + u * v * 150])

  const near = hammingDistance(averageHash(original), averageHash(reencoded))
  const far = hammingDistance(averageHash(original), averageHash(other))
  assert.ok(far > near + 40, `near ${near} vs far ${far} leaves no room for a cutoff`)
})

test("averageHash rejects an empty image instead of returning NaN bits", () => {
  assert.throws(() => averageHash({ width: 0, height: 0, rgb: new Uint8Array(0) }))
})

// --- hammingDistance ---

test("hammingDistance is 0 for identical strings", () => {
  assert.equal(hammingDistance("", ""), 0)
  assert.equal(hammingDistance("00000000", "00000000"), 0)
  assert.equal(hammingDistance("deadbeef", "deadbeef"), 0)
  assert.equal(hammingDistance("f".repeat(64), "f".repeat(64)), 0)
})

test("hammingDistance counts a hand-built pair correctly", () => {
  assert.equal(hammingDistance("0", "1"), 1) // 0000 vs 0001
  assert.equal(hammingDistance("0", "f"), 4) // 0000 vs 1111
  assert.equal(hammingDistance("0f", "f0"), 8) // every bit differs
  assert.equal(hammingDistance("00", "01"), 1)
  assert.equal(hammingDistance("a5", "5a"), 8) // 1010 0101 vs 0101 1010
  assert.equal(hammingDistance("1234", "1235"), 1) // 0100 vs 0101
  // 0x9 = 1001, 0x6 = 0110 -> 4; 0x3 = 0011, 0x1 = 0001 -> 1; total 5.
  assert.equal(hammingDistance("93", "61"), 5)
  assert.equal(hammingDistance("0".repeat(64), "f".repeat(64)), 256)
})

test("hammingDistance returns -1 on a length mismatch", () => {
  assert.equal(hammingDistance("00", "000"), -1)
  assert.equal(hammingDistance("f".repeat(64), "f".repeat(16)), -1)
  assert.equal(hammingDistance("", "0"), -1)
})

test("hammingDistance accepts upper case and rejects non-hex", () => {
  assert.equal(hammingDistance("DEADBEEF", "deadbeef"), 0)
  assert.equal(hammingDistance("A5", "5a"), 8)
  // Not comparable rather than silently wrong: the same -1 the caller already
  // checks for.
  assert.equal(hammingDistance("zz", "00"), -1)
  assert.equal(hammingDistance("00", " 0"), -1)
})

test("hammingDistance is symmetric", () => {
  const a = averageHash(make(200, 150, scene))
  const b = averageHash(make(200, 150, HORIZONTAL_GRADIENT))
  assert.equal(hammingDistance(a, b), hammingDistance(b, a))
})
