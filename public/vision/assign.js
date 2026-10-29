/** @file Per-person prototypes and per-photo identity assignment.
 *
 *  `metrics.js`'s `leaveOneOutRank1` answers "if we had prototypes, how often
 *  would rank-1 matching be right" — a number about the whole dataset. This
 *  file is the thing that actually runs per photo, once there ARE prototypes
 *  (built from faces a person has confirmed), and it has to answer a harder
 *  question than "who is the single closest match": every face in one frame
 *  is a distinct person, so the assignment for the whole photo has to be
 *  chosen JOINTLY — one face grabbing the best-fitting prototype can starve a
 *  worse-fitting one out of the correct answer for someone else.
 *
 *  Three deliberate choices:
 *
 *  **An abstain option, priced, not implied.** A face that matches nobody
 *  well should abstain rather than be forced onto whichever prototype is
 *  least bad — a wrong label is worse than no label, and "worse than
 *  abstaining" needs a real cost to compare against, not a heuristic cutoff
 *  bolted on afterward.
 *
 *  **Exact for small k, greedy above it, never Kuhn-Munkres.** A wedding
 *  photo rarely has more than a handful of faces, so an exact search over
 *  small k is both correct and fast; a general assignment solver is a second
 *  intricate algorithm to get subtly wrong for a case that barely occurs.
 *
 *  **Twins are flagged, not adjudicated.** Two faces in one frame whose
 *  descriptors are almost identical are either the same face detected twice
 *  (a dedup miss upstream) or two people who genuinely look alike. Neither
 *  is fixed by picking an assignment — both need a human to look at the
 *  photo — so the function refuses to force distinct identities and says so.
 */
/** @import * as Types from './types.js' */

import { centroid, cosineDistance } from "./group.js"

/** Sentinel for "this slot is abstain," never a valid array index. */
const ABSTAIN = -1

/** Exact search runs up to this many faces; above it, greedy takes over. */
const EXACT_FACE_LIMIT = 8

/** @type {Types.buildPrototypes} */
export function buildPrototypes(set, assignments) {
  /** @type {Map<string, number[]>} */
  const byLabel = new Map()
  for (let i = 0; i < assignments.length; i++) {
    const label = assignments[i]
    if (label === null) continue
    const list = byLabel.get(label)
    if (list) list.push(i)
    else byLabel.set(label, [i])
  }
  // Sorted by label so the result is deterministic regardless of Map
  // iteration order or the order labels first appeared in `assignments`.
  return [...byLabel.keys()]
    .sort()
    .map((label) => ({ label, vector: centroid(set, /** @type {number[]} */ (byLabel.get(label))) }))
}

/** @type {Types.matchFace} */
export function matchFace(descriptor, prototypes) {
  if (prototypes.length === 0) {
    return { candidates: [], best: null, margin: NaN }
  }
  const candidates = prototypes
    .map((p) => ({ label: p.label, distance: cosineDistance(descriptor, p.vector) }))
    .sort((a, b) => a.distance - b.distance)
  const best = candidates[0]
  // Second-best minus best: always >= 0 by construction. Infinity with a
  // single prototype (no competitor to be unsure about — the caller must
  // still check `best.distance` itself, since a lone prototype can be a bad
  // match with nothing around to make that visible as a margin).
  const margin = candidates.length >= 2 ? candidates[1].distance - candidates[0].distance : Infinity
  return { candidates, best, margin }
}

/** @type {Types.confidentMatch} */
export function confidentMatch(match, bar) {
  const best = match.best
  if (!best) return null
  // Negated comparisons so a NaN anywhere abstains rather than passes. An
  // unopposed match (margin Infinity) clears the margin test by design; the
  // distance bar is what stops a lone, distant prototype.
  if (!(best.distance <= bar.maxDistance)) return null
  if (!(match.margin >= bar.minMargin)) return null
  return best
}

/**
 * Exact joint assignment for k <= EXACT_FACE_LIMIT faces.
 *
 * Abstaining never consumes a prototype, so it is never in contention with
 * anyone — which means it does not need its own slot in the permutation at
 * all. For a FIXED permutation of candidate prototypes onto face positions,
 * each face can independently keep its assigned prototype or downgrade to
 * abstain, whichever is cheaper, with no effect on any other face. So for any
 * optimal assignment (some faces matched to distinct prototypes, the rest
 * abstaining), there is a permutation that puts every matched face's true
 * prototype in its position — the unmatched faces just downgrade whatever
 * they land on. Searching every permutation and downgrading face-by-face
 * therefore finds the true optimum; no explicit abstain slot is required.
 * @param {number[][]} cost row i = face i's distance to every prototype, in prototype-array order
 * @param {readonly Types.Prototype[]} prototypes
 * @param {number} abstainCost
 * @returns {{ assignments: Array<{ label: string | null, distance: number | null }>, totalCost: number }}
 */
