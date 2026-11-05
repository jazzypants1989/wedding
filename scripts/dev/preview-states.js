#!/usr/bin/env node
/** @file CLI: review the site in many states from one stable address.
 *
 *    npm run preview:states
 *    open http://localhost:3100/__states
 *
 *  The page lists every fictional state from `preview-fixtures.js`. Choosing one
 *  builds it if needed, starts the real server against its own scratch database,
 *  signs you in as the chosen view (anonymous visitor, signed-in guest, or admin), and
 *  sends you to the page you asked for. Point `/capture-issues` at this port and a
 *  single session can walk every state. A marker cookie records the state and view,
 *  so a captured issue says which one it came from.
 *
 *  Switching restarts the server, so CSS and JS edits are picked up too (static
 *  assets are gzipped at boot). The server runs with email and SMS keys blanked, so
 *  a review can never message anyone. Only the child this process started is ever
 *  stopped; it doesn't touch anything else on any port. Both servers listen on
 *  loopback only, because a state link hands out an admin login. `--lan` opens the
 *  review port to the local network for a real phone, and says so when it starts.
 *
 *  The one real photograph of people in `public/images/` is replaced with a drawing
 *  here, so a screenshot of any state can't carry it.
 *
 *  Reset rebuilds a state after a review has changed it. Everything lives under
 *  `tmp/states/` and is fictional, so deleting that folder loses nothing.
 */
/** @import * as Types from './types.js' */
/** @import { ChildProcess } from 'node:child_process' */
/** @import { IncomingMessage, ServerResponse } from 'node:http' */

import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"

import { PREVIEW_INVITE_CODE, PREVIEW_PASSWORD, PREVIEW_STATES } from "./preview-fixtures.js"
import { drawPlaceholder } from "./placeholder-proxy.js"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..")
const DEFAULT_PORT = 3100
const DEFAULT_BACKEND_PORT = 3199
const HEALTH_ATTEMPTS = 100
const HEALTH_POLL_MS = 100
const LOOPBACK = "127.0.0.1"
const SWAPPED_PHOTOS = new Set(["/images/us.webp", "/images/us-240w.webp"])
const SWAPPED_SIZE = { width: 480, height: 512 }
/** @type {readonly Types.PreviewView[]} */
const VIEWS = ["visitor", "guest", "admin"]
const ADMIN_COOKIES = ["session", "csrf"]
const GUEST_COOKIES = ["guest_session", "guest_csrf"]

const USAGE = `Usage: node scripts/dev/preview-states.js [--port N] [--backend-port N] [--lan]

  --port N           Port to review on. Default ${DEFAULT_PORT}.
  --backend-port N   Internal port for the real server. Default ${DEFAULT_BACKEND_PORT}.
  --lan              Also listen on the local network, to test on a real phone. Anyone on
                     that network can open a state link and get an admin login to the
                     fictional data. Off by default.`

const SITE_LINKS = [
  ["Home", "/"],
  ["Gallery", "/gallery"],
  ["Guestbook", "/guestbook"],
  ["Printable guestbook", "/memory-book"],
]
const ADMIN_LINKS = [
  ["Admin", "/admin"],
  ["Review", "/admin/review"],
  ["Faces", "/admin/faces"],
  ["Gifts", "/admin/thank-yous/gifts"],
  ["Cards", "/admin/thank-yous/cards"],
]

/** @param {string} text */
function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/** @type {Types.parseControlPath} */
export function parseControlPath(urlPath) {
  const parsed = new URL(urlPath, "http://preview.invalid")
  if (parsed.pathname === "/__states" || parsed.pathname === "/__states/") return { action: "list" }
  if (!parsed.pathname.startsWith("/__states/")) return null
  const [action, state] = parsed.pathname.slice("/__states/".length).split("/")
  if (action !== "go" && action !== "reset") return { action: "list" }
  const requestedView = /** @type {Types.PreviewView} */ (parsed.searchParams.get("view"))
  const view = VIEWS.includes(requestedView) ? requestedView : "admin"
  // An allowlist, so a crafted name can never become a path.
  if (!state || !Object.hasOwn(PREVIEW_STATES, state)) return { action: "list" }
  // Same-site paths only, so this can't redirect anywhere else.
  const requested = parsed.searchParams.get("to") ?? "/"
  const to = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/"
  return { action, state, to, view }
}

/** @type {Types.lanAddress} */
export function lanAddress(interfaces) {
  for (const addresses of Object.values(interfaces)) {
    for (const entry of addresses ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address
    }
  }
  return null
}

/** @type {Types.isSwappedPhoto} */
export function isSwappedPhoto(urlPath) {
  return SWAPPED_PHOTOS.has(new URL(urlPath, "http://preview.invalid").pathname)
}

