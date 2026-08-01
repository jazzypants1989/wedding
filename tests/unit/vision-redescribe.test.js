/** @file Unit test: redescribe-crops.js — the A/B rig's re-describe half —
 *  over a synthetic run directory. No photograph, no ONNX runtime: the crops
 *  are procedurally generated pixel patterns and the engine is a deterministic
 *  pixel function, the same approach as vision-session1.test.js.
 *
 *  The load-bearing assertions are the descriptor-canonicalization ones (the
 *  D2 fix): with --mirror-tta the CANONICAL `descriptor` field must hold the
 *  mirror-averaged vector (normalised after averaging), the single pass moves
 *  to `descriptorUnmirrored`, the legacy `mirrorDescriptor` field is never
 *  written — and a legacy-shape input run comes out migrated to the canonical
 *  shape, which is what makes this script the migration tool for
 *  pre-canonicalization runs sitting on disk.
 */

import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"

import { mirrorCrop } from "../../public/vision/align.js"
import { l2Normalize } from "../../public/vision/group.js"
import { parseArgs, runRedescribe } from "../../scripts/vision/redescribe-crops.js"
import { writePng } from "../../scripts/vision/png-write.js"

/** @import * as Types from '../../scripts/vision/types.js' */
/** @import * as VisionTypes from '../../public/vision/types.js' */

