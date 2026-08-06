/** @file Unit tests for scripts/vision/convert-labels-to-face-work.js — the
 *  converter that turns a labelling session into a portable face-work artifact.
 *
 *  Everything here is SYNTHETIC. Every "photograph" is a hand-invented sha256
 *  string, every box is a hand-written rectangle, every person is a made-up
 *  name and every dimension is chosen to make an arithmetic point. Nothing under
 *  tests/ reads a real run directory, a real photograph or a real labels.json
 *  (CLAUDE.md, SPEC-vision-lab.md §15) — and nothing here records a measurement
 *  of one.
 *
 *  The centrepiece is the decode→original scaling. `faces.jsonl` boxes are in
 *  the space the batch decoded at; `media_faces` holds original pixels; the
 *  artifact's confirmation key is `(photo content hash, box)`. Build the keys
 *  from the run's raw numbers and NONE of them match, and the import — which
 *  cannot tell a mis-keyed artifact from one whose photographs the target lacks
 *  — reports the whole thing as absent photographs and does nothing. So the
 *  first test below is arithmetic, deliberately.
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { computeDatasetId } from "../../scripts/vision/dataset-id.js"
import {
  buildFaceWorkFromLabels,
  checkLabelValues,
  normaliseIdentityNames,
  parseConvertLabelsArgs,
} from "../../scripts/vision/convert-labels-to-face-work.js"
import { faceWorkBoxKey, parseFaceWorkArtifact } from "../../scripts/vision/export-face-work.js"

// --- synthetic fixtures -----------------------------------------------------

/** The decode space the batch worked in, and the original the media rows hold.
 *  A 2.5× ratio, so a key built from unscaled numbers cannot accidentally
 *  coincide with one built from scaled numbers. */
const DECODE = { width: 1200, height: 1600 }
const ORIGINAL = { width: 3000, height: 4000 }
const SCALE = ORIGINAL.width / DECODE.width

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

/**
 * @param {number} id
 * @param {string} sha256
 * @returns {import('../../scripts/vision/types.js').Session1PhotoRecord}
 */
function photo(id, sha256) {
  return {
    id,
    relative: `synthetic-${id}.jpg`,
    sha256,
    aHash: "0".repeat(64),
    width: DECODE.width,
    height: DECODE.height,
    capturedAtMs: null,
    mtimeMs: 0,
    faces: 1,
    exactDuplicateOf: null,
    nearDuplicateOf: null,
    ms: { decode: 0, downsample: 0, detect: 0, align: 0, describe: 0 },
  }
}

/**
 * @param {number} id
 * @param {number} photoId
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @returns {import('../../scripts/vision/types.js').Session1FaceRecord}
 */
function face(id, photoId, box) {
  return {
    id,
    photoId,
    crop: `crops/${id}.png`,
    score: 0.99,
    box,
    landmarks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    signals: {
      score: 0.99,
      boxPx: box.w,
      borderPx: 10,
      eyeRatio: 0.3,
      eyeAngle: 1,
      alignScale: 1,
      residual: 0.1,
      outsideFraction: 0,
      sharpness: 50,
    },
    descriptor: [],
  }
}

/**
 * A `vision_ingests` row as the converter reads it. Never assembled from
 * timing.json: the point of reading the target's own row is that the import's
 * equivalence check then holds by construction.
 * @param {string} datasetId
 * @returns {import('../../types.js').VisionIngest}
 */
function ingestRow(datasetId) {
  return {
    id: 7,
    dataset_id: datasetId,
    model_version: "synthetic-model",
    detector_sha256: "c".repeat(64),
    embedder_sha256: "d".repeat(64),
    engine_sha256: "e".repeat(64),
    mirror_applied: 0,
    normalisation: "in-graph",
    route_profile: "route-r1",
    config_json: JSON.stringify({ schemaVersion: 1 }),
    created_at: "2026-01-01T00:00:00.000Z",
  }
}

/** The two photographs, four faces, two people fixture every test starts from.
 *  Faces 0 and 1 are one person; face 2 is another; face 3 is the sentinel. */
