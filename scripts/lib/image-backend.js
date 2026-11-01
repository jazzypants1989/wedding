/** @file Detection of, and argument construction for, the system image tools
 *  the bulk importer shells out to.
 *
 *  Shelling out to a binary is a new dependency class for this repo — see the
 *  note in CLAUDE.md. Two rules make it safe:
 *
 *  1. Every invocation is an argv ARRAY passed to execFile, never a shell
 *     string. Filenames come from a user-supplied directory and can contain
 *     spaces, quotes, `$`, `;` and newlines. (A shell string is safe only when the
 *     command is a fixed literal with nothing from input in it.)
 *  2. Detection is try-exec, not `which` and not a hard-coded path. Catching
 *     ENOENT proves the binary exists AND runs; /opt/homebrew paths would break
 *     Linux and Intel Macs.
 *
 *  No regex, so every parser here is string methods plus a charCode digit loop.
 *
 *  Behaviour verified on macOS 26.5 with vips 8.17.0, ImageMagick 7.1.1-47 and
 *  sips-316. The differences that shaped this file:
 *    - sips cannot write WebP (`sips --formats` lists it read-only) — JPEG only.
 *    - sips has NO metadata-strip flag, so core/image-meta.js does that job for
 *      every backend rather than trusting any of them.
 *    - sips -Z UPSCALES a source smaller than the target, so the caller must
 *      skip it when the image already fits.
 *    - sips does NOT bake EXIF orientation into -Z output; it needs an explicit
 *      -r/-f pass first, and it leaves the now-stale orientation tag behind
 *      (which the metadata strip then removes).
 */
/** @import * as Types from './types.js' */

import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"

import { MediaImportError } from "./media-errors.js"

const run = promisify(execFile)

/** Long enough for a 100MP TIFF, short enough that a hung tool fails a file. */
const DEFAULT_TIMEOUT_MS = 120_000
/** Version/dimension probes should be instant; a slow one means trouble. */
const PROBE_TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
/**
 * Cap for the raw-pixel path, which is a different order of magnitude from the
 * text one above: a 4000px square PPM body is 48MB. This is a dev-machine-only
 * path (the face pipeline), so a transient buffer this size is affordable in a
 * way it would never be on the request path.
 */
const MAX_RAW_BYTES = 64 * 1024 * 1024

/**
 * Image backends in preference order. `vips` first: it shrinks on load, so it
 * is the fastest on large JPEGs, and it has the best HEIC support.
 * @type {Types.ImageBackendSpec[]}
 */
const IMAGE_BACKENDS = [
  // prettier-ignore
  { name: "vips", bin: "vips", versionArgs: ["--version"], canWebp: true, canHeic: true, autoOrients: true, canRawPixels: true },
  // prettier-ignore
  { name: "magick", bin: "magick", versionArgs: ["-version"], canWebp: true, canHeic: true, autoOrients: true, canRawPixels: true },
  // prettier-ignore
  { name: "convert", bin: "convert", versionArgs: ["-version"], canWebp: true, canHeic: true, autoOrients: true, canRawPixels: true },
  // sips writes named formats to files only — it has no raw/PPM target at all,
  // so it cannot feed the pixel path. Everything else still works on it.
  // prettier-ignore
  { name: "sips", bin: "sips", versionArgs: ["--version"], canWebp: false, canHeic: true, autoOrients: false, canRawPixels: false },
]

/** @type {Types.VideoBackendSpec[]} */
const VIDEO_BACKENDS = [{ name: "ffmpeg", bin: "ffmpeg", versionArgs: ["-version"] }]

/**
 * Per-backend environment that pins the tool to one thread. vips and magick are
 * both OpenMP-threaded; running N of them in parallel with M threads each
 * thrashes. The importer gets its parallelism from running several files at
 * once instead.
 * @type {Record<string, Record<string, string>>}
 */
