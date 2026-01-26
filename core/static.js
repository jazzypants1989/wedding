/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"
import { init, close } from "../db/connection.js"
import { cleanExpiredSessions } from "../db/sessions.js"
import { cleanAllExpired as cleanExpiredRateLimits } from "./rate-limit.js"
import { cleanOldLogs } from "./log.js"

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
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

init()
console.log("Database initialized")

cleanExpiredSessions()
cleanExpiredRateLimits()
cleanOldLogs()
console.log("Expired sessions, rate limits, and old audit logs cleaned")
setInterval(
  () => {
    cleanExpiredSessions()
    cleanExpiredRateLimits()
    cleanOldLogs()
  },
  60 * 60 * 1000,
).unref()

/** @type {Types.serveStatic} */
export async function serveStatic(req, res) {
  let urlPath = (req.url ?? "/").split("?")[0]

  // Strip trailing slash (except root)
  if (urlPath.length > 1 && urlPath.endsWith("/")) {
    urlPath = urlPath.slice(0, -1)
  }

  const publicDir = path.join(import.meta.dirname, "..", "public")

  let normalizedPath
  if (urlPath === "/") {
    // Root serves the home page
    normalizedPath = path.join(publicDir, "pages", "index.html")
  } else if (!path.extname(urlPath)) {
    // Paths without extensions are page routes (e.g., /rsvp, /admin)
    normalizedPath = path.join(publicDir, "pages", path.normalize(urlPath), "index.html")
  } else {
    // Paths with extensions are served directly from public/
    normalizedPath = path.join(publicDir, path.normalize(urlPath))
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
    headers["X-XSS-Protection"] = "1; mode=block"
    headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    if (process.env.NODE_ENV === "production") {
      headers["Strict-Transport-Security"] =
        "max-age=31536000; includeSubDomains"
    }
  }

  try {
    const content = await fs.promises.readFile(normalizedPath)
    res.writeHead(200, headers)
    res.end(content)
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
