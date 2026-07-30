#!/usr/bin/env node
/** @file One wider crop per face, so the labeller can see hair, clothing and who
 *  the person is standing next to. The tight 112x112 aligned crop is what the
 *  recogniser sees; it is not enough for a human to tell two similar-looking
 *  guests apart, and a labelling session that guesses is a measurement of
 *  guessing.
 *
 *  Four constraints shape everything below.
 *
 *  1. **The detector is never called here.** Face ids and boxes are read back
 *     from `faces.jsonl` and reproduced exactly. Re-detecting would renumber the
 *     faces, and face ids are the join key for every label already collected —
 *     a second detection pass would silently destroy a labelling session rather
 *     than fail it.
 *  2. **The photograph directory is always an argument** (CLAUDE.md; SPEC §15
 *     r1). Nothing here searches for images; each source is `<directory>` joined
 *     to the `relative` path the run recorded.
 *  3. **The decode resolution comes from the run, not from the defaults.**
 *     `faces.jsonl` boxes are in SOURCE-buffer pixels, so they are only valid
 *     against a buffer decoded at the same `sourceEdge` the run used. Reading
 *     that back out of `timing.json` is the difference between a correct crop
 *     and a plausible-looking one that is off by the ratio of two defaults.
 *  4. **Nothing here looks at a pixel.** It moves bytes from a decoded buffer
 *     into a PNG. No image is opened, described or summarised, and no statistic
 *     about what is in one is written anywhere.
 *
 *  Everything it writes lands under the run directory, which is `tmp/` and
 *  gitignored. No regex, per CLAUDE.md: every string operation here is
 *  `split`, `indexOf`, `startsWith`, `slice` or `join`.
 */
/** @import * as Types from './types.js' */
/** @import * as LibTypes from '../lib/types.js' */

import fs from "node:fs"
import path from "node:path"

import { isMediaImportError, MediaImportError } from "../lib/media-errors.js"
import { probeBackends } from "../lib/media-variants.js"

import { boxDownsample, readPixels } from "./pixels-cli.js"
import { writePng } from "./png-write.js"

const USAGE = `
Usage: node scripts/vision/context-crops.js <directory> --run DIR [options]

  Write one wider "context" image per face of an existing session-1 run, so the
  labelling page can show more than the tight aligned crop.

  Nothing is re-detected: face ids and boxes come from the run's faces.jsonl and
  are reproduced exactly. The photographs are re-decoded, which is why the
  directory is given here — nothing searches for photographs.

  --run DIR           The session-1 run directory (required, e.g. tmp/session1).
  --margin N          Box expansion factor about its centre (default 2.5).
  --size N            Output long edge in pixels (default 320). Never upsamples.
  --limit N           Stop after N photographs (photographs with faces, in id order).
  --help
`

const BOOLEAN_FLAGS = ["help"]
const VALUE_FLAGS = ["run", "margin", "size", "limit"]

/** Exit codes, matching scripts/vision/session1.js so a wrapper can tell them apart. */
const EXIT = { CLEAN: 0, SOME_FAILED: 1, ABORTED: 2, INTERRUPTED: 130 }

const DEFAULT_MARGIN = 2.5
const DEFAULT_SIZE = 320

/**
 * How far the decoded dimensions may differ from the ones the run recorded
 * before the photograph is skipped instead of rescaled. See `resolveScale`.
 */
const MAX_DIMENSION_DRIFT = 0.02

/** How often the progress line is printed. Every photograph, as session1.js does. */
const PROGRESS_EVERY = 1

/** @typedef {{ valid: true, value: Types.ContextCropArgs } | { valid: false, error: string }} ContextArgsResult */

/**
 * @typedef {object} ContextCropDeps
 * @property {LibTypes.MediaBackends} [backends]
 * @property {typeof readPixels} [readPixels]
 * @property {typeof writePng} [writePng]
 * @property {(line: string) => void} [log]
 */

// --- Names -------------------------------------------------------------------

/**
 * The context crop's path, relative to the run directory. Deliberately the same
 * six-digit zero-padded id as `cropName` in session1.js, so the two files for
 * one face share a name and `relabel-data.js` can test for this one's existence
 * without a directory listing.
 *
 * This is the ONE definition; relabel-data.js imports it rather than repeating
 * the padding, because a producer and a consumer that disagree about a filename
 * produce a labelling page pointing at images that were never written.
 * @type {Types.contextName}
 */
export function contextName(id) {
  const digits = String(id)
  return "context/" + "000000".slice(0, Math.max(0, 6 - digits.length)) + digits + ".png"
}

// --- Arguments ---------------------------------------------------------------

