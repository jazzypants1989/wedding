/** @file Agglomerative average-linkage grouping on cosine distance.
 *
 *  Three deliberate choices:
 *
 *  **A distance cutoff, not a target count.** Nobody knows how many people are
 *  in the photographs, and a k that has to be supplied is a k that will be wrong.
 *
 *  **Average linkage, not connected components on a thresholded graph.** The
 *  graph approach chains: one bad edge silently welds two people together and
 *  nothing about the result says so. Average linkage requires a group to be
 *  close to a group.
 *
 *  **The obvious algorithm.** At a few thousand 128-d descriptors the full
 *  distance matrix is tens of megabytes and builds in seconds. An approximate
 *  nearest-neighbour index would be faster and would also be a second thing that
 *  can be subtly wrong.
 */
/** @import * as Types from './types.js' */

/**
 * DISTANCE, not similarity: `1 - cosine`, so 0 is identical and 2 is opposite.
 * Stated once, here, and asserted in the unit tests, because a sign flip between
 * the two conventions produces a clustering that runs, terminates, and is
 * exactly backwards.
 * @type {Types.cosineDistance}
 */
export function cosineDistance(a, b, offsetA = 0, offsetB = 0, dim = a.length) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < dim; i++) {
    const x = a[offsetA + i]
    const y = b[offsetB + i]
    dot += x * y
    na += x * x
    nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 1 : 1 - dot / denom
}

/** @type {Types.l2Normalize} */
export function l2Normalize(vec) {
  let n = 0
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i]
  const len = Math.sqrt(n)
  if (len === 0) return vec
  const out = new Float32Array(vec.length)
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / len
  return out
}

/** @type {Types.distanceMatrix} */
export function distanceMatrix(set) {
  const { dim, data } = set
  const n = data.length / dim
  // Norms once rather than per pair. Descriptors arriving here should already be
  // L2-normalised, but computing this makes the function correct either way for
  // the cost of O(n) work, and "correct either way" is worth more than the
  // saving in a stage that runs once per batch.
  const norms = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < dim; k++) {
      const v = data[i * dim + k]
      s += v * v
    }
    norms[i] = Math.sqrt(s)
  }

  const d = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dot = 0
      for (let k = 0; k < dim; k++) dot += data[i * dim + k] * data[j * dim + k]
      const denom = norms[i] * norms[j]
      const dist = denom === 0 ? 1 : 1 - dot / denom
      d[i * n + j] = dist
      d[j * n + i] = dist
    }
  }
  return { n, d }
}

/** @type {Types.groupFaces} */
export function groupFaces(set, options) {
  const cutoff = options.cutoff
  const photoIds = options.photoIds
  const useCannotLink = options.cannotLinkWithinPhoto !== false
  const { n, d } = options.matrix ?? distanceMatrix(set)

  if (photoIds && photoIds.length !== n) {
    throw new Error(`groupFaces: ${photoIds.length} photo ids for ${n} descriptors`)
  }

  const active = new Uint8Array(n).fill(1)
  const size = new Int32Array(n).fill(1)
  /** @type {number[][]} */
  const members = []
  /** @type {Set<number>[]} */
  const photos = []
  for (let i = 0; i < n; i++) {
    members.push([i])
    photos.push(new Set(photoIds ? [photoIds[i]] : []))
  }

  /**
   * Two faces in one photograph are different people. This is the cheapest
   * constraint available and it blocks the failure that matters most.
   *
   * It is only sound because duplicate detections were merged upstream: two
   * boxes on ONE face in one frame would be forced apart permanently, and no
   * amount of downstream tuning recovers that. See detect-time IoU dedup.
   *
   * Constraints only ever tighten as clusters merge — photo sets grow, never
   * shrink — which is what makes the cache invalidation below sound.
   * @param {number} i @param {number} j
   */
  const allowed = (i, j) => {
    if (!useCannotLink || !photoIds) return true
    const [small, large] = photos[i].size <= photos[j].size ? [photos[i], photos[j]] : [photos[j], photos[i]]
    for (const p of small) if (large.has(p)) return false
    return true
  }

  const bestJ = new Int32Array(n).fill(-1)
  const bestD = new Float64Array(n).fill(Infinity)

  /** @param {number} i */
  const recomputeBest = (i) => {
    let bj = -1
    let bd = Infinity
    const row = i * n
    for (let j = 0; j < n; j++) {
      if (j === i || !active[j]) continue
      const dist = d[row + j]
      if (dist < bd && allowed(i, j)) {
        bd = dist
        bj = j
      }
    }
    bestJ[i] = bj
    bestD[i] = bd
  }
  for (let i = 0; i < n; i++) recomputeBest(i)

  for (;;) {
    let a = -1
    let bd = Infinity
    for (let i = 0; i < n; i++) {
      if (active[i] && bestJ[i] >= 0 && bestD[i] < bd) {
        bd = bestD[i]
        a = i
      }
    }
    if (a < 0 || bd > cutoff) break

    let b = bestJ[a]
    if (b < a) [a, b] = [b, a]

    // Lance-Williams for average linkage: the distance from the merged cluster
    // to any other is the size-weighted mean of the two it replaces. Exact, and
    // it means member descriptors never have to be revisited.
    const sa = size[a]
    const sb = size[b]
    const rowA = a * n
    const rowB = b * n
    for (let c = 0; c < n; c++) {
      if (!active[c] || c === a || c === b) continue
      const merged = (sa * d[rowA + c] + sb * d[rowB + c]) / (sa + sb)
      d[rowA + c] = merged
      d[c * n + a] = merged
    }

    members[a] = members[a].concat(members[b])
    for (const p of photos[b]) photos[a].add(p)
    size[a] = sa + sb
    active[b] = 0
    bestJ[b] = -1
    bestD[b] = Infinity

    recomputeBest(a)
    for (let i = 0; i < n; i++) {
      if (!active[i] || i === a) continue
      if (bestJ[i] === a || bestJ[i] === b) {
        recomputeBest(i)
      } else {
        // Only a's row changed, and a pair that was allowed stays allowed
        // unless it involved a or b — handled by the branch above.
        const dist = d[i * n + a]
        if (dist < bestD[i] && allowed(i, a)) {
          bestD[i] = dist
          bestJ[i] = a
        }
      }
    }
  }

  /** @type {Types.FaceGroup[]} */
  const groups = []
  for (let i = 0; i < n; i++) {
    if (!active[i]) continue
    groups.push({ members: members[i].slice().sort((x, y) => x - y), size: members[i].length })
  }
  // Largest first: the people who show up most are the ones worth naming, and
  // that is also the order the assignment UI should present.
  groups.sort((x, y) => y.size - x.size || x.members[0] - y.members[0])
  return groups
}

/** @type {Types.centroid} */
export function centroid(set, indices) {
  const { dim, data } = set
  const out = new Float32Array(dim)
  if (indices.length === 0) return out
  for (const i of indices) {
    for (let k = 0; k < dim; k++) out[k] += data[i * dim + k]
  }
  for (let k = 0; k < dim; k++) out[k] /= indices.length
  // Re-normalised, so a centroid can be compared to a descriptor with the same
  // dot product the rest of the pipeline uses. The mean of unit vectors is not
  // a unit vector.
  return l2Normalize(out)
}