/** @type {Types.previewCookies} */
export function previewCookies(state, view, sessionCookies) {
  const expire = (/** @type {string} */ name) => `${name}=; Path=/; Max-Age=0`
  const signedOut = [...ADMIN_COOKIES, ...GUEST_COOKIES].filter(
    (name) => !sessionCookies.some((cookie) => cookie.startsWith(`${name}=`)),
  )
  const marker = `preview__${state}__${view}`
  const staleMarkers = Object.keys(PREVIEW_STATES)
    .flatMap((name) => VIEWS.map((option) => `preview__${name}__${option}`))
    .filter((name) => name !== marker)
  return [
    ...signedOut.map(expire),
    ...staleMarkers.map(expire),
    ...sessionCookies,
    `${marker}=1; Path=/; SameSite=Lax`,
  ]
}

/** @type {Types.renderSwitcher} */
export function renderSwitcher(current, linksFor) {
  const rows = Object.entries(PREVIEW_STATES).map(([name, info]) => {
    /** @param {string} label @param {string} target @param {Types.PreviewView} view */
    const link = (label, target, view) => {
      const href = `/__states/go/${name}?view=${view}&to=${encodeURIComponent(target)}`
      return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    }
    /** @param {Types.PreviewView} view @param {readonly string[][]} links */
    const links = (view, links) => links.map(([label, target]) => link(label, target, view)).join(" ")
    // Deep links are what a guest receives, so they open as someone not signed in.
    const extra = linksFor(name)
      .map(({ label, url }) => link(label, new URL(url).pathname + new URL(url).search, "visitor"))
      .join(" ")
    const here = name === current ? " <strong>(current)</strong>" : ""
    return `<section>
      <h2>${escapeHtml(info.title)}${here}</h2>
      <p>${escapeHtml(info.description)}</p>
      <p class="view">Visitor: ${links("visitor", SITE_LINKS)} ${extra}</p>
      <p class="view">Signed-in guest: ${links("guest", SITE_LINKS)}</p>
      <p class="view">Host: ${links("admin", [...SITE_LINKS, ...ADMIN_LINKS])}</p>
      <p><a class="reset" href="/__states/reset/${escapeHtml(name)}">Reset this state</a></p>
    </section>`
  })
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview states</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin-bottom: 0; }
  h2 { font-size: 1.1rem; margin: 0; }
  section { border-top: 1px solid #ccc; padding: 0.9rem 0; }
  section p { margin: 0.25rem 0; }
  a { margin-right: 0.6rem; }
  .reset { font-size: 0.85rem; color: #666; }
</style>
<h1>Preview states</h1>
<p>Fictional data only. Come back to <code>/__states</code> to switch. The Host view is what
the two of you see, and it changes the guest pages, so check them as a visitor or guest too. Admin password:
<code>${escapeHtml(PREVIEW_PASSWORD)}</code>. Guest invite code:
<code>${escapeHtml(PREVIEW_INVITE_CODE)}</code>.</p>
${rows.join("\n")}
</html>`
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {number} port
 * @param {string} urlPath
 * @param {string} [body]
 * @returns {Promise<{ status: number, setCookie: string[] }>}
 */
function backendRequest(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "content-type": "application/json" },
      },
      (res) => {
        res.resume()
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, setCookie: res.headers["set-cookie"] ?? [] })
        })
      },
    )
    req.on("error", reject)
    req.end(body)
  })
}

/** @type {Types.createPreviewServer} */
export function createPreviewServer({ root, backendPort, publicUrl }) {
  /** @type {ChildProcess | null} */
  let backend = null
  /** @type {string | null} */
  let current = null
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve()

  /** @param {string} state */
  const stateDir = (state) => path.join(root, state)
  /** @param {string} state */
  const databasePath = (state) => path.join(stateDir(state), "wedding.db")

  /**
   * @param {string} state
   * @returns {readonly Types.PreviewLink[]}
   */
  function linksFor(state) {
    const file = path.join(stateDir(state), "links.json")
    if (!fs.existsSync(file)) return []
    return JSON.parse(fs.readFileSync(file, "utf8"))
  }

  async function stopBackend() {
    if (!backend) return
    const child = backend
    backend = null
    current = null
    const exited = new Promise((resolve) => child.once("exit", resolve))
    child.kill("SIGTERM")
    await Promise.race([exited, sleep(3000)])
    if (child.exitCode === null) child.kill("SIGKILL")
  }

  /** @param {string} state */
  function buildState(state) {
    fs.mkdirSync(stateDir(state), { recursive: true })
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--no-warnings", path.join(import.meta.dirname, "preview-fixtures.js"), state, publicUrl],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, DATABASE_PATH: databasePath(state) },
          stdio: ["ignore", "ignore", "pipe"],
        },
      )
      let errors = ""
      child.stderr.on("data", (/** @type {Buffer} */ chunk) => {
        errors += chunk.toString()
      })
      child.on("error", reject)
      child.on("exit", (code) => {
        if (code === 0) resolve(undefined)
        else reject(new Error(`Building ${state} failed: ${errors}`))
      })
    })
  }

  /**
   * A real guest session in this state's database, made by a child process because
   * the database path is read at import time.
   * @param {string} state
   * @returns {Promise<string[]>} the guest's session cookies
   */
  function guestSession(state) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--no-warnings", path.join(import.meta.dirname, "preview-guest-session.js")],
        {
          cwd: REPO_ROOT,
          env: { ...process.env, DATABASE_PATH: databasePath(state) },
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
      let output = ""
      let errors = ""
      child.stdout.on("data", (/** @type {Buffer} */ chunk) => {
        output += chunk.toString()
      })
      child.stderr.on("data", (/** @type {Buffer} */ chunk) => {
        errors += chunk.toString()
      })
      child.on("error", reject)
      child.on("exit", (code) => {
        if (code === 0) resolve(JSON.parse(output))
        else reject(new Error(`The preview guest for ${state} failed: ${errors}`))
      })
    })
  }

  /**
   * @param {string} state
   * @param {boolean} rebuild
   * @param {Types.PreviewView} view
   * @returns {Promise<string[]>} the cookies for this state and view
   */
  async function switchTo(state, rebuild, view) {
    await stopBackend()
    if (rebuild) fs.rmSync(stateDir(state), { recursive: true, force: true })
    if (!fs.existsSync(databasePath(state))) await buildState(state)
    const guestCookies = view === "guest" ? await guestSession(state) : []

    const log = fs.openSync(path.join(stateDir(state), "server.log"), "a")
    backend = spawn(process.execPath, ["--no-warnings", "server.js"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_PATH: databasePath(state),
        PORT: String(backendPort),
        BASE_URL: publicUrl,
        BIND_HOST: LOOPBACK,
        // Existing values win over .env, so a review can't message anyone.
        RESEND_API_KEY: "",
        FROM_EMAIL: "",
        TWILIO_ACCOUNT_SID: "",
        TWILIO_AUTH_TOKEN: "",
        TWILIO_PHONE_NUMBER: "",
      },
      stdio: ["ignore", log, log],
    })
    fs.closeSync(log)
    current = state

    for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
      try {
        const { status } = await backendRequest(backendPort, "/api/health")
        if (status === 200) {
          if (view === "guest") return previewCookies(state, view, guestCookies)
          if (view === "visitor") return previewCookies(state, view, [])
          const body = JSON.stringify({ password: PREVIEW_PASSWORD })
          const login = await backendRequest(backendPort, "/api/admin/login", body)
          if (login.status !== 200) throw new Error(`Preview login failed: HTTP ${login.status}`)
          return previewCookies(state, view, login.setCookie)
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Preview login")) throw err
      }
      await sleep(HEALTH_POLL_MS)
    }
    throw new Error(`The server for ${state} never became healthy. See its server.log.`)
  }

  /**
   * @param {IncomingMessage} req
   * @param {ServerResponse} res
   */
  function forward(req, res) {
    if (!backend) {
      res.writeHead(302, { location: "/__states" })
      res.end()
      return
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: backendPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${backendPort}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      },
    )
    upstream.on("error", (err) => {
      res.writeHead(502, { "content-type": "text/plain" })
      res.end(`preview-states: server unreachable (${err.message})`)
    })
    req.pipe(upstream)
  }

  const server = http.createServer((req, res) => {
    if (isSwappedPhoto(req.url ?? "/")) {
      const { width, height } = SWAPPED_SIZE
      const body = drawPlaceholder("couple", width, height, { ow: width, oh: height, faces: [] })
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" })
      res.end(body)
      return
    }
    const control = parseControlPath(req.url ?? "/")
    if (!control) {
      forward(req, res)
      return
    }
    if (control.action === "list") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      res.end(renderSwitcher(current, linksFor))
      return
    }
    // One switch at a time: a double click must not start two servers.
    const rebuild = control.action === "reset"
    const target = rebuild ? "/__states" : control.to
    const view = rebuild ? "admin" : control.view
    const job = queue.then(() => switchTo(control.state, rebuild, view))
    queue = job.catch(() => {})
    job.then(
      (cookies) => {
        res.writeHead(302, { location: target, "set-cookie": cookies, "cache-control": "no-store" })
        res.end()
      },
      (/** @type {Error} */ err) => {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
        res.end(err.message)
      },
    )
  })
  server.on("close", () => {
    void stopBackend()
  })
  return server
}

function main() {
  const argv = process.argv.slice(2)
  let port = DEFAULT_PORT
  let backendPort = DEFAULT_BACKEND_PORT
  let lan = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i])
    else if (argv[i] === "--backend-port") backendPort = Number(argv[++i])
    else if (argv[i] === "--lan") lan = true
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  const address = lan ? lanAddress(os.networkInterfaces()) : "localhost"
  if (!address) throw new Error("--lan needs a network connection, and this machine has none")
  const publicUrl = `http://${address}:${port}`
  const server = createPreviewServer({
    root: path.join(REPO_ROOT, "tmp", "states"),
    backendPort,
    publicUrl,
  })
  server.listen(port, lan ? "0.0.0.0" : LOOPBACK, () => {
    console.log(`Preview states: ${publicUrl}/__states`)
    if (lan) {
      console.log("Open to this network: anyone on it can get an admin login to the fictional data.")
    }
  })
  const stop = () => {
    server.close()
    server.closeAllConnections()
    setTimeout(() => process.exit(0), 3500).unref()
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
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
