#!/usr/bin/env node
/** @file CLI: review the site in many states from one stable address.
 *
 *    npm run preview:states
 *    open http://localhost:3100/__states
 *
 *  The page lists every fictional state from `preview-fixtures.js`. Choosing one
 *  builds it if needed, starts the real server against its own scratch database,
 *  logs in as admin, and sends you to the page you asked for. Point `/capture-issues`
 *  at this port and a single session can walk every state.
 *
 *  Switching restarts the server, so CSS and JS edits are picked up too (static
 *  assets are gzipped at boot). The server runs with email and SMS keys blanked, so
 *  a review can never message anyone. Only the child this process started is ever
 *  stopped; it doesn't touch anything else on any port.
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
import path from "node:path"

import { PREVIEW_INVITE_CODE, PREVIEW_PASSWORD, PREVIEW_STATES } from "./preview-fixtures.js"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..")
const DEFAULT_PORT = 3100
const DEFAULT_BACKEND_PORT = 3199
const HEALTH_ATTEMPTS = 100
const HEALTH_POLL_MS = 100

const USAGE = `Usage: node scripts/dev/preview-states.js [--port N] [--backend-port N]

  --port N           Port to review on. Default ${DEFAULT_PORT}.
  --backend-port N   Internal port for the real server. Default ${DEFAULT_BACKEND_PORT}.`

const QUICK_LINKS = [
  ["Home", "/"],
  ["Gallery", "/gallery"],
  ["Guestbook", "/guestbook"],
  ["Memory book", "/memory-book"],
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
  // An allowlist, so a crafted name can never become a path.
  if (!state || !Object.hasOwn(PREVIEW_STATES, state)) return { action: "list" }
  // Same-site paths only, so this can't redirect anywhere else.
  const requested = parsed.searchParams.get("to") ?? "/"
  const to = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/"
  return { action, state, to }
}

/** @type {Types.renderSwitcher} */
export function renderSwitcher(current, linksFor) {
  const rows = Object.entries(PREVIEW_STATES).map(([name, info]) => {
    const go = QUICK_LINKS.map(([label, target]) => {
      const href = `/__states/go/${name}?to=${encodeURIComponent(target)}`
      return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    }).join(" ")
    const extra = linksFor(name)
      .map(({ label, url }) => {
        const href = `/__states/go/${name}?to=${encodeURIComponent(new URL(url).pathname + new URL(url).search)}`
        return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
      })
      .join(" ")
    const here = name === current ? " <strong>(current)</strong>" : ""
    return `<section>
      <h2>${escapeHtml(info.title)}${here}</h2>
      <p>${escapeHtml(info.description)}</p>
      <p>${go} ${extra}</p>
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
<p>Fictional data only. Come back to <code>/__states</code> to switch. Admin password:
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
   * @param {string} state
   * @param {boolean} rebuild
   * @returns {Promise<string[]>} the admin login cookies
   */
  async function switchTo(state, rebuild) {
    await stopBackend()
    if (rebuild) fs.rmSync(stateDir(state), { recursive: true, force: true })
    if (!fs.existsSync(databasePath(state))) await buildState(state)

    const log = fs.openSync(path.join(stateDir(state), "server.log"), "a")
    backend = spawn(process.execPath, ["--no-warnings", "server.js"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_PATH: databasePath(state),
        PORT: String(backendPort),
        BASE_URL: publicUrl,
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
          const body = JSON.stringify({ password: PREVIEW_PASSWORD })
          const login = await backendRequest(backendPort, "/api/admin/login", body)
          if (login.status !== 200) throw new Error(`Preview login failed: HTTP ${login.status}`)
          return login.setCookie
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
    const job = queue.then(() => switchTo(control.state, rebuild))
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i])
    else if (argv[i] === "--backend-port") backendPort = Number(argv[++i])
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  const publicUrl = `http://localhost:${port}`
  const server = createPreviewServer({
    root: path.join(REPO_ROOT, "tmp", "states"),
    backendPort,
    publicUrl,
  })
  server.listen(port, () => console.log(`Preview states: ${publicUrl}/__states`))
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
