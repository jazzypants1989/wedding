#!/usr/bin/env node
/** @file CLI: prove a placeholder-proxy chain serves no real photograph bytes.
 *
 *  For every live media row and variant, it asks each hop and classifies the
 *  response by MAGIC BYTES ONLY. It never decodes, never inspects pixels, and
 *  writes no image data anywhere. A PNG is a synthesized placeholder; anything
 *  else that came back 2xx counts as real bytes.
 *
 *  Run it at every bring-up of the chain. It is the only check that separates a
 *  working apparatus from one that is quietly showing photographs. It does not
 *  cover a browser profile that cached real photographs earlier, so use a fresh
 *  profile as well.
 *
 *  A hop that returned nothing successful FAILS. "No leaks among zero responses"
 *  proves nothing, and usually means the chain is down.
 *
 *  Output is counts and response shapes: never a file key, never a filename.
 */
/** @import * as Types from './types.js' */

import http from "node:http"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const USAGE = `Usage: node scripts/dev/leak-check.js --database PATH --port N [--port N ...]

  --database PATH   The SQLite file the server under test reads. Required.
  --port N          A hop to check (repeat for each). Required.

Exit codes: 0 clean, 1 real bytes seen, 2 a hop answered nothing.`

const VARIANTS = ["thumb", "display", "poster", "original", "w1600"]

/** Enough for every signature in classifyBytes. */
const HEAD_BYTES = 64

/** @type {Types.classifyBytes} */
export function classifyBytes(head) {
  if (head.length < 12) return "empty/short"
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "PNG"
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "JPEG"
  const riff = head.subarray(0, 4).toString("latin1")
  if (riff === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "WEBP"
  if (head.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = head.subarray(8, 12).toString("latin1")
    return brand.startsWith("hei") || brand.startsWith("mif") ? "HEIF" : "MP4"
  }
  if (head.subarray(0, 17).toString("latin1") === "placeholder-proxy") return "proxy-text"
  if (head[0] === 0x3c) return "HTML/text"
  return "other"
}

/** @type {Types.parseLeakCheckArgs} */
export function parseLeakCheckArgs(argv) {
  let database = ""
  /** @type {number[]} */
  const ports = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--database") {
      database = argv[++i] ?? ""
    } else if (arg === "--port") {
      const port = Number(argv[++i])
      if (!Number.isInteger(port) || port < 1) throw new Error("--port needs a port number")
      ports.push(port)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (database.length === 0) throw new Error("--database is required")
  if (ports.length === 0) throw new Error("at least one --port is required")
  return { database, ports }
}

/**
 * @param {number} port
 * @param {string} urlPath
 * @returns {Promise<{ status: number, type: string, head: Buffer }>}
 */
function fetchHead(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method: "GET",
        headers: { "accept-encoding": "identity" },
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = []
        let kept = 0
        res.on("data", (/** @type {Buffer} */ chunk) => {
          if (kept < HEAD_BYTES) {
            chunks.push(chunk)
            kept += chunk.length
          }
        })
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers["content-type"] ?? ""),
            head: Buffer.concat(chunks).subarray(0, HEAD_BYTES),
          })
        })
      },
    )
    req.on("error", () => resolve({ status: 0, type: "", head: Buffer.alloc(0) }))
    req.end()
  })
}

/** @type {Types.checkHop} */
export async function checkHop(port, fileKeys, variants = VARIANTS) {
  /** @type {Map<Types.ByteKind, number>} */
  const tally = new Map()
  /** @type {Set<string>} */
  const leaks = new Set()
  let responses = 0
  for (const fileKey of fileKeys) {
    for (const variant of variants) {
      const res = await fetchHead(port, `/media/${fileKey}/${variant}`)
      if (res.status === 0 || res.status >= 400) continue
      responses++
      const kind = classifyBytes(res.head)
      tally.set(kind, (tally.get(kind) ?? 0) + 1)
      if (kind !== "PNG" && kind !== "proxy-text") {
        leaks.add(`${variant} (${kind}, ${res.type}, HTTP ${res.status})`)
      }
    }
  }
  return { port, tally, leaks: [...leaks], responses }
}

/** @type {Types.leakCheckExitCode} */
export function leakCheckExitCode(reports) {
  if (reports.some((report) => report.leaks.length > 0)) return 1
  if (reports.some((report) => report.responses === 0)) return 2
  return 0
}

async function main() {
  const args = parseLeakCheckArgs(process.argv.slice(2))
  const db = new DatabaseSync(args.database, { readOnly: true })
  const rows = /** @type {Array<{ file_key: string }>} */ (
    /** @type {unknown} */ (
      db.prepare("SELECT file_key FROM media WHERE deleted_at IS NULL ORDER BY id").all()
    )
  )
  db.close()
  const fileKeys = rows.map((row) => row.file_key)

  /** @type {Types.HopReport[]} */
  const reports = []
  for (const port of args.ports) {
    const report = await checkHop(port, fileKeys)
    reports.push(report)
    console.log(`\n=== port ${port} ===`)
    for (const [kind, count] of report.tally) console.log(`  ${kind}: ${count} responses`)
    if (report.leaks.length > 0) {
      console.log("  !! REAL BYTES SEEN")
      for (const shape of report.leaks.slice(0, 8)) console.log(`     ${shape}`)
    } else if (report.responses === 0) {
      console.log("  !! NOTHING ANSWERED: this proves nothing. Is the chain up?")
    } else {
      console.log("  clean: every 2xx was a synthesized PNG")
    }
  }
  process.exitCode = leakCheckExitCode(reports)
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(USAGE)
    process.exitCode = 2
  })
}
