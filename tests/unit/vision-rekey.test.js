/** @file Unit test: rekey-labels.js — carrying a labelling across detection runs.
 *
 *  Everything here is synthetic: invented photographs (a sha256 string and a
 *  box, never pixels), invented labels, invented names ("Alpha", "Beta").
 *  No run directory under tmp/ is ever read; the CLI test writes its own
 *  fixture run into a mkdtemp directory and deletes it.
 *
 *  What matters, from the plan's Phase 1:
 *   - the photograph join refuses duplicate hashes (D7 one layer up),
 *   - the box match is mutual-best plus a margin and order-independent,
 *   - all four outputs share ONE fresh person-key remap (D4),
 *   - exclusions convert group-keyed → face-keyed and group ids never
 *     survive into any output (D5),
 *   - pool membership is carried explicitly (D6),
 *   - the outputs are stamped with the TARGET run's datasetId.
 */

/** @import * as Types from '../../scripts/vision/types.js' */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { computeDatasetId } from "../../scripts/vision/dataset-id.js"
import {
  MATCH_IOU_FLOOR,
  MATCH_IOU_MARGIN,
  indexPhotosBySha,
  matchRuns,
  parseArgs,
  rekeyLabels,
  runRekey,
} from "../../scripts/vision/rekey-labels.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A minimal but fully-typed Session1PhotoRecord. Only `id` and `sha256` are
 * read by anything under test; the rest satisfies the real type.
 * @param {number} id
 * @param {string} sha
 * @returns {Types.Session1PhotoRecord}
 */
function photo(id, sha) {
  return {
    id,
    relative: `fixture-${id}.jpg`,
    sha256: sha,
    aHash: "0",
    width: 4000,
    height: 3000,
    capturedAtMs: null,
    mtimeMs: 0,
    faces: 0,
    exactDuplicateOf: null,
    nearDuplicateOf: null,
    ms: { decode: 0, downsample: 0, detect: 0, align: 0, describe: 0 },
  }
}

/**
 * A minimal but fully-typed Session1FaceRecord. Only `id`, `photoId` and
 * `box` are read by anything under test here.
 * @param {number} id
 * @param {number} photoId
 * @param {{ x: number, y: number, w: number, h: number }} box
 * @returns {Types.Session1FaceRecord}
 */
function face(id, photoId, box) {
  return {
    id,
    photoId,
    crop: `crops/${String(id).padStart(6, "0")}.png`,
    score: 0.9,
    box,
    landmarks: [10, 10, 20, 10, 15, 15, 10, 20, 20, 20],
    signals: {
      score: 0.9,
      boxPx: box.w,
      borderPx: 30,
      eyeRatio: 0.35,
      eyeAngle: 0.01,
      alignScale: 0.8,
      residual: 1.2,
      outsideFraction: 0,
      sharpness: 0.02,
    },
    descriptor: [1, 0],
  }
}

/** @param {number} x @param {number} [y] @returns {{ x: number, y: number, w: number, h: number }} */
function box(x, y = 0) {
  return { x, y, w: 100, h: 100 }
}

// ---------------------------------------------------------------------------
// The photograph join (D7)
// ---------------------------------------------------------------------------

test("indexPhotosBySha refuses a duplicate content hash, naming the side", () => {
  const photos = [photo(0, "aaa"), photo(1, "bbb"), photo(2, "aaa")]
  assert.throws(() => indexPhotosBySha(photos, "--from"), /--from.*ambiguous/s)
})

test("matchRuns aborts when either run holds two photographs with one hash", () => {
  const clean = { photos: [photo(0, "aaa")], faces: [face(0, 0, box(0))] }
  const doubled = { photos: [photo(0, "aaa"), photo(1, "aaa")], faces: [face(0, 0, box(0))] }
  assert.throws(() => matchRuns(doubled, clean), /--from/)
  assert.throws(() => matchRuns(clean, doubled), /--to/)
})

