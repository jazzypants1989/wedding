/** @file Unit tests for scripts/vision/ingest-faces.js's join/ingest logic:
 *  sha256 matching against `media.source_sha256`, the refuse-without-`--replace`
 *  guard, the `--replace` retire-then-reinsert path, `--backfill-manifest`, and
 *  the CLI argument parser. Everything here runs against a disposable temp
 *  SQLite file — no server, and nothing under tests/ ever touches a real
 *  photograph (every photo/face record below is hand-built, per CLAUDE.md §15).
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import {
  backfillFromManifest,
  frameMetadataForPhotos,
  ingestRun,
  joinPhotosToMedia,
  openDatabase,
  parseArgs,
  readJsonl,
  requireModelVersion,
} from "../../scripts/vision/ingest-faces.js"
import { blobToDescriptor } from "../../db/media-faces.js"

/** @type {string} */
let workDir

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-faces-test-"))
})

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

let dbCounter = 0
/** A fresh, empty schema'd SQLite file per call. */
function freshDb() {
  dbCounter++
  return openDatabase(path.join(workDir, `db-${dbCounter}.sqlite`))
}

/** @param {Partial<import('../../scripts/vision/types.js').Session1PhotoRecord>} [over] */
function photo(over = {}) {
  return {
    id: 0,
    relative: "a.jpg",
    sha256: "sha-a",
    aHash: "0".repeat(16),
    width: 100,
    height: 100,
    capturedAtMs: null,
    mtimeMs: 0,
    faces: 1,
    exactDuplicateOf: null,
    nearDuplicateOf: null,
    ms: { decode: 0, downsample: 0, detect: 0, align: 0, describe: 0 },
    ...over,
  }
}

/** @param {number[]} descriptor @param {Partial<import('../../scripts/vision/types.js').Session1FaceRecord>} [over] */
function face(descriptor, over = {}) {
  return {
    id: 0,
    photoId: 0,
    crop: "crops/000000.png",
    score: 0.95,
    box: { x: 10, y: 20, w: 40, h: 40 },
    landmarks: [20, 30, 40, 30, 30, 40, 22, 50, 38, 50],
    signals: {
      score: 0.95,
      boxPx: 120,
      borderPx: 20,
      eyeRatio: 0.4,
      eyeAngle: 0.01,
      alignScale: 1.0,
      residual: 2,
      outsideFraction: 0,
      sharpness: 0.02,
    },
    descriptor,
    ...over,
  }
}

/** @param {string} dir @param {unknown[]} photos @param {unknown[]} faces */
function writeRun(dir, photos, faces) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "photos.jsonl"), photos.map((p) => JSON.stringify(p)).join("\n") + "\n")
  fs.writeFileSync(path.join(dir, "faces.jsonl"), faces.map((f) => JSON.stringify(f)).join("\n") + "\n")
}

/** @param {import('node:sqlite').DatabaseSync} db @param {string | null} sha */
function seedMedia(db, sha) {
  const fileKey = `fk-${Math.random().toString(16).slice(2)}`
  const result = db
    .prepare(
      `INSERT INTO media (file_key, kind, section, status, source_sha256) VALUES (?, 'image', 'guest', 'approved', ?)`,
    )
    .run(fileKey, sha)
  return Number(result.lastInsertRowid)
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("parses a run directory with flags", () => {
    const result = parseArgs(["tmp/run1", "--model-version", "v1", "--replace", "--dry-run"])
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.equal(result.value.runDir, "tmp/run1")
    assert.equal(result.value.modelVersion, "v1")
    assert.equal(result.value.replace, true)
    assert.equal(result.value.dryRun, true)
    assert.equal(result.value.database, null)
    assert.equal(result.value.backfillManifest, null)
  })

  it("accepts --backfill-manifest alone, with no run directory", () => {
    const result = parseArgs(["--backfill-manifest", "manifest.json"])
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.equal(result.value.runDir, null)
    assert.equal(result.value.backfillManifest, "manifest.json")
  })

  it("refuses when neither a run directory nor --backfill-manifest is given", () => {
    const result = parseArgs(["--model-version", "v1"])
    assert.equal(result.valid, false)
  })

  it("refuses an unknown flag", () => {
    const result = parseArgs(["tmp/run1", "--nonsense"])
    assert.equal(result.valid, false)
  })

  it("refuses a flag missing its value", () => {
    const result = parseArgs(["tmp/run1", "--model-version"])
    assert.equal(result.valid, false)
  })

  it("parses --database", () => {
    const result = parseArgs(["tmp/run1", "--database", "/tmp/x.db"])
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.equal(result.value.database, "/tmp/x.db")
  })
})

