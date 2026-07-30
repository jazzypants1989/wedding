/** @file Records what the importer has already imported, so re-running on the
 *  same directory is a no-op.
 *
 *  Keyed by content hash, not filename: renaming or moving a photo must not
 *  re-import it. Keyed by origin underneath that, so a staging run does not
 *  suppress a production one.
 *
 *  Why a local file rather than the database. There is no source_sha256 column
 *  on `media`, and adding one means a schema migration, an index, an admin-only
 *  field on POST /api/media and a lookup endpoint — a permanent expansion of
 *  the core schema to serve a one-directional CLI. `app_state` is not reachable
 *  over HTTP either (setAppState only serves its own fixed keys). The cost of
 *  the file is that it is machine-local, so a second machine re-imports;
 *  --manifest lets the user park it beside the photos if that matters.
 *
 *  The rule is: present in the manifest means skip, unconditionally. It is
 *  deliberately NOT reconciled against the server — if the couple deleted a
 *  photo in the admin grid, the next run must not resurrect it. --force
 *  overrides. */
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
  manifest.origins[origin][sha256] = entry
  return manifest
}

/** @type {Types.manifestCount} */
export function manifestCount(manifest, origin) {
  const entries = manifest.origins[origin]
  return entries ? Object.keys(entries).length : 0
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
