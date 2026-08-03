/** @file The model-comparison scorer, against synthetic runs only.
 *
 *  Every fixture here is invented — hand-placed descriptors in a two- or
 *  three-dimensional space, with people and frames chosen to exercise one rule
 *  each. No real run, no real label file, and no figure derived from a
 *  photograph appears anywhere in this file or in what it asserts.
 *
 *  What is worth testing here is not "does it compute a number" but the four
 *  properties the decision rests on: the split never leaks a near-duplicate
 *  frame, the cap is what the rule says it is, the verdict defaults to no
 *  decision, and the whole thing is reproducible from face ids alone.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { computeDatasetId } from "../../scripts/vision/dataset-id.js"
import {
  assertComparable,
  buildM1Set,
  decide,
  loadVariant,
  parseArgs,
  pickBest,
  runCompare,
  scoreM1,
  splitPerson,
  spread,
} from "../../scripts/vision/compare-models.js"

/** @import * as Types from '../../scripts/vision/types.js' */

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "vision-compare-"))

// --- Fixtures ----------------------------------------------------------------

/**
 * A synthetic run directory. `people` maps a person key to that person's faces,
 * each face carrying its own photo, a frame link, and a descriptor.
 * @param {string} label
 * @param {Array<{ person: string, photoId: number, frameOf?: number, descriptor: number[] }>} faces
 * @param {{ pool?: string, mirror?: boolean }} [options]
 * @returns {string}
 */
function writeRun(label, faces, options = {}) {
  const dir = path.join(WORK, label)
  fs.mkdirSync(dir, { recursive: true })

  /** @type {Map<number, { id: number, sha256: string, nearDuplicateOf?: number }>} */
  const photos = new Map()
  faces.forEach((face) => {
    if (photos.has(face.photoId)) return
    const photo = { id: face.photoId, sha256: `sha-${face.photoId}` }
    if (face.frameOf !== undefined) {
      // The report's frameRoots unions photos through this link, which is what
      // makes a "frame group" more than one photograph.
      Object.assign(photo, { nearDuplicateOf: face.frameOf })
    }
    photos.set(face.photoId, photo)
  })

  const faceRecords = faces.map((face, id) => ({
    id,
    photoId: face.photoId,
    crop: `crops/${String(id).padStart(6, "0")}.png`,
    score: 0.9,
    box: { x: 10 * id, y: 0, w: 100, h: 100 },
    landmarks: [10, 10, 20, 10, 15, 15, 10, 20, 20, 20],
    signals: {
      score: 0.9,
      boxPx: 100,
      borderPx: 30,
      eyeRatio: 0.35,
      eyeAngle: 0.01,
      alignScale: 0.8,
      residual: 1.2,
      outsideFraction: 0,
      sharpness: 0.02,
    },
    descriptor: face.descriptor,
  }))

  fs.writeFileSync(
    path.join(dir, "faces.jsonl"),
    faceRecords.map((f) => JSON.stringify(f)).join("\n") + "\n",
  )
  fs.writeFileSync(
    path.join(dir, "photos.jsonl"),
    [...photos.values()].map((p) => JSON.stringify(p)).join("\n") + "\n",
  )

  /** @type {Record<string, string>} */
  const labels = {}
  /** @type {Record<string, string>} */
  const pool = {}
  faces.forEach((face, id) => {
    labels[String(id)] = face.person
    pool[String(id)] = options.pool ?? "A"
  })
  // A real datasetId, not a placeholder: loadRun refuses a labels file whose
  // fingerprint does not match the faces, and that refusal is load-bearing —
  // face ids are not stable across runs.
  fs.writeFileSync(
    path.join(dir, "labels.json"),
    JSON.stringify({ datasetId: computeDatasetId(faceRecords), labels, pool }),
  )
  fs.writeFileSync(
    path.join(dir, "timing.json"),
    JSON.stringify({
      photos: photos.size,
      faces: faces.length,
      stages: {},
      environment: { node: "fixture" },
      config: { mirrorTta: options.mirror === true },
      describeProvenance: { embedderSha256: `digest-${label}` },
    }),
  )
  return dir
}