// ---------------------------------------------------------------------------
// requireModelVersion
// ---------------------------------------------------------------------------

describe("requireModelVersion", () => {
  it("throws for null — never guesses a descriptor model", () => {
    assert.throws(() => requireModelVersion(null))
  })

  it("throws for an empty string", () => {
    assert.throws(() => requireModelVersion(""))
  })

  it("returns the tag unchanged otherwise", () => {
    assert.equal(requireModelVersion("v1"), "v1")
  })
})

// ---------------------------------------------------------------------------
// readJsonl
// ---------------------------------------------------------------------------

describe("readJsonl", () => {
  it("reports present:false for a missing file", () => {
    const result = readJsonl(path.join(workDir, "does-not-exist.jsonl"))
    assert.equal(result.present, false)
    assert.deepEqual(result.records, [])
  })

  it("skips malformed lines without throwing", () => {
    const file = path.join(workDir, "partial.jsonl")
    fs.writeFileSync(file, '{"a":1}\nnot json\n{"a":2}\n\n')
    const result = readJsonl(file)
    assert.equal(result.present, true)
    assert.equal(result.skipped, 1)
    assert.deepEqual(result.records, [{ a: 1 }, { a: 2 }])
  })
})

// ---------------------------------------------------------------------------
// joinPhotosToMedia (pure)
// ---------------------------------------------------------------------------

describe("joinPhotosToMedia", () => {
  it("matches by sha256 and counts the rest as unmatched", () => {
    const photos = [photo({ id: 0, sha256: "sha-a" }), photo({ id: 1, sha256: "sha-unknown" })]
    const mediaBySha = new Map([["sha-a", 42]])
    const { matched, unmatchedCount } = joinPhotosToMedia(photos, mediaBySha)
    assert.equal(matched.length, 1)
    assert.equal(matched[0].mediaId, 42)
    assert.equal(matched[0].photo.id, 0)
    assert.equal(unmatchedCount, 1)
  })

  it("matches nothing against an empty map", () => {
    const { matched, unmatchedCount } = joinPhotosToMedia([photo()], new Map())
    assert.equal(matched.length, 0)
    assert.equal(unmatchedCount, 1)
  })
})

// ---------------------------------------------------------------------------
// frameMetadataForPhotos (pure)
// ---------------------------------------------------------------------------

describe("frameMetadataForPhotos", () => {
  it("gives a photo with no duplicates itself as its own frame root", () => {
    const meta = frameMetadataForPhotos([photo({ id: 0, sha256: "sha-a" })])
    assert.equal(meta.get(0)?.frameRootSha256, "sha-a")
  })

  it("resolves a transitively-linked burst to ONE content-addressed root", () => {
    // A->B and C->B. All three are the same moment; a one-hop reading would
    // leave C pointing at B while A pointed at B too but never at C.
    const meta = frameMetadataForPhotos([
      photo({ id: 0, sha256: "sha-a" }),
      photo({ id: 1, sha256: "sha-b", nearDuplicateOf: 0 }),
      photo({ id: 2, sha256: "sha-c", nearDuplicateOf: 1 }),
    ])
    assert.equal(meta.get(0)?.frameRootSha256, "sha-a")
    assert.equal(meta.get(1)?.frameRootSha256, "sha-a")
    assert.equal(meta.get(2)?.frameRootSha256, "sha-a")
  })

  it("treats exact and near duplicate links as the same equivalence", () => {
    const meta = frameMetadataForPhotos([
      photo({ id: 0, sha256: "sha-a" }),
      photo({ id: 1, sha256: "sha-a", exactDuplicateOf: 0 }),
      photo({ id: 2, sha256: "sha-c", nearDuplicateOf: 0 }),
    ])
    const roots = new Set([0, 1, 2].map((id) => meta.get(id)?.frameRootSha256))
    assert.deepEqual([...roots], ["sha-a"])
  })

  it("converts EXIF capture time to an ISO string, and leaves a photo without one null", () => {
    const meta = frameMetadataForPhotos([
      photo({ id: 0, sha256: "sha-a", capturedAtMs: 1700000000000 }),
      photo({ id: 1, sha256: "sha-b", capturedAtMs: null }),
    ])
    assert.equal(meta.get(0)?.capturedAt, new Date(1700000000000).toISOString())
    assert.equal(meta.get(1)?.capturedAt, null)
  })

  it("falls back to a photo's own hash when its duplicate target was never written", () => {
    // A --limit'ed run can reference a photo id it has no row for. The column
    // must still get a value; its own frame is the truthful reading.
    const meta = frameMetadataForPhotos([photo({ id: 7, sha256: "sha-g", nearDuplicateOf: 3 })])
    assert.equal(meta.get(7)?.frameRootSha256, "sha-g")
  })
})

