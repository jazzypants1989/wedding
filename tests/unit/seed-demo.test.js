/** @file Unit tests for scripts/seed-demo.js's ADOPT mode — the path that
 *  dresses a demo onto media rows that are already in the target database
 *  instead of downloading stock photos.
 *
 *  Everything here runs against a disposable temp SQLite file whose media rows
 *  are hand-built placeholders with no files behind them: nothing under tests/
 *  ever touches a real photograph (CLAUDE.md §"Photographs Are Input To Code").
 *  The script is driven with `--no-video`, so these tests never reach the
 *  network.
 *
 *  What is actually being pinned down: adoption must never create, delete or
 *  rewrite a pre-existing row's identity, and `--clean` must restore every
 *  column it touched, byte for byte.
 */

import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { execFileSync } from "node:child_process"
import { after, before, describe, it } from "node:test"

import { createTables, runMigrations } from "../../db/schema.js"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..")
const SCRIPT = path.join(REPO_ROOT, "scripts", "seed-demo.js")

/** How many placeholder photos the fixture library holds. Comfortably more
 *  than the demo needs, so adoption is guaranteed to engage. */
const LIBRARY_SIZE = 60

/** @type {string} */
let workDir

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-demo-test-"))
})

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

let dbCounter = 0

/**
 * A fresh schema'd database holding a placeholder "imported library": approved
 * official images carrying a source hash, plus two rows that adoption must
 * leave alone (a guest-section upload and a pending official one).
 * @returns {string} absolute path to the database file
 */
function freshLibraryDb() {
  dbCounter++
  const dir = path.join(workDir, `run-${dbCounter}`)
  fs.mkdirSync(dir, { recursive: true })
  const dbPath = path.join(dir, "wedding.db")

  const db = new DatabaseSync(dbPath)
  db.exec("PRAGMA foreign_keys = ON")
  createTables(db)
  runMigrations(db)

  const insert = db.prepare(
    `INSERT INTO media (file_key, account_id, kind, section, status, caption, original_ext,
       original_bytes, display_bytes, thumb_bytes, width, height, needs_display,
       sort_order, created_at, reviewed_at, source_sha256)
     VALUES (?, NULL, 'image', ?, ?, NULL, 'jpg', 1000, 500, 100, 1600, 1200, 0, ?, ?, NULL, ?)`,
  )
  for (let i = 0; i < LIBRARY_SIZE; i++) {
    insert.run(
      crypto.randomBytes(16).toString("hex"),
      "official",
      "approved",
      i,
      "2026-07-01 12:00:00",
      crypto.createHash("sha256").update(`fixture-${i}`).digest("hex"),
    )
  }
  // Two rows adoption must never reach for: the guest section is somebody's own
  // upload, and a pending official row is still in review.
  insert.run(crypto.randomBytes(16).toString("hex"), "guest", "approved", 0, "2026-07-02 12:00:00", null)
  insert.run(crypto.randomBytes(16).toString("hex"), "official", "pending", 999, "2026-07-02 12:00:00", null)
  db.close()
  return dbPath
}

/**
 * @param {string} dbPath
 * @param {string[]} args
 * @returns {string} combined stdout
 */
function runSeed(dbPath, args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_PATH: dbPath },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

/** Every media column this script is allowed to touch, plus the ones it isn't.
 *  @param {string} dbPath @returns {Record<string, unknown>[]} */
function mediaSnapshot(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = /** @type {Record<string, unknown>[]} */ (
    db
      .prepare(
        `SELECT id, file_key, account_id, kind, section, status, caption, original_ext,
                original_bytes, display_bytes, thumb_bytes, width, height, needs_display,
                sort_order, created_at, reviewed_at, deleted_at, source_sha256
           FROM media ORDER BY id`,
      )
      .all()
  )
  db.close()
  return rows
}

