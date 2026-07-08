import { describe, it, after } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// This test drives real DB + filesystem, so it initializes its own connection
// against a temp DATABASE_PATH. Dynamic imports run AFTER the env is set (static
// imports would be hoisted and read the env too early).

describe("cleanAbandonedUploads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-test-"))
  process.env.DATABASE_PATH = path.join(dir, "wedding.db")

  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("removes abandoned uploading rows + dirs and stale staging files", async () => {
    const { init, close } = await import("../../../db/connection.js")
    init()
    const { sql } = await import("../../../db/sql.js")
    const { ensureUploadDirs, TMP_DIR, itemDir } = await import("../../../core/media-storage.js")
    const { cleanAbandonedUploads } = await import("../../../core/media-sweep.js")

    ensureUploadDirs()

    // An abandoned 'uploading' row (created 7h ago) + its item directory.
    const key = "a".repeat(32)
    sql`INSERT INTO media (file_key, kind, section, status, created_at)
        VALUES (${key}, 'image', 'guest', 'uploading', datetime('now', '-7 hours'))`.run()
    fs.mkdirSync(itemDir(key), { recursive: true })
    fs.writeFileSync(path.join(itemDir(key), "original.jpg"), "x")

    // A fresh 'uploading' row (created now) must NOT be swept.
    const freshKey = "b".repeat(32)
    sql`INSERT INTO media (file_key, kind, section, status)
        VALUES (${freshKey}, 'image', 'guest', 'uploading')`.run()

    // A stale staging file (2h old) + a fresh one.
    const stale = path.join(TMP_DIR, "stale.part")
    fs.writeFileSync(stale, "x")
    const old = Date.now() / 1000 - 2 * 3600
    fs.utimesSync(stale, old, old)
    const fresh = path.join(TMP_DIR, "fresh.part")
    fs.writeFileSync(fresh, "x")

    const result = cleanAbandonedUploads()

    assert.strictEqual(result.rowsDeleted, 1, "only the aged row swept")
    assert.ok(result.tmpDeleted >= 1, "stale staging removed")
    assert.ok(!fs.existsSync(itemDir(key)), "abandoned item dir gone")
    assert.ok(!fs.existsSync(stale), "stale .part gone")
    assert.ok(fs.existsSync(fresh), "fresh .part kept")
    const remaining = sql`SELECT COUNT(*) AS c FROM media`.get()
    assert.strictEqual(remaining.c, 1, "fresh uploading row kept")

    close()
  })
})
