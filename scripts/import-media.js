#!/usr/bin/env node

/** @file Bulk-import a directory of photos and videos into the gallery.
 *
 *  Why this exists: the admin "Add official photos" modal is a browser, and a
 *  browser has three problems with a few hundred wedding photos. It has no
 *  folder picker, it cannot decode HEIC on desktop Chrome (so every iPhone
 *  photo lands as an original-only row showing a placeholder tile), and it needs
 *  someone watching it for half an hour. This does the same work from a shell
 *  with real display/thumb variants, deterministic ordering and re-runs that are
 *  no-ops.
 *
 *  Two sinks behind one interface. `local` (the default) imports the server's
 *  own db/ and core/ modules and writes rows and files directly — it is the only
 *  one that can set sort_order exactly. `--url=` drives the real upload API as
 *  an admin, for importing into a machine you are not sitting at.
 *
 *  Nothing here parses a file extension. Every file is classified by reading its
 *  first 32 bytes through the same core/sniff.js the server uses, which is also
 *  what makes .DS_Store, .AAE sidecars and stray text files skip themselves.
 *
 *  A --selection decides what goes public, so three rules keep a reject from
 *  getting out later. The manifest records that a selection run imported into
 *  a destination, and a later run there without --selection is refused unless it
 *  says --no-selection. Every row already imported is compared with the
 *  selection (by its current status on the destination, not what the manifest
 *  last saw), and a public row the selection leaves out stops the run until
 *  --apply-selection hides it. And a HIDDEN_NOT_HONOURED row is only reported
 *  as removed when the delete actually succeeded. */
/** @import * as Types from './lib/types.js' */

// MUST be first: types.js reads MEDIA_* from process.env at import time.
import "./lib/load-env.js"

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { sanitize } from "../core/http.js"
import { LIMITS, MEDIA_KIND, MEDIA_SECTION, MEDIA_STATUS, isCuratedMediaSection } from "../types.js"
import { describeBackends, imageBackendInstallHint, videoBackendInstallHint } from "./lib/image-backend.js"
import {
  hashFile,
  loadManifest,
  manifestHas,
  manifestMarkSelection,
  manifestRecord,
  manifestRows,
  manifestSelection,
  manifestSetStatus,
  normalizeOrigin,
  saveManifest,
} from "./lib/import-manifest.js"
import { loadSelection } from "./lib/import-selection.js"
import { MediaImportError, isMediaImportError } from "./lib/media-errors.js"
import {
  TRANSCODE_BYTES_PER_PIXEL,
  VARIANT_BYTES_PER_PIXEL,
  buildMediaVariants,
  estimateStoredBytes,
  planMediaFile,
  probeBackends,
} from "./lib/media-variants.js"
import { createHttpSink } from "./lib/sink-http.js"
import { createLocalSink } from "./lib/sink-local.js"

const USAGE = `Usage: npm run import:media -- <dir> [options]

  <dir>                     Directory of photos/videos to import (required).

  --section=official|honeymoon|guest
                            Which gallery section. Default: official.
  --dry-run                 Report what would happen. Touches no write path. With
                            --url it logs in, to read the remaining storage.
  --url=URL                 Import over the API instead of writing locally.
  --selection=PATH          Culling file: {"version":1,"visible":[sha256,…]}. Files
                            not listed, videos included, finish hidden. Rows already
                            imported are checked against it too. Once a run has used
                            one, later runs to the same destination need it again.
  --apply-selection         With --selection: also hide already-imported rows it
                            leaves out, and show hidden ones it now lists.
  --no-selection            Import everything visible, even though an earlier run
                            used --selection. Any file that selection left out goes
                            public if this run uploads it. Existing rows keep
                            their status.

  --recursive               Descend into subdirectories.
  --order=name|mtime        Import order. Default: name (ascending, code-unit).
  --captions=sidecar        Read IMG_1234.txt next to IMG_1234.jpg as the caption.
  --concurrency=N           Files in flight. Default: min(8, cores - 1).

  --manifest=PATH           Idempotency record. Default: <data dir>/import-manifest.json.
  --report=PATH             Write the run summary as JSON.
  --force                   Import even files the manifest already records.
  --skip-reorder            Leave sort_order alone (official/honeymoon only).

  --strip-original          Also remove EXIF from the stored originals.
  --heic-original=keep|jpeg Store HEIC originals as-is, or re-encode to JPEG.
  --videos=skip|require     Missing ffmpeg skips videos, or fails the run.
  --verbose                 Per-file detail, including backend stderr.
`

/** Flags whose value must come from a fixed set.
 *  @type {Record<string, string[]>} */
const ENUM_FLAGS = {
  section: [MEDIA_SECTION.OFFICIAL, MEDIA_SECTION.HONEYMOON, MEDIA_SECTION.GUEST],
  order: ["name", "mtime"],
  captions: ["none", "sidecar"],
  "heic-original": ["keep", "jpeg"],
  videos: ["skip", "require"],
}

const BOOLEAN_FLAGS = [
  "dry-run",
  "recursive",
  "force",
  "skip-reorder",
  "strip-original",
  "verbose",
  "apply-selection",
  "no-selection",
  "help",
]

const VALUE_FLAGS = [
  "url",
  "concurrency",
  "manifest",
  "report",
  "selection",
  ...Object.keys(ENUM_FLAGS),
]

/** Below this share of spare room, say so: the variant sizes are estimates. A
 *  margin, not a measurement. */
const TIGHT_CAPACITY_FRACTION = 0.1

/** Exit codes, as documented in docs/post-wedding/08-bulk-import.md.
 *
 *  INTERRUPTED is separate from ABORTED because the two mean different things to
 *  whoever is reading the code: 130 is the conventional "killed by SIGINT", and a
 *  wrapper script re-running on failure wants to retry a `DESTINATION_FULL` stop
 *  but not a Ctrl-C the operator typed on purpose. */
const EXIT = { CLEAN: 0, SOME_FAILED: 1, ABORTED: 2, INTERRUPTED: 130 }

/** @param {number} bytes @returns {string} */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

/** Default concurrency: leave a core for the rest of the machine. */
function defaultConcurrency() {
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : 4
  return Math.max(1, Math.min(8, cores - 1))
}

/** Where data/ lives, following the same override every other script honours. */
function defaultDataDir() {
  const dbPath = process.env.DATABASE_PATH
  if (dbPath) return path.dirname(path.resolve(dbPath))
  return path.join(import.meta.dirname, "..", "data")
}

function defaultManifestPath() {
  return path.join(defaultDataDir(), "import-manifest.json")
}

/** Characters a POSIX shell takes literally, so a word made of them needs no quotes. */
const SHELL_SAFE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./:=@%+,"

/** Quote one word for a POSIX shell. Photo directories have spaces and quotes. */
function shellQuote(/** @type {string} */ word) {
  let safe = word.length > 0
  for (const char of word) {
    if (!SHELL_SAFE.includes(char)) {
      safe = false
      break
    }
  }
  return safe ? word : "'" + word.replaceAll("'", "'\\''") + "'"
}

