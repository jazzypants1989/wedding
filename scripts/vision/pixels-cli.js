/** @file Seam 1 of the vision pipeline, Node side: a photograph on disk becomes
 *  `{ width, height, rgb }` with orientation already applied.
 *
 *  Two decisions worth knowing before reading:
 *
 *  1. **PPM, not raw RGB.** The spec's first sketch was `magick ... RGB:-`,
 *     which is headerless — the caller has to *assume* the tool resized to what
 *     it asked for and emitted 8 bits per sample. That assumption is exactly
 *     what CLAUDE.md's "its output is never trusted" forbids. PPM costs a
 *     ~15-byte header and declares both, so the check below is real: a Q16
 *     ImageMagick writes maxval 65535 unless told otherwise, and this parser
 *     rejects it instead of quietly reading 16-bit samples as 8-bit garbage.
 *
 *  2. **No image decoder here.** Per CLAUDE.md's system-binaries rule, decoding
 *     is a dev-machine CLI's job. Nothing in this file is on the request path.
 *
 *  No regex, so the header parser is a charCode scan.
 */
/** @import * as Types from './types.js' */
/** @import * as LibTypes from '../lib/types.js' */

import fs from "node:fs"
import path from "node:path"

import { buildPixelCommand, runBinaryRaw } from "../lib/image-backend.js"
import { MediaImportError } from "../lib/media-errors.js"

/** Whitespace per the PNM spec: space, tab, LF, CR, form feed. */
const SPACE = 32
const TAB = 9
const LF = 10
const CR = 13
const FORM_FEED = 12
const HASH = 35

/**
 * Header scan ceiling. A valid PPM header is tens of bytes; vips adds one
 * comment line. Anything past this means we are walking pixel data because the
 * magic number lied, and should stop rather than scan 48MB for a token.
 */
const MAX_HEADER_BYTES = 1024

/** @param {number} code @returns {boolean} */
function isPpmSpace(code) {
  return code === SPACE || code === TAB || code === LF || code === CR || code === FORM_FEED
}

/**
 * Next whitespace-delimited header token, skipping `#` comments to end of line.
 * vips writes `#vips2ppm - <timestamp>` into every file it produces, so comment
 * handling is not a spec-completeness flourish; it is load-bearing on one of
 * the two backends.
 * @param {Buffer} buf @param {number} pos @param {number} limit
 * @returns {{ text: string, next: number } | null}
 */
function nextToken(buf, pos, limit) {
  let i = pos
  for (;;) {
    while (i < limit && isPpmSpace(buf[i])) i++
    if (i >= limit) return null
    if (buf[i] !== HASH) break
    while (i < limit && buf[i] !== LF) i++
  }
  const start = i
  while (i < limit && !isPpmSpace(buf[i]) && buf[i] !== HASH) i++
  return { text: buf.toString("latin1", start, i), next: i }
}

/**
 * Digits only. Deliberately not parseUint from image-backend.js: that one is
 * about tool stdout, this one is about a binary container, and coupling the two
 * would mean a change for one could silently retune the other.
 * @param {string} text @returns {number | null}
 */
function parseDigits(text) {
  if (text.length === 0 || text.length > 10) return null
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 48 || code > 57) return null
    n = n * 10 + (code - 48)
  }
  return n
}

/** @type {Types.parsePpm} */
export function parsePpm(buf, context = {}) {
  /** @param {string} message @returns {never} */
  const bad = (message) => {
    throw new MediaImportError("BACKEND_FAILED", `Bad PPM from the image backend: ${message}`, {
      file: context.file,
    })
  }

  const limit = Math.min(buf.length, MAX_HEADER_BYTES)
  const magic = nextToken(buf, 0, limit)
  // P6 is binary RGB. P3 is the ASCII variant, which no backend here emits and
  // which would need a whole second parser, so it is a refusal, not a TODO.
  if (!magic || magic.text !== "P6") bad(`expected magic "P6", got ${JSON.stringify(magic?.text)}`)

  const widthTok = nextToken(buf, magic.next, limit)
  const heightTok = widthTok && nextToken(buf, widthTok.next, limit)
  const maxTok = heightTok && nextToken(buf, heightTok.next, limit)
  if (!widthTok || !heightTok || !maxTok) bad("header ended before width/height/maxval")

  const width = parseDigits(widthTok.text)
  const height = parseDigits(heightTok.text)
  const maxval = parseDigits(maxTok.text)
  if (width === null || height === null || width <= 0 || height <= 0) {
    bad(`nonsense dimensions ${widthTok.text}x${heightTok.text}`)
  }
  if (maxval === null) bad(`unreadable maxval ${JSON.stringify(maxTok.text)}`)
  // The Q16 trap. ImageMagick built Q16-HDRI writes maxval 65535 from `ppm:-`
  // unless -depth 8 is passed, which is two bytes per sample big-endian. Read
  // as 8-bit that is not "slightly wrong", it is unrecognisable — and with a
  // headerless format there would be nothing here to catch it.
  if (maxval !== 255) {
    bad(`maxval ${maxval}, expected 255 — the backend emitted ${maxval > 255 ? 16 : 0}-bit samples`)
  }

  // Exactly one whitespace byte separates the header from the pixel data. It is
  // a single character by spec, not a run, because the first body byte may
  // itself be a whitespace value.
  const bodyStart = maxTok.next + 1
  if (!isPpmSpace(buf[maxTok.next])) bad("no whitespace after maxval")

  const expected = width * height * 3
  const available = buf.length - bodyStart
  if (available < expected) {
    bad(`truncated: ${available} body bytes for ${width}x${height} (need ${expected})`)
  }

  return {
    width,
    height,
    rgb: new Uint8Array(buf.buffer, buf.byteOffset + bodyStart, expected),
  }
}

