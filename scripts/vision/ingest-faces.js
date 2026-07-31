#!/usr/bin/env node
/** @file CLI: join a session1 vision run's `photos.jsonl`/`faces.jsonl` to
 *  already-imported `media` rows by content hash, and insert `media_faces` rows
 *  (source='cli') for every face of a matched photo
 *  (docs/post-wedding/SPEC-vision-lab.md §10/§11).
 *
 *  Two jobs behind one entry point, either or both per invocation:
 *
 *   1. `--backfill-manifest PATH` populates `media.source_sha256` from the bulk
 *      importer's manifest (scripts/lib/import-manifest.js) for rows that don't
 *      have it yet — nothing else in the pipeline writes that column (see
 *      schema.js's add_media_faces migration comment).
 *   2. The main pass: read `<run-dir>/photos.jsonl` + `faces.jsonl`, join each
 *      photo's sha256 to `media.source_sha256`, and insert one `media_faces`
 *      row per face of a matched photo. `--model-version` is required and never
 *      inferred — a model swap must never silently mix descriptor spaces
 *      (SPEC §10). Re-running for a (media_id, model_version) that already has
 *      live 'cli' rows is refused unless `--replace` is passed, which
 *      soft-deletes the old rows first.
 *
 *  §15 (no photo snooping): this script's <run-dir>/manifest path is its own
 *  explicit argv, which is the one thing the rule permits — it is not
 *  searching a photo library. It never reads a photograph; only JSONL records
 *  session1.js already wrote. Console output is counts only — never a
 *  filename or path of an unmatched photo, which could itself identify
 *  someone.
 *
 *  Uses its own DatabaseSync + the db/ layer's `sql` template bound to it
 *  (bindExecutor), NOT db/connection.js's process-wide singleton — so
 *  `--database PATH` can point anywhere without an import-order dance, and the
 *  unit tests can point this exact logic at a disposable temp DB. Mirrors
 *  scripts/seed-preview.js / scripts/export-archive.js, which do the same with
 *  raw `db.prepare()` calls; this file additionally binds sql.js so it can
 *  reuse db/media-faces.js's insertFace()/softDeleteFace() rather than
 *  duplicating that INSERT statement.
 */
/** @import * as Types from './types.js' */

import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"

import { createTables, runMigrations } from "../../db/schema.js"
import { bindExecutor, sql } from "../../db/sql.js"
import { now } from "../../db/utils.js"
import { insertFace, descriptorToBlob } from "../../db/media-faces.js"
import { loadManifest } from "../lib/import-manifest.js"
import { frameRoots } from "./session1-report.js"

const USAGE = `Usage: node scripts/vision/ingest-faces.js <run-dir> [options]

  <run-dir>                 Directory holding photos.jsonl + faces.jsonl.
                             Required unless --backfill-manifest is given alone.

  --model-version TAG       Descriptor model tag. Required for the main pass —
                             refuses to guess; a model swap must never silently
                             mix descriptor spaces.
  --replace                 Soft-delete this run's target (media_id, model_version)
                             pairs' previous 'cli' rows before inserting. Without
                             it, a pair that already has live 'cli' rows is refused.
  --database PATH            Override the SQLite file. Default: data/wedding.db.
  --backfill-manifest PATH   Populate media.source_sha256 from an import-media
                              manifest, for rows that don't have it yet.
  --dry-run                  Report counts; write nothing.
  --help                     Show this message.
`

/**
 * No regex, per CLAUDE.md: a manual switch over known flags. Unknown `--flags`
 * are refused rather than silently ignored.
 * @param {string[]} argv
 * @returns {Types.IngestArgsResult}
 */
export function parseArgs(argv) {
  /** @type {string[]} */
  const positionals = []
  /** @type {string | null} */
  let database = null
  /** @type {string | null} */
  let modelVersion = null
  /** @type {string | null} */
  let backfillManifest = null
  let replace = false
  let dryRun = false
  let help = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      help = true
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--replace") {
      replace = true
    } else if (arg === "--database") {
      i++
      if (i >= argv.length) return { valid: false, error: "--database needs a value" }
      database = argv[i]
    } else if (arg === "--model-version") {
      i++
      if (i >= argv.length) return { valid: false, error: "--model-version needs a value" }
      modelVersion = argv[i]
    } else if (arg === "--backfill-manifest") {
      i++
      if (i >= argv.length) return { valid: false, error: "--backfill-manifest needs a value" }
      backfillManifest = argv[i]
    } else if (arg.startsWith("--")) {
      return { valid: false, error: `Unknown option: ${arg}` }
    } else {
      positionals.push(arg)
    }
  }

  if (help) return { valid: false, error: USAGE }

  const runDir = positionals[0] ?? null
  if (!runDir && !backfillManifest) {
    return { valid: false, error: "Nothing to do: pass a run directory, --backfill-manifest, or both.\n\n" + USAGE }
  }

  return {
    valid: true,
    value: { runDir, database, modelVersion, backfillManifest, replace, dryRun },
  }
}

