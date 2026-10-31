/**
 * @file restoreQuarantinedItemDir — the inverse of quarantineItemDir, used when
 * a moderation reject is undone ("Move back to review" / the Undo toast).
 */

import { test, before, after } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-restore-"))
process.env.DATABASE_PATH = path.join(root, "wedding.db")

/** @type {typeof import("../../core/media-storage.js")} */
let storage

before(async () => {
  storage = await import("../../core/media-storage.js")
  storage.ensureUploadDirs()
})

after(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/** @param {string} key @param {string} body */
function makeItem(key, body) {
  const dir = storage.itemDir(key)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "original.jpg"), body)
  return dir
}

test("a quarantined item comes back to where it was", () => {
  const key = "a".repeat(32)
  const dir = makeItem(key, "one")
  storage.quarantineItemDir(key)
  assert.ok(!fs.existsSync(dir))
  assert.strictEqual(storage.restoreQuarantinedItemDir(key), true)
  assert.strictEqual(fs.readFileSync(path.join(dir, "original.jpg"), "utf8"), "one")
  assert.ok(!fs.existsSync(path.join(storage.QUARANTINE_DIR, key)))
})

test("the newest copy wins when a key was quarantined twice", () => {
  const key = "b".repeat(32)
  // An old copy under the bare name, and a later one under "<key>-<epochms>".
  fs.mkdirSync(path.join(storage.QUARANTINE_DIR, key), { recursive: true })
  fs.writeFileSync(path.join(storage.QUARANTINE_DIR, key, "original.jpg"), "old")
  const later = path.join(storage.QUARANTINE_DIR, `${key}-${Date.now()}`)
  fs.mkdirSync(later, { recursive: true })
  fs.writeFileSync(path.join(later, "original.jpg"), "new")
  assert.strictEqual(storage.restoreQuarantinedItemDir(key), true)
  assert.strictEqual(
    fs.readFileSync(path.join(storage.itemDir(key), "original.jpg"), "utf8"),
    "new",
  )
})

test("nothing to restore (purged) is false; already in place is true", () => {
  assert.strictEqual(storage.restoreQuarantinedItemDir("c".repeat(32)), false)
  const key = "d".repeat(32)
  makeItem(key, "here")
  assert.strictEqual(storage.restoreQuarantinedItemDir(key), true)
})

test("a different key that merely starts the same is never taken", () => {
  const key = "e".repeat(32)
  const other = path.join(storage.QUARANTINE_DIR, `${key}-notastamp`)
  fs.mkdirSync(other, { recursive: true })
  assert.strictEqual(storage.restoreQuarantinedItemDir(key), false)
  assert.ok(fs.existsSync(other))
})
