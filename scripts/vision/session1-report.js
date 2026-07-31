/** @file The instrument's read-out. Assembles the five reports of SPEC §7 from
 *  one session-1 run directory and says, in words, which of SESSION-1 §4's three
 *  predictions the numbers actually support.
 *
 *  Nothing statistical is implemented here. `public/vision/metrics.js` owns every
 *  statistic (`pairDistances`, `separation`, `groupingQuality`,
 *  `leaveOneOutRank1`, `histogram`, `percentile`); `group.js` owns the clustering
 *  and `gate.js` owns the verdicts. This file does three things those cannot:
 *  it JOINS the run's two JSONL files, it BUILDS THE STRATA (which is where the
 *  honesty of the headline number lives), and it PRESENTS the result.
 *
 *  Three things worth knowing before changing anything below.
 *
 *  **The different-hour stratum is the only honest headline.** Two frames from
 *  one burst produce two near-identical descriptors; a same-person pair drawn
 *  from them measures the shutter, not the recogniser. Every flattering number
 *  this project could accidentally produce comes from that one mistake, so the
 *  strata are built with `pairDistances`'s `keep(i, j)` callback — near-duplicate
 *  frames dropped transitively, then split by capture-time gap — and the summary
 *  says out loud which stratum may be quoted.
 *
 *  **Pool A only, for report A.** Pool B was labelled with the model's own
 *  grouping as an assist, so its coverage is conditioned on what the model
 *  already found. It is fine for volume in B and C and it is disqualifying in A.
 *
 *  **`groupFaces` mutates `options.matrix` in place** (Lance-Williams). A cutoff
 *  sweep that reuses one matrix computes every point after the first on rewritten
 *  data, runs, terminates, and is wrong. `sweepGrouping` copies per step and the
 *  unit test asserts the sweep equals a per-cutoff rebuild.
 *
 *  **Never print a recommendation the report has not evaluated.** Report D sweeps
 *  each gate cutoff with the other eight WIDE OPEN, which is the only way to
 *  measure one cutoff's own contribution — and makes each sweep a measurement of
 *  a different configuration. Nine winners taken together are a tenth
 *  configuration, and their intersection can keep a small fraction of what any of
 *  them keeps alone. `jointGate` applies the set, measures it, and backs off to
 *  the defaults when the set does not beat them.
 *
 *  Usage:
 *    node scripts/vision/session1-report.js tmp/session1 [--oracle tmp/oracle.jsonl]
 *      [--html | --no-html] [--out <file>] [--verbose]
 *
 *  Everything it reads and everything it writes is under `tmp/`. No number it
 *  prints may be copied into any file in this repository — CLAUDE.md's fourth
 *  photograph rule. Tuned constants go into `public/vision/defaults.js` as bare
 *  numbers, with no note of what produced them.
 *
 *  No regex, per the project rule: every string operation here is `split`,
 *  `indexOf`, `startsWith`, `endsWith`, `slice`, `replaceAll` or `padEnd`.
 */
/** @import * as Types from './types.js' */
/** @import * as V from '../../public/vision/types.js' */

import fs from "node:fs"
import path from "node:path"

import { allDefaults } from "../../public/vision/defaults.js"
import { boxIou } from "../../public/vision/detect.js"
import { applyGate, gateCheckKeys } from "../../public/vision/gate.js"
import { distanceMatrix, groupFaces } from "../../public/vision/group.js"
import {
  groupingQuality,
  histogram,
  leaveOneOutRank1,
  pairDistances,
  percentile,
  separation,
} from "../../public/vision/metrics.js"

import { computeDatasetId } from "./dataset-id.js"

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

/** IoU at which two boxes are called the same face, for reports E. */
const BOX_MATCH_IOU = 0.5

/** A stratum with fewer pairs than this on either side is not a measurement. */
const MIN_STRATUM_PAIRS = 10

/**
 * The floor below which `verdictBasis` refuses to hand `verdict()` a number at
 * all. Separate from — and deliberately much higher than — `MIN_STRATUM_PAIRS`,
 * which only decides whether a stratum is worth PRINTING. A stratum can be
 * worth printing as a direction while being far too thin to carry an English
 * conclusion: an AUC over a handful of same-person pairs moves by whole verdict
 * bands when one pair flips. Reference default, deliberately round. Raising it
 * makes the report more honest and more often silent; it never makes it wrong.
 */
const MIN_VERDICT_PAIRS = 30

/** Label written by the labeller for "this detection is not a face". */
const NOT_A_FACE = "x"

// Every shape this file produces is declared in scripts/vision/types.d.ts under
// "The report". Those declarations carry WHY each exists — the strata's honesty,
// the matrix-mutation hazard, the joint-gate trap — because that is the part a
// field list cannot say and the part a reader has to know before changing any of
// them. Nothing is redeclared here.

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * One JSONL file. A run killed part-way leaves a truncated final line, and a
 * report that throws on it is a report that cannot be read after an interrupted
 * batch — so bad lines are counted and skipped, never silently dropped.
 * @template T
 * @param {string} file
 * @returns {{ records: T[], skipped: number, present: boolean }}
 */
function readJsonl(file) {
  if (!fs.existsSync(file)) return { records: [], skipped: 0, present: false }
  const text = fs.readFileSync(file, "utf8")
  /** @type {T[]} */
  const records = []
  let skipped = 0
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      records.push(/** @type {T} */ (JSON.parse(trimmed)))
    } catch {
      skipped++
    }
  }
  return { records, skipped, present: true }
}

/**
 * @template T
 * @param {string} file
 * @returns {T | null}
 */
function readJson(file) {
  if (!fs.existsSync(file)) return null
  try {
    return /** @type {T} */ (JSON.parse(fs.readFileSync(file, "utf8")))
  } catch {
    return null
  }
}

/** @type {Types.loadRun} */
export function loadRun(dir) {
  const photos = readJsonl(path.join(dir, "photos.jsonl"))
  const faces = readJsonl(path.join(dir, "faces.jsonl"))
  const resolution = readJsonl(path.join(dir, "resolution.jsonl"))

  const skipped = photos.skipped + faces.skipped + resolution.skipped
  if (skipped > 0) {
    // Loud, because a truncated faces.jsonl silently shrinks every count below.
    console.warn(`warning: skipped ${skipped} unparseable JSONL line(s) — was the batch interrupted?`)
  }

  const faceRecords = /** @type {Types.Session1FaceRecord[]} */ (faces.records)
  const labels = /** @type {Types.Session1LabelFile | null} */ (readJson(path.join(dir, "labels.json")))

  // The join below is by bare numeric face id, and ids are sequential counters
  // over a content-dependent directory scan — one added, removed or renamed
  // file shifts every id after it. datasetId exists precisely so a labels.json
  // can be refused against a run it was not made from; a mismatched join would
  // attach old names to new faces and every number downstream would be about a
  // population that never existed. Refusal, not a warning, matching
  // carryAssignments' stance in relabel-data.js.
  if (labels !== null && faceRecords.length > 0) {
    const recorded = labels.datasetId
    if (typeof recorded === "string" && recorded.length > 0) {
      const actual = computeDatasetId(faceRecords)
      if (recorded !== actual) {
        throw new Error(
          `labels.json was made from a different run: its datasetId is ${recorded}, ` +
            `but this run's faces.jsonl hashes to ${actual}. Face ids are not stable across ` +
            `runs, so joining these files would silently attach labels to the wrong faces. ` +
            `Re-run relabel-data.js and re-check the labelling, or point the report at the ` +
            `run directory the labels came from.`,
        )
      }
    } else {
      console.warn(
        "warning: labels.json carries no datasetId, so it cannot be verified against this " +
          "run's faces.jsonl. If the batch was ever re-run since labelling, every join below " +
          "may be wrong. Regenerate label-data.js with relabel-data.js to stamp it.",
      )
    }
  }

  return {
    photos: /** @type {Types.Session1PhotoRecord[]} */ (photos.records),
    faces: faceRecords,
    labels,
    timing: /** @type {Types.Session1Timing | null} */ (readJson(path.join(dir, "timing.json"))),
    resolution: /** @type {Types.Session1ResolutionRecord[]} */ (resolution.records),
  }
}

// ---------------------------------------------------------------------------
// Duplicate frames
// ---------------------------------------------------------------------------

/**
 * Photo id → duplicate-frame equivalence class, by union-find over
 * `exactDuplicateOf` and `nearDuplicateOf`. Transitive on purpose: a delivery
 * with an original, a retouch and a re-export links A→B and C→B, and treating
 * A and C as unrelated would leave exactly the pair the exclusion exists to
 * remove.
 * @param {readonly Types.Session1PhotoRecord[]} photos
 * @returns {Map<number, number>}
 */
export function frameRoots(photos) {
  /** @type {Map<number, number>} */
  const parent = new Map()
  for (const p of photos) parent.set(p.id, p.id)

  /** @param {number} x @returns {number} */
  const find = (x) => {
    let root = x
    for (;;) {
      const up = parent.get(root)
      if (up === undefined || up === root) break
      root = up
    }
    let cur = x
    for (;;) {
      const up = parent.get(cur)
      if (up === undefined || up === cur) break
      parent.set(cur, root)
      cur = up
    }
    return root
  }

  /** @param {number} a @param {number} b */
  const union = (a, b) => {
    // A `--limit`ed run can reference a photo it never wrote a row for.
    if (!parent.has(a) || !parent.has(b)) return
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb))
  }

  for (const p of photos) {
    if (p.exactDuplicateOf != null) union(p.id, p.exactDuplicateOf)
    if (p.nearDuplicateOf != null) union(p.id, p.nearDuplicateOf)
  }

  /** @type {Map<number, number>} */
  const roots = new Map()
  for (const p of photos) roots.set(p.id, find(p.id))
  return roots
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * @param {Types.Session1FaceRecord} face
 * @param {boolean} mirror
 * @returns {number[]}
 */
function descriptorOf(face, mirror) {
  const mirrored = face.mirrorDescriptor
  return mirror && mirrored && mirrored.length > 0 ? mirrored : face.descriptor
}

/**
 * Pack a subset of the run's faces into a DescriptorSet plus the parallel
 * context arrays the strata index into.
 * @param {Types.LoadedRun} run
 * @param {Types.ViewOptions} [options]
 * @returns {Types.FaceView}
 */
export function buildView(run, options = {}) {
  const mirror = options.mirror === true
  const wantPool = options.pool ?? null
  const labelFile = run.labels
  const labelMap = labelFile ? labelFile.labels : {}
  const poolMap = labelFile ? (labelFile.pool ?? {}) : {}
  // A labels.json with no pool map at all predates two-pool sampling. Treating
  // everything as pool A is the only reading that produces a number, and it is
  // marked as an assumption everywhere it is shown.
  const poolKnown = Object.keys(poolMap).length > 0
  const roots = frameRoots(run.photos)
  /** @type {Map<number, Types.Session1PhotoRecord>} */
  const photoById = new Map(run.photos.map((p) => [p.id, p]))

  /** @type {Array<{ face: Types.Session1FaceRecord, label: string | null }>} */
  const picked = []
  for (const face of run.faces) {
    const key = String(face.id)
    const raw = labelMap[key]
    const label = raw === undefined || raw === NOT_A_FACE ? null : raw
    if (options.requireLabel && label === null) continue
    if (wantPool !== null) {
      if (poolKnown) {
        if (poolMap[key] !== wantPool) continue
      } else if (wantPool !== "A") {
        continue
      }
    }
    if (options.include && !options.include(face)) continue
    picked.push({ face, label })
  }

  const dim = picked.length > 0 ? descriptorOf(picked[0].face, mirror).length : 0
  const data = new Float32Array(picked.length * dim)
  /** @type {Array<string | null>} */
  const labels = []
  /** @type {number[]} */
  const faceIds = []
  /** @type {number[]} */
  const photoIds = []
  /** @type {Array<number | null>} */
  const times = []
  /** @type {number[]} */
  const frames = []
  /** @type {Types.Session1FaceRecord[]} */
  const records = []

  picked.forEach(({ face, label }, row) => {
    const vec = descriptorOf(face, mirror)
    if (vec.length !== dim) {
      throw new Error(`face ${face.id}: descriptor has ${vec.length} dims, expected ${dim}`)
    }
    data.set(vec, row * dim)
    labels.push(label)
    faceIds.push(face.id)
    photoIds.push(face.photoId)
    const photo = photoById.get(face.photoId)
    times.push(photo ? photo.capturedAtMs : null)
    frames.push(roots.get(face.photoId) ?? face.photoId)
    records.push(face)
  })

  return { set: { dim, data }, labels, faceIds, photoIds, times, frames, records, poolAssumed: !poolKnown }
}

// ---------------------------------------------------------------------------
// Report A — separation
// ---------------------------------------------------------------------------

/**
 * The strata, as `keep(i, j)` predicates. Everything that makes report A honest
 * is in this function; `pairDistances` deliberately knows nothing about
 * photographs, duplicates or clocks.
 *
 * Time strata are built ON TOP OF the duplicate exclusion. Near-duplicate frames
 * are almost always seconds apart, so leaving them in would inflate the
 * same-minute stratum with what is effectively one photograph counted twice —
 * and the whole point of splitting by time is to see how much of the same-minute
 * result is burst rather than recogniser.
 * @param {Types.FaceView} view
 * @returns {Types.StratumSpec[]}
 */
export function separationStrata(view) {
  /**
   * Two DISTINCT photographs in one duplicate class. Two faces in the SAME
   * photograph are not a duplicate-frame pair — they are two people standing
   * next to each other, which is genuine different-person evidence and is kept.
   * @param {number} i @param {number} j
   */
  const sameFrame = (i, j) => view.photoIds[i] !== view.photoIds[j] && view.frames[i] === view.frames[j]

  /** @param {number} i @param {number} j @returns {number | null} */
  const gap = (i, j) => {
    const a = view.times[i]
    const b = view.times[j]
    return a === null || b === null ? null : Math.abs(a - b)
  }

  /**
   * @param {(g: number) => boolean} within
   * @returns {(i: number, j: number) => boolean}
   */
  const timed = (within) => (i, j) => {
    if (sameFrame(i, j)) return false
    const g = gap(i, j)
    return g !== null && within(g)
  }

  return [
    {
      key: "all",
      title: "all pairs",
      note: "Includes duplicate frames. Flattering and not evidence; shown only so the cost of the exclusion is visible.",
      honest: false,
      keep: null,
    },
    {
      key: "dedup",
      title: "near-duplicate frames excluded",
      note: "Pairs whose two photographs are transitively linked by exactDuplicateOf / nearDuplicateOf are dropped.",
      honest: false,
      keep: (i, j) => !sameFrame(i, j),
    },
    {
      key: "minute",
      title: "same minute (≤ 1 min apart)",
      note: "One burst. Same-person pairs here measure the shutter, not the recogniser. Do not quote this.",
      honest: false,
      keep: timed((g) => g <= MINUTE_MS),
    },
    {
      key: "hour",
      title: "same hour (1 min – 1 hour apart)",
      note: "Same event, same light, same clothes. Partial evidence.",
      honest: false,
      keep: timed((g) => g > MINUTE_MS && g <= HOUR_MS),
    },
    {
      key: "crossHour",
      title: "different hour (> 1 hour apart)",
      note: "THE HONEST NUMBER. Different light, different pose, different part of the day — the only stratum where a same-person pair is independent evidence.",
      honest: true,
      keep: timed((g) => g > HOUR_MS),
    },
  ]
}

/**
 * @param {Types.FaceView} view
 * @param {{ bins?: number }} [options]
 * @returns {{ strata: Types.StratumReport[], honestKey: string, usedKey: string, facesWithoutTime: number, poolAssumed: boolean, faces: number, people: number }}
 */
export function reportA(view, options = {}) {
  /** @type {Types.StratumReport[]} */
  const strata = separationStrata(view).map((spec) => {
    const { same, diff } = pairDistances(view.set, {
      labels: view.labels,
      keep: spec.keep ?? undefined,
    })
    return {
      key: spec.key,
      title: spec.title,
      note: spec.note,
      honest: spec.honest,
      report: separation(same, diff, options),
    }
  })

  /** @type {Set<string>} */
  const people = new Set()
  for (const l of view.labels) if (l !== null) people.add(l)

  return {
    strata,
    honestKey: "crossHour",
    usedKey: pickHeadline(strata).key,
    facesWithoutTime: view.times.filter((t) => t === null).length,
    poolAssumed: view.poolAssumed,
    faces: view.labels.filter((l) => l !== null).length,
    people: people.size,
  }
}

/**
 * The stratum the summary leads with. `crossHour` unless it is too thin to be a
 * measurement, in which case `dedup` — and the caller says so, loudly, rather
 * than presenting a burst-contaminated number as the headline.
 * @param {Types.StratumReport[]} strata
 * @returns {Types.StratumReport}
 */
export function pickHeadline(strata) {
  const byKey = new Map(strata.map((s) => [s.key, s]))
  const cross = byKey.get("crossHour")
  if (cross && cross.report.sameCount >= MIN_STRATUM_PAIRS && cross.report.diffCount >= MIN_STRATUM_PAIRS) {
    return cross
  }
  const dedup = byKey.get("dedup")
  return dedup ?? strata[0]
}

// ---------------------------------------------------------------------------
// Report B — grouping
// ---------------------------------------------------------------------------

/**
 * Cutoffs derived from the input's own distance distribution rather than from a
 * fixed ladder, per SPEC §6.2. The interesting region is between where
 * same-person pairs end and different-person pairs begin, so the candidates are
 * the upper tail of `same` and the lower tail of `diff`, plus the reference
 * default so the shipped value is always on the plot.
 * @param {readonly number[]} same
 * @param {readonly number[]} diff
 * @returns {number[]}
 */
