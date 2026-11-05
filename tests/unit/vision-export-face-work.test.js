/** @file Unit tests for scripts/vision/export-face-work.js — the portable
 *  face-work hand-off (plan §13).
 *
 *  Everything here runs against disposable temp SQLite files built by
 *  `createTables` + `runMigrations`. There is no server, no photograph and no
 *  weights file: every "photo" is a hand-invented sha256 string, every box is a
 *  hand-written rectangle, and every person is a made-up name (CLAUDE.md §15 —
 *  nothing under tests/ ever touches a real photograph or records a
 *  measurement of one).
 *
 *  Note on `bindExecutor`: db/sql.js holds ONE process-wide executor, so a test
 *  holding a source and a target database at once must re-bind before touching
 *  either. `useDatabase(db)` is that call, and every helper below starts with
 *  it — which is also the property the production entry points rely on.
 */

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import {
  batchRevocationHistory,
  getBatch,
  recordAssignment,
  revokeBatch,
} from "../../db/face-assignments.js"
import { createIdentity, descriptorToBlob } from "../../db/media-faces.js"
import { createPerson } from "../../db/people.js"
import { sql } from "../../db/sql.js"
import { createIngest } from "../../db/vision-ingests.js"
import {
  applyFaceWorkImport,
  batchIdForDigest,
  buildFaceWorkExport,
  canonicalJson,
  exportDestinationRefusal,
  faceWorkBoxKey,
  faceWorkDigest,
  faceWorkPreflight,
  faceWorkProvenanceDiff,
  matchFaceWorkKeys,
  openDatabase,
  parseFaceWorkArgs,
  parseFaceWorkArtifact,
  planFaceWorkImport,
  useDatabase,
} from "../../scripts/vision/export-face-work.js"
import { PINNED_WEIGHTS } from "../../scripts/vision/verify-weights.js"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..")

/** @type {string} */
let workDir

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "face-work-test-"))
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

/** The provenance both sides share unless a test deliberately breaks it.
 *  Annotated rather than inferred so `Partial<typeof BASE_PROVENANCE>` lets a
 *  test pass a different string, not only the frozen literal.
 *  @type {import('../../db/types.js').CreateIngestInput} */
const BASE_PROVENANCE = Object.freeze({
  datasetId: "dataset-fixture",
  modelVersion: "sface128-n127.5d128-nomirror",
  detectorSha256: "d".repeat(64),
  embedderSha256: "e".repeat(64),
  engineSha256: "9".repeat(64),
  mirrorApplied: false,
  normalisation: "arcface",
  routeProfile: "route-r1",
  config: { engineVersion: "fixture-1", detectionResolution: 640, scoreThreshold: 0.6 },
})

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Partial<typeof BASE_PROVENANCE>} [over]
 */
function seedIngest(db, over = {}) {
  useDatabase(db)
  return createIngest({ ...BASE_PROVENANCE, ...over })
}

let fileKeyCounter = 0
/**
 * One `media` row carrying a hand-invented content hash.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} sha256
 */
function seedMedia(db, sha256) {
  useDatabase(db)
  fileKeyCounter++
  const result = sql`INSERT INTO media (file_key, kind, section, status, source_sha256)
    VALUES (${`key${fileKeyCounter}`.padStart(32, "0")}, 'image', 'guest', 'approved', ${sha256})`.run()
  return Number(result.lastInsertRowid)
}

/**
 * One `media_faces` row, optionally with a descriptor so the export can be
 * shown NOT to carry it.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ mediaId: number, ingestId: number, box: { x: number, y: number, w: number, h: number }, descriptor?: boolean }} opts
 */
function seedFace(db, { mediaId, ingestId, box, descriptor = false }) {
  useDatabase(db)
  const blob = descriptor ? descriptorToBlob(Float32Array.from([0.25, -0.5, 0.75, 1])) : null
  const result = sql`INSERT INTO media_faces
    (media_id, bbox_x, bbox_y, bbox_w, bbox_h, descriptor, model_version, source, ingest_id)
    VALUES (${mediaId}, ${box.x}, ${box.y}, ${box.w}, ${box.h}, ${blob},
      ${BASE_PROVENANCE.modelVersion}, 'cli', ${ingestId})`.run()
  return Number(result.lastInsertRowid)
}

/**
 * A person plus one identity — confirmed unless a test asks otherwise.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} displayName
 * @param {import('../../types.js').FaceIdentityProvenance} [provenance]
 */
function seedPerson(db, displayName, provenance = "confirmed") {
  useDatabase(db)
  const person = createPerson({ displayName })
  const identity = createIdentity({ personId: person.id, provenance })
  return { personId: person.id, identityId: identity.id }
}

/** Every live identity, as `<display name>/<provenance>`.
 *  @param {import('node:sqlite').DatabaseSync} db */
function identityProvenances(db) {
  useDatabase(db)
  /** @type {Array<{ display_name: string, provenance: string }>} */
  const rows = sql`SELECT p.display_name AS display_name, fi.provenance AS provenance
    FROM face_identities fi
    JOIN people p ON p.id = fi.person_id
    WHERE fi.deleted_at IS NULL
    ORDER BY p.display_name, fi.provenance`.all()
  return rows.map((row) => `${row.display_name}/${row.provenance}`)
}

/**
 * The faces `db/media-faces.js`'s `confirmedIdentityFaces` would hand the
 * recogniser as ground truth — the exact filter the provenance column exists to
 * be. Written out here rather than imported so the test states the property it
 * is protecting instead of trusting the same predicate twice.
 * @param {import('node:sqlite').DatabaseSync} db
 */
function confirmedFaceCount(db) {
  useDatabase(db)
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM media_faces mf
    JOIN face_identities fi ON fi.id = mf.face_identity_id
    WHERE mf.deleted_at IS NULL AND fi.deleted_at IS NULL AND fi.provenance = 'confirmed'`.get()
  return row ? row.n : 0
}

/**
 * Re-seal a hand-edited artifact: mutate the payload, then recompute the digest
 * and the batch id so it is internally consistent. This is exactly the effort a
 * hand-edit costs — the digest is unkeyed — which is why every refusal below has
 * to come from validating the CONTENT, not from the hash.
 * @param {import('../../scripts/vision/types.js').FaceWorkArtifact} artifact
 * @param {(payload: any) => void} mutate
 * @returns {string}
 */
function reseal(artifact, mutate) {
  const copy = JSON.parse(JSON.stringify(artifact))
  mutate(copy.payload)
  copy.contentSha256 = faceWorkDigest(copy.payload)
  copy.batchId = batchIdForDigest(copy.contentSha256)
  return JSON.stringify(copy)
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} faceId
 * @param {number} identityId
 */
function confirm(db, faceId, identityId) {
  useDatabase(db)
  return recordAssignment({ faceId, op: "assign", identityId, actor: "fixture" })
}

/** The projected state, as a person's display name per box key.
 *  @param {import('node:sqlite').DatabaseSync} db */
function projectedByKey(db) {
  useDatabase(db)
  /** @type {Array<{ sha256: string, bbox_x: number, bbox_y: number, bbox_w: number, bbox_h: number, display_name: string | null, deleted_at: string | null }>} */
  const rows = sql`SELECT m.source_sha256 AS sha256, mf.bbox_x AS bbox_x, mf.bbox_y AS bbox_y,
      mf.bbox_w AS bbox_w, mf.bbox_h AS bbox_h, p.display_name AS display_name,
      mf.deleted_at AS deleted_at
    FROM media_faces mf
    JOIN media m ON m.id = mf.media_id
    LEFT JOIN face_identities fi ON fi.id = mf.face_identity_id
    LEFT JOIN people p ON p.id = fi.person_id
    ORDER BY mf.id`.all()
  /** @type {Map<string, string | null>} */
  const map = new Map()
  for (const row of rows) {
    const key = faceWorkBoxKey(row.sha256, {
      x: row.bbox_x,
      y: row.bbox_y,
      w: row.bbox_w,
      h: row.bbox_h,
    })
    map.set(key, row.deleted_at !== null && row.display_name === null ? "NOT_A_FACE" : row.display_name)
  }
  return map
}

/** @param {import('node:sqlite').DatabaseSync} db */
function eventCount(db) {
  useDatabase(db)
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM face_assignments`.get()
  return row ? row.n : 0
}