const CHILD_ENV = {
  vips: { VIPS_CONCURRENCY: "1", OMP_NUM_THREADS: "1" },
  magick: { MAGICK_THREAD_LIMIT: "1", OMP_NUM_THREADS: "1" },
  convert: { MAGICK_THREAD_LIMIT: "1", OMP_NUM_THREADS: "1" },
  sips: {},
  ffmpeg: {},
}

/** ImageMagick's %[orientation] words → EXIF orientation numbers. */
const MAGICK_ORIENTATION = Object.freeze({
  TopLeft: 1,
  TopRight: 2,
  BottomRight: 3,
  BottomLeft: 4,
  LeftTop: 5,
  RightTop: 6,
  RightBottom: 7,
  LeftBottom: 8,
  Undefined: 1,
})

/**
 * sips rotate/flip arguments per EXIF orientation. Orientation 1 needs nothing.
 * @type {Record<number, string[]>}
 */
const SIPS_ORIENT_ARGS = Object.freeze({
  2: ["-f", "horizontal"],
  3: ["-r", "180"],
  4: ["-f", "vertical"],
  5: ["-f", "horizontal", "-r", "270"],
  6: ["-r", "90"],
  7: ["-f", "horizontal", "-r", "90"],
  8: ["-r", "270"],
})

/** @type {Types.parseUint} */
export function parseUint(str) {
  const s = str.trim()
  // 10 digits keeps the result inside a safe integer with room to spare; any
  // real dimension is far shorter.
  if (s.length === 0 || s.length > 10) return null
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return null
    n = n * 10 + (c - 48)
  }
  return n
}

/** @type {Types.sipsProp} */
export function sipsProp(stdout, key) {
  const lines = stdout.split("\n")
  const needle = key + ":"
  // Property lines always follow the echoed path, so scanning from the end
  // means a path that itself ends in "pixelWidth: 9" cannot win.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith(needle)) return line.slice(needle.length).trim()
  }
  return null
}

/** @type {Types.magickOrientationToExif} */
export function magickOrientationToExif(word) {
  const trimmed = word.trim()
  return Object.hasOwn(MAGICK_ORIENTATION, trimmed)
    ? MAGICK_ORIENTATION[/** @type {keyof typeof MAGICK_ORIENTATION} */ (trimmed)]
    : 1
}

/** @type {Types.firstLine} */
export function firstLine(text) {
  const line = text.split("\n")[0].trim()
  // ImageMagick prefixes "Version: "; strip it so the label reads cleanly.
  const marker = "Version: "
  return line.startsWith(marker) ? line.slice(marker.length) : line
}

/** @type {Types.runBinary} */
export async function runBinary(bin, args, options = {}) {
  try {
    const { stdout, stderr } = await run(bin, args, {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      env: { ...process.env, ...(options.env ?? {}) },
    })
    return { stdout: String(stdout), stderr: String(stderr) }
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { killed?: boolean, stderr?: string }} */ (err)
    if (e.code === "ENOENT") {
      throw new MediaImportError("BACKEND_MISSING", `${bin} is not installed or not on PATH.`)
    }
    if (e.killed) {
      throw new MediaImportError(
        "BACKEND_TIMEOUT",
        `${bin} did not finish within ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s.`,
        { file: options.file, detail: args.join(" ") },
      )
    }
    const stderr = (e.stderr ?? e.message ?? "").trim()
    throw new MediaImportError("BACKEND_FAILED", `${bin} failed: ${stderr.slice(0, 500)}`, {
      file: options.file,
      detail: args.join(" "),
    })
  }
}

