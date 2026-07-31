/** @file Unit test: the instrument.
 *
 *  These reports are the only thing that decides whether the feature is worth
 *  building, so a bug here is worse than a bug in the pipeline — a broken
 *  pipeline produces a bad answer, a broken instrument produces a confident
 *  wrong one. Every statistic is checked against a case computed by hand.
 *
 *  Imports browser vision modules, so this file is excluded from the server
 *  tsconfig (see tsconfig.json).
 */

import { test } from "node:test"
import assert from "node:assert"

import {
  bootstrapAuc,
  groupingQuality,
  histogram,
  leaveOneOutRank1,
  pairDistances,
  percentile,
  separation,
} from "../../public/vision/metrics.js"

function set(rows) {
  const dim = rows[0].length
  const data = new Float32Array(rows.length * dim)
  rows.forEach((row, i) => data.set(row, i * dim))
  return { dim, data }
}

const onCircle = (angle) => [Math.cos(angle), Math.sin(angle)]

/** Two people, three faces each, tightly clustered and far apart. */
function twoPeople() {
  return {
    set: set([
      onCircle(0),
      onCircle(0.02),
      onCircle(0.04),
      onCircle(2),
      onCircle(2.02),
      onCircle(2.04),
    ]),
    labels: ["a", "a", "a", "b", "b", "b"],
  }
}

test("percentile interpolates and handles the ends", () => {
  const v = [1, 2, 3, 4, 5]
  assert.equal(percentile(v, 0), 1)
  assert.equal(percentile(v, 1), 5)
  assert.equal(percentile(v, 0.5), 3)
  assert.equal(percentile(v, 0.25), 2)
  assert.ok(Number.isNaN(percentile([], 0.5)))
})

test("histogram bins, clamps out-of-range values, and counts everything", () => {
  const h = histogram([0, 1, 2, 3, 4, 99, -99], 4, 0, 4)
  assert.equal(h.counts.reduce((a, b) => a + b, 0), 7, "nothing dropped")
  assert.equal(h.counts[0], 2, "-99 clamps into the first bin with 0")
  assert.equal(h.counts[3], 3, "4 and 99 clamp into the last bin with 3")
})

test("pairDistances splits by label and skips unlabelled faces", () => {
  const { set: s } = twoPeople()
  const labels = ["a", "a", null, "b", "b", "b"]
  const { same, diff } = pairDistances(s, { labels })
  // 5 labelled faces: a has 2 (1 same pair), b has 3 (3 same pairs) = 4 same,
  // and 2*3 = 6 cross pairs.
  assert.equal(same.length, 4)
  assert.equal(diff.length, 6)
  assert.ok(Math.max(...same) < Math.min(...diff), "same-person pairs are closer")
})

test("pairDistances tags every pair with the person(s) it belongs to", () => {
  const { set: s, labels } = twoPeople()
  const { same, diff, sameTagged, diffTagged } = pairDistances(s, { labels })
  assert.equal(sameTagged.length, same.length)
  assert.equal(diffTagged.length, diff.length)
  assert.ok(sameTagged.every((e) => e.person === "a" || e.person === "b"))
  assert.ok(diffTagged.every((e) => (e.personA === "a" && e.personB === "b") || (e.personA === "b" && e.personB === "a")))
  // The distances line up with the untagged arrays position-for-position.
  assert.deepEqual(
    sameTagged.map((e) => e.distance),
    same,
  )
  assert.deepEqual(
    diffTagged.map((e) => e.distance),
    diff,
  )
})

test("the keep filter drops pairs — this is how the strata are built", () => {
  const { set: s, labels } = twoPeople()
  const all = pairDistances(s, { labels })
  // Exclude anything involving face 0. Person a keeps one same-pair (1,2) and
  // person b keeps all three; the cross pairs drop from 9 to 6.
  const filtered = pairDistances(s, { labels, keep: (i, j) => i !== 0 && j !== 0 })
  assert.equal(all.same.length, 6)
  assert.equal(all.diff.length, 9)
  assert.equal(filtered.same.length, 4)
  assert.equal(filtered.diff.length, 6)
})

test("separation: perfectly separated distributions score AUC 1 and EER 0", () => {
  const report = separation([0.1, 0.15, 0.2], [0.8, 0.9, 1.0])
  assert.equal(report.auc, 1)
  assert.ok(report.eer < 1e-9, `eer ${report.eer}`)
  assert.equal(report.bestTpr, 1)
  assert.equal(report.bestFpr, 0)
  assert.equal(report.fprAt95Tpr, 0)
  assert.ok(report.bestThreshold >= 0.2 && report.bestThreshold < 0.8)
})

test("separation: identical distributions score AUC 0.5", () => {
  const both = [0.1, 0.2, 0.3, 0.4]
  const report = separation(both, both)
  assert.ok(Math.abs(report.auc - 0.5) < 1e-9, `auc ${report.auc}`)
})

