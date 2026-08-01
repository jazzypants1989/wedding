#!/usr/bin/env node
/** @file Session 1's batch: a directory of photographs in, a measurable
 *  evaluation set out. This is the plumbing around the first-party pipeline
 *  modules, and almost every decision in it is about not forging a good answer.
 *
 *  Read `docs/post-wedding/SESSION-1-vision.md` §2 for what the session is for
 *  and `SPEC-vision-lab.md` §6.1–§6.2 for the algorithms. Four choices here
 *  deserve their reasons in the file that makes them:
 *
 *  1. **The gate scores; it does not filter.** `gateSignals` runs on every face
 *     and `applyGate` is never called. SPEC §6.2 requires cutoffs be derived
 *     from the input's own distribution, and a filtering batch cannot know that
 *     distribution before it has run. Describing a face that a later cutoff
 *     would have rejected costs milliseconds; re-running detection because the
 *     cutoff was wrong costs the run.
 *  2. **Duplicates are recorded, not dropped.** Two levels: the file's sha256
 *     (renames, byte-identical copies) and a perceptual frame hash (the same
 *     frame re-exported, retouched or re-encoded). Both are written to
 *     `photos.jsonl` and neither removes a photograph, because the report needs
 *     to quantify what excluding them was worth — and a hash cannot tell a
 *     re-export from the next frame of a burst.
 *  3. **Detections are IoU-deduped after the engine's own NMS.** Two boxes on
 *     one face become a permanent cannot-link split in `groupFaces` *and* a
 *     false different-person pair in the metrics, which is strictly worse than
 *     losing the second detection.
 *  4. **Pool A is a uniform sample and the labelling order is a fixed shuffle.**
 *     Pool B's grouping is conditioned on what the model already grouped
 *     confidently, so a headline separation number computed over it would be
 *     measuring its own premise; and a labeller free to pick crops picks easy
 *     frontal ones, which produces a flattering number and a wrong decision.
 *
 *  Working rules that constrain this script (CLAUDE.md; SPEC §15): the input
 *  path is always an argument and nothing here searches for photographs;
 *  everything derived lands under the `--out` directory, which is `tmp/` and
 *  gitignored; no measurement taken from real photographs may be written into
 *  any file in this repository.
 */
/** @import * as Types from './types.js' */
/** @import * as LibTypes from '../lib/types.js' */
/** @import * as VisionTypes from '../../public/vision/types.js' */

import fs from "node:fs"
import path from "node:path"

import { scanDirectory } from "../import-media.js"
import { hashFile } from "../lib/import-manifest.js"
import { MediaImportError, isMediaImportError } from "../lib/media-errors.js"
import { planMediaFile, probeBackends } from "../lib/media-variants.js"

import { alignFace, mirrorCrop } from "../../public/vision/align.js"
import { allDefaults } from "../../public/vision/defaults.js"
import { boxIou, dedupeDetections, scaleDetections } from "../../public/vision/detect.js"
import { averageHash, hammingDistance } from "../../public/vision/frame-hash.js"
import { gateSignals } from "../../public/vision/gate.js"
import { groupFaces, l2Normalize } from "../../public/vision/group.js"

import { loadEngine } from "./engine-loader.js"
import { boxDownsample, readPixels } from "./pixels-cli.js"
import { writePng } from "./png-write.js"

const USAGE = `
Usage: node scripts/vision/session1.js <directory> [options]

  Detect, align, score and describe every face in a directory of photographs,
  writing an evaluation set that scripts/vision/session1-report.js measures.

  The directory is always given here. Nothing searches for photographs.

  --out DIR                 Output directory (default tmp/session1).
  --engine PATH             Engine module (default tmp/rig/engine.mjs).
  --weights DIR             Model weights directory (default tmp/weights).
  --embedder FILE           Embedder weights filename inside --weights
                            (default is the engine's own).
  --detect-edge N           Long edge detection runs at.
  --source-edge N           Long edge photographs are decoded at.
  --recursive               Descend into subdirectories.
  --mirror-tta              Also describe each crop mirrored; the average becomes
                            the face's canonical descriptor (the single-pass
                            vector is kept as descriptorUnmirrored).
  --limit N                 Stop after N photographs.
  --pool-a N                Faces in the uniformly-sampled pool (default 150).
  --resolution-sample N     Photographs also detected at --source-edge (default 50).
  --help
`

const BOOLEAN_FLAGS = ["recursive", "mirror-tta", "help"]
const VALUE_FLAGS = [
  "out",
  "engine",
  "weights",
  "embedder",
  "detect-edge",
  "source-edge",
  "limit",
  "pool-a",
  "resolution-sample",
]

/** Exit codes, matching scripts/import-media.js so a wrapper can tell them apart. */
const EXIT = { CLEAN: 0, SOME_FAILED: 1, ABORTED: 2, INTERRUPTED: 130 }

/** Schema version of label-data.js / labels.json. */
const LABEL_DATA_VERSION = 1

/** Schema version of contact-data.js. */
const CONTACT_DATA_VERSION = 1

/**
 * Fixed seed for pool sampling and presentation order. A constant, not
 * `Math.random()`, so two runs over one directory produce the same pools and the
 * same order — which is what makes a labelling session resumable and a reported
 * number reproducible.
 */
const SHUFFLE_SEED = 0x5eed1e55