/** @type {Types.runBinaryRaw} */
export function runBinaryRaw(bin, args, options = {}) {
  // runBinary cannot carry pixels: execFile decodes stdout as utf8 and this
  // module's wrapper does String(stdout), which mangles any byte above 0x7f,
  // and MAX_OUTPUT_BYTES is far below one decoded frame. So this is a separate
  // spawn-based path rather than a flag on the existing one — same argv-array
  // rule, same error taxonomy, different plumbing.
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_RAW_BYTES
  return new Promise((resolve, reject) => {
    /** @param {Types.MediaImportErrorCode} code @param {string} message */
    const fail = (code, message) =>
      reject(new MediaImportError(code, message, { file: options.file, detail: args.join(" ") }))

    let child
    try {
      child = spawn(bin, args, {
        env: { ...process.env, ...(options.env ?? {}) },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch {
      fail("BACKEND_MISSING", `${bin} is not installed or not on PATH.`)
      return
    }

    /** @type {Buffer[]} */
    const chunks = []
    let total = 0
    let stderr = ""
    let settled = false
    /** @type {NodeJS.Timeout | null} */
    let timer = null

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      timer = null
    }
    /** @param {() => void} report */
    const settle = (report) => {
      if (settled) return
      settled = true
      cleanup()
      report()
    }

    timer = setTimeout(() => {
      child.kill("SIGKILL")
      settle(() =>
        fail("BACKEND_TIMEOUT", `${bin} did not finish within ${Math.round(timeoutMs / 1000)}s.`),
      )
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        child.kill("SIGKILL")
        settle(() =>
          fail("BACKEND_FAILED", `${bin} produced more than ${maxBytes} bytes of output.`),
        )
        return
      }
      chunks.push(chunk)
    })
    // Bounded, because a backend that fails on every file of a large batch
    // should not accumulate its complaints in memory.
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += String(chunk)
    })

    child.on("error", (err) => {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code
      settle(() =>
        code === "ENOENT"
          ? fail("BACKEND_MISSING", `${bin} is not installed or not on PATH.`)
          : fail("BACKEND_FAILED", `${bin} failed: ${String(err.message).slice(0, 500)}`),
      )
    })

    child.on("close", (code) => {
      settle(() => {
        if (code !== 0) {
          fail("BACKEND_FAILED", `${bin} failed: ${stderr.trim().slice(0, 500)}`)
          return
        }
        resolve({ stdout: Buffer.concat(chunks), stderr: stderr.trim() })
      })
    })
  })
}

/** @type {Types.buildPixelCommand} */
export function buildPixelCommand(backend, options) {
  const { sourcePath, maxEdge, ppmPath } = options

  if (backend.name === "vips") {
    // vips shrinks on load, which is the whole reason to prefer it here — a
    // 24MP JPEG never gets fully decoded. Its stdout target syntax is
    // per-format and awkward, so it writes a scratch PPM and we read it back.
    // `--size down` never upscales, matching the magick `>` suffix below.
    return {
      readFrom: "file",
      commands: [
        {
          bin: backend.bin,
          args: [
            "thumbnail",
            sourcePath,
            ppmPath,
            String(maxEdge),
            "--height",
            String(maxEdge),
            "--size",
            "down",
          ],
        },
      ],
    }
  }

  if (backend.name === "magick" || backend.name === "convert") {
    // `jpeg:size` is a decode hint, not a resize: libjpeg picks the smallest
    // DCT scale at or above it, so the full frame is never expanded. 2x the
    // target leaves headroom for the resample to work from.
    //
    // `-depth 8` is NOT optional. A Q16 build writes maxval 65535 PPM without
    // it (verified on ImageMagick 7.1.2 Q16-HDRI), which is silently twice the
    // bytes at twice the width per sample. The PPM header records what actually
    // happened, so pixels-cli.js checks rather than assumes -- but asking for
    // the right thing first is free.
    return {
      readFrom: "stdout",
      commands: [
        {
          bin: backend.bin,
          args: [
            "-define",
            `jpeg:size=${maxEdge * 2}x${maxEdge * 2}`,
            sourcePath,
            "-auto-orient",
            "-resize",
            `${maxEdge}x${maxEdge}>`,
            "-depth",
            "8",
            "ppm:-",
          ],
        },
      ],
    }
  }

  // sips. Nothing to build; the caller must fall back or refuse.
  return null
}

