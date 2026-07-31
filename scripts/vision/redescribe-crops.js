#!/usr/bin/env node
/** @file The A/B rig's other half: re-describe every crop of an existing
 *  session-1 run under a different embedder, without re-detecting,
 *  re-aligning or re-labelling anything.
 *
 *  Four rules keep the comparison this makes possible from being a wrong one:
 *
 *  1. **Run discipline, said out loud in --help, not left to be remembered.**
 *     A/B on ALL crops, not gate-passing ones; quote the pool-A metric only;
 *     confirm the template transfers from the artifact's own metadata. This
 *     script does not enforce those — session1-report.js's pool split and
 *     stratum honesty flags do — it only refuses to silently stop being a
 *     fair comparison at the one seam that is this script's to guard.
 *  2. **Nothing is re-detected.** Face ids, boxes, landmarks, gate signals and
 *     labels all carry over unchanged from `faces.jsonl` — only `descriptor`
 *     (and `mirrorDescriptor` under `--mirror-tta`) is replaced. That is what
 *     keeps `labels.json`'s `datasetId` valid: it hashes id, photo id and box,
 *     none of which move.
 *  3. **A missing crop aborts the whole run, not just that face.** Silently
 *     re-describing 996 of 1000 crops would shift both pools by a few faces
 *     and quietly bias whatever the report goes on to quote. The check runs
 *     BEFORE any engine call, so a broken run fails in milliseconds, not after
 *     an hour of describing.
 *  4. **No descriptor statistic is ever printed.** Not a norm, not a distance,
 *     not a per-face anything — only how many crops were processed. What the
 *     descriptors are worth is session1-report.js's job, run afterwards
 *     against the directory this script writes.
 *
 *  Nothing here searches for a run directory (CLAUDE.md; SPEC §15 r1) — it is
 *  always the one positional argument.
 */
/** @import * as Types from './types.js' */
/** @import * as LibTypes from '../lib/types.js' */

import fs from "node:fs"
import path from "node:path"

import { mirrorCrop } from "../../public/vision/align.js"
import { l2Normalize } from "../../public/vision/group.js"

import { loadEngine } from "./engine-loader.js"
import { decodePng } from "./png-read.js"

const USAGE = `
Usage: node scripts/vision/redescribe-crops.js <run-dir> --out DIR [options]

  Re-describe every crop of an existing session-1 run with a different
  embedder. Detection, alignment, gate signals and labels are reused
  unchanged; only descriptors are recomputed, so
  scripts/vision/session1-report.js can then compare two models on the
  descriptors alone, over exactly the same faces.

  Run discipline: A/B on ALL crops, not gate-passing ones; quote the pool-A
  metric only; confirm the template transfers from the artifact's own
  metadata.

  <run-dir>          An existing session-1 run (e.g. tmp/session1).
  --out DIR          Where the new run is written (required).
  --engine PATH      Engine module (default tmp/rig/engine.mjs).
  --embedder FILE    Embedder weights filename inside --weights (default is
                     the engine's own).
  --weights DIR      Model weights directory (default tmp/weights).
  --mirror-tta       Also describe each crop mirrored, and average — matches
                     session1.js's flag of the same name; set it only if the
                     run being compared against did.
  --help
`

const BOOLEAN_FLAGS = ["mirror-tta", "help"]
const VALUE_FLAGS = ["out", "engine", "embedder", "weights"]

/** Exit codes, matching session1.js so a wrapper can tell them apart. */
const EXIT = { CLEAN: 0, ABORTED: 2, INTERRUPTED: 130 }

/**
 * Descriptor rounding. Matches buildFaceRecord in session1.js exactly, so an
 * A run and a B run cost the same bytes for the same reason (file size, not
 * precision this pipeline needs).
 */
const DESCRIPTOR_PLACES = 5

/** How often the progress line is printed. */
const PROGRESS_EVERY = 100

/** @typedef {{ valid: true, value: Types.RedescribeArgs } | { valid: false, error: string }} RedescribeArgsResult */

// --- Arguments ---------------------------------------------------------------

