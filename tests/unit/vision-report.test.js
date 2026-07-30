/** @file Unit test: the read-out of the instrument.
 *
 *  Everything here runs against a FABRICATED run directory. No photograph, no
 *  crop and no real descriptor is involved — the fixture is eight points on a
 *  unit circle with hand-computed capture times, and every assertion below is a
 *  pair list or a group count worked out by hand from that fixture.
 *
 *  Three things are worth testing and one is worth testing hard:
 *
 *  - the STRATA, because a mis-built stratum is how this project would produce a
 *    flattering number and a wrong decision;
 *  - POOL A isolation, because pool B's coverage is conditioned on what the
 *    model already grouped confidently;
 *  - the CUTOFF SWEEP, because `groupFaces` rewrites `options.matrix` in place
 *    and a sweep that reuses one matrix runs, terminates, and is silently wrong.
 *    That one gets three assertions, including one that proves the guard is
 *    load-bearing rather than decorative.
 */

/** @import * as Types from '../../scripts/vision/types.js' */
/** @import * as V from '../../public/vision/types.js' */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { after, test } from "node:test"

import { distanceMatrix, groupFaces } from "../../public/vision/group.js"
import { groupingQuality } from "../../public/vision/metrics.js"
import {
  analyse,
  buildView,
  bestSweepPoint,
  frameRoots,
  jointGate,
  loadRun,
  parseArgs,
  pickHeadline,
  printSummary,
  renderHtml,
  reportA,
  representativeSweep,
  resolutionCost,
  separationStrata,
  sweepGrouping,
} from "../../scripts/vision/session1-report.js"

// ---------------------------------------------------------------------------
// Fixture. Times are absolute so the strata boundaries can be read off directly.
// ---------------------------------------------------------------------------

const T = 1_700_000_000_000
const SECOND = 1000
const MINUTE = 60_000
const HOUR = 3_600_000

/** Temp dirs go in the repo's own tmp/, never a session scratchpad. */
const REPO_TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tmp")
fs.mkdirSync(REPO_TMP, { recursive: true })
const WORK = fs.mkdtempSync(path.join(REPO_TMP, "vision-report-test-"))
after(() => fs.rmSync(WORK, { recursive: true, force: true }))

/** @param {number} angle @returns {number[]} */
const onCircle = (angle) => [Math.cos(angle), Math.sin(angle)]

/**
 * @param {object} spec
 * @param {number} spec.id
 * @param {number | null} spec.capturedAtMs
 * @param {number | null} [spec.nearDuplicateOf]
 * @param {number | null} [spec.exactDuplicateOf]
 * @param {number} [spec.faces]
 * @returns {Types.Session1PhotoRecord}
 */
function photo(spec) {
  return {
    id: spec.id,
    relative: `f${spec.id}.jpg`,
    sha256: `sha-${spec.id}`,
    aHash: `hash-${spec.id}`,
    width: 2000,
    height: 1333,
    capturedAtMs: spec.capturedAtMs,
    mtimeMs: T,
    faces: spec.faces ?? 1,
    exactDuplicateOf: spec.exactDuplicateOf ?? null,
    nearDuplicateOf: spec.nearDuplicateOf ?? null,
    ms: { decode: 40, downsample: 5, detect: 30, align: 2, describe: 6 },
  }
}

/**
 * @param {object} spec
 * @param {number} spec.id
 * @param {number} spec.photoId
 * @param {number} spec.angle
 * @param {Partial<V.GateSignals>} [spec.signals]
 * @param {number} [spec.mirrorAngle]
 * @returns {Types.Session1FaceRecord}
 */
function face(spec) {
  /** @type {V.GateSignals} */
  const signals = {
    score: 0.9,
    boxPx: 120,
    borderPx: 30,
    eyeRatio: 0.35,
    eyeAngle: 0.01,
    alignScale: 0.8,
    residual: 1.2,
    outsideFraction: 0,
    sharpness: 0.02,
    ...spec.signals,
  }
  /** @type {Types.Session1FaceRecord} */
  const record = {
    id: spec.id,
    photoId: spec.photoId,
    crop: `crops/${String(spec.id).padStart(6, "0")}.png`,
    score: signals.score,
    box: { x: 100, y: 100, w: 120, h: 120 },
    landmarks: [130, 140, 172, 140, 151, 165, 134, 186, 168, 186],
    signals,
    descriptor: onCircle(spec.angle),
  }
  if (spec.mirrorAngle !== undefined) record.mirrorDescriptor = onCircle(spec.mirrorAngle)
  return record
}

/**
 * P0 and P1 are the same frame twice (a retouched duplicate). P1's link is what
 * the dedup stratum has to follow.
 * @type {Types.Session1PhotoRecord[]}
 */
const PHOTOS = [
  photo({ id: 0, capturedAtMs: T, faces: 2 }),
  photo({ id: 1, capturedAtMs: T + 10 * SECOND, nearDuplicateOf: 0 }),
  photo({ id: 2, capturedAtMs: T + 30 * MINUTE }),
  photo({ id: 3, capturedAtMs: T + 3 * HOUR, faces: 2 }),
  photo({ id: 4, capturedAtMs: T + 6 * HOUR, faces: 2 }),
]

/**
 * Rows 0-5 are pool A, in this order. Two tight clusters (p1 near angle 0, p2
 * near angle 2) plus face 5: a p1 face parked at 1.4 rad, much closer to p2's
 * cluster than to its own. That is the hard overlapping pair, and it is what
 * stops every AUC below from being a trivial 1.
 * @type {Types.Session1FaceRecord[]}
 */