export function sweepCutoffs(same, diff) {
  const s = same.slice().sort((a, b) => a - b)
  const d = diff.slice().sort((a, b) => a - b)
  /** @type {number[]} */
  const raw = [allDefaults().group.cutoff]
  if (s.length > 0) for (const p of [0.5, 0.75, 0.9, 0.95, 0.99]) raw.push(percentile(s, p))
  if (d.length > 0) for (const p of [0.001, 0.01, 0.05, 0.1, 0.25]) raw.push(percentile(d, p))
  if (s.length === 0 && d.length === 0) {
    for (let c = 0.2; c <= 0.85; c += 0.05) raw.push(c)
  }
  /** @type {Set<number>} */
  const seen = new Set()
  /** @type {number[]} */
  const out = []
  for (const value of raw) {
    if (!Number.isFinite(value) || value <= 0) continue
    const rounded = Math.round(value * 1000) / 1000
    if (seen.has(rounded)) continue
    seen.add(rounded)
    out.push(rounded)
  }
  return out.sort((a, b) => a - b)
}

/**
 * ⚠ THE BUG THIS FUNCTION EXISTS TO NOT HAVE.
 *
 * `groupFaces` runs Lance-Williams IN PLACE on `options.matrix` — merging
 * rewrites row `a` with size-weighted means and never restores it. Passing one
 * matrix through a sweep means every point after the first is computed on data
 * the previous point rewrote. It runs, it terminates, and the resulting curve is
 * garbage that looks entirely plausible.
 *
 * So: build the base matrix ONCE (it is the expensive part, O(n²·dim)) and copy
 * it per sweep step (O(n²), cheap). `tests/unit/vision-report.test.js` asserts
 * this sweep is identical to rebuilding the matrix from scratch for every cutoff.
 * @param {V.DescriptorSet} set
 * @param {object} options
 * @param {readonly number[]} options.cutoffs
 * @param {ReadonlyArray<string | null>} options.labels
 * @param {readonly number[]} options.photoIds
 * @param {readonly boolean[]} [options.cannotLink]
 * @returns {Types.SweepPoint[]}
 */
export function sweepGrouping(set, options) {
  const base = distanceMatrix(set)
  const modes = options.cannotLink ?? [true, false]
  /** @type {Types.SweepPoint[]} */
  const out = []
  for (const cannotLink of modes) {
    for (const cutoff of options.cutoffs) {
      const matrix = { n: base.n, d: new Float32Array(base.d) }
      const groups = groupFaces(set, {
        cutoff,
        photoIds: options.photoIds,
        cannotLinkWithinPhoto: cannotLink,
        matrix,
      })
      out.push({ cutoff, cannotLink, quality: groupingQuality(groups, options.labels) })
    }
  }
  return out
}

/**
 * The cutoff to recommend. Over-splitting is the cheap failure (merging is two
 * clicks) and welding is the expensive one (unpicking two people is not), so the
 * choice is the best pair-F1 among the points that welded nobody — not the best
 * pair-F1.
 *
 * ⚠ When NO swept point is weld-free, there is no such choice, and the fallback
 * below returns the best pair-F1 among all cannot-link points instead. That is
 * the right thing to return — a recommendation has to come from somewhere — but
 * it is a materially different claim, and a caller that prints the sentence at
 * the top of this comment over it is stating a property the point does not have.
 * So the flag is returned rather than inferred, and the print path must use it.
 * It is also a finding in its own right: no cutoff separates these people
 * without welding two of them together, which is an argument about the product
 * shape and not a detail of the sweep.
 * @param {Types.SweepPoint[]} points
 * @returns {{ point: Types.SweepPoint, weldFree: boolean } | null}
 */
export function bestSweepPoint(points) {
  const clean = points.filter((p) => p.cannotLink && p.quality.weldedGroups === 0)
  const weldFree = clean.length > 0
  const pool = weldFree ? clean : points.filter((p) => p.cannotLink)
  if (pool.length === 0) return null
  return {
    point: pool.reduce((best, p) => (p.quality.pairF1 > best.quality.pairF1 ? p : best)),
    weldFree,
  }
}

/**
 * Twenty-two rows is a sweep, not a finding. These five or six are the ones a
 * reader would have to pick out by hand anyway: the tightest and loosest ends of
 * the cannot-link-on curve so the shape is visible, the SHIPPED cutoff so the
 * recommendation has something to be better than, the recommended point, and the
 * same cutoff with cannot-link off so the constraint's contribution is on the
 * page. Full sweep stays available behind --verbose.
 * @param {Types.SweepPoint[]} points
 * @param {Types.SweepPoint | null} best
 * @returns {Types.SweepPoint[]}
 */
export function representativeSweep(points, best) {
  const on = points.filter((p) => p.cannotLink)
  const shipped = allDefaults().group.cutoff
  /** @type {Set<Types.SweepPoint>} */
  const picked = new Set()
  if (on.length > 0) {
    picked.add(on[0])
    picked.add(on[on.length - 1])
    const atShipped = on.find((p) => p.cutoff === shipped)
    if (atShipped) picked.add(atShipped)
  }
  if (best) {
    picked.add(best)
    const paired = points.find((p) => !p.cannotLink && p.cutoff === best.cutoff)
    if (paired) picked.add(paired)
  }
  return points.filter((p) => picked.has(p))
}

// ---------------------------------------------------------------------------
// Report D — is the gate earning its place
// ---------------------------------------------------------------------------

/**
 * Which recorded signal each cutoff thresholds, and in which direction. Kept in
 * this file rather than in gate.js because it is a fact about how the REPORT
 * sweeps, not about how the gate decides.
 * @type {Array<{ key: string, signal: keyof V.GateSignals, direction: "min" | "max" }>}
 */
const GATE_AXES = [
  { key: "minScore", signal: "score", direction: "min" },
  { key: "minBoxPx", signal: "boxPx", direction: "min" },
  { key: "minBorderPx", signal: "borderPx", direction: "min" },
  { key: "minEyeRatio", signal: "eyeRatio", direction: "min" },
  { key: "maxEyeRatio", signal: "eyeRatio", direction: "max" },
  { key: "maxResidual", signal: "residual", direction: "max" },
  { key: "maxAlignScale", signal: "alignScale", direction: "max" },
  { key: "maxOutside", signal: "outsideFraction", direction: "max" },
  { key: "minSharpness", signal: "sharpness", direction: "min" },
]

/** Fractions of the observed distribution each axis is swept over. */
const GATE_MIN_QUANTILES = [0, 0.02, 0.05, 0.1, 0.2, 0.3]
const GATE_MAX_QUANTILES = [1, 0.98, 0.95, 0.9, 0.8, 0.7]

/** A gate cutoff must move a headline number by at least this to be worth it. */
const GATE_WORTH_IT = 0.002

/**
 * The name `session1.js` writes for whole-run wall clock. It lives inside
 * `timing.stages` alongside the parts it is the total OF, which is why every
 * consumer has to go through `stageBreakdown` rather than summing the object.
 */
const TOTAL_STAGE = "total"

/**
 * Folds for the held-out gate estimate. Five is the usual compromise: enough
 * training people in each pass that the selection behaves like the real one,
 * enough held-out people that a fold's AUC rests on more than a handful of
 * pairs. It costs one full selection per fold, which is the whole reason this
 * report takes tens of seconds rather than a few.
 */
const HELD_OUT_FOLDS = 5

/**
 * A joint gate keeping less than this share of the labelled faces is not a
 * measurement any more — AUC over a handful of pairs is noise, and a
 * recommendation derived from noise is worse than the defaults it replaces.
 * Applied as a floor against the DEFAULT gate's own keep count too, so a run
 * whose defaults are already aggressive can never be told to go further.
 */
const GATE_JOINT_MIN_KEPT_FRACTION = 0.25

/**
 * The two numbers a cutoff has to justify itself against, summed. Both matter:
 * a gate that lifts AUC while destroying rank-1 has thrown away the people the
 * feature is for. A non-finite half scores zero rather than propagating NaN,
 * which would make every comparison below silently false.
 * @param {{ auc: number, rank1: number }} point
 * @returns {number}
 */
function gateScore(point) {
  return (Number.isFinite(point.auc) ? point.auc : 0) + (Number.isFinite(point.rank1) ? point.rank1 : 0)
}

/**
 * Cutoffs never filter here — they are re-derived from the run's own
 * distribution, which is exactly why the batch records every signal unthresholded.
 * @param {readonly Types.Session1FaceRecord[]} faces
 * @param {{ key: string, signal: keyof V.GateSignals, direction: "min" | "max" }} axis
 * @param {number} defaultValue
 * @returns {number[]}
 */
function gateCandidates(faces, axis, defaultValue) {
  const values = faces.map((f) => Number(f.signals[axis.signal])).filter((v) => Number.isFinite(v))
  values.sort((a, b) => a - b)
  const quantiles = axis.direction === "min" ? GATE_MIN_QUANTILES : GATE_MAX_QUANTILES
  /** @type {number[]} */
  const raw = [defaultValue]
  for (const q of quantiles) raw.push(percentile(values, q))
  /** @type {Set<number>} */
  const seen = new Set()
  /** @type {number[]} */
  const out = []
  for (const value of raw) {
    if (!Number.isFinite(value)) continue
    const rounded = Math.round(value * 100000) / 100000
    if (seen.has(rounded)) continue
    seen.add(rounded)
    out.push(rounded)
  }
  return out.sort((a, b) => (axis.direction === "min" ? a - b : b - a))
}

/**
 * Report A's headline AUC and report C's rank-1, recomputed over whichever faces
 * a cutoff set keeps. Both are needed: a gate that lifts AUC while destroying
 * rank-1 has thrown away the people the feature is for.
 *
 * The two optional narrowings exist for the held-out folds and are deliberately
 * separate from `include`. A fold evaluates cutoffs chosen without its labels, so
 * the PAIRS and the QUERIES must come from the held-out people only — but the
 * prototypes those queries are ranked against must still come from everybody,
 * or the fold would be measuring an easier problem than the in-sample number it
 * is meant to be compared against.
 * @param {Types.LoadedRun} run
 * @param {string} stratumKey
 * @param {(face: Types.Session1FaceRecord) => boolean} include
 * @param {object} [options]
 * @param {(face: Types.Session1FaceRecord) => boolean} [options.pairsFrom] narrows the AUC pairs only
 * @param {Set<number>} [options.queryFaceIds] narrows the rank-1 queries only
 * @returns {{ auc: number, fprAt95Tpr: number, rank1: number, kept: number, evaluated: number, correct: number, samePairs: number, diffPairs: number, same: number[], diff: number[] }}
 */
function scoreWithGate(run, stratumKey, include, options = {}) {
  const pairsFrom = options.pairsFrom
  const poolA = buildView(run, {
    pool: "A",
    requireLabel: true,
    include: pairsFrom ? (f) => include(f) && pairsFrom(f) : include,
  })
  const spec = separationStrata(poolA).find((s) => s.key === stratumKey)
  const { same, diff } = pairDistances(poolA.set, {
    labels: poolA.labels,
    keep: spec ? (spec.keep ?? undefined) : undefined,
  })
  const sep = separation(same, diff)
  const all = buildView(run, { requireLabel: true, include })
  const wanted = options.queryFaceIds
  const r1 = leaveOneOutRank1(
    all.set,
    all.labels,
    wanted ? { queryMask: all.faceIds.map((id) => wanted.has(id)) } : undefined,
  )
  return {
    auc: sep.auc,
    fprAt95Tpr: sep.fprAt95Tpr,
    rank1: r1.rank1,
    kept: all.labels.length,
    evaluated: r1.evaluated,
    correct: r1.correct,
    samePairs: same.length,
    diffPairs: diff.length,
    // Raw, for pooling across folds. A mean of per-fold AUCs is not the same
    // quantity and is far noisier when the folds are thin; see `heldOutGate`.
    same,
    diff,
  }
}

/**
 * @param {Types.LoadedRun} run
 * @param {string} stratumKey
 * @returns {{ baseline: Types.GateSweepPoint, ungated: Types.GateSweepPoint, keys: Types.GateSweepKey[], joint: Types.JointGate, breakdown: Array<{ reason: string, n: number }>, defaults: Record<string, number> }}
 */
/** The wide-open end of every axis: what "this check is off" means, per key. */
const GATE_WIDE_OPEN = {
  minScore: 0,
  minBoxPx: 0,
  minBorderPx: -Infinity,
  minEyeRatio: 0,
  maxEyeRatio: Infinity,
  maxResidual: Infinity,
  maxAlignScale: Infinity,
  maxOutside: Infinity,
  minSharpness: 0,
}

/**
 * The whole selection procedure — per-axis sweep, then the joint greedy walk —
 * over whatever population it is handed. Extracted from `reportD` so a held-out
 * fold can run the IDENTICAL procedure on the training people, which is the only
 * way its result is a fair stand-in for what the full selection does.
 * @param {Types.LoadedRun} run
 * @param {string} stratumKey
 * @param {Record<string, number>} base
 * @param {number} total
 * @param {(face: Types.Session1FaceRecord) => boolean} population
 * @returns {{ keys: Types.GateSweepKey[], joint: Types.JointGate, baseline: ReturnType<typeof scoreWithGate> }}
 */
function selectGate(run, stratumKey, base, total, population) {
  /** @param {Record<string, number>} cutoffs */
  const withCutoffs = (cutoffs) => {
    /** @type {Set<number>} */
    const passing = new Set()
    for (const face of run.faces) {
      if (applyGate(face.signals, cutoffs).pass) passing.add(face.id)
    }
    return scoreWithGate(run, stratumKey, (f) => passing.has(f.id) && population(f))
  }

  const baseline = withCutoffs(base)

  /** @type {Types.GateSweepKey[]} */
  const keys = []
  for (const axis of GATE_AXES) {
    const defaultValue = base[axis.key] ?? 0
    /** @type {Types.GateSweepPoint[]} */
    const points = []
    for (const value of gateCandidates(run.faces, axis, defaultValue)) {
      // One axis at a time, every other check wide open. Sweeping one cutoff
      // inside the full default gate measures the interaction, not the cutoff.
      /** @type {Record<string, number>} */
      const only = { ...GATE_WIDE_OPEN }
      only[axis.key] = value
      const scored = withCutoffs(only)
      points.push({ value, kept: scored.kept, total, auc: scored.auc, rank1: scored.rank1 })
    }
    keys.push({ key: axis.key, signal: String(axis.signal), direction: axis.direction, defaultValue, points })
  }

  return { keys, joint: jointGate({ keys, base, total, baseline, withCutoffs }), baseline }
}

/**
 * Labelled faces grouped by person, split into `k` folds of PEOPLE.
 *
 * Splitting by person rather than by face is the whole correctness argument: a
 * random split of faces would put two faces of one person on opposite sides, and
 * a same-person pair straddling the split is training data leaking into the test
 * set through the back door.
 *
 * Assignment is largest-person-first round robin, which keeps the folds close to
 * equal in FACES even though the person counts are equal — the face counts per
 * person are wildly unequal, and a fold that happened to draw only small people
 * would produce an AUC over a handful of pairs and call it a measurement.
 * Deterministic by construction: no shuffling, so re-running the report cannot
 * move the number.
 * @param {Types.LoadedRun} run
 * @param {number} k
 * @returns {Array<Set<number>>} face ids per fold
 */