/**
 * Does this binary exist and run? Returns its version line, or null.
 * @param {string} bin @param {string[]} versionArgs
 * @returns {Promise<string | null>}
 */
async function tryVersion(bin, versionArgs) {
  try {
    const { stdout, stderr } = await runBinary(bin, versionArgs, { timeoutMs: PROBE_TIMEOUT_MS })
    // sips writes its version to stderr; ImageMagick and vips use stdout.
    return firstLine(stdout.trim() ? stdout : stderr)
  } catch {
    return null
  }
}

/** @type {Types.probeImageBackend} */
export async function probeImageBackend(options = {}) {
  const requestedName = options.backendName ?? process.env.WEDDING_IMAGE_BACKEND
  const requestedBin = options.bin ?? process.env.WEDDING_IMAGE_BIN

  /** @type {Types.ImageBackendSpec[]} */
  let candidates = IMAGE_BACKENDS
  if (requestedBin) {
    // An explicit binary path still needs a spec to know its argument style.
    // Match on the requested name, else guess from the filename's last segment.
    const tail = requestedBin.split("/").pop() ?? requestedBin
    const spec =
      IMAGE_BACKENDS.find((b) => b.name === requestedName) ??
      IMAGE_BACKENDS.find((b) => tail.includes(b.name))
    if (!spec) {
      throw new MediaImportError(
        "NO_IMAGE_BACKEND",
        `WEDDING_IMAGE_BIN=${requestedBin} doesn't look like vips, magick, convert or sips. ` +
          `Set WEDDING_IMAGE_BACKEND to say which argument style it uses.`,
      )
    }
    candidates = [{ ...spec, bin: requestedBin }]
  } else if (requestedName) {
    const spec = IMAGE_BACKENDS.find((b) => b.name === requestedName)
    if (!spec) {
      throw new MediaImportError(
        "NO_IMAGE_BACKEND",
        `Unknown WEDDING_IMAGE_BACKEND=${requestedName}. Choose vips, magick, convert or sips.`,
      )
    }
    candidates = [spec]
  }

  for (const spec of candidates) {
    const version = await tryVersion(spec.bin, spec.versionArgs)
    if (!version) continue
    // vips reads dimensions through a sibling binary from the same package. If
    // it is missing, this install is unusable for planning — fall through.
    if (spec.name === "vips") {
      const headerBin = spec.bin.endsWith("vips") ? spec.bin + "header" : "vipsheader"
      if (!(await tryVersion(headerBin, ["--version"]))) continue
      return { ...spec, version, headerBin, childEnv: CHILD_ENV[spec.name] ?? {} }
    }
    return { ...spec, version, headerBin: null, childEnv: CHILD_ENV[spec.name] ?? {} }
  }
  return null
}

/** @type {Types.probeVideoBackend} */
export async function probeVideoBackend(options = {}) {
  const requestedName = options.backendName ?? process.env.WEDDING_VIDEO_BACKEND
  if (requestedName === "none") return null
  const requestedBin = options.bin ?? process.env.WEDDING_FFMPEG_BIN

  const candidates = requestedBin
    ? [{ ...VIDEO_BACKENDS[0], bin: requestedBin }]
    : requestedName
      ? VIDEO_BACKENDS.filter((b) => b.name === requestedName)
      : VIDEO_BACKENDS

  for (const spec of candidates) {
    const version = await tryVersion(spec.bin, spec.versionArgs)
    if (version) return { ...spec, version, childEnv: CHILD_ENV[spec.name] ?? {} }
  }
  return null
}