// ---------------------------------------------------------------------------
// Box matching
// ---------------------------------------------------------------------------

test("a clean shift matches every face to its counterpart", () => {
  const source = {
    photos: [photo(0, "aaa")],
    faces: [face(0, 0, box(0)), face(1, 0, box(200))],
  }
  const target = {
    photos: [photo(7, "aaa")],
    faces: [face(50, 7, box(5)), face(51, 7, box(205))],
  }
  const result = matchRuns(source, target)
  assert.deepEqual([...result.map.entries()], [[0, 50], [1, 51]])
  assert.deepEqual(result.unmatched, { photoMissing: 0, noCandidate: 0, belowFloor: 0, notMutual: 0, marginTooSmall: 0 })
  assert.equal(result.photosJoined, 1)
})

test("a crowded row of adjacent faces still matches one-to-one", () => {
  // Six boxes at 105px spacing (they nearly touch), the whole row drifted
  // 10px in the target: every true pair overlaps at ~0.82, every neighbour
  // pair at ~0.03 — mutual best with a wide margin, for all six at once.
  const n = 6
  const source = {
    photos: [photo(0, "row")],
    faces: Array.from({ length: n }, (_v, i) => face(i, 0, box(i * 105))),
  }
  const target = {
    photos: [photo(3, "row")],
    faces: Array.from({ length: n }, (_v, i) => face(100 + i, 3, box(i * 105 + 10))),
  }
  const result = matchRuns(source, target)
  assert.equal(result.map.size, n)
  for (let i = 0; i < n; i++) assert.equal(result.map.get(i), 100 + i)
})

test("an ambiguous pair — two targets nearly tied — is rejected, not guessed", () => {
  // Both targets overlap the source at ~0.95, a gap of ~0.01: far above the
  // floor, far inside the margin. Accepting either would be a coin flip.
  const source = { photos: [photo(0, "aaa")], faces: [face(0, 0, box(0))] }
  const target = {
    photos: [photo(1, "aaa")],
    faces: [
      face(10, 1, { x: 0, y: 0, w: 100, h: 104 }),
      face(11, 1, { x: 0, y: -5, w: 100, h: 105 }),
    ],
  }
  const result = matchRuns(source, target)
  assert.equal(result.map.size, 0)
  assert.equal(result.unmatched.marginTooSmall, 1)
})

test("two sources tied over one target both fail, symmetrically", () => {
  const source = {
    photos: [photo(0, "aaa")],
    faces: [face(0, 0, { x: 0, y: 0, w: 100, h: 104 }), face(1, 0, { x: 0, y: -5, w: 100, h: 105 })],
  }
  const target = { photos: [photo(1, "aaa")], faces: [face(10, 1, box(0))] }
  const result = matchRuns(source, target)
  assert.equal(result.map.size, 0)
  // One of the pair is the target's (non-mutual) runner-up story, the other
  // fails the margin — between them, neither is accepted.
  assert.equal(result.unmatched.notMutual + result.unmatched.marginTooSmall, 2)
})

test("a face whose best target belongs to somebody else is notMutual", () => {
  const source = {
    photos: [photo(0, "aaa")],
    faces: [face(0, 0, box(2)), face(1, 0, box(30))],
  }
  // One target. face 0 overlaps it at ~0.96 and wins; face 1 overlaps at
  // ~0.54 (above the floor) but the target's best is face 0.
  const target = { photos: [photo(1, "aaa")], faces: [face(10, 1, box(0))] }
  const result = matchRuns(source, target)
  assert.deepEqual([...result.map.entries()], [[0, 10]])
  assert.equal(result.unmatched.notMutual, 1)
})

