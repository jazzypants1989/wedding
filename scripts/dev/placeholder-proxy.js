#!/usr/bin/env node
/** @file CLI: the admin UI with every photograph replaced by a drawing.
 *
 *  The Faces tab can't be screenshotted for design notes, because every pixel of
 *  it is somebody's face. This sits in front of a real server on another port and
 *  answers every `/media/*` request with a synthesized PNG of the SAME dimensions
 *  as the real variant, with a cartoon face drawn at each real face box. HTML, CSS,
 *  the API, cookies and POSTs pass through unchanged, so layout, counts, names and
 *  crop framing are what the real tab does.
 *
 *  **Anything else photographic is blocked too.** A JPEG, WebP, HEIC or video from
 *  any other path, such as the couple's photo on the landing page, gets a drawing
 *  instead. PNG and SVG pass, because they are this app's generated assets.
 *
 *  Nothing is modified: no file is written and no row is touched. It reads
 *  photographs only in the sense that code reads pixels. The bytes are fetched to
 *  learn the width and height and are then dropped.
 *
 *  Verify with `scripts/dev/leak-check.js`, and use a browser profile with an empty
 *  cache. A cache holding real photographs replays them whatever this proxy does.
 */
/** @import * as Types from './types.js' */
/** @import { IncomingMessage, ServerResponse } from 'node:http' */

import http from "node:http"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { readImageHeader } from "../../core/image-meta.js"
import { encodePng } from "../vision/png-write.js"

const USAGE = `Usage: node scripts/dev/placeholder-proxy.js --upstream HOST:PORT [options]

  --upstream HOST:PORT   The real server. Required.
  --port N               Port to listen on. Default 3002.
  --database PATH        SQLite file to read face boxes from. Without it, placeholders
                         are plain backdrops.`

/** Size of the drawing that stands in for a video or anything undecodable. */
const FALLBACK_WIDTH = 640
const FALLBACK_HEIGHT = 360

/** @typedef {[number, number, number]} Rgb */
/** @typedef {{ x: number, y: number, w: number, h: number, landmarks: number[] | null }} DrawnFace */
/** @typedef {{ ow: number, oh: number, faces: DrawnFace[] }} FaceEntry */

/** @type {Types.parseProxyArgs} */
export function parseProxyArgs(argv) {
  /** @type {Types.PlaceholderProxyArgs} */
  const args = { port: 3002, upstream: "", database: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--port") args.port = Number(argv[++i])
    else if (arg === "--upstream") args.upstream = argv[++i] ?? ""
    else if (arg === "--database") args.database = argv[++i] ?? null
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (args.upstream.length === 0) throw new Error("--upstream is required")
  return args
}

/** @type {Types.parseUpstream} */
export function parseUpstream(upstream) {
  const colon = upstream.lastIndexOf(":")
  if (colon === -1) return { host: upstream, port: 80 }
  return { host: upstream.slice(0, colon), port: Number(upstream.slice(colon + 1)) }
}

/** @type {Types.isPhotographicType} */
export function isPhotographicType(contentType) {
  const type = contentType.split(";")[0].trim().toLowerCase()
  if (type.startsWith("video/")) return true
  if (!type.startsWith("image/")) return false
  return type !== "image/png" && type !== "image/svg+xml" && type !== "image/x-icon"
}

// ---- drawing ---------------------------------------------------------------

/**
 * A small stable string hash: the seed for one photograph's palette. FNV-1a.
 * @param {string} str
 */
function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * @param {number} h degrees
 * @param {number} s 0-1
 * @param {number} l 0-1
 * @returns {Rgb}
 */
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  /** @type {Rgb} */
  let rgb = [c, 0, x]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  const m = l - c / 2
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ]
}