/** @type {Types.applySelectionCommand} */
export function applySelectionCommand(args) {
  // Everything that shapes what the run uploads, so the command the owner
  // pastes does what they meant plus the fix. --dry-run is left off: this is
  // the command that does it. --report and --verbose don't change the outcome.
  const words = ["npm", "run", "import:media", "--", shellQuote(args.dir)]
  if (args.recursive) words.push("--recursive")
  if (args.section !== MEDIA_SECTION.OFFICIAL) words.push(`--section=${args.section}`)
  if (args.url) words.push(shellQuote(`--url=${args.url}`))
  words.push(shellQuote(`--selection=${args.selectionPath ?? ""}`))
  if (args.manifestPath !== defaultManifestPath()) {
    words.push(shellQuote(`--manifest=${args.manifestPath}`))
  }
  if (args.order !== "name") words.push(`--order=${args.order}`)
  if (args.captions !== "none") words.push(`--captions=${args.captions}`)
  if (args.force) words.push("--force")
  if (args.skipReorder) words.push("--skip-reorder")
  if (args.stripOriginal) words.push("--strip-original")
  if (args.heicOriginal !== "keep") words.push(`--heic-original=${args.heicOriginal}`)
  if (args.videos !== "skip") words.push(`--videos=${args.videos}`)
  words.push("--apply-selection")
  return words.join(" ")
}

/** @type {Types.parseImportArgs} */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {}
  /** @type {Set<string>} */
  const flags = new Set()
  /** @type {string[]} */
  const positional = []

  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      positional.push(raw)
      continue
    }
    const body = raw.slice(2)
    const eq = body.indexOf("=")
    const name = eq === -1 ? body : body.slice(0, eq)
    const value = eq === -1 ? null : body.slice(eq + 1)

    if (value === null) {
      if (!BOOLEAN_FLAGS.includes(name)) {
        // Catches --section official (space instead of =) as well as typos,
        // rather than silently importing into the default section.
        return {
          valid: false,
          error: VALUE_FLAGS.includes(name)
            ? `--${name} needs a value: --${name}=VALUE`
            : `Unknown option --${name}`,
        }
      }
      flags.add(name)
      continue
    }
    if (!VALUE_FLAGS.includes(name)) {
      return {
        valid: false,
        error: BOOLEAN_FLAGS.includes(name)
          ? `--${name} takes no value`
          : `Unknown option --${name}`,
      }
    }
    if (value.length === 0) return { valid: false, error: `--${name} needs a value` }
    values[name] = value
  }

  if (flags.has("help")) return { valid: false, error: USAGE }

  if (positional.length === 0) {
    return { valid: false, error: "No directory given.\n\n" + USAGE }
  }
  if (positional.length > 1) {
    return {
      valid: false,
      error:
        `Expected one directory, got ${positional.length} (${positional.join(", ")}). ` +
        `Quote paths containing spaces.`,
    }
  }
  // `"$PHOTOS"` with the variable unset arrives as an empty string, and
  // path.resolve("") is the current working directory — which once swept this
  // repository's own screenshots into a gallery. Refuse both shapes by name.
  if (positional[0].length === 0) {
    return {
      valid: false,
      error:
        'The directory argument is empty. If you passed a shell variable (e.g. "$PHOTOS"), ' +
        "it is not set in this shell.",
    }
  }
  const dir = path.resolve(positional[0])
  if (dir === path.resolve(import.meta.dirname, "..")) {
    return {
      valid: false,
      error:
        "That directory is this project's own repository. Photographs are imported from an " +
        "explicit directory of their own — refusing to sweep the repo's images into the gallery.",
    }
  }

  for (const [name, allowed] of Object.entries(ENUM_FLAGS)) {
    const value = values[name]
    if (value !== undefined && !allowed.includes(value)) {
      return { valid: false, error: `--${name} must be one of: ${allowed.join(", ")}` }
    }
  }

  let concurrency = defaultConcurrency()
  if (values.concurrency !== undefined) {
    const n = Number(values.concurrency)
    if (!Number.isInteger(n) || n < 1 || n > 64) {
      return { valid: false, error: "--concurrency must be an integer from 1 to 64" }
    }
    concurrency = n
  }

  if (flags.has("apply-selection") && values.selection === undefined) {
    return {
      valid: false,
      error: "--apply-selection needs --selection=PATH: it makes existing rows match that file.",
    }
  }
  if (flags.has("no-selection") && values.selection !== undefined) {
    return {
      valid: false,
      error: "--no-selection and --selection contradict each other. Pick one.",
    }
  }

  const section = /** @type {"official" | "honeymoon" | "guest"} */ (
    values.section ?? MEDIA_SECTION.OFFICIAL
  )

  return {
    valid: true,
    value: {
      dir,
      section,
      dryRun: flags.has("dry-run"),
      url: values.url ? normalizeOrigin(values.url) : null,
      recursive: flags.has("recursive"),
      order: /** @type {"name" | "mtime"} */ (values.order ?? "name"),
      captions: /** @type {"none" | "sidecar"} */ (values.captions ?? "none"),
      concurrency,
      manifestPath: values.manifest ? path.resolve(values.manifest) : defaultManifestPath(),
      reportPath: values.report ? path.resolve(values.report) : null,
      selectionPath: values.selection ? path.resolve(values.selection) : null,
      applySelection: flags.has("apply-selection"),
      noSelection: flags.has("no-selection"),
      force: flags.has("force"),
      skipReorder: flags.has("skip-reorder"),
      stripOriginal: flags.has("strip-original"),
      heicOriginal: /** @type {"keep" | "jpeg"} */ (values["heic-original"] ?? "keep"),
      videos: /** @type {"skip" | "require"} */ (values.videos ?? "skip"),
      verbose: flags.has("verbose"),
    },
  }
}

/** @type {Types.scanDirectory} */
export function scanDirectory(dir, options = {}) {
  /** @type {Types.ScannedFile[]} */
  const found = []

  /** @param {string} current @param {string} prefix */
  function walk(current, prefix) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      const relative = prefix ? prefix + "/" + entry.name : entry.name

      let isFile = entry.isFile()
      let isDir = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        // A photo library full of symlinks is a normal thing; a broken one is
        // not worth failing the scan over.
        try {
          const stat = fs.statSync(absolute)
          isFile = stat.isFile()
          isDir = stat.isDirectory()
        } catch {
          continue
        }
      }

      if (isFile) found.push({ absolute, relative, name: entry.name })
      else if (isDir && options.recursive) walk(absolute, relative)
    }
  }

  walk(dir, "")
  // Plain sort, not localeCompare: code-unit order is the same on every machine
  // and in every locale, which is what makes a re-run produce the same order.
  found.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0))
  return found
}

