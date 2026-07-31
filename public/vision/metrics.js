/** @file The instrument. Everything else in the project is engineering with a
 *  safety net; this is the only genuine unknown.
 *
 *  The wrong instrument is "pick a face, see a ranked list." Ranking can look
 *  fine while grouping fails, because grouping depends on one threshold
 *  separating same-person from different-person ACROSS EVERYBODY, not on nearest
 *  neighbours being right.
 *
 *  So three reports, answering three different questions:
 *
 *    A `separation`      — is there a threshold that works for everybody?
 *    B `groupingQuality` — how good are the groups the cutoff actually produces?
 *    C `leaveOneOutRank1`— how good is matching against known prototypes?
 *
 *  C is not in the original plan and it is the one that decides the product
 *  shape. SESSION-1 §5 Q2 asks "cluster-and-name, or label-a-few-and-classify?"
 *  and points at report B — but B measures clustering, and Q2 is a question
 *  about classification. Without C, Q2 has no number attached to it at all.
 *
 *  `bootstrapAuc` answers a fourth question report A's plain `auc` cannot:
 *  how much would this number move on a different sample of PEOPLE. A pair is
 *  not an independent observation — every pair a person appears in shares
 *  whatever made that person's descriptors easy or hard — so the resample
 *  unit here is the person, not the pair. See the function for the scheme.
 */
/** @import * as Types from './types.js' */

import { centroid, cosineDistance, l2Normalize } from "./group.js"