export function personFolds(run, k) {
  const view = buildView(run, { requireLabel: true })
  /** @type {Map<string, number[]>} */
  const byPerson = new Map()
  view.labels.forEach((label, row) => {
    if (label === null) return
    const list = byPerson.get(label)
    if (list) list.push(view.faceIds[row])
    else byPerson.set(label, [view.faceIds[row]])
  })

  const people = [...byPerson.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  const folds = Math.max(2, Math.min(k, people.length))
  /** @type {Array<Set<number>>} */
  const out = []
  for (let i = 0; i < folds; i++) out.push(new Set())
  people.forEach(([, faceIds], i) => {
    // Serpentine, not plain modulo: plain modulo hands fold 0 the largest person
    // of every cycle, so with a heavy-tailed face distribution fold 0 ends up
    // systematically the biggest.
    const cycle = Math.floor(i / folds)
    const slot = cycle % 2 === 0 ? i % folds : folds - 1 - (i % folds)
    for (const id of faceIds) out[slot].add(id)
  })
  return out
}

/**
 * ⚠ THE THIRD BUG THIS FILE EXISTS TO NOT HAVE, and the one that flatters.
 *
 * `jointGate` picks nine cutoffs by maximising AUC + rank-1 over the labelled
 * set, and then the report prints the AUC and rank-1 that same set achieved
 * under them. That is selection and evaluation on one sample: the winner of a
 * search over ~60 candidates is biased upward by however much of its margin was
 * luck, and nothing in the numbers says which part that was. Left alone it turns
 * a real but imperfect result into a spectacular-looking one, which is exactly
 * the failure the rest of this file is organised around.
 *
 * So: run the IDENTICAL selection K times, each time blind to one fold of
 * PEOPLE, and score each fold's cutoffs on the people that selection never saw.
 * The mean of those is what the procedure is worth on people it has not met —
 * and the gap between it and the in-sample number is the optimism, stated rather
 * than left for the reader to suspect.
 *
 * ⚠ The folds are POOLED, not averaged. A mean of per-fold AUCs is a different
 * and much noisier quantity when the folds are thin: five folds over thirty-odd
 * people leave six people each, most produce too few cross-hour pairs to score
 * at all, and the one or two that survive can land on 1.0000 by having drawn an
 * easy six. Averaging those reports a number that moves with the fold split
 * rather than with the recogniser — and it will happily print a held-out result
 * BETTER than the in-sample one, which is a tell that the estimator is broken,
 * not a discovery. So every held-out pair from every fold goes into one
 * distribution and one AUC comes out, each pair having been scored by cutoffs
 * chosen without it. Per-fold numbers are kept for inspection only.
 * @param {Types.LoadedRun} run
 * @param {string} stratumKey
 * @param {Record<string, number>} base
 * @param {number} total
 * @param {number} k
 * @returns {Types.HeldOutGate}
 */
export function heldOutGate(run, stratumKey, base, total, k) {
  const folds = personFolds(run, k)
  /** @type {Types.HeldOutFold[]} */
  const results = []
  /** @type {number[]} */
  const pooledSame = []
  /** @type {number[]} */
  const pooledDiff = []
  let pooledCorrect = 0
  let pooledEvaluated = 0

  folds.forEach((testIds, i) => {
    const inTest = (/** @type {Types.Session1FaceRecord} */ face) => testIds.has(face.id)
    const inTrain = (/** @type {Types.Session1FaceRecord} */ face) => !testIds.has(face.id)

    const trained = selectGate(run, stratumKey, base, total, inTrain)

    /** @type {Set<number>} */
    const passing = new Set()
    for (const face of run.faces) {
      if (applyGate(face.signals, trained.joint.cutoffs).pass) passing.add(face.id)
    }
    // `include` is the gate alone — prototypes come from everybody, so the
    // candidate pool is the same size it is in-sample. Only the pairs and the
    // queries are narrowed to the held-out people.
    const scored = scoreWithGate(run, stratumKey, (f) => passing.has(f.id), {
      pairsFrom: inTest,
      queryFaceIds: new Set([...testIds].filter((id) => passing.has(id))),
    })

    pooledSame.push(...scored.same)
    pooledDiff.push(...scored.diff)
    pooledCorrect += scored.correct
    pooledEvaluated += scored.evaluated

    results.push({
      fold: i,
      cutoffs: trained.joint.cutoffs,
      adopted: trained.joint.adopted,
      auc: scored.auc,
      fprAt95Tpr: scored.fprAt95Tpr,
      rank1: scored.rank1,
      evaluated: scored.evaluated,
      samePairs: scored.samePairs,
      diffPairs: scored.diffPairs,
    })
  })

  const pooled = separation(pooledSame, pooledDiff)
  const measurable = pooledSame.length >= MIN_STRATUM_PAIRS && pooledDiff.length >= MIN_STRATUM_PAIRS

  return {
    folds: results,
    requestedFolds: k,
    contributingFolds: results.filter((r) => r.samePairs > 0 || r.diffPairs > 0).length,
    samePairs: pooledSame.length,
    diffPairs: pooledDiff.length,
    evaluated: pooledEvaluated,
    auc: measurable ? pooled.auc : NaN,
    fprAt95Tpr: measurable ? pooled.fprAt95Tpr : NaN,
    rank1: pooledEvaluated > 0 ? pooledCorrect / pooledEvaluated : NaN,
  }
}

/**
 * @param {Types.LoadedRun} run
 * @param {string} stratumKey
 * @param {{ folds?: number }} [options] `folds: 0` skips the held-out pass entirely
 */
export function reportD(run, stratumKey, options = {}) {
  const gateDefaults = allDefaults().gate
  /** @type {Record<string, number>} */
  const base = { minScore: 0, ...gateDefaults }
  // The denominator is LABELLED faces, because that is what `kept` counts — a
  // gate's effect on the unlabelled majority is real but unmeasurable here, and
  // mixing the two denominators makes a ratio that means nothing.
  const total = buildView(run, { requireLabel: true }).labels.length

  const everyone = selectGate(run, stratumKey, base, total, () => true)
  const ungatedScore = scoreWithGate(run, stratumKey, () => true)
  const { keys, joint, baseline: baselineScore } = everyone

  const heldOut = options.folds === 0 ? null : heldOutGate(run, stratumKey, base, total, options.folds ?? HELD_OUT_FOLDS)

  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const face of run.faces) {
    const verdict = applyGate(face.signals, base)
    const reason = verdict.primaryReason ?? "(passed)"
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  const order = ["(passed)", ...gateCheckKeys()]
  const breakdown = [...counts.entries()]
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason))

  return {
    baseline: {
      value: NaN,
      kept: baselineScore.kept,
      total,
      auc: baselineScore.auc,
      rank1: baselineScore.rank1,
      samePairs: baselineScore.samePairs,
      diffPairs: baselineScore.diffPairs,
    },
    baselineFprAt95Tpr: baselineScore.fprAt95Tpr,
    ungated: {
      value: NaN,
      kept: ungatedScore.kept,
      total,
      auc: ungatedScore.auc,
      rank1: ungatedScore.rank1,
      samePairs: ungatedScore.samePairs,
      diffPairs: ungatedScore.diffPairs,
    },
    keys,
    joint,
    heldOut,
    breakdown,
    defaults: base,
  }
}

/**
 * ⚠ THE OTHER BUG THIS FILE EXISTS TO NOT HAVE.
 *
 * The sweeps above are correct: to measure ONE cutoff's contribution you hold
 * the other eight wide open, otherwise you are measuring the interaction. But
 * that makes each sweep a measurement of a DIFFERENT configuration, and taking
 * the winner from each and printing them as a block to paste into the defaults
 * table recommends a gate nobody evaluated. Nine cutoffs that each keep 70-80%
 * of the labelled faces on their own can intersect down to a fraction of that,
 * and a report which prints the nine keep-counts and not the intersection says
 * nothing about it either way.
 *
 * So: apply the whole set, measure it, and then walk the candidates in order of
 * isolated gain adopting each only if it improves the JOINT result and leaves
 * enough labelled faces for that result to mean anything. Starting the walk from
 * the shipped defaults is what guarantees the recommendation is never worse than
 * doing nothing — the fallback is reached by adopting nothing, not by a special
 * case.
 *
 * The principle, which is the general one: never print a recommendation the
 * report has not evaluated.
 * @param {object} input
 * @param {Types.GateSweepKey[]} input.keys
 * @param {Record<string, number>} input.base
 * @param {number} input.total
 * @param {{ auc: number, rank1: number, kept: number }} input.baseline
 * @param {(cutoffs: Record<string, number>) => { auc: number, rank1: number, kept: number }} input.withCutoffs
 * @returns {Types.JointGate}
 */
export function jointGate(input) {
  const { keys, base, total, baseline, withCutoffs } = input

  /** @type {Types.GateAxisVerdict[]} */
  const verdicts = []
  for (const axis of keys) {
    const open = axis.points[0]
    if (!open) continue
    const best = axis.points.reduce((a, b) => (gateScore(b) > gateScore(a) ? b : a))
    const gain = gateScore(best) - gateScore(open)
    const worthIt = gain > GATE_WORTH_IT && best.value !== open.value
    verdicts.push({
      key: axis.key,
      defaultValue: axis.defaultValue,
      candidate: worthIt ? best.value : null,
      bestValue: best.value,
      deltaAuc: best.auc - open.auc,
      deltaRank1: best.rank1 - open.rank1,
      kept: best.kept,
      total,
      gain,
      verdict: worthIt ? "worth it" : "no measurable benefit",
    })
  }

  // The set the old code printed: every isolated winner, defaults elsewhere.
  /** @type {Record<string, number>} */
  const naiveCutoffs = { ...base }
  for (const v of verdicts) if (v.candidate !== null) naiveCutoffs[v.key] = v.candidate
  const naiveScore = withCutoffs(naiveCutoffs)

  // Never stricter than the defaults already are: if the shipped gate keeps less
  // than a quarter of the labelled set, that is the floor, not a quarter.
  const floor = Math.min(baseline.kept, Math.ceil(total * GATE_JOINT_MIN_KEPT_FRACTION))

  /** @type {Record<string, number>} */
  const cutoffs = { ...base }
  let current = baseline
  /** @type {string[]} */
  const adopted = []
  /** @type {string[]} */
  const rejected = []
  // A candidate equal to the default is not a change and must not be reported as
  // one — the sweep found it because it beats the axis's WIDE-OPEN end, which is
  // the shipped gate agreeing with itself.
  const ordered = verdicts
    .filter((v) => v.candidate !== null && v.candidate !== v.defaultValue)
    .sort((a, b) => b.gain - a.gain)
  for (const v of ordered) {
    const candidate = /** @type {number} */ (v.candidate)
    const trial = { ...cutoffs, [v.key]: candidate }
    const scored = withCutoffs(trial)
    const meaningful = scored.kept >= floor && Number.isFinite(scored.auc) && Number.isFinite(scored.rank1)
    if (meaningful && gateScore(scored) > gateScore(current) + GATE_WORTH_IT) {
      cutoffs[v.key] = candidate
      current = scored
      adopted.push(v.key)
    } else {
      rejected.push(v.key)
    }
  }

  return {
    cutoffs,
    result: { value: NaN, kept: current.kept, total, auc: current.auc, rank1: current.rank1 },
    naiveCutoffs,
    naive: { value: NaN, kept: naiveScore.kept, total, auc: naiveScore.auc, rank1: naiveScore.rank1 },
    adopted,
    rejected,
    floor,
    verdicts,
  }
}

// ---------------------------------------------------------------------------
// Report E — cost
// ---------------------------------------------------------------------------

/**
 * `matchedIou` holds, per detect-edge box, the best IoU found among the
 * source-edge boxes for the same photograph. So "recall" here is: of the faces
 * the expensive resolution found, what fraction did the cheap one also find.
 *
 * The matching is best-effort, not injective — two detect-edge boxes could both
 * claim one source-edge box — so the number is an upper bound on recall and the
 * summary says so rather than implying a precision it does not have.
 * @param {readonly Types.Session1ResolutionRecord[]} records
 * @param {number} [iouMatch]
 */
export function resolutionSummary(records, iouMatch = BOX_MATCH_IOU) {
  let atDetect = 0
  let atSource = 0
  let matched = 0
  /** @type {number[]} */
  const ious = []
  for (const r of records) {
    atDetect += r.atDetectEdge
    atSource += r.atSourceEdge
    for (const iou of r.matchedIou ?? []) {
      ious.push(iou)
      if (iou >= iouMatch) matched++
    }
  }
  ious.sort((a, b) => a - b)
  return {
    photos: records.length,
    atDetect,
    atSource,
    matched,
    extra: Math.max(0, atDetect - matched),
    recall: atSource > 0 ? matched / atSource : NaN,
    iouPercentiles: {
      p05: percentile(ious, 0.05),
      p50: percentile(ious, 0.5),
      p95: percentile(ious, 0.95),
    },
  }
}

/**
 * IoU against the macOS Vision oracle. The oracle reports boxes in ITS OWN
 * frame (`w`/`h` per record), which is not the run's source buffer, so every
 * oracle box is scaled before comparison.
 *
 * If the two frames disagree on aspect ratio the photograph is almost certainly
 * rotated and the oracle read it unrotated — the known `orientation: .up` bug in
 * oracle-macos.swift. Those records are counted and skipped rather than scored,
 * because scoring them produces a recall of roughly zero that says nothing about
 * the detector.
 * @param {Types.LoadedRun} run
 * @param {readonly Types.OracleRecord[]} oracle
 * @param {number} [iouMatch]
 */
export function oracleSummary(run, oracle, iouMatch = BOX_MATCH_IOU) {
  // ⚠ Joined on the FULL path, not the basename. Photo deliveries repeat the
  // same basename across folders — that is why the run deduplicates at all — so
  // a basename map silently hands one photograph another photograph's faces, and
  // every disagreement it causes reads as a detector fault. The oracle records
  // absolute paths and the run records paths relative to its root, so match by
  // suffix and refuse any suffix that more than one oracle row satisfies.
  /** @type {Map<string, Types.OracleRecord[]>} */
  const byBase = new Map()
  for (const rec of oracle) {
    if (rec.error) continue
    const key = path.basename(rec.path)
    const list = byBase.get(key)
    if (list) list.push(rec)
    else byBase.set(key, [rec])
  }
  /**
   * @param {string} relative
   * @returns {Types.OracleRecord | null | undefined} null = ambiguous, undefined = absent
   */
  const lookup = (relative) => {
    const candidates = byBase.get(path.basename(relative))
    if (!candidates) return undefined
    const suffix = relative.startsWith("/") ? relative : "/" + relative
    const exact = candidates.filter((r) => r.path === relative || r.path.endsWith(suffix))
    if (exact.length === 1) return exact[0]
    if (exact.length > 1) return null
    if (candidates.length === 1) return candidates[0]
    // The basename collides with several oracle rows but none of their paths
    // matches this photograph's — that is a photo the oracle never saw, not an
    // ambiguity between rows. Reporting it as ambiguous hides an oracle run
    // that covered a different directory tree.
    return undefined
  }

  /** @type {Map<number, Types.Session1FaceRecord[]>} */
  const facesByPhoto = new Map()
  for (const face of run.faces) {
    const list = facesByPhoto.get(face.photoId)
    if (list) list.push(face)
    else facesByPhoto.set(face.photoId, [face])
  }

  let photos = 0
  let oracleFaces = 0
  let oracleMatched = 0
  let ourFaces = 0
  let ourMatched = 0
  let frameMismatch = 0
  let missing = 0
  let ambiguous = 0
  let eyeChecked = 0
  let eyeFlipped = 0
  let mouthChecked = 0
  let mouthFlipped = 0
  /** @type {number[]} */
  const eyeOffsets = []
  /** @type {number[]} */
  const noseOffsets = []

  for (const photo of run.photos) {
    const rec = lookup(photo.relative)
    if (rec === null) {
      ambiguous++
      continue
    }
    if (!rec) {
      missing++
      continue
    }
    if (!(rec.w > 0) || !(rec.h > 0) || !(photo.width > 0) || !(photo.height > 0)) {
      frameMismatch++
      continue
    }
    const sx = photo.width / rec.w
    const sy = photo.height / rec.h
    if (Math.abs(sx - sy) > 0.02 * Math.max(sx, sy)) {
      frameMismatch++
      continue
    }
    photos++
    const ourFaceRows = facesByPhoto.get(photo.id) ?? []
    const ours = ourFaceRows.map((f) => f.box)
    const scaled = (rec.faces ?? []).map((f) => ({
      box: { x: f.x * sx, y: f.y * sy, w: f.w * sx, h: f.h * sy },
      leftEye: f.leftEye ? [f.leftEye[0] * sx, f.leftEye[1] * sy] : null,
      rightEye: f.rightEye ? [f.rightEye[0] * sx, f.rightEye[1] * sy] : null,
      noseTip: f.noseTip ? [f.noseTip[0] * sx, f.noseTip[1] * sy] : null,
      mouthImgLeft: f.mouthImgLeft ? [f.mouthImgLeft[0] * sx, f.mouthImgLeft[1] * sy] : null,
      mouthImgRight: f.mouthImgRight ? [f.mouthImgRight[0] * sx, f.mouthImgRight[1] * sy] : null,
    }))
    const theirs = scaled.map((f) => f.box)
    oracleFaces += theirs.length
    ourFaces += ours.length
    for (const t of theirs) {
      let best = 0
      for (const o of ours) best = Math.max(best, boxIou(t, o))
      if (best >= iouMatch) oracleMatched++
    }
    ourFaceRows.forEach((row, i) => {
      let best = 0
      let bestFace = null
      for (const t of scaled) {
        const overlap = boxIou(ours[i], t.box)
        if (overlap > best) {
          best = overlap
          bestFace = t
        }
      }
      if (best >= iouMatch) ourMatched++
      if (best < iouMatch || !bestFace) return

      /** @param {number[]} a @param {number[]} b */
      const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

      // Our own eye positions and their separation, by ORDER (landmark columns
      // 0-1 are the subject's right eye, 2-3 the left — align.js's
      // LANDMARK_ORDER and the detector's own decode comment). Computed
      // unconditionally: it is a fact about OUR landmarks alone, independent of
      // whatever the oracle emitted, and it is the shared scale every scale-free
      // offset below (eye or nose) divides by.
      const oursRight = [row.landmarks[0], row.landmarks[1]]
      const oursLeft = [row.landmarks[2], row.landmarks[3]]
      const sep = gap(oursLeft, oursRight)

      if (bestFace.leftEye && bestFace.rightEye) {
        // ⚠ THE MIRROR CHECK, against a measurement that is genuinely independent
        // of ours. The alignment residual catches a landmark order that disagrees
        // with the TEMPLATE; it cannot catch a mirroring that is consistent all the
        // way through, because a consistent mirror fits perfectly. Only a second
        // detector's eyes can see that, which is why SESSION-1 promised this check.
        //
        // ⚠ NEVER COMPARE THE TWO SOURCES BY THEIR EYE NAMES. Vision names eyes
        // from the IMAGE's point of view; our landmark order names them from the
        // SUBJECT's. The same physical eye therefore carries the opposite word.
        //
        // This is worth stating at length because getting it wrong is silent and
        // symmetrical, and it was gotten wrong in BOTH directions while this check
        // was being written: matching name-to-name reports ~97% of faces mirrored,
        // and "correcting" that by inverting the comparison reports ~97% again.
        // Neither is a fact about the pipeline. Both are the naming clash.
        //
        // So neither source's vocabulary is trusted. Ours is anchored by ORDER
        // (landmark columns 4-5 are the subject's right eye, per the detector's own
        // decode comment) and theirs by GEOMETRY (whichever point is further left in
        // the frame). For an upright face the subject's right eye IS the image-left
        // one, so the correct pairing is ours-subject-right to theirs-image-left.
        // Then score both pairings by distance and let the closer one win, which
        // also keeps a rolled head from being counted as a mirror.
        const theirsImageLeft = bestFace.leftEye[0] <= bestFace.rightEye[0] ? bestFace.leftEye : bestFace.rightEye
        const theirsImageRight = bestFace.leftEye[0] <= bestFace.rightEye[0] ? bestFace.rightEye : bestFace.leftEye

        const asExpected = gap(oursRight, theirsImageLeft) + gap(oursLeft, theirsImageRight)
        const asMirrored = gap(oursRight, theirsImageRight) + gap(oursLeft, theirsImageLeft)
        eyeChecked++
        if (asMirrored < asExpected) eyeFlipped++

        // How far apart the two detectors put the eyes, under whichever pairing
        // fits better — as a fraction of the subject's own eye separation, so a
        // big face and a small one contribute comparably. Alignment error
        // matters more for this recogniser than most: its head flattens a 7x7
        // grid instead of pooling it, so it has no translation invariance at the
        // end.
        if (sep > 0) eyeOffsets.push(Math.min(asExpected, asMirrored) / 2 / sep)
      }

      // The analogous check over the mouth corners, present only when the
      // oracle emitted them — older oracle files lack the key, which is why
      // OracleRecord marks it optional.
      //
      // Our landmark columns 6-7 are the subject's RIGHT mouth corner and 8-9
      // the subject's LEFT: align.js's LANDMARK_ORDER is [rightEye, leftEye,
      // nose, rightMouth, leftMouth], so after the two eye pairs (0-3) and the
      // nose pair (4-5) the mouth corners follow in that same right-then-left
      // order. Anchored by ORDER, exactly like the eyes above.
      //
      // The oracle's two points are already named by GEOMETRY rather than
      // vocabulary — oracle-macos.swift picks "mouthImgLeft"/"mouthImgRight" by
      // pixel x, deliberately neither Vision's naming nor ours, so there is no
      // naming clash left to fall into here (SESSION-2-vision.md §3). But the
      // pairing itself is still scored both ways rather than assumed correct:
      // that is what catches a genuinely swapped landmark order on our side,
      // the same way the eye check does.
      if (bestFace.mouthImgLeft && bestFace.mouthImgRight) {
        const oursRightMouth = [row.landmarks[6], row.landmarks[7]]
        const oursLeftMouth = [row.landmarks[8], row.landmarks[9]]
        const mouthExpected =
          gap(oursRightMouth, bestFace.mouthImgLeft) + gap(oursLeftMouth, bestFace.mouthImgRight)
        const mouthMirrored =
          gap(oursRightMouth, bestFace.mouthImgRight) + gap(oursLeftMouth, bestFace.mouthImgLeft)
        mouthChecked++
        if (mouthMirrored < mouthExpected) mouthFlipped++
      }

      // Nose tip: one point, not two, so there is no pairing to get wrong — a
      // straight scale-free offset, sharing eyeOffsets' own denominator so nose
      // and eye alignment headroom are directly comparable.
      if (bestFace.noseTip && sep > 0) {
        const oursNose = [row.landmarks[4], row.landmarks[5]]
        noseOffsets.push(gap(oursNose, bestFace.noseTip) / sep)
      }
    })
  }

  const sortedOffsets = eyeOffsets.slice().sort((a, b) => a - b)
  const sortedNoseOffsets = noseOffsets.slice().sort((a, b) => a - b)
  return {
    photos,
    missing,
    ambiguous,
    frameMismatch,
    oracleFaces,
    oracleMatched,
    ourFaces,
    ourMatched,
    recall: oracleFaces > 0 ? oracleMatched / oracleFaces : NaN,
    agreement: ourFaces > 0 ? ourMatched / ourFaces : NaN,
    eyeChecked,
    eyeFlipped,
    eyeOffsetPercentiles: {
      p50: percentile(sortedOffsets, 0.5),
      p90: percentile(sortedOffsets, 0.9),
      p99: percentile(sortedOffsets, 0.99),
    },
    mouthChecked,
    mouthFlipped,
    /** Present only when at least one matched face carried an oracle noseTip. */
    noseOffsetPercentiles:
      sortedNoseOffsets.length > 0
        ? {
            p50: percentile(sortedNoseOffsets, 0.5),
            p90: percentile(sortedNoseOffsets, 0.9),
            p99: percentile(sortedNoseOffsets, 0.99),
          }
        : null,
  }
}

