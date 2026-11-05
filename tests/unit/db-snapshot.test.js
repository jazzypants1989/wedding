/** @file Unit test: the hourly database snapshot. Synthetic databases in a temp dir. */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, beforeEach, describe, it } from "node:test"

import { snapshotDatabase, startSnapshotSchedule } from "../../db/snapshot.js"

describe("snapshotDatabase", () => {
  /** @type {string} */
  let dir
  /** @type {string} */
  let dbPath
  /** @type {DatabaseSync} */
  let db

  const names = () => fs.readdirSync(dir).sort()

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "db-snapshot-"))
    dbPath = path.join(dir, "wedding.db")
    db = new DatabaseSync(dbPath)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA wal_autocheckpoint = 0")
    db.exec("CREATE TABLE t (n INTEGER)")
  })

  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("contains writes that only live in the WAL", () => {
    for (let i = 0; i < 5; i++) db.exec(`INSERT INTO t VALUES (${i})`)
    assert.ok(fs.statSync(dbPath + "-wal").size > 0)
    const { created } = snapshotDatabase(dbPath, 5)
    assert.ok(created)
    const snap = new DatabaseSync(created, { readOnly: true })
    try {
      assert.equal(snap.prepare("SELECT count(*) AS c FROM t").get()?.c, 5)
    } finally {
      snap.close()
    }
  })

  it("prunes to exactly N and leaves other files alone", () => {
    fs.writeFileSync(path.join(dir, "pre-deploy-1.db"), "x")
    fs.writeFileSync(path.join(dir, "wedding.db.notes.backup"), "x")
    for (let i = 0; i < 5; i++) {
      snapshotDatabase(dbPath, 3, { now: new Date(2026, 0, 1, 0, 0, i) })
    }
    const kept = names().filter((n) => n.startsWith("wedding.db.2026"))
    assert.deepEqual(kept, [
      "wedding.db.20260101-000002.backup",
      "wedding.db.20260101-000003.backup",
      "wedding.db.20260101-000004.backup",
    ])
    assert.ok(names().includes("pre-deploy-1.db"))
    assert.ok(names().includes("wedding.db.notes.backup"))
  })

  it("never counts temp files and cleans stale ones", () => {
    const stale = path.join(dir, "wedding.db.20250101-000000.backup.tmp")
    fs.writeFileSync(stale, "truncated")
    snapshotDatabase(dbPath, 1, { now: new Date(2026, 0, 1, 0, 0, 0) })
    assert.equal(fs.existsSync(stale), false)
    assert.deepEqual(
      names().filter((n) => n.endsWith(".backup") || n.endsWith(".tmp")),
      ["wedding.db.20260101-000000.backup"],
    )
  })

  it("throws a clear error and leaves no temp file on failure", () => {
    const bad = path.join(dir, "bad.db")
    fs.writeFileSync(bad, "this is not a database")
    assert.throws(
      () => snapshotDatabase(bad, 3),
      (/** @type {Error} */ e) => e.message.startsWith("Database snapshot failed"),
    )
    assert.deepEqual(
      names().filter((n) => n.endsWith(".tmp") || n.endsWith(".backup")),
      [],
    )
    assert.throws(
      () => snapshotDatabase(path.join(dir, "missing.db"), 3),
      (/** @type {Error} */ e) => e.message.startsWith("No database"),
    )
  })

  it("skips with a reason when free space is below the guard", () => {
    const r = snapshotDatabase(dbPath, 3, { minFreeBytes: Number.MAX_SAFE_INTEGER })
    assert.equal(r.created, null)
    assert.ok((r.skipped ?? "").includes("low disk space"))
  })
})

describe("startSnapshotSchedule", () => {
  it("is off when disabled (the NODE_ENV=test default)", () => {
    const stop = startSnapshotSchedule({
      dbPath: "/nonexistent/wedding.db",
      keep: 1,
      intervalMs: 1000,
      initialDelayMs: 1000,
      minFreeBytes: 0,
      enabled: false,
    })
    assert.equal(stop, null)
  })

  it("logs a failure line instead of throwing, and stops cleanly", async () => {
    /** @type {string[]} */
    const errors = []
    const stop = startSnapshotSchedule({
      dbPath: "/nonexistent/wedding.db",
      keep: 1,
      intervalMs: 60_000,
      initialDelayMs: 5,
      minFreeBytes: 0,
      enabled: true,
      log: { log() {}, warn() {}, error: (m) => errors.push(String(m)) },
    })
    assert.ok(stop)
    await new Promise((r) => setTimeout(r, 50))
    stop()
    assert.equal(errors.length, 1)
    assert.ok(errors[0].includes("No database"))
  })
})

describe("server wiring", () => {
  it("starts the schedule, skipped under NODE_ENV=test unless DB_SNAPSHOT_ENABLED", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "server.js"), "utf8")
    assert.ok(src.includes("startSnapshotSchedule({"))
    assert.ok(
      src.includes('process.env.NODE_ENV !== "test" || process.env.DB_SNAPSHOT_ENABLED === "true"'),
    )
  })
})