test("photograph absent, no candidate box, and below-floor are counted apart", () => {
  const source = {
    photos: [photo(0, "gone"), photo(1, "empty"), photo(2, "far")],
    faces: [face(0, 0, box(0)), face(1, 1, box(0)), face(2, 2, box(0))],
  }
  const target = {
    photos: [photo(5, "empty"), photo(6, "far")],
    faces: [face(50, 6, box(900))],
  }
  const result = matchRuns(source, target)
  assert.equal(result.map.size, 0)
  assert.equal(result.unmatched.photoMissing, 1)
  assert.equal(result.unmatched.noCandidate, 1)
  assert.equal(result.unmatched.belowFloor, 1)
  assert.equal(result.photosSourceOnly, 1)
})

test("the match is independent of input order", () => {
  const sourceFaces = [face(0, 0, box(0)), face(1, 0, box(105)), face(2, 0, box(210))]
  const targetFaces = [face(20, 9, box(8)), face(21, 9, box(113)), face(22, 9, box(218))]
  const forward = matchRuns(
    { photos: [photo(0, "aaa")], faces: sourceFaces },
    { photos: [photo(9, "aaa")], faces: targetFaces },
  )
  const reversed = matchRuns(
    { photos: [photo(0, "aaa")], faces: [...sourceFaces].reverse() },
    { photos: [photo(9, "aaa")], faces: [...targetFaces].reverse() },
  )
  assert.deepEqual([...forward.map.entries()].sort((a, b) => a[0] - b[0]), [...reversed.map.entries()].sort((a, b) => a[0] - b[0]))
  assert.deepEqual(forward.unmatched, reversed.unmatched)
})

test("the floor sits under the margin, so both constants stay meaningful", () => {
  // If the margin ever grew past the floor, a lone candidate at the floor
  // would still pass while a well-separated pair could not — the two
  // constants would be fighting. Assert the intended ordering.
  assert.ok(MATCH_IOU_MARGIN < MATCH_IOU_FLOOR)
  assert.ok(MATCH_IOU_FLOOR > 0 && MATCH_IOU_FLOOR < 1)
})

// ---------------------------------------------------------------------------
// The rewrite (D4/D5/D6, datasetId stamping)
// ---------------------------------------------------------------------------

/**
 * A source run with two photographs and six faces:
 *   f0 photo0 "p7" pool A          → t100
 *   f1 photo0 "p2" pool A          → t101
 *   f2 photo1 "p7" pool B group 3  → t102
 *   f3 photo1 "x"  pool B          → t103
 *   f4 photo1 (excluded from group 3, unlabelled) pool B → t104
 *   f5 photo1 (skipped) pool B     → t105
 * The target run has the same photographs under different photo ids, every
 * box drifted 5px, and fresh face ids 100–105.
 */
function fixture() {
  const source = {
    photos: [photo(0, "sha-one"), photo(1, "sha-two")],
    faces: [
      face(0, 0, box(0)),
      face(1, 0, box(200)),
      face(2, 1, box(0)),
      face(3, 1, box(200)),
      face(4, 1, box(400)),
      face(5, 1, box(600)),
    ],
  }
  const target = {
    photos: [photo(5, "sha-one"), photo(9, "sha-two")],
    faces: [
      face(100, 5, box(5)),
      face(101, 5, box(205)),
      face(102, 9, box(5)),
      face(103, 9, box(205)),
      face(104, 9, box(405)),
      face(105, 9, box(605)),
    ],
  }
  /** @type {Types.Session1LabelFile} */
  const labels = {
    version: 2,
    datasetId: computeDatasetId(source.faces),
    labels: { 0: "p7", 1: "p2", 2: "p7", 3: "x" },
    pool: { 0: "A", 1: "A", 2: "B", 3: "B", 4: "B", 5: "B" },
    group: { 0: null, 1: null, 2: 3, 3: null, 4: 3, 5: null },
    skipped: [5],
    excluded: { 3: [4] },
  }
  /** @type {Types.Session1IdentitiesFile} */
  const identities = {
    version: 1,
    datasetId: computeDatasetId(source.faces),
    identities: {
      p7: { guestId: null, name: "Alpha" },
      p2: { guestId: 4, name: "Beta" },
    },
  }
  return { source, target, labels, identities }
}