/** @type {Types.imageBackendInstallHint} */
export function imageBackendInstallHint() {
  return [
    "No image backend found. scripts/import-media.js needs one of these on PATH:",
    "",
    "  vips     fastest, best HEIC support",
    "             macOS          brew install vips",
    "             Debian/Ubuntu  sudo apt install libvips-tools",
    "  magick   ImageMagick 7 (or `convert` from ImageMagick 6)",
    "             macOS          brew install imagemagick",
    "             Debian/Ubuntu  sudo apt install imagemagick",
    "  sips     built in on macOS (JPEG-only output — no WebP)",
    "",
    "Override detection with WEDDING_IMAGE_BACKEND=vips|magick|convert|sips,",
    "or point at one binary with WEDDING_IMAGE_BIN=/full/path/to/vips.",
  ].join("\n")
}

/** @type {Types.videoBackendInstallHint} */
export function videoBackendInstallHint() {
  return [
    "No video backend found — videos need a poster frame (types.js expectedVariants).",
    "  Install ffmpeg:  macOS          brew install ffmpeg",
    "                   Debian/Ubuntu  sudo apt install ffmpeg",
    "  Or upload videos through the admin gallery modal, which extracts posters",
    "  in the browser.",
  ].join("\n")
}

/** @type {Types.buildDimensionCommand} */
export function buildDimensionCommand(backend, sourcePath) {
  if (backend.name === "vips") {
    // One property per invocation, so two calls. vipsheader -f prints the bare
    // value and nothing else.
    return [
      { bin: backend.headerBin ?? "vipsheader", args: ["-f", "width", sourcePath] },
      { bin: backend.headerBin ?? "vipsheader", args: ["-f", "height", sourcePath] },
    ]
  }
  if (backend.name === "magick") {
    return [{ bin: backend.bin, args: ["identify", "-format", "%w %h %[orientation]", sourcePath] }]
  }
  if (backend.name === "convert") {
    // ImageMagick 6 ships `identify` as its own binary next to `convert`.
    const identifyBin = backend.bin.endsWith("convert")
      ? backend.bin.slice(0, -"convert".length) + "identify"
      : "identify"
    return [{ bin: identifyBin, args: ["-format", "%w %h %[orientation]", sourcePath] }]
  }
  // sips prints the echoed path then one "key: value" line per -g.
  return [{ bin: backend.bin, args: ["-g", "pixelWidth", "-g", "pixelHeight", sourcePath] }]
}

/** @type {Types.parseDimensionOutput} */
export function parseDimensionOutput(backend, outputs) {
  if (backend.name === "vips") {
    if (outputs.length < 2) return null
    const width = parseUint(outputs[0])
    const height = parseUint(outputs[1])
    if (width === null || height === null || width <= 0 || height <= 0) return null
    // vipsheader reports the already-oriented size, so there is nothing to
    // apply on top of it.
    return { width, height, orientation: 1 }
  }
  if (backend.name === "magick" || backend.name === "convert") {
    const parts = outputs[0].trim().split(" ")
    if (parts.length < 2) return null
    const width = parseUint(parts[0])
    const height = parseUint(parts[1])
    if (width === null || height === null || width <= 0 || height <= 0) return null
    return {
      width,
      height,
      orientation: parts.length > 2 ? magickOrientationToExif(parts[2]) : 1,
    }
  }
  const widthText = sipsProp(outputs[0], "pixelWidth")
  const heightText = sipsProp(outputs[0], "pixelHeight")
  if (widthText === null || heightText === null) return null
  const width = parseUint(widthText)
  const height = parseUint(heightText)
  if (width === null || height === null || width <= 0 || height <= 0) return null
  // sips has no orientation property (`-g all` doesn't print one); callers read
  // it from EXIF via core/image-meta.js instead.
  return { width, height, orientation: 1 }
}

