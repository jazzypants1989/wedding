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
  buildIngestInput,
  frameMetadataForPhotos,
  gradeFace,
  ingestRun,
  joinPhotosToMedia,
  openDatabase,
  parseArgs,
  readJsonl,
  readTiming,
  requireModelVersion,
} from "../../scripts/vision/ingest-faces.js"
import { blobToDescriptor } from "../../db/media-faces.js"
import { PROFILE, routeCutoffs } from "../../public/vision/route.js"

/** An `assert.throws` matcher built from string methods. The no-regex rule
 *  covers the second argument to `assert.throws` too — a `/pattern/` there is
 *  still a regex literal in this repository's source.
 *  @param {string} needle */
function messageIncludes(needle) {
  /** @param {unknown} err @returns {boolean} */
  return (err) => err instanceof Error && err.message.includes(needle)
}

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

/**
 * The `provenance` block session1.js writes from the engine that actually ran.
 * Digest-shaped strings, invented here — nothing in tests/ ever loads a model.
 * @param {Partial<import('../../scripts/vision/types.js').EngineProvenance>} [over]
 * @returns {import('../../scripts/vision/types.js').EngineProvenance}
 */
function provenance(over = {}) {
  return {
    runtime: "onnxruntime-node 1.20.0",
    detectChannels: "bgr",
    embedChannels: "bgr",
    topKStage: "pre",
    embedNorm: "arcface",
    embedNormSource: "digest-table",
    detectorSha256: "d".repeat(64),
    embedderSha256: "e".repeat(64),
    engineSha256: "a".repeat(64),
    ...over,
  }
}

/** @param {Partial<import('../../scripts/vision/types.js').Session1Timing>} [over]
 *  @returns {import('../../scripts/vision/types.js').Session1Timing} */
function timing(over = {}) {
  return {
    photos: 1,
    faces: 1,
    stages: {},
    environment: { node: "v22.0.0" },
    provenance: provenance(),
    config: {
      detectEdge: 1280,
      sourceEdge: 2000,
      mirrorTta: false,
      nearDuplicateBits: 12,
      detect: { longEdge: 1280, scoreThreshold: 0.6, nmsIou: 0.3, topK: 5000, divisor: 32, duplicateIou: 0.55 },
      align: { size: 112 },
      // Two keys the real batch writes that must NEVER reach config_json: an
      // output path and a run-shaping flag. Their presence in the fixture is the
      // point — the allowlist is only worth anything if something is there to
      // leak.
      outDir: "/Users/someone/tmp/session1",
      limit: 50,
    },
    ...over,
  }
}

/** @param {string} dir @param {unknown[]} photos @param {unknown[]} faces
 *  @param {unknown} [timingOverride] `null` writes no timing.json at all. */
function writeRun(dir, photos, faces, timingOverride) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "photos.jsonl"), photos.map((p) => JSON.stringify(p)).join("\n") + "\n")
  fs.writeFileSync(path.join(dir, "faces.jsonl"), faces.map((f) => JSON.stringify(f)).join("\n") + "\n")
  const timingValue = timingOverride === undefined ? timing() : timingOverride
  if (timingValue !== null) {
    fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(timingValue, null, 2) + "\n")
  }
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

// ---------------------------------------------------------------------------
// Ingest provenance (plan §9a, Phase 5 contract §4)
// ---------------------------------------------------------------------------