/** A flat RGB buffer plus its dimensions: the shape encodePng takes. */
class Canvas {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    this.width = width
    this.height = height
    this.rgb = Buffer.alloc(width * height * 3)
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {Rgb} color
   * @param {number} alpha
   */
  blend(x, y, color, alpha) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 3
    if (alpha >= 1) {
      this.rgb[i] = color[0]
      this.rgb[i + 1] = color[1]
      this.rgb[i + 2] = color[2]
      return
    }
    const inv = 1 - alpha
    this.rgb[i] = Math.round(this.rgb[i] * inv + color[0] * alpha)
    this.rgb[i + 1] = Math.round(this.rgb[i + 1] * inv + color[1] * alpha)
    this.rgb[i + 2] = Math.round(this.rgb[i + 2] * inv + color[2] * alpha)
  }

  /**
   * @param {number} cx
   * @param {number} cy
   * @param {number} rx
   * @param {number} ry
   * @param {Rgb} color
   */
  ellipse(cx, cy, rx, ry, color) {
    if (rx <= 0 || ry <= 0) return
    const x0 = Math.max(0, Math.floor(cx - rx))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx))
    const y0 = Math.max(0, Math.floor(cy - ry))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx
        const dy = (y + 0.5 - cy) / ry
        if (dx * dx + dy * dy <= 1) this.blend(x, y, color, 1)
      }
    }
  }
}

/**
 * A soft two-tone wash with a faint grid, so a crop landing between faces still
 * reads as an image rather than a broken one.
 * @param {Canvas} canvas
 * @param {number} seed
 */
function paintBackground(canvas, seed) {
  const hue = seed % 360
  const top = hsl(hue, 0.42, 0.78)
  const bottom = hsl((hue + 45) % 360, 0.38, 0.52)
  for (let y = 0; y < canvas.height; y++) {
    const t = y / Math.max(1, canvas.height - 1)
    /** @type {Rgb} */
    const row = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
    ]
    for (let x = 0; x < canvas.width; x++) canvas.blend(x, y, row, 1)
  }
  const step = Math.max(24, Math.round(Math.max(canvas.width, canvas.height) / 18))
  /** @type {Rgb} */
  const ink = [255, 255, 255]
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (x % step === 0 || y % step === 0) canvas.blend(x, y, ink, 0.14)
    }
  }
}

/**
 * One cartoon face at a real face box. Landmarks are used when present, so the
 * chip's framing matches what the real tab produces.
 * @param {Canvas} canvas
 * @param {DrawnFace} face
 * @param {number} scale original-pixel box to this canvas
 * @param {number} seed
 */
function paintFace(canvas, face, scale, seed) {
  const x = face.x * scale
  const y = face.y * scale
  const w = face.w * scale
  const h = face.h * scale
  if (w < 2 || h < 2) return

  const cx = x + w / 2
  const cy = y + h / 2
  const hue = (seed * 37) % 360
  const skin = hsl(hue, 0.55, 0.74)
  const shade = hsl(hue, 0.5, 0.6)
  const ink = hsl(hue, 0.6, 0.22)

  // Head, with a rim so the box edge is legible in a tight crop.
  canvas.ellipse(cx, cy, w * 0.54, h * 0.6, shade)
  canvas.ellipse(cx, cy, w * 0.48, h * 0.54, skin)

  const lm = face.landmarks
  /** @param {number} i */
  const pt = (i) => (lm ? { x: lm[i * 2] * scale, y: lm[i * 2 + 1] * scale } : null)
  const leftEye = pt(0) ?? { x: cx - w * 0.19, y: cy - h * 0.1 }
  const rightEye = pt(1) ?? { x: cx + w * 0.19, y: cy - h * 0.1 }
  const nose = pt(2) ?? { x: cx, y: cy + h * 0.05 }
  const mouthL = pt(3) ?? { x: cx - w * 0.14, y: cy + h * 0.22 }
  const mouthR = pt(4) ?? { x: cx + w * 0.14, y: cy + h * 0.22 }

  const eyeR = Math.max(1, w * 0.055)
  canvas.ellipse(leftEye.x, leftEye.y, eyeR, eyeR, ink)
  canvas.ellipse(rightEye.x, rightEye.y, eyeR, eyeR, ink)
  canvas.ellipse(nose.x, nose.y, Math.max(1, w * 0.03), Math.max(1, h * 0.05), shade)

  // A smile: sample the corner-to-corner line and sag it in the middle.
  const steps = Math.max(8, Math.round(Math.hypot(mouthR.x - mouthL.x, mouthR.y - mouthL.y)))
  const sag = h * 0.09
  const thick = Math.max(1, h * 0.022)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const mx = mouthL.x + (mouthR.x - mouthL.x) * t
    const my = mouthL.y + (mouthR.y - mouthL.y) * t + Math.sin(Math.PI * t) * sag
    canvas.ellipse(mx, my, thick, thick, ink)
  }
}

