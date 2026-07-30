/** @file Turns a source file on disk into the variant set the server expects,
 *  reproducing server-side what public/components/media-processing.js does in a
 *  canvas.
 *
 *  Three guarantees the callers depend on:
 *
 *  1. Every derived variant is metadata-free. Backends cannot be trusted with
 *     this — vips and magick preserve EXIF by default and sips has no strip
 *     flag — so core/image-meta.js rewrites each one and the result is asserted,
 *     not assumed.
 *  2. Every derived variant is under its MEDIA_LIMITS cap and sniffs as a type
 *     the server accepts. A quality/size ladder steps down until it fits, and
 *     the produced bytes are re-sniffed through the same core/sniff.js the
 *     server uses, so a 413 or 415 at upload time is impossible.
 *  3. needsDisplay is always false. Producing real display/thumb variants even
 *     from HEIC — which desktop Chrome cannot decode, leaving a gallery of
 *     placeholder tiles — is the main reason this importer exists.
 *
 *  Reported width/height are ORIENTED, matching the browser's
 *  createImageBitmap(file, { imageOrientation: "from-image" }). Backends
 *  disagree here (for one HEIC, vips and magick report 1600x2400 while sips
 *  reports 2400x1600), so the answer is cross-checked against the display
 *  variant, which is by definition what the gallery renders. */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  hasImageMetadata,
  readExifSummary,
  readImageHeader,
  stripImageMetadata,
} from "../../core/image-meta.js"
import { probeMp4 } from "../../core/mp4-probe.js"
import { contentTypeAgrees, extForSniff, sniffMagic } from "../../core/sniff.js"
import {
  CONTENT_IMAGE_LADDER,
  MEDIA_KIND,
  MEDIA_LIMITS,
  MEDIA_SECTION,
} from "../../types.js"
import {
  buildDimensionCommand,
  buildPosterCommand,
  buildResizeCommands,
  parseDimensionOutput,
  probeImageBackend,
  probeVideoBackend,
  runBinary,
} from "./image-backend.js"
import { MediaImportError } from "./media-errors.js"

/** Enough to reach the start-of-frame past a large EXIF block and ICC profile. */
const HEADER_READ_BYTES = 512 * 1024
/** Sniffing needs 12; core/upload.js buffers 32 for the same job. */
const SNIFF_BYTES = 32

/**
 * Derived variants, mirroring media-processing.js. `display`/`thumb` match
 * DEFAULT_IMAGE_VARIANTS; the w* ladder matches DRESSCODE_LADDER; `poster`
 * matches extractPoster's 2000px JPEG at 0.8.
 * @type {Record<string, { maxEdge: number, quality: number, capBytes: number, jpegOnly?: boolean }>}
 */
const VARIANT_SPECS = {
  display: { maxEdge: 2000, quality: 0.82, capBytes: MEDIA_LIMITS.DISPLAY_MAX },
  thumb: { maxEdge: 400, quality: 0.7, capBytes: MEDIA_LIMITS.THUMB_MAX },
  poster: { maxEdge: 2000, quality: 0.8, capBytes: MEDIA_LIMITS.POSTER_MAX, jpegOnly: true },
  w400: { maxEdge: CONTENT_IMAGE_LADDER[0].maxEdge, quality: 0.72, capBytes: MEDIA_LIMITS.W400_MAX },
  w800: { maxEdge: CONTENT_IMAGE_LADDER[1].maxEdge, quality: 0.78, capBytes: MEDIA_LIMITS.W800_MAX },
  w1600: { maxEdge: CONTENT_IMAGE_LADDER[2].maxEdge, quality: 0.82, capBytes: MEDIA_LIMITS.W1600_MAX },
}

/**
 * Multipliers on a variant's base quality and edge, tried in order until the
 * output fits its cap. Insurance rather than a hot path: a 2000px display is at
 * most 4MP, and measured WebP q82 output at that size is ~800KB against a 4MB
 * cap. It exists because that measurement was taken on synthetic gradients, not
 * a real 12MP camera frame.
 */
const QUALITY_LADDER = [
  { quality: 1.0, edge: 1.0 },
  { quality: 0.85, edge: 1.0 },
  { quality: 0.71, edge: 1.0 },
  { quality: 0.85, edge: 0.75 },
  { quality: 0.71, edge: 0.6 },
]