/**
 * Both `--out DIR` and `--out=DIR` are accepted, matching session1.js and
 * context-crops.js.
 * @param {readonly string[]} argv
 * @returns {RedescribeArgsResult}
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

  // The run directory is typed on this command line or the run does not
  // happen — nothing here remembers one from an earlier session.
  if (positional.length === 0) {
    return { valid: false, error: "No run directory given — the path is always an argument.\n" + USAGE }
  }
  if (positional.length > 1) {
    return {
      valid: false,
      error:
        `Expected one run directory, got ${positional.length} (${positional.join(", ")}). ` +
        `Quote paths containing spaces.`,
    }
  }
  if (values.out === undefined) {
    return { valid: false, error: "--out DIR is required (where the new run is written).\n" + USAGE }
  }

  const runDir = path.resolve(positional[0])
  const outDir = path.resolve(values.out)
  if (outDir === runDir) {
    return { valid: false, error: "--out must not be the run directory itself." }
  }

  return {
    valid: true,
    value: {
      runDir,
      outDir,
      enginePath: values.engine ?? "tmp/rig/engine.mjs",
      weightsDir: values.weights ?? "tmp/weights",
      embedderFile: values.embedder ?? null,
      mirrorTta: flags.has("mirror-tta"),
    },
  }
}

// --- Reading the source run ---------------------------------------------------

/**
 * Strict JSONL read: every non-blank line must parse. An interrupted
 * session1.js can leave a truncated last line, and that is not a run this
 * script may silently trim and re-describe — see the file header on what a
 * partial re-describe costs.
 * @param {string} file
 * @returns {Types.Session1FaceRecord[]}
 */