function fixture() {
  const photos = [photo(0, SHA_A), photo(1, SHA_B)]
  const faces = [
    face(0, 0, { x: 100, y: 200, w: 40, h: 60 }),
    face(1, 1, { x: 300, y: 100, w: 50, h: 70 }),
    face(2, 0, { x: 500, y: 400, w: 30, h: 45 }),
    face(3, 1, { x: 10, y: 20, w: 20, h: 25 }),
  ]
  const datasetId = computeDatasetId(faces)
  /** @type {Map<string, { width: number | null, height: number | null }>} */
  const mediaBySha = new Map([
    [SHA_A, { width: ORIGINAL.width, height: ORIGINAL.height }],
    [SHA_B, { width: ORIGINAL.width, height: ORIGINAL.height }],
  ])
  return { photos, faces, datasetId, mediaBySha }
}

/** The key a face WILL have on the target: decode-space box multiplied up.
 *  Written out longhand here rather than via `scaleFaceGeometry`, so the test
 *  fails if the production scaling ever silently changes.
 *  @param {string} sha256
 *  @param {{ x: number, y: number, w: number, h: number }} box */
function scaledKey(sha256, box) {
  return faceWorkBoxKey(sha256, {
    x: box.x * SCALE,
    y: box.y * SCALE,
    w: box.w * SCALE,
    h: box.h * SCALE,
  })
}

/**
 * @param {ReturnType<typeof fixture>} base
 * @param {ReadonlyArray<number>} faceIds
 * @returns {Map<string, number>}
 */
function targetKeysFor(base, faceIds) {
  /** @type {Map<string, number>} */
  const keys = new Map()
  for (const id of faceIds) {
    const f = base.faces[id]
    const p = base.photos[f.photoId]
    keys.set(scaledKey(p.sha256, f.box), 1)
  }
  return keys
}

/**
 * @param {Partial<{ datasetId: string, labels: Record<string, string>, skipped: number[] }>} over
 * @param {ReturnType<typeof fixture>} base
 * @returns {import('../../scripts/vision/types.js').Session1LabelFile}
 */
function labelFile(base, over = {}) {
  return {
    version: 2,
    datasetId: over.datasetId ?? base.datasetId,
    labels: over.labels ?? { 0: "k1", 1: "k1", 2: "k2", 3: "x" },
    pool: { 0: "A", 1: "A", 2: "A", 3: "A" },
    skipped: over.skipped ?? [],
  }
}

/** Two made-up names under opaque keys, exactly as identities.json carries them. */
const IDENTITY_NAMES = new Map([
  ["k1", "Test Personone"],
  ["k2", "Test Persontwo"],
])

/**
 * @param {ReturnType<typeof fixture>} base
 * @param {Partial<Parameters<typeof buildFaceWorkFromLabels>[0]>} over
 */
function build(base, over = {}) {
  return buildFaceWorkFromLabels({
    photos: base.photos,
    faces: base.faces,
    labels: labelFile(base),
    identityNames: IDENTITY_NAMES,
    ingestRow: ingestRow(base.datasetId),
    mediaBySha: base.mediaBySha,
    targetKeyCounts: targetKeysFor(base, [0, 1, 2, 3]),
    ...over,
  })
}

// --- the tests --------------------------------------------------------------

describe("convert-labels-to-face-work: decode → original scaling", () => {
  it("keys every confirmation in the media row's original pixels", () => {
    const base = fixture()
    const result = build(base)
    assert.deepEqual(result.refusals, [])
    const artifact = result.artifact
    assert.ok(artifact)

    const keys = new Set(artifact.payload.confirmations.map((c) => c.key))
    assert.equal(keys.size, 4)
    for (const f of base.faces) {
      const p = base.photos[f.photoId]
      assert.ok(keys.has(scaledKey(p.sha256, f.box)), "scaled key present")
      // And the decode-space key — the one a naive converter would emit — is
      // NOT there. This is the failure that would otherwise be silent.
      assert.ok(!keys.has(faceWorkBoxKey(p.sha256, f.box)), "decode-space key absent")
    }
  })

  it("keeps decode-space coordinates when the media row has no dimensions", () => {
    const base = fixture()
    // The ingest took the same fallback, so the two still agree — which is the
    // only reason this is an advisory rather than a refusal.
    const mediaBySha = new Map([
      [SHA_A, { width: null, height: null }],
      [SHA_B, { width: null, height: null }],
    ])
    /** @type {Map<string, number>} */
    const targetKeyCounts = new Map()
    for (const f of base.faces) {
      targetKeyCounts.set(faceWorkBoxKey(base.photos[f.photoId].sha256, f.box), 1)
    }
    const result = build(base, { mediaBySha, targetKeyCounts })
    assert.deepEqual(result.refusals, [])
    assert.equal(result.stats.unscaled, 4)
    assert.equal(result.advisories.length, 1)
  })

  it("refuses a face whose media dimensions contradict the run's aspect ratio", () => {
    const base = fixture()
    const mediaBySha = new Map([
      [SHA_A, { width: ORIGINAL.width, height: ORIGINAL.height }],
      // Portrait in the run, landscape here: the content-hash join is suspect,
      // and writing either space's numbers would be wrong.
      [SHA_B, { width: ORIGINAL.height, height: ORIGINAL.width }],
    ])
    const result = build(base, { mediaBySha })
    assert.equal(result.artifact, null)
    assert.equal(result.stats.unjoinable.aspectMismatch, 2)
    assert.ok(result.refusals.some((r) => r.includes("2 of 4 labelled face(s)")))
  })
})