/** @type {string[]} */
const madeDirs = []
after(() => {
  for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/** @param {string} label @returns {string} */
function workDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vision-redescribe-${label}-`))
  madeDirs.push(dir)
  return dir
}

/**
 * A procedurally generated crop — not a photograph, not derived from one. The
 * pattern is asymmetric in x, so its mirror describes differently under the
 * fake engine, which is what makes the averaging assertions meaningful.
 * @param {number} seed @returns {VisionTypes.RgbImage}
 */
function syntheticCrop(seed) {
  const size = 16
  const rgb = new Uint8Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      rgb[i] = (x * 13 + seed * 7) & 0xff
      rgb[i + 1] = (x * 3 + y * 5) & 0xff
      rgb[i + 2] = (y * 11 + seed) & 0xff
    }
  }
  return { width: size, height: size, rgb }
}

/**
 * Deterministic pixel-function engine, same shape as vision-session1.test.js's.
 * @returns {Types.VisionEngine}
 */
function fakeEngine() {
  return {
    async detect() {
      throw new Error("redescribe never detects")
    },
    async describe(crop) {
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
}

/** @param {number} v @returns {number} */
const round5 = (v) => Math.round(v * 1e5) / 1e5

/**
 * A minimal but fully-typed face record pointing at a real (synthetic) crop
 * file.
 * @param {number} id
 * @param {Partial<Types.Session1FaceRecord>} [extra]
 * @returns {Types.Session1FaceRecord}
 */
function faceRecord(id, extra = {}) {
  return {
    id,
    photoId: id,
    crop: `crops/${String(id).padStart(6, "0")}.png`,
    score: 0.9,
    box: { x: 10 * id, y: 0, w: 100, h: 100 },
    landmarks: [10, 10, 20, 10, 15, 15, 10, 20, 20, 20],
    signals: {
      score: 0.9,
      boxPx: 100,
      borderPx: 30,
      eyeRatio: 0.35,
      eyeAngle: 0.01,
      alignScale: 0.8,
      residual: 1.2,
      outsideFraction: 0,
      sharpness: 0.02,
    },
    descriptor: [1, 0],
    ...extra,
  }
}

/**
 * A synthetic run directory: faces.jsonl, photos.jsonl, timing.json and one
 * PNG crop per face.
 * @param {string} label
 * @param {Types.Session1FaceRecord[]} faces
 * @returns {string}
 */
function writeRun(label, faces) {
  const dir = workDir(label)
  fs.mkdirSync(path.join(dir, "crops"), { recursive: true })
  fs.writeFileSync(path.join(dir, "faces.jsonl"), faces.map((f) => JSON.stringify(f)).join("\n") + "\n")
  const photos = faces.map((f) => ({ id: f.photoId, sha256: `sha-${f.photoId}` }))
  fs.writeFileSync(path.join(dir, "photos.jsonl"), photos.map((p) => JSON.stringify(p)).join("\n") + "\n")
  /** @type {Types.Session1Timing} */
  const timing = {
    photos: photos.length,
    faces: faces.length,
    stages: {},
    environment: { node: "fixture" },
    config: { detectEdge: 1280, mirrorTta: true },
  }
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(timing))
  for (const f of faces) writePng(syntheticCrop(f.id), path.join(dir, f.crop))
  return dir
}

/**
 * @param {string} runDir @param {string[]} extraArgv
 * @returns {Types.RedescribeArgs}
 */
function argsFor(runDir, extraArgv = []) {
  const parsed = parseArgs([runDir, "--out", path.join(workDir(path.basename(runDir) + "-out"), "run"), ...extraArgv])
  if (!parsed.valid) throw new Error(parsed.error)
  return parsed.value
}

/** @param {string} file @returns {Types.Session1FaceRecord[]} */
function readFaces(file) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => /** @type {Types.Session1FaceRecord} */ (JSON.parse(line)))
}

test("--mirror-tta writes the mirror-averaged vector as the CANONICAL descriptor", async () => {
  const runDir = writeRun("mirror-on", [faceRecord(0), faceRecord(1)])
  const args = argsFor(runDir, ["--mirror-tta"])
  const engine = fakeEngine()

  const result = await runRedescribe(args, { engine: fakeEngine(), log: () => {} })
  assert.equal(result.exitCode, 0)
  assert.equal(result.faces, 2)

  const faces = readFaces(path.join(args.outDir, "faces.jsonl"))
  for (const face of faces) {
    const single = await engine.describe(syntheticCrop(face.id))
    const mirrored = await engine.describe(mirrorCrop(syntheticCrop(face.id)))
    const averaged = new Float32Array(single.length)
    for (let k = 0; k < single.length; k++) averaged[k] = (single[k] + mirrored[k]) / 2
    assert.deepEqual(
      face.descriptor,
      Array.from(l2Normalize(averaged), round5),
      "descriptor is the average of both passes, normalised AFTER averaging",
    )
    assert.deepEqual(
      face.descriptorUnmirrored,
      Array.from(single, round5),
      "the single pass is kept as descriptorUnmirrored",
    )
    assert.equal("mirrorDescriptor" in face, false, "the legacy field is never written")
  }

  // The output's timing.json records that ITS descriptors are mirror-averaged.
  const timing = /** @type {Types.Session1Timing} */ (
    JSON.parse(fs.readFileSync(path.join(args.outDir, "timing.json"), "utf8"))
  )
  assert.equal(timing.config.mirrorTta, true)
})

test("without --mirror-tta a legacy-shape run is migrated to the plain canonical shape", async () => {
  // The input is the PRE-canonicalization shape: descriptor + mirrorDescriptor.
  // Re-describing without mirroring must drop both stale fields — carrying
  // either over would present old-model vectors as this run's data.
  const legacy = [
    faceRecord(0, { descriptor: [0.6, 0.8], mirrorDescriptor: [0.8, 0.6] }),
    faceRecord(1, { descriptor: [0, 1], mirrorDescriptor: [1, 0] }),
  ]
  const runDir = writeRun("legacy-in", legacy)
  const args = argsFor(runDir)
  const engine = fakeEngine()

  const result = await runRedescribe(args, { engine: fakeEngine(), log: () => {} })
  assert.equal(result.exitCode, 0)

  const faces = readFaces(path.join(args.outDir, "faces.jsonl"))
  for (const face of faces) {
    const expected = Array.from(await engine.describe(syntheticCrop(face.id)), round5)
    assert.deepEqual(face.descriptor, expected, "descriptor is the plain single pass")
    assert.equal("descriptorUnmirrored" in face, false, "no second vector without --mirror-tta")
    assert.equal("mirrorDescriptor" in face, false, "the stale legacy field is dropped")
    // Everything that keeps datasetId valid carries over untouched.
    assert.deepEqual(face.box, { x: 10 * face.id, y: 0, w: 100, h: 100 })
  }

  // The source run mirrored; this run did not. The output says so.
  const timing = /** @type {Types.Session1Timing} */ (
    JSON.parse(fs.readFileSync(path.join(args.outDir, "timing.json"), "utf8"))
  )
  assert.equal(timing.config.mirrorTta, false)
})