describe("buildIngestInput — fail closed, never guess", () => {
  const faces = [face([1, 2, 3], { id: 0, photoId: 0 })]

  it("reads the engine's digests and settings out of timing.json", () => {
    const input = buildIngestInput({ timing: timing(), faces, modelVersion: "v1" })
    assert.equal(input.detectorSha256, "d".repeat(64))
    assert.equal(input.embedderSha256, "e".repeat(64))
    assert.equal(input.engineSha256, "a".repeat(64))
    assert.equal(input.normalisation, "arcface")
    assert.equal(input.mirrorApplied, false)
    assert.equal(input.routeProfile, PROFILE)
    assert.equal(input.modelVersion, "v1")
    assert.equal(typeof input.datasetId, "string")
    assert.ok(input.datasetId.length > 0)
  })

  it("REFUSES a run whose timing.json carries no provenance block", () => {
    const bare = timing()
    delete (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (bare))).provenance
    assert.throws(
      () => buildIngestInput({ timing: bare, faces, modelVersion: "v1" }),
      messageIncludes("provenance"),
    )
  })

  it("REFUSES a redescribe output, and says why", () => {
    // redescribe-crops.js DELETES `provenance` and writes `describeProvenance`
    // instead, precisely so a consumer stops rather than recording one model's
    // digests against another model's vectors. This is that stop.
    const redescribed = timing()
    const block = redescribed.provenance
    delete (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (redescribed))).provenance
    ;(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (redescribed))).describeProvenance = block

    assert.throws(
      () => buildIngestInput({ timing: redescribed, faces, modelVersion: "v1" }),
      messageIncludes("redescribe-crops"),
    )
  })

  it("REFUSES a run that does not record its mirror setting", () => {
    const noMirror = timing()
    delete (/** @type {Record<string, unknown>} */ (noMirror.config)).mirrorTta
    assert.throws(
      () => buildIngestInput({ timing: noMirror, faces, modelVersion: "v1" }),
      messageIncludes("mirrorTta"),
    )
  })

  it("REFUSES a provenance string that looks like a path or an env reference", () => {
    for (const runtime of ["/opt/onnxruntime/1.20.0", "C:\\ort\\1.20.0", "$ORT_VERSION"]) {
      assert.throws(
        () =>
          buildIngestInput({
            timing: timing({ provenance: provenance({ runtime }) }),
            faces,
            modelVersion: "v1",
          }),
        messageIncludes("path or an environment reference"),
        `"${runtime}" must be refused`,
      )
    }
  })

  it("config_json carries no path, no argv and no environment variable", () => {
    // The fixture's timing.config deliberately contains `outDir` (an absolute
    // path) and `limit` (a run-shaping argument). Neither may survive, and
    // nothing that merely LOOKS like a path may either.
    const input = buildIngestInput({ timing: timing(), faces, modelVersion: "v1" })
    const serialised = JSON.stringify(input.config)

    assert.ok(!serialised.includes("outDir"), "an output directory must never reach config_json")
    assert.ok(!serialised.includes("/Users/"), "no filesystem path")
    assert.ok(!serialised.includes("limit"), "no run-shaping argv")
    assert.ok(!serialised.includes("$"), "no environment reference")
    assert.ok(!serialised.includes("\\\\"), "no windows path separator")

    // Walk every value, so the checks above cannot be satisfied by a nested
    // object nobody stringified into the top level.
    /** @param {unknown} value */
    const assertInert = (value) => {
      if (typeof value === "string") {
        assert.ok(!value.includes("/"), `config value "${value}" contains a path separator`)
        assert.ok(!value.includes("$"), `config value "${value}" contains an env reference`)
      } else if (value && typeof value === "object") {
        for (const inner of Object.values(value)) assertInert(inner)
      } else if (value !== null) {
        assert.ok(
          typeof value === "number" || typeof value === "boolean",
          "config values are strings, numbers, booleans, nulls and nested objects only",
        )
      }
    }
    assertInert(input.config)
  })

  it("config_json records the thresholds and the cutoff table that actually ran", () => {
    const input = buildIngestInput({ timing: timing(), faces, modelVersion: "v1" })
    const config = /** @type {any} */ (input.config)
    assert.equal(config.schemaVersion, 1)
    assert.equal(config.routeProfile, PROFILE)
    assert.equal(config.detectEdge, 1280)
    assert.equal(config.detect.scoreThreshold, 0.6)
    assert.equal(config.align.size, 112)
    assert.equal(config.embedChannels, "bgr")
    assert.equal(config.topKStage, "pre")
    // The values the stored route_state was graded against, not just their name.
    const cutoffs = routeCutoffs()
    assert.equal(config.routeCutoffs.minBoxPx, cutoffs.minBoxPx)
    assert.equal(config.routeCutoffs.acceptMinSharpness, cutoffs.acceptMinSharpness)
  })

  it("REFUSES a bare filename or a directory segment, which a blocklist let through", () => {
    // `safeString` rejected only "/", "\\" and "$", so anything without one
    // passed — a model filename, a photo-directory name, an environment
    // variable's NAME. config_json travels to production and this repository is
    // public, so every field now has to fit its own declared value space.
    /** @type {Array<[string, string]>} */
    const cases = [
      ["runtime", "det_10g.onnx"],
      ["runtime", "wedding-photos-raw"],
      ["detectChannels", "wedding-photos-raw"],
      ["embedChannels", "det_10g.onnx"],
      ["topKStage", "somewhere-else"],
      ["embedNorm", "guest-photos"],
      ["embedNormSource", "IMG_4821"],
      ["detectorSha256", "det_10g.onnx"],
      ["embedderSha256", "sface"],
      ["engineSha256", "engine.mjs"],
    ]
    for (const [field, value] of cases) {
      assert.throws(
        () =>
          buildIngestInput({
            timing: timing({ provenance: provenance({ [field]: value }) }),
            faces,
            modelVersion: "v1",
          }),
        (err) => err instanceof Error && err.message.includes(field),
        `provenance.${field} = "${value}" must be refused`,
      )
    }
  })

  it("accepts the values the engine that actually runs reports", () => {
    // The real tmp/rig/engine.mjs reports "sha256-table" or the NAME of the
    // override variable, and either an in-graph or an arcface normalisation.
    for (const over of [
      { embedNormSource: "sha256-table" },
      { embedNormSource: "RIG_EMBED_NORM" },
      { embedNorm: "in-graph" },
      { detectChannels: /** @type {const} */ ("rgb"), embedChannels: /** @type {const} */ ("rgb") },
      { topKStage: /** @type {const} */ ("post") },
      { runtime: "onnxruntime-node unknown" },
      { runtime: "onnxruntime-node 1.22.0-rc.1" },
    ]) {
      const input = buildIngestInput({
        timing: timing({ provenance: provenance(over) }),
        faces,
        modelVersion: "v1",
      })
      assert.ok(input.config, `${JSON.stringify(over)} must be accepted`)
    }
  })

  it("REFUSES a model_version that is a path, an env reference or free text", () => {
    for (const bad of [
      "/Users/someone/models/sface",
      "$MODEL",
      "sface 128",
      "sface\nnomirror",
      "m".repeat(200),
      "",
    ]) {
      assert.throws(
        () => buildIngestInput({ timing: timing(), faces, modelVersion: bad }),
        (err) => err instanceof Error && err.message.includes("model-version"),
        `model_version "${bad}" must be refused`,
      )
    }
  })

  it("accepts this project's own model_version tag", () => {
    const input = buildIngestInput({
      timing: timing(),
      faces,
      modelVersion: "sface128-n127.5d128-nomirror",
    })
    assert.equal(input.modelVersion, "sface128-n127.5d128-nomirror")
  })

  it("readTiming refuses a run directory with no timing.json", () => {
    const dir = path.join(workDir, "run-no-timing-read")
    fs.mkdirSync(dir, { recursive: true })
    assert.throws(() => readTiming(dir), messageIncludes("not found"))
  })
})