/** How often the progress line is printed when not every photo is logged. */
const PROGRESS_EVERY = 1

/**
 * @typedef {object} Session1Deps
 * @property {LibTypes.MediaBackends} [backends]
 * @property {Types.VisionEngine} [engine]
 * @property {typeof readPixels} [readPixels]
 * @property {typeof planMediaFile} [planMediaFile]
 * @property {typeof hashFile} [hashFile]
 * @property {typeof scanDirectory} [scanDirectory]
 * @property {(line: string) => void} [log]
 */

/**
 * @typedef {object} Session1Result
 * @property {number} exitCode
 * @property {Types.Session1PhotoRecord[]} photos
 * @property {Types.Session1FaceRecord[]} faces
 * @property {Types.Session1ResolutionRecord[]} resolution
 * @property {Types.Session1FailureRecord[]} failures
 * @property {string[]} skipped relative paths passed over (not photographs)
 * @property {Types.Session1Timing} timing
 * @property {Types.Session1LabelData} labelData
 * @property {Types.Session1ContactData} contactData
 */

/** @typedef {{ valid: true, value: Types.Session1Args } | { valid: false, error: string }} ArgsResult */

/**
 * First-wins duplicate bookkeeping across a run.
 * @typedef {object} DuplicateIndex
 * @property {(id: number, sha256: string, aHash: string) => { exactDuplicateOf: number | null, nearDuplicateOf: number | null }} add
 */

// --- Small numeric helpers ---------------------------------------------------

/**
 * Round for file size. The jsonl files are the bulk of the run's output and a
 * descriptor written at full float precision is ~2.5x the bytes of one written
 * at five places, for a difference far below the noise in any distance the
 * report computes.
 * @param {number} value @param {number} places @returns {number}
 */
function round(value, places) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** @param {number} id @returns {string} */
export function cropName(id) {
  const digits = String(id)
  return "crops/" + "000000".slice(0, Math.max(0, 6 - digits.length)) + digits + ".png"
}

/**
 * `planMediaFile` returns EXIF DateTimeOriginal as "YYYY-MM-DD HH:MM:SS", with
 * no timezone — because EXIF has none. Read as local time, which is what the
 * camera's clock meant. Report A only ever uses differences between two of
 * these, so a uniform offset is harmless; a wrong parse is not.
 *
 * String methods only, per CLAUDE.md's no-regex rule.
 * @param {string | null} capturedAt
 * @returns {number | null}
 */
export function capturedAtToMs(capturedAt) {
  if (!capturedAt) return null
  const space = capturedAt.indexOf(" ")
  if (space === -1) return null
  const date = capturedAt.slice(0, space).split("-")
  const time = capturedAt.slice(space + 1).split(":")
  if (date.length !== 3 || time.length !== 3) return null
  /** @type {number[]} */
  const parts = []
  for (const text of [...date, ...time]) {
    const n = Number(text)
    if (!Number.isInteger(n) || text.length === 0) return null
    parts.push(n)
  }
  const [year, month, day, hour, minute, second] = parts
  // "0000:00:00 00:00:00" is what a camera with no clock writes, and it is not a
  // capture time. Anything before photography existed is the same story.
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const ms = new Date(year, month - 1, day, hour, minute, second).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Deterministic uniform random source. A linear congruential generator, seeded
 * by a constant: reproducibility is the whole requirement, and `Math.random()`
 * would make the pools — and therefore the headline number — unrepeatable.
 * @param {number} seed
 * @returns {() => number}
 */
export function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    // Numerical Recipes' constants. Any full-period LCG does; the low bits are
    // poor, which is why the result is taken from the whole 32-bit word.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * Fisher-Yates, in place, with a supplied random source.
 * @template T
 * @param {T[]} items @param {() => number} random @returns {T[]}
 */
function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = items[i]
    items[i] = items[j]
    items[j] = swap
  }
  return items
}

// --- Arguments ---------------------------------------------------------------

