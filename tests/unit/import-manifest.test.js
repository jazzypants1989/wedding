/** @file Unit tests for scripts/lib/import-manifest.js — the record that makes
 *  re-running the importer on the same directory a no-op. */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import {
  hashFile,
  loadManifest,
  manifestCount,
  manifestGet,
  manifestHas,
  manifestMarkSelection,
  manifestRecord,
  manifestRows,
  manifestSelection,
  manifestSetStatus,
  normalizeOrigin,
  saveManifest,
} from "../../scripts/lib/import-manifest.js"

/** @type {string} */
let workDir

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-test-"))
})

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

/** @param {string} name @returns {string} */
function manifestPath(name) {
  return path.join(workDir, name)
}

/** @param {Partial<import('../../scripts/lib/types.js').ManifestEntry>} [over] */
function entry(over = {}) {
  return {
    id: 512,
    fileKey: "abc123",
    section: "official",
    name: "IMG_2841.HEIC",
    bytes: 4410233,
    at: "2026-07-29T12:00:00.000Z",
    ...over,
  }
}

describe("loadManifest", () => {
  it("returns an empty manifest when the file does not exist", () => {
    const manifest = loadManifest(manifestPath("absent.json"))
    assert.deepEqual(manifest.origins, {})
    assert.equal(typeof manifest.version, "number")
  })

  it("returns an empty manifest for unparseable JSON rather than throwing", () => {
    const file = manifestPath("corrupt.json")
    fs.writeFileSync(file, '{"origins": {"http://x": {"a"')
    assert.deepEqual(loadManifest(file).origins, {})
  })

  it("returns an empty manifest for a future version", () => {
    const file = manifestPath("future.json")
    fs.writeFileSync(file, JSON.stringify({ version: 99, origins: { a: { b: entry() } } }))
    assert.deepEqual(loadManifest(file).origins, {})
  })

  it("returns an empty manifest for structurally wrong JSON", () => {
    for (const [name, content] of [
      ["array.json", "[]"],
      ["null.json", "null"],
      ["string.json", '"nope"'],
      ["no-origins.json", '{"version":1}'],
      ["origins-array.json", '{"version":1,"origins":[]}'],
    ]) {
      const file = manifestPath(name)
      fs.writeFileSync(file, content)
      const manifest = loadManifest(file)
      assert.ok(manifest.origins && typeof manifest.origins === "object", name)
      assert.equal(Object.keys(manifest.origins).length, 0, name)
    }
  })
})

describe("record and lookup", () => {
  it("round-trips through save and load", () => {
    const file = manifestPath("roundtrip.json")
    const manifest = loadManifest(file)
    manifestRecord(manifest, "http://localhost:3000", "deadbeef", entry())
    saveManifest(file, manifest)

    const reloaded = loadManifest(file)
    assert.equal(manifestHas(reloaded, "http://localhost:3000", "deadbeef"), true)
    assert.deepEqual(manifestGet(reloaded, "http://localhost:3000", "deadbeef"), entry())
  })

  it("keeps origins separate, so staging does not suppress production", () => {
    const manifest = loadManifest(manifestPath("origins.json"))
    manifestRecord(manifest, "http://localhost:3000", "samehash", entry())
    assert.equal(manifestHas(manifest, "http://localhost:3000", "samehash"), true)
    assert.equal(manifestHas(manifest, "https://wedding.example", "samehash"), false)
  })

  it("reports null and false for anything unrecorded", () => {
    const manifest = loadManifest(manifestPath("empty2.json"))
    assert.equal(manifestHas(manifest, "http://x", "nope"), false)
    assert.equal(manifestGet(manifest, "http://x", "nope"), null)
  })

  it("is not confused by hashes that collide with Object prototype keys", () => {
    const manifest = loadManifest(manifestPath("proto.json"))
    assert.equal(manifestHas(manifest, "http://x", "constructor"), false)
    assert.equal(manifestHas(manifest, "http://x", "__proto__"), false)
    assert.equal(manifestHas(manifest, "toString", "toString"), false)
  })

  it("counts entries per origin", () => {
    const manifest = loadManifest(manifestPath("count.json"))
    assert.equal(manifestCount(manifest, "http://x"), 0)
    manifestRecord(manifest, "http://x", "a", entry())
    manifestRecord(manifest, "http://x", "b", entry({ id: 2 }))
    manifestRecord(manifest, "http://y", "c", entry({ id: 3 }))
    assert.equal(manifestCount(manifest, "http://x"), 2)
    assert.equal(manifestCount(manifest, "http://y"), 1)
  })

  it("overwrites an existing hash rather than duplicating it", () => {
    const manifest = loadManifest(manifestPath("overwrite.json"))
    manifestRecord(manifest, "http://x", "h", entry({ id: 1 }))
    manifestRecord(manifest, "http://x", "h", entry({ id: 2 }))
    assert.equal(manifestCount(manifest, "http://x"), 1)
    assert.equal(manifestGet(manifest, "http://x", "h")?.id, 2)
  })
})