describe("convert-labels-to-face-work: the not-a-face sentinel", () => {
  it("converts the sentinel's faces to not_a_face", () => {
    const base = fixture()
    const result = build(base)
    const artifact = result.artifact
    assert.ok(artifact)

    const sentinelKey = scaledKey(SHA_B, base.faces[3].box)
    const confirmation = artifact.payload.confirmations.find((c) => c.key === sentinelKey)
    assert.ok(confirmation)
    assert.equal(confirmation.op, "not_a_face")
    assert.equal(confirmation.personRef, null)
    assert.equal(confirmation.provenance, null)
    assert.equal(result.stats.notAFace, 1)
    assert.equal(result.stats.assign, 3)
  })

  it("refuses an unnamed label value instead of assuming it is the sentinel", () => {
    // THE regression this pins. Inferring the sentinel by absence cannot tell
    // "the not-a-face mark" from "a person nobody got round to naming", and
    // guessing the second is a real person's faces silently retired. The
    // sentinel is a constant, so an unnamed key can only be the second.
    const base = fixture()
    const labels = labelFile(base, { labels: { 0: "k1", 1: "k1", 2: "k2", 3: "k3" } })
    const result = build(base, { labels })
    assert.equal(result.artifact, null)
    assert.ok(result.refusals.some((r) => r.includes("1 label value(s)")))
    assert.ok(result.refusals.some((r) => r.includes("person nobody named")))
  })

  it("refuses every unnamed value, sentinel present or not", () => {
    const withSentinel = checkLabelValues(["k1", "x", "k2", "q"], new Set(["k1", "k2"]))
    assert.equal(withSentinel.valid, false)
    if (withSentinel.valid) return
    assert.ok(withSentinel.error.includes("1 label value(s)"))

    const withoutSentinel = checkLabelValues(["k1", "q", "r"], new Set(["k1"]))
    assert.equal(withoutSentinel.valid, false)
    if (withoutSentinel.valid) return
    assert.ok(withoutSentinel.error.includes("2 label value(s)"))
  })

  it("reports the sentinel when it was used and null when it was not", () => {
    assert.deepEqual(checkLabelValues(["k1", "k1", "k2"], new Set(["k1", "k2"])), {
      valid: true,
      value: null,
    })
    assert.deepEqual(checkLabelValues(["k1", "x", "k2"], new Set(["k1", "k2"])), {
      valid: true,
      value: "x",
    })
  })

  it("does not require a person key to look like anything in particular", () => {
    // The converter's only structural claim is about the sentinel. What the
    // labelling tool calls a person is its own business, and label.html already
    // refuses a malformed key at both ends — so opaque keys keep working.
    const base = fixture()
    const labels = labelFile(base, { labels: { 0: "zzz", 1: "zzz", 2: "k2", 3: "x" } })
    const names = new Map([
      ["zzz", "Test Personone"],
      ["k2", "Test Persontwo"],
    ])
    const result = build(base, { labels, identityNames: names })
    assert.ok(result.artifact)
    assert.equal(result.stats.people, 2)
  })
})

describe("convert-labels-to-face-work: identity checks", () => {
  it("refuses a datasetId that does not match the run's faces", () => {
    const base = fixture()
    const labels = labelFile(base, { datasetId: "0123456789abcdef" })
    const result = build(base, { labels })
    assert.equal(result.artifact, null)
    assert.ok(result.refusals.some((r) => r.includes("fresh digest")))
  })

  it("refuses a datasetId that matches the run but not the target ingest", () => {
    const base = fixture()
    const result = build(base, { ingestRow: { ...ingestRow(base.datasetId), dataset_id: "beefbeefbeefbeef" } })
    assert.equal(result.artifact, null)
    assert.ok(result.refusals.some((r) => r.includes("vision_ingests 7")))
  })

  it("refuses a labels file with no datasetId at all", () => {
    const base = fixture()
    const labels = labelFile(base)
    delete labels.datasetId
    const result = build(base, { labels })
    assert.equal(result.artifact, null)
    assert.ok(result.refusals.some((r) => r.includes("no datasetId")))
  })
})