/** @param {import('node:sqlite').DatabaseSync} db */
function peopleCount(db) {
  useDatabase(db)
  /** @type {{ n: number } | undefined} */
  const row = sql`SELECT COUNT(*) AS n FROM people`.get()
  return row ? row.n : 0
}

/** Three photographs, two named people, one un-named face. */
const PHOTOS = Object.freeze([
  { sha: "a".repeat(64), box: { x: 10.5, y: 20.25, w: 40, h: 40 } },
  { sha: "b".repeat(64), box: { x: 100.5, y: 60.75, w: 50, h: 50 } },
  { sha: "c".repeat(64), box: { x: 5.5, y: 5.5, w: 30, h: 30 } },
])

/**
 * How many throwaway rows the source creates before the real ones, so that
 * every real id lands above 20. Small integers (0, 1, a format version, an
 * event count) legitimately appear in the artifact and would make the "carries
 * no source-machine row id" scan below meaningless if an id could be one.
 */
const ID_PADDING = 20

/** The source machine: an ingest, three faces, two of them confirmed. */
function buildSource() {
  const db = freshDb()
  for (let i = 0; i < ID_PADDING; i++) seedIngest(db, { datasetId: `padding-${i}` })
  const ingest = seedIngest(db)
  for (let i = 0; i < ID_PADDING; i++) {
    const padPerson = createPerson({ displayName: `Padding Person ${i}` })
    createIdentity({ personId: padPerson.id, provenance: "confirmed" })
  }
  const padMedia = seedMedia(db, "f".repeat(64))
  for (let i = 0; i < ID_PADDING; i++) {
    seedFace(db, { mediaId: padMedia, ingestId: ingest.id, box: { x: i, y: i, w: 7, h: 7 } })
  }

  /** @type {number[]} */
  const faceIds = []
  for (const photo of PHOTOS) {
    const mediaId = seedMedia(db, photo.sha)
    faceIds.push(seedFace(db, { mediaId, ingestId: ingest.id, box: photo.box, descriptor: true }))
  }

  const ada = seedPerson(db, "Ada Fixture")
  const bram = seedPerson(db, "Bram Fixture")
  confirm(db, faceIds[0], ada.identityId)
  confirm(db, faceIds[1], bram.identityId)
  // faceIds[2] stays un-named on purpose: the export must say nothing about it.

  return { db, ingest, faceIds, ada, bram }
}

/** The target machine: the same photographs and the same boxes, nobody named.
 *  `photos` narrows it to a SUBSET, which is the ordinary production case — the
 *  server carries a curated selection, not the whole shoot. */
function buildTarget({ boxShift = 0, provenance = {}, photos = PHOTOS } = {}) {
  const db = freshDb()
  const ingest = seedIngest(db, provenance)
  /** @type {number[]} */
  const faceIds = []
  for (const photo of photos) {
    const mediaId = seedMedia(db, photo.sha)
    faceIds.push(
      seedFace(db, {
        mediaId,
        ingestId: ingest.id,
        box: { ...photo.box, x: photo.box.x + boxShift, y: photo.box.y + boxShift },
      }),
    )
  }
  return { db, ingest, faceIds }
}

/** @param {import('node:sqlite').DatabaseSync} db @param {boolean} [includePropagated] */
function exportFrom(db, includePropagated = false) {
  return buildFaceWorkExport({ db, ingestId: null, facesFrom: "ingest", includePropagated })
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {import('../../scripts/vision/types.js').FaceWorkArtifact} artifact
 * @param {{ matchOverlap?: boolean, force?: boolean }} [opts]
 */
function planFor(db, artifact, opts = {}) {
  return planFaceWorkImport({
    db,
    artifact,
    ingestId: null,
    facesFrom: "ingest",
    matchOverlap: opts.matchOverlap ?? false,
    force: opts.force ?? false,
  })
}

// ---------------------------------------------------------------------------

describe("canonicalJson", () => {
  it("is independent of key insertion order", () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }))
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}')
  })

  it("sorts nested keys too, and preserves array order", () => {
    assert.equal(canonicalJson({ z: [{ q: 1, p: 2 }] }), '{"z":[{"p":2,"q":1}]}')
    assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]")
  })

  it("gives anything with no JSON form the same answer JSON.stringify does", () => {
    assert.equal(canonicalJson(undefined), "null")
    assert.equal(canonicalJson(Number.NaN), "null")
    assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}')
  })
})

describe("faceWorkBoxKey", () => {
  it("rounds to two decimal places, matching what wrote the boxes", () => {
    assert.equal(faceWorkBoxKey("abc", { x: 10.004, y: 20, w: 30.005, h: 40 }), "abc:10,20,30.01,40")
  })

  it("collapses -0 so a box at the origin keys one way", () => {
    assert.equal(faceWorkBoxKey("abc", { x: -0, y: 0, w: 1, h: 1 }), "abc:0,0,1,1")
  })
})

describe("parseFaceWorkArgs", () => {
  it("parses an export invocation", () => {
    const result = parseFaceWorkArgs(["export", "out.json", "--database", "x.db", "--dry-run"])
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.equal(result.value.command, "export")
    assert.equal(result.value.artifact, "out.json")
    assert.equal(result.value.database, "x.db")
    assert.equal(result.value.dryRun, true)
    assert.equal(result.value.facesFrom, "ingest")
    assert.equal(result.value.matchOverlap, false)
  })

  it("refuses an unknown option rather than ignoring it", () => {
    const result = parseFaceWorkArgs(["export", "out.json", "--nonsense"])
    assert.equal(result.valid, false)
    if (result.valid) return
    assert.ok(result.error.includes("--nonsense"))
  })

  it("refuses an unknown command", () => {
    const result = parseFaceWorkArgs(["migrate", "out.json"])
    assert.equal(result.valid, false)
  })

  it("makes the provisioning preflight non-optional on import", () => {
    const noWeights = parseFaceWorkArgs(["import", "in.json", "--engine", "e.mjs"])
    assert.equal(noWeights.valid, false)
    if (!noWeights.valid) assert.ok(noWeights.error.includes("--weights"))

    const noEngine = parseFaceWorkArgs(["import", "in.json", "--weights", "w"])
    assert.equal(noEngine.valid, false)
    if (!noEngine.valid) assert.ok(noEngine.error.includes("--engine"))
  })

  it("accepts digest-only import (--expect-engine, no --weights), and refuses both engine forms", () => {
    const sha = "a".repeat(64)
    const digestOnly = parseFaceWorkArgs(["import", "in.json", "--expect-engine", sha])
    assert.equal(digestOnly.valid, true)
    if (digestOnly.valid) {
      assert.equal(digestOnly.value.expectEngine, sha)
      assert.equal(digestOnly.value.engine, null)
      assert.equal(digestOnly.value.weights, null)
    }
    const both = parseFaceWorkArgs(["import", "in.json", "--engine", "e.mjs", "--expect-engine", sha])
    assert.equal(both.valid, false)
    if (!both.valid) assert.ok(both.error.includes("not both"))
  })

  it("only accepts the two documented --faces-from values", () => {
    assert.equal(parseFaceWorkArgs(["export", "o.json", "--faces-from", "guessing"]).valid, false)
    const ok = parseFaceWorkArgs(["export", "o.json", "--faces-from", "model-version"])
    assert.equal(ok.valid, true)
    if (ok.valid) assert.equal(ok.value.facesFrom, "model-version")
  })

  it("parses a revoke invocation, which needs a batch and no artifact", () => {
    // The undo the import prints. It names a batch already in the database, so
    // requiring an artifact path for it would be requiring a file that has
    // nothing to do with the operation.
    const ok = parseFaceWorkArgs(["revoke", "--batch", "face-work-abc", "--database", "x.db"])
    assert.equal(ok.valid, true)
    if (!ok.valid) return
    assert.equal(ok.value.command, "revoke")
    assert.equal(ok.value.batch, "face-work-abc")
    assert.equal(ok.value.artifact, null)

    const noBatch = parseFaceWorkArgs(["revoke"])
    assert.equal(noBatch.valid, false)
    if (!noBatch.valid) assert.ok(noBatch.error.includes("--batch"))
  })

  it("parses a reinstate invocation, which needs a batch and defaults its own actor", () => {
    const ok = parseFaceWorkArgs(["reinstate", "--batch", "face-work-abc", "--dry-run"])
    assert.equal(ok.valid, true)
    if (!ok.valid) return
    assert.equal(ok.value.command, "reinstate")
    assert.equal(ok.value.batch, "face-work-abc")
    assert.equal(ok.value.dryRun, true)
    assert.equal(ok.value.actor, "face-work-reinstate")

    const noBatch = parseFaceWorkArgs(["reinstate"])
    assert.equal(noBatch.valid, false)
    if (!noBatch.valid) assert.ok(noBatch.error.includes("reinstate needs --batch"))
  })

  it("defaults revoke's actor to the revoker, not to the importer", () => {
    // `revoked_by` reading "face-work-import" would attribute the undo to
    // whoever did the thing being undone.
    const dflt = parseFaceWorkArgs(["revoke", "--batch", "b1"])
    assert.equal(dflt.valid, true)
    if (dflt.valid) assert.equal(dflt.value.actor, "face-work-revoke")

    // And an operator who types the import's default out in full keeps it.
    const explicit = parseFaceWorkArgs(["revoke", "--batch", "b1", "--actor", "face-work-import"])
    assert.equal(explicit.valid, true)
    if (explicit.valid) assert.equal(explicit.value.actor, "face-work-import")
  })
})