/**
 * Link the source into the work dir under a boring name. Mirrors `linkSource`
 * in scripts/lib/media-variants.js, and for the same three reasons: ImageMagick
 * reads `[...]` in an INPUT path as a frame selector, so `IMG_[2].jpg` would
 * break; no backend sees spaces or newlines in a filename; and the scratch PPM
 * gets a predictable sibling. Always, not only for suspicious names — a branch
 * that runs on one photo in a thousand is a branch that is never tested.
 * @param {string} sourcePath @param {string} workDir @returns {string}
 */
function linkSource(sourcePath, workDir) {
  const ext = path.extname(sourcePath)
  const linkPath = path.join(workDir, "src" + ext)
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

/** @type {Types.readPixels} */
export async function readPixels(backend, sourcePath, options) {
  if (!backend.canRawPixels) {
    throw new MediaImportError(
      "NO_IMAGE_BACKEND",
      `${backend.name} cannot decode to pixels. Install vips or ImageMagick:\n` +
        "  brew install vips        (preferred — shrinks on load)\n" +
        "  brew install imagemagick",
      { file: sourcePath },
    )
  }

  const workDir = fs.mkdtempSync(path.join(options.scratchDir, "px-"))
  try {
    const linked = linkSource(sourcePath, workDir)
    const ppmPath = path.join(workDir, "out.ppm")
    const plan = buildPixelCommand(backend, {
      sourcePath: linked,
      maxEdge: options.maxEdge,
      ppmPath,
    })
    // canRawPixels already guarded this; the null check is for the type system
    // and for the day a backend is added to the table but not to the builder.
    if (!plan) throw new MediaImportError("NO_IMAGE_BACKEND", `${backend.name} has no pixel path.`)

    /** @type {Buffer} */
    let last = Buffer.alloc(0)
    for (const command of plan.commands) {
      const result = await runBinaryRaw(command.bin, command.args, {
        env: backend.childEnv,
        file: sourcePath,
        timeoutMs: options.timeoutMs,
      })
      last = result.stdout
    }

    const bytes = plan.readFrom === "file" ? fs.readFileSync(ppmPath) : last
    return parsePpm(bytes, { file: sourcePath })
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

/** @type {Types.boxDownsample} */
export function boxDownsample(image, maxEdge) {
  const longest = Math.max(image.width, image.height)
  // Never upscale. The detector wants faces inside its trained size band;
  // inventing pixels moves them out of it without adding information.
  if (longest <= maxEdge) return { image, scale: 1 }

  const scale = maxEdge / longest
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const out = new Uint8Array(width * height * 3)

  // Area average over the source rectangle each destination pixel covers.
  // Nearest-neighbour would alias, and aliasing at 1/2 scale is exactly the
  // frequency range small faces live in — a cheap way to lose recall and blame
  // the model for it.
  for (let dy = 0; dy < height; dy++) {
    const sy0 = Math.floor((dy * image.height) / height)
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * image.height) / height))
    for (let dx = 0; dx < width; dx++) {
      const sx0 = Math.floor((dx * image.width) / width)
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * image.width) / width))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        let si = (sy * image.width + sx0) * 3
        for (let sx = sx0; sx < sx1; sx++) {
          r += image.rgb[si]
          g += image.rgb[si + 1]
          b += image.rgb[si + 2]
          si += 3
          n++
        }
      }
      const di = (dy * width + dx) * 3
      out[di] = r / n
      out[di + 1] = g / n
      out[di + 2] = b / n
    }
  }

  // The true scale, not the requested one: rounding means width/height are not
  // exactly maxEdge, and decoding boxes back to source pixels with the wrong
  // factor is a slow drift that looks like a bad detector.
  return { image: { width, height, rgb: out }, scale: width / image.width }
}