describe("gradeFace", () => {
  it("grades a face from its nine stored signals, and stamps the profile", () => {
    const verdict = gradeFace(face([1, 2, 3]), routeCutoffs())
    assert.ok(verdict)
    assert.equal(verdict.profile, PROFILE)
    assert.ok(["accept", "ask", "set_aside"].includes(verdict.state))
  })

  it("leaves a record with NO signals ungraded rather than grading it as rejected", () => {
    assert.equal(gradeFace(face([1, 2, 3], { signals: undefined }), routeCutoffs()), null)
  })

  it("leaves a record missing ONE signal ungraded — a partial grade is a wrong grade", () => {
    const partial = face([1, 2, 3])
    delete (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (partial.signals))).sharpness
    assert.equal(gradeFace(partial, routeCutoffs()), null)
  })
})

describe("ingestRun — provenance, grading and atomicity", () => {
  it("writes one vision_ingests row and points every face at it", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-provenance")
      writeRun(
        runDir,
        [photo({ id: 0, sha256: "sha-a" })],
        [face([1, 2, 3], { id: 0, photoId: 0 }), face([4, 5, 6], { id: 1, photoId: 0 })],
      )

      const result = ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      assert.ok(result.ingestId)

      const ingests = /** @type {any[]} */ (db.prepare(`SELECT * FROM vision_ingests`).all())
      assert.equal(ingests.length, 1)
      assert.equal(ingests[0].id, result.ingestId)
      assert.equal(ingests[0].model_version, "v1")
      assert.equal(ingests[0].embedder_sha256, "e".repeat(64))
      assert.equal(ingests[0].mirror_applied, 0)
      assert.equal(ingests[0].route_profile, PROFILE)

      const rows = /** @type {any[]} */ (db.prepare(`SELECT ingest_id FROM media_faces`).all())
      assert.equal(rows.length, 2)
      for (const row of rows) assert.equal(row.ingest_id, result.ingestId)
    } finally {
      db.close()
    }
  })

  it("grades EVERY inserted row — route_state is no longer null on a real ingest", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-graded")
      writeRun(
        runDir,
        [photo({ id: 0, sha256: "sha-a" })],
        [face([1, 2, 3], { id: 0, photoId: 0 }), face([4, 5, 6], { id: 1, photoId: 0 })],
      )

      const result = ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      assert.equal(result.facesGraded, 2)

      const rows = /** @type {any[]} */ (
        db.prepare(`SELECT route_state, route_profile FROM media_faces`).all()
      )
      assert.equal(rows.length, 2)
      for (const row of rows) {
        assert.ok(row.route_state, "every ingested row carries a grade")
        assert.equal(row.route_profile, PROFILE, "and the cutoff set it was graded under")
      }
    } finally {
      db.close()
    }
  })

  it("leaves a signal-less face ungraded without refusing the ingest", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-ungraded")
      writeRun(
        runDir,
        [photo({ id: 0, sha256: "sha-a" })],
        [face([1, 2, 3], { id: 0, photoId: 0, signals: undefined })],
      )

      const result = ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      assert.equal(result.facesInserted, 1)
      assert.equal(result.facesGraded, 0)
      const row = /** @type {any} */ (db.prepare(`SELECT route_state FROM media_faces`).get())
      assert.equal(row.route_state, null, "ungraded, which downstream treats as showable")
    } finally {
      db.close()
    }
  })

  it("THE INGEST ROW AND ITS FACES COMMIT ATOMICALLY — neither survives a mid-ingest throw", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-atomic")
      // The second face's box is missing an x, and media_faces.bbox_x is
      // NOT NULL — a genuine constraint failure half way through the inserts,
      // rather than a seam opened in the code to let a test push it over.
      writeRun(
        runDir,
        [photo({ id: 0, sha256: "sha-a" })],
        [
          face([1, 2, 3], { id: 0, photoId: 0 }),
          face([4, 5, 6], { id: 1, photoId: 0, box: /** @type {any} */ ({ x: null, y: 0, w: 10, h: 10 }) }),
        ],
      )

      assert.throws(() => ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false }))

      const faceCount = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM media_faces`).get()
      ).n
      const ingestCount = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM vision_ingests`).get()
      ).n
      assert.equal(faceCount, 0, "the face that DID insert was rolled back with the rest")
      assert.equal(ingestCount, 0, "and so was the provenance row it pointed at")
    } finally {
      db.close()
    }
  })

  it("rolls the ingest row back when the conflict check refuses inside the transaction", () => {
    // The conflict check used to sit OUTSIDE the transaction. Now that it is
    // inside — and after createIngest — a refusal must take the ingest row with
    // it, or every refused re-run would leave a provenance row describing
    // nothing.
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-conflict-rollback")
      writeRun(runDir, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])

      ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false })
      assert.throws(() => ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false }))

      const ingestCount = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM vision_ingests`).get()
      ).n
      assert.equal(ingestCount, 1, "the refused run left no provenance row behind")
    } finally {
      db.close()
    }
  })

  it("REFUSES a model_version already recorded against a different descriptor space", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      seedMedia(db, "sha-b")
      const runOne = path.join(workDir, "run-invariant-1")
      const runTwo = path.join(workDir, "run-invariant-2")
      writeRun(runOne, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])
      // Same model_version, DIFFERENT embedder. That is the whole failure: the
      // string would name two descriptor spaces, and every distance comparison
      // would quietly mix them.
      writeRun(
        runTwo,
        [photo({ id: 0, sha256: "sha-b" })],
        [face([1, 2, 3], { id: 0, photoId: 0 })],
        timing({ provenance: provenance({ embedderSha256: "f".repeat(64) }) }),
      )

      ingestRun({ db, runDir: runOne, modelVersion: "shared", replace: false, dryRun: false })
      assert.throws(
        () => ingestRun({ db, runDir: runTwo, modelVersion: "shared", replace: false, dryRun: false }),
        messageIncludes("embedder_sha256"),
      )

      const ingestCount = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM vision_ingests`).get()
      ).n
      assert.equal(ingestCount, 1, "the refusal wrote nothing")
      const faceCount = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM media_faces`).get()
      ).n
      assert.equal(faceCount, 1, "and inserted no faces")
    } finally {
      db.close()
    }
  })

  it("PERMITS an identical reuse — a second run of the same models is expected", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      seedMedia(db, "sha-b")
      const runOne = path.join(workDir, "run-same-1")
      const runTwo = path.join(workDir, "run-same-2")
      writeRun(runOne, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])
      writeRun(runTwo, [photo({ id: 0, sha256: "sha-b" })], [face([4, 5, 6], { id: 0, photoId: 0 })])

      ingestRun({ db, runDir: runOne, modelVersion: "shared", replace: false, dryRun: false })
      ingestRun({ db, runDir: runTwo, modelVersion: "shared", replace: false, dryRun: false })

      const ingests = /** @type {any[]} */ (
        db.prepare(`SELECT id FROM vision_ingests ORDER BY id`).all()
      )
      assert.equal(ingests.length, 2, "one row per run, both under one model_version")
    } finally {
      db.close()
    }
  })

  it("refuses a run directory with no timing.json before touching the database", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-no-timing")
      writeRun(runDir, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })], null)

      assert.throws(
        () => ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: false }),
        messageIncludes("timing.json"),
      )
      const faceCount = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM media_faces`).get()
      ).n
      assert.equal(faceCount, 0)
    } finally {
      db.close()
    }
  })

  it("--dry-run answers both refusals without writing a provenance row", () => {
    const db = freshDb()
    try {
      seedMedia(db, "sha-a")
      const runDir = path.join(workDir, "run-dry-provenance")
      writeRun(runDir, [photo({ id: 0, sha256: "sha-a" })], [face([1, 2, 3], { id: 0, photoId: 0 })])

      const result = ingestRun({ db, runDir, modelVersion: "v1", replace: false, dryRun: true })
      assert.equal(result.ingestId, null)
      assert.equal(result.facesGraded, 1, "a dry run still reports what would be graded")

      const ingestCount = /** @type {{ n: number }} */ (
        db.prepare(`SELECT COUNT(*) AS n FROM vision_ingests`).get()
      ).n
      assert.equal(ingestCount, 0)
    } finally {
      db.close()
    }
  })
})