/**
 * Both `--out DIR` and `--out=DIR` are accepted. scripts/import-media.js refuses
 * the space form on purpose (it catches `--section official` typos), but the
 * form documented for this script in SESSION-1-vision.md §2 is the spaced one,
 * so refusing it would be refusing the command in the doc.
 * @param {string[]} argv
 * @returns {ArgsResult}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {}
  /** @type {Set<string>} */
  const flags = new Set()
  /** @type {string[]} */
  const positional = []

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith("--")) {
      positional.push(raw)
      continue
    }
    const body = raw.slice(2)
    const eq = body.indexOf("=")
    const name = eq === -1 ? body : body.slice(0, eq)
    let value = eq === -1 ? null : body.slice(eq + 1)

    if (BOOLEAN_FLAGS.includes(name)) {
      if (value !== null) return { valid: false, error: `--${name} takes no value` }
      flags.add(name)
      continue
    }
    if (!VALUE_FLAGS.includes(name)) return { valid: false, error: `Unknown option --${name}` }
    if (value === null) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        return { valid: false, error: `--${name} needs a value` }
      }
      value = next
      i++
    }
    if (value.length === 0) return { valid: false, error: `--${name} needs a value` }
    values[name] = value
  }

  if (flags.has("help")) return { valid: false, error: USAGE }

  // Rule 1, and the reason it is a hard error rather than a default: nothing
  // here looks in a home directory, a Photos library, or a path remembered from
  // an earlier session. If it was not typed on this command line it is not read.
  if (positional.length === 0) {
    return { valid: false, error: "No directory given — the path is always an argument.\n" + USAGE }
  }
  if (positional.length > 1) {
    return {
      valid: false,
      error:
        `Expected one directory, got ${positional.length} (${positional.join(", ")}). ` +
        `Quote paths containing spaces.`,
    }
  }

  const defaults = allDefaults()

  // Defaults come from the tunables table, never from a literal here: two
  // places holding 1280 is one place holding it wrong.
  /** @type {Record<string, number>} */
  const numbers = {
    "detect-edge": defaults.detect.longEdge,
    "source-edge": defaults.detect.sourceEdge,
    "pool-a": 150,
    "resolution-sample": 50,
    limit: 0,
  }
  for (const name of Object.keys(numbers)) {
    const text = values[name]
    if (text === undefined) continue
    const n = Number(text)
    // `--resolution-sample 0` would be a legitimate "skip the comparison", but
    // omitting nothing is what --resolution-sample=1 already means and a zero is
    // far more often a mistyped flag than an intention.
    if (!Number.isInteger(n) || n < 1) {
      return { valid: false, error: `--${name} must be a positive integer, got ${text}` }
    }
    numbers[name] = n
  }

  return {
    valid: true,
    value: {
      dir: path.resolve(positional[0]),
      outDir: path.resolve(values.out ?? "tmp/session1"),
      enginePath: values.engine ?? "tmp/rig/engine.mjs",
      weightsDir: values.weights ?? "tmp/weights",
      embedderFile: values.embedder ?? null,
      detectEdge: numbers["detect-edge"],
      sourceEdge: numbers["source-edge"],
      recursive: flags.has("recursive"),
      mirrorTta: flags.has("mirror-tta"),
      resolutionSample: numbers["resolution-sample"],
      limit: values.limit === undefined ? null : numbers.limit,
      poolASize: numbers["pool-a"],
    },
  }
}

// --- Duplicate bookkeeping ---------------------------------------------------

/**
 * `nearBits` is the hamming distance, out of 256, below which two frame hashes
 * are called the same photograph taken twice. It defaults from the tunables
 * table rather than from a constant here: the report tells the owner to tune it
 * against their own input, and a number that lives in a script is a number
 * nobody finds.
 * @param {{ nearBits?: number }} [options]
 * @returns {DuplicateIndex}
 */
export function createDuplicateIndex(options = {}) {
  const nearBits = options.nearBits ?? allDefaults().dedup.nearDuplicateBits
  /** @type {Map<string, number>} */
  const bySha = new Map()
  /** @type {Array<{ id: number, aHash: string }>} */
  const frames = []

  return {
    add(id, sha256, aHash) {
      const firstExact = bySha.get(sha256)
      if (firstExact === undefined) bySha.set(sha256, id)

      // Linear scan in insertion order, so the FIRST matching photo wins and a
      // chain of six exports of one frame all point at the same original rather
      // than at each other. Quadratic, and irrelevantly so: a hex compare over a
      // few thousand entries is nothing beside one neural network forward pass.
      /** @type {number | null} */
      let nearDuplicateOf = null
      for (const frame of frames) {
        const bits = hammingDistance(frame.aHash, aHash)
        if (bits >= 0 && bits <= nearBits) {
          nearDuplicateOf = frame.id
          break
        }
      }
      frames.push({ id, aHash })

      return { exactDuplicateOf: firstExact ?? null, nearDuplicateOf }
    },
  }
}

// --- Record builders ---------------------------------------------------------

/**
 * @typedef {object} PhotoRecordInput
 * @property {number} id
 * @property {string} relative
 * @property {string} sha256
 * @property {string} aHash
 * @property {number} width
 * @property {number} height
 * @property {string | null} capturedAt EXIF string, as planMediaFile returns it
 * @property {number} mtimeMs
 * @property {number} faces
 * @property {{ exactDuplicateOf: number | null, nearDuplicateOf: number | null }} duplicates
 * @property {{ decode: number, downsample: number, detect: number, align: number, describe: number }} ms
 */

/**
 * @param {PhotoRecordInput} input
 * @returns {Types.Session1PhotoRecord}
 */
export function buildPhotoRecord(input) {
  return {
    id: input.id,
    relative: input.relative,
    sha256: input.sha256,
    aHash: input.aHash,
    width: input.width,
    height: input.height,
    capturedAtMs: capturedAtToMs(input.capturedAt),
    mtimeMs: Math.round(input.mtimeMs),
    faces: input.faces,
    exactDuplicateOf: input.duplicates.exactDuplicateOf,
    nearDuplicateOf: input.duplicates.nearDuplicateOf,
    ms: {
      decode: round(input.ms.decode, 1),
      downsample: round(input.ms.downsample, 1),
      detect: round(input.ms.detect, 1),
      align: round(input.ms.align, 1),
      describe: round(input.ms.describe, 1),
    },
  }
}

/**
 * @typedef {object} FaceRecordInput
 * @property {number} id
 * @property {number} photoId
 * @property {VisionTypes.Detection} detection in SOURCE-buffer pixels
 * @property {VisionTypes.GateSignals} signals
 * @property {Float32Array} descriptor canonical — mirror-averaged when --mirror-tta is on
 * @property {Float32Array} [descriptorUnmirrored] the single-pass vector, kept
 *   under --mirror-tta so the report can price what averaging bought
 */

