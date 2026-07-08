/** @file Wedding RSVP System - Main Entry Point */
/** @import * as Types from './types.js' */

import "./core/env.js"
import http from "node:http"
import { sendJson } from "./core/http.js"
import { init, close } from "./db/connection.js"
import { cleanExpiredSessions } from "./db/sessions.js"
import { cleanExpiredAccountSessions } from "./db/account-sessions.js"
import { cleanAllExpired as cleanExpiredRateLimits } from "./core/rate-limit.js"
import { cleanOldLogs } from "./core/utils.js"
import { maybeSendModerationDigest } from "./services/moderation-notify.js"

import * as router from "./core/router.js"
import { serveStatic } from "./core/static.js"
import { serveMedia } from "./core/media-serve.js"
import { ensureUploadDirs } from "./core/media-storage.js"
import { runMediaMaintenance } from "./core/media-sweep.js"
import { SERVER } from "./types.js"

export const server = http.createServer(async (req, res) => {
  if (shuttingDown) {
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Connection": "close",
    })
    res.end(JSON.stringify({ error: "Server is shutting down" }))
    return
  }

  activeRequests++
  const urlPath = (req.url ?? "/").split("?")[0]

  try {
    if (urlPath.startsWith("/api/")) {
      const handled = await router.dispatch(req, res)
      if (!handled) {
        sendJson(res, 404, { error: "Not found" })
      }
      return
    }

    // Dynamic media file server (Range support) — must run BEFORE serveStatic,
    // which serves from public/ and knows nothing about the data-volume uploads.
    if (urlPath.startsWith("/media/")) {
      serveMedia(req, res)
      return
    }

    const served = await serveStatic(req, res)
    if (!served) {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not found")
    }
  } catch (err) {
    console.error("Request error:", err)
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error" })
    }
  } finally {
    activeRequests--
  }
})

init()
console.log("Database initialized")

ensureUploadDirs()

cleanExpiredSessions()
cleanExpiredAccountSessions()
cleanExpiredRateLimits()
cleanOldLogs()
console.log("Expired sessions, rate limits, and old audit logs cleaned")

setInterval(
  () => {
    cleanExpiredSessions()
    cleanExpiredAccountSessions()
    cleanExpiredRateLimits()
    cleanOldLogs()
    // Discover outstanding pending content and send the ~daily digest (its own
    // internal 22h guard makes this a no-op most hours). Fire-and-forget: a
    // failed send must never crash the tick.
    maybeSendModerationDigest().catch((err) => {
      console.error("Moderation digest error:", err)
    })
    // Media housekeeping: purge abandoned uploads + stale staging hourly;
    // full integrity pass every 24th tick.
    try {
      runMediaMaintenance()
    } catch (err) {
      console.error("Media maintenance error:", err)
    }
  },
  60 * 60 * 1000,
).unref()

// A 100MB video on a slow uplink takes minutes to receive, and Node has no
// per-route requestTimeout override. Raising the global limit is safe ONLY
// because uploads add their own idle(30s)+absolute(10min) timers in
// core/upload.js, and every non-upload body path keeps parseBody's 30s/1MB caps.
server.requestTimeout = 600_000
server.headersTimeout = 35_000

server.listen(SERVER.port, () => {
  console.log(`Wedding website running at http://localhost:${SERVER.port}/`)
  console.log(`Health check: http://localhost:${SERVER.port}/api/health`)
})

process.on("SIGINT", () => handleGracefulShutdown(""))
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"))

process.on("uncaughtException", (err) => {
  console.error(err)
  handleFatalError("uncaught exception")
})
process.on("unhandledRejection", (reason, promise) => {
  console.error(reason)
  handleFatalError("unhandled rejection")
})

let shuttingDown = false
let activeRequests = 0

/** @type {Types.handleGracefulShutdown} */
function handleGracefulShutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`\nShutting down${signal ? ` (${signal})` : ""}...`)
  server.close(() => {
    console.log("Server closed, waiting for active requests to drain...")
    waitForDrain()
  })

  setTimeout(() => {
    console.error("Graceful shutdown timed out, forcing exit.")
    close()
    process.exit(1)
  }, 10000).unref()
}

function waitForDrain() {
  if (activeRequests <= 0) {
    console.log("All requests drained")
    close()
    process.exit(0)
    return
  }
  console.log(`Waiting for ${activeRequests} active request(s)...`)
  setTimeout(waitForDrain, 250)
}

/** @type {Types.handleFatalError} */
function handleFatalError(reason) {
  console.error(`FATAL: ${reason}`)

  try {
    close()
    server.close(() => {
      console.error(`Server closed after ${reason}.`)
      process.exit(1)
    })
  } catch (shutdownErr) {
    console.error("Error during shutdown:", shutdownErr)
    process.exit(1)
  }

  setTimeout(() => {
    console.error(`Forced exit after ${reason}.`)
    process.exit(1)
  }, 5000).unref()
}
