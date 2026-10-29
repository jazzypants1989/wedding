#!/usr/bin/env node

/**
 * @file Static server for design prototypes. Dev-only; nothing here is served by
 * the app. Zero dependencies (node:http).
 *
 *   node prototypes/serve.js [port]        (default 4700)
 *
 * - `/<dir>/…` serves files from `prototypes/<dir>/…`.
 * - `/site/…` serves the real `public/…`, so a sketch can import the site's
 *   tokens, theme CSS, effect modules, effect-controls and the sound lab rather
 *   than copying them.
 * - A path with no file extension that does not exist falls back to the nearest
 *   `index.html` above it. That lets pushState prototypes (the admin IA ones)
 *   deep-link and reload, e.g. `/admin-today/faces/groups/f12` serves
 *   `prototypes/admin-today/index.html`.
 */

import http from "node:http"
import fs from "node:fs"
import path from "node:path"

const ROOT = import.meta.dirname
const SITE = path.join(ROOT, "..", "public")
const PORT = Number(process.argv[2]) || 4700

/** @type {Record<string, string>} */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".m4a": "audio/mp4",
  ".md": "text/plain; charset=utf-8",
}

/**
 * Resolve a URL path to a file inside `base`, or null if it escapes `base`.
 * @param {string} base @param {string} rel
 */
function inside(base, rel) {
  const full = path.resolve(base, "." + path.posix.normalize("/" + rel))
  return full === base || full.startsWith(base + path.sep) ? full : null
}

/** @param {string} file */
function isFile(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** @param {string} urlPath @returns {string | null} */
function resolve(urlPath) {
  const site = urlPath === "/site" || urlPath.startsWith("/site/")
  const base = site ? SITE : ROOT
  const rel = site ? urlPath.slice("/site".length) : urlPath
  let file = inside(base, decodeURIComponent(rel))
  if (!file) return null
  if (isFile(file)) return file
  const index = path.join(file, "index.html")
  if (isFile(index)) return index
  // SPA fallback: extensionless and missing → nearest index.html above it.
  if (path.extname(file) !== "") return null
  while (file.startsWith(base + path.sep)) {
    file = path.dirname(file)
    const up = path.join(file, "index.html")
    if (file !== base && isFile(up)) return up
  }
  return null
}

http
  .createServer((req, res) => {
    const urlPath = new URL(req.url || "/", "http://x").pathname
    if (urlPath === "/") {
      const dirs = fs
        .readdirSync(ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "fixtures")
        .map((d) => `<li><a href="/${d.name}/">${d.name}</a></li>`)
      res.writeHead(200, { "content-type": TYPES[".html"] })
      res.end(`<!doctype html><title>Prototypes</title><h1>Prototypes</h1><ul>${dirs.join("")}</ul>`)
      return
    }
    const file = resolve(urlPath)
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    })
    fs.createReadStream(file).pipe(res)
  })
  .listen(PORT, () => console.log(`prototypes on http://localhost:${PORT}/`))