describe("convert-labels-to-face-work: joining to the target", () => {
  it("refuses when a labelled face's box is not among the target's rows, with a count", () => {
    const base = fixture()
    const result = build(base, { targetKeyCounts: targetKeysFor(base, [0, 1, 2]) })
    assert.equal(result.artifact, null)
    assert.equal(result.stats.unjoinable.boxMissing, 1)
    const refusal = result.refusals.find((r) => r.includes("1 of 4 labelled face(s)"))
    assert.ok(refusal)
    // Counts and categories only: no filename, no path, no name.
    assert.ok(!refusal.includes("synthetic-"))
    assert.ok(!refusal.includes("Test Person"))
  })

  it("refuses when a labelled face's photograph is absent from the database", () => {
    const base = fixture()
    const mediaBySha = new Map([[SHA_A, { width: ORIGINAL.width, height: ORIGINAL.height }]])
    const result = build(base, { mediaBySha })
    assert.equal(result.artifact, null)
    assert.equal(result.stats.unjoinable.photoMissing, 2)
  })

  it("counts a key naming several target rows as an advisory, not a refusal", () => {
    const base = fixture()
    const targetKeyCounts = targetKeysFor(base, [0, 1, 2, 3])
    targetKeyCounts.set(scaledKey(SHA_A, base.faces[0].box), 2)
    const result = build(base, { targetKeyCounts })
    assert.deepEqual(result.refusals, [])
    assert.equal(result.stats.multiRowKeys, 1)
  })

  it("emits nothing for a skipped or unlabelled face", () => {
    const base = fixture()
    const labels = labelFile(base, { labels: { 0: "k1", 2: "k2", 3: "x" }, skipped: [2] })
    const result = build(base, { labels })
    const artifact = result.artifact
    assert.ok(artifact)
    assert.equal(result.stats.skippedByLabeller, 1)
    assert.equal(result.stats.unlabelled, 1)
    assert.equal(result.stats.labelled, 2)
    assert.equal(artifact.payload.confirmations.length, 2)
  })
})

describe("convert-labels-to-face-work: people", () => {
  it("carries every face of one label value under one ref, and every ref under one name", () => {
    const base = fixture()
    const result = build(base)
    const artifact = result.artifact
    assert.ok(artifact)

    assert.equal(artifact.payload.people.length, 2)
    /** @type {Map<string, string>} */
    const refByKey = new Map()
    for (const c of artifact.payload.confirmations) {
      if (c.personRef !== null) refByKey.set(c.key, c.personRef)
    }
    // Faces 0 and 1 are the same label value on two different photographs.
    assert.equal(
      refByKey.get(scaledKey(SHA_A, base.faces[0].box)),
      refByKey.get(scaledKey(SHA_B, base.faces[1].box)),
    )
    assert.notEqual(
      refByKey.get(scaledKey(SHA_A, base.faces[0].box)),
      refByKey.get(scaledKey(SHA_A, base.faces[2].box)),
    )
    const names = new Set(artifact.payload.people.map((p) => p.displayName))
    assert.deepEqual(names, new Set(["Test Personone", "Test Persontwo"]))
    // Every assignment is a human's judgement; nothing here is the model guessing.
    for (const c of artifact.payload.confirmations) {
      if (c.op === "assign") assert.equal(c.provenance, "confirmed")
    }
    assert.equal(artifact.payload.includesPropagated, false)
  })

  it("reads both identities.json value shapes and drops guestId", () => {
    const modern = normaliseIdentityNames({ k1: { guestId: 12, name: "Test Personone" } })
    assert.equal(modern.get("k1"), "Test Personone")
    const legacy = normaliseIdentityNames({ k1: "Test Personone" })
    assert.equal(legacy.get("k1"), "Test Personone")
    // No regex, per CLAUDE.md — including in the assertion. `assert.throws`
    // takes a predicate, and `includes` is the same check without a literal.
    /** @param {unknown} err @returns {boolean} */
    const saysNoName = (err) => err instanceof Error && err.message.includes("no usable name")
    assert.throws(() => normaliseIdentityNames({ k1: { guestId: 12, name: "" } }), saysNoName)
    assert.throws(() => normaliseIdentityNames({ k1: { guestId: 12 } }), saysNoName)
  })
})