describe("the exported artifact", () => {
  it("carries no descriptors, no paths and no source-machine row ids", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)

    /** @type {string[]} */
    const keys = []
    /** @type {string[]} */
    const strings = []
    /** @type {number[]} */
    const numbers = []
    /** @param {unknown} value */
    const walk = (value) => {
      if (typeof value === "string") return strings.push(value)
      if (typeof value === "number") return numbers.push(value)
      if (!value || typeof value !== "object") return
      if (Array.isArray(value)) return value.forEach(walk)
      for (const [key, child] of Object.entries(value)) {
        keys.push(key)
        walk(child)
      }
    }
    walk(artifact)

    for (const forbidden of [
      "descriptor",
      "descriptors",
      "id",
      "faceId",
      "face_id",
      "mediaId",
      "media_id",
      "personId",
      "person_id",
      "identityId",
      "identity_id",
      "ingestId",
      "ingest_id",
      "path",
      "file",
      "filename",
      "actor",
      "guestId",
      "guest_id",
      "notes",
    ]) {
      assert.ok(!keys.includes(forbidden), `artifact must not carry a "${forbidden}" key`)
    }

    for (const value of strings) {
      assert.ok(!value.includes("/"), `artifact string looks like a path: ${value}`)
      assert.ok(!value.includes("\\"), `artifact string looks like a path: ${value}`)
    }

    // The source's real row ids all sit above the padding rows, and no legitimate
    // number in the artifact reaches them.
    const forbiddenNumbers = new Set([
      source.ada.personId,
      source.bram.personId,
      source.ada.identityId,
      source.bram.identityId,
      ...source.faceIds,
      source.ingest.id,
    ])
    for (const value of numbers) {
      assert.ok(
        !forbiddenNumbers.has(value),
        `artifact carries ${value}, which is a source-machine row id`,
      )
    }

    // And the people travel under logical refs.
    assert.deepEqual(
      artifact.payload.people.map((person) => person.ref).sort(),
      ["p1", "p2"],
    )
    source.db.close()
  })

  it("says nothing about a face nobody named", () => {
    const source = buildSource()
    const { artifact, stats } = exportFrom(source.db)
    assert.equal(stats.assigned, 2)
    assert.equal(artifact.payload.confirmations.length, 2)
    const keys = artifact.payload.confirmations.map((c) => c.key)
    assert.ok(!keys.includes(faceWorkBoxKey(PHOTOS[2].sha, PHOTOS[2].box)))
    source.db.close()
  })

  it("hashes to the digest it declares, and the batch id follows the digest", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    assert.equal(faceWorkDigest(artifact.payload), artifact.contentSha256)
    assert.ok(artifact.batchId.startsWith("face-work-"))

    const parsed = parseFaceWorkArtifact(JSON.stringify(artifact))
    assert.equal(parsed.valid, true)
    source.db.close()
  })

  it("refuses an artifact edited after export", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const tampered = JSON.parse(JSON.stringify(artifact))
    tampered.payload.people[0].displayName = "Someone Else"
    const parsed = parseFaceWorkArtifact(JSON.stringify(tampered))
    assert.equal(parsed.valid, false)
    if (!parsed.valid) assert.ok(parsed.error.includes("digest"))
    source.db.close()
  })

  it("is byte-stable: re-exporting an unchanged source gives the same batch id", () => {
    const source = buildSource()
    const first = exportFrom(source.db)
    const second = exportFrom(source.db)
    assert.equal(first.artifact.batchId, second.artifact.batchId)
    source.db.close()
  })
})

describe("export -> import round trip", () => {
  it("reproduces the source's projected assignments on the target", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const sourceProjection = projectedByKey(source.db)

    const target = buildTarget()
    const plan = planFor(target.db, artifact)
    assert.deepEqual(plan.refusals, [])
    assert.deepEqual(plan.conflicts, [])
    assert.equal(plan.peopleToCreate.length, 2)
    assert.equal(plan.actions.length, 2)

    const result = applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })
    assert.equal(result.applied, true)
    assert.equal(result.events, 2)
    assert.equal(result.peopleCreated, 2)

    const targetProjection = projectedByKey(target.db)
    for (const photo of PHOTOS) {
      const key = faceWorkBoxKey(photo.sha, photo.box)
      assert.equal(
        targetProjection.get(key) ?? null,
        sourceProjection.get(key) ?? null,
        `key ${key} should project to the same person on both machines`,
      )
    }
    assert.equal(targetProjection.get(faceWorkBoxKey(PHOTOS[0].sha, PHOTOS[0].box)), "Ada Fixture")
    assert.equal(targetProjection.get(faceWorkBoxKey(PHOTOS[1].sha, PHOTOS[1].box)), "Bram Fixture")

    source.db.close()
    target.db.close()
  })

  it("carries a not_a_face verdict, and only when the LEDGER says so", () => {
    const source = buildSource()
    useDatabase(source.db)
    recordAssignment({ faceId: source.faceIds[2], op: "not_a_face", actor: "fixture" })

    const { artifact } = exportFrom(source.db)
    const verdict = artifact.payload.confirmations.find(
      (c) => c.key === faceWorkBoxKey(PHOTOS[2].sha, PHOTOS[2].box),
    )
    assert.ok(verdict)
    assert.equal(verdict.op, "not_a_face")
    assert.equal(verdict.personRef, null)

    const target = buildTarget()
    const plan = planFor(target.db, artifact)
    assert.deepEqual(plan.refusals, [])
    applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })
    assert.equal(
      projectedByKey(target.db).get(faceWorkBoxKey(PHOTOS[2].sha, PHOTOS[2].box)),
      "NOT_A_FACE",
    )

    source.db.close()
    target.db.close()
  })

  it("exports a merged-away identity's faces under the person they resolve to", () => {
    const source = buildSource()
    useDatabase(source.db)
    // Bram's identity is folded into Ada's. Bram must not export as a live
    // person, and his face must arrive as Ada's.
    sql`UPDATE face_identities SET merged_into = ${source.ada.identityId}
      WHERE id = ${source.bram.identityId}`.run()

    const { artifact } = exportFrom(source.db)
    assert.deepEqual(
      artifact.payload.people.map((person) => person.displayName),
      ["Ada Fixture"],
    )
    assert.equal(artifact.payload.confirmations.length, 2)
    assert.equal(new Set(artifact.payload.confirmations.map((c) => c.personRef)).size, 1)

    source.db.close()
  })

  it("annotates each confirmation with enough ledger to be honest", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    for (const confirmation of artifact.payload.confirmations) {
      assert.ok(confirmation.ledger)
      assert.equal(confirmation.ledger.events, 1)
      assert.equal(confirmation.ledger.op, "assign")
      // The batch kind is null (these events carry no batch) — and the ACTOR is
      // deliberately not a field at all.
      assert.equal(confirmation.ledger.kind, null)
      assert.ok(!Object.prototype.hasOwnProperty.call(confirmation.ledger, "actor"))
    }
    source.db.close()
  })

  it("exports a pre-ledger confirmation, which a replay would have lost", () => {
    const source = buildSource()
    useDatabase(source.db)
    // A confirmation as it existed before the ledger: the projection carries a
    // value and no event explains it.
    const extra = seedPerson(source.db, "Cleo Fixture")
    sql`UPDATE media_faces SET face_identity_id = ${extra.identityId}
      WHERE id = ${source.faceIds[2]}`.run()

    const { artifact } = exportFrom(source.db)
    const confirmation = artifact.payload.confirmations.find(
      (c) => c.key === faceWorkBoxKey(PHOTOS[2].sha, PHOTOS[2].box),
    )
    assert.ok(confirmation, "a pre-ledger confirmation must still export")
    assert.equal(confirmation.ledger, null)
    source.db.close()
  })
})

