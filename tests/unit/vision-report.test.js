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
  loadRun,
  parseArgs,
  pickHeadline,
  renderHtml,
  reportA,
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
 * @param {ReturnType<typeof buildView>} view
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

/** @returns {ReturnType<typeof buildView>} */
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

  /** @type {Array<{ cutoff: number, cannotLink: boolean, quality: V.GroupingReport }>} */
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

test("parseArgs takes the path as an argument and nothing else by default", () => {
  assert.deepEqual(parseArgs(["tmp/session1"]), { dir: "tmp/session1", oracle: null, html: true, out: null })
  assert.equal(parseArgs(["d", "--oracle", "o.jsonl"]).oracle, "o.jsonl")
  assert.equal(parseArgs(["d", "--oracle=o.jsonl"]).oracle, "o.jsonl")
  assert.equal(parseArgs(["d", "--no-html"]).html, false)
  assert.equal(parseArgs(["d", "--out=x.html"]).out, "x.html")
  assert.throws(() => parseArgs(["d", "--nope"]))
  assert.throws(() => parseArgs(["a", "b"]))
  assert.equal(parseArgs([]).dir, null, "nothing searches for a run directory")
})