/**
 * @param {FaceRecordInput} input
 * @returns {Types.Session1FaceRecord}
 */
export function buildFaceRecord(input) {
  const { box } = input.detection
  /** @type {Types.Session1FaceRecord} */
  const record = {
    id: input.id,
    photoId: input.photoId,
    crop: cropName(input.id),
    score: round(input.detection.score, 4),
    box: { x: round(box.x, 2), y: round(box.y, 2), w: round(box.w, 2), h: round(box.h, 2) },
    landmarks: Array.from(input.detection.landmarks, (v) => round(v, 2)),
    signals: {
      score: round(input.signals.score, 4),
      boxPx: round(input.signals.boxPx, 2),
      borderPx: round(input.signals.borderPx, 2),
      eyeRatio: round(input.signals.eyeRatio, 5),
      eyeAngle: round(input.signals.eyeAngle, 5),
      alignScale: round(input.signals.alignScale, 5),
      residual: round(input.signals.residual, 4),
      outsideFraction: round(input.signals.outsideFraction, 5),
      sharpness: round(input.signals.sharpness, 6),
    },
    descriptor: Array.from(input.descriptor, (v) => round(v, 5)),
  }
  if (input.descriptorUnmirrored) {
    record.descriptorUnmirrored = Array.from(input.descriptorUnmirrored, (v) => round(v, 5))
  }
  return record
}

/**
 * For every box found at the detection resolution, the best IoU available in
 * the set found at source resolution. A box with no overlap anywhere scores 0,
 * which is the honest reading: the two resolutions disagreed about it.
 * @param {readonly VisionTypes.Detection[]} atDetectEdge
 * @param {readonly VisionTypes.Detection[]} atSourceEdge
 * @returns {number[]}
 */
export function matchResolutionIou(atDetectEdge, atSourceEdge) {
  return atDetectEdge.map((a) => {
    let best = 0
    for (const b of atSourceEdge) {
      const iou = boxIou(a.box, b.box)
      if (iou > best) best = iou
    }
    return round(best, 4)
  })
}

/**
 * Which scan positions also get detected at source resolution. Evenly spread
 * rather than the first N, because the first N photographs of a delivery are one
 * scene and the resolution question is about the range of face sizes.
 * @param {number} total @param {number} sample
 * @returns {Set<number>}
 */
export function resolutionSampleIndices(total, sample) {
  /** @type {Set<number>} */
  const chosen = new Set()
  if (sample <= 0 || total <= 0) return chosen
  if (sample >= total) {
    for (let i = 0; i < total; i++) chosen.add(i)
    return chosen
  }
  for (let k = 0; k < sample; k++) chosen.add(Math.floor((k * total) / sample))
  return chosen
}

// --- Pools -------------------------------------------------------------------

/**
 * @typedef {object} PoolFace
 * @property {number} id
 * @property {string} crop
 * @property {number} photoId
 */

/**
 * @typedef {object} AssignPoolsOptions
 * @property {number} poolASize
 * @property {number} [seed]
 * @property {(faces: PoolFace[]) => Array<number | null>} [groupPoolB]
 */

/**
 * Split the faces into the two pools and fix the labelling order.
 *
 * Pool A is uniform over every face. It is the only pool Report A's headline
 * separation number may be computed from: Pool B is grouped before it is
 * labelled, so its coverage is conditioned on what the model already found easy,
 * and a number measured there would be partly measuring its own premise.
 *
 * Pool B is everything else, grouped at a tight cutoff so that bulk labelling is
 * one click per group rather than per face. That is where Reports B and C get
 * their volume. The two pools are disjoint by construction.
 *
 * The grouping is injected so this function is testable without descriptors.
 * @param {PoolFace[]} faces
 * @param {AssignPoolsOptions} options
 * @returns {Types.Session1LabelData}
 */
export function assignPools(faces, options) {
  const seed = options.seed ?? SHUFFLE_SEED
  const ids = faces.map((face) => face.id)

  // Partial Fisher-Yates over positions, so the sample is uniform without
  // sorting by a random key (which biases nothing but costs n log n).
  const positions = shuffle(
    faces.map((_face, index) => index),
    seededRandom(seed),
  )
  const take = Math.max(0, Math.min(options.poolASize, faces.length))
  /** @type {Set<number>} */
  const poolA = new Set(positions.slice(0, take))

  const poolBFaces = faces.filter((_face, index) => !poolA.has(index))
  const groups = options.groupPoolB ? options.groupPoolB(poolBFaces) : poolBFaces.map(() => null)
  if (groups.length !== poolBFaces.length) {
    throw new Error(`assignPools: ${groups.length} group ids for ${poolBFaces.length} pool B faces`)
  }
  /** @type {Map<number, number | null>} */
  const groupById = new Map()
  poolBFaces.forEach((face, index) => groupById.set(face.id, groups[index]))

  return {
    version: LABEL_DATA_VERSION,
    faces: faces.map((face, index) => ({
      id: face.id,
      crop: face.crop,
      photoId: face.photoId,
      pool: poolA.has(index) ? /** @type {"A"} */ ("A") : /** @type {"B"} */ ("B"),
      group: poolA.has(index) ? null : (groupById.get(face.id) ?? null),
    })),
    // A different stream from the pool draw, so that changing --pool-a does not
    // also reshuffle the presentation order of an in-progress labelling session.
    order: shuffle(ids.slice(), seededRandom(seed ^ 0x9e3779b9)),
  }
}

