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
 *  what makes .DS_Store, .AAE sidecars and stray text files skip themselves. */
/** @import * as Types from './lib/types.js' */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { sanitize } from "../core/http.js"
import { LIMITS, MEDIA_KIND, MEDIA_SECTION } from "../types.js"
import { describeBackends, imageBackendInstallHint, videoBackendInstallHint } from "./lib/image-backend.js"
import {
  hashFile,
  loadManifest,
  manifestHas,
  manifestRecord,
  normalizeOrigin,
  saveManifest,
} from "./lib/import-manifest.js"
import { isMediaImportError } from "./lib/media-errors.js"
import { buildMediaVariants, planMediaFile, probeBackends } from "./lib/media-variants.js"
import { createHttpSink } from "./lib/sink-http.js"
import { createLocalSink } from "./lib/sink-local.js"

const USAGE = `Usage: npm run import:media -- <dir> [options]

  <dir>                     Directory of photos/videos to import (required).

  --section=official|guest  Which gallery section. Default: official.
  --dry-run                 Report what would happen. Touches no write path.
  --url=URL                 Import over the API instead of writing locally.

  --recursive               Descend into subdirectories.
  --order=name|mtime        Import order. Default: name (ascending, code-unit).
  --captions=sidecar        Read IMG_1234.txt next to IMG_1234.jpg as the caption.
  --concurrency=N           Files in flight. Default: min(8, cores - 1).

  --manifest=PATH           Idempotency record. Default: <data dir>/import-manifest.json.
  --report=PATH             Write the run summary as JSON.
  --force                   Import even files the manifest already records.
  --skip-reorder            Leave sort_order alone (official section only).

  --strip-original          Also remove EXIF from the stored originals.
  --heic-original=keep|jpeg Store HEIC originals as-is, or re-encode to JPEG.
  --videos=skip|require     Missing ffmpeg skips videos, or fails the run.
  --verbose                 Per-file detail, including backend stderr.
`

/** Flags whose value must come from a fixed set.
 *  @type {Record<string, string[]>} */
const ENUM_FLAGS = {
  section: [MEDIA_SECTION.OFFICIAL, MEDIA_SECTION.GUEST],
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
  "help",
]

const VALUE_FLAGS = ["url", "concurrency", "manifest", "report", ...Object.keys(ENUM_FLAGS)]

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

  const section = /** @type {"official" | "guest"} */ (values.section ?? MEDIA_SECTION.OFFICIAL)

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
      manifestPath: values.manifest
        ? path.resolve(values.manifest)
        : path.join(defaultDataDir(), "import-manifest.json"),
      reportPath: values.report ? path.resolve(values.report) : null,
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
          }
        } else {
          result = {
            file,
            plan,
            sha256,
            caption: input.captions === "sidecar" ? readSidecarCaption(file.absolute) : null,
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

  const bytes = plan.items.reduce((sum, item) => sum + item.plan.originalBytes, 0)
  const images = plan.items.filter((i) => i.plan.kind === MEDIA_KIND.IMAGE).length
  const videos = plan.items.length - images
  push(
    `${plan.items.length} file(s) to import — ${images} photo(s), ${videos} video(s), ` +
      `${formatBytes(bytes)} of originals.`,
  )

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
          `(${item.plan.width}×${item.plan.height}, ${formatBytes(item.plan.originalBytes)})`,
      )
    }
    if (preview.length < plan.items.length) {
      push(`  … and ${plan.items.length - preview.length} more (--verbose to list)`)
    }
  }
  return lines
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
  ])
  const files = scanDirectory(args.dir, { recursive: args.recursive }).filter(
    (file) => !ownFiles.has(file.absolute),
  )
  if (files.length === 0) {
    note(`✗ ${args.dir} contains no files${args.recursive ? "" : " (try --recursive)"}.`)
    return finish(EXIT.ABORTED)
  }

  const sink = createSink(args)
  const origin = args.url ? normalizeOrigin(args.url) : "local:" + args.dir
  const manifest = loadManifest(args.manifestPath)

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
      },
      deps,
    )
    report.skipped = plan.skipped.map((s) => ({
      file: s.file.relative,
      code: s.code,
      message: s.message,
    }))

    for (const line of formatPlanReport(args, backends, preflight, plan)) write(line)

    if (args.dryRun) {
      write("")
      write("Dry run — nothing was written. Re-run without --dry-run to import.")
      return finish(preflight.ok ? EXIT.CLEAN : EXIT.ABORTED)
    }
    if (!preflight.ok) {
      note("")
      note("✗ Refusing to start: " + (preflight.message ?? "the destination cannot accept an import."))
      return finish(EXIT.ABORTED)
    }
    if (plan.items.length === 0) {
      write("")
      write("Nothing to import.")
      return finish(EXIT.CLEAN)
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
    const FATAL_CODES = new Set(["DESTINATION_FULL", "AUTH_LOST"])

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
        })
        openSessions.delete(session.id)
        // Past this line the row exists and is approved, so the catch below must
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
        })
        for (const warning of built.warnings) {
          report.warnings.push(`${item.file.relative}: ${warning}`)
          if (args.verbose) note(`  ! ${item.file.relative}: ${warning}`)
        }

        // Recorded after every finalize, not once at the end: a run killed
        // halfway leaves a manifest that makes the next run resume rather than
        // re-import what already landed.
        manifestRecord(manifest, origin, item.sha256, {
          id: finalized.id,
          fileKey: session.fileKey,
          section: args.section,
          name: item.file.relative,
          bytes: original.bytes,
          at: nowIso(),
        })
        saveManifest(args.manifestPath, manifest)

        done++
        note(`  [${done}/${plan.items.length}] ${item.file.relative} → media ${finalized.id}`)
      } catch (error) {
        if (sessionId !== null) {
          // A half-uploaded row would otherwise sit 'uploading' pressing its
          // declared bytes against the disk guard until the daily sweep.
          await sink.discard(sessionId).catch(() => {})
          openSessions.delete(sessionId)
        }
        const code = isMediaImportError(error) ? error.code : "BACKEND_FAILED"
        const message = error instanceof Error ? error.message : String(error)
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

    if (args.section === MEDIA_SECTION.OFFICIAL && !args.skipReorder && report.imported.length > 0) {
      // The imported ids in plan order, so sort_order matches the filename (or
      // mtime) order the user asked for.
      const byFile = new Map(report.imported.map((row) => [row.file, row.id]))
      const orderedIds = plan.items
        .map((item) => byFile.get(item.file.relative))
        .filter((id) => typeof id === "number")
      const ordering = await sink.applyOrder(orderedIds)
      if (!ordering.ok) {
        report.warnings.push(ordering.message ?? "Couldn't set the gallery order.")
        note(`! ${ordering.message ?? "Couldn't set the gallery order."}`)
      }
    }

    // ---- Summary ---------------------------------------------------------

    write("")
    write(`Imported ${report.imported.length} of ${plan.items.length} file(s).`)
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
      write(
        args.section === MEDIA_SECTION.OFFICIAL
          ? "Check them in the admin Gallery tab; captions are editable inline there."
          : "They are live in the guest gallery at /gallery.",
      )
    }

    if (aborted) return finish(interrupted ? EXIT.INTERRUPTED : EXIT.ABORTED)
    return finish(report.failed.length > 0 ? EXIT.SOME_FAILED : EXIT.CLEAN)
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