function exactAssign(cost, prototypes, abstainCost) {
  const k = cost.length
  const p = prototypes.length

  /** @type {number[]} */
  let candidateIndices
  if (p <= k) {
    candidateIndices = prototypes.map((_proto, idx) => idx)
  } else {
    // Only k faces exist, so the optimum can never use more than k distinct
    // prototypes. Restrict to the k prototypes closest to SOME face in the
    // photo — a face's true match can only be lost by this restriction if it
    // isn't the best (or near-best) candidate for anyone here, which is the
    // case an abstain would likely have won anyway.
    /** @type {Array<{ j: number, best: number }>} */
    const ranked = prototypes.map((_proto, j) => {
      let best = Infinity
      for (let i = 0; i < k; i++) if (cost[i][j] < best) best = cost[i][j]
      return { j, best }
    })
    ranked.sort((a, b) => a.best - b.best)
    candidateIndices = ranked.slice(0, k).map((e) => e.j)
  }

  // Padded with ABSTAIN only when there are fewer candidates than faces —
  // those padded positions have no prototype at all (cost effectively
  // infinite), so whichever face lands on one always downgrades.
  /** @type {number[]} */
  const slots = candidateIndices.slice()
  while (slots.length < k) slots.push(ABSTAIN)

  /** @param {number} slot @param {number} face */
  const matchCost = (slot, face) => (slot === ABSTAIN ? Infinity : cost[face][slot])

  let bestTotal = Infinity
  /** @type {number[]} */
  let bestOrder = slots.map((_slot, idx) => idx)

  permute(k, (order) => {
    let total = 0
    for (let i = 0; i < k; i++) total += Math.min(matchCost(slots[order[i]], i), abstainCost)
    if (total < bestTotal) {
      bestTotal = total
      bestOrder = order.slice()
    }
  })

  const assignments = bestOrder.map((slotIdx, i) => {
    const slot = slots[slotIdx]
    const cost1 = matchCost(slot, i)
    return cost1 <= abstainCost ? { label: prototypes[slot].label, distance: cost1 } : { label: null, distance: null }
  })
  return { assignments, totalCost: bestTotal }
}

/**
 * Best-margin-first greedy assignment for k > EXACT_FACE_LIMIT. Settles the
 * most confident face first (least ambiguous choice), removing its prototype
 * from the pool before the next face is decided — the failure mode this
 * avoids is a confident face losing its correct prototype to a less certain
 * one that happened to be resolved first.
 * @param {number[][]} cost
 * @param {readonly Types.Prototype[]} prototypes
 * @param {number} abstainCost
 * @returns {{ assignments: Array<{ label: string | null, distance: number | null }>, totalCost: number }}
 */
function greedyAssign(cost, prototypes, abstainCost) {
  const k = cost.length
  const usedPrototype = new Uint8Array(prototypes.length)
  /** @type {Array<{ label: string | null, distance: number | null } | null>} */
  const assignments = new Array(k).fill(null)
  /** @type {Set<number>} */
  const remaining = new Set(Array.from({ length: k }, (_face, i) => i))
  let totalCost = 0

  while (remaining.size > 0) {
    let bestFace = -1
    let bestProto = -1
    let bestDistance = Infinity
    let bestMargin = -Infinity

    for (const i of remaining) {
      let d1 = Infinity
      let d2 = Infinity
      let j1 = -1
      for (let j = 0; j < prototypes.length; j++) {
        if (usedPrototype[j]) continue
        const d = cost[i][j]
        if (d < d1) {
          d2 = d1
          d1 = d
          j1 = j
        } else if (d < d2) {
          d2 = d
        }
      }
      if (j1 < 0) continue
      // Same margin convention as matchFace, with abstaining standing in for
      // a competitor when no second prototype remains.
      const margin = Math.min(d2, abstainCost) - d1
      if (margin > bestMargin) {
        bestMargin = margin
        bestFace = i
        bestProto = j1
        bestDistance = d1
      }
    }

    if (bestFace < 0) {
      // No prototype left unused at all: everyone still waiting abstains.
      for (const i of remaining) {
        assignments[i] = { label: null, distance: null }
        totalCost += abstainCost
      }
      break
    }

    if (bestDistance <= abstainCost) {
      assignments[bestFace] = { label: prototypes[bestProto].label, distance: bestDistance }
      totalCost += bestDistance
      usedPrototype[bestProto] = 1
    } else {
      assignments[bestFace] = { label: null, distance: null }
      totalCost += abstainCost
    }
    remaining.delete(bestFace)
  }

  return {
    assignments: /** @type {Array<{ label: string | null, distance: number | null }>} */ (assignments),
    totalCost,
  }
}

/**
 * Heap's algorithm: every permutation of `[0, n)`, each delivered to `visit`
 * as a fresh array. n! calls to `visit`, no allocation-heavy recursion.
 * @param {number} n
 * @param {(order: number[]) => void} visit
 */
function permute(n, visit) {
  const order = Array.from({ length: n }, (_unused, i) => i)
  visit(order.slice())
  const c = new Int32Array(n)
  let i = 0
  while (i < n) {
    if (c[i] < i) {
      const swapWith = i % 2 === 0 ? 0 : c[i]
      const tmp = order[swapWith]
      order[swapWith] = order[i]
      order[i] = tmp
      visit(order.slice())
      c[i]++
      i = 0
    } else {
      c[i] = 0
      i++
    }
  }
}

/** @type {Types.assignPhoto} */
export function assignPhoto(faces, prototypes, options) {
  const k = faces.length
  const abstainCost = options.abstainCost
  const cutoff = options.sameFaceSuspicionCutoff

  /** @type {Array<[number, number]>} */
  const suspiciousPairs = []
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      if (cosineDistance(faces[i], faces[j]) < cutoff) suspiciousPairs.push([i, j])
    }
  }
  if (suspiciousPairs.length > 0) {
    return {
      assignments: faces.map((_face, faceIndex) => ({ faceIndex, label: null, distance: null })),
      suspicious: true,
      suspiciousPairs,
      totalCost: null,
    }
  }

  if (k === 0) {
    return { assignments: [], suspicious: false, suspiciousPairs: [], totalCost: 0 }
  }

  const cost = faces.map((face) => prototypes.map((p) => cosineDistance(face, p.vector)))
  const result = k <= EXACT_FACE_LIMIT ? exactAssign(cost, prototypes, abstainCost) : greedyAssign(cost, prototypes, abstainCost)

  return {
    assignments: result.assignments.map((a, faceIndex) => ({ faceIndex, ...a })),
    suspicious: false,
    suspiciousPairs: [],
    totalCost: result.totalCost,
  }
}