describe("replay safety", () => {
  it("an identical replay is a no-op: no events, no people, no second batch", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const target = buildTarget()

    const first = applyFaceWorkImport({
      db: target.db,
      plan: planFor(target.db, artifact),
      actor: "test-import",
      note: null,
    })
    assert.equal(first.applied, true)

    const eventsAfterFirst = eventCount(target.db)
    const peopleAfterFirst = peopleCount(target.db)
    const projectionAfterFirst = projectedByKey(target.db)

    const secondPlan = planFor(target.db, artifact)
    assert.equal(secondPlan.alreadyApplied, true)
    assert.deepEqual(secondPlan.actions, [])

    const second = applyFaceWorkImport({
      db: target.db,
      plan: secondPlan,
      actor: "test-import",
      note: null,
    })
    assert.equal(second.applied, false)
    assert.equal(second.events, 0)
    assert.equal(second.peopleCreated, 0)

    assert.equal(eventCount(target.db), eventsAfterFirst)
    assert.equal(peopleCount(target.db), peopleAfterFirst)
    assert.deepEqual([...projectedByKey(target.db)], [...projectionAfterFirst])

    useDatabase(target.db)
    /** @type {{ n: number } | undefined} */
    const batches = sql`SELECT COUNT(*) AS n FROM face_assignment_batches`.get()
    assert.equal(batches?.n, 1)

    source.db.close()
    target.db.close()
  })

  it("refuses to re-import a batch that was revoked, with no override", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const target = buildTarget()
    applyFaceWorkImport({
      db: target.db,
      plan: planFor(target.db, artifact),
      actor: "test-import",
      note: null,
    })

    useDatabase(target.db)
    revokeBatch(artifact.batchId, "someone")

    const forced = planFor(target.db, artifact, { force: true })
    assert.equal(forced.alreadyApplied, false)
    assert.equal(forced.refusals.length, 1)
    assert.ok(forced.refusals[0].includes("REVOKED"))
    // It names the way back that actually exists, not one that does not.
    assert.ok(forced.refusals[0].includes(`reinstate --batch ${artifact.batchId}`))
    assert.throws(() =>
      applyFaceWorkImport({ db: target.db, plan: forced, actor: "test-import", note: null }),
    )

    source.db.close()
    target.db.close()
  })
})

// ---------------------------------------------------------------------------
// revoke -> reinstate: a revoked import has a deliberate way back
// ---------------------------------------------------------------------------

/**
 * Run the CLI for real against a database file. The caller closes its own
 * connection first and reopens after: the point is the operator's path.
 * @param {string[]} argv
 */
function runCli(argv) {
  return spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "vision", "export-face-work.js"), ...argv],
    { encoding: "utf8" },
  )
}

/**
 * Source exported, target built and imported into, target CLOSED. Returns the
 * target's path so each step can reopen it.
 */
function importedTarget() {
  const source = buildSource()
  const { artifact } = exportFrom(source.db)
  source.db.close()

  const target = buildTarget()
  const dbPath = path.join(workDir, `db-${dbCounter}.sqlite`)
  applyFaceWorkImport({
    db: target.db,
    plan: planFor(target.db, artifact),
    actor: "test-import",
    note: null,
  })
  const imported = [...projectedByKey(target.db)]
  target.db.close()
  return { artifact, dbPath, imported, faceIds: target.faceIds }
}

/** @param {string} dbPath */
function snapshot(dbPath, batchId = "") {
  const db = openDatabase(dbPath)
  const state = {
    projection: [...projectedByKey(db)],
    events: eventCount(db),
    batch: { ...getBatch(batchId) },
    history: batchRevocationHistory(batchId).map((row) => `${row.op}:${row.actor}`),
  }
  db.close()
  return state
}

describe("reinstate", () => {
  it("import -> revoke -> reinstate restores the same projection", () => {
    const { artifact, dbPath, imported } = importedTarget()
    const batch = artifact.batchId

    const revoked = runCli(["revoke", "--batch", batch, "--database", dbPath])
    assert.equal(revoked.status, 0, revoked.stderr)
    assert.ok(revoked.stdout.includes(`reinstate --batch ${batch}`))
    const afterRevoke = snapshot(dbPath, batch)
    assert.notDeepEqual(afterRevoke.projection, imported)
    assert.ok(afterRevoke.batch.revoked_at)

    const reinstated = runCli(["reinstate", "--batch", batch, "--database", dbPath])
    assert.equal(reinstated.status, 0, reinstated.stderr)
    const after = snapshot(dbPath, batch)
    assert.deepEqual(after.projection, imported)
    assert.equal(after.batch.revoked_at, null)
    assert.equal(after.batch.revoked_by, null)
    // Nothing re-appended: the same events simply count again.
    assert.equal(after.events, afterRevoke.events)
    // And the ledger says what happened, in order, by whom.
    assert.deepEqual(after.history, ["revoke:face-work-revoke", "reinstate:face-work-reinstate"])
  })

  it("keeps a hand correction made after the batch through revoke -> reinstate", () => {
    const { artifact, dbPath, imported, faceIds } = importedTarget()
    const batch = artifact.batchId

    // Someone fixes the first face by hand after the import: it is not Ada.
    const db = openDatabase(dbPath)
    const cyd = seedPerson(db, "Cyd Fixture")
    confirm(db, faceIds[0], cyd.identityId)
    const corrected = [...projectedByKey(db)]
    db.close()
    assert.notDeepEqual(corrected, imported)

    assert.equal(runCli(["revoke", "--batch", batch, "--database", dbPath]).status, 0)
    assert.equal(runCli(["reinstate", "--batch", batch, "--database", dbPath]).status, 0)

    // Exactly the corrected state: Cyd stands on face 0, the batch's Bram is
    // back on face 1.
    assert.deepEqual(snapshot(dbPath, batch).projection, corrected)
  })

  it("refuses to reinstate a batch that is not revoked, and writes nothing", () => {
    const { artifact, dbPath } = importedTarget()
    const before = snapshot(dbPath, artifact.batchId)

    const run = runCli(["reinstate", "--batch", artifact.batchId, "--database", dbPath])
    assert.equal(run.status, 1)
    assert.ok(run.stderr.includes("is not revoked"), run.stderr)
    assert.deepEqual(snapshot(dbPath, artifact.batchId), before)

    const missing = runCli(["reinstate", "--batch", "face-work-nope", "--database", dbPath])
    assert.equal(missing.status, 1)
    assert.ok(missing.stderr.includes("no such batch"))
  })

  it("after reinstating, re-importing the same artifact is already satisfied, not refused", () => {
    const { artifact, dbPath } = importedTarget()
    assert.equal(runCli(["revoke", "--batch", artifact.batchId, "--database", dbPath]).status, 0)
    assert.equal(runCli(["reinstate", "--batch", artifact.batchId, "--database", dbPath]).status, 0)

    const db = openDatabase(dbPath)
    const plan = planFor(db, artifact)
    assert.deepEqual(plan.refusals, [])
    assert.equal(plan.alreadyApplied, true)
    assert.equal(plan.satisfied, 2)
    assert.deepEqual(plan.actions, [])
    db.close()
  })

  it("--dry-run writes nothing", () => {
    const { artifact, dbPath } = importedTarget()
    assert.equal(runCli(["revoke", "--batch", artifact.batchId, "--database", dbPath]).status, 0)
    const before = snapshot(dbPath, artifact.batchId)

    const run = runCli(["reinstate", "--batch", artifact.batchId, "--database", dbPath, "--dry-run"])
    assert.equal(run.status, 0, run.stderr)
    assert.ok(run.stdout.includes("dry run"))
    assert.deepEqual(snapshot(dbPath, artifact.batchId), before)
    assert.ok(before.batch.revoked_at)
  })
})

