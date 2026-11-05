/** @file Transactionally consistent SQLite snapshots (VACUUM INTO), pruned to the newest N */
/** @import * as Types from './types.js' */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import fs from "node:fs"

const SUFFIX = ".backup"
const TEMP_SUFFIX = ".backup.tmp"
const STAMP_LENGTH = 15 // YYYYMMDD-HHMMSS

/** Local timestamp as YYYYMMDD-HHMMSS, built without RegExp. */
function timestamp(/** @type {Date} */ d) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0")
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${date}-${time}`
}

/** True when every character of `stamp` is a digit, except a dash at index 8. */
function isStamp(/** @type {string} */ stamp) {
  if (stamp.length !== STAMP_LENGTH) return false
  for (let i = 0; i < stamp.length; i++) {
    const c = stamp.charCodeAt(i)
    if (i === 8 ? c !== 45 : c < 48 || c > 57) return false
  }
  return true
}

/** Exactly `<base>.<YYYYMMDD-HHMMSS>.backup`; temp files and anything else never match. */
function isSnapshotName(/** @type {string} */ name, /** @type {string} */ base) {
  if (!name.startsWith(base + ".") || !name.endsWith(SUFFIX)) return false
  return isStamp(name.slice(base.length + 1, name.length - SUFFIX.length))
}

/** @type {Types.snapshotDatabase} */
export function snapshotDatabase(dbPath, keep, options = {}) {
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath} - nothing to back up.`)
  const dir = path.dirname(dbPath)
  const base = path.basename(dbPath)

  // A crash mid-write leaves only a temp file; sweep any from earlier runs.
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(base + ".") && name.endsWith(TEMP_SUFFIX)) {
      fs.rmSync(path.join(dir, name), { force: true })
    }
  }

  const minFree = options.minFreeBytes ?? 0
  if (minFree > 0) {
    try {
      const s = fs.statfsSync(dir)
      const free = s.bavail * s.bsize
      // The snapshot is at most as large as the database file itself.
      if (free - fs.statSync(dbPath).size < minFree) {
        return { created: null, pruned: [], skipped: `low disk space (${free} bytes free)` }
      }
    } catch {
      // statfs unsupported: proceed, as the health gauge does.
    }
  }

  const name = base + "." + timestamp(options.now ?? new Date()) + SUFFIX
  const dest = path.join(dir, name)
  const temp = path.join(dir, name + ".tmp")

  // Read-write (not readOnly): a read-only connection to a WAL database can fail
  // when it can't create the -shm file. VACUUM INTO never mutates the source.
  /** @type {DatabaseSync | undefined} */
  let db
  try {
    db = new DatabaseSync(dbPath)
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec(`VACUUM INTO '${temp.split("'").join("''")}'`)
    fs.renameSync(temp, dest)
  } catch (err) {
    fs.rmSync(temp, { force: true })
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`Database snapshot failed (${dbPath}): ${reason}`, { cause: err })
  } finally {
    db?.close()
  }

  // Name-sortable because the stamp is fixed-width. Only files beside the database.
  const all = fs
    .readdirSync(dir)
    .filter((n) => isSnapshotName(n, base))
    .sort()
  const stale = all.slice(0, Math.max(0, all.length - keep))
  for (const n of stale) fs.rmSync(path.join(dir, n), { force: true })
  return { created: dest, pruned: stale }
}

/** @type {Types.startSnapshotSchedule} */
export function startSnapshotSchedule({
  dbPath,
  keep,
  intervalMs,
  initialDelayMs,
  minFreeBytes,
  enabled,
  log = console,
}) {
  if (!enabled) return null
  let running = false
  const tick = () => {
    if (running) return
    running = true
    try {
      const r = snapshotDatabase(dbPath, keep, { minFreeBytes })
      if (r.skipped) log.warn(`Database snapshot skipped: ${r.skipped}`)
      else log.log(`Database snapshot written: ${path.basename(r.created ?? "")}`)
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err))
    } finally {
      running = false
    }
  }
  const first = setTimeout(tick, initialDelayMs)
  const timer = setInterval(tick, intervalMs)
  first.unref()
  timer.unref()
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