/**
 * One JSONL file. A run killed part-way leaves a truncated final line; a
 * malformed line is counted and skipped, never fatal (same stance as
 * session1-report.js's own copy of this — duplicated rather than shared,
 * matching that file's own precedent of not factoring this out).
 * @template T
 * @param {string} file
 * @returns {{ records: T[], skipped: number, present: boolean }}
 */
export function readJsonl(file) {
  if (!fs.existsSync(file)) return { records: [], skipped: 0, present: false }
  const text = fs.readFileSync(file, "utf8")
  /** @type {T[]} */
  const records = []
  let skipped = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      records.push(/** @type {T} */ (JSON.parse(trimmed)))
    } catch {
      skipped++
    }
  }
  return { records, skipped, present: true }
}

/**
 * Open (creating if needed) a SQLite file, apply the same pragmas/schema the
 * server uses, and bind db/sql.js's `sql` template to THIS connection — not
 * db/connection.js's singleton, so a --database flag or a unit test's temp
 * file needs no import-order gymnastics.
 * @param {string} dbPath
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA busy_timeout = 5000")
  createTables(db)
  runMigrations(db)

  /** @type {Map<string, import('node:sqlite').StatementSync>} */
  const stmtCache = new Map()
  bindExecutor((text) => {
    let stmt = stmtCache.get(text)
    if (!stmt) {
      stmt = db.prepare(text)
      stmtCache.set(text, stmt)
    }
    return stmt
  })

  return db
}

/**
 * @param {string | null} databaseArg
 * @returns {string}
 */
function resolveDbPath(databaseArg) {
  if (databaseArg) return path.resolve(databaseArg)
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH
  return path.join(import.meta.dirname, "..", "..", "data", "wedding.db")
}

/**
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE TRANSACTION")
  let committed = false
  try {
    const result = fn()
    db.exec("COMMIT")
    committed = true
    return result
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK")
      } catch {
        /* already rolled back */
      }
    }
  }
}

/** sha256 (content hash) -> media.id, for every media row that has one. */
export function loadMediaShaMap() {
  /** @type {Array<{ id: number, source_sha256: string }>} */
  const rows = sql`SELECT id, source_sha256 FROM media
    WHERE source_sha256 IS NOT NULL AND deleted_at IS NULL`.all()
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const row of rows) map.set(row.source_sha256, row.id)
  return map
}

/**
 * Pure join: which photos in this run match an already-imported media row, by
 * content hash. No DB access — `mediaBySha` is supplied already queried, so
 * this is unit-testable with a plain Map.
 * @type {Types.joinPhotosToMedia}
 */
export function joinPhotosToMedia(photos, mediaBySha) {
  /** @type {Array<{ photo: Types.Session1PhotoRecord, mediaId: number }>} */
  const matched = []
  let unmatchedCount = 0
  for (const photo of photos) {
    const mediaId = mediaBySha.get(photo.sha256)
    if (mediaId === undefined) {
      unmatchedCount++
      continue
    }
    matched.push({ photo, mediaId })
  }
  return { matched, unmatchedCount }
}

/**
 * Per-photo frame identity and capture time, as the columns want them. Pure —
 * no DB access — so the union-find resolution is unit-testable against plain
 * records.
 *
 * The frame root is the sha256 of the LOWEST-id photo in the duplicate
 * equivalence class, not the class's run-local id: content-addressed, so it
 * means the same thing after a re-run that numbered the photos differently.
 * `frameRoots` is imported from the report, never reimplemented — it is the
 * transitive closure (A->B, C->B puts A and C together), and a one-hop
 * pointer here would silently split exactly the classes it exists to join.
 *
 * A photo with no duplicates is its own root, so every ingested row gets a
 * non-null value and "group by frame" downstream needs no coalesce.
 * @type {Types.frameMetadataForPhotos}
 */