test("separation: AUC is the probability a same pair is closer than a diff pair", () => {
  // same = [1, 5], diff = [2, 3]. Pairs: (1,2)✓ (1,3)✓ (5,2)✗ (5,3)✗ -> 2/4.
  assert.ok(Math.abs(separation([1, 5], [2, 3]).auc - 0.5) < 1e-9)
  // same = [1, 2], diff = [3, 4]. All four ✓.
  assert.ok(Math.abs(separation([1, 2], [3, 4]).auc - 1) < 1e-9)
  // Reversed: the signal is inverted, and the number must say so rather than
  // silently reporting the absolute strength.
  assert.ok(Math.abs(separation([3, 4], [1, 2]).auc - 0) < 1e-9)
})

test("separation: ties count as half, so AUC cannot be gamed by duplicates", () => {
  assert.ok(Math.abs(separation([1, 1], [1, 1]).auc - 0.5) < 1e-9)
})

test("separation: fprAt95Tpr is the operating point, not the optimum", () => {
  // 20 same-person distances, one of which is a long-tail outlier sitting inside
  // the different-person mass. Catching 95% must not require reaching it.
  const same = Array.from({ length: 19 }, (_, i) => 0.1 + i * 0.005).concat([0.9])
  const diff = Array.from({ length: 20 }, (_, i) => 0.7 + i * 0.01)
  const report = separation(same, diff)
  assert.ok(report.fprAt95Tpr < 0.05, `fprAt95Tpr ${report.fprAt95Tpr}`)
})

test("separation survives an empty side rather than throwing", () => {
  const report = separation([], [1, 2])
  assert.equal(report.sameCount, 0)
  assert.ok(Number.isNaN(report.auc))
})

test("groupingQuality: a perfect grouping scores 1 across the board", () => {
  const groups = [
    { members: [0, 1, 2], size: 3 },
    { members: [3, 4, 5], size: 3 },
  ]
  const q = groupingQuality(groups, ["a", "a", "a", "b", "b", "b"])
  assert.equal(q.purity, 1)
  assert.equal(q.completeness, 1)
  assert.equal(q.pairPrecision, 1)
  assert.equal(q.pairRecall, 1)
  assert.equal(q.pairF1, 1)
  assert.equal(q.weldedGroups, 0)
  assert.equal(q.people, 2)
})

test("groupingQuality: over-splitting costs recall, not precision", () => {
  // One person split across three singleton groups. This is the failure the
  // design deliberately prefers, so it must be visible and must NOT look like
  // the other one.
  const groups = [
    { members: [0], size: 1 },
    { members: [1], size: 1 },
    { members: [2], size: 1 },
  ]
  const q = groupingQuality(groups, ["a", "a", "a"])
  assert.equal(q.pairPrecision, 1, "no wrong pairs were asserted")
  assert.equal(q.pairRecall, 0, "no right pairs were found either")
  assert.equal(q.weldedGroups, 0)
  assert.ok(Math.abs(q.completeness - 1 / 3) < 1e-9)
})

test("groupingQuality: welding two people together is counted separately", () => {
  // The expensive failure: expensive to notice, annoying to unpick.
  const groups = [{ members: [0, 1, 2, 3], size: 4 }]
  const q = groupingQuality(groups, ["a", "a", "b", "b"])
  assert.equal(q.weldedGroups, 1)
  assert.equal(q.purity, 0.5)
  assert.equal(q.pairRecall, 1, "it did find every true pair")
  // 6 asserted pairs, 2 of them right.
  assert.ok(Math.abs(q.pairPrecision - 2 / 6) < 1e-9, `precision ${q.pairPrecision}`)
})

test("groupingQuality ignores unlabelled members", () => {
  const groups = [{ members: [0, 1, 2], size: 3 }]
  const q = groupingQuality(groups, ["a", "a", null])
  assert.equal(q.labelledFaces, 2)
  assert.equal(q.purity, 1)
  assert.equal(q.weldedGroups, 0)
})

test("leaveOneOutRank1: separable people are all classified correctly", () => {
  const { set: s, labels } = twoPeople()
  const r = leaveOneOutRank1(s, labels)
  assert.equal(r.evaluated, 6)
  assert.equal(r.rank1, 1)
  assert.ok(r.marginPercentiles.p50 > 0, "margins are positive when correct")
})

test("leaveOneOutRank1 holds the face out of its own prototype", () => {
  // Two people whose members are interleaved: person a is at angles 0 and 1,
  // person b at 0.5 and 1.5. Every face's NEAREST other face belongs to the
  // other person, so a nearest-neighbour rule scores 0 — but the prototypes
  // (the means) are still distinguishable. If the held-out face were left in
  // its own prototype this would score a flattering 1 regardless.
  const s = set([onCircle(0), onCircle(1), onCircle(0.5), onCircle(1.5)])
  const r = leaveOneOutRank1(s, ["a", "a", "b", "b"])
  assert.equal(r.evaluated, 4)
  assert.ok(r.rank1 < 1, `a leaky implementation would score 1, got ${r.rank1}`)
})