// ---------------------------------------------------------------------------
// ingestRun, against a real temp DB
// ---------------------------------------------------------------------------

describe("ingestRun", () => {
  it("joins by sha256, inserts one media_faces row per face of a matched photo, and round-trips the descriptor", () => {
    const db = freshDb()
    try {
      const mediaId = seedMedia(db, "sha-a")
      seedMedia(db, "sha-other") // unrelated row; must not affect counts

      const runDir = path.join(workDir, "run-basic")
      const descriptor = [0.1, 0.2, -0.3, 0.4, 0.5, -0.6, 0.7, -0.8]
      writeRun(
        runDir,
        [photo({ id: 0, sha256: "sha-a" }), photo({ id: 1, sha256: "sha-unmatched" })],
        [face(descriptor, { id: 0, photoId: 0 }), face(descriptor, { id: 1, photoId: 1 })],
      )

      const result = ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      assert.equal(result.photosInRun, 2)
      assert.equal(result.matched, 1)
      assert.equal(result.unmatched, 1)
      assert.equal(result.facesInserted, 1) // photo 1's face is dropped — its photo never matched

      const rows = /** @type {any[]} */ (
        db.prepare(`SELECT * FROM media_faces WHERE media_id = ?`).all(mediaId)
      )
      assert.equal(rows.length, 1)
      const row = rows[0]
      assert.equal(row.source, "cli")
      assert.equal(row.model_version, "v1")
      assert.equal(row.deleted_at, null)
      assert.equal(row.bbox_x, 10)
      assert.equal(row.bbox_y, 20)
      assert.equal(row.bbox_w, 40)
      assert.equal(row.bbox_h, 40)

      const decoded = Array.from(blobToDescriptor(row.descriptor))
      assert.equal(decoded.length, descriptor.length)
      for (let i = 0; i < descriptor.length; i++) {
        assert.ok(Math.abs(decoded[i] - descriptor[i]) < 1e-6, `component ${i} round-trips`)
      }
    } finally {
      db.close()
    }
  })

  it("refuses to re-run for the same (media_id, model_version) without --replace", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-refuse")
      writeRun(runDir, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])

      ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      assert.throws(() => ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false }))

      const count = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM media_faces WHERE deleted_at IS NULL`).get()
      ).n
      assert.equal(count, 1, "the refused re-run must not have inserted a second row")
    } finally {
      db.close()
    }
  })

  it("--replace soft-deletes the previous 'cli' rows before inserting new ones", () => {
    const db = freshDb()
    try {
      const mediaId = seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-replace")
      writeRun(runDir, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])

      ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      const result = ingestRun({ db, runDir, modelVersion: "v1", replace: true, dryRun: false })
      assert.equal(result.facesInserted, 1)

      const live = /** @type {{ n: number }} */ (
        db
          .prepare(`SELECT COUNT(*) AS n FROM media_faces WHERE media_id = ? AND deleted_at IS NULL`)
          .get(mediaId)
      ).n
      const retired = /** @type {{ n: number }} */ (
        db
          .prepare(`SELECT COUNT(*) AS n FROM media_faces WHERE media_id = ? AND deleted_at IS NOT NULL`)
          .get(mediaId)
      ).n
      assert.equal(live, 1, "exactly one live row after --replace")
      assert.equal(retired, 1, "the original row was soft-deleted, not hard-deleted")
    } finally {
      db.close()
    }
  })

  it("a different model_version for the same media_id is not a conflict", () => {
    const db = freshDb()
    try {
      const mediaId = seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-versions")
      writeRun(runDir, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])

      ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      ingestRun({ db, runDir, modelVersion: "v2", replace: false, dryRun: false })

      const live = /** @type {{ n: number }} */ (
        db
          .prepare(`SELECT COUNT(*) AS n FROM media_faces WHERE media_id = ? AND deleted_at IS NULL`)
          .get(mediaId)
      ).n
      assert.equal(live, 2, "both model versions' rows stay live side by side")
    } finally {
      db.close()
    }
  })

  it("--dry-run reports counts but writes nothing", () => {
    const db = freshDb()
    try {
      const mediaId = seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-dry")
      writeRun(runDir, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])

      const result = ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: true })
      assert.equal(result.facesInserted, 1)

      const count = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM media_faces WHERE media_id = ?`).get(mediaId)
      ).n
      assert.equal(count, 0, "dry run must not write any row")
    } finally {
      db.close()
    }
  })

  it("throws if photos.jsonl or faces.jsonl is missing", () => {
    const db = freshDb()
    try {
      const runDir = path.join(workDir, "run-missing")
      fs.mkdirSync(runDir, { recursive: true })
      assert.throws(() => ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false }))
    } finally {
      db.close()
    }
  })
})