describe("provenance equivalence", () => {
  it("names the fields that move a box as blocking, and the rest as advisory", () => {
    const target = buildTarget({ provenance: { detectorSha256: "0".repeat(64), routeProfile: "route-r2" } })
    useDatabase(target.db)
    /** @type {import('../../types.js').VisionIngest} */
    const row = /** @type {import('../../types.js').VisionIngest} */ (
      sql`SELECT * FROM vision_ingests WHERE id = ${target.ingest.id}`.get()
    )
    const diff = faceWorkProvenanceDiff(
      {
        datasetId: BASE_PROVENANCE.datasetId,
        modelVersion: BASE_PROVENANCE.modelVersion,
        detectorSha256: BASE_PROVENANCE.detectorSha256,
        embedderSha256: BASE_PROVENANCE.embedderSha256,
        engineSha256: BASE_PROVENANCE.engineSha256,
        mirrorApplied: 0,
        normalisation: BASE_PROVENANCE.normalisation,
        routeProfile: BASE_PROVENANCE.routeProfile,
        config: { ...BASE_PROVENANCE.config },
      },
      row,
    )
    assert.equal(diff.equivalent, false)
    assert.deepEqual(diff.blocking, ["detectorSha256"])
    assert.ok(diff.advisory.includes("routeProfile"))
    target.db.close()
  })

  it("ignores dataset_id, which differs between two honest runs", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const target = buildTarget({ provenance: { datasetId: "a-different-run-entirely" } })
    const plan = planFor(target.db, artifact)
    assert.deepEqual(plan.refusals, [])
    source.db.close()
    target.db.close()
  })

  it("refuses a non-equivalent target, and points at the reviewed exception", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const target = buildTarget({ provenance: { detectorSha256: "0".repeat(64) } })

    const plan = planFor(target.db, artifact)
    assert.ok(plan.refusals.length > 0)
    assert.ok(plan.refusals[0].includes("detectorSha256"))
    assert.ok(plan.refusals[0].includes("--match-overlap"))
    assert.throws(() =>
      applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null }),
    )
    assert.equal(eventCount(target.db), 0)
    assert.equal(peopleCount(target.db), 0)

    const excepted = planFor(target.db, artifact, { matchOverlap: true })
    assert.deepEqual(excepted.refusals, [])
    assert.equal(excepted.actions.length, 2)
    applyFaceWorkImport({ db: target.db, plan: excepted, actor: "test-import", note: null })
    assert.equal(
      projectedByKey(target.db).get(faceWorkBoxKey(PHOTOS[0].sha, PHOTOS[0].box)),
      "Ada Fixture",
    )

    source.db.close()
    target.db.close()
  })

  it("refuses moved boxes under an equivalent ingest rather than guessing", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    // Same provenance, but the boxes do not line up: something is wrong, and
    // the belt-and-braces exact match is what catches it.
    const target = buildTarget({ boxShift: 1.5 })

    const plan = planFor(target.db, artifact)
    assert.equal(plan.unmatched.box, 2)
    assert.ok(plan.refusals.some((refusal) => refusal.includes("byte-identical")))
    assert.throws(() =>
      applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null }),
    )

    const excepted = planFor(target.db, artifact, { matchOverlap: true })
    assert.deepEqual(excepted.refusals, [])
    assert.equal(excepted.actions.length, 2)

    source.db.close()
    target.db.close()
  })
})