/**
 * Group pool B's descriptors at the defaults' (deliberately tight) cutoff, with
 * cannot-link-within-a-photo on. Returns one group id per input face, null for
 * singletons — a group of one is not an assist, it is noise in the UI.
 * @param {PoolFace[]} poolBFaces
 * @param {Map<number, number[]>} descriptorsById
 * @param {{ cutoff: number, cannotLinkWithinPhoto: boolean }} groupConfig
 * @returns {Array<number | null>}
 */
export function groupPoolB(poolBFaces, descriptorsById, groupConfig) {
  if (poolBFaces.length === 0) return []
  const first = descriptorsById.get(poolBFaces[0].id)
  if (!first || first.length === 0) return poolBFaces.map(() => null)
  const dim = first.length

  const data = new Float32Array(poolBFaces.length * dim)
  const photoIds = new Int32Array(poolBFaces.length)
  for (let i = 0; i < poolBFaces.length; i++) {
    const vector = descriptorsById.get(poolBFaces[i].id)
    if (!vector || vector.length !== dim) {
      throw new Error(`groupPoolB: face ${poolBFaces[i].id} has no ${dim}-d descriptor`)
    }
    data.set(vector, i * dim)
    photoIds[i] = poolBFaces[i].photoId
  }

  // No `options.matrix` is passed: groupFaces builds its own and mutates it
  // in place (Lance-Williams). Handing it a matrix here would mean the matrix is
  // wreckage afterwards, and this is exactly the seam where somebody later adds
  // a second call and reuses it.
  const groups = groupFaces(
    { dim, data },
    {
      cutoff: groupConfig.cutoff,
      photoIds,
      cannotLinkWithinPhoto: groupConfig.cannotLinkWithinPhoto,
    },
  )

  /** @type {Array<number | null>} */
  const assignment = new Array(poolBFaces.length).fill(null)
  let next = 0
  for (const group of groups) {
    if (group.members.length < 2) continue
    const id = next++
    for (const member of group.members) assignment[member] = id
  }
  return assignment
}

// --- The contact sheet -------------------------------------------------------

/**
 * The data behind `contact-sheet.html` — the five-minute eyeball pass
 * SESSION-1-vision.md §2 puts BEFORE labelling.
 *
 * Every signal here is already in `faces.jsonl`; this is a projection of it, not
 * a second measurement. It exists as a separate file because the sheet is opened
 * over file:// (a script tag, not a fetch) and because a jsonl carrying 128
 * descriptor floats per face is tens of megabytes the eyeball pass has no use
 * for. Only the signals the sheet can sort, filter and show are copied.
 *
 * The cutoffs travel with it so the sheet can split would-keep from
 * would-reject. They are the gate's, unchanged — the batch itself still does not
 * filter (see the file header), and a sheet showing a cutoff the run did not use
 * would be answering "are the rejects actually bad?" about a different gate.
 *
 * @param {readonly Types.Session1FaceRecord[]} faces
 * @param {Record<string, number>} cutoffs `allDefaults().gate`
 * @returns {Types.Session1ContactData}
 */
export function buildContactData(faces, cutoffs) {
  return {
    version: CONTACT_DATA_VERSION,
    faces: faces.map((face) => ({
      id: face.id,
      crop: face.crop,
      photoId: face.photoId,
      // Already rounded by buildFaceRecord; rounding again would only lose bits.
      score: face.signals.score,
      residual: face.signals.residual,
      eyeRatio: face.signals.eyeRatio,
      eyeAngle: face.signals.eyeAngle,
      sharpness: face.signals.sharpness,
      boxPx: face.signals.boxPx,
      // Without this the sheet cannot evaluate the gate's `border` check, and a
      // face rejected only for clipping the frame would render as a keep — the
      // one failure a check-the-rejects pass cannot afford.
      borderPx: face.signals.borderPx,
      alignScale: face.signals.alignScale,
      outsideFraction: face.signals.outsideFraction,
    })),
    cutoffs,
  }
}

// --- One photograph ----------------------------------------------------------

/**
 * @typedef {object} PhotoContext
 * @property {number} id
 * @property {number} firstFaceId
 * @property {Types.VisionEngine} engine
 * @property {LibTypes.ImageBackend} backend
 * @property {Types.Session1Args} args
 * @property {Types.DetectOptions} detectOptions
 * @property {number} duplicateIou
 * @property {number} alignSize
 * @property {boolean} wantResolution
 * @property {string} scratchDir
 * @property {DuplicateIndex} duplicates
 * @property {typeof readPixels} readPixels
 * @property {typeof planMediaFile} planMediaFile
 * @property {typeof hashFile} hashFile
 * @property {LibTypes.MediaBackends} backends
 */

/**
 * @typedef {object} PhotoOutcome
 * @property {Types.Session1PhotoRecord} photo
 * @property {Types.Session1FaceRecord[]} faces
 * @property {VisionTypes.RgbImage[]} crops aligned with `faces`
 * @property {Types.Session1ResolutionRecord | null} resolution
 * @property {Record<string, number>} stageMs
 */