/**
 * The residual distribution IS the mirror check. Reflection is excluded from the
 * similarity transform family, so a swapped or mirrored landmark order cannot be
 * absorbed by the fit — it turns up here as a systematically large error, and
 * nowhere else, because a mirrored crop looks entirely plausible.
 * @param {readonly Types.Session1FaceRecord[]} faces
 * @param {number} maxResidual
 */
export function residualSummary(faces, maxResidual) {
  const values = faces.map((f) => Number(f.signals.residual)).filter((v) => Number.isFinite(v))
  values.sort((a, b) => a - b)
  const above = values.filter((v) => v > maxResidual).length
  const hi = values.length > 0 ? Math.max(values[values.length - 1], maxResidual * 2) : 1
  return {
    n: values.length,
    above,
    maxResidual,
    percentiles: {
      p50: percentile(values, 0.5),
      p90: percentile(values, 0.9),
      p99: percentile(values, 0.99),
      max: values.length > 0 ? values[values.length - 1] : NaN,
    },
    histogram: histogram(values, 40, 0, hi),
  }
}

// ---------------------------------------------------------------------------
// The conclusion
// ---------------------------------------------------------------------------

/**
 * Which of report D's configurations the verdict should be read off, in order of
 * how much they can be trusted.
 *
 * 1. **The held-out estimate.** What the selection procedure achieves on people
 *    it did not see. The only one of the three that is both gated and unbiased.
 * 2. **The default gate.** Biased by nothing, because its nine cutoffs were set
 *    from published constants before these labels existed — but they are somebody
 *    else's numbers, so it understates a gate tuned to this input.
 * 3. **Ungated.** The last resort, and the wrong population: it describes a
 *    product that skips the stage whose entire job is removing the faces that
 *    cannot be described well.
 *
 * The in-sample joint result is deliberately NOT on this list at any priority.
 * It is the score of a search winner on its own search set, and there is no
 * configuration of this function under which it should be the verdict.
 *
 * `keptFraction` is the SHIPPED gate's, in every branch — the held-out folds each
 * chose their own cutoffs, but the gate that would actually ship is the one
 * selected on everything, so that is the one whose keep rate a reader needs.
 * @param {ReturnType<typeof reportD>} d
 * @returns {{ auc: number, fprAt95Tpr: number, rank1: number, keptFraction: number, label: string }}
 */
export function verdictBasis(d) {
  const total = d.joint.result.total
  // ⚠ Every branch here must clear MIN_VERDICT_PAIRS on BOTH pair counts, not
  // just be finite. `separation()` returns a finite AUC from a single pair on
  // each side, so "finite" alone let a confident headline print from almost no
  // evidence whenever the held-out estimate came back unmeasurable — the exact
  // failure SESSION-2 §2a documents. A basis that cannot clear the floor falls
  // through; if none can, the verdict is UNDECIDED, which is the truth.
  /** @param {number} same @param {number} diff @returns {boolean} */
  const powered = (same, diff) => same >= MIN_VERDICT_PAIRS && diff >= MIN_VERDICT_PAIRS
  if (d.heldOut && Number.isFinite(d.heldOut.auc) && powered(d.heldOut.samePairs, d.heldOut.diffPairs)) {
    return {
      auc: d.heldOut.auc,
      fprAt95Tpr: d.heldOut.fprAt95Tpr,
      rank1: d.heldOut.rank1,
      keptFraction: total > 0 ? d.joint.result.kept / total : NaN,
      label: `held-out gate estimate (${d.heldOut.contributingFolds}-fold, pooled over people the selection never saw)`,
    }
  }
  if (Number.isFinite(d.baseline.auc) && powered(d.baseline.samePairs, d.baseline.diffPairs)) {
    return {
      auc: d.baseline.auc,
      fprAt95Tpr: d.baselineFprAt95Tpr,
      rank1: d.baseline.rank1,
      keptFraction: total > 0 ? d.baseline.kept / total : NaN,
      label: "default gate, whose cutoffs predate these labels and so cannot be overfitted to them",
    }
  }
  if (Number.isFinite(d.ungated.auc) && powered(d.ungated.samePairs, d.ungated.diffPairs)) {
    return {
      auc: d.ungated.auc,
      fprAt95Tpr: NaN,
      rank1: d.ungated.rank1,
      keptFraction: 1,
      label: "NO GATE AT ALL — the wrong population, reported only because nothing better could be measured",
    }
  }
  return {
    auc: NaN,
    fprAt95Tpr: NaN,
    rank1: NaN,
    keptFraction: NaN,
    label:
      `UNDER-POWERED — no configuration reached ${MIN_VERDICT_PAIRS} same-person and ` +
      `${MIN_VERDICT_PAIRS} different-person pairs, so no verdict is offered. Label more ` +
      `people, prioritising whoever recurs most.`,
  }
}

/**
 * SESSION-1 §4 wrote three predictions down in advance so the result would be
 * informative either way. This picks the one the numbers support, rather than
 * leaving the reader to infer it from a table.
 *
 * ⚠ THE BUG THIS SIGNATURE EXISTS TO PREVENT. An earlier version took the
 * UNGATED pool-A AUC, because that is report A's headline and report A is
 * labelled "THIS IS THE DECISION". But the product does not describe every
 * detection — the gate runs first, that is its entire purpose, and report D in
 * the same run measures what the gate is worth. Judging the feature on the
 * population it never sees understated the result by a whole verdict band, and
 * printed "grouping is the wrong product shape" directly beneath a table showing
 * the gate lifting AUC well past the threshold for the band above.
 *
 * So the caller must say which configuration these numbers came from, and
 * `basis` is required rather than defaulted — a default would let the same
 * mistake back in silently. `keptFraction` and `ungatedAuc` are carried so the
 * verdict can state the gate's contribution in the same breath: a reader who
 * takes a gated AUC to be true of every photograph has been misled just as
 * badly, in the other direction.
 * @param {object} input
 * @param {number} input.auc
 * @param {number} input.fprAt95Tpr
 * @param {number} input.rank1
 * @param {string} input.basis which configuration `auc`/`rank1` were measured under
 * @param {number} input.ungatedAuc the same AUC with every check wide open
 * @param {number} input.keptFraction share of labelled faces the basis gate keeps
 * @param {boolean} input.weldFreeCutoffExists whether report B found a cutoff that welded nobody
 * @param {number} input.recoverablePeople
 * @param {number} input.people
 * @returns {{ headline: string, description: string, detail: string[] }}
 */
export function verdict(input) {
  const { auc, fprAt95Tpr, rank1, basis, ungatedAuc, keptFraction, weldFreeCutoffExists, recoverablePeople, people } = input
  const share = people > 0 ? recoverablePeople / people : NaN

  /** @type {string[]} */
  const detail = []
  let headline
  let description

  if (!Number.isFinite(auc)) {
    headline = "UNDECIDED — not enough independent pairs to measure separation"
    description = "Label more faces, or label people who appear in more than one part of the day."
  } else if (auc >= 0.98 && fprAt95Tpr <= 0.02) {
    headline = "CLEAN SEPARATION — a single global cutoff works across everybody"
    description = weldFreeCutoffExists
      ? "The feature can honestly be described as tagging people, and unsupervised grouping is a reasonable product shape."
      : "The feature can honestly be described as tagging people — on the faces the gate keeps."
    // The separation number and the grouping sweep are measured on DIFFERENT
    // populations: separation on gated pool A, report B's sweep on every face
    // there is. So they can disagree without either being wrong, and the
    // disagreement is informative rather than an error to reconcile away. What
    // it must not do is let the verdict assert a product shape that the sweep
    // in the same report found no safe operating point for.
    if (!weldFreeCutoffExists) {
      detail.push(
        "But report B found NO cutoff that welds nobody, because it sweeps every face while this number " +
          "is measured on the gated ones. Unsupervised grouping therefore has no safe operating point on the " +
          "full set; prototypes (SESSION-1 §5 Q2) need no global cutoff and do not inherit the problem.",
      )
    }
  } else if (auc >= 0.9) {
    headline = "REAL SIGNAL, IMPERFECT CUTOFF — no one threshold is right for everybody"
    description =
      'This is SESSION-1 §4\'s prediction. The honest description of the feature is "finds the people who are actually in the photographs a lot", not "tags everyone".'
    detail.push("Prefer label-a-few-and-classify (SESSION-1 §5 Q2) over cluster-and-name: per-person prototypes need no single global cutoff.")
    detail.push("Grouping's remaining job is to make the first labelling cheap, which means deliberately over-splitting is correct.")
  } else if (auc >= 0.75) {
    headline = "WEAK SIGNAL — grouping is the wrong product shape"
    description =
      "There is something in the descriptors, but not enough for a threshold. Face-aware crops (which need no descriptors at all) are the part of this worth shipping."
  } else {
    headline = "NO USABLE SIGNAL on this input"
    description = "Do not spend four weeks hand-writing kernels for this. Check the mirror/residual report first — a swapped landmark order looks exactly like this."
  }

  if (Number.isFinite(rank1)) {
    detail.push(
      rank1 >= 0.9
        ? "Prototype rank-1 is high: matching against a few confirmed faces per person works even where a global cutoff does not."
        : "Prototype rank-1 is not high either, so the limit is the descriptors, not the clustering.",
    )
  }
  if (Number.isFinite(share)) {
    detail.push(
      `${recoverablePeople} of ${people} labelled people are recovered reliably — the feature is about those people, and the interface should say so.`,
    )
  }
  // Always last, and never omitted: the sentence that stops the headline from
  // being read as a property of every photograph rather than of the ones the
  // gate keeps. Shipping the numbers without shipping the gate would deliver the
  // ungated result and the surprise that goes with it.
  if (Number.isFinite(auc)) {
    const gap = Number.isFinite(ungatedAuc) ? ` Ungated it is ${ungatedAuc.toFixed(4)}` : ""
    const kept = Number.isFinite(keptFraction) ? `, over the ${(keptFraction * 100).toFixed(0)}% of labelled faces that gate keeps` : ""
    detail.push(`Measured under the ${basis}${kept}.${gap} — the gate is not optional, it is doing this much of the work.`)
  }
  return { headline, description, detail }
}

/**
 * ⚠ `timing.stages` contains a `total` entry alongside the parts it is the total
 * OF. Summing every stage therefore adds the whole to its own pieces and roughly
 * doubles the denominator, which halves every share the report prints and halves
 * the priced cost of raising the detector's resolution — an error that makes an
 * expensive change look affordable.
 *
 * So: wall-clock is `total` when the run recorded one, and only the sum of the
 * parts otherwise. `parts` is what a per-stage table iterates; `wallMs` is what
 * shares divide by. The two are deliberately separate values.
 * @param {Types.Session1Timing} timing
 * @returns {{ parts: Array<[string, { ms: number, n: number }]>, wallMs: number, measuredMs: number, hasWall: boolean }}
 */
export function stageBreakdown(timing) {
  /** @type {Array<[string, { ms: number, n: number }]>} */
  const parts = []
  let measuredMs = 0
  let wallMs = 0
  let hasWall = false
  for (const [name, s] of Object.entries(timing.stages)) {
    if (name === TOTAL_STAGE) {
      wallMs = s.ms
      hasWall = s.ms > 0
      continue
    }
    parts.push([name, s])
    measuredMs += s.ms
  }
  if (!hasWall) wallMs = measuredMs
  return { parts, wallMs, measuredMs, hasWall }
}

/**
 * What raising the detector's long edge costs, from the run's own stage timings.
 * Detector cost scales with PIXEL COUNT, so the edge ratio is squared, and
 * report E already knows what share of the run detect was — which turns "the
 * cheap resolution loses faces" from a free win into a trade with a price on it.
 *
 * Returns null when there is no timing to price it from; the caller then says
 * the cost is unmeasured rather than implying there is none.
 * @param {Types.Session1Timing | null} timing
 * @param {number} fromEdge
 * @param {number} toEdge
 * @returns {{ pixelRatio: number, detectShare: number, runRatio: number } | null}
 */
export function resolutionCost(timing, fromEdge, toEdge) {
  if (!timing || !(fromEdge > 0) || !(toEdge > 0)) return null
  const detect = timing.stages.detect
  if (!detect || !(detect.ms > 0)) return null
  const totalMs = stageBreakdown(timing).wallMs
  if (!(totalMs > 0)) return null
  const pixelRatio = (toEdge / fromEdge) ** 2
  return {
    pixelRatio,
    detectShare: detect.ms / totalMs,
    runRatio: (totalMs + detect.ms * (pixelRatio - 1)) / totalMs,
  }
}

/**
 * The detect edge the run ACTUALLY used, not the current default — a run made
 * before someone edited defaults.js must still be priced against what it did.
 * `Session1Timing.config` declares `detectEdge?: number`, so the only thing left
 * to establish is that a run wrote one; `resolutionCost` rejects a
 * non-positive edge on its own.
 * @param {Types.Session1Timing | null} timing
 * @returns {number}
 */
function configuredDetectEdge(timing) {
  return timing?.config.detectEdge ?? allDefaults().detect.longEdge
}

/**
 * Why one gate cutoff ended up where it did. Four outcomes, and the difference
 * between the middle two is the whole point of the joint pass: "helped alone,
 * earned nothing together" is a finding, and reporting it as "no benefit" would
 * hide it. Two renderings of the same four, so the summary column and the
 * paste-block comment can never drift apart.
 * @param {Types.JointGate} joint
 * @param {string} key
 * @returns {string}
 */
function gateVerdictLabel(joint, key) {
  if (joint.adopted.includes(key)) return "worth it, adopted"
  if (joint.rejected.includes(key)) return "worth it alone, not jointly"
  const found = joint.verdicts.find((v) => v.key === key)
  if (found && found.candidate !== null) return "already the default"
  return "no measurable benefit"
}

/**
 * The same four outcomes, as the note that goes beside the value to paste.
 * @param {Types.JointGate} joint
 * @param {string} key
 * @returns {string}
 */
function gateNote(joint, key) {
  if (joint.adopted.includes(key)) return "improved the gate with the other eight checks in force"
  if (joint.rejected.includes(key)) return "unchanged — helped alone, earned nothing on top of the rest"
  const found = joint.verdicts.find((v) => v.key === key)
  if (found && found.candidate !== null) return "unchanged — the sweep's own best IS the default"
  return "unchanged — no measured benefit on this input"
}