describe("matchFaceWorkKeys", () => {
  /** @type {import('../../scripts/vision/types.js').FaceWorkFaceRow[]} */
  const targets = [
    { id: 1, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
    { id: 2, bbox_x: 60, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
  ]

  it("exact mode tells a missing photograph from a missing box", () => {
    const { matched, unmatched } = matchFaceWorkKeys(
      ["aa:10,10,20,20", "aa:99,99,20,20", "zz:10,10,20,20"],
      targets,
      { overlap: false },
    )
    assert.equal(matched.size, 1)
    assert.equal(unmatched.get("aa:99,99,20,20"), "box")
    assert.equal(unmatched.get("zz:10,10,20,20"), "photo")
  })

  it("overlap mode matches a nudged box", () => {
    const { matched } = matchFaceWorkKeys(["aa:11,11,20,20"], targets, { overlap: true })
    assert.equal(matched.get("aa:11,11,20,20")?.[0].id, 1)
  })

  it("overlap mode refuses two plausible candidates rather than picking one", () => {
    // Two different boxes that both overlap the source almost equally. (Not
    // byte-identical boxes: those are one face on two media rows — next test.)
    /** @type {import('../../scripts/vision/types.js').FaceWorkFaceRow[]} */
    const twins = [
      { id: 1, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
      { id: 2, bbox_x: 11, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
    ]
    const { matched, unmatched } = matchFaceWorkKeys(["aa:10,10,20,20"], twins, { overlap: true })
    assert.equal(matched.size, 0)
    assert.equal(unmatched.get("aa:10,10,20,20"), "ambiguous")
  })

  it("one face fanned out to two media rows (same hash, same box) matches BOTH, in either mode", () => {
    /** @type {import('../../scripts/vision/types.js').FaceWorkFaceRow[]} */
    const fannedOut = [
      { id: 1, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
      { id: 2, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
      { id: 3, bbox_x: 60, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
    ]
    for (const overlap of [false, true]) {
      const { matched, unmatched } = matchFaceWorkKeys(["aa:10,10,20,20"], fannedOut, { overlap })
      assert.equal(unmatched.size, 0, `overlap=${overlap}`)
      assert.deepEqual(
        (matched.get("aa:10,10,20,20") ?? []).map((r) => r.id).sort(),
        [1, 2],
        `overlap=${overlap}`,
      )
    }
  })
})

describe("conflicting confirmations", () => {
  /**
   * A source where the third box was judged "not a face" — the one decision
   * that can contradict a target's confirmation head-on, because it names
   * nobody and so cannot be reconciled by the content match.
   */
  function sourceWithNotAFace() {
    const source = buildSource()
    useDatabase(source.db)
    recordAssignment({ faceId: source.faceIds[2], op: "not_a_face", actor: "fixture" })
    return source
  }

  it("reports and refuses an existing confirmation rather than overwriting it", () => {
    const source = sourceWithNotAFace()
    const { artifact } = exportFrom(source.db)

    const target = buildTarget()
    const incumbent = seedPerson(target.db, "Someone Already Named")
    confirm(target.db, target.faceIds[2], incumbent.identityId)
    const before = projectedByKey(target.db)
    const eventsBefore = eventCount(target.db)

    const plan = planFor(target.db, artifact)
    assert.ok(plan.conflicts.some((conflict) => conflict.kind === "confirmation"))
    assert.ok(plan.refusals.some((refusal) => refusal.includes("conflict")))
    // A predicate rather than a regex literal — CLAUDE.md's no-regex rule says
    // "anywhere", and `includes` says the same thing.
    assert.throws(
      () => applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null }),
      (err) => err instanceof Error && err.message.includes("conflict"),
    )

    // Nothing moved — not the contested face, and not the two uncontested ones
    // that shared the refused import.
    assert.deepEqual([...projectedByKey(target.db)], [...before])
    assert.equal(eventCount(target.db), eventsBefore)
    assert.equal(peopleCount(target.db), 1)

    source.db.close()
    target.db.close()
  })

  it("--force APPENDS rather than overwrites, leaving the old event in the ledger", () => {
    const source = sourceWithNotAFace()
    const { artifact } = exportFrom(source.db)

    const target = buildTarget()
    const incumbent = seedPerson(target.db, "Someone Already Named")
    confirm(target.db, target.faceIds[2], incumbent.identityId)
    const eventsBefore = eventCount(target.db)

    const plan = planFor(target.db, artifact, { force: true })
    assert.deepEqual(plan.refusals, [])
    applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })

    assert.equal(
      projectedByKey(target.db).get(faceWorkBoxKey(PHOTOS[2].sha, PHOTOS[2].box)),
      "NOT_A_FACE",
    )
    // Appended, not replaced: three new events, and the incumbent's is intact.
    assert.equal(eventCount(target.db), eventsBefore + 3)
    useDatabase(target.db)
    /** @type {{ n: number } | undefined} */
    const stillThere = sql`SELECT COUNT(*) AS n FROM face_assignments
      WHERE face_id = ${target.faceIds[2]} AND identity_id = ${incumbent.identityId}
        AND op = 'assign'`.get()
    assert.equal(stillThere?.n, 1)

    source.db.close()
    target.db.close()
  })

  it("reads a lone renamed face as the same person, not as a contradiction", () => {
    // Matching by CONTENT means a single-face person whose one face the target
    // has already named IS that person, whatever either machine calls them.
    // Refusing here would refuse every ordinary migration; the contradictions
    // worth refusing are the ones where the two databases disagree about which
    // faces belong together, and those are person-split / person-collapse below.
    const source = buildSource()
    const { artifact } = exportFrom(source.db)

    const target = buildTarget()
    const renamed = seedPerson(target.db, "Ada By Another Name")
    confirm(target.db, target.faceIds[0], renamed.identityId)

    const plan = planFor(target.db, artifact)
    assert.deepEqual(plan.refusals, [])
    assert.deepEqual(plan.conflicts, [])
    assert.equal(plan.satisfied, 1)
    assert.equal(plan.actions.length, 1)

    source.db.close()
    target.db.close()
  })

  it("skips a confirmation the target already agrees with, appending nothing", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const target = buildTarget()

    applyFaceWorkImport({
      db: target.db,
      plan: planFor(target.db, artifact),
      actor: "test-import",
      note: null,
    })
    // A second, differently-batched artifact over the same state: the batch id
    // short-circuit is bypassed by re-exporting with one extra confirmation, so
    // the two already-satisfied ones must be recognised on their own merits.
    useDatabase(source.db)
    const cleo = seedPerson(source.db, "Cleo Fixture")
    confirm(source.db, source.faceIds[2], cleo.identityId)
    const second = exportFrom(source.db)
    assert.notEqual(second.artifact.batchId, artifact.batchId)

    const plan = planFor(target.db, second.artifact)
    assert.deepEqual(plan.refusals, [])
    assert.equal(plan.satisfied, 2)
    assert.equal(plan.actions.length, 1)

    source.db.close()
    target.db.close()
  })

  it("refuses when one incoming person's faces are already split across two", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)

    // The target already believes photo A and photo B are two different people;
    // the artifact says photo A is Ada and photo B is Bram, so the split is
    // only visible once Ada also claims B. Give Ada a second face to make it so.
    useDatabase(source.db)
    const extraMedia = seedMedia(source.db, "d".repeat(64))
    const extraFace = seedFace(source.db, {
      mediaId: extraMedia,
      ingestId: source.ingest.id,
      box: { x: 7.5, y: 7.5, w: 25, h: 25 },
    })
    confirm(source.db, extraFace, source.ada.identityId)
    const regrouped = exportFrom(source.db)

    const target = buildTarget()
    useDatabase(target.db)
    const extraTargetMedia = seedMedia(target.db, "d".repeat(64))
    const extraTargetFace = seedFace(target.db, {
      mediaId: extraTargetMedia,
      ingestId: target.ingest.id,
      box: { x: 7.5, y: 7.5, w: 25, h: 25 },
    })
    const one = seedPerson(target.db, "Target Person One")
    const two = seedPerson(target.db, "Target Person Two")
    confirm(target.db, target.faceIds[0], one.identityId)
    confirm(target.db, extraTargetFace, two.identityId)

    const plan = planFor(target.db, regrouped.artifact)
    assert.ok(plan.conflicts.some((conflict) => conflict.kind === "person-split"))
    assert.ok(plan.refusals.length > 0)

    source.db.close()
    target.db.close()
  })

  it("refuses when two incoming people collapse onto one existing person", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)

    const target = buildTarget()
    const single = seedPerson(target.db, "One Target Person")
    confirm(target.db, target.faceIds[0], single.identityId)
    confirm(target.db, target.faceIds[1], single.identityId)

    const plan = planFor(target.db, artifact)
    assert.ok(plan.conflicts.some((conflict) => conflict.kind === "person-collapse"))
    assert.ok(plan.refusals.length > 0)

    source.db.close()
    target.db.close()
  })

  it("matches a person by content and not by name", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)

    const target = buildTarget()
    // Same faces, a different name: content wins, so no new person is created.
    const renamed = seedPerson(target.db, "Ada Under Another Name")
    confirm(target.db, target.faceIds[0], renamed.identityId)
    const peopleBefore = peopleCount(target.db)

    const plan = planFor(target.db, artifact)
    assert.equal(plan.peopleMatched, 1)
    assert.equal(plan.peopleToCreate.length, 1)
    applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })
    // Exactly one new person: Bram. Ada matched the renamed incumbent by faces.
    assert.equal(peopleCount(target.db), peopleBefore + 1)

    source.db.close()
    target.db.close()
  })

  it("creates a second person of the same name when they share no faces, and says so", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)

    const target = buildTarget()
    // Same NAME, no shared faces. Matching by key here is exactly the mistake
    // this refuses to make.
    seedPerson(target.db, "Ada Fixture")
    const peopleBefore = peopleCount(target.db)

    const plan = planFor(target.db, artifact)
    assert.deepEqual(plan.refusals, [])
    assert.ok(plan.advisories.some((advisory) => advisory.includes("Ada Fixture")))
    applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })
    assert.equal(peopleCount(target.db), peopleBefore + 2)

    source.db.close()
    target.db.close()
  })
})

describe("provisioning preflight", () => {
  it("refuses a missing weight file", async () => {
    const emptyDir = path.join(workDir, "weights-empty")
    fs.mkdirSync(emptyDir, { recursive: true })
    const enginePath = path.join(workDir, "engine-a.mjs")
    fs.writeFileSync(enginePath, "export const detect = () => {}\n", "utf8")
    const engineSha = await hashOf(enginePath)

    const result = await faceWorkPreflight({
      weightsDir: emptyDir,
      enginePath,
      expectedEngineSha256: engineSha,
    })
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((failure) => failure.includes("missing")))
  })

  it("refuses a weight file with the right name and the wrong bytes", async () => {
    const dir = path.join(workDir, "weights-wrong")
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "face_detection_yunet_2026may.onnx"), "not a model", "utf8")
    const enginePath = path.join(workDir, "engine-b.mjs")
    fs.writeFileSync(enginePath, "export const detect = () => {}\n", "utf8")

    const result = await faceWorkPreflight({
      weightsDir: dir,
      enginePath,
      expectedEngineSha256: await hashOf(enginePath),
    })
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((failure) => failure.includes("mismatch")))
  })

  it("refuses an absent engine, and an engine that is not the one the work came from", async () => {
    const dir = path.join(workDir, "weights-empty")
    fs.mkdirSync(dir, { recursive: true })

    const absent = await faceWorkPreflight({
      weightsDir: dir,
      enginePath: path.join(workDir, "no-such-engine.mjs"),
      expectedEngineSha256: "0".repeat(64),
    })
    assert.ok(absent.failures.some((failure) => failure.includes("absent or unreadable")))

    const enginePath = path.join(workDir, "engine-c.mjs")
    fs.writeFileSync(enginePath, "export const detect = () => {}\n", "utf8")
    const wrong = await faceWorkPreflight({
      weightsDir: dir,
      enginePath,
      expectedEngineSha256: "1".repeat(64),
    })
    assert.ok(wrong.failures.some((failure) => failure.includes("different engine")))
  })

  it("digest-only mode: passes on pinned digests with no files at all", async () => {
    const engine = "c".repeat(64)
    const result = await faceWorkPreflight({
      weightsDir: null,
      enginePath: null,
      expectedEngineSha256: engine,
      declaredEngineSha256: engine,
      declaredWeightDigests: [PINNED_WEIGHTS[0].sha256, PINNED_WEIGHTS[1].sha256],
    })
    assert.deepEqual(result.failures, [])
    assert.equal(result.ok, true)
    assert.equal(result.engineSha256, engine)
  })

  it("digest-only mode: refuses a different engine, an unpinned weight, or a malformed digest", async () => {
    const pinned = [PINNED_WEIGHTS[0].sha256, PINNED_WEIGHTS[1].sha256]
    const wrongEngine = await faceWorkPreflight({
      weightsDir: null,
      enginePath: null,
      expectedEngineSha256: "c".repeat(64),
      declaredEngineSha256: "d".repeat(64),
      declaredWeightDigests: pinned,
    })
    assert.ok(wrongEngine.failures.some((f) => f.includes("different engine")))

    const unpinned = await faceWorkPreflight({
      weightsDir: null,
      enginePath: null,
      expectedEngineSha256: "c".repeat(64),
      declaredEngineSha256: "c".repeat(64),
      declaredWeightDigests: [pinned[0], "e".repeat(64)],
    })
    assert.equal(unpinned.ok, false)
    assert.ok(unpinned.failures.some((f) => f.includes("not a pinned digest")))

    for (const bad of ["C".repeat(64), "c".repeat(63), "g".repeat(64)]) {
      const malformed = await faceWorkPreflight({
        weightsDir: null,
        enginePath: null,
        expectedEngineSha256: bad,
        declaredEngineSha256: bad,
        declaredWeightDigests: pinned,
      })
      assert.ok(malformed.failures.some((f) => f.includes("64 lowercase hex")), bad)
    }
  })

  it("refuses when there is nothing to compare the engine against", async () => {
    const dir = path.join(workDir, "weights-empty")
    fs.mkdirSync(dir, { recursive: true })
    const enginePath = path.join(workDir, "engine-d.mjs")
    fs.writeFileSync(enginePath, "export const detect = () => {}\n", "utf8")
    const result = await faceWorkPreflight({
      weightsDir: dir,
      enginePath,
      expectedEngineSha256: null,
    })
    assert.ok(result.failures.some((failure) => failure.includes("nothing to compare")))
  })
})

