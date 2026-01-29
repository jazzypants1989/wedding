/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { addSecurityHeaders } from "./http.js"

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

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "frame-src https://www.honeyfund.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

const publicDir = path.join(import.meta.dirname, "..", "public")

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
      if (version !== undefined) {
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

  if (ext === ".html") {
    headers["Content-Security-Policy"] = CSP_HEADER
    headers["X-Frame-Options"] = "DENY"
    headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    addSecurityHeaders(headers)
  }

  try {
    const content = await fs.promises.readFile(normalizedPath)
    const acceptEncoding = req.headers["accept-encoding"] || ""
    const clientAcceptsGzip = typeof acceptEncoding === "string" && acceptEncoding.includes("gzip")

    // Prepare response body (HTML gets cache busters injected)
    let body
    if (ext === ".html") {
      const html = addCacheBusters(content.toString("utf-8"))
      body = html
      // Lazily compute and cache HTML ETag + gzip
      if (!etagCache.has(normalizedPath)) {
        const len = Buffer.byteLength(html)
        const hash = crypto.createHash("sha256").update(html).digest("hex").slice(0, 12)
        etagCache.set(normalizedPath, '"h-' + hash + '"')
        if (len > 1024) {
          gzipCache.set(normalizedPath, gzipSync(Buffer.from(html)))
        }
      }
    } else {
      body = content
    }

    // Conditional request handling
    const etag = etagCache.get(normalizedPath)
    if (etag) {
      headers["ETag"] = etag
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, headers)
        res.end()
        return true
      }
    }

    // Serve gzipped version if available and client supports it
    const gzipped = gzipCache.get(normalizedPath)
    if (gzipped && clientAcceptsGzip) {
      headers["Content-Encoding"] = "gzip"
      headers["Vary"] = "Accept-Encoding"
      headers["Content-Length"] = gzipped.length
      res.writeHead(200, headers)
      res.end(gzipped)
    } else {
      res.writeHead(200, headers)
      res.end(body)
    }
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
