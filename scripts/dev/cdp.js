#!/usr/bin/env node
/** @file CLI: a minimal headless Chrome driver for checking fictional review data.
 *
 *  Navigates, runs JS expressions from files and prints each awaited value, then
 *  optionally screenshots. Never point it at a page showing real photographs,
 *  including the production landing page.
 *
 *  **The profile is fresh and deleted afterward by default.** A kept profile keeps
 *  its HTTP cache, and a cache holding real photographs replays them no matter
 *  what a proxy does now. Pass --profile only to stay logged in between runs on
 *  fictional data.
 *
 *  Chrome is a dev-machine binary, so it is probed by trying to run it: `--chrome`,
 *  then `$CHROME`, then the usual names, then the macOS app location, because an
 *  app bundle is never on PATH.
 */
/** @import * as Types from './types.js' */
/** @import { ChildProcess } from 'node:child_process' */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const USAGE = `Usage: node scripts/dev/cdp.js <url> <width>x<height> [options]

  --shot=FILE         Write a PNG screenshot after the steps.
  --eval=FILE         Evaluate FILE as an expression; prints the awaited value. Repeatable.
  --wait=MS           Pause after each --eval. Default 600.
  --settle=MS         Pause after navigation. Default 1500.
  --print-media       Emulate print media.
  --reduced-motion    Emulate prefers-reduced-motion.
  --profile=DIR       Keep and reuse this profile. Default: fresh, then deleted.
  --chrome=PATH       The Chrome binary. Default: $CHROME, then the usual names.`

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const STARTUP_ATTEMPTS = 80
const STARTUP_POLL_MS = 100

/** @type {Types.parseCdpArgs} */
export function parseCdpArgs(argv) {
  const [url, size, ...rest] = argv
  if (!url || !size) throw new Error("A URL and a size are required")
  const [width, height] = size.split("x").map(Number)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Size must look like 1280x800, got: ${size}`)
  }
  /** @type {Types.CdpArgs} */
  const args = {
    url,
    width,
    height,
    shot: null,
    evals: [],
    waitMs: 600,
    settleMs: 1500,
    printMedia: false,
    reducedMotion: false,
    profile: null,
    chrome: null,
  }
  for (const arg of rest) {
    if (arg === "--print-media") args.printMedia = true
    else if (arg === "--reduced-motion") args.reducedMotion = true
    else if (arg.startsWith("--shot=")) args.shot = arg.slice(7)
    else if (arg.startsWith("--eval=")) args.evals.push(arg.slice(7))
    else if (arg.startsWith("--wait=")) args.waitMs = Number(arg.slice(7))
    else if (arg.startsWith("--settle=")) args.settleMs = Number(arg.slice(9))
    else if (arg.startsWith("--profile=")) args.profile = arg.slice(10)
    else if (arg.startsWith("--chrome=")) args.chrome = arg.slice(9)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

/** @type {Types.chromeCandidates} */
export function chromeCandidates(explicit, env) {
  if (explicit) return [explicit]
  if (env) return [env]
  return ["google-chrome", "chromium", "chromium-browser", "chrome", MAC_CHROME]
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Start the first candidate that actually executes. ENOENT moves on to the next.
 * @param {readonly string[]} candidates
 * @param {string} profile
 * @returns {Promise<ChildProcess>}
 */
async function startChrome(candidates, profile) {
  for (const binary of candidates) {
    const child = spawn(
      binary,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "about:blank",
      ],
      { stdio: "ignore" },
    )
    const started = await new Promise((resolve) => {
      child.once("spawn", () => resolve(true))
      child.once("error", () => resolve(false))
    })
    if (started) return child
  }
  throw new Error(`Chrome not found. Tried: ${candidates.join(", ")}. Set --chrome or $CHROME.`)
}

/**
 * Chrome writes the port it chose to this file once it is listening.
 * @param {string} profile
 * @returns {Promise<number>}
 */
async function readDebugPort(profile) {
  const file = path.join(profile, "DevToolsActivePort")
  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt++) {
    if (fs.existsSync(file)) {
      const port = Number(fs.readFileSync(file, "utf8").split("\n")[0])
      if (port > 0) return port
    }
    await sleep(STARTUP_POLL_MS)
  }
  throw new Error("Chrome started but never opened its debugging port")
}

/**
 * @param {string} debugUrl
 * @returns {Promise<{
 *   send: (method: string, params?: Record<string, unknown>) => Promise<any>,
 *   close: () => void,
 * }>}
 */
async function connect(debugUrl) {
  const ws = new WebSocket(debugUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let lastId = 0
  /** @type {Map<number, (message: any) => void>} */
  const pending = new Map()
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data))
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  }
  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        const id = ++lastId
        pending.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close: () => ws.close(),
  }
}

/** @param {Types.CdpArgs} args */
async function run(args) {
  const scratchRoot = path.join(import.meta.dirname, "..", "..", "tmp")
  fs.mkdirSync(scratchRoot, { recursive: true })
  const profile = args.profile ?? fs.mkdtempSync(path.join(scratchRoot, "cdp-profile-"))
  const chrome = await startChrome(chromeCandidates(args.chrome, process.env.CHROME), profile)
  /** @type {Awaited<ReturnType<typeof connect>> | null} */
  let page = null
  try {
    const port = await readDebugPort(profile)
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
    if (!res.ok) throw new Error(`Couldn't open a tab: HTTP ${res.status}`)
    const target = /** @type {{ webSocketDebuggerUrl: string }} */ (await res.json())
    page = await connect(target.webSocketDebuggerUrl)

    await page.send("Page.enable")
    await page.send("Runtime.enable")
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: args.width,
      height: args.height,
      deviceScaleFactor: 1,
      mobile: args.width < 768,
    })
    if (args.printMedia || args.reducedMotion) {
      await page.send("Emulation.setEmulatedMedia", {
        media: args.printMedia ? "print" : "",
        features: args.reducedMotion ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [],
      })
    }
    await page.send("Page.navigate", { url: args.url })
    await sleep(args.settleMs)

    for (const file of args.evals) {
      const reply = await page.send("Runtime.evaluate", {
        expression: fs.readFileSync(file, "utf8"),
        awaitPromise: true,
        returnByValue: true,
      })
      const outcome = reply.result
      if (outcome.exceptionDetails) {
        const detail = outcome.exceptionDetails.exception?.description
        console.log(`${file}: EXCEPTION ${JSON.stringify(detail)}`)
        process.exitCode = 1
      } else {
        console.log(`${file}: ${JSON.stringify(outcome.result.value)}`)
      }
      await sleep(args.waitMs)
    }

    if (args.shot) {
      const reply = await page.send("Page.captureScreenshot", { format: "png" })
      fs.writeFileSync(args.shot, Buffer.from(reply.result.data, "base64"))
      console.log(`wrote ${args.shot}`)
    }
  } finally {
    page?.close()
    const exited = new Promise((resolve) => chrome.once("exit", resolve))
    chrome.kill()
    await Promise.race([exited, sleep(2000)])
    if (!args.profile) fs.rmSync(profile, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    await run(parseCdpArgs(process.argv.slice(2)))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(USAGE)
    process.exitCode = 1
  }
}