describe("--dry-run", () => {
  it("writes no artifact on export", () => {
    const source = buildSource()
    const dbPath = path.join(workDir, `db-${dbCounter}.sqlite`)
    source.db.close()

    const out = path.join(workDir, "dry-run-artifact.json")
    const run = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, "scripts", "vision", "export-face-work.js"),
        "export",
        out,
        "--database",
        dbPath,
        "--dry-run",
      ],
      { encoding: "utf8" },
    )
    assert.equal(run.status, 0, run.stderr)
    assert.ok(run.stdout.includes("dry run"))
    assert.equal(fs.existsSync(out), false)
  })

  it("writes nothing on import: planning alone touches no table", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const target = buildTarget()

    const before = {
      events: eventCount(target.db),
      people: peopleCount(target.db),
      projection: [...projectedByKey(target.db)],
    }
    // The `--dry-run` path is exactly "plan, print, return before applying".
    const plan = planFor(target.db, artifact)
    assert.ok(plan.actions.length > 0)

    assert.equal(eventCount(target.db), before.events)
    assert.equal(peopleCount(target.db), before.people)
    assert.deepEqual([...projectedByKey(target.db)], before.projection)
    useDatabase(target.db)
    /** @type {{ n: number } | undefined} */
    const batches = sql`SELECT COUNT(*) AS n FROM face_assignment_batches`.get()
    assert.equal(batches?.n, 0)

    source.db.close()
    target.db.close()
  })
})

// ---------------------------------------------------------------------------
// Defect 1: a guess must never arrive as ground truth
// ---------------------------------------------------------------------------

describe("propagated identities", () => {
  /** A source whose third face carries a PROPAGATED identity — the model's
   *  guess, not a human's judgement. */
  function sourceWithPropagated() {
    const source = buildSource()
    const cleo = seedPerson(source.db, "Cleo Fixture", "propagated")
    confirm(source.db, source.faceIds[2], cleo.identityId)
    return { source, cleo }
  }

  it("are skipped by default, and carry their own provenance when asked for", () => {
    const { source } = sourceWithPropagated()

    const plain = exportFrom(source.db)
    assert.equal(plain.stats.skippedPropagated, 1)
    assert.equal(plain.artifact.payload.confirmations.length, 2)
    assert.equal(plain.artifact.payload.includesPropagated, false)

    const carried = exportFrom(source.db, true)
    assert.equal(carried.artifact.payload.includesPropagated, true)
    const guess = carried.artifact.payload.confirmations.find(
      (c) => c.key === faceWorkBoxKey(PHOTOS[2].sha, PHOTOS[2].box),
    )
    assert.ok(guess)
    assert.equal(guess.provenance, "propagated")

    source.db.close()
  })

  it("DO NOT arrive confirmed — the import writes each identity's real provenance", () => {
    const { source } = sourceWithPropagated()
    const { artifact } = exportFrom(source.db, true)

    const target = buildTarget()
    const plan = planFor(target.db, artifact)
    assert.deepEqual(plan.refusals, [])
    const result = applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })
    assert.equal(result.applied, true)

    // The whole point of `face_identities.provenance`: `confirmedIdentityFaces`,
    // `confirmedIdentitiesPerMedia` and `confirmedCooccurrence` all select
    // 'confirmed', so a guess laundered into that column is the model being fed
    // its own output as ground truth.
    assert.deepEqual(identityProvenances(target.db), [
      "Ada Fixture/confirmed",
      "Bram Fixture/confirmed",
      "Cleo Fixture/propagated",
    ])
    assert.equal(confirmedFaceCount(target.db), 2, "the guessed face is not ground truth")

    // And it is still the right person — a propagated arrival is carried, not lost.
    assert.equal(
      projectedByKey(target.db).get(faceWorkBoxKey(PHOTOS[2].sha, PHOTOS[2].box)),
      "Cleo Fixture",
    )

    source.db.close()
    target.db.close()
  })

  it("says how many unreviewed guesses an import is about to carry", () => {
    const { source } = sourceWithPropagated()
    const { artifact } = exportFrom(source.db, true)
    const target = buildTarget()
    const plan = planFor(target.db, artifact)
    assert.ok(plan.advisories.some((advisory) => advisory.includes("propagated")))
    source.db.close()
    target.db.close()
  })

  it("gives one person both identities when the artifact carries both verdicts", () => {
    // Ada is confirmed on photo A and merely guessed on photo C. The two must
    // land on two identities of the SAME person, not collapse into one.
    const source = buildSource()
    useDatabase(source.db)
    const guess = createIdentity({ personId: source.ada.personId, provenance: "propagated" })
    confirm(source.db, source.faceIds[2], guess.id)

    const { artifact } = exportFrom(source.db, true)
    assert.equal(artifact.payload.people.length, 2, "one Ada, not two")

    const target = buildTarget()
    const plan = planFor(target.db, artifact)
    applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })

    assert.deepEqual(identityProvenances(target.db), [
      "Ada Fixture/confirmed",
      "Ada Fixture/propagated",
      "Bram Fixture/confirmed",
    ])
    assert.equal(confirmedFaceCount(target.db), 2)

    source.db.close()
    target.db.close()
  })
})

// ---------------------------------------------------------------------------
// Defect 2 + 3: what an artifact must not be able to say
// ---------------------------------------------------------------------------