const FACES = [
  face({ id: 0, photoId: 0, angle: 0 }),
  face({ id: 1, photoId: 1, angle: 0.02 }),
  face({ id: 2, photoId: 2, angle: 0.04 }),
  face({ id: 3, photoId: 3, angle: 2.0 }),
  face({ id: 4, photoId: 0, angle: 2.02 }),
  // Its sharpness is also deliberately mid-range, so report D's sweep has one
  // LABELLED face to actually lose as a cutoff tightens.
  face({ id: 5, photoId: 4, angle: 1.4, mirrorAngle: 1.35, signals: { sharpness: 0.006 } }),
  // Pool B. Placed inside the clusters, so including them would visibly move
  // report A's pair counts and its AUC.
  face({ id: 6, photoId: 3, angle: 0.01 }),
  face({ id: 7, photoId: 4, angle: 2.01 }),
  // Unlabelled, and rejected by the default gate. Present so report D has
  // something to reject and report B has an unlabelled face to cluster.
  face({ id: 8, photoId: 2, angle: 0.9, signals: { boxPx: 12, sharpness: 0.0001 } }),
]

/** @type {Types.Session1LabelFile} */
const LABELS = {
  version: 1,
  labels: { 0: "p1", 1: "p1", 2: "p1", 3: "p2", 4: "p2", 5: "p1", 6: "p1", 7: "p2" },
  pool: { 0: "A", 1: "A", 2: "A", 3: "A", 4: "A", 5: "A", 6: "B", 7: "B" },
}

/** @type {Types.Session1Timing} */
const TIMING = {
  photos: PHOTOS.length,
  faces: FACES.length,
  stages: {
    decode: { ms: 200, n: 5 },
    detect: { ms: 150, n: 5 },
    align: { ms: 10, n: 9 },
    describe: { ms: 54, n: 9 },
  },
  environment: { node: "v26.0.0", backend: "fixture" },
  config: { detectEdge: 1280 },
}

/** @type {Types.Session1ResolutionRecord[]} */
const RESOLUTION = [
  { photoId: 0, atDetectEdge: 2, atSourceEdge: 2, matchedIou: [0.91, 0.88] },
  { photoId: 3, atDetectEdge: 1, atSourceEdge: 2, matchedIou: [0.79] },
]

/**
 * @param {string} name
 * @param {object} [overrides]
 * @param {Types.Session1LabelFile | null} [overrides.labels]
 * @param {string} [overrides.facesTail] Raw text appended to faces.jsonl.
 * @returns {string}
 */