/**
 * Two people, four faces each, in a plane. `separation` scales how far apart
 * the two clusters sit, so a "better" model is literally a wider one.
 * @param {number} separation
 * @param {number} [jitter] how far a person's own faces spread
 * @returns {Array<{ person: string, photoId: number, frameOf?: number, descriptor: number[] }>}
 */
function twoPeople(separation, jitter = 0.05) {
  /** @type {Array<{ person: string, photoId: number, frameOf?: number, descriptor: number[] }>} */
  const out = []
  const people = ["p1", "p2"]
  people.forEach((person, pi) => {
    for (let i = 0; i < 4; i++) {
      const angle = pi * separation + i * jitter
      out.push({
        person,
        photoId: pi * 4 + i,
        descriptor: [Math.cos(angle), Math.sin(angle)],
      })
    }
  })
  return out
}

// --- The split ---------------------------------------------------------------

test("a person whose faces are all one frame group is not splittable", () => {
  // Three faces, one frame. There is no query side that is not also the
  // prototype side, so the person contributes nothing rather than contributing
  // a query answered by a near-identical photograph.
  const split = splitPerson([
    { row: 0, faceId: 0, frame: 7 },
    { row: 1, faceId: 1, frame: 7 },
    { row: 2, faceId: 2, frame: 7 },
  ])
  assert.deepEqual(split, { prototype: [], query: [] })
})

test("near-duplicate frames never straddle the split", () => {
  const faces = [
    { row: 0, faceId: 0, frame: 1 },
    { row: 1, faceId: 1, frame: 1 },
    { row: 2, faceId: 2, frame: 2 },
    { row: 3, faceId: 3, frame: 2 },
  ]
  const split = splitPerson(faces)
  const sideOf = new Map()
  for (const row of split.prototype) sideOf.set(row, "prototype")
  for (const row of split.query) sideOf.set(row, "query")

  for (const frame of [1, 2]) {
    const sides = new Set(faces.filter((f) => f.frame === frame).map((f) => sideOf.get(f.row)))
    assert.equal(sides.size, 1, `frame ${frame} landed on both sides of the split`)
  }
})

test("the split is balanced and depends only on face ids", () => {
  const faces = [
    { row: 0, faceId: 10, frame: 1 },
    { row: 1, faceId: 11, frame: 1 },
    { row: 2, faceId: 12, frame: 1 },
    { row: 3, faceId: 20, frame: 2 },
    { row: 4, faceId: 30, frame: 3 },
  ]
  const split = splitPerson(faces)
  assert.equal(split.prototype.length + split.query.length, 5)
  // Largest group first onto the emptier side: 3 to prototype, then 1 and 1 to
  // query. Not 4/1, which a naive alternate-by-index would give.
  assert.equal(split.prototype.length, 3)
  assert.equal(split.query.length, 2)

  // Same faces, presented in a different order — the split must not move.
  const shuffled = [faces[4], faces[1], faces[3], faces[0], faces[2]]
  const again = splitPerson(shuffled)
  assert.deepEqual(new Set(again.query), new Set(split.query))
})

// --- The cap -----------------------------------------------------------------

test("no person contributes more than the cap, and the kept ones are the lowest face ids", () => {
  // One person with ten frames, so the query side is far larger than the cap.
  const dir = writeRun(
    "cap",
    Array.from({ length: 10 }, (_, i) => ({
      person: "p1",
      photoId: i,
      descriptor: [Math.cos(i * 0.01), Math.sin(i * 0.01)],
    })),
  )
  const variant = loadVariant(dir, "A")
  const m1 = buildM1Set(variant.view, 3)

  assert.equal(m1.queries.length, 3, "the cap is the cap")
  const ids = m1.queries.map((q) => q.faceId)
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "kept by ascending face id, per the rule")
})