describe("artifact validation", () => {
  /** @param {(payload: any) => void} mutate */
  function parseResealed(mutate) {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const text = reseal(artifact, mutate)
    source.db.close()
    return parseFaceWorkArtifact(text)
  }

  it("REFUSES an op this build does not know, rather than coercing it to assign", () => {
    // `negative` means "this face is NOT that person" — importing it as `assign`
    // is the exact inversion of the decision. `clear` means "nobody".
    for (const op of ["negative", "clear", "merge", ""]) {
      const parsed = parseResealed((payload) => {
        payload.confirmations[0].op = op
      })
      assert.equal(parsed.valid, false, `op "${op}" must be refused`)
      if (!parsed.valid) assert.ok(parsed.error.includes("op"))
    }
  })

  it("REFUSES an unknown identity provenance", () => {
    const parsed = parseResealed((payload) => {
      payload.confirmations[0].provenance = "verified-by-vibes"
    })
    assert.equal(parsed.valid, false)
  })

  it("REFUSES an assign with no person, and a not_a_face with one", () => {
    const noPerson = parseResealed((payload) => {
      payload.confirmations[0].personRef = null
    })
    assert.equal(noPerson.valid, false)

    const namedNonFace = parseResealed((payload) => {
      payload.confirmations[0].op = "not_a_face"
    })
    assert.equal(namedNonFace.valid, false)
  })

  it("REFUSES a personRef naming nobody in the people list", () => {
    const parsed = parseResealed((payload) => {
      payload.confirmations[0].personRef = "p99"
    })
    assert.equal(parsed.valid, false)
  })

  it("REFUSES a duplicate person ref rather than creating two people from it", () => {
    const parsed = parseResealed((payload) => {
      payload.people[1].ref = payload.people[0].ref
    })
    assert.equal(parsed.valid, false)
    if (!parsed.valid) assert.ok(parsed.error.includes("ref"))
  })

  it("refuses five hand-edited shapes CLEANLY — a message, never a stack trace", () => {
    /** @type {Array<[string, (payload: any) => void]>} */
    const cases = [
      ["a key that is not a string", (payload) => (payload.confirmations[0].key = 12345)],
      ["a null confirmation", (payload) => (payload.confirmations = [null])],
      ["a null person", (payload) => (payload.people = [null])],
      ["an ingest with no config", (payload) => delete payload.ingest.config],
      ["a display name that is not a string", (payload) => (payload.people[0].displayName = 99999)],
      ["a key that is not a box key", (payload) => (payload.confirmations[0].key = "no-colon-here")],
    ]
    for (const [label, mutate] of cases) {
      /** @type {ReturnType<typeof parseFaceWorkArtifact>} */
      let parsed
      try {
        parsed = parseResealed(mutate)
      } catch (err) {
        assert.fail(`${label}: threw instead of refusing — ${err instanceof Error ? err.message : String(err)}`)
      }
      assert.equal(parsed.valid, false, label)
      if (!parsed.valid) assert.ok(parsed.error.length > 0, label)
    }
  })
})

describe("matchFaceWorkKeys — malformed keys", () => {
  it("calls a key with no photograph hash malformed, not a missing photograph", () => {
    /** @type {import('../../scripts/vision/types.js').FaceWorkFaceRow[]} */
    const targets = [
      { id: 1, bbox_x: 10, bbox_y: 10, bbox_w: 20, bbox_h: 20, face_identity_id: null, deleted_at: null, sha256: "aa" },
    ]
    const { unmatched } = matchFaceWorkKeys(["no-colon-at-all", "aa:1,2,three,4"], targets, {
      overlap: false,
    })
    assert.equal(unmatched.get("no-colon-at-all"), "malformed")
    assert.equal(unmatched.get("aa:1,2,three,4"), "malformed")
  })
})

// ---------------------------------------------------------------------------
// Defect 3: a partial import must not seal the batch
// ---------------------------------------------------------------------------

describe("importing against a target that has only some of the photographs", () => {
  it("creates a person only for a confirmation it actually applied", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    // The target has photograph A only. Bram lives entirely on photograph B.
    const target = buildTarget({ photos: [PHOTOS[0]] })

    const plan = planFor(target.db, artifact)
    assert.deepEqual(plan.refusals, [])
    assert.equal(plan.unmatched.photo, 1)
    assert.equal(plan.peopleToCreate.length, 1, "only the person whose face is here")
    assert.equal(plan.actions.length, 1)

    const result = applyFaceWorkImport({ db: target.db, plan, actor: "test-import", note: null })
    assert.equal(result.peopleCreated, 1)
    assert.equal(result.identitiesCreated, 1)
    assert.equal(peopleCount(target.db), 1, "no person row for an absent photograph's person")
    assert.deepEqual(identityProvenances(target.db), ["Ada Fixture/confirmed"])

    source.db.close()
    target.db.close()
  })

  it("finishes the job on a re-import once the missing photographs arrive", () => {
    const source = buildSource()
    const { artifact } = exportFrom(source.db)
    const target = buildTarget({ photos: [PHOTOS[0]] })

    applyFaceWorkImport({
      db: target.db,
      plan: planFor(target.db, artifact),
      actor: "test-import",
      note: null,
    })

    // The rest of the library is ingested later, as it always is.
    useDatabase(target.db)
    const lateMedia = seedMedia(target.db, PHOTOS[1].sha)
    seedFace(target.db, { mediaId: lateMedia, ingestId: target.ingest.id, box: PHOTOS[1].box })

    const second = planFor(target.db, artifact)
    assert.equal(second.alreadyApplied, false, "the batch id must not seal an unfinished import")
    assert.equal(second.actions.length, 1)
    assert.deepEqual(second.refusals, [])
    assert.ok(second.advisories.some((advisory) => advisory.includes(artifact.batchId)))

    const result = applyFaceWorkImport({ db: target.db, plan: second, actor: "test-import", note: null })
    assert.equal(result.applied, true)
    assert.equal(result.events, 1)
    assert.equal(
      projectedByKey(target.db).get(faceWorkBoxKey(PHOTOS[1].sha, PHOTOS[1].box)),
      "Bram Fixture",
    )

    // Still ONE batch, so the whole import stays revocable as one decision.
    useDatabase(target.db)
    /** @type {{ n: number } | undefined} */
    const batches = sql`SELECT COUNT(*) AS n FROM face_assignment_batches`.get()
    assert.equal(batches?.n, 1)

    // And now it really is done.
    const third = planFor(target.db, artifact)
    assert.equal(third.alreadyApplied, true)

    source.db.close()
    target.db.close()
  })
})

// ---------------------------------------------------------------------------
// Defect 5: where an export may be written
// ---------------------------------------------------------------------------

describe("export destination", () => {
  it("refuses the root of this public repository, and says why", () => {
    const refusal = exportDestinationRefusal(path.join(REPO_ROOT, "face-work.json"))
    assert.ok(refusal, "writing real names into the repository root must be refused")
    assert.ok(refusal.includes("public"))
  })

  it("refuses a tracked subdirectory too", () => {
    assert.ok(exportDestinationRefusal(path.join(REPO_ROOT, "docs", "face-work.json")))
    assert.ok(exportDestinationRefusal(path.join(REPO_ROOT, "scripts", "vision", "out.json")))
  })

  it("allows a gitignored directory inside the repository", () => {
    assert.equal(exportDestinationRefusal(path.join(REPO_ROOT, "tmp", "face-work.json")), null)
    assert.equal(exportDestinationRefusal(path.join(REPO_ROOT, "data", "face-work.json")), null)
  })

  it("allows anywhere outside the repository", () => {
    assert.equal(exportDestinationRefusal(path.join(workDir, "face-work.json")), null)
  })

  it("is enforced by the CLI, not merely warned about", () => {
    const source = buildSource()
    const dbPath = path.join(workDir, `db-${dbCounter}.sqlite`)
    source.db.close()

    const out = path.join(REPO_ROOT, "face-work-should-never-exist.json")
    fs.rmSync(out, { force: true })
    const run = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, "scripts", "vision", "export-face-work.js"),
        "export",
        out,
        "--database",
        dbPath,
      ],
      { encoding: "utf8" },
    )
    assert.notEqual(run.status, 0)
    assert.equal(fs.existsSync(out), false)
  })
})

describe("batch metadata", () => {
  it("bounds --actor and --note rather than passing free text to the row", () => {
    const longNote = parseFaceWorkArgs(["import", "in.json", "--weights", "w", "--engine", "e", "--note", "x".repeat(1000)])
    assert.equal(longNote.valid, false)

    const newlineNote = parseFaceWorkArgs(["import", "in.json", "--weights", "w", "--engine", "e", "--note", "line\nbreak"])
    assert.equal(newlineNote.valid, false)

    const pathActor = parseFaceWorkArgs(["import", "in.json", "--weights", "w", "--engine", "e", "--actor", "/etc/passwd"])
    assert.equal(pathActor.valid, false)

    const ok = parseFaceWorkArgs(["import", "in.json", "--weights", "w", "--engine", "e", "--actor", "jesse", "--note", "Phase 9 hand-off."])
    assert.equal(ok.valid, true)
  })
})

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
async function hashOf(file) {
  const { createHash } = await import("node:crypto")
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}
