/** @file Import sink that drives the real upload API as an admin, for importing
 *  into a site you are not sitting next to.
 *
 *  Deliberately node:http/node:https rather than fetch. A stream body in undici
 *  needs `duplex: "half"` and then sends chunked with no Content-Length, which
 *  streamToStaging rejects with 411 (core/upload.js) — and a Buffer body would
 *  mean holding a 110MB video in memory per worker. A read stream piped into a
 *  request with an explicit Content-Length gives constant memory and exactly the
 *  length the server verifies byte-for-byte.
 *
 *  Two things this sink cannot do, both documented in
 *  docs/post-wedding/08-bulk-import.md:
 *
 *  1. It cannot set sort_order exactly. POST /api/admin/media/reorder validates
 *     the submitted ids against getOfficialMediaIds(), which includes hidden and
 *     rejected rows, while a client can only enumerate the approved-only public
 *     feed. When that mismatch happens the reorder 400s and this sink warns
 *     rather than failing the run — the admin drag-and-drop UI has the identical
 *     limitation, so it is not a regression.
 *  2. It cannot attribute a --section=guest item to a named guest.
 *     withAccountOrAdmin gives an admin principal accountId: null
 *     unconditionally, so guest-section imports show as the couple's. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import http from "node:http"
import https from "node:https"

import { MediaImportError } from "./media-errors.js"
import { canPrompt, prompt } from "./prompt.js"

/** Statuses that mean "this request will never succeed" — never retried. */
const TERMINAL_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 507])

/** Network errors worth another go; ECONNREFUSED is not (nothing is listening). */
const RETRYABLE_ERRORS = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNABORTED"])

const MAX_ATTEMPTS = 4
const BACKOFF_BASE_MS = 500
const REQUEST_TIMEOUT_MS = 10 * 60_000

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A cookie jar. Updated from Set-Cookie on *every* response, not just the login:
 * the admin CSRF token rotates after an hour (SESSION.CSRF_ROTATION_MS) and a
 * few-hundred-photo run will cross that boundary mid-flight.
 */
function createCookieJar() {
  /** @type {Map<string, string>} */
  const jar = new Map()
  return {
    /** @param {string[] | undefined} setCookie */
    absorb(setCookie) {
      for (const line of setCookie ?? []) {
        const pair = line.split(";")[0]
        const eq = pair.indexOf("=")
        if (eq < 1) continue
        const name = pair.slice(0, eq).trim()
        const value = pair.slice(eq + 1).trim()
        // Max-Age=0 is the server clearing a cookie (logout).
        if (line.includes("Max-Age=0")) jar.delete(name)
        else jar.set(name, value)
      }
    },
    /** @param {string} name */
    get(name) {
      return jar.get(name) ?? null
    },
    header() {
      const parts = []
      for (const [name, value] of jar) parts.push(name + "=" + value)
      return parts.join("; ")
    },
    get size() {
      return jar.size
    },
  }
}