/**
 * Caption from a sidecar text file beside the source (IMG_1234.txt next to
 * IMG_1234.HEIC). Sanitized through the same helper the API uses, so a caption
 * that would be rejected over HTTP is rejected here too.
 * @param {string} sourcePath @returns {string | null}
 */
function readSidecarCaption(sourcePath) {
  const dot = sourcePath.lastIndexOf(".")
  const slash = sourcePath.lastIndexOf(path.sep)
  const base = dot > slash ? sourcePath.slice(0, dot) : sourcePath
  try {
    return sanitize(fs.readFileSync(base + ".txt", "utf8"), LIMITS.MESSAGE_MAX_LENGTH)
  } catch {
    return null
  }
}

/**
 * Run `fn` over items with at most `limit` in flight. Results keep input order.
 * @template T, R
 * @param {T[]} items @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapPool(items, limit, fn) {
  /** @type {R[]} */
  const results = new Array(items.length)
  let next = 0
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** @type {Types.buildImportPlan} */
export async function buildPlan(input, deps = {}) {
  const planFile = deps.planMediaFile ?? planMediaFile
  const hash = deps.hashFile ?? hashFile

  const entries = await mapPool(input.files, input.concurrency, async (file) => {
    /** @type {Types.PlannedItem | Types.SkippedItem} */
    let result
    try {
      const plan = await planFile(file.absolute, input.backends)
      if (!plan.ok) {
        result = { file, code: plan.code, message: plan.message, skipped: true }
      } else {
        const sha256 = await hash(file.absolute)
        if (!input.force && manifestHas(input.manifest, input.origin, sha256)) {
          result = {
            file,
            code: "ALREADY_IMPORTED",
            message: `${file.relative} — already imported (pass --force to import it again).`,
            skipped: true,
            sha256,
          }
        } else {
          result = {
            file,
            plan,
            sha256,
            caption: input.captions === "sidecar" ? readSidecarCaption(file.absolute) : null,
            hidden: input.selection ? !input.selection.has(sha256) : false,
            skipped: false,
          }
        }
      }
    } catch (err) {
      // A file that cannot even be planned (unreadable, truncated, a backend
      // that hung) is one file's problem, not the run's.
      result = {
        file,
        code: isMediaImportError(err) ? err.code : "UNSUPPORTED_SOURCE",
        message: `${file.relative} — ${err instanceof Error ? err.message : String(err)}`,
        skipped: true,
      }
    }
    return result
  })

  /** @type {Types.PlannedItem[]} */
  const items = []
  /** @type {Types.SkippedItem[]} */
  const skipped = []
  for (const entry of entries) {
    if (entry.skipped) skipped.push(entry)
    else items.push(entry)
  }

  if (input.order === "mtime") {
    // Escape hatch, not the default: mtime is usually when the files were copied
    // off the camera, not when the photos were taken.
    items.sort(
      (a, b) =>
        a.plan.mtimeMs - b.plan.mtimeMs ||
        (a.file.relative < b.file.relative ? -1 : a.file.relative > b.file.relative ? 1 : 0),
    )
  }
  return { items, skipped }
}

/**
 * The preflight block: what was found, what is missing, and what the originals
 * carry. Returned as lines so both --dry-run and the real run print the same
 * thing and the report can embed it.
 * @param {Types.ImportArgs} args
 * @param {Types.MediaBackends} backends
 * @param {Types.SinkPreflight} preflight
 * @param {{ items: Types.PlannedItem[], skipped: Types.SkippedItem[] }} plan
 * @returns {string[]}
 */
export function formatPlanReport(args, backends, preflight, plan) {
  /** @type {string[]} */
  const lines = []
  const push = (/** @type {string} */ line) => lines.push(line)

  push(`Source        ${args.dir}${args.recursive ? " (recursive)" : ""}`)
  push(`Destination   ${args.url ? args.url : "local database + uploads tree"}`)
  push(`Section       ${args.section}`)
  push(`Order         ${args.order}`)
  push("")

  for (const note of describeBackends(backends)) {
    push(`${note.level === "ok" ? "✓" : note.level === "warn" ? "!" : "✗"} ${note.message}`)
  }
  if (preflight.freeBytes !== null) push(`✓ ${formatBytes(preflight.freeBytes)} free on the data volume`)
  if (preflight.storedBytes !== null) push(`✓ ${formatBytes(preflight.storedBytes)} of originals already stored`)
  if (preflight.message) push(`${preflight.ok ? "!" : "✗"} ${preflight.message}`)
  push("")

  const sizes = planStoredBytes(plan.items, args)
  const images = plan.items.filter((i) => i.plan.kind === MEDIA_KIND.IMAGE).length
  const videos = plan.items.length - images
  const about = sizes.estimatedOriginals > 0 ? "about " : ""
  push(
    `${plan.items.length} file(s) to import — ${images} photo(s), ${videos} video(s), ` +
      `${about}${formatBytes(sizes.originals)} of originals.`,
  )
  if (sizes.estimatedOriginals > 0) {
    push(
      `  ${sizes.estimatedOriginals} HEIC original(s) will be stored as JPEG, estimated at ` +
        `${TRANSCODE_BYTES_PER_PIXEL} bytes per pixel (never less than the HEIC).`,
    )
  }
  if (plan.items.length > 0) {
    push(
      `  Plus about ${formatBytes(sizes.variants)} of display/thumb/poster variants, ` +
        `estimated at ${VARIANT_BYTES_PER_PIXEL} bytes per pixel within the server's ` +
        "per-variant caps.",
    )
  }

  if (plan.skipped.length > 0) {
    /** @type {Map<string, Types.SkippedItem[]>} */
    const byCode = new Map()
    for (const skip of plan.skipped) {
      const list = byCode.get(skip.code) ?? []
      list.push(skip)
      byCode.set(skip.code, list)
    }
    push("")
    for (const [code, list] of byCode) {
      push(`${list.length} skipped (${SKIP_LABEL[code] ?? code.toLowerCase()}):`)
      // Every unsupported or over-limit file is named — a silent "203 skipped"
      // is indistinguishable from a broken scan.
      const shown = code === "ALREADY_IMPORTED" && !args.verbose ? list.slice(0, 3) : list
      for (const skip of shown) push(`    ${skip.message}`)
      if (shown.length < list.length) push(`    … and ${list.length - shown.length} more (--verbose to list)`)
    }
  }

  const withGps = plan.items.filter((i) => i.plan.hasGps).length
  if (withGps > 0) {
    push("")
    push(`  ${withGps} of ${plan.items.length} photos carry GPS coordinates in their original file.`)
    push(`  Originals are admin-only (private, no-store, never served publicly) — this`)
    push(`  matches what the browser uploader does. The public display/thumb variants`)
    push(`  this importer generates are always metadata-free.`)
    if (!args.stripOriginal) {
      push(`  Pass --strip-original to remove EXIF from the stored originals too`)
      push(`  (lossless for JPEG/PNG/WebP; HEIC needs --heic-original=jpeg).`)
    }
  }

  if (plan.items.length > 0) {
    push("")
    push("Order:")
    const preview = args.verbose ? plan.items : plan.items.slice(0, 10)
    for (let i = 0; i < preview.length; i++) {
      const item = preview[i]
      push(
        `  ${String(i + 1).padStart(4)}. ${item.file.relative} ` +
          `(${item.plan.width}×${item.plan.height}, ${formatBytes(item.plan.originalBytes)})` +
          (item.hidden ? " hidden" : ""),
      )
    }
    if (preview.length < plan.items.length) {
      push(`  … and ${plan.items.length - preview.length} more (--verbose to list)`)
    }
  }
  return lines
}

