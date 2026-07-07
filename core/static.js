/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { addSecurityHeaders } from "./http.js"
import { SERVER } from "../types.js"

/** @type {Types.MimeTypes} */
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
}

/** @type {Types.CacheControl} */
const CACHE_CONTROL = {
  ".html": "no-cache", // Always validate HTML
  ".css": "public, max-age=31536000, immutable",
  ".js": "public, max-age=31536000, immutable",
  ".mjs": "public, max-age=31536000, immutable",
  ".png": "public, max-age=31536000, immutable",
  ".jpg": "public, max-age=31536000, immutable",
  ".jpeg": "public, max-age=31536000, immutable",
  ".gif": "public, max-age=31536000, immutable",
  ".webp": "public, max-age=31536000, immutable",
  ".svg": "public, max-age=31536000, immutable",
  ".ico": "public, max-age=31536000, immutable",
  ".woff": "public, max-age=31536000, immutable",
  ".woff2": "public, max-age=31536000, immutable",
  ".ttf": "public, max-age=31536000, immutable",
}

const THEME_INIT_TAG = '<script src="/components/theme-init.js"></script>'
const THEME_INIT_CODE = 'try{document.documentElement.dataset.theme=localStorage.getItem("theme")||"light"}catch{}'
const THEME_INIT_HASH = crypto.createHash("sha256").update(THEME_INIT_CODE).digest("base64")

const publicDir = path.join(import.meta.dirname, "..", "public")

const INLINE_CSS_PATHS = ['/styles/tokens.css', '/styles/layout.css', '/styles/components.css']
let inlineCssContent = ''
for (const cssUrl of INLINE_CSS_PATHS) {
  inlineCssContent += fs.readFileSync(path.join(publicDir, cssUrl.slice(1)), 'utf-8')
}
const INLINE_CSS_STYLE = '<style>' + inlineCssContent + '</style>'
const INLINE_CSS_HASH = crypto.createHash("sha256").update(inlineCssContent).digest("base64")
const CSS_LINK_TAGS = INLINE_CSS_PATHS.map(url => '<link rel="stylesheet" href="' + url + '">')

const CSP_DIRECTIVES = [
  "style-src 'self' 'sha256-" + INLINE_CSS_HASH + "'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src https://www.honeyfund.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
]

const HASH_CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-" + THEME_INIT_HASH + "'",
  ...CSP_DIRECTIVES,
].join("; ")

/** @param {string} nonce */
function buildNonceCsp(nonce) {
  return [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "'",
    ...CSP_DIRECTIVES,
  ].join("; ")
}

const COMPRESSIBLE_EXTS = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".txt"])

/** @type {Map<string, number>} urlPath → mtime, for cache-busting query params */
const versionMap = new Map()

/** @type {Map<string, string>} fullPath → ETag, for conditional requests */
const etagCache = new Map()

/** @type {Map<string, Buffer>} fullPath → gzipped content, for pre-compressed static files */
const gzipCache = new Map()

const bustExts = Object.keys(CACHE_CONTROL).filter((ext) => ext !== ".html")
for (const file of fs.readdirSync(publicDir, { recursive: true })) {
  const relPath = String(file)
  const ext = path.extname(relPath).toLowerCase()
  try {
    const fullPath = path.join(publicDir, relPath)
    const stat = fs.statSync(fullPath)
    if (!stat.isFile()) continue
    const urlPath = "/" + relPath.split(path.sep).join("/")
    if (bustExts.includes(ext)) {
      versionMap.set(urlPath, Math.floor(stat.mtimeMs))
    }
    // Pre-compute ETags for non-HTML files (based on mtime + size)
    if (ext !== ".html") {
      etagCache.set(fullPath, '"' + stat.mtimeMs.toString(36) + "-" + stat.size.toString(36) + '"')
    }
    // Pre-compress text-based static files (skip HTML — it gets cache busters injected)
    if (ext !== ".html" && COMPRESSIBLE_EXTS.has(ext) && stat.size > 1024) {
      const content = fs.readFileSync(fullPath)
      gzipCache.set(fullPath, gzipSync(content))
    }
  } catch {
    console.log(`Failed to stat file: ${relPath}`)
  }
}

/** @type {Types.addCacheBusters} */
function addCacheBusters(html) {
  const attrs = ['href="', 'src="', 'srcset="']
  let result = html

  for (const attr of attrs) {
    let output = ""
    let remaining = result

    while (true) {
      const idx = remaining.indexOf(attr)
      if (idx === -1) {
        output += remaining
        break
      }

      output += remaining.slice(0, idx + attr.length)
      remaining = remaining.slice(idx + attr.length)

      const closeIdx = remaining.indexOf('"')
      if (closeIdx === -1) {
        output += remaining
        break
      }

      const url = remaining.slice(0, closeIdx)
      remaining = remaining.slice(closeIdx)

      const version = versionMap.get(url)
      if (version !== undefined && !url.startsWith("/fonts/")) {
        output += url + "?v=" + version
        continue
      }

      output += url
    }

    result = output
  }

  return result
}