/**
 * ⚠ Every gate value here comes from `d.joint.cutoffs` — the set the joint
 * evaluation actually measured — and never from the nine independent sweeps
 * directly. Taking the winner of each sweep produces a configuration that was
 * never run; see `jointGate`.
 * @param {object} input
 * @param {Types.SweepPoint | null} input.best
 * @param {boolean} input.weldFree whether `best` welded nobody, or is merely the least bad
 * @param {ReturnType<typeof reportD>} input.d
 * @param {ReturnType<typeof resolutionSummary> | null} input.resolution
 * @param {{ auc: number, rank1: number, mirrorAuc: number, mirrorRank1: number } | null} input.mirror
 * @param {Types.Session1Timing | null} [input.timing]
 * @returns {Types.Recommendation[]}
 */
export function recommendations(input) {
  /** @type {Types.Recommendation[]} */
  const out = []

  if (input.best) {
    out.push({
      path: "group.cutoff",
      value: String(input.best.cutoff),
      note: input.weldFree
        ? "best pair-F1 among the cutoffs that welded nobody, with cannot-link on"
        : `best pair-F1 with cannot-link on — NO cutoff welded nobody, this one welds ${input.best.quality.weldedGroups}`,
    })
  }

  const joint = input.d.joint
  for (const axis of input.d.keys) {
    const value = joint.cutoffs[axis.key] ?? axis.defaultValue
    out.push({ path: `gate.${axis.key}`, value: String(value), note: gateNote(joint, axis.key) })
  }

  if (input.mirror) {
    const better = input.mirror.mirrorAuc > input.mirror.auc + GATE_WORTH_IT || input.mirror.mirrorRank1 > input.mirror.rank1 + GATE_WORTH_IT
    out.push({
      path: "describe.mirrorAverage",
      value: String(better),
      note: better ? "mirror averaging moved a headline number" : "mirror averaging costs 2x and moved nothing",
    })
  }

  if (input.resolution && Number.isFinite(input.resolution.recall)) {
    const cheapIsEnough = input.resolution.recall >= 0.95
    const from = configuredDetectEdge(input.timing ?? null)
    const to = allDefaults().detect.sourceEdge
    const cost = cheapIsEnough ? null : resolutionCost(input.timing ?? null, from, to)
    /** @type {string} */
    let note
    if (cheapIsEnough) {
      note = "the cheap resolution recovers what the expensive one finds — and costs less"
    } else if (cost) {
      note =
        `finds faces the cheap edge misses, at ${num(cost.pixelRatio, 1)}x the detect pixels ` +
        `(detect = ${pct(cost.detectShare)} of stage time, so ~${num(cost.runRatio, 2)}x the run)`
    } else {
      note = "the cheap resolution loses faces the expensive one finds; cost unpriced (no timing.json)"
    }
    out.push({ path: "detect.longEdge", value: cheapIsEnough ? String(from) : String(to), note })
  }

  return out
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * The gate configurations report B's sweep and the coverage table are both run
 * against. Built per-run rather than at module scope because the recommended
 * set is a property of the run.
 * @param {Types.JointGate} joint
 * @param {Record<string, number>} defaults
 * @returns {Array<{ label: string, cutoffs: Record<string, number> | null }>}
 */
function gatedSweepBases(joint, defaults) {
  const bases = [
    { label: "every labelled face (no gate)", cutoffs: null },
    { label: "shipped default gate", cutoffs: defaults },
  ]
  if (joint && joint.adopted.length > 0) {
    bases.push({ label: "recommended gate", cutoffs: joint.cutoffs })
  }
  return bases
}

/**
 * @param {Types.LoadedRun} run
 * @param {{ oracle?: readonly Types.OracleRecord[] | null, folds?: number }} [options]
 */
export function analyse(run, options = {}) {
  const defaults = allDefaults()

  const poolA = buildView(run, { pool: "A", requireLabel: true })
  const labelled = buildView(run, { requireLabel: true })
  const everything = buildView(run)

  const a = reportA(poolA)
  const headline = pickHeadline(a.strata)

  // Cutoffs come from the run's own distance distribution (SPEC §6.2), taken
  // from the deduplicated stratum: the "all pairs" one would place the ladder
  // over a same-person mass that duplicate frames pushed toward zero.
  const dedupSpec = separationStrata(poolA).find((s) => s.key === "dedup")
  const dedupPairs = pairDistances(poolA.set, {
    labels: poolA.labels,
    keep: dedupSpec ? (dedupSpec.keep ?? undefined) : undefined,
  })
  const cutoffs = sweepCutoffs(dedupPairs.same, dedupPairs.diff)
  const points = sweepGrouping(everything.set, {
    cutoffs,
    labels: everything.labels,
    photoIds: everything.photoIds,
  })
  const bestPick = bestSweepPoint(points)
  const best = bestPick ? bestPick.point : null

  const c = leaveOneOutRank1(labelled.set, labelled.labels)

  // ⚠ REPORT C SPLIT BY POOL, and pool A is the number to quote.
  //
  // Pool A is a uniform sample, labelled one crop at a time. Pool B is labelled a
  // whole detector group per keystroke — which is what makes labelling fast and
  // also what makes its labels partly a function of the model's own opinion. Two
  // mechanisms push the same way: a label agrees with the grouping by
  // construction, and working through groups means the tidy ones get labelled
  // while the awkward tail does not. Reporting one blended figure lets pool B's
  // volume carry the headline. Both are printed; only pool A is honest.
  //
  // The mask narrows the QUERIES only. Prototypes still come from everybody, so
  // the candidate pool is the same size and the two figures are comparable —
  // picking the right person out of six is not picking them out of thirty.
  const poolAIds = new Set(poolA.faceIds)
  const poolBIds = new Set(buildView(run, { pool: "B", requireLabel: true }).faceIds)
  const cByPool = {
    poolA: leaveOneOutRank1(labelled.set, labelled.labels, {
      queryMask: labelled.faceIds.map((id) => poolAIds.has(id)),
    }),
    poolB: leaveOneOutRank1(labelled.set, labelled.labels, {
      queryMask: labelled.faceIds.map((id) => poolBIds.has(id)),
    }),
  }

  const d = reportD(run, headline.key, { folds: options.folds })

  // ⚠ THE POPULATION BUG THIS EXISTS TO NOT HAVE.
  //
  // The sweep above runs over every labelled face, including the ones the gate is
  // there to discard — a population no shipped configuration ever groups. Judging
  // the product shape from it asks how grouping behaves on input it will never
  // see, and the answer is predictably grim. Grouping runs AFTER the gate, so the
  // sweep that decides whether grouping is viable has to run after it too.
  //
  // Both are reported: the difference between them is the gate's contribution to
  // grouping, which is otherwise invisible.
  const gateBases = gatedSweepBases(d.joint, { minScore: 0, ...defaults.gate })
  const gatedSweeps = gateBases.map(({ label, cutoffs }) => {
    /** @type {Set<number>} */
    const passing = new Set()
    for (const face of run.faces) {
      if (cutoffs === null || applyGate(face.signals, cutoffs).pass) passing.add(face.id)
    }
    const view = buildView(run, { requireLabel: true, include: (f) => passing.has(f.id) })
    if (view.labels.length === 0) return null
    return {
      label,
      faces: view.labels.length,
      total: labelled.labels.length,
      points: sweepGrouping(view.set, { cutoffs: sweepCutoffs(dedupPairs.same, dedupPairs.diff), labels: view.labels, photoIds: view.photoIds }),
    }
  }).filter((s) => s !== null)

  // ⚠ THE PRODUCT NUMBER THE GATE IS OTHERWISE SCORED WITHOUT.
  //
  // Every gate cutoff is chosen by maximising separation and rank-1, and both go
  // UP when faces are discarded — the degenerate optimum keeps one clear face per
  // person and scores near-perfect while tagging almost nothing. Only a floor on
  // how much may be thrown away restrains it, and a floor is not a price.
  //
  // The honest unit is not the face. A person who appears in a photograph is
  // tagged in it if ANY surviving face carries them, so what the gate actually
  // costs is person-in-a-frame appearances — keyed on the duplicate-frame root so
  // a retouched copy of one shot is not counted as a second chance.
  //
  // ⚠ AND SPLIT BY POOL, for the same reason rank-1 is (report C above): pool B's
  // labels exist disproportionately where the model's own grouping was tidy,
  // which is also where the gate signals are easy. A blended coverage table
  // therefore overstates how much of the real population a gate keeps. Pool A is
  // the number to quote; the blend is printed for volume, explicitly caveated.
  /** @param {Types.FaceView} view */
  const coverageRows = (view) =>
    gateBases.map(({ label, cutoffs }) => {
      /** @type {Set<string>} */
      const present = new Set()
      /** @type {Set<string>} */
      const kept = new Set()
      let faces = 0
      view.labels.forEach((personLabel, row) => {
        if (personLabel === null) return
        const key = personLabel + "@" + view.frames[row]
        present.add(key)
        if (cutoffs !== null && !applyGate(view.records[row].signals, cutoffs).pass) return
        faces++
        kept.add(key)
      })
      return {
        label,
        faces,
        totalFaces: view.labels.length,
        appearancesKept: kept.size,
        appearances: present.size,
      }
    })
  const coverage = {
    poolA: coverageRows(poolA),
    blended: coverageRows(labelled),
  }

  /** @type {{ auc: number, rank1: number, mirrorAuc: number, mirrorRank1: number } | null} */
  let mirror = null
  if (run.faces.some((f) => f.mirrorDescriptor && f.mirrorDescriptor.length > 0)) {
    const poolAMirror = buildView(run, { pool: "A", requireLabel: true, mirror: true })
    const labelledMirror = buildView(run, { requireLabel: true, mirror: true })
    const spec = separationStrata(poolAMirror).find((s) => s.key === headline.key)
    const pairs = pairDistances(poolAMirror.set, {
      labels: poolAMirror.labels,
      keep: spec ? (spec.keep ?? undefined) : undefined,
    })
    mirror = {
      auc: headline.report.auc,
      rank1: c.rank1,
      mirrorAuc: separation(pairs.same, pairs.diff).auc,
      mirrorRank1: leaveOneOutRank1(labelledMirror.set, labelledMirror.labels).rank1,
    }
  }

  const resolution = run.resolution.length > 0 ? resolutionSummary(run.resolution) : null
  const oracle = options.oracle && options.oracle.length > 0 ? oracleSummary(run, options.oracle) : null
  const residual = residualSummary(run.faces, defaults.gate.maxResidual)

  const recoverable = c.perPerson.filter((p) => p.rank1 >= 0.8).length
  const shipped = gatedSweeps.length > 0 ? gatedSweeps[gatedSweeps.length - 1] : null
  const shippedSweep = shipped ? bestSweepPoint(shipped.points) : null
  const basis = verdictBasis(d)
  const conclusion = verdict({
    auc: basis.auc,
    fprAt95Tpr: basis.fprAt95Tpr,
    rank1: basis.rank1,
    basis: basis.label,
    ungatedAuc: d.ungated.auc,
    keptFraction: basis.keptFraction,
    // Judged on the population a shipped pipeline would actually group — the
    // last, most selective gate configuration — not on every face there is.
    // Grouping runs after the gate, so the verdict about grouping must too.
    weldFreeCutoffExists: shippedSweep ? shippedSweep.weldFree : bestPick ? bestPick.weldFree : false,
    recoverablePeople: recoverable,
    people: c.perPerson.length,
  })

  return {
    counts: {
      photos: run.photos.length,
      faces: run.faces.length,
      labelled: labelled.labels.length,
      poolA: poolA.labels.length,
      poolB: buildView(run, { pool: "B", requireLabel: true }).labels.length,
      notAFace: run.labels ? Object.values(run.labels.labels).filter((v) => v === NOT_A_FACE).length : 0,
      duplicateFrames: run.photos.filter((p) => p.exactDuplicateOf != null || p.nearDuplicateOf != null).length,
    },
    a,
    headline,
    b: {
      cutoffs,
      points,
      best,
      // False means no swept cutoff avoided welding two people together, so
      // `best` is the least-bad of a bad set rather than the safe choice the
      // recommendation is normally phrased as. The print path MUST branch on it.
      weldFree: bestPick ? bestPick.weldFree : false,
      representative: representativeSweep(points, best),
      // The same sweep re-run over each gate configuration. The last entry is
      // the population a shipped pipeline actually groups; the first is the one
      // the sweep used to be judged on.
      gated: gatedSweeps,
      gatedBest: gatedSweeps.map((s) => ({ label: s.label, faces: s.faces, total: s.total, pick: bestSweepPoint(s.points) })),
    },
    c,
    cByPool,
    coverage,
    d,
    e: { timing: run.timing, resolution, oracle, mirror, residual },
    verdict: conclusion,
    recommended: recommendations({
      best,
      weldFree: bestPick ? bestPick.weldFree : false,
      d,
      resolution,
      mirror,
      timing: run.timing,
    }),
  }
}

// ---------------------------------------------------------------------------
// Terminal summary
// ---------------------------------------------------------------------------

/** @param {number} value @param {number} [digits] @returns {string} */
function num(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a"
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "-∞"
  return value.toFixed(digits)
}

/** @param {number} value @returns {string} */
function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a"
}

/** A difference, always signed, so a "+" is never mistaken for a level.
 * @param {number} value @param {number} [digits] @returns {string} */
function signed(value, digits = 3) {
  if (!Number.isFinite(value)) return "n/a"
  return (value < 0 ? "" : "+") + value.toFixed(digits)
}

/** A difference between two rates, in percentage POINTS — not a percentage of a
 * percentage, which is how a +1pp move gets reported as +1%.
 * @param {number} value @returns {string} */
function ppDelta(value) {
  if (!Number.isFinite(value)) return "n/a"
  return (value < 0 ? "" : "+") + (value * 100).toFixed(1) + "pp"
}

/** @param {string} text @param {number} width @returns {string} */
function pad(text, width) {
  return text.length >= width ? text : text + " ".repeat(width - text.length)
}

/** @param {string} text @param {number} width @returns {string} */
function padLeft(text, width) {
  return text.length >= width ? text : " ".repeat(width - text.length) + text
}

const RULE = "=".repeat(78)
const THIN = "-".repeat(78)

/**
 * @param {ReturnType<typeof analyse>} analysis
 * @param {(line: string) => void} [log]
 * @param {{ verbose?: boolean }} [options]
 */