/** @type {Types.formatSelectionReport} */
export function formatSelectionReport(args, selection, plan) {
  const hidden = plan.items.filter((item) => item.hidden)
  const hiddenVideos = hidden.filter((item) => item.plan.kind === MEDIA_KIND.VIDEO).length
  /** @type {string[]} */
  const lines = [
    `Selection     ${args.selectionPath}`,
    `  ${plan.items.length - hidden.length} file(s) finish visible, ${hidden.length} finish hidden` +
      (hiddenVideos > 0 ? ` (${hiddenVideos} of them video).` : "."),
  ]

  const already = plan.skipped.filter((skip) => skip.code === "ALREADY_IMPORTED")
  const found = new Set([...plan.items, ...already].map((entry) => entry.sha256))
  const unmatched = [...selection].filter((sha256) => !found.has(sha256)).length
  if (unmatched > 0) {
    lines.push(
      `! ${unmatched} selected hash(es) match no file here. Is this the directory the selection ` +
        `was made from? A file edited since culling has a new hash, and would finish hidden.`,
    )
  }
  // Already-imported files are not counted here: compareWithSelection checks
  // each one's actual status and names only those that disagree.
  return lines
}

/** @type {Types.planStoredBytes} */
export function planStoredBytes(items, args) {
  const sizes = { originals: 0, variants: 0, estimatedOriginals: 0 }
  for (const item of items) {
    const estimate = estimateStoredBytes(item.plan, {
      section: args.section,
      heicOriginal: args.heicOriginal,
    })
    sizes.originals += estimate.originalBytes
    sizes.variants += estimate.variantBytes
    if (!estimate.originalExact) sizes.estimatedOriginals++
  }
  return sizes
}

/** @type {Types.assessCapacity} */
export function assessCapacity(planned, capacity) {
  if (!capacity.ok) {
    return { level: "unknown", lines: [`! Storage not checked: ${capacity.message}`] }
  }
  // Two walls, as passesDiskGuard has: originals (hidden ones included) count
  // toward the cap on stored originals; originals AND variants take disk. The
  // server's own remainingBytes is used for whichever wall it names, since only
  // it knows the bytes reserved by uploads in flight.
  const toCap =
    capacity.limitedBy === "cap"
      ? capacity.remainingBytes
      : Math.max(0, capacity.maxTotalBytes - capacity.storedBytes)
  const toDisk =
    capacity.freeBytes === null
      ? Infinity
      : capacity.limitedBy === "disk"
        ? capacity.remainingBytes
        : Math.max(0, capacity.freeBytes - capacity.minFreeBytes)
  const onDisk = planned.originals + planned.variants
  const capWall =
    `the ${formatBytes(capacity.maxTotalBytes)} cap on stored originals (MEDIA_MAX_TOTAL_BYTES)`
  const diskWall =
    `the ${formatBytes(capacity.minFreeBytes)} of free disk the server keeps ` +
    "(MEDIA_MIN_FREE_BYTES)"
  const about = planned.estimatedOriginals > 0 ? "about " : ""

  /** @param {number} need @param {number} room */
  const levelOf = (need, room) =>
    need > room ? "over" : room - need < room * TIGHT_CAPACITY_FRACTION ? "tight" : "ok"
  const capLevel = levelOf(planned.originals, toCap)
  const diskLevel = Number.isFinite(toDisk) ? levelOf(onDisk, toDisk) : "ok"
  const mark = (/** @type {string} */ level) =>
    level === "over" ? "✗" : level === "tight" ? "!" : "✓"

  const lines = [
    `${mark(capLevel)} Storage: ${about}${formatBytes(planned.originals)} of originals planned, ` +
      `${formatBytes(toCap)} remaining before ${capWall}.`,
  ]
  if (Number.isFinite(toDisk)) {
    lines.push(
      `${mark(diskLevel)} Disk: about ${formatBytes(onDisk)} with variants, ` +
        `${formatBytes(toDisk)} remaining before ${diskWall}.`,
    )
  }
  const level = [capLevel, diskLevel].includes("over")
    ? "over"
    : [capLevel, diskLevel].includes("tight")
      ? "tight"
      : "ok"
  if (level === "over") {
    lines.push(
      "  This import would stop partway with a 507. Hidden photos count toward the total, " +
        "so hiding them saves no room. Make room, raise the limit, or import fewer files.",
    )
  } else if (level === "tight") {
    lines.push("  That's close, and the variant sizes are estimates.")
  }
  return { level, lines }
}

/** Statuses a row can be compared in. Rejected and in-flight rows are left alone. */
/** @type {Set<string>} */
const COMPARABLE = new Set([MEDIA_STATUS.APPROVED, MEDIA_STATUS.HIDDEN, MEDIA_STATUS.PENDING])

/** @type {Types.compareWithSelection} */
export function compareWithSelection(rows, selection) {
  /** @type {Types.SelectionCheck} */
  const check = { toHide: [], toShow: [], checked: 0 }
  /** @type {Set<number>} */
  const seen = new Set()
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    // Unknown is compared, not skipped: a row nobody could read might be public.
    if (row.status !== null && !COMPARABLE.has(row.status)) continue
    check.checked++
    const entry = { name: row.name, id: row.id, status: row.status, unrecorded: row.unrecorded }
    if (selection.has(row.sha256)) {
      if (row.status === MEDIA_STATUS.HIDDEN || row.status === MEDIA_STATUS.PENDING) {
        check.toShow.push(entry)
      }
    } else if (row.status !== MEDIA_STATUS.HIDDEN) {
      check.toHide.push(entry)
    }
  }
  return check
}

/** A disagreeing row that is (or may be) public: the ones that stop a run. */
function isBlocking(/** @type {Types.SelectionDisagreement} */ row) {
  return row.status === null || row.status === MEDIA_STATUS.APPROVED
}

/** One line naming a row, for the owner's terminal. Never written to a file. */
function describeRow(/** @type {Types.SelectionDisagreement} */ row) {
  const where = row.unrecorded ? "  (not in this manifest; found by content)" : ""
  return `${row.name}  media ${row.id}${where}`
}

/** Human labels for the skip taxonomy.
 *  @type {Record<string, string>} */
