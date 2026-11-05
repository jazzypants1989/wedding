/** @file Records what the importer has already imported, so re-running on the
 *  same directory is a no-op.
 *
 *  Keyed by content hash, not filename: renaming or moving a photo must not
 *  re-import it. Keyed by origin underneath that, so a staging run does not
 *  suppress a production one.
 *
 *  Why a local file rather than the database. A `source_sha256` column now
 *  exists on `media` (added by the face-tagging migration in db/schema.js, and
 *  back-filled from this manifest by `scripts/vision/ingest-faces.js
 *  --backfill-manifest`, which never overwrites a set value) — but the importer
 *  still does not read it: using it would need an admin-only field on
 *  POST /api/media and a lookup endpoint — an expansion of the core API to
 *  serve a one-directional CLI. `app_state` is not reachable
 *  over HTTP either (setAppState only serves its own fixed keys). The cost of
 *  the file is that it is machine-local, so a second machine re-imports;
 *  --manifest lets the user park it beside the photos if that matters.
 *
 *  The rule is: present in the manifest means skip, unconditionally. It is
 *  deliberately NOT reconciled against the server — if the couple deleted a
 *  photo in the admin grid, the next run must not resurrect it. --force
 *  overrides.
 *
 *  It also remembers two things a --selection run depends on. Each entry keeps
 *  the row's last known status, so a later selection can be compared with what
 *  is already public; and `selections` records which origins a selection run
 *  imported into, because a later run there without one would publish every
 *  file that selection left out. Both are additive optional fields, so a
 *  manifest written before them still loads (as version 1), and the CLI treats
 *  its missing statuses as unknown rather than as visible. */
/** @import * as Types from './types.js' */

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/** Bumped if the on-disk shape ever changes, so an old file is ignored safely. */
const MANIFEST_VERSION = 1

/** @type {Types.loadManifest} */
export function loadManifest(manifestPath) {
  /** @type {Types.ImportManifest} */
  const empty = { version: MANIFEST_VERSION, origins: {} }
  let raw
  try {
    raw = fs.readFileSync(manifestPath, "utf8")
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code
    if (code === "ENOENT") return empty
    throw err
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return empty
    if (parsed.version !== MANIFEST_VERSION) return empty
    if (!parsed.origins || typeof parsed.origins !== "object") return empty
    // A malformed `selections` is dropped rather than failing the load; the CLI
    // still refuses an unselected run over any row recorded as hidden.
    const marks = parsed.selections
    if (marks !== undefined && (!marks || typeof marks !== "object")) delete parsed.selections
    return /** @type {Types.ImportManifest} */ (parsed)
  } catch {
    // A truncated or hand-edited manifest should not stop an import. Treating
    // it as empty risks re-importing, which is visible and fixable; refusing to
    // run is not.
    return empty
  }
}

/** @type {Types.manifestHas} */
export function manifestHas(manifest, origin, sha256) {
  const entries = manifest.origins[origin]
  return Boolean(entries && Object.hasOwn(entries, sha256))
}

/** @type {Types.manifestGet} */
export function manifestGet(manifest, origin, sha256) {
  const entries = manifest.origins[origin]
  return entries && Object.hasOwn(entries, sha256) ? entries[sha256] : null
}

/** @type {Types.manifestRecord} */
export function manifestRecord(manifest, origin, sha256, entry) {
  if (!manifest.origins[origin]) manifest.origins[origin] = {}
  const previous = manifestGet(manifest, origin, sha256)
  // --force re-imports content the manifest already has. The row it made before
  // is still on the site, so it stays tracked: a later selection must reach it.
  /** @type {Types.ManifestEarlierRow[]} */
  const earlier = []
  if (previous && previous.id !== entry.id) {
    earlier.push({
      id: previous.id,
      section: previous.section,
      ...(previous.status !== undefined ? { status: previous.status } : {}),
      at: previous.at,
    })
  }
  earlier.push(...(previous?.earlier ?? []), ...(entry.earlier ?? []))
  const seen = new Set([entry.id])
  const kept = earlier.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
  manifest.origins[origin][sha256] = kept.length > 0 ? { ...entry, earlier: kept } : entry
  return manifest
}

/** @type {Types.manifestCount} */
export function manifestCount(manifest, origin) {
  const entries = manifest.origins[origin]
  return entries ? Object.keys(entries).length : 0
}

/** @type {Types.manifestRows} */
export function manifestRows(manifest, origin) {
  const entries = manifest.origins[origin]
  if (!entries) return []
  /** @type {Types.RecordedRow[]} */
  const rows = []
  for (const [sha256, entry] of Object.entries(entries)) {
    rows.push({
      sha256,
      name: entry.name,
      id: entry.id,
      section: entry.section,
      status: entry.status ?? null,
      current: true,
    })
    for (const row of entry.earlier ?? []) {
      rows.push({
        sha256,
        name: entry.name,
        id: row.id,
        section: row.section,
        status: row.status ?? null,
        current: false,
      })
    }
  }
  return rows
}

/** @type {Types.manifestSetStatus} */
export function manifestSetStatus(manifest, origin, id, status) {
  let found = false
  for (const entry of Object.values(manifest.origins[origin] ?? {})) {
    if (entry.id === id) {
      entry.status = status
      found = true
    }
    for (const row of entry.earlier ?? []) {
      if (row.id === id) {
        row.status = status
        found = true
      }
    }
  }
  return found
}

/** @type {Types.manifestSelection} */
export function manifestSelection(manifest, origin) {
  const marks = manifest.selections
  return marks && Object.hasOwn(marks, origin) ? marks[origin] : null
}

/** @type {Types.manifestMarkSelection} */
export function manifestMarkSelection(manifest, origin, mark) {
  if (!manifest.selections) manifest.selections = {}
  manifest.selections[origin] = mark
  return manifest
}

/** @type {Types.saveManifest} */
export function saveManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  // Write-then-rename, so an interrupted run leaves the previous manifest
  // intact rather than a half-written one. Same approach as setup-admin.js.
  const tmpPath = manifestPath + ".tmp"
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n")
  fs.renameSync(tmpPath, manifestPath)
}

/** @type {Types.hashFile} */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256")
    const stream = fs.createReadStream(filePath)
    stream.on("error", reject)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

/** @type {Types.normalizeOrigin} */
export function normalizeOrigin(origin) {
  // "http://localhost:3000/" and "http://localhost:3000" must be one key.
  const trimmed = origin.trim()
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed
}