/** @type {Types.percentile} */
export function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN
  const idx = (sortedAsc.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

/** @type {Types.histogram} */
export function histogram(values, binCount, min, max) {
  const counts = new Int32Array(binCount)
  const span = max - min
  if (span <= 0) return { min, max, counts: Array.from(counts) }
  for (const v of values) {
    let bin = Math.floor(((v - min) / span) * binCount)
    if (bin < 0) bin = 0
    if (bin >= binCount) bin = binCount - 1
    counts[bin]++
  }
  return { min, max, counts: Array.from(counts) }
}

/** @type {Types.pairDistances} */
export function pairDistances(set, options) {
  const { dim, data } = set
  const { labels } = options
  const keep = options.keep
  const n = labels.length

  /** @type {number[]} */
  const same = []
  /** @type {number[]} */
  const diff = []
  /** @type {Types.TaggedSamePair[]} */
  const sameTagged = []
  /** @type {Types.TaggedDiffPair[]} */
  const diffTagged = []

  for (let i = 0; i < n; i++) {
    if (labels[i] === null) continue
    for (let j = i + 1; j < n; j++) {
      if (labels[j] === null) continue
      if (keep && !keep(i, j)) continue
      const d = cosineDistance(data, data, i * dim, j * dim, dim)
      const li = /** @type {string} */ (labels[i])
      const lj = /** @type {string} */ (labels[j])
      if (li === lj) {
        same.push(d)
        sameTagged.push({ distance: d, person: li })
      } else {
        diff.push(d)
        diffTagged.push({ distance: d, personA: li, personB: lj })
      }
    }
  }
  return { same, diff, sameTagged, diffTagged }
}

/** @type {Types.separation} */
export function separation(same, diff, options = {}) {
  const bins = options.bins ?? 40
  const s = same.slice().sort((a, b) => a - b)
  const d = diff.slice().sort((a, b) => a - b)

  if (s.length === 0 || d.length === 0) {
    return {
      sameCount: s.length,
      diffCount: d.length,
      auc: NaN,
      eer: NaN,
      eerThreshold: NaN,
      bestThreshold: NaN,
      bestTpr: NaN,
      bestFpr: NaN,
      fprAt95Tpr: NaN,
      samePercentiles: {},
      diffPercentiles: {},
      sameHistogram: { min: 0, max: 2, counts: [] },
      diffHistogram: { min: 0, max: 2, counts: [] },
    }
  }

  // AUC via the Mann-Whitney statistic: the probability that a random
  // same-person pair is closer than a random different-person pair. Reported
  // first because it is the only headline number here that needs no threshold —
  // it says whether the SIGNAL exists, separately from whether any one cutoff
  // can exploit it.
  let u = 0
  {
    let j = 0
    for (let i = 0; i < s.length; i++) {
      while (j < d.length && d[j] < s[i]) j++
      let ties = 0
      let k = j
      while (k < d.length && d[k] === s[i]) {
        ties++
        k++
      }
      u += j + ties * 0.5
    }
  }
  const auc = 1 - u / (s.length * d.length)

  // Sweep every observed distance as a candidate threshold. "Same person" is
  // predicted when distance <= t, so TPR rises and FPR rises together.
  const candidates = Array.from(new Set(s.concat(d))).sort((a, b) => a - b)
  let bestThreshold = candidates[0]
  let bestYouden = -Infinity
  let bestTpr = 0
  let bestFpr = 0
  let eer = NaN
  let eerThreshold = NaN
  let eerGap = Infinity
  let fprAt95Tpr = NaN
  let si = 0
  let di = 0

  for (const t of candidates) {
    while (si < s.length && s[si] <= t) si++
    while (di < d.length && d[di] <= t) di++
    const tpr = si / s.length
    const fpr = di / d.length
    const youden = tpr - fpr
    if (youden > bestYouden) {
      bestYouden = youden
      bestThreshold = t
      bestTpr = tpr
      bestFpr = fpr
    }
    const gap = Math.abs(1 - tpr - fpr)
    if (gap < eerGap) {
      eerGap = gap
      eer = (1 - tpr + fpr) / 2
      eerThreshold = t
    }
    // The product-shaped number: to catch 95% of true matches, how often does a
    // pair of different people land inside the threshold?
    if (tpr >= 0.95 && Number.isNaN(fprAt95Tpr)) fprAt95Tpr = fpr
  }

  const lo = Math.min(s[0], d[0])
  const hi = Math.max(s[s.length - 1], d[d.length - 1])
  /** @param {number[]} sorted */
  const pcts = (sorted) => ({
    p01: percentile(sorted, 0.01),
    p05: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  })

  return {
    sameCount: s.length,
    diffCount: d.length,
    auc,
    eer,
    eerThreshold,
    bestThreshold,
    bestTpr,
    bestFpr,
    fprAt95Tpr,
    samePercentiles: pcts(s),
    diffPercentiles: pcts(d),
    sameHistogram: histogram(s, bins, lo, hi),
    diffHistogram: histogram(d, bins, lo, hi),
  }
}

/** @type {Types.groupingQuality} */
export function groupingQuality(groups, labels) {
  /** @type {Map<string, number>} */
  const labelTotals = new Map()
  for (const l of labels) {
    if (l !== null) labelTotals.set(l, (labelTotals.get(l) ?? 0) + 1)
  }

  let labelled = 0
  let purityHits = 0
  let tp = 0
  let fp = 0
  /** @type {Map<string, number>} */
  const bestGroupForLabel = new Map()

  for (const group of groups) {
    /** @type {Map<string, number>} */
    const counts = new Map()
    for (const m of group.members) {
      const l = labels[m]
      if (l === null) continue
      counts.set(l, (counts.get(l) ?? 0) + 1)
    }
    let inGroup = 0
    let top = 0
    for (const [l, c] of counts) {
      inGroup += c
      if (c > top) top = c
      if (c > (bestGroupForLabel.get(l) ?? 0)) bestGroupForLabel.set(l, c)
      // Pairs the grouping asserted are the same person, and are.
      tp += (c * (c - 1)) / 2
    }
    // Pairs it asserted, that are not.
    fp += (inGroup * (inGroup - 1)) / 2 - [...counts.values()].reduce((a, c) => a + (c * (c - 1)) / 2, 0)
    labelled += inGroup
    purityHits += top
  }

  let actualSamePairs = 0
  for (const total of labelTotals.values()) actualSamePairs += (total * (total - 1)) / 2
  const fn = actualSamePairs - tp

  // Completeness weighted by person size: how much of each person landed in
  // their single largest group. Deliberate over-splitting drives this down and
  // that is fine — the interface merges. It is here so the cost of over-
  // splitting is visible rather than assumed away.
  let completenessNum = 0
  for (const [l, total] of labelTotals) completenessNum += bestGroupForLabel.get(l) ?? 0

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1

  return {
    groups: groups.length,
    labelledFaces: labelled,
    people: labelTotals.size,
    purity: labelled > 0 ? purityHits / labelled : 0,
    completeness: labelled > 0 ? completenessNum / labelled : 0,
    pairPrecision: precision,
    pairRecall: recall,
    pairF1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    // The failure that actually hurts: two different people welded together.
    weldedGroups: groups.filter((g) => {
      /** @type {Set<string>} */
      const seen = new Set()
      for (const m of g.members) if (labels[m] !== null) seen.add(/** @type {string} */ (labels[m]))
      return seen.size > 1
    }).length,
  }
}

/** @type {Types.leaveOneOutRank1} */
export function leaveOneOutRank1(set, labels, options = {}) {
  const { dim, data } = set
  // The mask restricts which faces are ASKED, never which people can answer.
  // That distinction is the whole point of it: a held-out evaluation that also
  // shrank the candidate pool would be measuring an easier problem — picking the
  // right person out of six is not picking them out of thirty — and the number
  // would not be comparable to the in-sample one it exists to be compared with.
  const queryMask = options.queryMask ?? null

  /** @type {Map<string, number[]>} */
  const byLabel = new Map()
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]
    if (l === null) continue
    const list = byLabel.get(l)
    if (list) list.push(i)
    else byLabel.set(l, [i])
  }

  // A person with one face has no prototype to match against once that face is
  // held out, so they cannot participate. Reported, not silently dropped.
  const singletons = [...byLabel.values()].filter((v) => v.length < 2).length
  /** @type {Map<string, Float32Array>} */
  const sums = new Map()
  for (const [l, idx] of byLabel) {
    const sum = new Float32Array(dim)
    for (const i of idx) for (let k = 0; k < dim; k++) sum[k] += data[i * dim + k]
    sums.set(l, sum)
  }

  let evaluated = 0
  let correct = 0
  /** @type {number[]} */
  const margins = []
  /** @type {Map<string, { n: number, correct: number }>} */
  const perPerson = new Map()

  const held = new Float32Array(dim)
  for (const [trueLabel, idx] of byLabel) {
    if (idx.length < 2) continue
    const sum = /** @type {Float32Array} */ (sums.get(trueLabel))
    for (const i of idx) {
      if (queryMask !== null && !queryMask[i]) continue
      // The prototype for the true person excludes the face being tested. Not
      // doing this is the classic way to measure a number far better than the
      // one the feature would actually deliver.
      for (let k = 0; k < dim; k++) held[k] = (sum[k] - data[i * dim + k]) / (idx.length - 1)
      const trueProto = l2Normalize(held)

      let dTrue = cosineDistance(data, trueProto, i * dim, 0, dim)
      let dBestWrong = Infinity
      for (const [otherLabel, otherIdx] of byLabel) {
        if (otherLabel === trueLabel) continue
        const proto = centroid(set, otherIdx)
        const dist = cosineDistance(data, proto, i * dim, 0, dim)
        if (dist < dBestWrong) dBestWrong = dist
      }

      evaluated++
      const hit = dTrue < dBestWrong
      if (hit) correct++
      // Positive means the right person won, and by how much.
      margins.push(dBestWrong - dTrue)
      const rec = perPerson.get(trueLabel) ?? { n: 0, correct: 0 }
      rec.n++
      if (hit) rec.correct++
      perPerson.set(trueLabel, rec)
    }
  }

  const sortedMargins = margins.slice().sort((a, b) => a - b)
  return {
    evaluated,
    correct,
    rank1: evaluated > 0 ? correct / evaluated : NaN,
    singletonPeople: singletons,
    marginPercentiles: {
      p05: percentile(sortedMargins, 0.05),
      p25: percentile(sortedMargins, 0.25),
      p50: percentile(sortedMargins, 0.5),
      p75: percentile(sortedMargins, 0.75),
    },
    perPerson: [...perPerson.entries()]
      .map(([label, r]) => ({ label, n: r.n, rank1: r.correct / r.n }))
      .sort((a, b) => b.n - a.n),
  }
}