/** @param {string} dbPath @param {string} sql @returns {number} */
function count(dbPath, sql) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const row = /** @type {{ n: number } | undefined} */ (db.prepare(sql).get())
  db.close()
  return row ? row.n : 0
}

/** @param {string} dbPath @returns {{ fileKeys: string[], adopted: Record<string, unknown>[] }} */
function readManifest(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const row = /** @type {{ value: string } | undefined} */ (
    db.prepare("SELECT value FROM app_state WHERE key = 'seed_demo_manifest'").get()
  )
  db.close()
  assert.ok(row, "expected a seed_demo_manifest row")
  return /** @type {{ fileKeys: string[], adopted: Record<string, unknown>[] }} */ (
    JSON.parse(row.value)
  )
}

describe("seed-demo adopt mode", () => {
  it("dresses the demo onto existing rows without creating or deleting any", () => {
    const dbPath = freshLibraryDb()
    const before = mediaSnapshot(dbPath)

    const out = runSeed(dbPath, ["--no-video"])
    assert.ok(out.includes("Mode: ADOPTED"), "expected the run to report ADOPT mode")

    const after = mediaSnapshot(dbPath)
    assert.equal(after.length, before.length, "adoption must not add or remove media rows")

    // Identity and bytes are untouched, row for row.
    for (let i = 0; i < before.length; i++) {
      for (const col of [
        "id", "file_key", "kind", "original_ext", "original_bytes", "display_bytes",
        "thumb_bytes", "width", "height", "needs_display", "sort_order", "deleted_at",
        "source_sha256",
      ]) {
        assert.deepEqual(after[i][col], before[i][col], `media.${col} must not change`)
      }
    }

    // The demo shape the walkthrough needs is present.
    assert.ok(
      count(dbPath, "SELECT COUNT(*) AS n FROM media WHERE section = 'guest' AND status = 'approved'") > 20,
      "expected a populated guest wall",
    )
    assert.ok(
      count(dbPath, "SELECT COUNT(*) AS n FROM media WHERE status = 'pending'") >= 3,
      "expected pending photos in the moderation queue",
    )
    assert.ok(
      count(dbPath, "SELECT COUNT(*) AS n FROM media WHERE status = 'hidden'") >= 2,
      "expected hidden photos",
    )
    assert.ok(
      count(dbPath, "SELECT COUNT(*) AS n FROM media WHERE section = 'official' AND caption IS NOT NULL") >= 8,
      "expected captioned shots at the head of the official set",
    )
    assert.ok(
      count(dbPath, "SELECT COUNT(*) AS n FROM accounts") > 0 &&
        count(dbPath, "SELECT COUNT(*) AS n FROM guestbook_entries") > 0 &&
        count(dbPath, "SELECT COUNT(*) AS n FROM thank_you_cards") > 0,
      "expected the rest of the demo dataset alongside the photos",
    )

    // Nothing was written to the uploads tree: adoption downloads nothing and
    // re-encodes nothing (--no-video keeps the sample clips out of it too).
    const uploadsDir = path.join(path.dirname(dbPath), "uploads")
    /** @param {string} dir @returns {number} */
    const fileCount = (dir) => {
      if (!fs.existsSync(dir)) return 0
      let n = 0
      for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
        if (entry.isFile()) n++
      }
      return n
    }
    assert.equal(fileCount(uploadsDir), 0, "adoption must not write any media files")
  })

  it("never adopts a guest upload or a row still in review", () => {
    const dbPath = freshLibraryDb()
    const before = mediaSnapshot(dbPath)
    const untouchable = before.filter(
      (r) => r.section === "guest" || r.status === "pending",
    )
    assert.equal(untouchable.length, 2, "fixture should hold exactly two off-limits rows")

    runSeed(dbPath, ["--no-video"])

    const after = mediaSnapshot(dbPath)
    const byId = new Map(after.map((r) => [r.id, r]))
    for (const row of untouchable) {
      assert.deepEqual(byId.get(row.id), row, "an off-limits row must be left exactly as found")
    }
  })

  it("records every borrowed row's original state in the manifest", () => {
    const dbPath = freshLibraryDb()
    const before = new Map(mediaSnapshot(dbPath).map((r) => [r.file_key, r]))

    runSeed(dbPath, ["--no-video"])

    const manifest = readManifest(dbPath)
    assert.equal(manifest.fileKeys.length, 0, "adopt mode with --no-video creates no rows")
    assert.ok(manifest.adopted.length > 0, "expected adopted snapshots")
    for (const snap of manifest.adopted) {
      const original = before.get(/** @type {string} */ (snap.fileKey))
      assert.ok(original, "every adopted key must belong to a pre-existing row")
      assert.equal(snap.section, original.section)
      assert.equal(snap.status, original.status)
      assert.equal(snap.accountId, original.account_id)
      assert.equal(snap.caption, original.caption)
      assert.equal(snap.createdAt, original.created_at)
      assert.equal(snap.reviewedAt, original.reviewed_at)
    }
  })

  it("is idempotent across re-runs", () => {
    const dbPath = freshLibraryDb()
    runSeed(dbPath, ["--no-video"])
    const first = mediaSnapshot(dbPath)
    const firstAccounts = count(dbPath, "SELECT COUNT(*) AS n FROM accounts")

    runSeed(dbPath, ["--no-video"])
    const second = mediaSnapshot(dbPath)

    assert.equal(second.length, first.length, "a re-run must not grow the media table")
    assert.deepEqual(
      second.map((r) => [r.file_key, r.section, r.status, r.caption]),
      first.map((r) => [r.file_key, r.section, r.status, r.caption]),
      "a re-run must land on the same rows in the same states",
    )
    assert.equal(count(dbPath, "SELECT COUNT(*) AS n FROM accounts"), firstAccounts)
  })

  it("--clean restores every borrowed row and removes the demo dataset", () => {
    const dbPath = freshLibraryDb()
    const before = mediaSnapshot(dbPath)

    runSeed(dbPath, ["--no-video"])
    assert.notDeepEqual(mediaSnapshot(dbPath), before, "the seed should have changed something")

    const out = runSeed(dbPath, ["--clean"])
    assert.ok(out.includes("DEMO data cleaned"))

    assert.deepEqual(mediaSnapshot(dbPath), before, "--clean must restore every borrowed row")
    for (const table of [
      "accounts", "guests", "guestbook_entries", "comments", "reactions",
      "gifts", "thank_you_cards",
    ]) {
      assert.equal(
        count(dbPath, `SELECT COUNT(*) AS n FROM ${table}`),
        0,
        `${table} should be empty after --clean`,
      )
    }
    assert.equal(count(dbPath, "SELECT COUNT(*) AS n FROM app_state"), 0)
  })

  it("refuses to delete imported media even when the manifest claims it", () => {
    const dbPath = freshLibraryDb()
    runSeed(dbPath, ["--no-video"])

    // Forge the manifest so a real, importer-owned key sits in the "rows this
    // script created" list — the failure mode a stale or hand-edited manifest
    // would produce. The source hash must veto the delete.
    const db = new DatabaseSync(dbPath)
    const victim = /** @type {{ file_key: string } | undefined} */ (
      db
        .prepare("SELECT file_key FROM media WHERE source_sha256 IS NOT NULL LIMIT 1")
        .get()
    )
    assert.ok(victim)
    const manifest = readManifest(dbPath)
    manifest.fileKeys.push(victim.file_key)
    db.prepare("UPDATE app_state SET value = ? WHERE key = 'seed_demo_manifest'").run(
      JSON.stringify(manifest),
    )
    db.close()

    runSeed(dbPath, ["--clean"])

    assert.equal(
      count(dbPath, `SELECT COUNT(*) AS n FROM media WHERE file_key = '${victim.file_key}'`),
      1,
      "an imported photo must survive a manifest that wrongly claims it",
    )
  })
})
