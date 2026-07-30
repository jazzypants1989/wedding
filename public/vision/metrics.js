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

  for (let i = 0; i < n; i++) {
    if (labels[i] === null) continue
    for (let j = i + 1; j < n; j++) {
      if (labels[j] === null) continue
      if (keep && !keep(i, j)) continue
      const d = cosineDistance(data, data, i * dim, j * dim, dim)
      if (labels[i] === labels[j]) same.push(d)
      else diff.push(d)
    }
  }
  return { same, diff }
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
export function leaveOneOutRank1(set, labels) {
  const { dim, data } = set

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
