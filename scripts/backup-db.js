#!/usr/bin/env node
/**
 * @file WAL-safe SQLite backup.
 *
 * A plain `cp` of wedding.db is unsafe in WAL mode: recent writes live in the
 * `-wal` sidecar, so the copy can be stale or torn. `VACUUM INTO` writes a
 * single, transactionally-consistent snapshot with the WAL folded in. The logic
 * lives in db/snapshot.js, which the server also runs hourly; this is the manual
 * trigger.
 *
 * Usage: node scripts/backup-db.js
 * In the container: docker exec wedding node scripts/backup-db.js
 */

import path from "node:path"
import { snapshotDatabase } from "../db/snapshot.js"

const KEEP = 5

const dbPath =
  process.env.DATABASE_PATH || path.join(import.meta.dirname, "..", "data", "wedding.db")

try {
  const { created, pruned } = snapshotDatabase(dbPath, KEEP)
  console.log(`Backup created: ${created}`)
  for (const name of pruned) console.log(`Pruned old backup: ${name}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}
