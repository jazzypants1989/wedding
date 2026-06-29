/** @file Permissive static server for the change-review demo.
 *
 * The real app server (core/static.js) sends a strict CSP
 * (frame-ancestors 'none' + X-Frame-Options: DENY, hashed inline script/style)
 * that blocks same-origin iframes — so it cannot render the full-page / admin-
 * table before/after comparisons the demo needs. This is a SEPARATE, purpose-
 * built server with NO such headers. It never touches core/static.js or any
 * experiment file; it only serves files under public/ (including the gitignored
 * _demo snapshots) for local review.
 *
 * Two responsibilities beyond plain static serving:
 *   1. /snap/<buildId>/<refKey>/<path>  — serve a code snapshot and rewrite the
 *      absolute asset prefixes (/styles/, /effects/, …) so a snapshotted page's
 *      assets resolve to THAT snapshot instead of the live files.
 *   2. No CSP / no X-Frame-Options, so the dashboard can iframe everything.
 *
 * Zero dependencies, no regex (string methods only), Node 22+. Run with:
 *   node scripts/demo-server.js     (or `npm run demo`, which builds first)
 */

import http from "node:http"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.join(import.meta.dirname, "..")
const publicDir = path.join(repoRoot, "public")
const snapDir = path.join(publicDir, "_demo")
const PORT = Number(process.env.DEMO_PORT) || 5050

/** Absolute asset prefixes a snapshot page references; rewritten to its mount. */
const ASSET_PREFIXES = ["/styles/", "/effects/", "/images/", "/fonts/", "/pages/", "/components/"]

/** @type {Record<string, string>} */
const MIME = {
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
  ".md": "text/markdown; charset=utf-8",
}

/** @param {string} p */
function mimeFor(p) {
  const dot = p.lastIndexOf(".")
  const ext = dot === -1 ? "" : p.slice(dot).toLowerCase()
  return MIME[ext] || "application/octet-stream"
}

/** Rewrite absolute asset prefixes to the snapshot mount. No regex. @param {string} text @param {string} mountPrefix */
function rewriteAssets(text, mountPrefix) {
  let out = text
  for (const prefix of ASSET_PREFIXES) {
    out = out.split(prefix).join(mountPrefix + prefix)
  }
  return out
}

/** @param {import("node:http").ServerResponse} res @param {number} code @param {string} msg */
function fail(res, code, msg) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
  res.end(msg)
}

/**
 * Serve a file, rewriting absolute asset paths for .html/.css when a mountPrefix
 * is given (snapshot mount). Returns false if the file is missing/forbidden.
 * @param {import("node:http").ServerResponse} res
 * @param {string} filePath  absolute path on disk
 * @param {string} rootDir   directory the file must stay within (traversal guard)
 * @param {string | null} mountPrefix
 */
function serveFile(res, filePath, rootDir, mountPrefix) {
  const resolved = path.resolve(filePath)
  if (resolved !== rootDir && !resolved.startsWith(rootDir + path.sep)) {
    fail(res, 403, "Forbidden")
    return
  }
  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {
    return false
  }
  const target = stat.isDirectory() ? path.join(resolved, "index.html") : resolved
  const ext = target.slice(target.lastIndexOf(".")).toLowerCase()
  const rewritable = mountPrefix && (ext === ".html" || ext === ".css")

  let body
  try {
    body = rewritable ? fs.readFileSync(target, "utf-8") : fs.readFileSync(target)
  } catch {
    return false
  }
  if (rewritable) body = rewriteAssets(/** @type {string} */ (body), mountPrefix)

  res.writeHead(200, {
    "Content-Type": mimeFor(target),
    "Cache-Control": "no-store",
  })
  res.end(body)
  return true
}

const server = http.createServer((req, res) => {
  let pathname = "/"
  try {
    pathname = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0])
  } catch {
    fail(res, 400, "Bad request")
    return
  }

  if (pathname === "/") {
    serveFile(res, path.join(publicDir, "pages", "demo", "index.html"), publicDir, null)
    return
  }

  // Snapshot mount: /snap/<buildId>/<refKey>/<rest...>
  if (pathname.startsWith("/snap/")) {
    const parts = pathname.split("/").filter((s) => s.length)
    // parts = ["snap", buildId, refKey, ...rest]
    if (parts.length < 3) {
      fail(res, 404, "Not a snapshot path")
      return
    }
    const buildId = parts[1]
    const refKey = parts[2]
    const rest = parts.slice(3).join("/")
    const refRoot = path.join(snapDir, "snap-" + buildId, "refs", refKey, "public")
    const mountPrefix = "/snap/" + buildId + "/" + refKey
    const ok = serveFile(res, path.join(refRoot, rest), refRoot, mountPrefix)
    if (ok === false) fail(res, 404, "Snapshot file not found: " + rest)
    return
  }

  // Everything else: plain static serve from public/ (dashboard, _demo, assets).
  const ok = serveFile(res, path.join(publicDir, pathname), publicDir, null)
  if (ok === false) fail(res, 404, "Not found: " + pathname)
})

server.listen(PORT, () => {
  console.log("Change-review demo running at  http://localhost:" + PORT)
  console.log("(permissive CSP-free server — for local review only)")
})