test("the query set is identical across variants, because it depends only on ids and frames", () => {
  const faces = twoPeople(1.2)
  const a = loadVariant(writeRun("same-a", faces), "A")
  // Same faces and frames, different descriptors entirely.
  const b = loadVariant(
    writeRun(
      "same-b",
      faces.map((f) => ({ ...f, descriptor: [f.descriptor[1], -f.descriptor[0]] })),
    ),
    "A",
  )
  assertComparable([a, b])

  const fromA = buildM1Set(a.view, 4).queries.map((q) => q.faceId)
  const fromB = buildM1Set(b.view, 4).queries.map((q) => q.faceId)
  assert.deepEqual(fromA, fromB)
})

// --- Comparability -----------------------------------------------------------

test("differing labels between two directories is refused, not averaged over", () => {
  const faces = twoPeople(1.2)
  const a = loadVariant(writeRun("labels-a", faces), "A")
  const b = loadVariant(
    writeRun(
      "labels-b",
      faces.map((f, i) => (i === 0 ? { ...f, person: "someone-else" } : f)),
    ),
    "A",
  )
  assert.throws(() => assertComparable([a, b]), /label on face/)
})

test("a 512-d challenger against a 128-d incumbent is fine — that is the point", () => {
  const faces = twoPeople(1.2)
  const a = loadVariant(writeRun("dim-a", faces), "A")
  const b = loadVariant(
    writeRun(
      "dim-b",
      faces.map((f) => ({ ...f, descriptor: [...f.descriptor, 0, 0] })),
    ),
    "A",
  )
  assert.doesNotThrow(() => assertComparable([a, b]))
})

// --- Scoring -----------------------------------------------------------------

test("a model that separates two people scores M1 perfectly; one that collapses them does not", () => {
  const good = loadVariant(writeRun("m1-good", twoPeople(1.4)), "A")
  // Both people on top of each other: the nearest prototype is a coin toss.
  const bad = loadVariant(writeRun("m1-bad", twoPeople(0.0)), "A")
  assertComparable([good, bad])

  const m1 = buildM1Set(good.view, 4)
  assert.ok(m1.queries.length > 0, "the fixture must actually produce queries")

  const goodScore = scoreM1(good.view, m1)
  const badScore = scoreM1(bad.view, m1)
  assert.equal(goodScore.correct, goodScore.total)
  assert.ok(badScore.correct < goodScore.correct)
})

test("prototypes come from the whole cast, so a query can be lost to another person", () => {
  const variant = loadVariant(writeRun("cast", twoPeople(0.0)), "A")
  const m1 = buildM1Set(variant.view, 4)
  const score = scoreM1(variant.view, m1)
  // Two identical clusters: at least one query must have gone to the wrong
  // person. If prototypes were built per person, everything would be "correct"
  // and the metric would be measuring nothing.
  assert.ok(score.correct < score.total)
})

// --- The verdict -------------------------------------------------------------

/**
 * @param {number} m1Correct
 * @param {number} purity
 * @param {number[]} folds which fold indices this model actually scored
 * @param {Map<string, { correct: number, total: number }>} [perPerson]
 * @param {boolean[]} [weldFreeAvailable] per fold; diagnostic only, defaults true
 * @returns {Types.VariantResult}
 */
function result(m1Correct, purity, folds, perPerson = new Map(), weldFreeAvailable = []) {
  return {
    variant: /** @type {Types.CompareVariant} */ (
      /** @type {unknown} */ ({ dir: "fixture", mirror: false })
    ),
    m1: { correct: m1Correct, total: 20, perPerson },
    m2: {
      purity,
      labelledFaces: 40,
      perFold: folds.map((fold, i) => ({
        fold,
        cutoff: 0.5,
        faces: 8,
        weldedGroups: 0,
        weldFreeAvailable: weldFreeAvailable[i] ?? true,
      })),
    },
  }
}

/** @param {Array<[string, number]>} pairs */
const people = (pairs) => new Map(pairs.map(([k, c]) => [k, { correct: c, total: 4 }]))