/** @type {Types.createHttpSink} */
export function createHttpSink(options) {
  const base = new URL(options.url)
  const transport = base.protocol === "https:" ? https : http
  const jar = createCookieJar()
  const verbose = options.verbose === true
  const note = options.stderr ?? process.stderr
  /** @type {Map<number, string>} */
  const fileKeys = new Map()
  let loggedIn = false
  /** The single in-flight login, shared by every worker that needs one. */
  /** @type {Promise<void> | null} */
  let loginPromise = null

  /**
   * One HTTP round trip. `filePath` streams a file as the body with an exact
   * Content-Length; `json` sends a JSON body. Never retries — retryRequest does.
   * @param {string} method @param {string} pathname
   * @param {{ json?: unknown, filePath?: string, contentLength?: number, contentType?: string }} [body]
   * @returns {Promise<{ status: number, body: string, json: any }>}
   */
  function once(method, pathname, body = {}) {
    return new Promise((resolve, reject) => {
      /** @type {Record<string, string>} */
      const headers = {}
      const cookies = jar.header()
      if (cookies) headers.Cookie = cookies
      // Read the CSRF token fresh per attempt, exactly as media-uploader.js
      // re-reads document.cookie: with several workers in flight, another
      // worker's response may have rotated it since this request was queued.
      if (method !== "GET" && method !== "HEAD") {
        const csrf = jar.get("csrf")
        if (csrf) headers["X-CSRF-Token"] = csrf
      }

      /** @type {Buffer | null} */
      let payload = null
      if (body.filePath !== undefined) {
        headers["Content-Type"] = body.contentType ?? "application/octet-stream"
        headers["Content-Length"] = String(body.contentLength ?? fs.statSync(body.filePath).size)
      } else if (body.json !== undefined) {
        payload = Buffer.from(JSON.stringify(body.json))
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = String(payload.length)
      }

      const request = transport.request(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port || (base.protocol === "https:" ? 443 : 80),
          path: pathname,
          method,
          headers,
        },
        (response) => {
          jar.absorb(/** @type {string[] | undefined} */ (response.headers["set-cookie"]))
          /** @type {Buffer[]} */
          const chunks = []
          response.on("data", (chunk) => chunks.push(chunk))
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8")
            let parsed = null
            try {
              parsed = text ? JSON.parse(text) : null
            } catch {
              // A non-JSON body (an HTML error page from a proxy) is reported by
              // status alone rather than crashing the run.
            }
            resolve({ status: response.statusCode ?? 0, body: text, json: parsed })
          })
        },
      )

      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.destroy(Object.assign(new Error("Request timed out"), { code: "ETIMEDOUT" }))
      })
      request.on("error", reject)

      if (body.filePath !== undefined) {
        const stream = fs.createReadStream(body.filePath)
        stream.on("error", (err) => {
          request.destroy()
          reject(err)
        })
        stream.pipe(request)
      } else {
        if (payload) request.write(payload)
        request.end()
      }
    })
  }

  /**
   * `once` plus the retry policy: one free immediate retry on a rotated-CSRF
   * 403, then exponential backoff for 5xx, 429 and transient network errors.
   * Terminal statuses are returned to the caller to interpret.
   * @param {string} method @param {string} pathname
   * @param {{ json?: unknown, filePath?: string, contentLength?: number, contentType?: string }} [body]
   */
  async function retryRequest(method, pathname, body = {}) {
    let csrfRetried = false
    for (let attempt = 1; ; attempt++) {
      /** @type {{ status: number, body: string, json: any }} */
      let response
      try {
        response = await once(method, pathname, body)
      } catch (err) {
        const code = /** @type {NodeJS.ErrnoException} */ (err).code ?? ""
        if (RETRYABLE_ERRORS.has(code) && attempt < MAX_ATTEMPTS) {
          if (verbose) note.write(`  ! ${method} ${pathname} — ${code}, retrying\n`)
          await delay(BACKOFF_BASE_MS * 2 ** (attempt - 1))
          continue
        }
        throw new MediaImportError(
          "BACKEND_FAILED",
          `${method} ${pathname} failed: ${err instanceof Error ? err.message : String(err)}` +
            (code === "ECONNREFUSED" ? ` — is the server running at ${options.url}?` : ""),
        )
      }

      if (response.status === 403 && response.json?.code === "CSRF" && !csrfRetried) {
        // The jar has already absorbed whatever this response carried, so the
        // next attempt sends the current token. One free go, then it counts.
        csrfRetried = true
        continue
      }
      // Checked before the 5xx rule, because 507 is both. Re-streaming a 30MB
      // original at a server that just said it has no room is pure waste.
      if (TERMINAL_STATUSES.has(response.status)) return response
      if ((response.status >= 500 || response.status === 429) && attempt < MAX_ATTEMPTS) {
        if (verbose) note.write(`  ! ${method} ${pathname} — ${response.status}, retrying\n`)
        await delay(BACKOFF_BASE_MS * 2 ** (attempt - 1))
        continue
      }
      return response
    }
  }

  /** Turn a non-2xx into the run's error vocabulary. */
  function fail(/** @type {string} */ what, /** @type {{ status: number, json: any, body: string }} */ res) {
    const message = res.json?.error ?? res.body.slice(0, 200) ?? "no response body"
    const code =
      res.status === 413
        ? "VARIANT_TOO_LARGE"
        : res.status === 415
          ? "VARIANT_FORMAT_MISMATCH"
          : // 507 and 401 are run-fatal, not per-file: every remaining file would
            // fail identically, and 200 copies of the same error bury the one
            // line that matters.
            res.status === 507
            ? "DESTINATION_FULL"
            : res.status === 401 || res.status === 403
              ? "AUTH_LOST"
              : "BACKEND_FAILED"
    return new MediaImportError(/** @type {any} */ (code), `${what} — ${res.status}: ${message}`, {
      detail: res.body.slice(0, 500),
    })
  }

  /**
   * Log in once, even under concurrency. Every worker calls login() before its
   * first mutation, so without a shared in-flight promise N workers race into N
   * logins — and each one's Set-Cookie overwrites the jar, so a request already
   * in flight ends up pairing one login's session cookie with another's CSRF
   * token and comes back 401. Memoized on success; cleared on failure so a
   * transient network error can be retried.
   */
  function login() {
    if (loggedIn) return Promise.resolve()
    if (!loginPromise) {
      loginPromise = doLogin().catch((err) => {
        loginPromise = null
        throw err
      })
    }
    return loginPromise
  }

  /** Called lazily, so --dry-run never asks for a password. */
  async function doLogin() {
    let password = process.env.WEDDING_ADMIN_PASSWORD ?? ""
    if (!password) {
      if (!canPrompt()) {
        throw new MediaImportError(
          "BACKEND_FAILED",
          "No admin password available. Set WEDDING_ADMIN_PASSWORD, or run this in a terminal " +
            "so it can be typed. It is deliberately not a flag — flags land in shell history and `ps`.",
        )
      }
      password = await prompt(`Admin password for ${options.url}: `, true)
    }
    if (!password) throw new MediaImportError("BACKEND_FAILED", "No password given.")

    const response = await retryRequest("POST", "/api/admin/login", { json: { password } })
    if (response.status === 429) {
      throw new MediaImportError(
        "BACKEND_FAILED",
        "Too many login attempts — the admin login limiter is rate-limiting this IP. Wait and retry.",
      )
    }
    if (response.status !== 200) throw fail("Admin login", response)
    if (!jar.get("session") || !jar.get("csrf")) {
      throw new MediaImportError(
        "BACKEND_FAILED",
        "Login succeeded but no session cookie came back — is a proxy stripping Set-Cookie?",
      )
    }
    loggedIn = true
  }

  return {
    name: "http",

    async preflight() {
      // GET /api/health is unauthenticated and read-only, which is what lets
      // --dry-run check the destination without a password.
      const response = await retryRequest("GET", "/api/health")
      if (response.status !== 200) {
        return {
          ok: false,
          freeBytes: null,
          storedBytes: null,
          message: `${options.url} answered ${response.status} on /api/health — wrong URL, or the site is down.`,
        }
      }
      const free = response.json?.uploadsFreeBytes
      const freeBytes = typeof free === "number" ? free : null
      return {
        ok: true,
        freeBytes,
        storedBytes: null,
        message:
          `Reached ${options.url}. Over the API, sort_order is set by a reorder call that can be ` +
          `refused if the gallery holds hidden or rejected photos, and guest-section items are ` +
          `attributed to the couple. Import locally for exact control.`,
      }
    },

    async createSession({ kind, originalBytes, section }) {
      await login()
      const response = await retryRequest("POST", "/api/media", {
        json: { kind, originalBytes, section },
      })
      if (response.status === 401) {
        throw new MediaImportError(
          "AUTH_LOST",
          "The admin session expired mid-run. Re-run to resume — the manifest records what already landed.",
        )
      }
      if (response.status !== 201) throw fail("Creating an upload session", response)
      const id = Number(response.json?.id)
      const fileKey = String(response.json?.fileKey ?? "")
      if (!Number.isInteger(id) || !fileKey) {
        throw new MediaImportError("BACKEND_FAILED", "Upload session response had no id/fileKey.")
      }
      fileKeys.set(id, fileKey)
      return { id, fileKey }
    },

    async putVariant(id, variant, file) {
      const response = await retryRequest("PUT", `/api/media/${id}/${variant}`, {
        filePath: file.path,
        // The exact byte count the server compares the stream against. Taken
        // from the artifact rather than re-stat'd so a mismatch surfaces here.
        contentLength: file.bytes,
        contentType: file.contentType,
      })
      if (response.status !== 200) throw fail(`Uploading ${variant}`, response)
      return { bytes: Number(response.json?.bytes ?? file.bytes) }
    },

    async finalize(id, input) {
      const response = await retryRequest("POST", `/api/media/${id}/finalize`, {
        json: {
          width: input.width,
          height: input.height,
          durationS: input.durationS,
          caption: input.caption,
        },
      })
      if (response.status !== 200) throw fail("Finalizing", response)
      return { id: Number(response.json?.id ?? id), status: String(response.json?.status ?? "") }
    },

    async discard(id) {
      // Self-delete on an unfinalized row: the same DELETE the browser tray uses
      // when a guest cancels mid-upload.
      await retryRequest("DELETE", `/api/media/${id}`).catch(() => {})
      fileKeys.delete(id)
    },

    async applyOrder(orderedIds) {
      if (orderedIds.length === 0) return { ok: true }
      await login()

      // reorder demands the EXACT current official set, so the existing photos
      // have to be enumerated and the imported ones appended in plan order.
      const listed = await retryRequest("GET", "/api/media?section=official&limit=500")
      if (listed.status !== 200) {
        return { ok: false, message: `Couldn't read the official gallery to reorder it (${listed.status}).` }
      }
      /** @type {number[]} */
      const existing = Array.isArray(listed.json?.items)
        ? listed.json.items.map((/** @type {{ id: number }} */ item) => Number(item.id))
        : []
      const imported = new Set(orderedIds)
      const ids = [...existing.filter((id) => !imported.has(id)), ...orderedIds]

      const response = await retryRequest("POST", "/api/admin/media/reorder", { json: { ids } })
      if (response.status === 200) return { ok: true }
      if (response.status === 400) {
        // The set didn't match: the gallery holds official rows the public feed
        // cannot see (hidden or rejected). Warn — the photos imported fine, only
        // their order is whatever sort_order they were created with.
        return {
          ok: false,
          message:
            "The gallery order wasn't applied: the site has official photos that aren't publicly " +
            "listed (hidden or rejected), so the reorder call can't name the full set. Drag them " +
            "into place in the admin Gallery tab, or import locally for exact ordering.",
        }
      }
      return { ok: false, message: `Reorder failed (${response.status}).` }
    },

    async close() {
      if (loggedIn) {
        await retryRequest("POST", "/api/admin/logout").catch(() => {})
        loggedIn = false
        loginPromise = null
      }
    },
  }
}
