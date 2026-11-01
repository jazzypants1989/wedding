import { describe, it, after } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Own file (own process): media-storage.js reads DATABASE_PATH at import time.

describe("runMediaIntegrityPass: orphan under the wrong prefix", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-q-test-"))
  process.env.DATABASE_PATH = path.join(dir, "wedding.db")

  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  it("quarantines it with the collision suffix and a fresh stamp, so the TTL keeps it", async () => {
    const { init, close } = await import("../../../db/connection.js")
    init()
    const { ensureUploadDirs, MEDIA_DIR, QUARANTINE_DIR } = await import(
      "../../../core/media-storage.js"
    )
    const { runMediaIntegrityPass } = await import("../../../core/media-sweep.js")
    ensureUploadDirs()

    // A key whose directory sits under a prefix that isn't its own first two chars,
    // uploaded long ago (an mtime well past the quarantine TTL).
    const key = "c".repeat(32)
    const misplaced = path.join(MEDIA_DIR, "zz", key)
    fs.mkdirSync(misplaced, { recursive: true })
    fs.writeFileSync(path.join(misplaced, "original.jpg"), "x")
    const longAgo = Date.now() / 1000 - 365 * 24 * 3600
    fs.utimesSync(misplaced, longAgo, longAgo)

    // An earlier quarantine of the same key, still inside its TTL: the move must not
    // collide with it.
    fs.mkdirSync(path.join(QUARANTINE_DIR, key), { recursive: true })

    const result = runMediaIntegrityPass()

    assert.strictEqual(result.quarantined, 1, "the misplaced orphan was moved")
    assert.ok(!fs.existsSync(misplaced), "gone from media/")
    const entries = fs.readdirSync(QUARANTINE_DIR).filter((n) => n.startsWith(key))
    assert.strictEqual(entries.length, 2, "the earlier copy plus a suffixed one")
    assert.strictEqual(result.purged, 0, "a fresh quarantine stamp survives the same pass's purge")

    close()
  })
})