test("the full carry: one remap across labels, identities and exclusions", () => {
  const { source, target, labels, identities } = fixture()
  const result = rekeyLabels(source, target, labels, identities)
  const targetDatasetId = computeDatasetId(target.faces)

  // labels.json: target numbering, fresh keys allocated p1, p2 in ascending
  // source-face order — nothing of the scrambled input keys survives.
  assert.equal(result.labels.version, 2)
  assert.equal(result.labels.datasetId, targetDatasetId)
  assert.deepEqual(result.labels.labels, { 100: "p1", 101: "p2", 102: "p1", 103: "x" })

  // D6: the pool map is re-keyed and present (session1-report reads it from
  // labels.json; missing means everything is silently "pool A").
  assert.deepEqual(result.labels.pool, { 100: "A", 101: "A", 102: "B", 103: "B", 104: "B", 105: "B" })

  // D5: nothing group-keyed survives into the labels file.
  assert.equal(result.labels.group, undefined)
  assert.equal(result.labels.excluded, undefined)
  assert.deepEqual(result.labels.skipped, [105])

  // identities.json: the SAME remap, so "Alpha" stays attached to the same
  // faces the source file attached it to.
  assert.ok(result.identities)
  assert.equal(result.identities.datasetId, targetDatasetId)
  assert.deepEqual(result.identities.identities, {
    p1: { guestId: null, name: "Alpha" },
    p2: { guestId: 4, name: "Beta" },
  })

  // poolA.json: explicit carry of the individually-judged sample.
  assert.deepEqual(result.poolA, { version: 1, datasetId: targetDatasetId, faceIds: [100, 101] })

  // exclusions.json: group 3's exclusion of f4 becomes a per-face record
  // against group 3's person ("p7" → fresh "p1"), in target numbering.
  assert.deepEqual(result.exclusions, {
    version: 1,
    datasetId: targetDatasetId,
    exclusions: [{ faceId: 104, notPerson: "p1" }],
  })

  assert.equal(result.counts.facesMatched, 6)
  assert.equal(result.counts.labelsCarried, 4)
  assert.equal(result.counts.personsCarried, 2)
  assert.equal(result.counts.personsLost, 0)
  assert.equal(result.counts.namesCarried, 2)
  assert.equal(result.counts.poolACarried, 2)
  assert.equal(result.counts.skippedCarried, 1)
  assert.equal(result.counts.exclusionsConverted, 1)
})

test("a photograph missing from the target loses its labels, and a person who loses every face loses their name and exclusions", () => {
  const { source, target, labels, identities } = fixture()
  // Drop the second photograph from the target run entirely: f2..f5 cannot
  // match. Person p7 still survives through f0 on the first photograph, so
  // instead ALSO relabel f0 to p2 — now p7's every face is gone.
  const cutTarget = {
    photos: [target.photos[0]],
    faces: target.faces.filter((f) => f.photoId === 5),
  }
  /** @type {Types.Session1LabelFile} */
  const cutLabels = { ...labels, labels: { 0: "p2", 1: "p2", 2: "p7", 3: "x" } }
  const result = rekeyLabels(source, cutTarget, cutLabels, identities)

  assert.equal(result.counts.unmatched.photoMissing, 4)
  assert.deepEqual(result.labels.labels, { 100: "p1", 101: "p1" })
  assert.equal(result.counts.personsCarried, 1)
  assert.equal(result.counts.personsLost, 1)
  // p7's name is dropped WITH the person — never re-attached to anybody else.
  assert.ok(result.identities)
  assert.deepEqual(result.identities.identities, { p1: { guestId: 4, name: "Beta" } })
  assert.equal(result.counts.namesDropped, 1)
  // The exclusion pointed at p7's group; with p7 gone there is nothing safe
  // to attach it to.
  assert.deepEqual(result.exclusions.exclusions, [])
  assert.equal(result.counts.exclusionsDroppedNoPerson, 1)
  assert.equal(result.counts.poolACarried, 2)
  assert.equal(result.counts.poolALost, 0)
  assert.equal(result.counts.skippedLost, 1)
})