/**
 * Weighted Mann-Whitney AUC: the same merge-scan `separation` uses (tie
 * weight split at the midpoint), generalised so every pair carries a weight
 * instead of counting for exactly one. Weight 0 removes a pair from the
 * statistic without needing a second code path for "not present."
 * @param {Array<{ distance: number, weight: number }>} same
 * @param {Array<{ distance: number, weight: number }>} diff
 * @returns {{ auc: number, totalSameWeight: number, totalDiffWeight: number }}
 */
function weightedAuc(same, diff) {
  const s = same.slice().sort((a, b) => a.distance - b.distance)
  const d = diff.slice().sort((a, b) => a.distance - b.distance)

  let totalSameWeight = 0
  for (const e of s) totalSameWeight += e.weight
  let totalDiffWeight = 0
  for (const e of d) totalDiffWeight += e.weight

  if (totalSameWeight === 0 || totalDiffWeight === 0) {
    return { auc: NaN, totalSameWeight, totalDiffWeight }
  }

  let u = 0
  let j = 0
  let cumDiffWeightBelow = 0
  for (let i = 0; i < s.length; i++) {
    while (j < d.length && d[j].distance < s[i].distance) {
      cumDiffWeightBelow += d[j].weight
      j++
    }
    let tiedWeight = 0
    let k = j
    while (k < d.length && d[k].distance === s[i].distance) {
      tiedWeight += d[k].weight
      k++
    }
    u += s[i].weight * (cumDiffWeightBelow + tiedWeight * 0.5)
  }
  const auc = 1 - u / (totalSameWeight * totalDiffWeight)
  return { auc, totalSameWeight, totalDiffWeight }
}