/** Sniffed type → the Content-Type the server's contentTypeAgrees expects. */
const MIME_FOR_SNIFF = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
})

const IMAGE_SNIFFS = new Set(["jpeg", "png", "webp", "heic"])
const VIDEO_SNIFFS = new Set(["mp4", "mov"])

/**
 * @param {string} sniffed
 * @returns {sniffed is Types.SourceSniff}
 */
function isSupportedSniff(sniffed) {
  return IMAGE_SNIFFS.has(sniffed) || VIDEO_SNIFFS.has(sniffed)
}

/** @type {Types.probeBackends} */
export async function probeBackends(options = {}) {
  const [image, video] = await Promise.all([
    probeImageBackend(options.image),
    options.skipVideo ? Promise.resolve(null) : probeVideoBackend(options.video),
  ])
  return { image, video }
}

/**
 * Read the leading bytes of a file without pulling in the whole thing.
 * @param {string} filePath @param {number} maxBytes
 * @returns {Buffer}
 */
function readHead(filePath, maxBytes) {
  const fd = fs.openSync(filePath, "r")
  try {
    const size = fs.fstatSync(fd).size
    const buf = Buffer.alloc(Math.min(size, maxBytes))
    if (buf.length === 0) return buf
    fs.readSync(fd, buf, 0, buf.length, 0)
    return buf
  } finally {
    fs.closeSync(fd)
  }
}

/** @type {Types.sniffFile} */
export function sniffFile(filePath) {
  const head = readHead(filePath, SNIFF_BYTES)
  return sniffMagic(head)
}

/**
 * Ask the backend for dimensions. Only needed for HEIC — every other format is
 * read straight from its header with no subprocess.
 * @param {Types.ImageBackend} backend @param {string} sourcePath
 * @returns {Promise<Types.BackendDimensions>}
 */
async function backendDimensions(backend, sourcePath) {
  const commands = buildDimensionCommand(backend, sourcePath)
  /** @type {string[]} */
  const outputs = []
  for (const command of commands) {
    const { stdout } = await runBinary(command.bin, command.args, {
      env: backend.childEnv,
      file: sourcePath,
    })
    outputs.push(stdout)
  }
  const dims = parseDimensionOutput(backend, outputs)
  if (!dims) {
    throw new MediaImportError(
      "UNREADABLE_DIMENSIONS",
      `Couldn't read the size of ${path.basename(sourcePath)} — ${backend.name} returned ` +
        `"${outputs.join(" ").trim().slice(0, 120)}". The file may be truncated.`,
      { file: sourcePath },
    )
  }
  return dims
}

