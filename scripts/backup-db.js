#!/usr/bin/env node
/**
 * @file WAL-safe SQLite backup.
 *
 * A plain `cp` of wedding.db is unsafe in WAL mode: recent writes live in the
 * `-wal` sidecar, so the copy can be stale or torn. `VACUUM INTO` writes a
 * single, transactionally-consistent snapshot with the WAL folded in — no need
 * to copy `-wal`/`-shm`, and no `sqlite3` CLI required (the alpine image has none).
 *
 * Usage: node scripts/backup-db.js
 * In the container: docker exec wedding node scripts/backup-db.js
 */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import fs from "node:fs"

const KEEP = 5

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(import.meta.dirname, "..", "data", "wedding.db")

const dataDir = path.dirname(dbPath)
const base = path.basename(dbPath) // "wedding.db"

/** Local timestamp as YYYYMMDD-HHMMSS, built without RegExp. */
function timestamp() {
  const d = new Date()
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0")
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${date}-${time}`
}

const suffix = `.${timestamp()}.backup`
const dest = path.join(dataDir, base + suffix)

if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath} — nothing to back up.`)
  process.exit(1)
}

// Open read-write (not readOnly): a read-only connection to a WAL database can
// fail when it can't create the -shm file. VACUUM INTO never mutates the source,
// and WAL permits this second connection alongside the running server.
const db = new DatabaseSync(dbPath)
try {
  // VACUUM INTO builds a fresh, consistent copy of the whole database.
  // Single-quote the path and escape embedded quotes per SQL string rules.
  const escaped = dest.split("'").join("''")
  db.exec(`VACUUM INTO '${escaped}'`)
} finally {
  db.close()
}

console.log(`Backup created: ${dest}`)

// Prune to the newest KEEP backups (name-sortable because the stamp is fixed-width).
const backups = fs
  .readdirSync(dataDir)
  .filter(name => name.startsWith(base + ".") && name.endsWith(".backup"))
  .sort()

const stale = backups.slice(0, Math.max(0, backups.length - KEEP))
for (const name of stale) {
  fs.rmSync(path.join(dataDir, name), { force: true })
  console.log(`Pruned old backup: ${name}`)
}