export function frameMetadataForPhotos(photos) {
  const roots = frameRoots(photos)
  /** @type {Map<number, string>} */
  const shaByPhotoId = new Map(photos.map((p) => [p.id, p.sha256]))

  /** @type {Map<number, { frameRootSha256: string, capturedAt: string | null }>} */
  const out = new Map()
  for (const photo of photos) {
    const rootId = roots.get(photo.id) ?? photo.id
    out.set(photo.id, {
      // A root that has no row of its own (a --limit'ed run referencing a
      // photo it never wrote) falls back to the photo's own hash rather than
      // leaving the column null: its own frame, which is the truthful reading.
      frameRootSha256: shaByPhotoId.get(rootId) ?? photo.sha256,
      capturedAt: photo.capturedAtMs === null ? null : new Date(photo.capturedAtMs).toISOString(),
    })
  }
  return out
}

/** @param {number} mediaId @param {string} modelVersion */
function existingCliFaceCount(mediaId, modelVersion) {
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM media_faces
    WHERE media_id = ${mediaId} AND model_version = ${modelVersion}
      AND source = 'cli' AND deleted_at IS NULL`.get()
  return row ? row.n : 0
}

/** @param {number} mediaId @param {string} modelVersion */
function retireCliFaces(mediaId, modelVersion) {
  const result = sql`UPDATE media_faces SET deleted_at = ${now()}
    WHERE media_id = ${mediaId} AND model_version = ${modelVersion}
      AND source = 'cli' AND deleted_at IS NULL`.run()
  return result.changes
}

/**
 * The main pass: read the run's JSONL, join to media by sha256, refuse (or
 * --replace) a (media_id, model_version) re-run, and insert one media_faces
 * row per face of every matched photo, all in one transaction.
 * @type {Types.ingestRun}
 */
export function ingestRun({ db, runDir, modelVersion, replace, dryRun }) {
  const photosRead = readJsonl(path.join(runDir, "photos.jsonl"))
  const facesRead = readJsonl(path.join(runDir, "faces.jsonl"))
  if (!photosRead.present) throw new Error(`${runDir}/photos.jsonl: not found`)
  if (!facesRead.present) throw new Error(`${runDir}/faces.jsonl: not found`)
  if (photosRead.skipped > 0 || facesRead.skipped > 0) {
    console.warn(
      `warning: skipped ${photosRead.skipped + facesRead.skipped} unparseable JSONL line(s) — was the run interrupted?`,
    )
  }

  const photos = /** @type {Types.Session1PhotoRecord[]} */ (photosRead.records)
  const faces = /** @type {Types.Session1FaceRecord[]} */ (facesRead.records)

  const mediaBySha = loadMediaShaMap()
  const { matched, unmatchedCount } = joinPhotosToMedia(photos, mediaBySha)

  const matchedMediaIds = [...new Set(matched.map((m) => m.mediaId))]
  /** @type {Map<number, number>} */
  const mediaIdByPhotoId = new Map(matched.map((m) => [m.photo.id, m.mediaId]))
  const facesToInsert = faces.filter((f) => mediaIdByPhotoId.has(f.photoId))

  if (!replace) {
    const conflicts = matchedMediaIds.filter((id) => existingCliFaceCount(id, modelVersion) > 0)
    if (conflicts.length > 0) {
      throw new Error(
        `${conflicts.length} matched photo(s) already have live 'cli' rows for model_version ` +
          `"${modelVersion}". Pass --replace to soft-delete them and re-ingest, or use a ` +
          `different --model-version.`,
      )
    }
  }

  const frameMeta = frameMetadataForPhotos(photos)

  let framesWritten = 0
  let capturedAtWritten = 0
  if (!dryRun) {
    withTransaction(db, () => {
      if (replace) {
        for (const mediaId of matchedMediaIds) retireCliFaces(mediaId, modelVersion)
      }
      // Frame identity and capture time are properties of the PHOTOGRAPH, not
      // of a descriptor model, so they are written on every run regardless of
      // --replace and are not scoped to model_version. The CLI is
      // authoritative for both (§10), so a re-run overwrites rather than
      // filling only nulls — that is what makes a corrected near-duplicate
      // cutoff take effect on a second pass.
      for (const { photo, mediaId } of matched) {
        const meta = frameMeta.get(photo.id)
        if (!meta) continue
        framesWritten += Number(
          sql`UPDATE media SET frame_root_sha256 = ${meta.frameRootSha256}
            WHERE id = ${mediaId}`.run().changes,
        )
        if (meta.capturedAt !== null) {
          capturedAtWritten += Number(
            sql`UPDATE media SET captured_at = ${meta.capturedAt}
              WHERE id = ${mediaId}`.run().changes,
          )
        }
      }
      for (const face of facesToInsert) {
        const mediaId = /** @type {number} */ (mediaIdByPhotoId.get(face.photoId))
        insertFace({
          mediaId,
          bbox: face.box,
          landmarks: face.landmarks && face.landmarks.length > 0 ? face.landmarks : null,
          signals: face.signals ?? null,
          descriptor:
            face.descriptor && face.descriptor.length > 0
              ? descriptorToBlob(Float32Array.from(face.descriptor))
              : null,
          modelVersion,
          source: "cli",
        })
      }
    })
  }

  return {
    photosInRun: photos.length,
    matched: matched.length,
    unmatched: unmatchedCount,
    facesInserted: facesToInsert.length,
    framesWritten,
    capturedAtWritten,
  }
}

/**
 * Populate media.source_sha256 from an import-media manifest, for rows that
 * don't have it yet. Counts only — never logs a filename (ManifestEntry.name
 * is a basename at import time, which could itself identify a photo's subject).
 * @type {Types.backfillFromManifest}
 */
export function backfillFromManifest({ db, manifest, dryRun }) {
  let total = 0
  let updated = 0

  const apply = () => {
    for (const origin of Object.keys(manifest.origins)) {
      const entries = manifest.origins[origin]
      for (const sha256 of Object.keys(entries)) {
        const entry = entries[sha256]
        total++
        if (dryRun) {
          /** @type {{ source_sha256: string | null } | undefined} */
          const row = sql`SELECT source_sha256 FROM media WHERE id = ${entry.id}`.get()
          if (row && row.source_sha256 === null) updated++
        } else {
          const result = sql`UPDATE media SET source_sha256 = ${sha256}
            WHERE id = ${entry.id} AND source_sha256 IS NULL`.run()
          updated += Number(result.changes)
        }
      }
    }
  }

  if (dryRun) apply()
  else withTransaction(db, apply)

  return { total, updated }
}

/**
 * The main pass's non-negotiable: never guess a descriptor model. Pulled out
 * of `main()` as its own function so the refusal is unit-testable without
 * spinning up a database.
 * @type {Types.requireModelVersion}
 */
export function requireModelVersion(modelVersion) {
  if (!modelVersion) {
    throw new Error(
      "--model-version is required for the main pass (refusing to guess a descriptor model — " +
        "a model swap must never silently mix descriptor spaces)",
    )
  }
  return modelVersion
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.valid) {
    process.stderr.write(parsed.error + "\n")
    process.exitCode = 1
    return
  }
  const args = parsed.value

  const dbPath = resolveDbPath(args.database)
  const db = openDatabase(dbPath)
  try {
    if (args.backfillManifest) {
      const manifest = loadManifest(args.backfillManifest)
      const result = backfillFromManifest({ db, manifest, dryRun: args.dryRun })
      console.log(
        `backfill-manifest: ${result.updated} of ${result.total} manifest entries applied to media.source_sha256` +
          (args.dryRun ? " (dry run)" : ""),
      )
    }

    if (args.runDir) {
      const modelVersion = requireModelVersion(args.modelVersion)
      const result = ingestRun({
        db,
        runDir: args.runDir,
        modelVersion,
        replace: args.replace,
        dryRun: args.dryRun,
      })
      console.log(`photos in run: ${result.photosInRun}`)
      console.log(`matched to media: ${result.matched}`)
      console.log(`unmatched (no sha match): ${result.unmatched}`)
      console.log(`faces inserted: ${result.facesInserted}` + (args.dryRun ? " (dry run — nothing written)" : ""))
      if (!args.dryRun) {
        console.log(`frame roots written: ${result.framesWritten}`)
        console.log(`capture times written: ${result.capturedAtWritten}`)
      }
    }
  } finally {
    db.close()
  }
}

// `node scripts/vision/ingest-faces.js ...` runs; `import` from a test does not.
// Same guard as scripts/import-media.js / scripts/vision/session1.js.
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((err) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
}
