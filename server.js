/** @file Wedding RSVP System - Main Entry Point */
/** @import * as Types from './types.js' */

import "./core/env.js"
import http from "node:http"
import { sendJson } from "./core/http.js"
import { close } from "./db/connection.js"

import * as router from "./core/router.js"
import { serveStatic } from "./core/static.js"

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

export const server = http.createServer(async (req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0]

  try {
    if (urlPath.startsWith("/api/")) {
      const handled = await router.dispatch(req, res)
      if (!handled) {
        sendJson(res, 404, { error: "Not found" })
      }
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
  }
})

server.listen(PORT, () => {
  console.log(`Wedding website running at http://localhost:${PORT}/`)
  console.log(`Health check: http://localhost:${PORT}/api/health`)
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

/** @type {Types.handleGracefulShutdown} */
function handleGracefulShutdown(signal) {
  console.log(`\nShutting down${signal ? ` (${signal})` : ""}...`)
  close()
  server.close(() => {
    console.log("Server closed")
    process.exit(0)
  })
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