test("a margin under the predeclared one is no decision, not a narrow win", () => {
  const incumbent = result(10, 0.9, [0, 1], people([["a", 3], ["b", 3]]))
  const challenger = result(12, 0.95, [0, 1], people([["a", 4], ["b", 4]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.adopt, false)
  assert.equal(verdict.outcome, "no-decision-keep-incumbent")
  assert.ok(verdict.reasons.some((r) => r.includes("M1 margin 2")))
})

test("a face-count win carried by one person fails the spread condition", () => {
  // +5 faces overall, comfortably past the margin — but it comes from a single
  // person while the challenger is behind on three others. That is the shape
  // the spread condition exists to catch.
  const incumbent = result(10, 0.9, [0, 1], people([["a", 0], ["b", 4], ["c", 3], ["d", 3]]))
  const challenger = result(15, 0.9, [0, 1], people([["a", 4], ["b", 3], ["c", 2], ["d", 2]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.adopt, false)
  assert.ok(verdict.reasons.some((r) => r.includes("M1-spread")))
  assert.equal(verdict.m1Spread.ahead, 1)
  assert.equal(verdict.m1Spread.behind, 3)
})

test("welding is diagnostic, not a gate: a challenger that finds weld-free points is not declined for it", () => {
  // The rule as first written declined here — the two cutoffs would have come
  // from different objectives. `deriveCutoff` now uses one objective always, so
  // the weld diagnostics differing between the models says nothing about
  // comparability and must not reach the verdict.
  const cast = people([["a", 2], ["b", 2], ["c", 2]])
  const better = people([["a", 4], ["b", 4], ["c", 4]])
  const incumbent = result(10, 0.90, [0, 1], cast, [false, false])
  const challenger = result(14, 0.95, [0, 1], better, [true, true])
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.foldsAlign, true)
  assert.equal(verdict.adopt, true, "the challenger separated better; that is not a reason to decline it")
  assert.deepEqual(verdict.reasons, [])
})

test("two models that scored different folds make M2 no decision", () => {
  // Equal LENGTHS, different folds — the case a positional comparison passes
  // and a purity pooled over different faces should not. Fold 2 vs fold 3 means
  // the two purities are over different people entirely.
  const incumbent = result(10, 0.90, [0, 1, 2], people([["a", 2], ["b", 2], ["c", 2]]))
  const challenger = result(14, 0.99, [0, 1, 3], people([["a", 4], ["b", 4], ["c", 4]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.foldsAlign, false)
  assert.equal(verdict.adopt, false, "M1 and the spread both pass; the fold mismatch still declines")
  assert.ok(verdict.reasons.some((r) => r.includes("different folds")))
})

test("a model that skipped a fold is not silently compared against one that did not", () => {
  const incumbent = result(10, 0.90, [0, 1, 2], people([["a", 2], ["b", 2], ["c", 2]]))
  const challenger = result(14, 0.99, [0, 2], people([["a", 4], ["b", 4], ["c", 4]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.foldsAlign, false)
  assert.equal(verdict.adopt, false)
})

test("no fold scored at all is no decision, not a purity comparison of two NaNs", () => {
  const incumbent = result(10, NaN, [], people([["a", 2]]))
  const challenger = result(14, NaN, [], people([["a", 4]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.foldsAlign, true)
  assert.equal(verdict.adopt, false)
  assert.ok(verdict.reasons.some((r) => r.includes("no fold could be scored")))
})

test("the same folds scored by both models is a like-for-like gate", () => {
  const incumbent = result(10, 0.90, [0, 1], people([["a", 2], ["b", 2], ["c", 2]]))
  const challenger = result(14, 0.95, [0, 1], people([["a", 4], ["b", 4], ["c", 4]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.foldsAlign, true)
  assert.equal(verdict.adopt, true)
})

test("worse purity blocks adoption even when M1 and the spread both pass", () => {
  const incumbent = result(10, 0.95, [0, 1], people([["a", 2], ["b", 2], ["c", 2]]))
  const challenger = result(14, 0.80, [0, 1], people([["a", 4], ["b", 4], ["c", 4]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.adopt, false)
  assert.ok(verdict.reasons.some((r) => r.includes("purity")))
})

test("every condition passing adopts the challenger", () => {
  const incumbent = result(10, 0.90, [0, 1], people([["a", 2], ["b", 2], ["c", 2]]))
  const challenger = result(14, 0.92, [0, 1], people([["a", 4], ["b", 4], ["c", 4]]))
  const verdict = decide(incumbent, challenger, 3)
  assert.equal(verdict.adopt, true)
  assert.equal(verdict.outcome, "adopt-challenger")
  assert.deepEqual(verdict.reasons, [])
})

test("a tie between a model's own variants goes to mirror-off", () => {
  const off = result(12, 0.9, [0])
  const on = result(12, 0.9, [0])
  on.variant = /** @type {Types.CompareVariant} */ (
    /** @type {unknown} */ ({ dir: "mirror-on", mirror: true })
  )
  assert.equal(pickBest([on, off]).variant.mirror, false)
  assert.equal(pickBest([off, on]).variant.mirror, false)
})

test("spread counts people, not faces", () => {
  const s = spread(
    { correct: 6, total: 12, perPerson: people([["a", 4], ["b", 1], ["c", 1]]) },
    { correct: 6, total: 12, perPerson: people([["a", 0], ["b", 3], ["c", 3]]) },
  )
  assert.deepEqual(s, { ahead: 2, behind: 1, level: 0 })
})

// --- Arguments ---------------------------------------------------------------

test("a --json destination outside tmp/ is refused", () => {
  const bad = parseArgs(["--incumbent", "a", "--challenger", "b", "--json", "docs/results.json"])
  assert.equal(bad.valid, false)
  assert.ok(bad.valid === false && bad.error.includes("rule 3"))

  const ok = parseArgs(["--incumbent", "a", "--challenger", "b", "--json", "tmp/results.json"])
  assert.equal(ok.valid, true)
})

test("both sides are required — a comparison needs something to compare", () => {
  assert.equal(parseArgs(["--incumbent", "a"]).valid, false)
  assert.equal(parseArgs(["--challenger", "b"]).valid, false)
})

test("variants are repeatable and the rule's defaults are the defaults", () => {
  const parsed = parseArgs([
    "--incumbent", "a", "--incumbent", "b",
    "--challenger", "c", "--challenger", "d",
  ])
  assert.ok(parsed.valid)
  if (!parsed.valid) return
  assert.deepEqual(parsed.value.incumbent, ["a", "b"])
  assert.deepEqual(parsed.value.challenger, ["c", "d"])
  assert.equal(parsed.value.cap, 4)
  assert.equal(parsed.value.margin, 3)
  assert.equal(parsed.value.folds, 5)
  assert.equal(parsed.value.pool, "A")
})

// --- End to end --------------------------------------------------------------

test("the whole comparison runs and reproduces itself exactly", () => {
  const incumbentDir = writeRun("e2e-inc", twoPeople(0.35))
  const challengerDir = writeRun("e2e-cha", twoPeople(1.5))

  /** @type {string[]} */
  const lines = []
  const args = parseArgs([
    "--incumbent", incumbentDir,
    "--challenger", challengerDir,
    "--folds", "2",
  ])
  assert.ok(args.valid)
  if (!args.valid) return

  const first = runCompare(args.value, { log: (line) => lines.push(line) })
  const second = runCompare(args.value, { log: () => {} })

  assert.equal(first.verdict.outcome, second.verdict.outcome)
  assert.equal(first.m1Set.queries.length, second.m1Set.queries.length)
  assert.deepEqual(
    first.m1Set.queries.map((q) => q.faceId),
    second.m1Set.queries.map((q) => q.faceId),
  )
  assert.equal(first.bestChallenger.m1.correct, second.bestChallenger.m1.correct)
  assert.ok(lines.some((l) => l.startsWith("VERDICT:")))
})

test.after(() => fs.rmSync(WORK, { recursive: true, force: true }))