test("an exclusion whose group names two persons is dropped, counted", () => {
  const { source, target, labels, identities } = fixture()
  // Put f3 into group 3 as well and label it a second person: the group's
  // surviving members now name p7 AND p2, so "not that person" has no single
  // referent.
  /** @type {Types.Session1LabelFile} */
  const twoPersonGroup = {
    ...labels,
    labels: { 0: "p7", 1: "p2", 2: "p7", 3: "p2" },
    group: { 0: null, 1: null, 2: 3, 3: 3, 4: 3, 5: null },
  }
  const result = rekeyLabels(source, target, twoPersonGroup, identities)
  assert.equal(result.counts.exclusionsConverted, 0)
  assert.equal(result.counts.exclusionsDroppedNoPerson, 1)
  assert.deepEqual(result.exclusions.exclusions, [])
})

test("an excluded face that fails the box match is dropped, counted", () => {
  const { source, target, labels, identities } = fixture()
  // Push the target's counterpart of f4 (the excluded face) out of reach.
  const moved = {
    photos: target.photos,
    faces: target.faces.map((f) => (f.id === 104 ? face(104, 9, box(900)) : f)),
  }
  const result = rekeyLabels(source, moved, labels, identities)
  assert.equal(result.counts.exclusionsConverted, 0)
  assert.equal(result.counts.exclusionsDroppedUnmatched, 1)
})

test("refuses a labels file whose datasetId does not hash from the source run", () => {
  const { source, target, labels, identities } = fixture()
  /** @type {Types.Session1LabelFile} */
  const wrong = { ...labels, datasetId: "0123456789abcdef" }
  assert.throws(() => rekeyLabels(source, target, wrong, identities), /different run/)
})

test("refuses an identities file from a different export of the same run (D4)", () => {
  const { source, target, labels, identities } = fixture()
  // Same datasetId — both exports are of the same run, so the id cannot tell
  // them apart. The foreign person key can: buildExport only writes identity
  // entries for keys the paired labels.json uses.
  /** @type {Types.Session1IdentitiesFile} */
  const otherExport = {
    ...identities,
    identities: { p9: { guestId: null, name: "Gamma" } },
  }
  assert.throws(() => rekeyLabels(source, target, labels, otherExport), /different exports/)
})

test("refuses an identities file whose datasetId disagrees with the labels file", () => {
  const { source, target, labels, identities } = fixture()
  /** @type {Types.Session1IdentitiesFile} */
  const wrong = { ...identities, datasetId: "fedcba9876543210" }
  assert.throws(() => rekeyLabels(source, target, labels, wrong), /different datasetIds/)
})

test("refuses a labels file with no pool map (D6)", () => {
  const { source, target, labels, identities } = fixture()
  /** @type {Types.Session1LabelFile} */
  const noPool = { ...labels, pool: {} }
  assert.throws(() => rekeyLabels(source, target, noPool, identities), /pool/)
})

test("carries without an identities file, and says so with a null", () => {
  const { source, target, labels } = fixture()
  const result = rekeyLabels(source, target, labels, null)
  assert.equal(result.identities, null)
  assert.equal(result.counts.namesCarried, 0)
  assert.deepEqual(result.labels.labels, { 100: "p1", 101: "p2", 102: "p1", 103: "x" })
})

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test("parseArgs: required flags, unknown flags, --help", () => {
  const ok = parseArgs(["--from", "a", "--to", "b", "--labels", "l.json", "--identities", "i.json", "--out-dir", "o"])
  assert.ok(ok.valid)
  assert.equal(ok.identities === null, false)
  assert.equal(ok.force, false)

  const noIdentities = parseArgs(["--from", "a", "--to", "b", "--labels", "l.json", "--out-dir", "o", "--force"])
  assert.ok(noIdentities.valid)
  assert.equal(noIdentities.identities, null)
  assert.equal(noIdentities.force, true)

  const missing = parseArgs(["--from", "a"])
  assert.ok(!missing.valid)
  assert.match(missing.error, /--to/)
  assert.match(missing.error, /--labels/)
  assert.match(missing.error, /--out-dir/)

  const unknown = parseArgs(["--from", "a", "--to", "b", "--labels", "l", "--out-dir", "o", "--frobnicate"])
  assert.ok(!unknown.valid)
  assert.match(unknown.error, /--frobnicate/)

  const help = parseArgs(["--help"])
  assert.ok(!help.valid)
  assert.match(help.error, /Usage/)

  const dangling = parseArgs(["--from"])
  assert.ok(!dangling.valid)
})