/** @type {Types.serveStatic} */
export async function serveStatic(req, res) {
  let urlPath = (req.url ?? "/").split("?")[0]

  // Strip trailing slash (except root)
  if (urlPath.length > 1 && urlPath.endsWith("/")) {
    urlPath = urlPath.slice(0, -1)
  }

  let normalizedPath
  if (urlPath === "/") {
    // Root serves the home page
    normalizedPath = path.join(publicDir, "pages", "index.html")
  } else if (!path.extname(urlPath)) {
    // Paths without extensions are page routes (e.g., /rsvp, /admin)
    normalizedPath = path.join(
      publicDir,
      "pages",
      path.normalize(urlPath),
      "index.html",
    )
  } else {
    // Paths with extensions are served directly from public/
    normalizedPath = path.join(publicDir, path.normalize(urlPath))
  }

  // Prevent path traversal — ensure resolved path stays within publicDir
  if (
    !normalizedPath.startsWith(publicDir + path.sep) &&
    normalizedPath !== publicDir
  ) {
    res.writeHead(403, { "Content-Type": "text/plain" })
    res.end("Forbidden")
    return true
  }

  const ext = path.extname(normalizedPath).toLowerCase()
  const contentType = MIME_TYPES[ext] || "application/octet-stream"
  const cacheControl = CACHE_CONTROL[ext] || "no-cache"

  /** @type {Types.ResponseHeaders} */
  const headers = {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": cacheControl,
  }

  const nonce = SERVER.cspNonce && ext === ".html" ? crypto.randomBytes(16).toString("base64") : ""

  if (ext === ".html") {
    headers["Content-Security-Policy"] = SERVER.cspNonce ? buildNonceCsp(nonce) : HASH_CSP
    headers["X-Frame-Options"] = "DENY"
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    addSecurityHeaders(headers)
  }

  try {
    const content = await fs.promises.readFile(normalizedPath)
    const acceptEncoding = req.headers["accept-encoding"] || ""
    const clientAcceptsGzip = typeof acceptEncoding === "string" && acceptEncoding.includes("gzip")

    // Prepare response body
    let body
    if (ext === ".html") {
      let html = content.toString("utf-8")
      if (SERVER.cspNonce) {
        html = html.replaceAll(THEME_INIT_TAG, '<script nonce="' + nonce + '">' + THEME_INIT_CODE + '</script>')
      } else {
        html = html.replaceAll(THEME_INIT_TAG, '<script>' + THEME_INIT_CODE + '</script>')
      }
      html = html.replaceAll(CSS_LINK_TAGS[0], INLINE_CSS_STYLE)
      html = html.replaceAll(CSS_LINK_TAGS[1], '')
      html = html.replaceAll(CSS_LINK_TAGS[2], '')
      html = addCacheBusters(html)
      body = html
      // Cache ETag + gzip in hash mode (nonce mode can't cache — content changes per request)
      if (!SERVER.cspNonce && !etagCache.has(normalizedPath)) {
        const hash = crypto.createHash("sha256").update(html).digest("hex").slice(0, 12)
        etagCache.set(normalizedPath, '"h-' + hash + '"')
        if (Buffer.byteLength(html) > 1024) {
          gzipCache.set(normalizedPath, gzipSync(Buffer.from(html)))
        }
      }
    } else {
      body = content
    }

    // Conditional request handling (skip in nonce mode — content changes per request)
    if (!(SERVER.cspNonce && ext === ".html")) {
      const etag = etagCache.get(normalizedPath)
      if (etag) {
        headers["ETag"] = etag
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, headers)
          res.end()
          return true
        }
      }
    }

    // Serve gzipped version if available and client supports it
    if (clientAcceptsGzip) {
      let gzipped
      if (SERVER.cspNonce && ext === ".html") {
        const buf = Buffer.from(/** @type {string} */ (body))
        gzipped = buf.length > 1024 ? gzipSync(buf) : null
      } else {
        gzipped = gzipCache.get(normalizedPath)
      }
      if (gzipped) {
        headers["Content-Encoding"] = "gzip"
        headers["Vary"] = "Accept-Encoding"
        headers["Content-Length"] = gzipped.length
        res.writeHead(200, headers)
        res.end(gzipped)
        return true
      }
    }
    res.writeHead(200, headers)
    res.end(body)
    return true
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      console.warn(`Static file not found: ${normalizedPath}`)
      return false
    }
    console.error(
      `Error reading file ${normalizedPath}:`,
      err instanceof Error ? err.message : String(err),
    )
    res.writeHead(500, { "Content-Type": "text/plain" })
    res.end("Server error")
    return true
  }
}