/** @type {Types.planMediaFile} */
export async function planMediaFile(sourcePath, backends) {
  const stat = fs.statSync(sourcePath)
  const sniffed = sniffFile(sourcePath)

  if (!isSupportedSniff(sniffed)) {
    return {
      ok: false,
      sourcePath,
      code: "UNSUPPORTED_SOURCE",
      message: `${path.basename(sourcePath)} — not a supported format (the site accepts JPEG, PNG, WebP, HEIC, MP4, MOV).`,
    }
  }

  if (VIDEO_SNIFFS.has(sniffed)) {
    if (stat.size > MEDIA_LIMITS.VIDEO_ORIGINAL_MAX) {
      return {
        ok: false,
        sourcePath,
        code: "SOURCE_TOO_LARGE",
        message: `${path.basename(sourcePath)} is ${formatBytes(stat.size)} — over the ${formatBytes(MEDIA_LIMITS.VIDEO_ORIGINAL_MAX)} limit for video originals.`,
      }
    }
    if (!backends.video) {
      return {
        ok: false,
        sourcePath,
        code: "NO_VIDEO_BACKEND",
        message: `${path.basename(sourcePath)} — no poster-frame tool available (install ffmpeg, or upload videos through the admin gallery modal).`,
      }
    }
    const probe = await probeMp4(sourcePath)
    if (!probe || !probe.width || !probe.height) {
      return {
        ok: false,
        sourcePath,
        code: "UNREADABLE_DIMENSIONS",
        message: `${path.basename(sourcePath)} — couldn't read the video's dimensions from its container. The file may be truncated.`,
      }
    }
    if (probe.durationSeconds && probe.durationSeconds > MEDIA_LIMITS.VIDEO_MAX_DURATION_S) {
      return {
        ok: false,
        sourcePath,
        code: "VIDEO_TOO_LONG",
        message: `${path.basename(sourcePath)} is ${Math.round(probe.durationSeconds)}s — videos must be ${MEDIA_LIMITS.VIDEO_MAX_DURATION_S} seconds or shorter.`,
      }
    }
    return {
      ok: true,
      sourcePath,
      kind: MEDIA_KIND.VIDEO,
      sniffed,
      originalExt: extForSniff(sniffed),
      originalBytes: stat.size,
      width: probe.width,
      height: probe.height,
      durationSeconds: probe.durationSeconds,
      orientation: 1,
      hasGps: false, // blanked server-side at finalize by core/mp4-meta.js
      capturedAt: null,
      mtimeMs: stat.mtimeMs,
    }
  }

  if (!IMAGE_SNIFFS.has(sniffed)) {
    return {
      ok: false,
      sourcePath,
      code: "UNSUPPORTED_SOURCE",
      message: `${path.basename(sourcePath)} — unsupported format.`,
    }
  }
  if (stat.size > MEDIA_LIMITS.IMAGE_ORIGINAL_MAX) {
    return {
      ok: false,
      sourcePath,
      code: "SOURCE_TOO_LARGE",
      message: `${path.basename(sourcePath)} is ${formatBytes(stat.size)} — over the ${formatBytes(MEDIA_LIMITS.IMAGE_ORIGINAL_MAX)} limit for photo originals.`,
    }
  }
  if (!backends.image) {
    return {
      ok: false,
      sourcePath,
      code: "NO_IMAGE_BACKEND",
      message: `${path.basename(sourcePath)} — no image backend available.`,
    }
  }

  const head = readHead(sourcePath, HEADER_READ_BYTES)
  const exif = readExifSummary(head)
  const header = readImageHeader(head)

  // JPEG/PNG/WebP resolve with no subprocess at all. Only HEIC needs one.
  //
  // Backends disagree about HEIC orientation: for one test file vips and magick
  // both report 1600x2400 while sips reports 2400x1600. sips is at least
  // self-consistent — the display variant it produces matches its own reading,
  // so the stored dimensions still describe the bytes actually served and the
  // gallery lays out correctly. It is the last-resort backend for exactly this
  // sort of reason; install vips or ImageMagick for HEIC-heavy imports.
  let width = header?.width ?? 0
  let height = header?.height ?? 0
  if (!header) {
    const dims = await backendDimensions(backends.image, sourcePath)
    width = dims.width
    height = dims.height
  }
  // A quarter turn means the stored dimensions are transposed relative to how
  // the photo should be shown.
  const quarterTurn = exif.orientation >= 5 && exif.orientation <= 8
  return {
    ok: true,
    sourcePath,
    kind: MEDIA_KIND.IMAGE,
    sniffed,
    originalExt: extForSniff(sniffed),
    originalBytes: stat.size,
    width: quarterTurn ? height : width,
    height: quarterTurn ? width : height,
    durationSeconds: null,
    orientation: exif.orientation,
    hasGps: exif.hasGps,
    capturedAt: exif.capturedAt,
    mtimeMs: stat.mtimeMs,
  }
}

/** @type {Types.variantNamesFor} */
export function variantNamesFor(kind, section) {
  if (kind === MEDIA_KIND.VIDEO) return ["poster"]
  if (section === MEDIA_SECTION.CONTENT) return ["w400", "w800", "w1600"]
  return ["display", "thumb"]
}

/**
 * Human-readable byte count. No regex; matches the style used in the CLI.
 * @param {number} bytes @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/**
 * Produce one derived variant, stepping quality and size down until it fits its
 * cap, then strip metadata and verify the result is something the server will
 * accept.
 * @param {Types.ImageBackend} backend
 * @param {{ name: string, sourcePath: string, workDir: string, orientation: number, sourceWidth: number, sourceHeight: number, format: "jpeg" | "webp" }} options
 * @returns {Promise<Types.VariantArtifact>}
 */