const SKIP_LABEL = {
  ALREADY_IMPORTED: "already imported",
  UNSUPPORTED_SOURCE: "not a media file",
  SOURCE_TOO_LARGE: "over the size limit",
  VIDEO_TOO_LONG: "over the duration limit",
  NO_VIDEO_BACKEND: "no video backend",
  UNREADABLE_DIMENSIONS: "unreadable",
  NO_IMAGE_BACKEND: "no image backend",
}

/** Build the sink the arguments ask for. */
function defaultCreateSink(/** @type {Types.ImportArgs} */ args) {
  if (args.url) return createHttpSink({ url: args.url, verbose: args.verbose })
  return createLocalSink({ readOnly: args.dryRun })
}

/** @type {Types.runImport} */
export async function runImport(args, deps = {}) {
  const probe = deps.probeBackends ?? probeBackends
  const build = deps.buildMediaVariants ?? buildMediaVariants
  const createSink = deps.createSink ?? defaultCreateSink
  const out = deps.stdout ?? process.stdout
  const err = deps.stderr ?? process.stderr
  const nowIso = deps.now ?? (() => new Date().toISOString())

  const write = (/** @type {string} */ line) => out.write(line + "\n")
  const note = (/** @type {string} */ line) => err.write(line + "\n")

  /** @type {Types.ImportReport} */
  const report = {
    startedAt: nowIso(),
    finishedAt: null,
    dir: args.dir,
    section: args.section,
    sink: args.url ? "http" : "local",
    dryRun: args.dryRun,
    imported: [],
    skipped: [],
    failed: [],
    unattempted: [],
    warnings: [],
    exitCode: EXIT.CLEAN,
  }

  /** Finish the run, writing --report if asked. */
  const finish = (/** @type {number} */ exitCode) => {
    report.exitCode = exitCode
    report.finishedAt = nowIso()
    if (args.reportPath) {
      fs.mkdirSync(path.dirname(args.reportPath), { recursive: true })
      fs.writeFileSync(args.reportPath, JSON.stringify(report, null, 2) + "\n")
      note(`Report written to ${args.reportPath}`)
    }
    return report
  }

  // ---- Run-fatal checks, before anything is read ------------------------

  // First, before any network or disk work: a selection that can't be trusted
  // must never get as far as an upload.
  /** @type {Set<string> | null} */
  let selection = null
  if (args.selectionPath) {
    const loaded = loadSelection(args.selectionPath)
    if (!loaded.valid) {
      note(`✗ --selection ${args.selectionPath}: ${loaded.error}`)
      return finish(EXIT.ABORTED)
    }
    selection = loaded.value
  }

  let stat
  try {
    stat = fs.statSync(args.dir)
  } catch {
    note(`✗ No such directory: ${args.dir}`)
    return finish(EXIT.ABORTED)
  }
  if (!stat.isDirectory()) {
    note(`✗ Not a directory: ${args.dir}`)
    return finish(EXIT.ABORTED)
  }

  // Still before any network or disk work: a destination a selection imported
  // into must not quietly get an unselected run. Everything it uploaded would
  // finish visible, rejects included.
  const origin = args.url ? normalizeOrigin(args.url) : "local:" + args.dir
  const manifest = loadManifest(args.manifestPath)
  const recorded = manifestRows(manifest, origin)
  const mark = manifestSelection(manifest, origin)

  /** Refuse a run without --selection, saying why and what the two ways on are. */
  const refuseUnselected = (/** @type {string} */ reason) => {
    note(`✗ Refusing to start: ${reason}`)
    note(
      "  Without --selection, every file this run uploads finishes visible, including any a " +
        "selection left out.",
    )
    note(
      `  Pass ${shellQuote(`--selection=${mark ? mark.path : "FILE"}`)} again (or an updated ` +
        "one), or --no-selection to import everything visible.",
    )
    return finish(EXIT.ABORTED)
  }

  if (!selection && !args.noSelection) {
    const recordedHidden = recorded.filter((row) => row.status === MEDIA_STATUS.HIDDEN).length
    if (mark) {
      return refuseUnselected(
        `an earlier run to this destination used --selection=${mark.path} ` +
          `(${mark.at.slice(0, 10)}).`,
      )
    }
    if (recordedHidden > 0) {
      return refuseUnselected(
        `${recordedHidden} row(s) this manifest records are hidden, so an earlier run used ` +
          "a selection.",
      )
    }
  }

  const backends = await probe({ skipVideo: false })
  if (!backends.image) {
    note("✗ No image tool available, and every import needs one to build display and thumb variants.")
    note("")
    note(imageBackendInstallHint())
    return finish(EXIT.ABORTED)
  }
  if (!backends.video && args.videos === "require") {
    note("✗ --videos=require was given, but there is no video backend.")
    note("")
    note(videoBackendInstallHint())
    return finish(EXIT.ABORTED)
  }

  // The manifest and the report may legitimately sit inside the directory being
  // imported — --manifest= exists precisely so the record can live beside the
  // photos on an external drive. Reporting them as "not a media file" on every
  // run would be noise the user can't act on.
  const ownFiles = new Set([
    args.manifestPath,
    args.manifestPath + ".tmp",
    ...(args.reportPath ? [args.reportPath] : []),
    ...(args.selectionPath ? [args.selectionPath] : []),
  ])
  const files = scanDirectory(args.dir, { recursive: args.recursive }).filter(
    (file) => !ownFiles.has(file.absolute),
  )
  if (files.length === 0) {
    note(`✗ ${args.dir} contains no files${args.recursive ? "" : " (try --recursive)"}.`)
    return finish(EXIT.ABORTED)
  }

  const sink = createSink(args)
  /** Set when a lookup or a status change gave the manifest something new. */
  let manifestDirty = false

  try {
    const preflight = await sink.preflight()

    note(`Reading ${files.length} file(s)…`)
    const plan = await buildPlan(
      {
        files,
        backends,
        manifest,
        origin,
        force: args.force,
        captions: args.captions,
        order: args.order,
        concurrency: args.concurrency,
        selection,
      },
      deps,
    )
    report.skipped = plan.skipped.map((s) => ({
      file: s.file.relative,
      code: s.code,
      message: s.message,
    }))

    for (const line of formatPlanReport(args, backends, preflight, plan)) write(line)
    if (selection) {
      write("")
      for (const line of formatSelectionReport(args, selection, plan)) write(line)
    }
    if (args.noSelection) {
      write("")
      write(
        "! --no-selection: every file this run uploads finishes visible, even one an earlier " +
          "selection left out. Rows already imported keep their status.",
      )
    }

    // ---- Rows already on the destination ---------------------------------

    /** The file's name in this directory now, by content. */
    /** @type {Map<string, string>} */
    const nameBySha = new Map()
    for (const skip of plan.skipped) if (skip.sha256) nameBySha.set(skip.sha256, skip.file.relative)
    for (const item of plan.items) nameBySha.set(item.sha256, item.file.relative)

    // Rows holding this content that the manifest doesn't know about: a lost or
    // different --manifest, a moved directory, a row --force replaced before
    // statuses were kept. Only the local sink can search by content.
    const recordedIds = new Set(recorded.map((row) => row.id))
    /** @type {Map<string, Types.ContentMatch[]>} */
    const unrecordedBySha = new Map()
    let searchedByContent = false
    if (!args.noSelection && nameBySha.size > 0) {
      const found = await sink.findByContent([...nameBySha.keys()])
      if (found) {
        searchedByContent = true
        for (const [sha256, matches] of found) {
          const extra = matches.filter((match) => !recordedIds.has(match.id))
          if (extra.length > 0) unrecordedBySha.set(sha256, extra)
        }
      }
    }

    // Current statuses, from the destination rather than the manifest: the
    // couple may have hidden or approved rows since. A selection run asks about
    // every recorded row; an unselected one only about rows recorded before the
    // manifest kept statuses, to learn whether a selection was ever used.
    const legacy = recorded.filter((row) => row.status === null)
    const toLookUp = selection ? recorded : args.noSelection ? [] : legacy
    /** @type {Types.RowStatusLookup | null} */
    const lookup = toLookUp.length > 0 ? await sink.statuses(toLookUp.map((row) => row.id)) : null
    /** @type {Map<number, string | null>} */
    const statusOf = new Map()
    /** @type {Set<number>} */
    const gone = new Set()
    for (const row of recorded) {
      const answered = lookup?.ok ? lookup.statuses.get(row.id) : undefined
      if (lookup?.ok && lookup.statuses.has(row.id) && answered === null) gone.add(row.id)
      else statusOf.set(row.id, answered ?? row.status)
      if (typeof answered === "string" && answered !== row.status) {
        manifestSetStatus(manifest, origin, row.id, answered)
        manifestDirty = true
      }
    }

    const duplicates = plan.items.filter((item) => unrecordedBySha.has(item.sha256))

    if (!selection && !args.noSelection) {
      if (legacy.length > 0 && lookup && !lookup.ok) {
        return refuseUnselected(
          `this manifest predates recording selections, and the destination couldn't say ` +
            `whether its ${legacy.length} row(s) are hidden (${lookup.message}).`,
        )
      }
      const legacyHidden = legacy.filter(
        (row) => statusOf.get(row.id) === MEDIA_STATUS.HIDDEN,
      ).length
      if (legacyHidden > 0) {
        return refuseUnselected(
          `this manifest predates recording selections, and ${legacyHidden} of its rows are ` +
            "hidden on the destination.",
        )
      }
      const hiddenCopies = duplicates.filter((item) =>
        (unrecordedBySha.get(item.sha256) ?? []).some(
          (match) => match.status === MEDIA_STATUS.HIDDEN,
        ),
      )
      if (hiddenCopies.length > 0) {
        for (const item of hiddenCopies) {
          const ids = (unrecordedBySha.get(item.sha256) ?? [])
            .filter((match) => match.status === MEDIA_STATUS.HIDDEN)
            .map((match) => match.id)
            .join(", ")
          note(`    ${item.file.relative}  hidden as media ${ids}`)
        }
        return refuseUnselected(
          `${hiddenCopies.length} file(s) this run would upload visible are already on the ` +
            "destination as hidden rows (listed above).",
        )
      }
    }

    if (duplicates.length > 0) {
      write("")
      write(
        `! ${duplicates.length} file(s) are already on the destination under rows this manifest ` +
          "doesn't record. This run uploads another copy of each.",
      )
    }

    /** @type {Types.SelectionCheck | null} */
    let check = null
    if (selection) {
      /** @type {Types.CheckableRow[]} */
      const rows = recorded
        .filter((row) => !gone.has(row.id))
        .map((row) => ({
          sha256: row.sha256,
          name: nameBySha.get(row.sha256) ?? row.name,
          id: row.id,
          status: statusOf.get(row.id) ?? null,
          unrecorded: false,
        }))
      for (const [sha256, matches] of unrecordedBySha) {
        for (const match of matches) {
          rows.push({
            sha256,
            name: nameBySha.get(sha256) ?? sha256.slice(0, 12),
            id: match.id,
            status: match.status,
            unrecorded: true,
          })
        }
      }
      check = compareWithSelection(rows, selection)

      write("")
      if (lookup && !lookup.ok) {
        write(`! Couldn't read current statuses from the destination: ${lookup.message}`)
        write("  Using what the manifest last recorded; a row it has none for counts as unknown.")
      } else if (legacy.length > 0) {
        write(
          `  ${legacy.length} recorded row(s) predate the manifest keeping statuses; ` +
            "read from the destination instead.",
        )
      }
      if (!searchedByContent && recorded.length === 0 && args.url) {
        write(
          `! Nothing is recorded for ${args.url} in this manifest, and --url can't find rows by ` +
            "content. If another manifest imported these photos, check those rows in the admin.",
        )
      }
      if (check.toHide.length + check.toShow.length === 0) {
        if (check.checked > 0) {
          write(`✓ The ${check.checked} row(s) already imported match the selection.`)
        }
      } else {
        write("Already imported, and not what the selection says:")
        for (const row of check.toHide) {
          write(
            `  ${isBlocking(row) ? "✗" : "!"} ${describeRow(row)}  ` +
              `${row.status ?? "status unknown"}; the selection leaves it out`,
          )
        }
        for (const row of check.toShow) {
          write(`  ! ${describeRow(row)}  ${row.status}; the selection lists it`)
        }
      }
    }
    const blocking = check ? check.toHide.filter(isBlocking) : []
    const disagreeing = check ? check.toHide.length + check.toShow.length : 0

    /** The refusal that names the rows' fix as a command to paste. */
    const printSelectionStop = () => {
      const unknown = blocking.some((row) => row.status === null)
      note("")
      note(
        `✗ Refusing to start: ${blocking.length} row(s) the selection leaves out ` +
          `${unknown ? "are public or of unknown status" : "are public"}. ` +
          "To hide them, and show any it now lists, run:",
      )
      note(`    ${applySelectionCommand(args)}`)
    }
    /** Status changes --apply-selection couldn't make; the run still fails for them. */
    let applyFailures = 0

    // What the destination has left. Stdout only: these are facts about a real
    // import, so they go nowhere near --report or any other file.
    const capacity = preflight.ok && plan.items.length > 0 ? await sink.capacity() : null
    const assessed = capacity ? assessCapacity(planStoredBytes(plan.items, args), capacity) : null
    if (assessed) {
      write("")
      for (const line of assessed.lines) write(line)
    }
    const overCapacity = assessed?.level === "over"
    // A server without the endpoint also ignores `hidden` at finalize, and would
    // publish every reject.
    const unsupported = capacity !== null && !capacity.ok && capacity.reason === "unsupported"

    if (args.dryRun) {
      if (check && disagreeing > 0) {
        if (args.applySelection) {
          write("")
          write(
            `--apply-selection would hide ${check.toHide.length} and show ` +
              `${check.toShow.length} row(s).`,
          )
        } else if (blocking.length > 0) {
          printSelectionStop()
        } else {
          write("  Re-run with --apply-selection to show them.")
        }
      }
      write("")
      write("Dry run — nothing was written. Re-run without --dry-run to import.")
      const refused =
        overCapacity ||
        (selection !== null && unsupported) ||
        (blocking.length > 0 && !args.applySelection)
      return finish(preflight.ok && !refused ? EXIT.CLEAN : EXIT.ABORTED)
    }
    if (!preflight.ok) {
      note("")
      note("✗ Refusing to start: " + (preflight.message ?? "the destination cannot accept an import."))
      return finish(EXIT.ABORTED)
    }

    if (check && disagreeing > 0) {
      if (!args.applySelection) {
        if (blocking.length > 0) {
          if (manifestDirty) saveManifest(args.manifestPath, manifest)
          printSelectionStop()
          return finish(EXIT.ABORTED)
        }
        write("  Re-run with --apply-selection to show them.")
      } else {
        // Before any upload, so a run that stops partway has still taken the
        // rejects down first.
        const contentMatches = new Map(
          [...unrecordedBySha.values()].flat().map((match) => [match.id, match]),
        )
        /** @param {Types.SelectionDisagreement} row @param {"hidden" | "approved"} status */
        const change = async (row, status) => {
          let result
          try {
            result = await sink.setStatus(row.id, status)
          } catch (err) {
            result = { ok: false, message: err instanceof Error ? err.message : String(err) }
          }
          if (result.ok) {
            if (manifestSetStatus(manifest, origin, row.id, status)) manifestDirty = true
            const match = contentMatches.get(row.id)
            if (match) match.status = status
            return true
          }
          const verb = status === MEDIA_STATUS.HIDDEN ? "hide" : "show"
          const reason = result.message ?? "no reason given"
          note(`  ✗ Couldn't ${verb} ${describeRow(row)}: ${reason}`)
          report.warnings.push(`Couldn't ${verb} media ${row.id}: ${reason}`)
          applyFailures++
          return false
        }
        let hid = 0
        let showed = 0
        let hideFailed = 0
        for (const row of check.toHide) {
          if (await change(row, MEDIA_STATUS.HIDDEN)) hid++
          else if (isBlocking(row)) hideFailed++
        }
        for (const row of check.toShow) if (await change(row, MEDIA_STATUS.APPROVED)) showed++
        write("")
        write(`Hid ${hid} row(s) and showed ${showed} to match the selection.`)
        if (hideFailed > 0) {
          if (manifestDirty) saveManifest(args.manifestPath, manifest)
          note("")
          note(
            `✗ Stopping before any upload: ${hideFailed} row(s) the selection leaves out ` +
              "may still be public (see above). Hide them in the admin Gallery tab, or re-run.",
          )
          return finish(EXIT.ABORTED)
        }
      }
    }

    // From here this destination has had a selection run, and the manifest says
    // so before the first upload: a run killed partway still leaves the guard.
    if (selection && args.selectionPath) {
      manifestMarkSelection(manifest, origin, { path: args.selectionPath, at: nowIso() })
      manifestDirty = true
    }
    if (manifestDirty) saveManifest(args.manifestPath, manifest)

    if (plan.items.length === 0) {
      write("")
      write("Nothing to import.")
      return finish(applyFailures > 0 ? EXIT.SOME_FAILED : EXIT.CLEAN)
    }
    // A selection run doesn't start what it can't finish safely. Without one, a
    // full destination still stops the run where it always did, at the first 507.
    if (selection && (overCapacity || (capacity !== null && !capacity.ok))) {
      note("")
      note(
        "✗ Refusing to start: " +
          (overCapacity
            ? "this import doesn't fit, and it would stop partway."
            : "the destination couldn't confirm it can take a hidden import (see above)."),
      )
      return finish(EXIT.ABORTED)
    }

    // ---- The run ---------------------------------------------------------

    /** Sessions created but not yet finalized, so SIGINT can clean them up. */
    /** @type {Set<number>} */
    const openSessions = new Set()
    let aborted = false
    /** Whether the abort came from a signal rather than a fatal sink failure. */
    let interrupted = false
    let nextIndex = 0
    let done = 0

    /**
     * Failures that make every remaining file pointless. Storage is full, or the
     * admin session died: attempting the other 199 would produce 199 identical
     * errors and bury the one line that matters.
     * @type {Set<string>}
     */
    const FATAL_CODES = new Set(["DESTINATION_FULL", "AUTH_LOST", "HIDDEN_NOT_HONOURED"])

    const onSignal = () => {
      // A fatal sink failure may already have set `aborted`; the signal still
      // wins the exit code, because the operator's Ctrl-C is the more specific
      // statement about why the run stopped.
      interrupted = true
      if (aborted) return
      aborted = true
      note("\n! Interrupted — finishing the files in flight, then cleaning up.")
    }
    process.on("SIGINT", onSignal)
    process.on("SIGTERM", onSignal)

    /**
     * One file, end to end. Generation and upload share a worker rather than
     * running in two pools: a worker uploading is a worker not generating, so
     * the overlap is the same, temp disk is bounded at concurrency × one file's
     * variants, and there is no hand-off queue to drain on abort.
     * @param {Types.PlannedItem} item
     */
    async function importOne(item) {
      /** @type {Types.BuiltMedia | null} */
      let built = null
      /** @type {number | null} */
      let sessionId = null
      try {
        built = await build(item.plan, backends, {
          section: args.section,
          stripOriginal: args.stripOriginal,
          heicOriginal: args.heicOriginal,
        })
        const original = built.artifacts.find((a) => a.name === "original")
        if (!original) throw new Error("variant builder produced no original")

        const session = await sink.createSession({
          kind: built.kind,
          originalBytes: original.bytes,
          section: args.section,
        })
        sessionId = session.id
        openSessions.add(session.id)

        for (const artifact of built.artifacts) {
          await sink.putVariant(session.id, artifact.name, {
            path: artifact.path,
            bytes: artifact.bytes,
            contentType: artifact.contentType,
          })
        }

        const finalized = await sink.finalize(session.id, {
          width: built.width,
          height: built.height,
          durationS: built.durationSeconds,
          caption: item.caption,
          sourceSha256: item.sha256,
          hidden: item.hidden,
        })
        // Believe the status that came back, not the one asked for. Thrown while
        // sessionId is still set, so the catch below discards the row.
        if (item.hidden && finalized.status !== MEDIA_STATUS.HIDDEN) {
          throw new MediaImportError(
            "HIDDEN_NOT_HONOURED",
            `${item.file.relative} was asked to finish hidden but came back ` +
              `"${finalized.status}" as media ${finalized.id}.`,
          )
        }
        openSessions.delete(session.id)
        // Past this line the row exists and is finished, so the catch below must
        // not discard it. Everything that follows can still throw —
        // saveManifest() writes to whatever --manifest= names, which the docs
        // encourage putting beside the photos on an external drive — and
        // destroying a good import because its bookkeeping failed would be a far
        // worse outcome than an unrecorded row the next run re-imports.
        sessionId = null

        report.imported.push({
          file: item.file.relative,
          id: finalized.id,
          fileKey: session.fileKey,
          sha256: item.sha256,
          bytes: original.bytes,
          width: built.width,
          height: built.height,
          status: finalized.status,
        })
        for (const warning of built.warnings) {
          report.warnings.push(`${item.file.relative}: ${warning}`)
          if (args.verbose) note(`  ! ${item.file.relative}: ${warning}`)
        }

        // Recorded after every finalize, not once at the end: a run killed
        // halfway leaves a manifest that makes the next run resume rather than
        // re-import what already landed.
        const at = nowIso()
        const copies = unrecordedBySha.get(item.sha256) ?? []
        manifestRecord(manifest, origin, item.sha256, {
          id: finalized.id,
          fileKey: session.fileKey,
          section: args.section,
          name: item.file.relative,
          bytes: original.bytes,
          at,
          status: finalized.status,
          // Rows found by content join the record, so the next selection run
          // compares them too even if this manifest is the only one left.
          ...(copies.length > 0
            ? {
                earlier: copies.map((match) => ({
                  id: match.id,
                  section: match.section,
                  status: match.status,
                  at,
                })),
              }
            : {}),
        })
        saveManifest(args.manifestPath, manifest)

        done++
        note(`  [${done}/${plan.items.length}] ${item.file.relative} → media ${finalized.id}`)
      } catch (error) {
        /** Why the row couldn't be removed; null when it was, or there was none. */
        /** @type {string | null} */
        let discardFailure = null
        if (sessionId !== null) {
          // A half-uploaded row would otherwise sit 'uploading' pressing its
          // declared bytes against the disk guard until the daily sweep.
          try {
            await sink.discard(sessionId)
          } catch (discardError) {
            discardFailure =
              discardError instanceof Error ? discardError.message : String(discardError)
          }
          openSessions.delete(sessionId)
        }
        const code = isMediaImportError(error) ? error.code : "BACKEND_FAILED"
        let message = error instanceof Error ? error.message : String(error)
        // Say what actually happened to the row, never what was meant to.
        if (code === "HIDDEN_NOT_HONOURED") {
          message +=
            discardFailure === null
              ? " It was deleted again. Does the server support hidden imports?"
              : ` Deleting it failed (${discardFailure}), so it may still be public: hide or ` +
                `delete media ${sessionId} in the admin now.`
        } else if (discardFailure !== null) {
          message +=
            ` Its unfinished row, media ${sessionId}, couldn't be removed (${discardFailure}).`
        }
        report.failed.push({
          file: item.file.relative,
          code,
          message,
          detail: isMediaImportError(error) ? (error.detail ?? null) : null,
        })
        done++
        note(`  [${done}/${plan.items.length}] ✗ ${item.file.relative} — ${message}`)
        if (args.verbose && isMediaImportError(error) && error.detail) {
          note(`      ${error.detail.split("\n").join("\n      ")}`)
        }
        if (FATAL_CODES.has(code) && !aborted) {
          aborted = true
          note(`! Stopping — ${message}`)
        }
      } finally {
        await built?.dispose()
      }
    }

    write("")
    try {
      await Promise.all(
        new Array(Math.min(args.concurrency, plan.items.length)).fill(null).map(async () => {
          while (nextIndex < plan.items.length && !aborted) {
            await importOne(plan.items[nextIndex++])
          }
        }),
      )
    } finally {
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      for (const id of openSessions) await sink.discard(id).catch(() => {})
      saveManifest(args.manifestPath, manifest)
    }

    for (let i = nextIndex; i < plan.items.length; i++) {
      report.unattempted.push(plan.items[i].file.relative)
    }

    // ---- Ordering --------------------------------------------------------

    const curated = isCuratedMediaSection(args.section) ? args.section : null
    if (curated !== null && !args.skipReorder && report.imported.length > 0) {
      // The imported ids in plan order, so sort_order matches the filename (or
      // mtime) order the user asked for — within the curated section imported to.
      const byFile = new Map(report.imported.map((row) => [row.file, row.id]))
      const orderedIds = plan.items
        .map((item) => byFile.get(item.file.relative))
        .filter((id) => typeof id === "number")
      const ordering = await sink.applyOrder(orderedIds, curated)
      if (!ordering.ok) {
        report.warnings.push(ordering.message ?? "Couldn't set the gallery order.")
        note(`! ${ordering.message ?? "Couldn't set the gallery order."}`)
      }
    }

    // ---- Summary ---------------------------------------------------------

    write("")
    const publicCount = report.imported.filter((row) => row.status === MEDIA_STATUS.APPROVED).length
    const hiddenCount = report.imported.filter((row) => row.status === MEDIA_STATUS.HIDDEN).length
    write(
      `Imported ${report.imported.length} of ${plan.items.length} file(s): ` +
        `${publicCount} public, ${hiddenCount} hidden.`,
    )
    if (report.skipped.length > 0) write(`Skipped ${report.skipped.length}.`)
    if (report.failed.length > 0) {
      write(`Failed ${report.failed.length}:`)
      for (const failure of report.failed) write(`    ${failure.file} — ${failure.message}`)
    }
    if (report.unattempted.length > 0) {
      write(`Not attempted (the run stopped early): ${report.unattempted.length}.`)
    }
    if (report.warnings.length > 0 && !args.verbose) {
      write(`${report.warnings.length} warning(s) — re-run with --verbose to see them.`)
    }
    if (report.imported.length > 0) {
      write("")
      if (curated !== null) {
        write("Check them in the admin Gallery tab; captions are editable inline there.")
      } else if (publicCount > 0) {
        write(
          publicCount === report.imported.length
            ? "They are live in the guest gallery at /gallery."
            : `The ${publicCount} public one(s) are live in the guest gallery at /gallery.`,
        )
      }
      if (hiddenCount > 0) {
        write(
          curated !== null
            ? "Hidden photos are under Hidden in the admin Gallery tab, and can be unhidden there."
            : "Hidden photos are under Hidden in the admin Review tab, and can be unhidden there.",
        )
      }
    }

    if (aborted) return finish(interrupted ? EXIT.INTERRUPTED : EXIT.ABORTED)
    return finish(report.failed.length > 0 || applyFailures > 0 ? EXIT.SOME_FAILED : EXIT.CLEAN)
  } finally {
    await sink.close().catch(() => {})
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.valid) {
    process.stderr.write(parsed.error + "\n")
    process.exit(EXIT.ABORTED)
  }
  const report = await runImport(parsed.value)
  process.exit(report.exitCode)
}

// Run only when invoked directly, so tests can import runImport.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main()
}
