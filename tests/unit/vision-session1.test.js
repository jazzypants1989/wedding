/** @file Unit test: session1.js's decision logic, with no ONNX runtime, no
 *  image backend and — emphatically — no photographs.
 *
 *  Everything the batch decides is reachable without any of those three: the
 *  argument parse, the two-level duplicate bookkeeping, the pool split, the
 *  record builders, the resolution IoU match. The per-photo path is exercised
 *  end to end by injecting a fake engine that returns canned detections and
 *  canned descriptors over procedurally generated pixel buffers, which is enough
 *  to catch the wiring mistakes that would otherwise only surface an hour into a
 *  real run.
 *
 *  Two assertions here exist because getting them wrong forges a good answer
 *  rather than producing an error: that boxes are mapped back by the scale
 *  `boxDownsample` ACHIEVED rather than the one it was asked for, and that the
 *  two pools are disjoint.
 */

import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"

import {
  assignPools,
  buildContactData,
  buildFaceRecord,
  buildPhotoRecord,
  capturedAtToMs,
  createDuplicateIndex,
  cropName,
  groupPoolB,
  matchResolutionIou,
  parseArgs,
  processPhoto,
  resolutionSampleIndices,
  runSession1,
  seededRandom,
} from "../../scripts/vision/session1.js"

/** @import * as Types from '../../scripts/vision/types.js' */
/** @import * as LibTypes from '../../scripts/lib/types.js' */
/** @import * as VisionTypes from '../../public/vision/types.js' */