test("leaveOneOutRank1 reports people it could not evaluate", () => {
  const s = set([onCircle(0), onCircle(0.01), onCircle(2)])
  const r = leaveOneOutRank1(s, ["a", "a", "solo"])
  assert.equal(r.evaluated, 2, "the singleton has no prototype once held out")
  assert.equal(r.singletonPeople, 1)
})

test("leaveOneOutRank1 breaks down per person", () => {
  const { set: s, labels } = twoPeople()
  const r = leaveOneOutRank1(s, labels)
  assert.equal(r.perPerson.length, 2)
  assert.deepEqual(
    r.perPerson.map((p) => p.n),
    [3, 3],
  )
})

test("leaveOneOutRank1 returns NaN rather than 0 when nothing is evaluable", () => {
  // 0/0 is not "perfectly wrong", and a report that prints 0% here would be a
  // lie about the data rather than a result.
  const r = leaveOneOutRank1(set([onCircle(0)]), ["a"])
  assert.equal(r.evaluated, 0)
  assert.ok(Number.isNaN(r.rank1))
})

// --- bootstrapAuc --------------------------------------------------------------

// A small, self-contained deterministic generator (mulberry32) — reproducible
// given a seed, so a test asserting on resampled statistics never flakes.
/** @param {number} seed */
function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Same-pairs: one per person, clustered low, except person 0 ("hard"), whose
 * own same-pair distance is elevated. Diff-pairs: every pair of people,
 * clustered high, except the 0-1 pair, deliberately lowered below several
 * same-pair distances. That crossover is the only source of AUC < 1 here, and
 * its whole contribution rides on persons 0 and 1's bootstrap weights — which
 * is exactly what should make the resampled AUC move, and move more when
 * there are fewer people for that one crossover to get diluted among.
 * @param {number} peopleCount
 */
function overlappingScenario(peopleCount) {
  const people = Array.from({ length: peopleCount }, (_person, i) => `p${i}`)
  const same = people.map((person, i) => ({
    distance: i === 0 ? 0.6 : 0.2 + 0.02 * Math.sin(i),
    person,
  }))
  /** @type {Array<{ distance: number, personA: string, personB: string }>} */
  const diff = []
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const isCrossover = i === 0 && j === 1
      const distance = isCrossover ? 0.3 : 0.75 + 0.02 * Math.cos(i + j)
      diff.push({ distance, personA: people[i], personB: people[j] })
    }
  }
  return { same, diff }
}

test("bootstrapAuc: refuses with fewer than 3 distinct people on either side", () => {
  const same = [
    { distance: 0.1, person: "a" },
    { distance: 0.1, person: "b" },
  ]
  const diff = [{ distance: 0.9, personA: "a", personB: "b" }]
  const r = bootstrapAuc(same, diff, mulberry32(1), 100)
  assert.ok(Number.isNaN(r.auc))
  assert.ok(Number.isNaN(r.lo))
  assert.ok(Number.isNaN(r.hi))
  assert.equal(r.resamples, 0)
  assert.equal(r.degenerate, 0)
})

test("bootstrapAuc: well-separated populations — the interval covers the observed AUC", () => {
  const { same, diff } = overlappingScenario(10)
  const r = bootstrapAuc(same, diff, mulberry32(42), 500)
  assert.ok(r.lo <= r.auc + 1e-9, `lo ${r.lo} should not exceed the point estimate ${r.auc}`)
  assert.ok(r.hi >= r.auc - 1e-9, `hi ${r.hi} should not be below the point estimate ${r.auc}`)
  assert.ok(r.lo >= 0 && r.hi <= 1, "AUC bounds stay in [0, 1]")
  assert.equal(r.resamples, 500)
})

test("bootstrapAuc: the interval widens with fewer people", () => {
  const few = overlappingScenario(3)
  const many = overlappingScenario(10)
  const rFew = bootstrapAuc(few.same, few.diff, mulberry32(7), 500)
  const rMany = bootstrapAuc(many.same, many.diff, mulberry32(7), 500)
  const widthFew = rFew.hi - rFew.lo
  const widthMany = rMany.hi - rMany.lo
  assert.ok(widthFew > widthMany, `expected fewer people to widen the interval: ${widthFew} vs ${widthMany}`)
})

test("bootstrapAuc: degenerate resamples (a side's total cluster weight hits zero) are counted, not dropped", () => {
  // Exactly 3 people (the minimum that isn't refused), each contributing
  // exactly one same-pair: the same side's total weight is zero only when all
  // three simultaneously draw Poisson weight 0, which — over enough
  // resamples — happens often enough to be certain to show up at least once.
  const same = [0, 1, 2].map((i) => ({ distance: 0.2, person: `p${i}` }))
  const diff = [
    { distance: 0.9, personA: "p0", personB: "p1" },
    { distance: 0.9, personA: "p1", personB: "p2" },
    { distance: 0.9, personA: "p0", personB: "p2" },
  ]
  const r = bootstrapAuc(same, diff, mulberry32(11), 500)
  assert.ok(r.degenerate > 0, "expected at least one degenerate resample out of 500")
  assert.ok(r.degenerate < 500, "expected at least one non-degenerate resample out of 500")
  assert.equal(r.resamples, 500)
})