test("runRekey writes four loadable files and refuses to overwrite without --force", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-rekey-cli-"))
  try {
    const { source, target, labels, identities } = fixture()
    const fromDir = path.join(dir, "runA")
    const toDir = path.join(dir, "runB")
    const outDir = path.join(dir, "out")
    fs.mkdirSync(fromDir)
    fs.mkdirSync(toDir)
    const jsonl = (/** @type {readonly unknown[]} */ records) =>
      records.map((r) => JSON.stringify(r)).join("\n") + "\n"
    fs.writeFileSync(path.join(fromDir, "photos.jsonl"), jsonl(source.photos))
    fs.writeFileSync(path.join(fromDir, "faces.jsonl"), jsonl(source.faces))
    fs.writeFileSync(path.join(toDir, "photos.jsonl"), jsonl(target.photos))
    fs.writeFileSync(path.join(toDir, "faces.jsonl"), jsonl(target.faces))
    const labelsPath = path.join(dir, "labels.json")
    const identitiesPath = path.join(dir, "identities.json")
    fs.writeFileSync(labelsPath, JSON.stringify(labels))
    fs.writeFileSync(identitiesPath, JSON.stringify(identities))

    /** @type {string[]} */
    const lines = []
    const args = {
      from: fromDir,
      to: toDir,
      labels: labelsPath,
      identities: identitiesPath,
      outDir,
      force: false,
    }
    assert.equal(runRekey(args, (line) => lines.push(line)), 0)

    const written = /** @type {Types.Session1LabelFile} */ (
      JSON.parse(fs.readFileSync(path.join(outDir, "labels.json"), "utf8"))
    )
    assert.equal(written.datasetId, computeDatasetId(target.faces))
    assert.deepEqual(written.labels, { 100: "p1", 101: "p2", 102: "p1", 103: "x" })
    assert.ok(Object.keys(written.pool).length > 0)
    const poolA = /** @type {Types.PoolCarryFile} */ (
      JSON.parse(fs.readFileSync(path.join(outDir, "poolA.json"), "utf8"))
    )
    assert.deepEqual(poolA.faceIds, [100, 101])
    const exclusions = /** @type {Types.ExclusionsCarryFile} */ (
      JSON.parse(fs.readFileSync(path.join(outDir, "exclusions.json"), "utf8"))
    )
    assert.deepEqual(exclusions.exclusions, [{ faceId: 104, notPerson: "p1" }])
    const identitiesOut = /** @type {Types.Session1IdentitiesFile} */ (
      JSON.parse(fs.readFileSync(path.join(outDir, "identities.json"), "utf8"))
    )
    assert.equal(identitiesOut.identities.p1.name, "Alpha")

    // The console report is counts only: no fixture path, no fixture name.
    const joined = lines.join("\n")
    assert.ok(!joined.includes("Alpha") && !joined.includes("Beta"))
    assert.ok(!joined.includes("fixture-"))

    // Second run: labels.json already exists — human judgement is never
    // clobbered silently.
    assert.equal(runRekey(args, (line) => lines.push(line)), 2)
    // --force overwrites.
    assert.equal(runRekey({ ...args, force: true }, (line) => lines.push(line)), 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