export function printSummary(analysis, log = console.log, options = {}) {
  const { a, headline, b, c, d, e } = analysis
  const verbose = options.verbose === true

  log(RULE)
  log(" SESSION 1 — does this work")
  log(RULE)
  log(
    ` ${analysis.counts.photos} photographs, ${analysis.counts.faces} detections, ` +
      `${analysis.counts.labelled} labelled (pool A ${analysis.counts.poolA}, pool B ${analysis.counts.poolB}), ` +
      `${a.people} people`,
  )
  log(` ${analysis.counts.duplicateFrames} photographs are duplicate frames of another; ${analysis.counts.notAFace} detections marked not-a-face`)
  if (a.poolAssumed) log(" ! labels.json carried no pool map — every labelled face was treated as pool A")
  if (a.facesWithoutTime > 0) log(` ! ${a.facesWithoutTime} pool-A faces have no EXIF capture time and drop out of every time stratum`)

  log("")
  log(RULE)
  log(" REPORT A — SEPARATION (pool A only). THIS IS THE DECISION.")
  log(RULE)
  if (headline.key !== a.honestKey) {
    log(" !! The different-hour stratum is too thin to be a measurement, so the")
    log(" !! headline falls back to all deduplicated pairs. It is contaminated by")
    log(" !! bursts. Treat it as an upper bound, not as a result.")
    log("")
  }
  log(` HEADLINE STRATUM: ${headline.title}`)
  log(` ${headline.note}`)
  log("")
  log(`   AUC              ${num(headline.report.auc, 4)}   <- threshold-free: does the signal exist at all`)
  log(`   EER              ${num(headline.report.eer, 4)}  at distance ${num(headline.report.eerThreshold)}`)
  log(`   best threshold   ${num(headline.report.bestThreshold)}   TPR ${pct(headline.report.bestTpr)} / FPR ${pct(headline.report.bestFpr)}`)
  log(`   FPR @ 95% TPR    ${pct(headline.report.fprAt95Tpr)}   <- to catch 95% of true matches, how often two people are confused`)
  log(`   pairs            ${headline.report.sameCount} same-person / ${headline.report.diffCount} different-person`)
  log("")
  log(" Every stratum, so the cost of each exclusion is visible:")
  log(
    "  " +
      pad("stratum", 34) +
      padLeft("same", 7) +
      padLeft("diff", 8) +
      padLeft("AUC", 8) +
      padLeft("EER", 8) +
      padLeft("thr", 8) +
      padLeft("FPR@95", 9),
  )
  for (const s of a.strata) {
    log(
      "  " +
        pad((s.honest ? "* " : "  ") + s.title, 34) +
        padLeft(String(s.report.sameCount), 7) +
        padLeft(String(s.report.diffCount), 8) +
        padLeft(num(s.report.auc, 4), 8) +
        padLeft(num(s.report.eer, 4), 8) +
        padLeft(num(s.report.bestThreshold), 8) +
        padLeft(pct(s.report.fprAt95Tpr), 9),
    )
  }
  log("")
  log(" DO NOT QUOTE THE SAME-MINUTE ROW. Two frames from one burst make two")
  log(" near-identical descriptors; a same-person pair drawn from them measures")
  log(" the shutter. The starred row is the one that is evidence.")

  log("")
  log(RULE)
  log(" REPORT C — PROTOTYPE RANK-1. THIS DECIDES SESSION-1 §5 Q2.")
  log(RULE)
  const cp = analysis.cByPool
  log(` POOL A rank-1     ${pct(cp.poolA.rank1)}  (${cp.poolA.correct}/${cp.poolA.evaluated})  <- QUOTE THIS ONE`)
  log(" Pool A is the uniform sample, labelled one crop at a time. It is the only")
  log(" figure here that is not partly a measurement of the model marking its own work.")
  log(` pool B rank-1     ${pct(cp.poolB.rank1)}  (${cp.poolB.correct}/${cp.poolB.evaluated})`)
  log(` blended           ${pct(c.rank1)}  (${c.correct}/${c.evaluated})  <- dominated by pool B's volume`)
  if (Number.isFinite(cp.poolA.rank1) && Number.isFinite(cp.poolB.rank1) && cp.poolB.rank1 - cp.poolA.rank1 > 0.02) {
    log("")
    log(" ! POOL B SCORES HIGHER THAN POOL A, which is the signature of the labelling")
    log(" ! route rather than of the recogniser. Pool B is assigned a whole detector")
    log(" ! group per keystroke, so its labels agree with the grouping by construction,")
    log(" ! and working through groups labels the tidy ones while the awkward tail is")
    log(" ! left. Both effects inflate pool B. The blended figure is not the result.")
  }
  log("")
  log(` margin p05/p25/p50/p75  ${num(c.marginPercentiles.p05)} / ${num(c.marginPercentiles.p25)} / ${num(c.marginPercentiles.p50)} / ${num(c.marginPercentiles.p75)}`)
  log(` ${c.singletonPeople} people have a single face and could not be evaluated at all`)
  log("")
  log("  " + pad("person", 14) + padLeft("faces", 7) + padLeft("rank-1", 9))
  for (const p of c.perPerson) {
    log("  " + pad(p.label, 14) + padLeft(String(p.n), 7) + padLeft(pct(p.rank1), 9))
  }

  log("")
  log(RULE)
  log(" REPORT B — GROUPING, swept")
  log(RULE)
  if (b.gatedBest && b.gatedBest.length > 1) {
    log(" GROUPING RUNS AFTER THE GATE, so the sweep is reported after it too. The first")
    log(" row is every labelled face — a population no shipped configuration ever groups,")
    log(" and the one this report used to draw its product-shape conclusion from.")
    log("")
    log(
      "  " + pad("population", 32) + padLeft("faces", 7) + padLeft("cutoff", 9) +
        padLeft("groups", 8) + padLeft("purity", 8) + padLeft("complete", 10) + padLeft("welded", 8),
    )
    for (const g of b.gatedBest) {
      const p = g.pick ? g.pick.point : null
      log(
        "  " + pad(g.label, 32) + padLeft(`${g.faces}/${g.total}`, 7) +
          padLeft(p ? num(p.cutoff) : "n/a", 9) + padLeft(p ? String(p.quality.groups) : "n/a", 8) +
          padLeft(p ? num(p.quality.purity) : "n/a", 8) + padLeft(p ? num(p.quality.completeness) : "n/a", 10) +
          padLeft(p ? String(p.quality.weldedGroups) : "n/a", 8),
      )
    }
    log(" Each row is that population's own best swept point. Welds are not comparable")
    log(" across rows — fewer faces means fewer chances to weld — but purity and")
    log(" completeness are, and they move together or the gate is not earning its place.")
    log("")
  }
  if (b.best && b.weldFree) {
    log(` RECOMMENDED CUTOFF ${num(b.best.cutoff)} — best pair-F1 among the points that welded nobody,`)
    log(` with cannot-link on: ${b.best.quality.groups} groups, purity ${num(b.best.quality.purity)}, ` + `completeness ${num(b.best.quality.completeness)}, pair-F1 ${num(b.best.quality.pairF1)}.`)
    log(" Over-splitting is the cheap failure; welding two people is the expensive one.")
  } else if (b.best) {
    const fewest = b.points.filter((p) => p.cannotLink).reduce((m, p) => Math.min(m, p.quality.weldedGroups), Infinity)
    log(` NO SWEPT CUTOFF WELDED NOBODY ON EVERY LABELLED FACE. The best of`)
    log(` ${b.points.filter((p) => p.cannotLink).length} cannot-link points still welds ${fewest} group${fewest === 1 ? "" : "s"} at its most cautious.`)
    log("")
    log(" ⚠ THAT SENTENCE IS ABOUT A POPULATION NOTHING GROUPS. An earlier revision of")
    log(" this report read it as a finding about the product shape — 'unsupervised")
    log(" grouping has no safe operating point' — and recommended prototypes on the")
    log(" strength of it. The sweep it was reading runs over every labelled face,")
    log(" including all the ones the gate exists to discard. Grouping runs after the")
    log(" gate. Read the population table above instead: the weld count there is what")
    log(" a shipped configuration would actually produce, and it is the number that")
    log(" decides SESSION-1 §5 Q2. Prototypes may still be the better shape — they need")
    log(" no global cutoff and degrade more gracefully — but this is not the evidence.")
    log("")
    log(` LEAST-BAD CUTOFF ${num(b.best.cutoff)} on the ungated set — highest pair-F1 with`)
    log(` cannot-link on, welding ${b.best.quality.weldedGroups}: ${b.best.quality.groups} groups, purity ${num(b.best.quality.purity)}, `)
    log(` completeness ${num(b.best.quality.completeness)}, pair-F1 ${num(b.best.quality.pairF1)}.`)
  } else {
    log(" No cutoff could be recommended — no swept point produced a grouping to score.")
  }
  log("")
  /** @param {Types.SweepPoint[]} rows */
  const sweepTable = (rows) => {
    log(
      "  " +
        pad("cutoff", 9) +
        pad("cannot-link", 13) +
        padLeft("groups", 8) +
        padLeft("purity", 8) +
        padLeft("complete", 10) +
        padLeft("pairF1", 8) +
        padLeft("welded", 8),
    )
    for (const p of rows) {
      log(
        (p === b.best ? " >" : "  ") +
          pad(num(p.cutoff), 9) +
          pad(p.cannotLink ? "on" : "off", 13) +
          padLeft(String(p.quality.groups), 8) +
          padLeft(num(p.quality.purity), 8) +
          padLeft(num(p.quality.completeness), 10) +
          padLeft(num(p.quality.pairF1), 8) +
          padLeft(String(p.quality.weldedGroups), 8),
      )
    }
  }
  if (verbose) {
    log(` All ${b.points.length} swept points:`)
    sweepTable(b.points)
  } else {
    log(" The ends of the curve, the shipped cutoff and the recommendation:")
    sweepTable(b.representative)
    log(` (${b.points.length} points were swept in all — --verbose prints every one)`)
  }

  log("")
  log(RULE)
  log(" REPORT D — IS THE GATE EARNING ITS PLACE")
  log(RULE)
  const j = d.joint
  log(" Four whole configurations, each one actually applied and measured:")
  log("  " + pad("configuration", 34) + padLeft("kept", 11) + padLeft("AUC", 9) + padLeft("rank-1", 9))
  /** @param {string} label @param {Types.GateSweepPoint} p @param {boolean} [mark] */
  const configRow = (label, p, mark) => {
    log(
      (mark ? " >" : "  ") +
        pad(label, 34) +
        padLeft(`${p.kept}/${p.total}`, 11) +
        padLeft(num(p.auc, 4), 9) +
        padLeft(pct(p.rank1), 9),
    )
  }
  configRow("no gate at all", d.ungated)
  configRow("default gate", d.baseline)
  configRow("RECOMMENDED gate (in-sample)", j.result, true)
  configRow("every isolated winner, together", j.naive)
  log("")
  if (d.heldOut) {
    const h = d.heldOut
    log(" ⚠ THE ROW ABOVE IS THE SCORE OF A SEARCH WINNER ON ITS OWN SEARCH SET.")
    log(` Nine cutoffs were chosen by maximising AUC + rank-1 over these same labelled`)
    log(" faces, so some of that margin is luck and none of the numbers say how much.")
    log(` The same selection, re-run ${h.folds.length} times with one fold of PEOPLE hidden each time`)
    log(" and scored only on the people it never saw:")
    if (Number.isFinite(h.auc)) {
      log(
        "  " +
          pad("HELD-OUT estimate", 34) +
          padLeft(`${h.evaluated}/${j.result.total}`, 11) +
          padLeft(num(h.auc, 4), 9) +
          padLeft(pct(h.rank1), 9),
      )
      log(`  Pooled over ${h.contributingFolds} folds: ${h.samePairs} same-person and ${h.diffPairs} different-person held-out pairs,`)
      log(`  ${h.evaluated} held-out faces queried. Pooled rather than averaged per fold — six people per`)
      log("  fold is too few to score, and a mean over the one or two that survive tracks")
      log("  the fold split rather than the recogniser.")
      log(
        `  optimism: AUC ${signed(j.result.auc - h.auc, 4)}, rank-1 ${ppDelta(j.result.rank1 - h.rank1)} — ` +
          "that much of the in-sample result was selection.",
      )
      log(" QUOTE THE HELD-OUT ROW. Prototypes come from everybody in both rows, so the")
      log(" candidate pool is the same size and the two rank-1 figures are comparable.")
    } else {
      log(`  Pooled over every fold there are ${h.samePairs} same- and ${h.diffPairs} different-person held-out pairs,`)
      log(`  short of the ${MIN_STRATUM_PAIRS} each this stratum needs. The held-out estimate is UNMEASURABLE,`)
      log("  so the in-sample row above is the only one there is — treat it as an upper")
      log("  bound, not a result, and label more people before quoting it anywhere.")
    }
    log("")
  }
  if (j.adopted.length === 0) {
    log(" >> RECOMMENDING THE DEFAULTS UNCHANGED. Each of the candidate cutoffs below")
    log(" >> earns its ΔAUC with the other eight checks WIDE OPEN. Applied on top of")
    log(" >> the rest of the gate, none of them improved the joint result, or none")
    log(` >> left the ${j.floor}-face floor below which the measurement stops meaning anything.`)
  } else {
    log(` >> RECOMMENDING ${j.adopted.length} CHANGE${j.adopted.length === 1 ? "" : "S"} to the defaults: ${j.adopted.join(", ")}.`)
    if (j.rejected.length > 0) {
      log(` >> Not adopted, though each helps in isolation: ${j.rejected.join(", ")}.`)
      log(" >> They earned nothing once the other checks were in force.")
    }
  }
  log("")
  log(" The last row is why. Nine cutoffs measured one at a time are nine different")
  log(" configurations; their intersection is a tenth that nobody measured. It is")
  log(` ${j.naive.kept}/${j.naive.total} labelled faces here, against ${d.baseline.kept} for the defaults.`)

  log("")
  log(" Per check, swept ALONE with every other check wide open — so ΔAUC and Δrank-1")
  log(" below are what that cutoff is worth on its own, and nothing more:")
  log(
    "  " +
      pad("check", 16) +
      padLeft("best cutoff", 13) +
      padLeft("ΔAUC", 9) +
      padLeft("Δrank-1", 10) +
      padLeft("keeps", 8) +
      "  verdict",
  )
  for (const v of j.verdicts) {
    const note = gateVerdictLabel(j, v.key)
    log(
      "  " +
        pad(v.key, 16) +
        padLeft(v.candidate === null ? "—" : num(v.candidate, 5), 13) +
        padLeft(signed(v.deltaAuc), 9) +
        padLeft(ppDelta(v.deltaRank1), 10) +
        padLeft(pct(v.total > 0 ? v.kept / v.total : NaN), 8) +
        "  " +
        note,
    )
  }

  if (verbose) {
    log("")
    log(" One cutoff at a time, every other check wide open:")
    for (const axis of d.keys) {
      log(` ${THIN}`)
      log(` ${axis.key} (${axis.direction} on ${axis.signal}), default ${num(axis.defaultValue, 5)}`)
      log("  " + pad("cutoff", 12) + padLeft("kept", 10) + padLeft("AUC", 9) + padLeft("rank-1", 9))
      for (const p of axis.points) {
        log(
          "  " +
            pad(num(p.value, 5), 12) +
            padLeft(`${p.kept}`, 10) +
            padLeft(num(p.auc, 4), 9) +
            padLeft(pct(p.rank1), 9),
        )
      }
    }
  } else {
    log("")
    log(" (--verbose prints the full per-cutoff sweep behind every row above)")
  }
  log("")
  log(" WHAT THE GATE COSTS — and the reason this table is not optional:")
  log(" every cutoff above was chosen by maximising separation and rank-1, and BOTH")
  log(" rise when faces are discarded. The degenerate optimum keeps one clear face per")
  log(" person and scores near-perfect while tagging almost nothing. Only a floor")
  log(" restrains it, and a floor is not a price. This is the price.")
  log("")
  /** @param {typeof analysis.coverage.poolA} rows */
  const printCoverage = (rows) => {
    log("  " + pad("configuration", 32) + padLeft("faces", 11) + padLeft("appearances", 14) + padLeft("kept", 8))
    for (const row of rows) {
      const share = row.appearances > 0 ? row.appearancesKept / row.appearances : NaN
      log(
        "  " + pad(row.label, 32) + padLeft(`${row.faces}/${row.totalFaces}`, 11) +
          padLeft(`${row.appearancesKept}/${row.appearances}`, 14) + padLeft(pct(share), 8),
      )
    }
  }
  log(" Pool A only — the uniform sample. THIS is the table to quote:")
  printCoverage(analysis.coverage.poolA)
  log("")
  log(" Pools A+B blended — more volume, but pool B's labels sit where the model's")
  log(" own grouping was tidy, which is also where the gate is easy. Overstates the")
  log(" keep rate for the same reason report C's blended rank-1 does. Context only:")
  printCoverage(analysis.coverage.blended)
  log(" An APPEARANCE is one labelled person in one distinct frame (duplicate frames")
  log(" collapsed). A person is tagged in a photograph if ANY surviving face carries")
  log(" them, so this — not the face count — is what the gate costs the product.")
  log(" Faces the gate drops are not tagged wrongly. They are not tagged at all.")

  log("")
  log(" Rejections at the default cutoffs, attributed to the first failing check:")
  for (const row of d.breakdown) {
    log("  " + pad(row.reason, 16) + padLeft(String(row.n), 7))
  }

  log("")
  log(RULE)
  log(" REPORT E — COST")
  log(RULE)
  if (e.timing) {
    const { parts, wallMs, hasWall } = stageBreakdown(e.timing)
    log(
      ` ${e.timing.photos} photographs, ${e.timing.faces} faces, ${num(wallMs / 1000, 1)}s ` +
        `${hasWall ? "wall clock" : "of summed stage time (no wall-clock total recorded)"}`,
    )
    log(" Shares are of wall clock. Stages overlap and need not sum to it.")
    log("  " + pad("stage", 14) + padLeft("calls", 9) + padLeft("total ms", 11) + padLeft("ms/call", 10) + padLeft("share", 8))
    for (const [name, s] of parts.sort((x, y) => y[1].ms - x[1].ms)) {
      log(
        "  " +
          pad(name, 14) +
          padLeft(String(s.n), 9) +
          padLeft(num(s.ms, 0), 11) +
          padLeft(num(s.n > 0 ? s.ms / s.n : NaN, 2), 10) +
          padLeft(pct(wallMs > 0 ? s.ms / wallMs : NaN), 8),
      )
    }
    const env = Object.entries(e.timing.environment ?? {})
    if (env.length > 0) log(" " + env.map(([k, v]) => `${k}=${v}`).join("  "))
  } else {
    log(" timing.json missing — no per-stage cost available")
  }

  log("")
  if (e.resolution) {
    const r = e.resolution
    log(` Detector resolution: ${r.atSource} faces at the source edge, ${r.atDetect} at the detect edge.`)
    log(` ${r.matched} matched at IoU ≥ ${BOX_MATCH_IOU} — recall ${pct(r.recall)} (upper bound; matching is not injective).`)
    log(` ${r.extra} detect-edge boxes had no counterpart. IoU p05/p50/p95 ${num(r.iouPercentiles.p05)} / ${num(r.iouPercentiles.p50)} / ${num(r.iouPercentiles.p95)}`)
  } else {
    log(" resolution.jsonl missing — the 1280-vs-2000 choice is unchecked")
  }

  log("")
  if (e.oracle) {
    const o = e.oracle
    log(` Oracle (macOS Vision) over ${o.photos} comparable photographs:`)
    log(`   ${o.oracleMatched}/${o.oracleFaces} oracle faces found by us — recall ${pct(o.recall)}`)
    log(`   ${o.ourMatched}/${o.ourFaces} of our faces confirmed by the oracle — agreement ${pct(o.agreement)}`)
    if (o.frameMismatch > 0) {
      log(`   ! ${o.frameMismatch} photographs skipped: oracle frame does not match ours (the orientation bug)`)
    }
    if (o.missing > 0) log(`   ! ${o.missing} photographs absent from the oracle file`)
    if (o.ambiguous > 0) {
      log(`   ! ${o.ambiguous} photographs skipped: more than one oracle row could be theirs`)
      log("     (repeated basenames across folders — joining on the basename would have")
      log("      silently handed one photograph another photograph's faces)")
    }
    log("")
    log(`   THE MIRROR CHECK — independent, over ${o.eyeChecked} matched faces.`)
    log("   The alignment residual catches a landmark order that disagrees with the")
    log("   TEMPLATE. It cannot catch a mirroring that is consistent all the way")
    log("   through, because a consistent mirror fits perfectly. Only a second")
    log("   detector's eyes can see that. This is that check.")
    const flippedShare = o.eyeChecked > 0 ? o.eyeFlipped / o.eyeChecked : NaN
    log(`   our subject-right eye on the opposite side to theirs: ${o.eyeFlipped}/${o.eyeChecked} (${pct(flippedShare)})`)
    if (!Number.isFinite(flippedShare)) {
      log("   -> not enough matched faces with eye positions to decide")
    } else if (flippedShare > 0.5) {
      log("   -> !! LANDMARK ORDER IS MIRRORED. Every crop is a mirror image of what")
      log("      the recogniser was trained on, every match is quietly degraded, and")
      log("      no downstream tuning recovers it. Fix the order before anything else.")
    } else if (flippedShare > 0.1) {
      log("   -> suspicious. A consistent swap reads near 100% and heavy roll reads a")
      log("      few percent; this is neither. Inspect the disagreeing faces.")
    } else {
      log("   -> landmark order is CORRECT. Not inferred from the residual — confirmed")
      log("      against a detector that shares no code with ours.")
    }
    log("   eye disagreement, as a fraction of the subject's own eye separation:")
    log(
      `     p50 ${num(o.eyeOffsetPercentiles.p50)}  p90 ${num(o.eyeOffsetPercentiles.p90)}  p99 ${num(o.eyeOffsetPercentiles.p99)}`,
    )
    if (o.noseOffsetPercentiles) {
      log("   nose tip disagreement, same fraction and same denominator as the eyes above:")
      log(
        `     p50 ${num(o.noseOffsetPercentiles.p50)}  p90 ${num(o.noseOffsetPercentiles.p90)}  p99 ${num(o.noseOffsetPercentiles.p99)}`,
      )
    }
    log("   Neither detector is ground truth, so this bounds ALIGNMENT HEADROOM rather")
    log("   than blaming either. It matters more for this recogniser than for most:")
    log("   its head flattens a 7x7 grid instead of pooling it, so a crop off by a few")
    log("   pixels shifts every one of 50,176 inputs to the final layer.")
    if (o.mouthChecked > 0) {
      const mouthShare = o.mouthFlipped / o.mouthChecked
      log(`   mouth-corner check, same idea, over ${o.mouthChecked} matched faces with oracle mouth data:`)
      log(`   our subject-right mouth corner on the opposite side to theirs: ${o.mouthFlipped}/${o.mouthChecked} (${pct(mouthShare)})`)
    } else {
      log("   mouth-corner check: no matched face carried oracle mouth data (older oracle file?)")
    }
  } else {
    log(" No oracle file given (--oracle) — detection recall is unverified against an")
    log(" independent detector, AND the mirror check has not run. The residual check")
    log(" below is NOT a substitute: it cannot see a consistent mirroring.")
  }

  log("")
  if (e.mirror) {
    log(" Mirror-TTA A/B (describe the crop and its mirror, average before normalising):")
    log(`   AUC     ${num(e.mirror.auc, 4)} -> ${num(e.mirror.mirrorAuc, 4)}   (${num(e.mirror.mirrorAuc - e.mirror.auc, 4)})`)
    log(`   rank-1  ${pct(e.mirror.rank1)} -> ${pct(e.mirror.mirrorRank1)}`)
  } else {
    log(" No mirror descriptors in this run (--mirror-tta not used) — the 2x cost is untested")
  }

  log("")
  log(` Alignment residual — THE MIRROR CHECK. Reflection is excluded from the transform`)
  log(` family, so a swapped landmark order cannot be absorbed by the fit and shows up here.`)
  log(`   p50 ${num(e.residual.percentiles.p50)}  p90 ${num(e.residual.percentiles.p90)}  p99 ${num(e.residual.percentiles.p99)}  max ${num(e.residual.percentiles.max)}`)
  log(`   ${e.residual.above} of ${e.residual.n} faces exceed the ${num(e.residual.maxResidual, 1)} default.`)
  if (e.residual.percentiles.p50 > e.residual.maxResidual) {
    log("   !! The MEDIAN residual is above the cutoff. That is not a scattering of bad")
    log("   !! landmarks, that is a systematic mirroring — check the landmark order before")
    log("   !! believing any number above.")
  }

  log("")
  log(RULE)
  log(" WHAT THE NUMBERS SUPPORT")
  log(RULE)
  log(` ${analysis.verdict.headline}`)
  log(` ${analysis.verdict.description}`)
  for (const line of analysis.verdict.detail) log(`  - ${line}`)

  log("")
  log(" Cutoffs to write into public/vision/defaults.js:")
  for (const r of analysis.recommended) {
    log("   " + pad(r.path, 24) + pad(r.value, 12) + `# ${r.note}`)
  }
  log("")
  log(" The nine gate values above were applied TOGETHER and measured together:")
  log(
    `   keeps ${d.joint.result.kept}/${d.joint.result.total} labelled   AUC ${num(d.joint.result.auc, 4)}   rank-1 ${pct(d.joint.result.rank1)}` +
      `   (defaults: ${d.baseline.kept}/${d.baseline.total}, ${num(d.baseline.auc, 4)}, ${pct(d.baseline.rank1)})`,
  )
  if (d.heldOut && Number.isFinite(d.heldOut.auc)) {
    log(`   ...but those two numbers are in-sample. HELD OUT: AUC ${num(d.heldOut.auc, 4)}, rank-1 ${pct(d.heldOut.rank1)}.`)
    log("   Quote the held-out pair anywhere the result is described.")
  }
  if (d.joint.adopted.length === 0) {
    log("   They are the defaults, unchanged, because nothing beat them jointly.")
  }
  log("")
  log(" Copy the NUMBERS ONLY. CLAUDE.md's fourth photograph rule: no note of what")
  log(" was measured to arrive at them may live anywhere in this repository, and")
  log(" that includes statistics — they are facts about identifiable people.")
  log(RULE)
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

/** @param {unknown} value @returns {string} */
function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * The overlap plot: same-person and different-person distances on one axis, each
 * normalised to its own total so the SHAPES compare rather than the counts. This
 * is the picture the whole session is for — a clean gap means grouping works, a
 * wide overlap means no threshold is right for everybody.
 *
 * Inline SVG, no chart library, no network. Zero dependencies is a project rule,
 * and this is thirty lines.
 * @param {V.SeparationReport} report
 * @param {number} [threshold]
 * @returns {string}
 */
export function overlapSvg(report, threshold) {
  const width = 720
  const height = 220
  const padLeftPx = 44
  const padBottom = 34
  const same = report.sameHistogram
  const diff = report.diffHistogram
  const bins = Math.max(same.counts.length, diff.counts.length)
  if (bins === 0) return '<p class="empty">no pairs in this stratum</p>'

  const sameTotal = same.counts.reduce((s, c) => s + c, 0) || 1
  const diffTotal = diff.counts.reduce((s, c) => s + c, 0) || 1
  let peak = 0
  for (let i = 0; i < bins; i++) {
    peak = Math.max(peak, (same.counts[i] ?? 0) / sameTotal, (diff.counts[i] ?? 0) / diffTotal)
  }
  if (peak <= 0) peak = 1

  const plotW = width - padLeftPx - 12
  const plotH = height - padBottom - 12
  const barW = plotW / bins

  /**
   * @param {number[]} counts @param {number} total @param {string} cls
   * @returns {string}
   */
  const bars = (counts, total, cls) => {
    /** @type {string[]} */
    const parts = []
    for (let i = 0; i < bins; i++) {
      const v = (counts[i] ?? 0) / total / peak
      if (v <= 0) continue
      const h = v * plotH
      const x = padLeftPx + i * barW
      const y = 12 + plotH - h
      parts.push(`<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barW - 0.5, 0.5).toFixed(2)}" height="${h.toFixed(2)}"/>`)
    }
    return parts.join("")
  }

  const lo = same.min
  const hi = same.max
  /** @type {string[]} */
  const ticks = []
  for (let t = 0; t <= 4; t++) {
    const frac = t / 4
    const x = padLeftPx + frac * plotW
    ticks.push(
      `<line class="axis" x1="${x.toFixed(1)}" y1="${12 + plotH}" x2="${x.toFixed(1)}" y2="${12 + plotH + 4}"/>` +
        `<text class="tick" x="${x.toFixed(1)}" y="${12 + plotH + 16}" text-anchor="middle">${(lo + frac * (hi - lo)).toFixed(2)}</text>`,
    )
  }

  let marker = ""
  if (threshold !== undefined && Number.isFinite(threshold) && hi > lo) {
    const x = padLeftPx + ((threshold - lo) / (hi - lo)) * plotW
    marker =
      `<line class="threshold" x1="${x.toFixed(1)}" y1="12" x2="${x.toFixed(1)}" y2="${12 + plotH}"/>` +
      `<text class="tick" x="${x.toFixed(1)}" y="10" text-anchor="middle">best ${threshold.toFixed(3)}</text>`
  }

  return (
    `<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="distance overlap">` +
    `<line class="axis" x1="${padLeftPx}" y1="${12 + plotH}" x2="${padLeftPx + plotW}" y2="${12 + plotH}"/>` +
    bars(diff.counts, diffTotal, "diff") +
    bars(same.counts, sameTotal, "same") +
    marker +
    ticks.join("") +
    `<text class="tick" x="${padLeftPx}" y="${height - 4}" text-anchor="start">cosine distance</text>` +
    `</svg>`
  )
}

/**
 * @param {V.Histogram} h
 * @param {string} label
 * @returns {string}
 */
function barsHtml(h, label) {
  const total = h.counts.reduce((s, c) => s + c, 0)
  if (total === 0) return `<p class="empty">no ${esc(label)}</p>`
  const peak = Math.max(...h.counts) || 1
  const cells = h.counts
    .map((c) => `<span class="bar" style="height:${((c / peak) * 100).toFixed(1)}%" title="${c}"></span>`)
    .join("")
  return `<div class="bars">${cells}</div><div class="barscale"><span>${h.min.toFixed(2)}</span><span>${h.max.toFixed(2)}</span></div>`
}

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {number[]} [emphasise] Row indices to mark.
 * @returns {string}
 */
function table(headers, rows, emphasise = []) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("")
  const body = rows
    .map((r, i) => `<tr${emphasise.includes(i) ? ' class="mark"' : ""}>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

const STYLE = `
:root { color-scheme: light dark; --ink:#16181d; --dim:#5b6270; --line:#d9dde5; --bg:#fbfbfd;
        --same:#2f6fdb; --diff:#d9603b; --warn:#8a4b00; --good:#1f7a4d; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#e8eaf0; --dim:#9aa2b1; --line:#2c3140; --bg:#14161c; --warn:#e0a355; --good:#5fd39b; }
}
* { box-sizing: border-box; }
body { margin:0; padding:2rem 1.25rem 6rem; background:var(--bg); color:var(--ink);
       font:15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 860px; margin: 0 auto; }
h1 { font-size:1.6rem; margin:0 0 .25rem; letter-spacing:-.01em; }
h2 { font-size:1.15rem; margin:2.5rem 0 .5rem; padding-top:1rem; border-top:1px solid var(--line); }
h3 { font-size:.95rem; margin:1.5rem 0 .35rem; color:var(--dim); text-transform:uppercase; letter-spacing:.06em; }
p { margin:.5rem 0; }
.sub { color:var(--dim); }
.headline { border:2px solid var(--same); border-radius:10px; padding:1rem 1.25rem; margin:1rem 0 1.5rem; }
.headline .why { color:var(--dim); margin-bottom:.75rem; }
.figures { display:flex; flex-wrap:wrap; gap:1.5rem; margin:.75rem 0; }
.fig { min-width:8rem; }
.fig b { display:block; font-size:1.8rem; font-weight:650; letter-spacing:-.02em; }
.fig span { color:var(--dim); font-size:.8rem; }
.warn { border-left:4px solid var(--warn); background:color-mix(in srgb, var(--warn) 10%, transparent);
        padding:.75rem 1rem; margin:1rem 0; border-radius:0 6px 6px 0; }
.verdict { border-left:4px solid var(--good); background:color-mix(in srgb, var(--good) 10%, transparent);
           padding:.75rem 1rem; margin:1rem 0; border-radius:0 6px 6px 0; }
table { border-collapse:collapse; width:100%; margin:.5rem 0 1rem; font-size:.85rem; font-variant-numeric:tabular-nums; }
th, td { text-align:right; padding:.3rem .5rem; border-bottom:1px solid var(--line); }
th:first-child, td:first-child { text-align:left; }
th { color:var(--dim); font-weight:600; font-size:.75rem; text-transform:uppercase; letter-spacing:.04em; }
tr.mark td { background:color-mix(in srgb, var(--same) 14%, transparent); font-weight:600; }
svg.plot { width:100%; height:auto; display:block; margin:.5rem 0; }
svg .same { fill:var(--same); fill-opacity:.75; }
svg .diff { fill:var(--diff); fill-opacity:.55; }
svg .axis { stroke:var(--line); stroke-width:1; }
svg .threshold { stroke:var(--ink); stroke-width:1; stroke-dasharray:3 3; }
svg .tick { fill:var(--dim); font-size:10px; }
.legend { display:flex; gap:1rem; font-size:.8rem; color:var(--dim); }
.legend i { display:inline-block; width:.7rem; height:.7rem; border-radius:2px; margin-right:.3rem; }
.bars { display:flex; align-items:flex-end; gap:1px; height:90px; border-bottom:1px solid var(--line); }
.bars .bar { flex:1; background:var(--same); opacity:.75; min-height:1px; }
.barscale { display:flex; justify-content:space-between; font-size:.72rem; color:var(--dim); }
.empty { color:var(--dim); font-style:italic; }
details { margin:.75rem 0 1.25rem; border:1px solid var(--line); border-radius:6px; padding:.4rem .75rem; }
details[open] { padding-bottom:.75rem; }
summary { cursor:pointer; color:var(--dim); font-size:.85rem; padding:.25rem 0; }
details h3:first-of-type { margin-top:.75rem; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.82rem; }
/* pre-wrap, not overflow: the longest line in the paste block is the one that
   prices a recommendation, and a horizontal scrollbar hides exactly that. */
pre { background:color-mix(in srgb, var(--ink) 6%, transparent); padding:.75rem 1rem; border-radius:6px;
      white-space:pre-wrap; overflow-wrap:anywhere; }
`

/**
 * Self-contained: inline CSS, inline SVG, no network, no chart library.
 * @param {ReturnType<typeof analyse>} analysis
 * @returns {string}
 */
export function renderHtml(analysis) {
  const { a, headline, b, c, d, e } = analysis
  /** @type {string[]} */
  const out = []

  out.push("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">")
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">')
  out.push('<meta name="robots" content="noindex, nofollow">')
  out.push("<title>Session 1 — separation report</title>")
  out.push(`<style>${STYLE}</style></head><body><main>`)

  out.push("<h1>Session 1 — does this work</h1>")
  out.push(
    `<p class="sub">${a.people} people over ${analysis.counts.labelled} labelled faces ` +
      `(pool A ${analysis.counts.poolA}, pool B ${analysis.counts.poolB}) from ${analysis.counts.faces} detections ` +
      `in ${analysis.counts.photos} photographs. Everything here is scratch and stays in <code>tmp/</code>.</p>`,
  )

  // --- Report A, first, because it is the decision. ---
  out.push("<h2>A — Separation <span class=\"sub\">(pool A only)</span></h2>")
  if (headline.key !== a.honestKey) {
    out.push(
      '<div class="warn"><b>The different-hour stratum is too thin to be a measurement.</b> ' +
        "The headline below falls back to all deduplicated pairs, which is contaminated by bursts. " +
        "Treat it as an upper bound.</div>",
    )
  }
  out.push('<div class="headline">')
  out.push(`<h3>${esc(headline.title)}</h3>`)
  out.push(`<p class="why">${esc(headline.note)}</p>`)
  out.push('<div class="figures">')
  out.push(`<div class="fig"><b>${num(headline.report.auc, 4)}</b><span>AUC — is there a signal at all</span></div>`)
  out.push(`<div class="fig"><b>${num(headline.report.eer, 3)}</b><span>EER</span></div>`)
  out.push(`<div class="fig"><b>${num(headline.report.bestThreshold, 3)}</b><span>best threshold</span></div>`)
  out.push(`<div class="fig"><b>${pct(headline.report.fprAt95Tpr)}</b><span>FPR at 95% TPR</span></div>`)
  out.push("</div>")
  out.push(overlapSvg(headline.report, headline.report.bestThreshold))
  out.push(
    '<div class="legend">' +
      `<span><i style="background:var(--same)"></i>same person (${headline.report.sameCount} pairs)</span>` +
      `<span><i style="background:var(--diff)"></i>different people (${headline.report.diffCount} pairs)</span>` +
      "</div>",
  )
  out.push("</div>")

  out.push(
    '<div class="warn"><b>Do not quote the same-minute stratum.</b> Two frames from one burst make two ' +
      "near-identical descriptors, so a same-person pair drawn from them measures the shutter, not the " +
      "recogniser. The starred row below is the one that is evidence.</div>",
  )
  out.push(
    table(
      ["stratum", "same", "diff", "AUC", "EER", "best thr", "FPR@95%TPR"],
      a.strata.map((s) => [
        (s.honest ? "★ " : "") + s.title,
        String(s.report.sameCount),
        String(s.report.diffCount),
        num(s.report.auc, 4),
        num(s.report.eer, 4),
        num(s.report.bestThreshold),
        pct(s.report.fprAt95Tpr),
      ]),
      a.strata.map((s, i) => (s.key === headline.key ? i : -1)).filter((i) => i >= 0),
    ),
  )
  for (const s of a.strata) {
    if (s.key === headline.key) continue
    out.push(`<h3>${esc(s.title)}</h3>`)
    out.push(`<p class="sub">${esc(s.note)}</p>`)
    out.push(overlapSvg(s.report, s.report.bestThreshold))
  }

  // --- Report C. ---
  out.push('<h2>C — Prototype rank-1 <span class="sub">(decides §5 Q2)</span></h2>')
  out.push(
    `<div class="figures"><div class="fig"><b>${pct(c.rank1)}</b><span>${c.correct} of ${c.evaluated} faces</span></div>` +
      `<div class="fig"><b>${num(c.marginPercentiles.p50)}</b><span>median margin</span></div>` +
      `<div class="fig"><b>${c.singletonPeople}</b><span>people with one face — not evaluable</span></div></div>`,
  )
  out.push(
    table(
      ["person", "faces", "rank-1"],
      c.perPerson.map((p) => [p.label, String(p.n), pct(p.rank1)]),
    ),
  )

  // --- Report B. ---
  out.push("<h2>B — Grouping, swept across cutoffs</h2>")
  if (b.best) {
    const weldedFig = b.weldFree
      ? ""
      : `<div class="fig"><b>${b.best.quality.weldedGroups}</b><span>welded groups</span></div>`
    out.push(
      `<div class="headline"><h3>${b.weldFree ? "Recommended cutoff" : "Least-bad cutoff"}</h3>` +
        '<div class="figures">' +
        `<div class="fig"><b>${num(b.best.cutoff)}</b><span>cosine distance, cannot-link on</span></div>` +
        `<div class="fig"><b>${b.best.quality.groups}</b><span>groups</span></div>` +
        `<div class="fig"><b>${num(b.best.quality.purity)}</b><span>purity</span></div>` +
        `<div class="fig"><b>${num(b.best.quality.completeness)}</b><span>completeness</span></div>` +
        `<div class="fig"><b>${num(b.best.quality.pairF1)}</b><span>pair F1</span></div>` +
        weldedFig +
        "</div>" +
        (b.weldFree
          ? '<p class="why">Best pair-F1 among the points that welded nobody. Over-splitting is the cheap ' +
            "failure — merging is two clicks — and welding two people together is the expensive one.</p></div>"
          : '<p class="why"><b>No swept cutoff welded nobody</b>, so the weld-free recommendation this report ' +
            "prefers does not exist on this input — every point on the curve fuses at least two people. This is " +
            "the highest pair-F1 among the cannot-link points, which is a different and weaker claim. It argues " +
            "for label-a-few-and-classify over unsupervised grouping: a per-person prototype needs no global " +
            "cutoff, so it cannot have this failure.</p></div>"),
    )
  } else {
    out.push('<p class="empty">no swept point produced a grouping to score</p>')
  }
  /** @param {Types.SweepPoint[]} rows @returns {string} */
  const sweepTable = (rows) =>
    table(
      ["cutoff", "cannot-link", "groups", "purity", "completeness", "pair F1", "welded"],
      rows.map((p) => [
        num(p.cutoff),
        p.cannotLink ? "on" : "off",
        String(p.quality.groups),
        num(p.quality.purity),
        num(p.quality.completeness),
        num(p.quality.pairF1),
        String(p.quality.weldedGroups),
      ]),
      b.best ? [rows.indexOf(b.best)] : [],
    )
  out.push("<h3>The ends of the curve, the shipped cutoff and the recommendation</h3>")
  out.push(sweepTable(b.representative))
  out.push(`<details><summary>All ${b.points.length} swept points</summary>`)
  out.push(
    '<p class="sub">Every point is computed on its own copy of the distance matrix. ' +
      "<code>groupFaces</code> rewrites the matrix in place (Lance-Williams), so a sweep that reuses one " +
      "matrix runs, terminates and is silently wrong.</p>",
  )
  out.push(sweepTable(b.points))
  out.push("</details>")

  // --- Report D. ---
  const j = d.joint
  out.push("<h2>D — Is the gate earning its place</h2>")
  out.push("<h3>Four whole configurations, each one applied and measured</h3>")
  out.push(
    table(
      ["configuration", "labelled faces kept", "AUC", "rank-1"],
      [
        ["no gate", `${d.ungated.kept}/${d.ungated.total}`, num(d.ungated.auc, 4), pct(d.ungated.rank1)],
        ["default gate", `${d.baseline.kept}/${d.baseline.total}`, num(d.baseline.auc, 4), pct(d.baseline.rank1)],
        ["recommended gate (in-sample)", `${j.result.kept}/${j.result.total}`, num(j.result.auc, 4), pct(j.result.rank1)],
        ["every isolated winner, together", `${j.naive.kept}/${j.naive.total}`, num(j.naive.auc, 4), pct(j.naive.rank1)],
        ...(d.heldOut && Number.isFinite(d.heldOut.auc)
          ? [
              [
                "held-out estimate — QUOTE THIS ONE",
                `${d.heldOut.evaluated}/${j.result.total}`,
                num(d.heldOut.auc, 4),
                pct(d.heldOut.rank1),
              ],
            ]
          : []),
      ],
      d.heldOut && Number.isFinite(d.heldOut.auc) ? [4] : [2],
    ),
  )
  if (d.heldOut) {
    out.push(
      Number.isFinite(d.heldOut.auc)
        ? '<div class="warn"><b>The "in-sample" row is the score of a search winner on its own search set.</b> ' +
            "Nine cutoffs were chosen by maximising AUC + rank-1 over these same labelled faces, so part of that " +
            `margin is luck. Re-running the identical selection ${d.heldOut.folds.length} times with one fold of <em>people</em> hidden, and ` +
            `scoring only the people it never saw, gives AUC ${num(d.heldOut.auc, 4)} and rank-1 ${pct(d.heldOut.rank1)} — an optimism of ` +
            `${signed(j.result.auc - d.heldOut.auc, 4)} AUC and ${ppDelta(j.result.rank1 - d.heldOut.rank1)}. Pooled over ` +
            `${d.heldOut.contributingFolds} folds: ${d.heldOut.samePairs} same-person and ${d.heldOut.diffPairs} different-person held-out pairs, ` +
            `${d.heldOut.evaluated} held-out faces queried. Pooled rather than averaged per fold, because a handful of people per fold ` +
            "produces per-fold AUCs that track the split rather than the recogniser. Prototypes come from everybody in both rows, so the " +
            "candidate pool is the same size and the two rank-1 figures are comparable.</div>"
        : '<div class="warn"><b>The held-out estimate is unmeasurable on this labelled set.</b> ' +
            `Pooled over every fold there are ${d.heldOut.samePairs} same- and ${d.heldOut.diffPairs} different-person held-out pairs, short of ` +
            `the ${MIN_STRATUM_PAIRS} each this stratum needs. The in-sample row is the only one there is — and it is an upper bound, ` +
            "not a result.</div>",
    )
  }
  out.push(
    '<div class="warn"><b>The last row is not a recommendation — it is the trap.</b> ' +
      "Each cutoff below is swept with the other eight checks wide open, which is the right way to measure " +
      "one cutoff's own contribution and makes each sweep a measurement of a different configuration. " +
      `Taking the winner of each and applying them together gives a tenth configuration nobody measured: ` +
      `<b>${j.naive.kept} of ${j.naive.total}</b> labelled faces here, against ${d.baseline.kept} for the shipped defaults. ` +
      "The recommended row is the one that was evaluated jointly.</div>",
  )
  if (j.adopted.length === 0) {
    out.push(
      '<div class="verdict"><b>Recommending the defaults, unchanged.</b> Every candidate below earns its ' +
        "ΔAUC with the other eight checks wide open. On top of the rest of the gate, none of them improved " +
        `the joint result, or none left the ${j.floor}-face floor below which the measurement stops meaning anything.</div>`,
    )
  } else {
    out.push(
      `<div class="verdict"><b>Recommending ${j.adopted.length} change${j.adopted.length === 1 ? "" : "s"}:</b> ` +
        `<code>${esc(j.adopted.join(", "))}</code>. ` +
        (j.rejected.length > 0
          ? `Not adopted, though each helps in isolation: <code>${esc(j.rejected.join(", "))}</code> — they earned nothing once the other checks were in force.`
          : "") +
        "</div>",
    )
  }
  out.push("<h3>Per check, swept alone</h3>")
  out.push(
    '<p class="sub">Every other check wide open, so &Delta;AUC and &Delta;rank-1 are what that cutoff is ' +
      "worth on its own and nothing more. &ldquo;Adopted&rdquo; means it also improved the gate with the " +
      "other eight in force.</p>",
  )
  out.push(
    table(
      ["check", "best cutoff", "ΔAUC", "Δrank-1", "keeps", "verdict"],
      j.verdicts.map((v) => [
        v.key,
        v.candidate === null ? "—" : num(v.candidate, 5),
        signed(v.deltaAuc),
        ppDelta(v.deltaRank1),
        pct(v.total > 0 ? v.kept / v.total : NaN),
        gateVerdictLabel(j, v.key),
      ]),
      j.verdicts.map((v, i) => (j.adopted.includes(v.key) ? i : -1)).filter((i) => i >= 0),
    ),
  )
  out.push("<details><summary>The full sweep behind every row above</summary>")
  for (const axis of d.keys) {
    out.push(`<h3>${esc(axis.key)} — ${esc(axis.direction)} on ${esc(axis.signal)}</h3>`)
    out.push(
      table(
        ["cutoff", "labelled kept", "AUC", "rank-1"],
        axis.points.map((p) => [num(p.value, 5), `${p.kept}`, num(p.auc, 4), pct(p.rank1)]),
      ),
    )
  }
  out.push("</details>")
  out.push("<h3>Rejections at the default cutoffs</h3>")
  out.push(
    table(
      ["first failing check", "detections"],
      d.breakdown.map((r) => [r.reason, String(r.n)]),
    ),
  )

  // --- Report E. ---
  out.push("<h2>E — Cost</h2>")
  if (e.timing) {
    const { parts, wallMs } = stageBreakdown(e.timing)
    out.push(
      table(
        ["stage", "calls", "total ms", "ms/call", "share of wall clock"],
        parts
          .sort((x, y) => y[1].ms - x[1].ms)
          .map(([name, s]) => [
            name,
            String(s.n),
            num(s.ms, 0),
            num(s.n > 0 ? s.ms / s.n : NaN, 2),
            pct(wallMs > 0 ? s.ms / wallMs : NaN),
          ]),
      ),
    )
  } else {
    out.push('<p class="empty">timing.json missing</p>')
  }

  out.push("<h3>Detector resolution</h3>")
  if (e.resolution) {
    const r = e.resolution
    out.push(
      `<p>${r.matched} of ${r.atSource} source-edge faces were also found at the detect edge — recall ` +
        `<b>${pct(r.recall)}</b> (upper bound; matching is not injective). ${r.extra} detect-edge boxes had no counterpart.</p>`,
    )
  } else {
    out.push('<p class="empty">resolution.jsonl missing — the 1280-vs-2000 choice is unchecked</p>')
  }

  out.push("<h3>Independent oracle</h3>")
  if (e.oracle) {
    const o = e.oracle
    out.push(
      `<p>Over ${o.photos} comparable photographs: recall <b>${pct(o.recall)}</b> ` +
        `(${o.oracleMatched}/${o.oracleFaces}), agreement <b>${pct(o.agreement)}</b> (${o.ourMatched}/${o.ourFaces}).</p>`,
    )
    if (o.frameMismatch > 0) {
      out.push(
        `<div class="warn">${o.frameMismatch} photographs skipped — the oracle's frame does not match ours, ` +
          "which is the known <code>orientation: .up</code> bug in oracle-macos.swift.</div>",
      )
    }
  } else {
    out.push('<p class="empty">no --oracle file given</p>')
  }

  out.push("<h3>Mirror-TTA A/B</h3>")
  if (e.mirror) {
    out.push(
      table(
        ["metric", "single", "mirror-averaged", "delta"],
        [
          ["AUC", num(e.mirror.auc, 4), num(e.mirror.mirrorAuc, 4), num(e.mirror.mirrorAuc - e.mirror.auc, 4)],
          ["rank-1", pct(e.mirror.rank1), pct(e.mirror.mirrorRank1), pct(e.mirror.mirrorRank1 - e.mirror.rank1)],
        ],
      ),
    )
  } else {
    out.push('<p class="empty">no mirror descriptors in this run</p>')
  }

  out.push("<h3>Alignment residual — the mirror check</h3>")
  out.push(
    '<p class="sub">Reflection is excluded from the similarity transform family, so a swapped landmark order ' +
      "cannot be absorbed by the fit and shows up here as a systematically large residual. A mirrored crop " +
      "otherwise looks entirely plausible and quietly degrades every match.</p>",
  )
  out.push(barsHtml(e.residual.histogram, "residuals"))
  out.push(
    `<p>p50 ${num(e.residual.percentiles.p50)}, p90 ${num(e.residual.percentiles.p90)}, ` +
      `p99 ${num(e.residual.percentiles.p99)}, max ${num(e.residual.percentiles.max)}. ` +
      `${e.residual.above} of ${e.residual.n} exceed the ${num(e.residual.maxResidual, 1)} default.</p>`,
  )
  if (e.residual.percentiles.p50 > e.residual.maxResidual) {
    out.push(
      '<div class="warn"><b>The median residual is above the cutoff.</b> That is not scattered bad landmarks, ' +
        "it is a systematic mirroring. Check the landmark order before believing any number on this page.</div>",
    )
  }

  // --- Conclusion. ---
  out.push("<h2>What the numbers support</h2>")
  out.push(`<div class="verdict"><p><b>${esc(analysis.verdict.headline)}</b></p><p>${esc(analysis.verdict.description)}</p>`)
  if (analysis.verdict.detail.length > 0) {
    out.push("<ul>" + analysis.verdict.detail.map((t) => `<li>${esc(t)}</li>`).join("") + "</ul>")
  }
  out.push("</div>")

  out.push("<h3>Cutoffs to write into public/vision/defaults.js</h3>")
  out.push(
    "<pre>" +
      esc(analysis.recommended.map((r) => `${r.path.padEnd(24)}${r.value.padEnd(12)}// ${r.note}`).join("\n")) +
      "</pre>",
  )
  out.push(
    `<p>The nine <code>gate.*</code> values above were applied <b>together</b> and measured together: they keep ` +
      `<b>${j.result.kept} of ${j.result.total}</b> labelled faces at AUC ${num(j.result.auc, 4)} and rank-1 ` +
      `${pct(j.result.rank1)}, against ${d.baseline.kept}/${d.baseline.total}, ${num(d.baseline.auc, 4)} and ` +
      `${pct(d.baseline.rank1)} for the shipped defaults.` +
      (j.adopted.length === 0 ? " They are the defaults, unchanged, because nothing beat them jointly." : "") +
      "</p>",
  )
  out.push(
    '<div class="warn"><b>Copy the numbers only.</b> No note of what was measured to arrive at them may live ' +
      "anywhere in this repository — and that includes statistics, which are facts about identifiable people. " +
      "This file is scratch; delete it with the rest of <code>tmp/</code>.</div>",
  )

  out.push("</main></body></html>")
  return out.join("\n")
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE =
  "usage: node scripts/vision/session1-report.js <run-dir> [--oracle <file.jsonl>] [--html | --no-html] [--out <file>] [--verbose]"