/**
 * The whole per-photograph path. One decode; both resolutions derived from it.
 * @param {LibTypes.ScannedFile} file
 * @param {PhotoContext} context
 * @returns {Promise<PhotoOutcome>}
 */
export async function processPhoto(file, context) {
  /** @type {Record<string, number>} */
  const stageMs = {}
  /** @param {string} name @param {number} started */
  const stage = (name, started) => {
    const ms = performance.now() - started
    stageMs[name] = (stageMs[name] ?? 0) + ms
    return ms
  }

  let t = performance.now()
  const sha256 = await context.hashFile(file.absolute)
  stage("hash", t)

  t = performance.now()
  const plan = await context.planMediaFile(file.absolute, context.backends)
  stage("plan", t)
  if (!plan.ok) throw new MediaImportError(plan.code, plan.message, { file: file.relative })
  if (plan.kind !== "image") {
    throw new MediaImportError("UNSUPPORTED_SOURCE", `${file.relative} — not a photograph.`, {
      file: file.relative,
    })
  }

  t = performance.now()
  const source = await context.readPixels(context.backend, file.absolute, {
    maxEdge: context.args.sourceEdge,
    scratchDir: context.scratchDir,
  })
  const decodeMs = stage("decode", t)

  t = performance.now()
  const aHash = averageHash(source)
  stage("ahash", t)

  t = performance.now()
  const down = boxDownsample(source, context.args.detectEdge)
  const downsampleMs = stage("downsample", t)

  t = performance.now()
  const raw = await context.engine.detect(down.image, context.detectOptions)
  const detectMs = stage("detect", t)

  // The scale boxDownsample ACHIEVED, not the one it was asked for: rounding
  // makes width/height miss maxEdge slightly, and mapping back with the
  // requested ratio is a drift that grows with distance from the origin and
  // reads as a badly calibrated detector.
  const detections = dedupeDetections(
    scaleDetections(raw, down.scale),
    context.duplicateIou,
  )

  /** @type {Types.Session1ResolutionRecord | null} */
  let resolution = null
  if (context.wantResolution) {
    t = performance.now()
    const atSource = dedupeDetections(
      await context.engine.detect(source, context.detectOptions),
      context.duplicateIou,
    )
    stage("detectSource", t)
    resolution = {
      photoId: context.id,
      atDetectEdge: detections.length,
      atSourceEdge: atSource.length,
      matchedIou: matchResolutionIou(detections, atSource),
    }
  }

  /** @type {Types.Session1FaceRecord[]} */
  const faces = []
  /** @type {VisionTypes.RgbImage[]} */
  const crops = []
  let alignMs = 0
  let describeMs = 0

  for (let i = 0; i < detections.length; i++) {
    const detection = detections[i]

    t = performance.now()
    // From the SOURCE buffer, not the detection buffer: a 112x112 crop taken
    // from a 1280px frame is upsampled for any face smaller than the whole
    // frame, and the recogniser has no translation invariance left at its final
    // layer to absorb the softness that introduces.
    const aligned = alignFace(source, detection.landmarks, { size: context.alignSize })
    alignMs += stage("align", t)

    t = performance.now()
    // Scores; does not decide. See the file header.
    const signals = gateSignals({
      box: detection.box,
      landmarks: detection.landmarks,
      imageWidth: source.width,
      imageHeight: source.height,
      score: detection.score,
      crop: aligned.crop,
      alignScale: aligned.scale,
      residual: aligned.residual,
      outsideFraction: aligned.outsideFraction,
    })
    stage("gate", t)

    t = performance.now()
    // `descriptor` is CANONICAL: it is the vector every consumer — grouping,
    // the report's headline, ingest-faces.js — reads without having to know
    // whether mirror averaging was on. Under --mirror-tta the average goes
    // there and the single-pass vector moves to `descriptorUnmirrored`, kept
    // only so the report's mirror A/B can price what averaging bought.
    let descriptor = await context.engine.describe(aligned.crop)
    /** @type {Float32Array | undefined} */
    let descriptorUnmirrored
    if (context.args.mirrorTta) {
      const mirrored = await context.engine.describe(mirrorCrop(aligned.crop))
      const averaged = new Float32Array(descriptor.length)
      for (let k = 0; k < descriptor.length; k++) {
        averaged[k] = (descriptor[k] + mirrored[k]) / 2
      }
      // Average, THEN normalise. Normalising each and averaging gives a vector
      // off the unit sphere whose length encodes how much the two disagreed,
      // which every cosine distance downstream would then silently divide out.
      descriptorUnmirrored = descriptor
      descriptor = l2Normalize(averaged)
    }
    describeMs += stage("describe", t)

    faces.push(
      buildFaceRecord({
        id: context.firstFaceId + i,
        photoId: context.id,
        detection,
        signals,
        descriptor,
        descriptorUnmirrored,
      }),
    )
    crops.push(aligned.crop)
  }

  const duplicates = context.duplicates.add(context.id, sha256, aHash)

  return {
    photo: buildPhotoRecord({
      id: context.id,
      relative: file.relative,
      sha256,
      aHash,
      width: source.width,
      height: source.height,
      capturedAt: plan.capturedAt,
      mtimeMs: plan.mtimeMs,
      faces: detections.length,
      duplicates,
      ms: {
        decode: decodeMs,
        downsample: downsampleMs,
        detect: detectMs,
        align: alignMs,
        describe: describeMs,
      },
    }),
    faces,
    crops,
    resolution,
    stageMs,
  }
}