/**
 * Poisson(1) via Knuth's algorithm, from an injected uniform source. This is
 * the multiplicity a person gets in one bootstrap resample: mean 1 (so the
 * expected resample looks like the original), integer, unbounded above, and
 * — the property that makes it an acceptable stand-in for the "true"
 * multinomial resample of people — cheap to draw one person at a time
 * without knowing how many people there are in total.
 * @param {() => number} random
 * @returns {number}
 */
function poisson1(random) {
  const L = Math.E ** -1
  let k = 0
  let p = 1
  do {
    k++
    p *= random()
  } while (p > L)
  return k - 1
}

/** @type {Types.bootstrapAuc} */
export function bootstrapAuc(same, diff, random, resamples) {
  /** @type {Set<string>} */
  const samePeople = new Set()
  for (const e of same) samePeople.add(e.person)
  /** @type {Set<string>} */
  const diffPeople = new Set()
  for (const e of diff) {
    diffPeople.add(e.personA)
    diffPeople.add(e.personB)
  }

  // A cluster bootstrap over fewer than 3 clusters on either side cannot
  // produce a meaningful interval — there are too few independent units for
  // resampling to vary over. Refused outright: NaN throughout, zero
  // resamples actually run, rather than a confident-looking interval built
  // on a bootstrap that couldn't do its job.
  if (samePeople.size < 3 || diffPeople.size < 3) {
    return { auc: NaN, lo: NaN, hi: NaN, resamples: 0, degenerate: 0 }
  }

  /** @type {Set<string>} */
  const allPeople = new Set([...samePeople, ...diffPeople])

  // The point estimate: every person weighted 1, which is exactly the
  // statistic `separation`'s AUC reports, computed through the same weighted
  // path the resamples use below.
  const point = weightedAuc(
    same.map((e) => ({ distance: e.distance, weight: 1 })),
    diff.map((e) => ({ distance: e.distance, weight: 1 })),
  ).auc

  let degenerate = 0
  /** @type {number[]} */
  const aucs = []
  for (let r = 0; r < resamples; r++) {
    /** @type {Map<string, number>} */
    const weight = new Map()
    for (const person of allPeople) weight.set(person, poisson1(random))

    const sameWeighted = same.map((e) => ({
      distance: e.distance,
      weight: /** @type {number} */ (weight.get(e.person)),
    }))
    const diffWeighted = diff.map((e) => ({
      distance: e.distance,
      weight:
        /** @type {number} */ (weight.get(e.personA)) * /** @type {number} */ (weight.get(e.personB)),
    }))

    const resampled = weightedAuc(sameWeighted, diffWeighted)
    // Reweighting, never duplicating, means a resample CAN land with every
    // relevant person drawn at weight 0 — reported, not silently dropped or
    // silently retried, because how often that happens is itself a fact
    // about how thin the labelled data is.
    if (resampled.totalSameWeight === 0 || resampled.totalDiffWeight === 0) {
      degenerate++
      continue
    }
    aucs.push(resampled.auc)
  }

  const sorted = aucs.slice().sort((a, b) => a - b)
  return {
    auc: point,
    lo: sorted.length > 0 ? percentile(sorted, 0.025) : NaN,
    hi: sorted.length > 0 ? percentile(sorted, 0.975) : NaN,
    resamples,
    degenerate,
  }
}