function readFacesStrict(file) {
  if (!fs.existsSync(file)) throw new Error(`${file}: not found`)
  const text = fs.readFileSync(file, "utf8")
  const lines = text.split("\n")
  /** @type {Types.Session1FaceRecord[]} */
  const records = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.length === 0) continue
    try {
      records.push(/** @type {Types.Session1FaceRecord} */ (JSON.parse(trimmed)))
    } catch (err) {
      throw new Error(
        `${file}:${i + 1}: unparseable JSONL line — was the run interrupted? ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      )
    }
  }
  return records
}

/**
 * Every crop file `faces.jsonl` names, checked BEFORE any engine call: a
 * missing crop is a reason to refuse the whole run, not to skip one face and
 * quietly shrink both pools by an amount nobody chose.
 * @param {string} runDir
 * @param {readonly Types.Session1FaceRecord[]} faces
 * @returns {string[]} missing crop paths, relative to runDir
 */
function findMissingCrops(runDir, faces) {
  /** @type {string[]} */
  const missing = []
  for (const face of faces) {
    if (!fs.existsSync(path.join(runDir, face.crop))) missing.push(face.crop)
  }
  return missing
}

// --- Descriptors ---------------------------------------------------------------

/** @param {number} value @returns {number} */
function round(value) {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** DESCRIPTOR_PLACES
  return Math.round(value * factor) / factor
}

/**
 * One face's new descriptor(s), under whichever engine was loaded. No
 * statistic about the result — a norm, a distance, anything — is computed
 * here or anywhere in this file; see the file header.
 * @param {Types.VisionEngine} engine
 * @param {LibTypes.RgbImage} image
 * @param {boolean} mirrorTta
 * @returns {Promise<{ descriptor: number[], mirrorDescriptor?: number[] }>}
 */
async function describeFace(engine, image, mirrorTta) {
  const descriptor = await engine.describe(image)
  if (!mirrorTta) {
    return { descriptor: Array.from(descriptor, round) }
  }
  const mirrored = await engine.describe(mirrorCrop(image))
  const averaged = new Float32Array(descriptor.length)
  for (let k = 0; k < descriptor.length; k++) averaged[k] = (descriptor[k] + mirrored[k]) / 2
  // Average, THEN normalise — same order as session1.js and for the same
  // reason: normalising each and averaging would leave a vector off the unit
  // sphere whose length encodes how much the two disagreed, which every
  // cosine distance downstream would then silently divide out.
  const mirrorDescriptor = l2Normalize(averaged)
  return {
    descriptor: Array.from(descriptor, round),
    mirrorDescriptor: Array.from(mirrorDescriptor, round),
  }
}

/**
 * The source face record with its descriptor(s) replaced. `mirrorDescriptor`
 * is deleted when this run did not recompute one — carrying over a value
 * computed under the OLD model would be a mismatched-model field that looks
 * like data from this run and is not.
 * @param {Types.Session1FaceRecord} original
 * @param {{ descriptor: number[], mirrorDescriptor?: number[] }} redescribed
 * @returns {Types.Session1FaceRecord}
 */
function withNewDescriptor(original, redescribed) {
  /** @type {Types.Session1FaceRecord} */
  const next = { ...original, descriptor: redescribed.descriptor }
  if (redescribed.mirrorDescriptor) {
    next.mirrorDescriptor = redescribed.mirrorDescriptor
  } else {
    delete next.mirrorDescriptor
  }
  return next
}

// --- The run -----------------------------------------------------------------

/** @type {Types.runRedescribe} */
export async function runRedescribe(args, deps = {}) {
  const log = deps.log ?? ((line) => process.stdout.write(line + "\n"))

  if (!fs.existsSync(args.runDir) || !fs.statSync(args.runDir).isDirectory()) {
    throw new Error(`Not a run directory: ${args.runDir}`)
  }

  const photosFile = path.join(args.runDir, "photos.jsonl")
  const facesFile = path.join(args.runDir, "faces.jsonl")
  const labelsFile = path.join(args.runDir, "labels.json")
  const timingFile = path.join(args.runDir, "timing.json")
  if (!fs.existsSync(photosFile)) throw new Error(`${photosFile}: not found`)

  const faces = readFacesStrict(facesFile)
  if (faces.length === 0) throw new Error(`${facesFile}: no faces — nothing to re-describe`)

  // Rule 3 from the file header: every crop must exist before any of them is
  // described.
  const missing = findMissingCrops(args.runDir, faces)
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} of ${faces.length} crop file(s) named in faces.jsonl are missing ` +
        `(first: ${missing[0]}). Refusing to re-describe a partial set — that would silently ` +
        `bias every comparison made against the run this would have produced.`,
    )
  }

  const engine =
    deps.engine ??
    (await loadEngine(args.enginePath, {
      weightsDir: args.weightsDir,
      embedderFile: args.embedderFile ?? undefined,
    }))

  fs.mkdirSync(args.outDir, { recursive: true })

  let interrupted = false
  const onSignal = () => {
    if (interrupted) return
    interrupted = true
    log("\n! Interrupted — a partial re-describe would bias the comparison, so nothing is written.")
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  log(`${faces.length} crop(s) to re-describe from ${args.runDir}.`)

  /** @type {Types.Session1FaceRecord[]} */
  const rewritten = []
  try {
    for (let i = 0; i < faces.length && !interrupted; i++) {
      const face = faces[i]
      const buffer = fs.readFileSync(path.join(args.runDir, face.crop))
      const image = decodePng(buffer)
      const redescribed = await describeFace(engine, image, args.mirrorTta)
      rewritten.push(withNewDescriptor(face, redescribed))
      if ((i + 1) % PROGRESS_EVERY === 0 || i === faces.length - 1) {
        log(`[${i + 1}/${faces.length}] re-described`)
      }
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    if (engine.close) await engine.close().catch(() => {})
  }

  if (interrupted) {
    return { exitCode: EXIT.INTERRUPTED, faces: 0 }
  }

  fs.writeFileSync(
    path.join(args.outDir, "faces.jsonl"),
    rewritten.map((face) => JSON.stringify(face)).join("\n") + "\n",
  )
  // Straight copies: id:photoId:box are unchanged, so labels.json's datasetId
  // (hashed over exactly those) stays valid against this new run.
  fs.copyFileSync(photosFile, path.join(args.outDir, "photos.jsonl"))

  if (fs.existsSync(labelsFile)) {
    fs.copyFileSync(labelsFile, path.join(args.outDir, "labels.json"))
  } else {
    log(`! ${labelsFile} not found — the new run has no labels.json; session1-report.js needs one.`)
  }

  if (fs.existsSync(timingFile)) {
    /** @type {Types.Session1Timing} */
    const timing = JSON.parse(fs.readFileSync(timingFile, "utf8"))
    timing.config = {
      ...timing.config,
      redescribedWith: args.embedderFile ?? "(engine default embedder)",
    }
    fs.writeFileSync(path.join(args.outDir, "timing.json"), JSON.stringify(timing, null, 2) + "\n")
  } else {
    log(`! ${timingFile} not found — the new run has no timing.json.`)
  }

  log("")
  log(`${rewritten.length} crop(s) re-described.`)
  log(`Output: ${args.outDir}`)
  log(`Next: node scripts/vision/session1-report.js ${args.outDir}`)
  log(`      (quote the pool-A metric only, and confirm the template transfers first)`)

  return { exitCode: EXIT.CLEAN, faces: rewritten.length }
}

/**
 * @param {readonly string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const parsed = parseArgs(argv)
  if (!parsed.valid) {
    process.stderr.write(parsed.error + "\n")
    return EXIT.ABORTED
  }
  try {
    const result = await runRedescribe(parsed.value)
    return result.exitCode
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n")
    return EXIT.ABORTED
  }
}

// `node scripts/vision/redescribe-crops.js ...` runs; `import` from a test
// does not. Same guard as session1.js and context-crops.js.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2))
}