// ---------------------------------------------------------------------------
// backfillFromManifest
// ---------------------------------------------------------------------------

describe("backfillFromManifest", () => {
  /** @param {number} mediaId @param {string} sha */
  function manifestFor(mediaId, sha) {
    return {
      version: 1,
      origins: {
        "http://localhost:3000": {
          [sha]: {
            id: mediaId,
            fileKey: "abc123",
            section: "official",
            name: "IMG_0001.jpg",
            bytes: 12345,
            at: "2026-01-01T00:00:00.000Z",
          },
        },
      },
    }
  }

  it("populates source_sha256 only where it was NULL", () => {
    const db = freshDb()
    try {
      const mediaId = seedMedia(db, null)
      const result = backfillFromManifest({ db, manifest: manifestFor(mediaId, "sha-x"), dryRun: false })
      assert.equal(result.total, 1)
      assert.equal(result.updated, 1)

      const row = /** @type {{ source_sha256: string | null }} */ (
        db.prepare(`SELECT source_sha256 FROM media WHERE id = ?`).get(mediaId)
      )
      assert.equal(row.source_sha256, "sha-x")
    } finally {
      db.close()
    }
  })

  it("does not overwrite a row that already has a source_sha256", () => {
    const db = freshDb()
    try {
      const mediaId = seedMedia(db, "sha-existing")
      const result = backfillFromManifest({ db, manifest: manifestFor(mediaId, "sha-x"), dryRun: false })
      assert.equal(result.updated, 0)

      const row = /** @type {{ source_sha256: string | null }} */ (
        db.prepare(`SELECT source_sha256 FROM media WHERE id = ?`).get(mediaId)
      )
      assert.equal(row.source_sha256, "sha-existing")
    } finally {
      db.close()
    }
  })

  it("--dry-run counts what would change without writing", () => {
    const db = freshDb()
    try {
      const mediaId = seedMedia(db, null)
      const result = backfillFromManifest({ db, manifest: manifestFor(mediaId, "sha-x"), dryRun: true })
      assert.equal(result.updated, 1)

      const row = /** @type {{ source_sha256: string | null }} */ (
        db.prepare(`SELECT source_sha256 FROM media WHERE id = ?`).get(mediaId)
      )
      assert.equal(row.source_sha256, null, "dry run must not write")
    } finally {
      db.close()
    }
  })
})