describe("convert-labels-to-face-work: the artifact itself", () => {
  it("is a valid wedding-face-work artifact the import path will parse", () => {
    const base = fixture()
    const result = build(base)
    assert.ok(result.artifact)
    const parsed = parseFaceWorkArtifact(JSON.stringify(result.artifact))
    assert.equal(parsed.valid, true, parsed.valid ? "" : parsed.error)
  })

  it("carries the target ingest's own provenance verbatim", () => {
    const base = fixture()
    const row = ingestRow(base.datasetId)
    const result = build(base, { ingestRow: row })
    assert.ok(result.artifact)
    const ingest = result.artifact.payload.ingest
    assert.equal(ingest.datasetId, row.dataset_id)
    assert.equal(ingest.modelVersion, row.model_version)
    assert.equal(ingest.detectorSha256, row.detector_sha256)
    assert.equal(ingest.embedderSha256, row.embedder_sha256)
    assert.equal(ingest.engineSha256, row.engine_sha256)
    assert.equal(ingest.mirrorApplied, row.mirror_applied)
    assert.equal(ingest.normalisation, row.normalisation)
    assert.equal(ingest.routeProfile, row.route_profile)
    // The source-machine primary key never travels.
    assert.ok(!Object.prototype.hasOwnProperty.call(ingest, "id"))
  })

  it("re-running over unchanged inputs is a replay, not a second batch", () => {
    const base = fixture()
    const first = build(base)
    const second = build(fixture())
    assert.ok(first.artifact)
    assert.ok(second.artifact)
    assert.equal(first.artifact.contentSha256, second.artifact.contentSha256)
    assert.equal(first.artifact.batchId, second.artifact.batchId)
    // The timestamp is deliberately outside the digest, so it may differ.
    assert.equal(
      JSON.stringify(first.artifact.payload),
      JSON.stringify(second.artifact.payload),
    )
  })

  it("a different labelling produces a different batch id", () => {
    const base = fixture()
    const first = build(base)
    const second = build(base, {
      labels: labelFile(base, { labels: { 0: "k2", 1: "k1", 2: "k2", 3: "x" } }),
    })
    assert.ok(first.artifact)
    assert.ok(second.artifact)
    assert.notEqual(first.artifact.batchId, second.artifact.batchId)
  })
})

describe("convert-labels-to-face-work: argv", () => {
  it("requires a run directory, an ingest and an output path", () => {
    assert.equal(parseConvertLabelsArgs([]).valid, false)
    assert.equal(parseConvertLabelsArgs(["run"]).valid, false)
    assert.equal(parseConvertLabelsArgs(["run", "--ingest", "2"]).valid, false)
    const ok = parseConvertLabelsArgs(["run", "--ingest", "2", "--out", "tmp/a.json"])
    assert.equal(ok.valid, true)
    if (!ok.valid) return
    assert.equal(ok.value.runDir, "run")
    assert.equal(ok.value.ingestId, 2)
    assert.equal(ok.value.out, "tmp/a.json")
    assert.equal(ok.value.facesFrom, "ingest")
    assert.equal(ok.value.dryRun, false)
  })

  it("refuses an unknown flag rather than ignoring it", () => {
    const result = parseConvertLabelsArgs(["run", "--ingest", "2", "--out", "a", "--wat"])
    assert.equal(result.valid, false)
    if (result.valid) return
    assert.ok(result.error.includes("--wat"))
  })

  it("refuses a non-positive ingest id and an unknown --faces-from", () => {
    assert.equal(parseConvertLabelsArgs(["run", "--ingest", "0", "--out", "a"]).valid, false)
    assert.equal(
      parseConvertLabelsArgs(["run", "--ingest", "2", "--out", "a", "--faces-from", "nope"]).valid,
      false,
    )
    const ok = parseConvertLabelsArgs([
      "run",
      "--ingest",
      "2",
      "--out",
      "a",
      "--faces-from",
      "model-version",
      "--dry-run",
    ])
    assert.equal(ok.valid, true)
    if (!ok.valid) return
    assert.equal(ok.value.facesFrom, "model-version")
    assert.equal(ok.value.dryRun, true)
  })
})
