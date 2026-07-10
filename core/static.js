/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { addSecurityHeaders } from "./http.js"
import { escapeHtml } from "./utils.js"
import { SERVER } from "../types.js"
import { formatWeddingDate } from "../content.js"
import { getContent, getMode, resolveSiteContent } from "./site-content.js"

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

// Assets are versioned by the `?v=<mtime>` cache-busters injected into HTML
// (see addCacheBusters) and validated by ETag/Last-Modified, so we deliberately
// avoid `immutable` — it would pin a stale asset for the full max-age even after
// a deploy. `max-age=0, must-revalidate` makes every load a cheap conditional
// (304 when unchanged); bump max-age (e.g. 300) to trade a little staleness for
// fewer revalidation round-trips.
const ASSET_CACHE_CONTROL = "public, max-age=0, must-revalidate"

/** @type {Types.CacheControl} */
const CACHE_CONTROL = {
  ".html": "no-cache", // Always validate HTML
  ".css": ASSET_CACHE_CONTROL,
  ".js": ASSET_CACHE_CONTROL,
  ".mjs": ASSET_CACHE_CONTROL,
  ".png": ASSET_CACHE_CONTROL,
  ".jpg": ASSET_CACHE_CONTROL,
  ".jpeg": ASSET_CACHE_CONTROL,
  ".gif": ASSET_CACHE_CONTROL,
  ".webp": ASSET_CACHE_CONTROL,
  ".svg": ASSET_CACHE_CONTROL,
  ".ico": ASSET_CACHE_CONTROL,
  ".woff": ASSET_CACHE_CONTROL,
  ".woff2": ASSET_CACHE_CONTROL,
  ".ttf": ASSET_CACHE_CONTROL,
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
  // blob: + media-src for upload-tray previews (URL.createObjectURL) and video
  // poster extraction (Phase 3 media pipeline).
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
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

// Dev-only page routes (first path segment) — 404'd in production so internal
// tooling isn't publicly routable on the live site. They still serve in dev.
const DEV_ONLY_PAGES = new Set(["studio"])

/** @type {Map<string, number>} urlPath → mtime, for cache-busting query params */
const versionMap = new Map()

/** @type {Map<string, string>} fullPath → ETag, for conditional requests */
const etagCache = new Map()

/** @type {Map<string, string>} fullPath → Last-Modified (HTTP date), for conditional requests */
const lastModifiedCache = new Map()

/** @type {Map<string, Buffer>} fullPath → gzipped content, for pre-compressed static files */
const gzipCache = new Map()

/** @type {Set<string>} normalizedPaths of templated HTML memoized in etag/gzip caches.
 *  Tracked so a content edit (onContentChanged) can evict exactly those entries. */
const templatedHtmlPaths = new Set()

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
    // Pre-compute ETags + Last-Modified for non-HTML files (based on mtime + size)
    if (ext !== ".html") {
      etagCache.set(fullPath, '"' + stat.mtimeMs.toString(36) + "-" + stat.size.toString(36) + '"')
      lastModifiedCache.set(fullPath, new Date(stat.mtimeMs).toUTCString())
    }
    // Pre-compress text-based static files (skip HTML — it gets cache busters injected)
    if (ext !== ".html" && COMPRESSIBLE_EXTS.has(ext) && stat.size > 1024) {
      const content = fs.readFileSync(fullPath)
      gzipCache.set(fullPath, gzipSync(content))
    }
  } catch {
    console.warn(`Failed to stat file: ${relPath}`)
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

// ─── Content templating ──────────────────────────────────────────────────
// The static HTML carries {{tokens}} that we fill from the effective site
// content at serve time (no-regex string replacement). Content + mode are
// resolved into module state and rebuilt only at boot and on admin save
// (onContentChanged), so templated HTML stays deterministic per path between
// edits — the ETag/gzip memoization below stays valid. On save we rebuild the
// tokens AND evict the memoized HTML so the next serve re-templates.
/** @type {ReturnType<typeof getMode>} */
let MODE = getMode()
/** @type {Record<string, string>} token name → replacement (mode + effective content) */
let CONTENT_TOKENS = {}

// Tokens whose value is trusted inline HTML and injected raw (see content.js).
// Everything else is escaped before substitution so a "/&/< in admin-edited
// content (e.g. a registry URL with ?a=1&b=2) can't break an attribute or tag.
const RAW_TOKENS = new Set(["copy.welcomeIntro"])

function rebuildContentTokens() {
  const content = getContent()
  MODE = getMode()
  const activeCopy = content.copy[MODE]
  CONTENT_TOKENS = {
    "couple.display": content.couple.display,
    "couple.first": content.couple.first,
    "couple.monogram": content.couple.monogram,
    "couple.metaNames": content.couple.fullNames.join(" and "),
    "weddingDate": formatWeddingDate(content.weddingDate),
    "weddingDateISO": content.weddingDate,
    "location": content.location,
    // Effect theme id for <html data-effect-theme>. Literal fallback keeps the
    // server/browser layer boundary (can't import public/effects/themes.js);
    // must match DEFAULT_THEME_ID there.
    "effectTheme": content.theme || "mermaid-disco",
    "registry.url": content.registry.url,
    "registry.label": content.registry.label,
    "mode": MODE,
    "copy.welcomeHeading": activeCopy.welcomeHeading,
    "copy.welcomeIntro": activeCopy.welcomeIntro,
  }
}
rebuildContentTokens()

/**
 * Re-resolve the effective site content after an admin edit: pull the fresh
 * override, rebuild the {{token}} map, and evict every memoized templated-HTML
 * entry so the next serve re-templates. Also called once at boot (server.js)
 * to pick up a stored override before the first request.
 * @returns {void}
 */
export function onContentChanged() {
  resolveSiteContent()
  rebuildContentTokens()
  for (const p of templatedHtmlPaths) {
    etagCache.delete(p)
    gzipCache.delete(p)
  }
  templatedHtmlPaths.clear()
}

const THEME_TOGGLE_LI =
  '<li><button class="theme-toggle nav-link" type="button" aria-label="Switch to dark mode">' +
  '<span class="theme-icon-sun" aria-hidden="true"></span>' +
  '<span class="theme-icon-moon" aria-hidden="true"></span></button></li>'

const GITHUB_SVG_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"

/** @param {string} url @returns {string} */
function githubLi(url) {
  return (
    '<li><a href="' + escapeHtml(url) + '" class="nav-link" target="_blank" rel="noopener noreferrer" aria-label="GitHub">' +
    '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
    '<path d="' + GITHUB_SVG_PATH + '" /></svg></a></li>'
  )
}

/**
 * Render the `<li>` list for a nav variant from CONTENT.nav[MODE]. Anchor links
 * are prefixed with "/" off the home page; the current page is marked active.
 * @param {string} currentPath request path (e.g. "/", "/rsvp")
 * @param {"desktop" | "mobile" | "footer"} variant
 * @returns {string}
 */
function renderNav(currentPath, variant) {
  const content = getContent()
  const onHome = currentPath === "/"
  let items = ""
  for (const link of content.nav[MODE]) {
    const isAnchor = link.href.startsWith("#")
    const href = isAnchor && !onHome ? "/" + link.href : link.href
    const isActive = (link.href === "#" && onHome) || (!isAnchor && currentPath === link.href)
    const cls = isActive ? "nav-link nav-link-active" : "nav-link"
    const current = isActive ? ' aria-current="page"' : ""
    items += '<li><a href="' + escapeHtml(href) + '" class="' + cls + '"' + current + ">" + escapeHtml(link.label) + "</a></li>"
  }
  if (variant === "mobile") items += THEME_TOGGLE_LI
  if (variant === "footer" && content.footer.githubUrl) items += githubLi(content.footer.githubUrl)
  return items
}

/**
 * Fill content tokens in an HTML page. Scalar tokens are constant per boot;
 * nav tokens depend on the request path (active state + anchor prefixing).
 * @param {string} html
 * @param {string} currentPath
 * @returns {string}
 */
function applyContent(html, currentPath) {
  let result = html
  for (const key in CONTENT_TOKENS) {
    const value = RAW_TOKENS.has(key) ? CONTENT_TOKENS[key] : escapeHtml(CONTENT_TOKENS[key])
    result = result.replaceAll("{{" + key + "}}", value)
  }
  result = result.replaceAll("{{nav.desktop}}", renderNav(currentPath, "desktop"))
  result = result.replaceAll("{{nav.mobile}}", renderNav(currentPath, "mobile"))
  result = result.replaceAll("{{nav.footer}}", renderNav(currentPath, "footer"))
  return result
}

/** @type {Types.serveStatic} */
export async function serveStatic(req, res) {
  let urlPath = (req.url ?? "/").split("?")[0]

  // Strip trailing slash (except root)
  if (urlPath.length > 1 && urlPath.endsWith("/")) {
    urlPath = urlPath.slice(0, -1)
  }

  // Gate dev-only pages in production — 404 like any missing route.
  if (process.env.NODE_ENV === "production" && DEV_ONLY_PAGES.has(urlPath.split("/")[1])) {
    return false
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
      html = applyContent(html, urlPath)
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
        // Remember this templated-HTML entry so onContentChanged can evict it.
        templatedHtmlPaths.add(normalizedPath)
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
      // Last-Modified validator (non-HTML assets only — HTML is transformed per
      // request, so its mtime doesn't describe the served body).
      const lastModified = lastModifiedCache.get(normalizedPath)
      if (lastModified) {
        headers["Last-Modified"] = lastModified
        const ims = req.headers["if-modified-since"]
        if (typeof ims === "string") {
          const imsMs = Date.parse(ims)
          const lmMs = Date.parse(lastModified)
          // HTTP dates have second precision; a not-older client copy is fresh.
          if (!Number.isNaN(imsMs) && !Number.isNaN(lmMs) && imsMs >= lmMs) {
            res.writeHead(304, headers)
            res.end()
            return true
          }
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