async function buildOneVariant(backend, options) {
  const spec = VARIANT_SPECS[options.name]
  const ext = options.format === "webp" ? "webp" : "jpg"
  const outPath = path.join(options.workDir, options.name + "." + ext)
  const midPath = path.join(options.workDir, options.name + "-rotated.jpg")

  /** @type {string[]} */
  const warnings = []
  for (let rung = 0; rung < QUALITY_LADDER.length; rung++) {
    const step = QUALITY_LADDER[rung]
    const quality = spec.quality * step.quality
    const maxEdge = Math.max(1, Math.round(spec.maxEdge * step.edge))

    const commands = buildResizeCommands(backend, {
      sourcePath: options.sourcePath,
      outPath,
      midPath,
      maxEdge,
      quality,
      format: options.format,
      orientation: options.orientation,
      sourceWidth: options.sourceWidth,
      sourceHeight: options.sourceHeight,
    })
    for (const command of commands) {
      await runBinary(command.bin, command.args, {
        env: backend.childEnv,
        file: options.sourcePath,
      })
    }

    // Strip unconditionally: these are the bytes the public gallery serves, and
    // api/media.js does not strip them server-side.
    const produced = fs.readFileSync(outPath)
    const cleaned = stripImageMetadata(produced)
    if (hasImageMetadata(cleaned)) {
      throw new MediaImportError(
        "STRIP_FAILED",
        `Couldn't guarantee ${options.name} of ${path.basename(options.sourcePath)} is metadata-free — refusing to publish it.`,
        { file: options.sourcePath },
      )
    }
    if (cleaned !== produced) fs.writeFileSync(outPath, cleaned)

    // The exact gate the server applies (api/media.js VARIANT_SPEC + sniff).
    const sniffed = sniffMagic(cleaned.subarray(0, SNIFF_BYTES))
    if (sniffed !== "jpeg" && sniffed !== "webp") {
      throw new MediaImportError(
        "VARIANT_FORMAT_MISMATCH",
        `${backend.name} produced ${sniffed || "an unrecognized format"} for ${options.name}, expected jpeg or webp — the server would reject it with 415.`,
        { file: options.sourcePath },
      )
    }
    const contentType = MIME_FOR_SNIFF[sniffed]
    if (!contentTypeAgrees(contentType, sniffed)) {
      throw new MediaImportError(
        "VARIANT_FORMAT_MISMATCH",
        `Content-Type ${contentType} disagrees with the sniffed bytes for ${options.name}.`,
        { file: options.sourcePath },
      )
    }

    if (cleaned.length <= spec.capBytes) {
      const dims = readImageHeader(cleaned)
      return {
        name: options.name,
        path: outPath,
        bytes: cleaned.length,
        contentType,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        quality,
        steppedDown: rung > 0,
        warnings,
      }
    }
    warnings.push(
      `${options.name} was ${formatBytes(cleaned.length)} at quality ${quality.toFixed(2)} / ${maxEdge}px (cap ${formatBytes(spec.capBytes)}) — retrying lower.`,
    )
  }

  const last = QUALITY_LADDER[QUALITY_LADDER.length - 1]
  throw new MediaImportError(
    "VARIANT_TOO_LARGE",
    `Couldn't get the ${options.name} variant of ${path.basename(options.sourcePath)} under ` +
      `${formatBytes(spec.capBytes)} even at quality ${(spec.quality * last.quality).toFixed(2)} / ` +
      `${Math.round(spec.maxEdge * last.edge)}px — skipped.`,
    { file: options.sourcePath },
  )
}

/**
 * Link the source into the work dir under a fixed, boring name. Solves three
 * things at once: ImageMagick reads `[...]` in an INPUT filename as a frame
 * selector, so a photo called `IMG_[2].jpg` would break; no backend ever sees a
 * filename with spaces or newlines; and the poster still gets a predictable
 * name. Costs one inode.
 * @param {string} sourcePath @param {string} workDir @param {string} ext
 * @returns {string}
 */
function linkSource(sourcePath, workDir, ext) {
  const linkPath = path.join(workDir, "src." + ext)
  const absolute = path.resolve(sourcePath)
  try {
    fs.symlinkSync(absolute, linkPath)
  } catch {
    try {
      fs.linkSync(absolute, linkPath)
    } catch {
      fs.copyFileSync(absolute, linkPath)
    }
  }
  return linkPath
}