/**
 * Both `--run DIR` and `--run=DIR` are accepted, matching session1.js.
 * @param {readonly string[]} argv
 * @returns {ContextArgsResult}
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

  // Rule 1: the photograph directory is typed on this command line or the run
  // does not happen. Nothing looks in a home directory, a Photos library, or a
  // path remembered from an earlier session.
  if (positional.length === 0) {
    return {
      valid: false,
      error: "No directory given — the path is always an argument.\n" + USAGE,
    }
  }
  if (positional.length > 1) {
    return {
      valid: false,
      error:
        `Expected one directory, got ${positional.length} (${positional.join(", ")}). ` +
        `Quote paths containing spaces.`,
    }
  }
  if (values.run === undefined) {
    return { valid: false, error: "--run DIR is required (the session-1 run directory).\n" + USAGE }
  }

  const sizeText = values.size
  let size = DEFAULT_SIZE
  if (sizeText !== undefined) {
    const n = Number(sizeText)
    if (!Number.isInteger(n) || n < 16) {
      return { valid: false, error: `--size must be an integer of at least 16, got ${sizeText}` }
    }
    size = n
  }

  const marginText = values.margin
  let margin = DEFAULT_MARGIN
  if (marginText !== undefined) {
    const n = Number(marginText)
    // Below 1 this would crop INSIDE the detected box, which is the tight crop
    // the labeller already has and the opposite of what the flag is for.
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      return { valid: false, error: `--margin must be a number between 1 and 20, got ${marginText}` }
    }
    margin = n
  }

  const limitText = values.limit
  /** @type {number | null} */
  let limit = null
  if (limitText !== undefined) {
    const n = Number(limitText)
    if (!Number.isInteger(n) || n < 1) {
      return { valid: false, error: `--limit must be a positive integer, got ${limitText}` }
    }
    limit = n
  }

  return {
    valid: true,
    value: {
      dir: path.resolve(positional[0]),
      runDir: path.resolve(values.run),
      margin,
      size,
      limit,
    },
  }
}

// --- Geometry ----------------------------------------------------------------

/**
 * The detected box expanded by `margin` about its own centre and clamped to the
 * image, as integer pixels. Clamping rather than shifting: a face at the edge of
 * the frame should stay at the edge of its context crop, because moving it
 * inwards would show the labeller a composition the photograph does not have.
 * @type {Types.expandBox}
 */
export function expandBox(box, margin, width, height) {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const halfW = (box.w * margin) / 2
  const halfH = (box.h * margin) / 2

  const x0 = Math.max(0, Math.min(width - 1, Math.floor(cx - halfW)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(cy - halfH)))
  const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(cx + halfW)))
  const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(cy + halfH)))

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Copy a rectangle out of an RGB buffer. The rectangle must already be inside
 * the image — `expandBox` is what guarantees that, and a bounds check here would
 * only hide a caller that skipped it.
 * @type {Types.cropRegion}
 */
export function cropRegion(image, rect) {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.w < 1 ||
    rect.h < 1 ||
    rect.x + rect.w > image.width ||
    rect.y + rect.h > image.height
  ) {
    throw new Error(
      `cropRegion: ${rect.w}x${rect.h}+${rect.x}+${rect.y} is not inside ${image.width}x${image.height}`,
    )
  }
  const out = new Uint8Array(rect.w * rect.h * 3)
  const srcStride = image.width * 3
  const dstStride = rect.w * 3
  for (let y = 0; y < rect.h; y++) {
    const src = (rect.y + y) * srcStride + rect.x * 3
    out.set(image.rgb.subarray(src, src + dstStride), y * dstStride)
  }
  return { width: rect.w, height: rect.h, rgb: out }
}

/**
 * How to map a recorded box onto the buffer that was just decoded.
 *
 * The boxes in faces.jsonl are in the pixels of the buffer the RUN decoded. A
 * different version of vips or ImageMagick can produce a buffer a pixel or two
 * different at the same `--source-edge`, purely from rounding in its resize.
 *
 * The chosen rule: **rescale the box by the per-axis ratio**, and skip the
 * photograph when either axis differs by more than MAX_DIMENSION_DRIFT.
 *
 * Rescaling is right for the rounding case and, at 2%, is indistinguishable from
 * doing nothing under a 2.5x margin. The skip exists because a LARGE difference
 * is not a rounding artefact: it means a different decode, and the most likely
 * one is an orientation disagreement — media-variants.js records that for one
 * HEIC vips and magick report 1600x2400 where sips reports 2400x1600. Rescaling
 * through a swap like that produces a confident crop of the wrong region, and a
 * context crop showing the wrong person is worse than a missing one, because the
 * labeller has no way to tell.
 * @type {Types.resolveScale}
 */