describe("what a selection depends on", () => {
  it("keeps a row --force replaced, so a later selection still reaches it", () => {
    const manifest = loadManifest(manifestPath("earlier.json"))
    manifestRecord(manifest, "http://x", "h", entry({ id: 1, status: "approved" }))
    manifestRecord(manifest, "http://x", "h", entry({ id: 2, status: "hidden" }))
    manifestRecord(manifest, "http://x", "h", entry({ id: 3, status: "hidden" }))
    assert.deepEqual(
      manifestRows(manifest, "http://x").map((row) => [row.id, row.status, row.current]),
      [
        [3, "hidden", true],
        [2, "hidden", false],
        [1, "approved", false],
      ],
    )
    // Re-recording the same row doesn't make it its own earlier copy.
    manifestRecord(manifest, "http://x", "h", entry({ id: 3, status: "hidden" }))
    assert.equal(manifestRows(manifest, "http://x").length, 3)
  })

  it("updates a status wherever the row is recorded", () => {
    const manifest = loadManifest(manifestPath("status.json"))
    manifestRecord(manifest, "http://x", "h", entry({ id: 1, status: "approved" }))
    manifestRecord(manifest, "http://x", "h", entry({ id: 2, status: "hidden" }))
    assert.equal(manifestSetStatus(manifest, "http://x", 1, "hidden"), true)
    assert.equal(manifestSetStatus(manifest, "http://x", 99, "hidden"), false)
    assert.deepEqual(
      manifestRows(manifest, "http://x").map((row) => row.status),
      ["hidden", "hidden"],
    )
  })

  it("records a selection run per origin, and round-trips it", () => {
    const file = manifestPath("marked.json")
    const manifest = loadManifest(file)
    assert.equal(manifestSelection(manifest, "http://x"), null)
    manifestMarkSelection(manifest, "http://x", {
      path: "/cull/keep.json",
      at: "2026-11-05T00:00:00.000Z",
    })
    saveManifest(file, manifest)
    const reloaded = loadManifest(file)
    assert.deepEqual(manifestSelection(reloaded, "http://x"), {
      path: "/cull/keep.json",
      at: "2026-11-05T00:00:00.000Z",
    })
    assert.equal(manifestSelection(reloaded, "http://y"), null)
    assert.equal(manifestSelection(reloaded, "toString"), null)
  })

  it("loads a manifest from before statuses were kept, with them unknown", () => {
    const file = manifestPath("old-format.json")
    fs.writeFileSync(file, JSON.stringify({ version: 1, origins: { "http://x": { h: entry() } } }))
    const manifest = loadManifest(file)
    assert.equal(manifestHas(manifest, "http://x", "h"), true)
    assert.deepEqual(
      manifestRows(manifest, "http://x").map((row) => [row.id, row.status]),
      [[512, null]],
    )
    assert.equal(manifestSelection(manifest, "http://x"), null)
  })

  it("drops a malformed selections record instead of the whole manifest", () => {
    const file = manifestPath("bad-selections.json")
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, origins: { "http://x": { h: entry() } }, selections: "nope" }),
    )
    const manifest = loadManifest(file)
    assert.equal(manifestHas(manifest, "http://x", "h"), true)
    assert.equal(manifestSelection(manifest, "http://x"), null)
  })
})

describe("saveManifest", () => {
  it("creates the parent directory", () => {
    const file = path.join(workDir, "nested", "deeper", "manifest.json")
    const manifest = loadManifest(file)
    manifestRecord(manifest, "http://x", "h", entry())
    saveManifest(file, manifest)
    assert.equal(fs.existsSync(file), true)
  })

  it("leaves no temp file behind", () => {
    const file = manifestPath("clean.json")
    saveManifest(file, loadManifest(file))
    assert.equal(fs.existsSync(file + ".tmp"), false)
  })

  it("keeps the previous manifest readable across repeated writes", () => {
    // Incremental saves after every finalize are what make a run resumable.
    const file = manifestPath("incremental.json")
    const manifest = loadManifest(file)
    for (let i = 0; i < 25; i++) {
      manifestRecord(manifest, "http://x", "hash" + i, entry({ id: i }))
      saveManifest(file, manifest)
      assert.equal(manifestCount(loadManifest(file), "http://x"), i + 1)
    }
  })
})

describe("hashFile", () => {
  it("hashes contents, so identical bytes under different names match", async () => {
    const a = path.join(workDir, "a.bin")
    const b = path.join(workDir, "renamed.bin")
    fs.writeFileSync(a, "the same photo")
    fs.writeFileSync(b, "the same photo")
    assert.equal(await hashFile(a), await hashFile(b))
  })

  it("differs for different contents", async () => {
    const a = path.join(workDir, "c.bin")
    const b = path.join(workDir, "d.bin")
    fs.writeFileSync(a, "one photo")
    fs.writeFileSync(b, "another photo")
    assert.notEqual(await hashFile(a), await hashFile(b))
  })

  it("matches a known sha256", async () => {
    const file = path.join(workDir, "known.bin")
    fs.writeFileSync(file, "abc")
    assert.equal(
      await hashFile(file),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
  })

  it("hashes an empty file without hanging", async () => {
    const file = path.join(workDir, "empty.bin")
    fs.writeFileSync(file, "")
    assert.equal(
      await hashFile(file),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
  })

  it("rejects for a missing file rather than hanging", async () => {
    await assert.rejects(() => hashFile(path.join(workDir, "gone.bin")))
  })
})

describe("normalizeOrigin", () => {
  it("collapses a trailing slash so one server is one key", () => {
    assert.equal(normalizeOrigin("http://localhost:3000/"), "http://localhost:3000")
    assert.equal(normalizeOrigin("http://localhost:3000"), "http://localhost:3000")
    assert.equal(normalizeOrigin("  http://localhost:3000/  "), "http://localhost:3000")
  })

  it("leaves a bare local marker alone", () => {
    assert.equal(normalizeOrigin("local"), "local")
  })
})