/**
 * @param {string} seedText
 * @param {number} width
 * @param {number} height
 * @param {FaceEntry} entry
 */
function drawPlaceholder(seedText, width, height, entry) {
  const seed = hashString(seedText)
  const canvas = new Canvas(width, height)
  paintBackground(canvas, seed)
  // Boxes are in ORIGINAL pixels and this variant is a scaled copy of that frame,
  // so one factor maps between them, as positionFaceChipImage assumes client-side.
  const scale = entry.ow > 0 ? width / entry.ow : 1
  for (const face of entry.faces) paintFace(canvas, face, scale, seed)
  return encodePng({ width, height, rgb: canvas.rgb })
}

/**
 * @param {ServerResponse} res
 * @param {IncomingMessage} req
 * @param {Buffer} png
 */
function sendPng(res, req, png) {
  res.writeHead(200, {
    "content-type": "image/png",
    "content-length": String(png.length),
    "cache-control": "no-store",
  })
  if (req.method === "HEAD") res.end()
  else res.end(png)
}

// ---- the proxy -------------------------------------------------------------

/** @type {Types.createPlaceholderProxy} */
export function createPlaceholderProxy({ upstreamHost, upstreamPort, db }) {
  /** @type {Map<string, FaceEntry>} */
  const faceCache = new Map()
  /** @type {Map<string, Buffer>} */
  const pngCache = new Map()

  /**
   * @param {string} fileKey
   * @returns {FaceEntry}
   */
  function facesFor(fileKey) {
    const cached = faceCache.get(fileKey)
    if (cached) return cached
    /** @type {FaceEntry} */
    const entry = { ow: 0, oh: 0, faces: [] }
    if (db) {
      const rows = /** @type {Array<Record<string, number | string | null>>} */ (
        /** @type {unknown} */ (
          db
            .prepare(
              `SELECT m.width AS ow, m.height AS oh,
                      f.bbox_x AS x, f.bbox_y AS y, f.bbox_w AS w, f.bbox_h AS h,
                      f.landmarks AS lm
                 FROM media m
                 LEFT JOIN media_faces f ON f.media_id = m.id AND f.deleted_at IS NULL
                WHERE m.file_key = ?`,
            )
            .all(fileKey)
        )
      )
      for (const row of rows) {
        entry.ow = Number(row.ow ?? 0)
        entry.oh = Number(row.oh ?? 0)
        if (row.x === null) continue
        /** @type {number[] | null} */
        let landmarks = null
        if (typeof row.lm === "string") {
          try {
            const parsed = JSON.parse(row.lm)
            if (Array.isArray(parsed) && parsed.length >= 10) landmarks = parsed
          } catch {
            landmarks = null
          }
        }
        entry.faces.push({
          x: Number(row.x),
          y: Number(row.y),
          w: Number(row.w),
          h: Number(row.h),
          landmarks,
        })
      }
    }
    faceCache.set(fileKey, entry)
    return entry
  }

  /**
   * Doesn't forward conditional headers: a 304 has no body, and the body is the
   * only way to learn the dimensions.
   * @param {string} urlPath
   * @param {string | undefined} cookie
   * @returns {Promise<{ status: number, body: Buffer }>}
   */
  function fetchUpstream(urlPath, cookie) {
    return new Promise((resolve, reject) => {
      /** @type {Record<string, string>} */
      const headers = {
        host: `${upstreamHost}:${upstreamPort}`,
        "accept-encoding": "identity",
      }
      if (cookie) headers.cookie = cookie
      const req = http.request(
        { host: upstreamHost, port: upstreamPort, path: urlPath, method: "GET", headers },
        (res) => {
          /** @type {Buffer[]} */
          const chunks = []
          res.on("data", (/** @type {Buffer} */ chunk) => chunks.push(chunk))
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 500, body: Buffer.concat(chunks) })
          })
        },
      )
      req.on("error", reject)
      req.end()
    })
  }

  /**
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  async function servePlaceholder(req, res) {
    const urlPath = (req.url ?? "").split("?")[0]
    const parts = urlPath.split("/") // ["", "media", fileKey, variant]
    const fileKey = parts[2] ?? ""
    const cacheKey = `${fileKey}/${parts[3] ?? "display"}`

    let png = pngCache.get(cacheKey)
    if (!png) {
      const upstream = await fetchUpstream(urlPath, req.headers.cookie)
      if (upstream.status >= 400) {
        // A 404 stays a 404: the point is a faithful tab.
        res.writeHead(upstream.status, { "content-type": "text/plain" })
        res.end(`placeholder-proxy: upstream said ${upstream.status}`)
        return
      }
      const header = readImageHeader(upstream.body)
      // A video gets a card rather than a real frame. It won't play, and that is
      // the correct trade here.
      const width = header ? header.width : FALLBACK_WIDTH
      const height = header ? header.height : FALLBACK_HEIGHT
      png = drawPlaceholder(fileKey, width, height, facesFor(fileKey))
      pngCache.set(cacheKey, png)
    }
    sendPng(res, req, png)
  }

  /**
   * Everything else, verbatim, unless the response turns out to be photographic.
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  function passThrough(req, res) {
    /** @type {Record<string, string | string[]>} */
    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers[name] = value
    }
    headers.host = `${upstreamHost}:${upstreamPort}`
    const upstream = http.request(
      { host: upstreamHost, port: upstreamPort, path: req.url, method: req.method, headers },
      (up) => {
        if (isPhotographicType(String(up.headers["content-type"] ?? ""))) {
          up.resume()
          const seedText = req.url ?? ""
          const blank = { ow: 0, oh: 0, faces: [] }
          const png = drawPlaceholder(seedText, FALLBACK_WIDTH, FALLBACK_HEIGHT, blank)
          sendPng(res, req, png)
          return
        }
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" })
      res.end(`placeholder-proxy: upstream unreachable (${err.message})`)
    })
    req.pipe(upstream)
  }

  return http.createServer((req, res) => {
    const urlPath = (req.url ?? "").split("?")[0]
    if (urlPath.startsWith("/media/")) {
      servePlaceholder(req, res).catch((/** @type {Error} */ err) => {
        res.writeHead(502, { "content-type": "text/plain" })
        res.end(`placeholder-proxy: ${err.message}`)
      })
      return
    }
    passThrough(req, res)
  })
}

function main() {
  const args = parseProxyArgs(process.argv.slice(2))
  const { host, port } = parseUpstream(args.upstream)
  const db = args.database ? new DatabaseSync(args.database, { readOnly: true }) : null
  const server = createPlaceholderProxy({ upstreamHost: host, upstreamPort: port, db })
  server.listen(args.port, () => {
    console.log(`placeholder proxy  http://localhost:${args.port}  ->  ${host}:${port}`)
    console.log(`face boxes         ${args.database ? "from the database" : "none: plain backdrops"}`)
    console.log(`check it with      scripts/dev/leak-check.js --port ${args.port}`)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(USAGE)
    process.exitCode = 1
  }
}