export function resolveScale(decoded, recorded) {
  if (recorded.width < 1 || recorded.height < 1) {
    return { ok: false, reason: `the run recorded ${recorded.width}x${recorded.height} for it` }
  }
  const sx = decoded.width / recorded.width
  const sy = decoded.height / recorded.height
  if (
    Math.abs(sx - 1) > MAX_DIMENSION_DRIFT ||
    Math.abs(sy - 1) > MAX_DIMENSION_DRIFT
  ) {
    return {
      ok: false,
      reason:
        `decoded ${decoded.width}x${decoded.height}, run recorded ` +
        `${recorded.width}x${recorded.height} — a different image backend or orientation`,
    }
  }
  return { ok: true, sx, sy }
}

// --- The run -----------------------------------------------------------------

/**
 * One JSONL file, tolerating a truncated final line the way the report's loader
 * does: bad lines are counted and skipped, never silently dropped.
 * @template T
 * @param {string} file
 * @returns {{ records: T[], skipped: number, present: boolean }}
 */
function readJsonl(file) {
  if (!fs.existsSync(file)) return { records: [], skipped: 0, present: false }
  const text = fs.readFileSync(file, "utf8")
  /** @type {T[]} */
  const records = []
  let skipped = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      records.push(/** @type {T} */ (JSON.parse(trimmed)))
    } catch {
      skipped++
    }
  }
  return { records, skipped, present: true }
}

/**
 * The decode resolution the run actually used. Not a default and not a flag:
 * every box in faces.jsonl is in the pixels of a buffer decoded at this value,
 * so reading it back is what makes the crops land on the faces.
 * @type {Types.readSourceEdge}
 */
export function readSourceEdge(runDir) {
  const file = path.join(runDir, "timing.json")
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file}: not found. The face boxes are in the pixels of the buffer the run decoded,\n` +
        `so the run's own --source-edge is required and must not be guessed from the defaults.`,
    )
  }
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (err) {
    throw new Error(`${file}: unreadable — ${err instanceof Error ? err.message : String(err)}`)
  }
  const timing = /** @type {Types.Session1Timing | null} */ (parsed)
  const value = timing && timing.config ? timing.config.sourceEdge : undefined
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `${file}: config.sourceEdge is missing or not a positive integer.\n` +
        `Without it the recorded boxes cannot be mapped onto a decoded buffer.`,
    )
  }
  return value
}