function writeRun(name, overrides = {}) {
  const dir = path.join(WORK, name)
  fs.mkdirSync(dir, { recursive: true })
  /** @param {string} file @param {unknown[]} rows */
  const jsonl = (file, rows) => fs.writeFileSync(path.join(dir, file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
  jsonl("photos.jsonl", PHOTOS)
  jsonl("faces.jsonl", FACES)
  jsonl("resolution.jsonl", RESOLUTION)
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(TIMING))
  const labels = "labels" in overrides ? overrides.labels : LABELS
  if (labels) fs.writeFileSync(path.join(dir, "labels.json"), JSON.stringify(labels))
  if (overrides.facesTail) fs.appendFileSync(path.join(dir, "faces.jsonl"), overrides.facesTail)
  return dir
}

const RUN_DIR = writeRun("full")

/** @returns {Types.LoadedRun} */
function run() {
  return loadRun(RUN_DIR)
}

/**
 * Every (i, j) a stratum keeps, among labelled rows. Written out rather than
 * counted, because a count that happens to match while the membership is wrong
 * is exactly the failure mode this file exists to catch.
 * @param {Types.FaceView} view
 * @param {string} key
 * @returns {Array<[number, number]>}
 */
function keptPairs(view, key) {
  const spec = separationStrata(view).find((s) => s.key === key)
  assert.ok(spec, `no stratum ${key}`)
  /** @type {Array<[number, number]>} */
  const pairs = []
  for (let i = 0; i < view.labels.length; i++) {
    if (view.labels[i] === null) continue
    for (let j = i + 1; j < view.labels.length; j++) {
      if (view.labels[j] === null) continue
      if (spec.keep && !spec.keep(i, j)) continue
      pairs.push([i, j])
    }
  }
  return pairs
}

// ---------------------------------------------------------------------------
// loadRun
// ---------------------------------------------------------------------------

test("loadRun joins the two JSONL files and the three JSON side-files", () => {
  const loaded = run()
  assert.equal(loaded.photos.length, 5)
  assert.equal(loaded.faces.length, 9)
  assert.equal(loaded.resolution.length, 2)
  assert.ok(loaded.labels)
  assert.ok(loaded.timing)
  assert.equal(loaded.labels.labels["3"], "p2")
  assert.equal(loaded.timing.photos, 5)
})

test("loadRun survives a missing labels.json rather than reporting on nothing", () => {
  const dir = writeRun("no-labels", { labels: null })
  const loaded = loadRun(dir)
  assert.equal(loaded.labels, null)
  assert.equal(loaded.faces.length, 9, "the rest of the run still loads")
  // Every view then has no labels at all, which is a report that says so — not
  // a crash and not a confident zero.
  const view = buildView(loaded, { requireLabel: true })
  assert.equal(view.labels.length, 0)
})

test("loadRun skips a truncated JSONL line instead of throwing", () => {
  // A batch killed mid-write leaves exactly this: a half-serialised final row.
  const dir = writeRun("truncated", { facesTail: '{"id":99,"photoId":4,"desc' })
  /** @type {Types.LoadedRun | null} */
  let loaded = null
  assert.doesNotThrow(() => {
    loaded = loadRun(dir)
  })
  assert.ok(loaded)
  assert.equal(/** @type {Types.LoadedRun} */ (loaded).faces.length, 9, "the nine good rows survive")
})

test("loadRun on an empty directory returns empty, not undefined", () => {
  const dir = path.join(WORK, "empty")
  fs.mkdirSync(dir, { recursive: true })
  const loaded = loadRun(dir)
  assert.deepEqual(loaded.photos, [])
  assert.deepEqual(loaded.faces, [])
  assert.equal(loaded.labels, null)
  assert.equal(loaded.timing, null)
})

// ---------------------------------------------------------------------------
// Duplicate frames
// ---------------------------------------------------------------------------

test("frameRoots follows duplicate links transitively", () => {
  // A delivery with an original, a retouch and a re-export links B->A and C->B.
  // Treating A and C as unrelated leaves exactly the pair the exclusion is for.
  const roots = frameRoots([
    photo({ id: 0, capturedAtMs: T }),
    photo({ id: 1, capturedAtMs: T, nearDuplicateOf: 0 }),
    photo({ id: 2, capturedAtMs: T, exactDuplicateOf: 1 }),
    photo({ id: 3, capturedAtMs: T }),
  ])
  assert.equal(roots.get(0), roots.get(1))
  assert.equal(roots.get(0), roots.get(2), "transitive, not just one hop")
  assert.notEqual(roots.get(0), roots.get(3))
})

test("frameRoots ignores a link to a photo the run never wrote a row for", () => {
  const roots = frameRoots([photo({ id: 7, capturedAtMs: T, nearDuplicateOf: 3 })])
  assert.equal(roots.get(7), 7)
})

// ---------------------------------------------------------------------------
// Strata
// ---------------------------------------------------------------------------

test("pool A rows are exactly the pool A faces, in file order", () => {
  const view = buildView(run(), { pool: "A", requireLabel: true })
  assert.deepEqual(view.faceIds, [0, 1, 2, 3, 4, 5])
  assert.deepEqual(view.labels, ["p1", "p1", "p1", "p2", "p2", "p1"])
  assert.deepEqual(view.photoIds, [0, 1, 2, 3, 0, 4])
})

test("a pair from near-duplicate frames is excluded", () => {
  const view = buildView(run(), { pool: "A", requireLabel: true })
  // Rows 0 and 1 are the same frame twice (photo 1 nearDuplicateOf photo 0), and
  // so are rows 1 and 4. Everything else survives.
  assert.equal(keptPairs(view, "all").length, 15)
  const dedup = keptPairs(view, "dedup")
  assert.equal(dedup.length, 13)
  assert.ok(!dedup.some(([i, j]) => i === 0 && j === 1), "(0,1) is one frame twice")
  assert.ok(!dedup.some(([i, j]) => i === 1 && j === 4), "(1,4) is one frame twice")
  assert.ok(
    dedup.some(([i, j]) => i === 0 && j === 4),
    "(0,4) is two people in ONE photograph — genuine different-person evidence, kept",
  )
})

test("the time strata contain the pairs they should and no others", () => {
  const view = buildView(run(), { pool: "A", requireLabel: true })
  // Times: r0 = T, r1 = T+10s, r2 = T+30m, r3 = T+3h, r4 = T, r5 = T+6h.
  assert.deepEqual(keptPairs(view, "minute"), [[0, 4]])
  assert.deepEqual(keptPairs(view, "hour"), [
    [0, 2],
    [1, 2],
    [2, 4],
  ])
  assert.deepEqual(keptPairs(view, "crossHour"), [
    [0, 3],
    [0, 5],
    [1, 3],
    [1, 5],
    [2, 3],
    [2, 5],
    [3, 4],
    [3, 5],
    [4, 5],
  ])
})

test("the time strata partition the deduplicated pairs exactly", () => {
  const view = buildView(run(), { pool: "A", requireLabel: true })
  const dedup = keptPairs(view, "dedup").length
  const timed = ["minute", "hour", "crossHour"].reduce((n, key) => n + keptPairs(view, key).length, 0)
  // Every pair with two capture times lands in exactly one bucket. If this ever
  // fails, a boundary condition moved and a stratum is double-counting.
  assert.equal(timed, dedup)
})

test("faces with no capture time drop out of every time stratum, not into one", () => {
  const loaded = run()
  loaded.photos = loaded.photos.map((p) => (p.id === 4 ? { ...p, capturedAtMs: null } : p))
  const view = buildView(loaded, { pool: "A", requireLabel: true })
  assert.equal(view.times[5], null)
  for (const key of ["minute", "hour", "crossHour"]) {
    assert.ok(
      !keptPairs(view, key).some(([i, j]) => i === 5 || j === 5),
      `row 5 has no time and must not appear in ${key}`,
    )
  }
  assert.ok(keptPairs(view, "dedup").some(([i, j]) => i === 5 || j === 5), "but it still counts in dedup")
})

// ---------------------------------------------------------------------------
// Report A / pool isolation
// ---------------------------------------------------------------------------

test("report A excludes pool B — its coverage is conditioned on the model's own grouping", () => {
  const loaded = run()
  const poolA = buildView(loaded, { pool: "A", requireLabel: true })
  const a = reportA(poolA)
  const all = a.strata.find((s) => s.key === "all")
  assert.ok(all)
  // 6 pool-A faces: p1 has 4 (6 same pairs), p2 has 2 (1 same pair) = 7 same,
  // 4*2 = 8 cross pairs. Pool B's two faces would make it 8 and 12.
  assert.equal(all.report.sameCount, 7)
  assert.equal(all.report.diffCount, 8)

  const everything = buildView(loaded, { requireLabel: true })
  assert.deepEqual(everything.faceIds, [0, 1, 2, 3, 4, 5, 6, 7], "B is still available for reports B and C")
  const contaminated = reportA(everything).strata.find((s) => s.key === "all")
  assert.ok(contaminated)
  // p1 gains face 6 and p2 gains face 7: 10 + 3 same pairs instead of 6 + 1.
  assert.equal(contaminated.report.sameCount, 13)
  assert.equal(contaminated.report.diffCount, 15)
  assert.notEqual(contaminated.report.auc, all.report.auc, "including pool B changes the headline")
})

test("report A marks the different-hour stratum as the honest one", () => {
  const a = reportA(buildView(run(), { pool: "A", requireLabel: true }))
  const honest = a.strata.filter((s) => s.honest)
  assert.equal(honest.length, 1)
  assert.equal(honest[0].key, "crossHour")
  assert.equal(a.honestKey, "crossHour")
})

test("report A counts the faces with no capture time so the reader knows what dropped", () => {
  const loaded = run()
  loaded.photos = loaded.photos.map((p) => (p.id === 2 ? { ...p, capturedAtMs: null } : p))
  const a = reportA(buildView(loaded, { pool: "A", requireLabel: true }))
  assert.equal(a.facesWithoutTime, 1)
})

test("a labels.json with no pool map is treated as all-pool-A, and says so", () => {
  const loaded = run()
  loaded.labels = { version: 1, labels: LABELS.labels, pool: {} }
  const view = buildView(loaded, { pool: "A", requireLabel: true })
  assert.equal(view.poolAssumed, true)
  assert.equal(view.faceIds.length, 8)
})

test("pickHeadline refuses a different-hour stratum too thin to be a measurement", () => {
  /** @param {string} key @param {boolean} honest @param {number} same @param {number} diff */
  const stub = (key, honest, same, diff) => ({
    key,
    title: key,
    note: "",
    honest,
    report: /** @type {V.SeparationReport} */ (
      /** @type {unknown} */ ({ sameCount: same, diffCount: diff, auc: 0.9 })
    ),
  })
  assert.equal(pickHeadline([stub("all", false, 99, 99), stub("dedup", false, 90, 90), stub("crossHour", true, 40, 40)]).key, "crossHour")
  // Four same-person pairs is not a result. Falling back is honest; presenting
  // four pairs as the headline is not.
  assert.equal(pickHeadline([stub("all", false, 99, 99), stub("dedup", false, 90, 90), stub("crossHour", true, 4, 5)]).key, "dedup")
})

// ---------------------------------------------------------------------------
// Report B — the matrix-mutation bug
// ---------------------------------------------------------------------------

const CUTOFFS = [0.05, 0.2, 0.35, 0.6, 0.9]

/** @returns {Types.FaceView} */
function everythingView() {
  return buildView(run())
}

test("the cutoff sweep is reproducible — a mutated matrix would not be", () => {
  const view = everythingView()
  const args = { cutoffs: CUTOFFS, labels: view.labels, photoIds: view.photoIds }
  const first = sweepGrouping(view.set, args)
  const second = sweepGrouping(view.set, args)
  assert.deepEqual(first, second)
})

test("the cutoff sweep equals rebuilding the matrix from scratch for every cutoff", () => {
  // This is the assertion the handoff asks for by name. `groupFaces` rewrites
  // options.matrix in place (Lance-Williams), so the only way a sweep is right
  // is if every step gets untouched data.
  const view = everythingView()
  const swept = sweepGrouping(view.set, { cutoffs: CUTOFFS, labels: view.labels, photoIds: view.photoIds })

  /** @type {Types.SweepPoint[]} */
  const fresh = []
  for (const cannotLink of [true, false]) {
    for (const cutoff of CUTOFFS) {
      const groups = groupFaces(view.set, {
        cutoff,
        photoIds: view.photoIds,
        cannotLinkWithinPhoto: cannotLink,
        matrix: distanceMatrix(view.set),
      })
      fresh.push({ cutoff, cannotLink, quality: groupingQuality(groups, view.labels) })
    }
  }
  assert.deepEqual(swept, fresh)
})

/**
 * A chain of nine descriptors chosen so that Lance-Williams merging at a low
 * cutoff rewrites the matrix badly enough to change the grouping at the NEXT
 * cutoff. It exists purely so the guard below is proven rather than assumed —
 * on a well-separated fixture the corrupted sweep happens to agree, and a test
 * built on one of those proves nothing at all.
 */
const CHAIN_ANGLES = [1.631, 0.14, 1.36, 1.091, 0.449, 1.963, 0.152, 1.766, 0.322]

/** @returns {V.DescriptorSet} */
function chainSet() {
  const data = new Float32Array(CHAIN_ANGLES.length * 2)
  CHAIN_ANGLES.forEach((a, i) => data.set([Math.cos(a), Math.sin(a)], i * 2))
  return { dim: 2, data }
}

/** @param {V.FaceGroup[]} groups @returns {string} */
const shape = (groups) => JSON.stringify(groups.map((g) => g.members))

test("the matrix-mutation bug is real, and sweepGrouping does not have it", () => {
  const set = chainSet()
  // Distinct photo ids, so cannot-link is inert and only the matrix is in play.
  const photoIds = CHAIN_ANGLES.map((_, i) => i)

  const fresh = CUTOFFS.map((cutoff) =>
    shape(groupFaces(set, { cutoff, photoIds, cannotLinkWithinPhoto: false, matrix: distanceMatrix(set) })),
  )

  // The bug, written out: one matrix, reused. It runs and it terminates.
  const shared = distanceMatrix(set)
  const corrupted = CUTOFFS.map((cutoff) =>
    shape(groupFaces(set, { cutoff, photoIds, cannotLinkWithinPhoto: false, matrix: shared })),
  )
  assert.notDeepEqual(corrupted, fresh, "if these agree, the assertion below has become vacuous")

  const swept = sweepGrouping(set, {
    cutoffs: CUTOFFS,
    labels: CHAIN_ANGLES.map(() => null),
    photoIds,
    cannotLink: [false],
  }).map((p) => p.quality.groups)
  const freshCounts = CUTOFFS.map(
    (cutoff) =>
      groupFaces(set, { cutoff, photoIds, cannotLinkWithinPhoto: false, matrix: distanceMatrix(set) }).length,
  )
  assert.deepEqual(swept, freshCounts, "the sweep must match a per-cutoff rebuild on the fixture that distinguishes them")
})

test("the sweep does not leave the caller's descriptor set altered", () => {
  const view = everythingView()
  const before = Float32Array.from(view.set.data)
  sweepGrouping(view.set, { cutoffs: CUTOFFS, labels: view.labels, photoIds: view.photoIds })
  assert.deepEqual(Array.from(view.set.data), Array.from(before))
})

test("the sweep runs both cannot-link modes and they differ where a photo has two faces", () => {
  const view = everythingView()
  const points = sweepGrouping(view.set, { cutoffs: [1.2], labels: view.labels, photoIds: view.photoIds })
  const on = points.find((p) => p.cannotLink)
  const off = points.find((p) => !p.cannotLink)
  assert.ok(on && off)
  // At a cutoff wide enough to merge everything, cannot-link is the only thing
  // stopping the two faces of photo 0 from welding into one group.
  assert.ok(on.quality.groups > off.quality.groups, `${on.quality.groups} vs ${off.quality.groups}`)
})

test("bestSweepPoint prefers over-splitting to welding two people together", () => {
  /** @param {number} cutoff @param {number} f1 @param {number} welded */
  const point = (cutoff, f1, welded) => ({
    cutoff,
    cannotLink: true,
    quality: /** @type {V.GroupingReport} */ (/** @type {unknown} */ ({ pairF1: f1, weldedGroups: welded })),
  })
  const best = bestSweepPoint([point(0.3, 0.7, 0), point(0.5, 0.95, 1)])
  assert.ok(best)
  assert.equal(best.cutoff, 0.3, "the higher F1 welded two people; that is the expensive failure")
})

// ---------------------------------------------------------------------------
// Mirror descriptors
// ---------------------------------------------------------------------------

test("buildView prefers the mirror-averaged descriptor only when asked", () => {
  const loaded = run()
  const plain = buildView(loaded, { pool: "A", requireLabel: true })
  const mirrored = buildView(loaded, { pool: "A", requireLabel: true, mirror: true })
  // Face 5 is the only one carrying a mirror descriptor, and it sits at row 5 —
  // dim 2, so its components are at indices 10 and 11.
  assert.deepEqual(Array.from(plain.set.data.slice(0, 10)), Array.from(mirrored.set.data.slice(0, 10)))
  assert.notEqual(plain.set.data[10], mirrored.set.data[10])
  assert.notEqual(plain.set.data[11], mirrored.set.data[11])
})

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

test("analyse produces all five reports and a verdict", () => {
  const analysis = analyse(run())
  assert.equal(analysis.counts.poolA, 6)
  assert.equal(analysis.counts.poolB, 2)
  assert.equal(analysis.a.strata.length, 5)
  assert.ok(analysis.b.points.length > 0)
  assert.ok(analysis.c.evaluated > 0)
  assert.equal(analysis.d.keys.length, 9, "one sweep per gate cutoff")
  assert.ok(analysis.d.breakdown.length > 0)
  assert.ok(analysis.e.resolution)
  assert.ok(analysis.e.mirror, "face 5 carries a mirror descriptor")
  assert.ok(analysis.e.timing)
  assert.ok(analysis.verdict.headline.length > 0)
  assert.ok(analysis.recommended.some((r) => r.path === "group.cutoff"))
})

test("report D's gate sweep only ever loses faces as a cutoff tightens", () => {
  const analysis = analyse(run())
  for (const axis of analysis.d.keys) {
    for (let i = 1; i < axis.points.length; i++) {
      assert.ok(
        axis.points[i].kept <= axis.points[i - 1].kept,
        `${axis.key}: ${axis.points[i - 1].kept} -> ${axis.points[i].kept} at ${axis.points[i].value}`,
      )
    }
  }
})

test("report D attributes every detection to exactly one primary reason", () => {
  const analysis = analyse(run())
  const total = analysis.d.breakdown.reduce((n, r) => n + r.n, 0)
  assert.equal(total, FACES.length)
  // Face 8 is a tiny blurry detection; the default gate must reject it, and the
  // attribution is to the FIRST failing check in cost order, not to all of them.
  assert.ok(analysis.d.breakdown.some((r) => r.reason === "boxPx" && r.n === 1))
})

// ---------------------------------------------------------------------------
// The joint gate — the recommendation nobody evaluated
//
// Report D sweeps each gate cutoff with the other eight WIDE OPEN, which is the
// only honest way to measure one cutoff's own contribution — and which makes
// each of the nine sweeps a measurement of a DIFFERENT configuration. Taking the
// winner of each and printing them together recommends a tenth configuration
// that was never run, and whose intersection can be a small fraction of what any
// one of them keeps.
// ---------------------------------------------------------------------------

/**
 * Every signal comfortably inside its default cutoff, so the DEFAULT gate keeps
 * the whole fixture and any improvement below is genuinely the sweep's doing.
 * @type {V.GateSignals}
 */
const TRAP_SAFE = {
  score: 0.95,
  boxPx: 220,
  borderPx: 120,
  eyeRatio: 0.4,
  eyeAngle: 0.01,
  alignScale: 0.6,
  residual: 0.8,
  outsideFraction: 0,
  sharpness: 0.05,
}

/**
 * One weak value per gate axis — still inside the shipped default, so nothing
 * here is rejected until a swept cutoff tightens past it. Each axis therefore
 * has its own private group of faces to drop, and no axis can drop another's.
 * @type {Array<Partial<V.GateSignals>>}
 */
const TRAP_WEAK = [
  { score: 0.62 },
  { boxPx: 44 },
  { borderPx: 1 },
  { eyeRatio: 0.21 },
  { eyeRatio: 0.61 },
  { residual: 11.5 },
  { alignScale: 1.55 },
  { outsideFraction: 0.019 },
  { sharpness: 0.0042 },
]

/**
 * Six faces per person, well separated, plus nine groups of eight faces that are
 * labelled p1 and sit inside p2's cluster. Every group is a genuine improvement
 * to drop and each is dropped by exactly one axis, so all nine sweeps report a
 * gain while keeping 76 of 84 — and all nine applied together keep 12.
 *
 * Each face is its own photograph, two hours apart, so every pair lands in the
 * different-hour stratum and the headline is the honest one.
 * @returns {string}
 */
function writeTrapRun() {
  const dir = path.join(WORK, "gate-trap")
  fs.mkdirSync(dir, { recursive: true })

  /** @type {Types.Session1PhotoRecord[]} */
  const photos = []
  /** @type {Types.Session1FaceRecord[]} */
  const faces = []
  /** @type {Record<string, string>} */
  const labels = {}
  /** @type {Record<string, "A" | "B">} */
  const pool = {}

  /** @param {number} angle @param {string} label @param {V.GateSignals} signals */
  const add = (angle, label, signals) => {
    const id = faces.length
    photos.push(photo({ id, capturedAtMs: T + id * 2 * HOUR }))
    faces.push({
      id,
      photoId: id,
      crop: `crops/${id}.png`,
      score: signals.score,
      box: { x: 100, y: 100, w: 120, h: 120 },
      landmarks: [130, 140, 172, 140, 151, 165, 134, 186, 168, 186],
      signals,
      descriptor: onCircle(angle),
    })
    labels[String(id)] = label
    pool[String(id)] = "A"
  }

  for (let k = 0; k < 6; k++) {
    add(0.0 + k * 0.001, "p1", { ...TRAP_SAFE })
    add(2.0 + k * 0.001, "p2", { ...TRAP_SAFE })
  }
  for (const weak of TRAP_WEAK) {
    for (let k = 0; k < 8; k++) add(2.0 + k * 0.001, "p1", { ...TRAP_SAFE, ...weak })
  }

  /** @param {string} file @param {unknown[]} rows */
  const jsonl = (file, rows) =>
    fs.writeFileSync(path.join(dir, file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
  jsonl("photos.jsonl", photos)
  jsonl("faces.jsonl", faces)
  fs.writeFileSync(path.join(dir, "labels.json"), JSON.stringify({ version: 1, labels, pool }))
  return dir
}

const TRAP_DIR = writeTrapRun()
const TRAP = analyse(loadRun(TRAP_DIR))

/** The two numbers a cutoff has to justify itself against, as reportD scores them.
 * @param {{ auc: number, rank1: number }} p @returns {number} */
const score = (p) => (Number.isFinite(p.auc) ? p.auc : 0) + (Number.isFinite(p.rank1) ? p.rank1 : 0)

test("the fixture really is a trap: nine cutoffs that keep 90% each and 14% together", () => {
  const j = TRAP.d.joint
  assert.equal(j.verdicts.length, 9)
  for (const v of j.verdicts) {
    assert.notEqual(v.candidate, null, `${v.key} should look worth it in isolation`)
    assert.ok(v.kept / v.total > 0.85, `${v.key} keeps ${v.kept}/${v.total} on its own`)
  }
  const thinnest = Math.min(...j.verdicts.map((v) => v.kept))
  // If this ever stops holding, the assertions below have gone vacuous: the bug
  // only exists where the intersection is much smaller than the parts.
  assert.ok(
    j.naive.kept * 3 < thinnest,
    `the nine together keep ${j.naive.kept}, the thinnest one alone keeps ${thinnest}`,
  )
})

test("report D reports what the recommended cutoffs keep JOINTLY, not the sum of nine sweeps", () => {
  const j = TRAP.d.joint
  // The measured intersection is present as a number, and it is the naive set's
  // own keep count — not any single sweep's.
  assert.ok(Number.isFinite(j.naive.kept))
  assert.ok(!j.verdicts.some((v) => v.kept === j.naive.kept))
  // And what is actually recommended was itself evaluated as one gate.
  assert.ok(Number.isFinite(j.result.kept))
  assert.ok(Number.isFinite(j.result.auc))
  assert.ok(Number.isFinite(j.result.rank1))
})

test("the recommendation is never worse than the defaults, and never below the floor", () => {
  const j = TRAP.d.joint
  assert.ok(
    score(j.result) >= score(TRAP.d.baseline),
    `recommended ${score(j.result)} vs defaults ${score(TRAP.d.baseline)}`,
  )
  assert.ok(j.result.kept >= j.floor, `${j.result.kept} kept, floor ${j.floor}`)
  // The naive set is what would have been printed before: better on paper,
  // measured over a set too thin for the measurement to mean anything.
  assert.ok(j.naive.kept < j.floor, "the trap's naive set is below the floor, which is why it is not recommended")
})

test("a cutoff that helps alone and not jointly is adopted by neither silence nor default", () => {
  const j = TRAP.d.joint
  assert.ok(j.adopted.length > 0, "some candidates do survive")
  assert.ok(j.rejected.length > 0, "and the floor stops the rest")
  assert.equal(
    j.adopted.length + j.rejected.length,
    j.verdicts.filter((v) => v.candidate !== null && v.candidate !== v.defaultValue).length,
    "every candidate is accounted for as adopted or rejected",
  )
  for (const key of j.rejected) {
    assert.equal(j.cutoffs[key], TRAP.d.defaults[key], `${key} must fall back to the shipped default`)
  }
})

test("every gate.* recommendation is a value from the set that was measured", () => {
  const j = TRAP.d.joint
  const gate = TRAP.recommended.filter((r) => r.path.startsWith("gate."))
  assert.equal(gate.length, 9)
  for (const r of gate) {
    const key = r.path.slice("gate.".length)
    assert.equal(r.value, String(j.cutoffs[key]), `${r.path} must come from joint.cutoffs`)
  }
})

test("the printed summary carries the joint keep count and the copy-the-numbers-only rule", () => {
  /** @type {string[]} */
  const lines = []
  printSummary(TRAP, (line) => lines.push(line))
  const text = lines.join("\n")
  assert.ok(text.includes(`${TRAP.d.joint.result.kept}/${TRAP.d.joint.result.total}`), "the joint result is printed")
  assert.ok(text.includes(`${TRAP.d.joint.naive.kept}/${TRAP.d.joint.naive.total}`), "so is the naive intersection")
  assert.ok(text.includes("Copy the NUMBERS ONLY"), "the fourth photograph rule is unchanged")
})

test("the default terminal report leads with a verdict and hides the sixty sweep rows", () => {
  /** @type {string[]} */
  const brief = []
  printSummary(TRAP, (line) => brief.push(line))
  /** @type {string[]} */
  const full = []
  printSummary(TRAP, (line) => full.push(line), { verbose: true })
  assert.ok(full.length > brief.length + 40, `${brief.length} lines brief, ${full.length} verbose`)
  const briefText = brief.join("\n")
  assert.ok(briefText.includes("best cutoff"), "the per-check verdict table leads")
  assert.ok(briefText.includes("--verbose"), "and says where the detail went")
  // The verdict summary comes before any per-axis heading, in both modes.
  const summaryAt = brief.findIndex((l) => l.includes("best cutoff"))
  const detailAt = full.findIndex((l) => l.includes("(min on score)"))
  assert.ok(summaryAt >= 0)
  assert.equal(
    brief.findIndex((l) => l.includes("(min on score)")),
    -1,
    "no per-axis sweep table without --verbose",
  )
  assert.ok(detailAt > full.findIndex((l) => l.includes("best cutoff")), "detail below the summary in verbose too")
})

/**
 * One swept axis, stubbed. `points[0]` is always the wide-open end, which is
 * what the isolated gain is measured against.
 * @param {string} key
 * @param {number} defaultValue
 * @param {Types.GateSweepPoint[]} points
 * @returns {Types.GateSweepKey}
 */
const axisStub = (key, defaultValue, points) => ({
  key,
  signal: "score",
  direction: "min",
  defaultValue,
  points,
})

test("jointGate backs all the way off when nothing survives on top of the rest", () => {
  const keys = [
    axisStub("alpha", 1, [
      { value: 1, kept: 100, total: 100, auc: 0.8, rank1: 0.8 },
      { value: 5, kept: 80, total: 100, auc: 0.9, rank1: 0.9 },
    ]),
    axisStub("beta", 2, [
      { value: 2, kept: 100, total: 100, auc: 0.8, rank1: 0.8 },
      { value: 9, kept: 80, total: 100, auc: 0.9, rank1: 0.9 },
    ]),
  ]
  const joint = jointGate({
    keys,
    base: { alpha: 1, beta: 2 },
    total: 100,
    baseline: { auc: 0.8, rank1: 0.8, kept: 100 },
    // Whatever is applied jointly is a disaster. The greedy pass has to notice.
    withCutoffs: (cutoffs) =>
      cutoffs.alpha === 1 && cutoffs.beta === 2
        ? { auc: 0.8, rank1: 0.8, kept: 100 }
        : { auc: 0.4, rank1: 0.4, kept: 6 },
  })
  assert.deepEqual(joint.cutoffs, { alpha: 1, beta: 2 }, "the recommendation is the defaults, unchanged")
  assert.deepEqual(joint.adopted, [])
  assert.deepEqual(joint.rejected, ["alpha", "beta"])
  assert.equal(joint.naive.kept, 6, "and the set that was never evaluated is reported anyway")
  assert.equal(joint.result.kept, 100)
})

test("jointGate adopts the subset that survives, in order of isolated gain", () => {
  const keys = [
    // beta has the larger isolated gain, so the greedy pass tries it first.
    axisStub("alpha", 1, [
      { value: 1, kept: 100, total: 100, auc: 0.8, rank1: 0.8 },
      { value: 5, kept: 90, total: 100, auc: 0.82, rank1: 0.81 },
    ]),
    axisStub("beta", 2, [
      { value: 2, kept: 100, total: 100, auc: 0.8, rank1: 0.8 },
      { value: 9, kept: 85, total: 100, auc: 0.9, rank1: 0.9 },
    ]),
  ]
  const joint = jointGate({
    keys,
    base: { alpha: 1, beta: 2 },
    total: 100,
    baseline: { auc: 0.8, rank1: 0.8, kept: 100 },
    withCutoffs: (cutoffs) => {
      if (cutoffs.beta === 9 && cutoffs.alpha === 5) return { auc: 0.5, rank1: 0.5, kept: 40 }
      if (cutoffs.beta === 9) return { auc: 0.9, rank1: 0.9, kept: 85 }
      if (cutoffs.alpha === 5) return { auc: 0.82, rank1: 0.81, kept: 90 }
      return { auc: 0.8, rank1: 0.8, kept: 100 }
    },
  })
  assert.deepEqual(joint.adopted, ["beta"], "the larger isolated gain is tried first and kept")
  assert.deepEqual(joint.rejected, ["alpha"], "the second one made the joint result worse")
  assert.equal(joint.cutoffs.beta, 9)
  assert.equal(joint.cutoffs.alpha, 1)
  assert.equal(joint.result.kept, 85, "and the reported result is the one that was measured")
})

test("jointGate does not report a cutoff equal to the default as a change", () => {
  // The sweep's own winner IS the shipped value: it beats the axis's wide-open
  // end, which is the default gate agreeing with itself, not a finding.
  const keys = [
    axisStub("alpha", 5, [
      { value: 0, kept: 100, total: 100, auc: 0.8, rank1: 0.8 },
      { value: 5, kept: 80, total: 100, auc: 0.9, rank1: 0.9 },
    ]),
  ]
  const joint = jointGate({
    keys,
    base: { alpha: 5 },
    total: 100,
    baseline: { auc: 0.9, rank1: 0.9, kept: 80 },
    withCutoffs: () => ({ auc: 0.9, rank1: 0.9, kept: 80 }),
  })
  assert.deepEqual(joint.adopted, [])
  assert.deepEqual(joint.rejected, [])
  assert.equal(joint.cutoffs.alpha, 5)
})

// ---------------------------------------------------------------------------
// The other two condensations
// ---------------------------------------------------------------------------

test("representativeSweep keeps the ends, the shipped cutoff and the recommendation", () => {
  const analysis = analyse(run())
  const rows = analysis.b.representative
  assert.ok(rows.length > 0)
  assert.ok(rows.length < analysis.b.points.length, "it is a condensation, not the whole sweep")
  if (analysis.b.best) assert.ok(rows.includes(analysis.b.best), "the recommendation is always on the page")
  const on = analysis.b.points.filter((p) => p.cannotLink)
  assert.ok(rows.includes(on[0]) && rows.includes(on[on.length - 1]), "both ends of the curve")
  // Order is the sweep's, not the picking order — otherwise the table reads as a
  // ranking it is not.
  assert.deepEqual(rows, analysis.b.points.filter((p) => rows.includes(p)))
})

test("representativeSweep degrades to nothing rather than throwing on an empty sweep", () => {
  assert.deepEqual(representativeSweep([], null), [])
})

test("raising the detector edge is priced from the run's own timings, not asserted to be free", () => {
  // Detector cost scales with PIXEL COUNT, so the edge ratio is squared: 2000
  // over 1280 is 2.44x the detect stage, and report E already knows what share
  // of the run detect was.
  const cost = resolutionCost(TIMING, 1280, 2000)
  assert.ok(cost)
  assert.ok(Math.abs(cost.pixelRatio - (2000 / 1280) ** 2) < 1e-9)
  assert.ok(Math.abs(cost.detectShare - 150 / 414) < 1e-9)
  assert.ok(cost.runRatio > 1, "a bigger detect edge is never free")
  assert.ok(Math.abs(cost.runRatio - (414 + 150 * ((2000 / 1280) ** 2 - 1)) / 414) < 1e-9)
  assert.equal(resolutionCost(null, 1280, 2000), null, "no timing means no price, not a free win")
})

test("the resolution recommendation states the cost beside the benefit", () => {
  const analysis = analyse(run())
  const rec = analysis.recommended.find((r) => r.path === "detect.longEdge")
  assert.ok(rec)
  // The fixture's resolution rows miss a face at the detect edge, so the report
  // wants the expensive resolution — which is exactly when the price matters.
  assert.equal(rec.value, "2000")
  assert.ok(rec.note.includes("x the detect"), `no pixel cost in: ${rec.note}`)
  assert.ok(rec.note.includes("x the run"), `no run cost in: ${rec.note}`)
})

test("renderHtml is self-contained: no network references at all", () => {
  const html = renderHtml(analyse(run()))
  assert.ok(html.startsWith("<!doctype html>"))
  assert.ok(html.includes("</html>"))
  for (const token of ["http://", "https://", "<script", "src=", "@import", "url("]) {
    assert.ok(!html.includes(token), `report.html must not contain ${token}`)
  }
  assert.ok(html.includes("<svg"), "the overlap plot is inline SVG")
  assert.ok(html.includes("Do not quote the same-minute stratum"))
})

test("the HTML report shows the joint gate beside both baselines, and hides the sixty rows", () => {
  const html = renderHtml(TRAP)
  const j = TRAP.d.joint
  /** @param {string} needle @returns {number} */
  const at = (needle) => {
    const i = html.indexOf(needle)
    assert.ok(i >= 0, `report.html is missing: ${needle}`)
    return i
  }
  at("recommended gate") // the measured recommendation is a row of its own
  at("every isolated winner, together") // so is the set that was never measured
  assert.ok(html.includes(`${j.result.kept}/${j.result.total}`))
  assert.ok(html.includes(`${j.naive.kept}/${j.naive.total}`))
  // Summary first, detail behind a disclosure — no restyling, just an ordering.
  assert.ok(at("Per check, swept alone") < at("The full sweep behind every row above"), "D's verdict table leads")
  assert.ok(at("The ends of the curve") < at(`All ${TRAP.b.points.length} swept points`), "B's short table leads")
  assert.ok(html.includes("Copy the numbers only"), "the fourth photograph rule is unchanged")
})

test("parseArgs takes the path as an argument and nothing else by default", () => {
  assert.deepEqual(parseArgs(["tmp/session1"]), {
    dir: "tmp/session1",
    oracle: null,
    html: true,
    out: null,
    verbose: false,
  })
  assert.equal(parseArgs(["d", "--oracle", "o.jsonl"]).oracle, "o.jsonl")
  assert.equal(parseArgs(["d", "--oracle=o.jsonl"]).oracle, "o.jsonl")
  assert.equal(parseArgs(["d", "--no-html"]).html, false)
  assert.equal(parseArgs(["d", "--out=x.html"]).out, "x.html")
  assert.equal(parseArgs(["d", "--verbose"]).verbose, true)
  assert.equal(parseArgs(["d", "-v"]).verbose, true)
  assert.throws(() => parseArgs(["d", "--nope"]))
  assert.throws(() => parseArgs(["a", "b"]))
  assert.equal(parseArgs([]).dir, null, "nothing searches for a run directory")
})