/** @type {Types.buildResizeCommands} */
export function buildResizeCommands(backend, options) {
  const { sourcePath, outPath, maxEdge, quality, format } = options
  const q = Math.max(1, Math.min(100, Math.round(quality * 100)))

  if (backend.name === "vips") {
    // Options ride in the output filename. `--size down` never upscales;
    // `keep=icc` drops EXIF/XMP but preserves the colour profile. Auto-rotation
    // is on by default, so orientation is baked in.
    const opts = format === "webp" ? `[Q=${q},keep=icc]` : `[Q=${q},keep=icc,optimize-coding=true]`
    return [
      {
        bin: backend.bin,
        args: [
          "thumbnail",
          sourcePath,
          outPath + opts,
          String(maxEdge),
          "--height",
          String(maxEdge),
          "--size",
          "down",
        ],
      },
    ]
  }

  if (backend.name === "magick" || backend.name === "convert") {
    // The `>` suffix on -resize means "only shrink".
    const formatArgs =
      format === "webp"
        ? ["-define", "webp:method=4"]
        : ["-sampling-factor", "4:2:0", "-interlace", "none"]
    return [
      {
        bin: backend.bin,
        args: [
          sourcePath,
          "-auto-orient",
          "-resize",
          `${maxEdge}x${maxEdge}>`,
          "-quality",
          String(q),
          ...formatArgs,
          "+profile",
          "!icc,*",
          outPath,
        ],
      },
    ]
  }

  // sips. Two things it will not do for us:
  //   - bake EXIF orientation (verified: -Z leaves the pixels and the tag
  //     alone), so rotate explicitly first when the source is not upright;
  //   - refuse to upscale (verified: -Z 4000 on a 2400px source produced
  //     4000px), so only pass -Z when the image is actually too big.
  /** @type {Types.BackendCommand[]} */
  const commands = []
  const orientArgs = SIPS_ORIENT_ARGS[options.orientation ?? 1]
  let input = sourcePath
  if (orientArgs) {
    commands.push({ bin: backend.bin, args: [...orientArgs, sourcePath, "--out", options.midPath] })
    input = options.midPath
  }
  const longestEdge = Math.max(options.sourceWidth ?? 0, options.sourceHeight ?? 0)
  const needsResize = longestEdge === 0 || longestEdge > maxEdge
  commands.push({
    bin: backend.bin,
    args: [
      ...(needsResize ? ["-Z", String(maxEdge)] : []),
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      String(q),
      input,
      "--out",
      outPath,
    ],
  })
  return commands
}

/** @type {Types.buildPosterCommand} */
export function buildPosterCommand(backend, options) {
  // Fast seek (-ss before -i) to one frame, at native size, metadata dropped.
  // The still is then fed through the normal image resize path, so the poster
  // shares the same cap enforcement and strip as every other variant.
  return {
    bin: backend.bin,
    args: [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(options.atSeconds),
      "-i",
      options.sourcePath,
      "-frames:v",
      "1",
      "-map_metadata",
      "-1",
      "-f",
      "image2",
      "-c:v",
      "png",
      options.outPath,
    ],
  }
}

/** @type {Types.describeBackends} */
export function describeBackends(backends) {
  /** @type {Types.BackendNote[]} */
  const notes = []
  if (backends.image) {
    const caps = []
    if (!backends.image.canWebp) caps.push("JPEG output only, no WebP")
    if (!backends.image.autoOrients) caps.push("rotation applied explicitly")
    if (backends.image.name === "sips") {
      // Measured: sips display variants run ~3x the size of vips/magick output
      // at the same nominal quality, and it reads HEIC orientation differently.
      caps.push("larger files than vips/magick — `brew install vips` is worth it")
    }
    notes.push({
      level: "ok",
      message:
        `Images: ${backends.image.name} (${backends.image.version})` +
        (caps.length ? ` — ${caps.join(", ")}` : ""),
    })
  } else {
    notes.push({ level: "error", message: imageBackendInstallHint() })
  }
  if (backends.video) {
    notes.push({ level: "ok", message: `Videos: ${backends.video.name} (${backends.video.version})` })
  } else {
    notes.push({ level: "warn", message: videoBackendInstallHint() })
  }
  return notes
}