/** @type {Types.runContextCrops} */
export async function runContextCrops(args, deps = {}) {
  const log = deps.log ?? ((line) => process.stdout.write(line + "\n"))
  const readPixelsFn = deps.readPixels ?? readPixels
  const writePngFn = deps.writePng ?? writePng

  if (!fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    throw new Error(`Not a directory: ${args.dir}`)
  }
  if (!fs.existsSync(args.runDir) || !fs.statSync(args.runDir).isDirectory()) {
    throw new Error(`Not a run directory: ${args.runDir}`)
  }

  const sourceEdge = readSourceEdge(args.runDir)

  const photosRead = /** @type {{ records: Types.Session1PhotoRecord[], skipped: number, present: boolean }} */ (
    readJsonl(path.join(args.runDir, "photos.jsonl"))
  )
  const facesRead = /** @type {{ records: Types.Session1FaceRecord[], skipped: number, present: boolean }} */ (
    readJsonl(path.join(args.runDir, "faces.jsonl"))
  )
  if (!photosRead.present) throw new Error(`${args.runDir}/photos.jsonl: not found`)
  if (!facesRead.present) throw new Error(`${args.runDir}/faces.jsonl: not found`)
  const unparseable = photosRead.skipped + facesRead.skipped
  if (unparseable > 0) {
    log(`! skipped ${unparseable} unparseable JSONL line(s) — was the batch interrupted?`)
  }

  /** @type {Map<number, Types.Session1PhotoRecord>} */
  const photoById = new Map()
  for (const photo of photosRead.records) photoById.set(photo.id, photo)

  // Grouped by photograph so each one is decoded exactly once, whatever the
  // order the faces were written in. Decoding is the expensive stage by an order
  // of magnitude and a photograph with six faces is common.
  /** @type {Map<number, Types.Session1FaceRecord[]>} */
  const facesByPhoto = new Map()
  /** @type {number[]} */
  const orphaned = []
  for (const face of facesRead.records) {
    if (!photoById.has(face.photoId)) {
      orphaned.push(face.id)
      continue
    }
    const bucket = facesByPhoto.get(face.photoId)
    if (bucket) bucket.push(face)
    else facesByPhoto.set(face.photoId, [face])
  }
  if (orphaned.length > 0) {
    log(`! ${orphaned.length} face(s) reference a photo id photos.jsonl has no row for — skipped.`)
  }

  let work = [...facesByPhoto.keys()].sort((a, b) => a - b)
  if (args.limit !== null) work = work.slice(0, args.limit)

  const backends = deps.backends ?? (await probeBackends({ skipVideo: true }))
  if (!backends.image) {
    throw new MediaImportError(
      "NO_IMAGE_BACKEND",
      "No image backend found. Install vips (brew install vips) or ImageMagick.",
    )
  }
  const backend = backends.image

  const contextDir = path.join(args.runDir, "context")
  const scratchDir = path.join(args.runDir, "scratch")
  fs.mkdirSync(contextDir, { recursive: true })
  fs.mkdirSync(scratchDir, { recursive: true })

  /** @type {Types.Session1FailureRecord[]} */
  const failures = []
  let written = 0
  let photosDone = 0
  let rescaled = 0

  let interrupted = false
  const onSignal = () => {
    if (interrupted) return
    interrupted = true
    log("\n! Interrupted — finishing this photograph, then stopping.")
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)

  log(`${work.length} photograph(s) with faces; decoding at ${sourceEdge}px.`)
  log(`Backend: ${backend.name} ${backend.version}. Writing to ${contextDir}`)

  const started = performance.now()
  try {
    for (let index = 0; index < work.length && !interrupted; index++) {
      const photoId = work[index]
      const photo = photoById.get(photoId)
      const faces = facesByPhoto.get(photoId)
      if (!photo || !faces) continue
      const absolute = path.join(args.dir, photo.relative)

      /** @param {string} code @param {string} message */
      const fail = (code, message) => {
        failures.push({ file: photo.relative, code, message })
        log(`  ! ${photo.relative} — ${code}: ${message}`)
      }

      // A missing source is a per-file failure, not the end of the run: a
      // directory re-organised since the batch must not cost the whole pass.
      // Recorded with a local code rather than a MediaImportError one, because
      // the importer's taxonomy is the importer's and this is not one of its
      // failures.
      if (!fs.existsSync(absolute)) {
        fail("SOURCE_MISSING", `not found under ${args.dir}`)
        continue
      }

      try {
        const source = await readPixelsFn(backend, absolute, {
          maxEdge: sourceEdge,
          scratchDir,
        })

        const scale = resolveScale(source, photo)
        if (!scale.ok) {
          fail("DIMENSION_MISMATCH", scale.reason)
          continue
        }
        if (scale.sx !== 1 || scale.sy !== 1) rescaled++

        for (const face of faces) {
          const box = {
            x: face.box.x * scale.sx,
            y: face.box.y * scale.sy,
            w: face.box.w * scale.sx,
            h: face.box.h * scale.sy,
          }
          const rect = expandBox(box, args.margin, source.width, source.height)
          const cropped = cropRegion(source, rect)
          // boxDownsample never upsamples, so a face crop already smaller than
          // --size is written at its own resolution rather than blown up into a
          // softer version of itself.
          const scaled = boxDownsample(cropped, args.size)
          writePngFn(scaled.image, path.join(args.runDir, contextName(face.id)))
          written++
        }

        photosDone++
        if (index % PROGRESS_EVERY === 0) {
          log(
            `[${index + 1}/${work.length}] ${photo.relative} — ` +
              `${faces.length} crop(s), ${written} total`,
          )
        }
      } catch (err) {
        fail(
          isMediaImportError(err) ? err.code : "UNKNOWN",
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  } finally {
    process.off("SIGINT", onSignal)
    process.off("SIGTERM", onSignal)
    fs.rmSync(scratchDir, { recursive: true, force: true })
  }

  const seconds = Math.round((performance.now() - started) / 1000)
  log("")
  log(`${photosDone} photograph(s), ${written} context crop(s), ${seconds}s.`)
  if (rescaled > 0) {
    log(`${rescaled} photograph(s) decoded a pixel or two off the recorded size; boxes rescaled.`)
  }
  if (failures.length > 0) log(`Failed ${failures.length} photograph(s) — listed above.`)
  if (interrupted) log(`Stopped early: ${work.length - photosDone - failures.length} photograph(s) not done.`)
  log(`Output: ${contextDir}`)
  if (!interrupted && written > 0) {
    log(`Next: node scripts/vision/relabel-data.js ${args.runDir}`)
    log(`      (label-data.js only references context crops after it is re-run)`)
  }

  const exitCode = interrupted
    ? EXIT.INTERRUPTED
    : failures.length > 0
      ? EXIT.SOME_FAILED
      : EXIT.CLEAN

  return { exitCode, photos: photosDone, written, rescaled, failures }
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
    const result = await runContextCrops(parsed.value)
    return result.exitCode
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n")
    return EXIT.ABORTED
  }
}

// `node scripts/vision/context-crops.js ...` runs; `import` from another module
// does not. Same guard as session1.js — relabel-data.js imports contextName.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2))
}