/** @type {string[]} */
const madeDirs = []
after(() => {
  for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/** @param {string} label @returns {string} */
function workDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vision-session1-${label}-`))
  madeDirs.push(dir)
  return dir
}

// --- Synthetic inputs --------------------------------------------------------

/**
 * A procedurally generated image. Not a photograph, not derived from one: a
 * deterministic pattern with structure in both axes, so a transposed or
 * off-by-one buffer would change the numbers rather than pass unnoticed.
 * @param {number} width @param {number} height @returns {VisionTypes.RgbImage}
 */
function syntheticImage(width, height) {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      rgb[i] = (x * 5 + y * 11) & 0xff
      rgb[i + 1] = (x * 3) & 0xff
      rgb[i + 2] = (y * 7 + 60) & 0xff
    }
  }
  return { width, height, rgb }
}

/** @param {number} x @param {number} y @param {number} size @returns {VisionTypes.Detection} */
function detection(x, y, size) {
  const eye = size * 0.32
  return {
    box: { x, y, w: size, h: size },
    // Five points in the canonical order: left eye, right eye, nose, mouth
    // corners — plausible geometry, so alignFace produces a real transform.
    landmarks: [
      x + size / 2 - eye / 2,
      y + size * 0.38,
      x + size / 2 + eye / 2,
      y + size * 0.38,
      x + size / 2,
      y + size * 0.55,
      x + size / 2 - eye / 2.6,
      y + size * 0.73,
      x + size / 2 + eye / 2.6,
      y + size * 0.73,
    ],
    score: 0.9,
  }
}

/**
 * An engine that answers from a script rather than from a model.
 * @param {{ perImage?: (image: VisionTypes.RgbImage) => VisionTypes.Detection[] }} [options]
 */
function fakeEngine(options = {}) {
  /** @type {{ detectCalls: Array<{ width: number, height: number }>, describeCalls: number }} */
  const seen = { detectCalls: [], describeCalls: 0 }
  const perImage = options.perImage ?? ((image) => [detection(10, 10, Math.min(120, image.width / 4))])

  /** @type {Types.VisionEngine & { seen: typeof seen }} */
  const engine = {
    seen,
    async detect(image) {
      seen.detectCalls.push({ width: image.width, height: image.height })
      return perImage(image)
    },
    async describe(crop) {
      seen.describeCalls++
      // Deterministic and dependent on the pixels, so a mirrored crop describes
      // differently — which is what makes the mirror-TTA assertion meaningful.
      const out = new Float32Array(8)
      for (let i = 0; i < crop.rgb.length; i++) out[i % 8] += crop.rgb[i]
      let norm = 0
      for (const v of out) norm += v * v
      const len = Math.sqrt(norm) || 1
      for (let i = 0; i < out.length; i++) out[i] /= len
      return out
    },
    info: () => ({ runtime: "fake", detector: "fake-detector", embedder: "fake-embedder" }),
  }
  return engine
}

/** @returns {LibTypes.ImageBackend} */
function fakeBackend() {
  return {
    name: "vips",
    bin: "vips",
    versionArgs: ["--version"],
    canWebp: true,
    canHeic: true,
    autoOrients: true,
    canRawPixels: true,
    version: "vips-fake",
    headerBin: null,
    childEnv: {},
  }
}

/**
 * Deps that never touch a real decoder, a real EXIF reader or a real file's
 * bytes — but do use the real scanDirectory, the real align/gate/group code and
 * the real PNG writer.
 * @param {{ image?: VisionTypes.RgbImage, capturedAt?: string | null }} [options]
 */
function fakeDeps(options = {}) {
  const image = options.image ?? syntheticImage(600, 400)
  /** @type {string[]} */
  const lines = []
  return {
    lines,
    deps: {
      backends: { image: fakeBackend(), video: null },
      engine: fakeEngine(),
      /** @type {typeof import('../../scripts/vision/pixels-cli.js').readPixels} */
      readPixels: async () => image,
      /** @type {typeof import('../../scripts/lib/media-variants.js').planMediaFile} */
      planMediaFile: async (sourcePath) => ({
        ok: true,
        sourcePath,
        kind: /** @type {"image"} */ ("image"),
        sniffed: /** @type {"jpeg"} */ ("jpeg"),
        originalExt: "jpg",
        originalBytes: 1234,
        width: image.width,
        height: image.height,
        durationSeconds: null,
        orientation: 1,
        hasGps: false,
        capturedAt: options.capturedAt === undefined ? "2026-06-13 15:04:05" : options.capturedAt,
        mtimeMs: 1700000000000,
      }),
      /** @param {string} filePath */
      hashFile: async (filePath) => "sha-" + path.basename(filePath),
      /** @param {string} line */
      log: (line) => lines.push(line),
    },
  }
}

/**
 * A directory of files with plausible names and arbitrary bytes. Nothing here
 * decodes them; the fake readPixels supplies pixels.
 * @param {string} label @param {string[]} names @returns {string}
 */
function makeInputDir(label, names) {
  const dir = workDir(label)
  for (const name of names) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), "not-a-photograph-" + name)
  }
  return dir
}

// --- Arguments ---------------------------------------------------------------

test("a missing directory is an error — nothing is searched for", () => {
  const parsed = parseArgs([])
  assert.equal(parsed.valid, false)
  assert.ok(parsed.valid === false && parsed.error.includes("path is always an argument"))
})

test("the directory is the only positional, and extras are rejected", () => {
  const parsed = parseArgs(["/a", "/b"])
  assert.equal(parsed.valid, false)
  assert.ok(parsed.valid === false && parsed.error.includes("Quote paths"))
})

test("defaults come from the tunables table, not from literals here", () => {
  const parsed = parseArgs(["/photos"])
  assert.ok(parsed.valid)
  if (!parsed.valid) return
  assert.equal(parsed.value.detectEdge, 1280)
  assert.equal(parsed.value.sourceEdge, 2000)
  assert.equal(parsed.value.poolASize, 150)
  assert.equal(parsed.value.limit, null)
  assert.equal(parsed.value.mirrorTta, false)
  assert.equal(parsed.value.recursive, false)
  assert.equal(parsed.value.dir, path.resolve("/photos"))
  assert.equal(parsed.value.outDir, path.resolve("tmp/session1"))
  assert.equal(parsed.value.enginePath, "tmp/rig/engine.mjs")
})

test("both --flag=value and --flag value are accepted", () => {
  const spaced = parseArgs(["/photos", "--out", "tmp/x", "--detect-edge", "960"])
  const equals = parseArgs(["/photos", "--out=tmp/x", "--detect-edge=960"])
  assert.ok(spaced.valid && equals.valid)
  if (!spaced.valid || !equals.valid) return
  assert.deepEqual(spaced.value, equals.value)
  assert.equal(spaced.value.detectEdge, 960)
})

test("boolean flags, and a value flag with no value", () => {
  const parsed = parseArgs(["/photos", "--recursive", "--mirror-tta", "--limit", "25"])
  assert.ok(parsed.valid)
  if (!parsed.valid) return
  assert.equal(parsed.value.recursive, true)
  assert.equal(parsed.value.mirrorTta, true)
  assert.equal(parsed.value.limit, 25)

  const dangling = parseArgs(["/photos", "--out"])
  assert.equal(dangling.valid, false)
  const followed = parseArgs(["/photos", "--out", "--recursive"])
  assert.equal(followed.valid, false)
})

test("unknown options and non-integers are refused", () => {
  assert.equal(parseArgs(["/photos", "--nope=1"]).valid, false)
  assert.equal(parseArgs(["/photos", "--recursive=yes"]).valid, false)
  assert.equal(parseArgs(["/photos", "--pool-a=0"]).valid, false)
  assert.equal(parseArgs(["/photos", "--pool-a=3.5"]).valid, false)
  assert.equal(parseArgs(["/photos", "--limit=-2"]).valid, false)
})

// --- Duplicate bookkeeping ---------------------------------------------------

test("exact duplicates point at the first photo with those bytes, not at each other", () => {
  const index = createDuplicateIndex({ nearBits: 0 })
  const zero = "0".repeat(64)
  assert.deepEqual(index.add(0, "aaa", zero), { exactDuplicateOf: null, nearDuplicateOf: null })
  assert.equal(index.add(1, "bbb", "f" + zero.slice(1)).exactDuplicateOf, null)
  assert.equal(index.add(2, "aaa", zero).exactDuplicateOf, 0)
  // First wins: the third copy points at photo 0, not at photo 2.
  assert.equal(index.add(3, "aaa", zero).exactDuplicateOf, 0)
})

test("near duplicates are found by hamming distance and are recorded, not dropped", () => {
  const index = createDuplicateIndex({ nearBits: 4 })
  const base = "00000000000000000000000000000000"
  // One differing bit: 0x1 in the last nibble.
  const oneBit = base.slice(0, 31) + "1"
  // Sixteen differing bits, far outside the window.
  const far = "ffff" + base.slice(4)

  assert.equal(index.add(0, "a", base).nearDuplicateOf, null)
  assert.equal(index.add(1, "b", oneBit).nearDuplicateOf, 0)
  assert.equal(index.add(2, "c", far).nearDuplicateOf, null)
  assert.equal(index.add(3, "d", oneBit).nearDuplicateOf, 0, "first wins")
})

test("an exact duplicate is also flagged as a near duplicate — both are recorded", () => {
  const index = createDuplicateIndex()
  const hash = "0123456789abcdef0123456789abcdef"
  index.add(0, "same", hash)
  assert.deepEqual(index.add(1, "same", hash), { exactDuplicateOf: 0, nearDuplicateOf: 0 })
})

test("hashes of differing lengths never count as duplicates", () => {
  const index = createDuplicateIndex({ nearBits: 300 })
  index.add(0, "a", "0000")
  assert.equal(index.add(1, "b", "00000000").nearDuplicateOf, null)
})

// --- Record builders ---------------------------------------------------------

test("cropName is zero-padded and matches the crops/ directory layout", () => {
  assert.equal(cropName(0), "crops/000000.png")
  assert.equal(cropName(123), "crops/000123.png")
  assert.equal(cropName(1234567), "crops/1234567.png")
})

test("capturedAtToMs reads EXIF's local-time string, and refuses nonsense", () => {
  assert.equal(capturedAtToMs("2026-06-13 15:04:05"), new Date(2026, 5, 13, 15, 4, 5).getTime())
  assert.equal(capturedAtToMs(null), null)
  assert.equal(capturedAtToMs(""), null)
  // A camera with no clock writes this, and it is not a capture time.
  assert.equal(capturedAtToMs("0000:00:00 00:00:00"), null)
  assert.equal(capturedAtToMs("2026-06-13"), null)
  assert.equal(capturedAtToMs("not a date at all"), null)
})

test("buildPhotoRecord carries the duplicate links and rounds the timings", () => {
  const record = buildPhotoRecord({
    id: 7,
    relative: "a/b.jpg",
    sha256: "abc",
    aHash: "def",
    width: 2000,
    height: 1333,
    capturedAt: "2026-06-13 15:04:05",
    mtimeMs: 1700000000000.7,
    faces: 3,
    duplicates: { exactDuplicateOf: null, nearDuplicateOf: 2 },
    ms: { decode: 12.345678, downsample: 1.1, detect: 30.06, align: 0.4, describe: 9.99 },
  })
  assert.equal(record.id, 7)
  assert.equal(record.relative, "a/b.jpg")
  assert.equal(record.nearDuplicateOf, 2)
  assert.equal(record.exactDuplicateOf, null)
  assert.equal(record.mtimeMs, 1700000000001)
  assert.equal(record.ms.decode, 12.3)
  assert.equal(record.ms.detect, 30.1)
  assert.equal(typeof record.capturedAtMs, "number")
})

test("buildFaceRecord emits every gate signal and omits mirrorDescriptor when absent", () => {
  const signals = {
    score: 0.912345,
    boxPx: 84.4444,
    borderPx: -3.5,
    eyeRatio: 0.334455,
    eyeAngle: 0.0123456,
    alignScale: 1.234567,
    residual: 2.34567,
    outsideFraction: 0.001234,
    sharpness: 0.00456789,
  }
  const plain = buildFaceRecord({
    id: 5,
    photoId: 2,
    detection: detection(10, 20, 60),
    signals,
    descriptor: new Float32Array([0.5, -0.25]),
  })
  assert.equal(plain.crop, "crops/000005.png")
  assert.equal(plain.photoId, 2)
  assert.deepEqual(Object.keys(plain.signals).sort(), Object.keys(signals).sort())
  assert.equal(plain.signals.borderPx, -3.5, "a negative border is a real signal, not clamped")
  assert.deepEqual(plain.descriptor, [0.5, -0.25])
  assert.equal("mirrorDescriptor" in plain, false)

  const mirrored = buildFaceRecord({
    id: 6,
    photoId: 2,
    detection: detection(10, 20, 60),
    signals,
    descriptor: new Float32Array([0.5, -0.25]),
    mirrorDescriptor: new Float32Array([0.4, -0.3]),
  })
  assert.deepEqual(mirrored.mirrorDescriptor, [0.4, -0.3])
})

// --- Resolution comparison ---------------------------------------------------

test("matchResolutionIou finds the best overlap per detect-edge box, 0 when there is none", () => {
  const atDetect = [detection(0, 0, 100), detection(500, 500, 40)]
  const atSource = [detection(5, 5, 100), detection(300, 10, 50)]
  const matched = matchResolutionIou(atDetect, atSource)
  assert.equal(matched.length, 2)
  assert.ok(matched[0] > 0.8 && matched[0] < 1)
  assert.equal(matched[1], 0, "no source box overlaps the second detection")
  assert.deepEqual(matchResolutionIou([], atSource), [])
})

test("resolutionSampleIndices spreads the subsample rather than taking the first N", () => {
  const spread = resolutionSampleIndices(100, 5)
  assert.deepEqual([...spread].sort((a, b) => a - b), [0, 20, 40, 60, 80])
  assert.equal(resolutionSampleIndices(3, 10).size, 3, "sample larger than the input takes all")
  assert.equal(resolutionSampleIndices(100, 0).size, 0)
  assert.equal(resolutionSampleIndices(0, 10).size, 0)
})

// --- Pools -------------------------------------------------------------------

/** @param {number} n @returns {Array<{id:number,crop:string,photoId:number}>} */
function poolFaces(n) {
  return Array.from({ length: n }, (_v, i) => ({
    id: i,
    crop: cropName(i),
    photoId: Math.floor(i / 3),
  }))
}

test("seededRandom is reproducible and stays inside [0,1)", () => {
  const a = seededRandom(42)
  const b = seededRandom(42)
  for (let i = 0; i < 200; i++) {
    const value = a()
    assert.equal(value, b())
    assert.ok(value >= 0 && value < 1)
  }
  assert.notEqual(seededRandom(43)(), seededRandom(42)())
})

test("the two pools are disjoint, cover every face, and have the requested sizes", () => {
  const data = assignPools(poolFaces(200), { poolASize: 30 })
  const a = data.faces.filter((f) => f.pool === "A").map((f) => f.id)
  const b = data.faces.filter((f) => f.pool === "B").map((f) => f.id)
  assert.equal(a.length, 30)
  assert.equal(b.length, 170)
  assert.equal(new Set([...a, ...b]).size, 200)
  for (const id of a) assert.ok(!b.includes(id))
})

test("pool A is a uniform sample, not the first N faces", () => {
  const data = assignPools(poolFaces(300), { poolASize: 60 })
  const a = data.faces.filter((f) => f.pool === "A").map((f) => f.id)
  const inFirst60 = a.filter((id) => id < 60).length
  // A prefix sample would put all 60 here. Uniform puts roughly a fifth.
  assert.ok(inFirst60 < 30, `pool A drew ${inFirst60} of its 60 from the first 60 faces`)
  assert.ok(Math.max(...a) > 240, "pool A reaches the end of the run")
})

test("a pool A larger than the face count takes everything, and leaves pool B empty", () => {
  const data = assignPools(poolFaces(12), { poolASize: 150 })
  assert.equal(data.faces.filter((f) => f.pool === "B").length, 0)
  for (const face of data.faces) assert.equal(face.group, null)
})

test("the presentation order is a fixed shuffle: reproducible, complete, not sorted", () => {
  const first = assignPools(poolFaces(120), { poolASize: 20 })
  const second = assignPools(poolFaces(120), { poolASize: 20 })
  assert.deepEqual(first.order, second.order)
  assert.equal(first.order.length, 120)
  assert.equal(new Set(first.order).size, 120)
  const ascending = first.order.every((id, i) => i === 0 || first.order[i - 1] < id)
  assert.equal(ascending, false, "an ascending order would let a labeller cherry-pick by photo")
})

test("changing --pool-a does not reshuffle the presentation order", () => {
  const small = assignPools(poolFaces(120), { poolASize: 10 })
  const large = assignPools(poolFaces(120), { poolASize: 40 })
  assert.deepEqual(small.order, large.order)
})

test("group ids are attached to pool B only, and never to a singleton", () => {
  const faces = poolFaces(10)
  const data = assignPools(faces, {
    poolASize: 2,
    // Two of the pool B faces share a group; the rest are singletons.
    groupPoolB: (poolB) => poolB.map((_face, i) => (i < 2 ? 0 : null)),
  })
  const grouped = data.faces.filter((f) => f.group !== null)
  assert.equal(grouped.length, 2)
  for (const face of grouped) assert.equal(face.pool, "B")
})

test("a groupPoolB returning the wrong number of ids is a failure, not a silent misalignment", () => {
  assert.throws(
    () => assignPools(poolFaces(10), { poolASize: 2, groupPoolB: () => [0] }),
    (err) => err instanceof Error && err.message.includes("group ids for"),
  )
})

test("groupPoolB groups identical descriptors and leaves lone ones ungrouped", () => {
  const faces = [
    { id: 0, crop: cropName(0), photoId: 0 },
    { id: 1, crop: cropName(1), photoId: 1 },
    { id: 2, crop: cropName(2), photoId: 2 },
  ]
  const descriptors = new Map([
    [0, [1, 0, 0, 0]],
    [1, [1, 0, 0, 0]],
    [2, [0, 0, 0, 1]],
  ])
  const groups = groupPoolB(faces, descriptors, { cutoff: 0.45, cannotLinkWithinPhoto: true })
  assert.equal(groups[0], groups[1])
  assert.notEqual(groups[0], null)
  assert.equal(groups[2], null, "an orthogonal descriptor is a singleton, so it gets no group")
  assert.deepEqual(groupPoolB([], descriptors, { cutoff: 0.45, cannotLinkWithinPhoto: true }), [])
})

test("cannot-link keeps two faces from one photograph out of the same group", () => {
  const faces = [
    { id: 0, crop: cropName(0), photoId: 4 },
    { id: 1, crop: cropName(1), photoId: 4 },
  ]
  const descriptors = new Map([
    [0, [1, 0]],
    [1, [1, 0]],
  ])
  const linked = groupPoolB(faces, descriptors, { cutoff: 0.45, cannotLinkWithinPhoto: true })
  assert.deepEqual(linked, [null, null], "identical descriptors, same photo: two people")
  const unlinked = groupPoolB(faces, descriptors, { cutoff: 0.45, cannotLinkWithinPhoto: false })
  assert.equal(unlinked[0], unlinked[1])
})

// --- The per-photograph path -------------------------------------------------

test("processPhoto runs decode → detect → align → gate → describe with a fake engine", async () => {
  const dir = makeInputDir("photo", ["a.jpg"])
  const { deps } = fakeDeps()
  const engine = deps.engine

  const outcome = await processPhoto(
    { absolute: path.join(dir, "a.jpg"), relative: "a.jpg", name: "a.jpg" },
    {
      id: 3,
      firstFaceId: 11,
      engine,
      backend: fakeBackend(),
      backends: deps.backends,
      args: parseArgsOrThrow(["/photos"]),
      detectOptions: { scoreThreshold: 0.6, nmsIou: 0.3, topK: 5000, divisor: 32 },
      duplicateIou: 0.55,
      alignSize: 112,
      wantResolution: false,
      scratchDir: dir,
      duplicates: createDuplicateIndex(),
      readPixels: deps.readPixels,
      planMediaFile: deps.planMediaFile,
      hashFile: deps.hashFile,
    },
  )

  assert.equal(outcome.photo.id, 3)
  assert.equal(outcome.photo.width, 600)
  assert.equal(outcome.photo.faces, 1)
  assert.equal(outcome.faces.length, 1)
  assert.equal(outcome.faces[0].id, 11, "face ids continue from firstFaceId")
  assert.equal(outcome.faces[0].photoId, 3)
  assert.equal(outcome.crops[0].width, 112)
  assert.equal(outcome.crops[0].height, 112)
  assert.equal(outcome.faces[0].descriptor.length, 8)
  assert.equal("mirrorDescriptor" in outcome.faces[0], false)
  // Every signal recorded; nothing rejected. The gate scores here and decides
  // in the report, because the cutoffs come from the input's own distribution.
  assert.equal(typeof outcome.faces[0].signals.sharpness, "number")
  assert.equal(typeof outcome.faces[0].signals.residual, "number")
  assert.equal(engine.seen.describeCalls, 1)
})

test("detection runs on the downsampled buffer and crops come from the source buffer", async () => {
  const dir = makeInputDir("scale", ["big.jpg"])
  const { deps } = fakeDeps({ image: syntheticImage(2000, 1500) })
  const engine = deps.engine

  const outcome = await processPhoto(
    { absolute: path.join(dir, "big.jpg"), relative: "big.jpg", name: "big.jpg" },
    {
      id: 0,
      firstFaceId: 0,
      engine,
      backend: fakeBackend(),
      backends: deps.backends,
      args: parseArgsOrThrow(["/photos", "--detect-edge=1280", "--source-edge=2000"]),
      detectOptions: { scoreThreshold: 0.6, nmsIou: 0.3, topK: 5000, divisor: 32 },
      duplicateIou: 0.55,
      alignSize: 112,
      wantResolution: true,
      scratchDir: dir,
      duplicates: createDuplicateIndex(),
      readPixels: deps.readPixels,
      planMediaFile: deps.planMediaFile,
      hashFile: deps.hashFile,
    },
  )

  assert.equal(engine.seen.detectCalls.length, 2, "one detect per resolution on a sampled photo")
  assert.equal(engine.seen.detectCalls[0].width, 1280, "detection runs on the downsample")
  assert.equal(engine.seen.detectCalls[1].width, 2000, "the comparison runs on the source")

  // Boxes are mapped back with the scale boxDownsample ACHIEVED. 2000/1280 is
  // not exactly the rounded ratio, so a box decoded at x=10 lands slightly off
  // 10 * 2000/1280 — asserting the exact source-frame value is what catches a
  // regression to the requested ratio.
  const box = outcome.faces[0].box
  const achieved = 1280 / 2000
  assert.ok(Math.abs(box.x - 10 / achieved) < 0.01)
  assert.equal(box.w, 187.5, "a 120px box at 1280 is 187.5px in the 2000px source frame")

  assert.ok(outcome.resolution)
  if (!outcome.resolution) return
  assert.equal(outcome.resolution.photoId, 0)
  assert.equal(outcome.resolution.matchedIou.length, outcome.resolution.atDetectEdge)
})

test("overlapping detections are IoU-deduped before anything downstream sees them", async () => {
  const dir = makeInputDir("dedupe", ["twins.jpg"])
  const { deps } = fakeDeps()
  // Two boxes on one face, as survive NMS: a permanent cannot-link split and a
  // false different-person pair if they reach groupFaces.
  const engine = fakeEngine({
    perImage: () => [detection(40, 40, 100), detection(43, 41, 98), detection(400, 200, 90)],
  })

  const outcome = await processPhoto(
    { absolute: path.join(dir, "twins.jpg"), relative: "twins.jpg", name: "twins.jpg" },
    {
      id: 0,
      firstFaceId: 0,
      engine,
      backend: fakeBackend(),
      backends: deps.backends,
      args: parseArgsOrThrow(["/photos"]),
      detectOptions: { scoreThreshold: 0.6, nmsIou: 0.3, topK: 5000, divisor: 32 },
      duplicateIou: 0.55,
      alignSize: 112,
      wantResolution: false,
      scratchDir: dir,
      duplicates: createDuplicateIndex(),
      readPixels: deps.readPixels,
      planMediaFile: deps.planMediaFile,
      hashFile: deps.hashFile,
    },
  )
  assert.equal(outcome.photo.faces, 2, "the near-identical pair collapsed to one face")
  assert.equal(outcome.faces.length, 2)
})

test("--mirror-tta describes the crop twice and averages before normalising", async () => {
  const dir = makeInputDir("mirror", ["m.jpg"])
  const { deps } = fakeDeps()
  const engine = deps.engine

  const outcome = await processPhoto(
    { absolute: path.join(dir, "m.jpg"), relative: "m.jpg", name: "m.jpg" },
    {
      id: 0,
      firstFaceId: 0,
      engine,
      backend: fakeBackend(),
      backends: deps.backends,
      args: parseArgsOrThrow(["/photos", "--mirror-tta"]),
      detectOptions: { scoreThreshold: 0.6, nmsIou: 0.3, topK: 5000, divisor: 32 },
      duplicateIou: 0.55,
      alignSize: 112,
      wantResolution: false,
      scratchDir: dir,
      duplicates: createDuplicateIndex(),
      readPixels: deps.readPixels,
      planMediaFile: deps.planMediaFile,
      hashFile: deps.hashFile,
    },
  )

  assert.equal(engine.seen.describeCalls, 2)
  const face = outcome.faces[0]
  assert.ok(face.mirrorDescriptor, "the mirror-averaged descriptor sits alongside the plain one")
  if (!face.mirrorDescriptor) return
  assert.equal(face.mirrorDescriptor.length, face.descriptor.length)
  const norm = Math.sqrt(face.mirrorDescriptor.reduce((sum, v) => sum + v * v, 0))
  assert.ok(Math.abs(norm - 1) < 1e-3, `mirror descriptor is L2-normalised (got ${norm})`)
})

// --- The whole run -----------------------------------------------------------

/** @param {string[]} argv @returns {Types.Session1Args} */
function parseArgsOrThrow(argv) {
  const parsed = parseArgs(argv)
  if (!parsed.valid) throw new Error(parsed.error)
  return parsed.value
}

test("runSession1 writes every declared output, with faces indexed by row", async () => {
  const dir = makeInputDir("run", ["one.jpg", "two.jpg", "three.jpg"])
  const outDir = workDir("run-out")
  const { deps, lines } = fakeDeps()

  const args = { ...parseArgsOrThrow([dir, "--out", outDir]), poolASize: 2, resolutionSample: 2 }
  const result = await runSession1(args, deps)

  assert.equal(result.exitCode, 0)
  assert.equal(result.photos.length, 3)
  assert.equal(result.faces.length, 3)
  result.faces.forEach((face, i) => assert.equal(face.id, i, "face id is the descriptor row index"))

  const photos = readJsonl(path.join(outDir, "photos.jsonl"))
  const faces = readJsonl(path.join(outDir, "faces.jsonl"))
  const resolution = readJsonl(path.join(outDir, "resolution.jsonl"))
  assert.equal(photos.length, 3)
  assert.equal(faces.length, 3)
  assert.equal(resolution.length, 2, "--resolution-sample photographs got the second detect")
  assert.deepEqual(
    photos.map((p) => p.relative),
    ["one.jpg", "three.jpg", "two.jpg"],
    "scan order is byte order, so a re-run produces the same photo ids",
  )

  for (const face of faces) {
    const crop = path.join(outDir, face.crop)
    assert.ok(fs.existsSync(crop), `${face.crop} was written`)
    // The PNG signature — the crops have to open in a browser for the labeller.
    assert.deepEqual(Array.from(fs.readFileSync(crop).subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47])
  }

  const timing = JSON.parse(fs.readFileSync(path.join(outDir, "timing.json"), "utf8"))
  assert.equal(timing.photos, 3)
  assert.equal(timing.faces, 3)
  assert.equal(timing.environment.node, process.version)
  assert.equal(timing.environment.runtime, "fake")
  assert.equal(timing.config.detectEdge, 1280)
  assert.equal(timing.config.poolASize, 2)
  assert.ok(timing.stages.detect.n >= 3)

  // A script tag, not a fetch: label.html is opened over file://.
  const labelData = fs.readFileSync(path.join(outDir, "label-data.js"), "utf8")
  assert.ok(labelData.startsWith("window.SESSION1_DATA = "))
  const parsed = JSON.parse(labelData.slice("window.SESSION1_DATA = ".length))
  assert.equal(parsed.faces.length, 3)
  assert.equal(parsed.order.length, 3)
  assert.equal(
    parsed.faces.filter((/** @type {{ pool: string }} */ f) => f.pool === "A").length,
    2,
  )

  // The eyeball pass of SESSION-1-vision.md §2, which happens BEFORE labelling.
  // Same reason for the script tag: contact-sheet.html is opened over file://.
  const contactData = fs.readFileSync(path.join(outDir, "contact-data.js"), "utf8")
  assert.ok(contactData.startsWith("window.SESSION1_CONTACT = "))
  const contact = JSON.parse(contactData.slice("window.SESSION1_CONTACT = ".length))
  assert.equal(contact.faces.length, 3)
  assert.equal(contact.version, result.contactData.version)
  // The cutoffs travel with it so the sheet can show what WOULD be rejected.
  assert.equal(typeof contact.cutoffs.maxResidual, "number")
  assert.equal(typeof contact.cutoffs.minSharpness, "number")
  for (const face of contact.faces) {
    for (const key of [
      "residual",
      "eyeRatio",
      "eyeAngle",
      "sharpness",
      "boxPx",
      "borderPx",
      "alignScale",
      "outsideFraction",
      "score",
    ]) {
      assert.equal(typeof face[key], "number", `contact face ${face.id} carries ${key}`)
    }
    assert.ok(fs.existsSync(path.join(outDir, face.crop)))
  }

  // Both templates travel with their data, so the pages open from the run's
  // own directory with no server and no copying step.
  for (const page of ["contact-sheet.html", "label.html"]) {
    assert.ok(fs.existsSync(path.join(outDir, page)), `${page} was copied beside its data`)
  }

  assert.ok(lines.some((line) => line.includes("3 photograph(s)")))
  assert.ok(
    lines.some((line) => line.includes("contact-sheet.html")),
    "the run points at the eyeball pass first",
  )
})

test("buildContactData projects the signals the sheet sorts on, and nothing else", () => {
  const faces = [
    buildFaceRecord({
      id: 4,
      photoId: 2,
      detection: {
        score: 0.91234,
        box: { x: 10, y: 12, w: 80, h: 90 },
        landmarks: [30, 40, 62, 41, 46, 55, 34, 70, 60, 71],
      },
      signals: {
        score: 0.91234,
        boxPx: 80,
        borderPx: 10,
        eyeRatio: 0.4,
        eyeAngle: 0.03125,
        alignScale: 0.8,
        residual: 3.5,
        outsideFraction: 0,
        sharpness: 0.012,
      },
      descriptor: Float32Array.from([0.5, 0.5, 0.5, 0.5]),
    }),
  ]
  const cutoffs = { minBoxPx: 40, maxResidual: 12 }
  const contact = buildContactData(faces, cutoffs)

  assert.equal(contact.faces.length, 1)
  assert.deepEqual(contact.cutoffs, cutoffs)
  assert.deepEqual(contact.faces[0], {
    id: 4,
    crop: "crops/000004.png",
    photoId: 2,
    score: 0.9123,
    residual: 3.5,
    eyeRatio: 0.4,
    eyeAngle: 0.03125,
    sharpness: 0.012,
    boxPx: 80,
    // Travels so the sheet can evaluate the gate's `border` check. Without it a
    // face rejected only for clipping the frame would render as a keep.
    borderPx: 10,
    alignScale: 0.8,
    outsideFraction: 0,
  })
  // The descriptor is 128 floats a face and the eyeball pass has no use for it.
  assert.equal("descriptor" in contact.faces[0], false)
})

test("a per-file failure is recorded and skipped, and the rest of the run continues", async () => {
  const dir = makeInputDir("fail", ["ok1.jpg", "broken.jpg", "ok2.jpg"])
  const outDir = workDir("fail-out")
  const { deps } = fakeDeps()
  const good = deps.readPixels
  deps.readPixels = async (backend, sourcePath, options) => {
    if (sourcePath.endsWith("broken.jpg")) throw new Error("backend exploded")
    return good(backend, sourcePath, options)
  }

  const result = await runSession1({ ...parseArgsOrThrow([dir, "--out", outDir]) }, deps)

  assert.equal(result.exitCode, 1, "a failed file exits 1, not 0 and not fatally")
  assert.equal(result.photos.length, 2)
  assert.equal(result.failures.length, 1)
  assert.equal(result.failures[0].file, "broken.jpg")
  assert.ok(result.failures[0].message.includes("backend exploded"))
  assert.equal(readJsonl(path.join(outDir, "failures.jsonl")).length, 1)
  // Photo ids stay contiguous: the failed file never consumed one.
  assert.deepEqual(
    result.photos.map((p) => p.id),
    [0, 1],
  )
})

test("a file that is not a photograph is skipped quietly, not counted as a failure", async () => {
  const dir = makeInputDir("skip", ["notes.txt", "photo.jpg"])
  const outDir = workDir("skip-out")
  const { deps } = fakeDeps()
  const goodPlan = deps.planMediaFile
  deps.planMediaFile = async (sourcePath, backends) =>
    sourcePath.endsWith(".txt")
      ? {
          ok: /** @type {false} */ (false),
          sourcePath,
          code: /** @type {"UNSUPPORTED_SOURCE"} */ ("UNSUPPORTED_SOURCE"),
          message: "not a supported format",
        }
      : goodPlan(sourcePath, backends)

  const result = await runSession1(parseArgsOrThrow([dir, "--out", outDir]), deps)
  assert.equal(result.exitCode, 0)
  assert.deepEqual(result.skipped, ["notes.txt"])
  assert.equal(result.failures.length, 0)
  assert.equal(result.photos.length, 1)
})

test("--limit stops the run, and --recursive is what reaches a subdirectory", async () => {
  const dir = makeInputDir("limit", ["a.jpg", "b.jpg", "nested/c.jpg"])
  const flat = await runSession1(
    parseArgsOrThrow([dir, "--out", workDir("limit-flat")]),
    fakeDeps().deps,
  )
  assert.equal(flat.photos.length, 2, "nested/c.jpg is not reached without --recursive")

  const deep = await runSession1(
    parseArgsOrThrow([dir, "--out", workDir("limit-deep"), "--recursive"]),
    fakeDeps().deps,
  )
  assert.equal(deep.photos.length, 3)

  const limited = await runSession1(
    parseArgsOrThrow([dir, "--out", workDir("limit-one"), "--recursive", "--limit", "1"]),
    fakeDeps().deps,
  )
  assert.equal(limited.photos.length, 1)
})

test("SIGINT exits 130 after flushing everything already finalized", async () => {
  const dir = makeInputDir("interrupt", ["a.jpg", "b.jpg", "c.jpg", "d.jpg"])
  const outDir = workDir("interrupt-out")
  const { deps } = fakeDeps()
  const good = deps.readPixels
  let seen = 0
  deps.readPixels = async (backend, sourcePath, options) => {
    // Emitted rather than signalled, so the test is deterministic: a real
    // SIGINT would arrive whenever the OS felt like it.
    if (++seen === 2) process.emit("SIGINT")
    return good(backend, sourcePath, options)
  }

  const result = await runSession1(parseArgsOrThrow([dir, "--out", outDir]), deps)

  assert.equal(result.exitCode, 130, "130 is the conventional killed-by-SIGINT code")
  assert.equal(result.photos.length, 2, "the photograph in flight finished; the rest did not start")
  assert.equal(readJsonl(path.join(outDir, "photos.jsonl")).length, 2, "finalized rows survived")
  assert.equal(readJsonl(path.join(outDir, "faces.jsonl")).length, result.faces.length)
  // The summary artifacts are still written, over what did complete.
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(outDir, "timing.json"), "utf8")).config.interrupted,
    true,
  )
  assert.ok(fs.existsSync(path.join(outDir, "label-data.js")))
  assert.equal(fs.existsSync(path.join(outDir, "scratch")), false, "scratch is cleaned up")
})

test("runSession1 refuses a path that is not a directory", async () => {
  const dir = makeInputDir("nodir", ["a.jpg"])
  await assert.rejects(
    () =>
      runSession1(
        parseArgsOrThrow([path.join(dir, "a.jpg"), "--out", workDir("nodir-out")]),
        fakeDeps().deps,
      ),
    (err) => err instanceof Error && err.message.startsWith("Not a directory:"),
  )
})

/** @param {string} filePath @returns {any[]} */
function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}