// --- The run -----------------------------------------------------------------

/**
 * A JSONL file written as the run goes, so a Ctrl-C keeps everything already
 * finalized instead of everything already computed.
 * @param {string} filePath
 * @returns {{ write: (record: unknown) => void, close: () => void }}
 */
function jsonlWriter(filePath) {
  const fd = fs.openSync(filePath, "w")
  return {
    write(record) {
      fs.writeSync(fd, JSON.stringify(record) + "\n")
    },
    close() {
      fs.closeSync(fd)
    },
  }
}

/**
 * @param {Types.Session1Args} args
 * @param {Session1Deps} [deps]
 * @returns {Promise<Session1Result>}
 */
export async function runSession1(args, deps = {}) {
  const log = deps.log ?? ((line) => process.stdout.write(line + "\n"))
  const scan = deps.scanDirectory ?? scanDirectory
  const readPixelsFn = deps.readPixels ?? readPixels
  const planFn = deps.planMediaFile ?? planMediaFile
  const hashFn = deps.hashFile ?? hashFile
  const defaults = allDefaults()

  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    throw new Error(`Not a directory: ${args.dir}`)
  }

  const backends = deps.backends ?? (await probeBackends({ skipVideo: true }))
  if (!backends.image) {
    throw new MediaImportError(
      "NO_IMAGE_BACKEND",
      "No image backend found. Install vips (brew install vips) or ImageMagick.",
    )
  }
  const backend = backends.image

  const engine =
    deps.engine ??
    (await loadEngine(args.enginePath, {
      weightsDir: args.weightsDir,
      embedderFile: args.embedderFile ?? undefined,
    }))

  const cropsDir = path.join(args.outDir, "crops")
  const scratchDir = path.join(args.outDir, "scratch")
  fs.mkdirSync(cropsDir, { recursive: true })
  fs.mkdirSync(scratchDir, { recursive: true })

  let files = scan(args.dir, { recursive: args.recursive })
  if (args.limit !== null) files = files.slice(0, args.limit)
  const resolutionAt = resolutionSampleIndices(files.length, args.resolutionSample)

  log(`${files.length} file(s) under the given directory.`)
  log(
    `Detecting at ${args.detectEdge}px from a ${args.sourceEdge}px decode; ` +
      `engine: ${JSON.stringify(engine.info())}`,
  )

  const photosOut = jsonlWriter(path.join(args.outDir, "photos.jsonl"))
  const facesOut = jsonlWriter(path.join(args.outDir, "faces.jsonl"))
  const resolutionOut = jsonlWriter(path.join(args.outDir, "resolution.jsonl"))
  const failuresOut = jsonlWriter(path.join(args.outDir, "failures.jsonl"))

  /** @type {Types.Session1PhotoRecord[]} */
  const photos = []
  /** @type {Types.Session1FaceRecord[]} */
  const faces = []
  /** @type {Types.Session1ResolutionRecord[]} */
  const resolution = []
  /** @type {Types.Session1FailureRecord[]} */
  const failures = []
  /** @type {string[]} */
  const skipped = []
  /** @type {Record<string, { ms: number, n: number }>} */
  const stages = {}
  /** @type {Map<number, number[]>} */
  const descriptorsById = new Map()

  const duplicates = createDuplicateIndex({ nearBits: defaults.dedup.nearDuplicateBits })
  let interrupted = false
  const onSignal = () => {
    if (interrupted) return
    interrupted = true
    log("\n! Interrupted — finishing this photograph, then writing what is complete.")
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  const started = performance.now()
  let nextFaceId = 0
  let photoId = 0

  try {
    for (let index = 0; index < files.length && !interrupted; index++) {
      const file = files[index]
      try {
        const outcome = await processPhoto(file, {
          id: photoId,
          firstFaceId: nextFaceId,
          engine,
          backend,
          backends,
          args,
          detectOptions: {
            scoreThreshold: defaults.detect.scoreThreshold,
            nmsIou: defaults.detect.nmsIou,
            topK: defaults.detect.topK,
            divisor: defaults.detect.divisor,
          },
          duplicateIou: defaults.detect.duplicateIou,
          alignSize: defaults.align.size,
          wantResolution: resolutionAt.has(index),
          scratchDir,
          duplicates,
          readPixels: readPixelsFn,
          planMediaFile: planFn,
          hashFile: hashFn,
        })

        const t = performance.now()
        for (let i = 0; i < outcome.faces.length; i++) {
          writePng(outcome.crops[i], path.join(args.outDir, outcome.faces[i].crop))
        }
        outcome.stageMs.writeCrops = performance.now() - t

        for (const [name, ms] of Object.entries(outcome.stageMs)) {
          const bucket = stages[name] ?? { ms: 0, n: 0 }
          bucket.ms += ms
          bucket.n += 1
          stages[name] = bucket
        }

        photosOut.write(outcome.photo)
        photos.push(outcome.photo)
        for (const face of outcome.faces) {
          facesOut.write(face)
          faces.push(face)
          // Canonical by construction: buildFaceRecord in this same run put the
          // mirror-averaged vector in `descriptor` when --mirror-tta was on.
          descriptorsById.set(face.id, face.descriptor)
        }
        if (outcome.resolution) {
          resolutionOut.write(outcome.resolution)
          resolution.push(outcome.resolution)
        }

        nextFaceId += outcome.faces.length
        photoId++
        if (index % PROGRESS_EVERY === 0) {
          log(
            `[${index + 1}/${files.length}] ${file.relative} — ` +
              `${outcome.faces.length} face(s), ${faces.length} total`,
          )
        }
      } catch (err) {
        // A per-file failure is a skipped file, never the end of the run: one
        // unreadable frame in three thousand must not cost the evening.
        const code = isMediaImportError(err) ? err.code : "UNKNOWN"
        const message = err instanceof Error ? err.message : String(err)
        if (code === "UNSUPPORTED_SOURCE" || code === "NO_VIDEO_BACKEND") {
          skipped.push(file.relative)
        } else {
          /** @type {Types.Session1FailureRecord} */
          const failure = { file: file.relative, code, message }
          failures.push(failure)
          failuresOut.write(failure)
          log(`  ! ${file.relative} — ${code}: ${message}`)
        }
      }
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    photosOut.close()
    facesOut.close()
    resolutionOut.close()
    failuresOut.close()
    fs.rmSync(scratchDir, { recursive: true, force: true })
  }

  // --- Pools, label data, timing ---------------------------------------------

  const labelData = assignPools(
    faces.map((face) => ({ id: face.id, crop: face.crop, photoId: face.photoId })),
    {
      poolASize: args.poolASize,
      groupPoolB: (poolBFaces) => groupPoolB(poolBFaces, descriptorsById, defaults.group),
    },
  )
  fs.writeFileSync(
    path.join(args.outDir, "label-data.js"),
    // A script tag, not a fetch: label.html is opened over file://, where fetch
    // is refused by every browser and there is deliberately no server.
    "window.SESSION1_DATA = " + JSON.stringify(labelData) + "\n",
  )

  const contactData = buildContactData(faces, defaults.gate)
  fs.writeFileSync(
    path.join(args.outDir, "contact-data.js"),
    // Same reason as label-data.js: file://, so a script tag.
    "window.SESSION1_CONTACT = " + JSON.stringify(contactData) + "\n",
  )

  /** @type {Types.Session1Timing} */
  const timing = {
    photos: photos.length,
    faces: faces.length,
    stages: {
      ...stages,
      total: { ms: Math.round(performance.now() - started), n: photos.length },
    },
    environment: {
      node: process.version,
      backend: `${backend.name} ${backend.version}`,
      ...engine.info(),
    },
    config: {
      detectEdge: args.detectEdge,
      sourceEdge: args.sourceEdge,
      mirrorTta: args.mirrorTta,
      recursive: args.recursive,
      limit: args.limit,
      poolASize: args.poolASize,
      resolutionSample: args.resolutionSample,
      nearDuplicateBits: defaults.dedup.nearDuplicateBits,
      shuffleSeed: SHUFFLE_SEED,
      detect: defaults.detect,
      align: defaults.align,
      gate: defaults.gate,
      group: defaults.group,
      interrupted,
      failed: failures.length,
      skipped: skipped.length,
    },
  }
  fs.writeFileSync(path.join(args.outDir, "timing.json"), JSON.stringify(timing, null, 2) + "\n")

  // Both pages are templates that travel with their data. A missing one is a
  // warning, not a failure — the jsonl files are the run's real output and a
  // page can be copied in afterwards.
  for (const page of ["contact-sheet.html", "label.html"]) {
    const template = path.join(import.meta.dirname, page)
    try {
      fs.copyFileSync(template, path.join(args.outDir, page))
    } catch {
      log(`! ${template} not found — its data file was written; copy the page in when it exists.`)
    }
  }

  if (engine.close) await engine.close().catch(() => {})

  const poolA = labelData.faces.filter((face) => face.pool === "A").length
  log("")
  log(`${photos.length} photograph(s), ${faces.length} face(s).`)
  log(`Pool A ${poolA}, pool B ${labelData.faces.length - poolA}.`)
  if (skipped.length > 0) log(`Skipped ${skipped.length} non-photograph file(s).`)
  if (failures.length > 0) log(`Failed ${failures.length} — see failures.jsonl.`)
  log(`Output: ${args.outDir}`)
  if (!interrupted) {
    // The eyeball pass comes first, per SESSION-1-vision.md §2: a mirrored or
    // rotated crop is the cheapest bug here and the most expensive after
    // labelling has been done on top of it.
    log(`Next: open ${path.join(args.outDir, "contact-sheet.html")} (5 minutes, by eye),`)
    log(`      then ${path.join(args.outDir, "label.html")}`)
  }

  const exitCode = interrupted
    ? EXIT.INTERRUPTED
    : failures.length > 0
      ? EXIT.SOME_FAILED
      : EXIT.CLEAN

  return { exitCode, photos, faces, resolution, failures, skipped, timing, labelData, contactData }
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const parsed = parseArgs(argv)
  if (!parsed.valid) {
    process.stderr.write(parsed.error + "\n")
    return EXIT.ABORTED
  }
  try {
    const result = await runSession1(parsed.value)
    return result.exitCode
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n")
    return EXIT.ABORTED
  }
}

// `node scripts/vision/session1.js ...` runs; `import` from a test does not.
// Same guard as scripts/import-media.js.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2))
}