/** @type {Types.buildMediaVariants} */
export async function buildMediaVariants(plan, backends, options = {}) {
  if (!backends.image) {
    throw new MediaImportError("NO_IMAGE_BACKEND", "No image backend available.")
  }
  const tmpRoot = options.tmpRoot ?? os.tmpdir()
  fs.mkdirSync(tmpRoot, { recursive: true })
  const workDir = fs.mkdtempSync(path.join(tmpRoot, "wedding-import-"))

  /** @type {Types.BuiltMedia} */
  const built = {
    plan,
    kind: plan.kind,
    width: plan.width,
    height: plan.height,
    durationSeconds: plan.durationSeconds,
    needsDisplay: false,
    artifacts: [],
    warnings: [],
    workDir,
    dispose: async () => {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {})
    },
  }

  try {
    const linked = linkSource(plan.sourcePath, workDir, plan.originalExt)
    const format = backends.image.canWebp && options.format !== "jpeg" ? "webp" : "jpeg"

    /** The file the image backend reads: the source, or a still pulled from it. */
    let imageSource = linked
    let imageOrientation = plan.orientation
    let imageWidth = plan.width
    let imageHeight = plan.height

    if (plan.kind === MEDIA_KIND.VIDEO) {
      if (!backends.video) {
        throw new MediaImportError(
          "NO_VIDEO_BACKEND",
          `No poster-frame tool for ${path.basename(plan.sourcePath)}.`,
          { file: plan.sourcePath },
        )
      }
      // Same frame the browser grabs in extractPoster().
      const at = Math.min(0.5, (plan.durationSeconds ?? 1) / 2)
      const stillPath = path.join(workDir, "still.png")
      const command = buildPosterCommand(backends.video, {
        sourcePath: linked,
        outPath: stillPath,
        atSeconds: at,
      })
      await runBinary(command.bin, command.args, {
        env: backends.video.childEnv,
        file: plan.sourcePath,
      })
      if (!fs.existsSync(stillPath) || fs.statSync(stillPath).size === 0) {
        throw new MediaImportError(
          "BACKEND_FAILED",
          `${backends.video.name} produced no frame for ${path.basename(plan.sourcePath)} at ${at}s.`,
          { file: plan.sourcePath },
        )
      }
      imageSource = stillPath
      // The still is already upright and carries no EXIF.
      imageOrientation = 1
    }

    for (const name of variantNamesFor(plan.kind, options.section ?? MEDIA_SECTION.GUEST)) {
      const spec = VARIANT_SPECS[name]
      const artifact = await buildOneVariant(backends.image, {
        name,
        sourcePath: imageSource,
        workDir,
        orientation: imageOrientation,
        sourceWidth: imageWidth,
        sourceHeight: imageHeight,
        format: spec.jpegOnly ? "jpeg" : format,
      })
      built.artifacts.push(artifact)
      built.warnings.push(...artifact.warnings)
    }

    // Cross-check the reported dimensions against the largest derived variant,
    // which is by definition oriented the way the gallery will show it. This
    // catches a backend whose rotation behaviour differs from what we assumed —
    // the one thing that would otherwise land a transposed aspect ratio in the
    // database.
    if (plan.kind === MEDIA_KIND.IMAGE) {
      const reference = built.artifacts.reduce(
        (/** @type {Types.VariantArtifact | null} */ best, a) =>
          a.width && a.height && (!best || a.width * a.height > (best.width ?? 0) * (best.height ?? 0))
            ? a
            : best,
        null,
      )
      if (reference?.width && reference.height) {
        const storedLandscape = built.width > built.height
        const shownLandscape = reference.width > reference.height
        if (built.width !== built.height && storedLandscape !== shownLandscape) {
          built.warnings.push(
            `Reported dimensions disagreed with the ${reference.name} variant's orientation — using the variant's.`,
          )
          const swapped = built.width
          built.width = built.height
          built.height = swapped
        }
      }
    }

    // The original goes last, matching media-uploader.js: the big retryable
    // upload is the tail of the sequence.
    built.artifacts.push({
      name: "original",
      path: plan.sourcePath,
      bytes: plan.originalBytes,
      contentType: MIME_FOR_SNIFF[plan.sniffed],
      width: built.width,
      height: built.height,
      quality: null,
      steppedDown: false,
      warnings: [],
    })
    return built
  } catch (err) {
    await built.dispose()
    throw err
  }
}

/** @type {Types.randomWorkName} */
export function randomWorkName() {
  return crypto.randomBytes(8).toString("hex")
}