/** @type {Types.parseArgs} */
export function parseArgs(argv) {
  /** @type {Types.ReportArgs} */
  const args = { dir: null, oracle: null, html: true, out: null, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--html") {
      args.html = true
    } else if (arg === "--no-html") {
      args.html = false
    } else if (arg === "--verbose" || arg === "-v") {
      // Reports B and D lead with a verdict; this restores the full sweeps under
      // it. The HTML always carries both — it has a <details> and a page to hide
      // them in, and a terminal has neither.
      args.verbose = true
    } else if (arg === "--oracle") {
      args.oracle = argv[++i] ?? null
    } else if (arg.startsWith("--oracle=")) {
      args.oracle = arg.slice("--oracle=".length)
    } else if (arg === "--out") {
      args.out = argv[++i] ?? null
    } else if (arg.startsWith("--out=")) {
      args.out = arg.slice("--out=".length)
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}\n${USAGE}`)
    } else if (args.dir === null) {
      // The path is always an argument (SPEC §15 r1). Nothing here searches.
      args.dir = arg
    } else {
      throw new Error(`unexpected argument ${arg}\n${USAGE}`)
    }
  }
  return args
}

/**
 * @param {readonly string[]} argv
 * @returns {number} process exit code
 */
export function main(argv) {
  /** @type {ReturnType<typeof parseArgs>} */
  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
  if (args.dir === null) {
    console.error(USAGE)
    return 1
  }
  if (!fs.existsSync(args.dir)) {
    console.error(`${args.dir}: no such directory`)
    return 1
  }

  const run = loadRun(args.dir)

  // Say what is missing and stop, rather than reporting confidently on nothing.
  /** @type {string[]} */
  const missing = []
  if (run.photos.length === 0) missing.push("photos.jsonl is missing or empty")
  if (run.faces.length === 0) missing.push("faces.jsonl is missing or empty")
  if (run.labels === null) missing.push("labels.json is missing — run label.html first; without it there is nothing to measure against")
  else if (Object.keys(run.labels.labels ?? {}).length === 0) missing.push("labels.json contains no labels")
  if (missing.length > 0) {
    console.error(`Cannot report on ${args.dir}:`)
    for (const line of missing) console.error(`  - ${line}`)
    return 1
  }

  /** @type {Types.OracleRecord[] | null} */
  let oracle = null
  if (args.oracle !== null) {
    if (!fs.existsSync(args.oracle)) {
      console.error(`${args.oracle}: no such file`)
      return 1
    }
    oracle = readJsonl(args.oracle).records
  }

  const poolA = buildView(run, { pool: "A", requireLabel: true })
  if (poolA.labels.length === 0) {
    console.error("No pool-A faces are labelled. Report A's headline number comes only from pool A —")
    console.error("pool B's coverage is conditioned on what the model already grouped confidently, so")
    console.error("including it biases the measurement. Label some pool-A crops and re-run.")
    return 1
  }

  const analysis = analyse(run, { oracle })
  printSummary(analysis, console.log, { verbose: args.verbose })

  if (args.html) {
    const target = args.out ?? path.join(args.dir, "report.html")
    fs.writeFileSync(target, renderHtml(analysis))
    console.log(`\nWrote ${target}`)
  }
  return 0
}

// `import.meta.main` is Node 24+; the argv[1] comparison is the portable form
// and keeps the module importable by the unit test without running anything.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exit(main(process.argv.slice(2)))
}
