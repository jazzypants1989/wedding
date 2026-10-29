/** @file Deterministic randomness for content-grown art. Nothing identity-bearing
 *  ever calls Math.random: every choice comes from a hash of the entry's own
 *  content, so the same note grows the same artwork on every visit and in print.
 *
 *  The seed is author + message, deliberately NOT the row id: the composer can
 *  preview the exact artwork a guest is about to get before the row exists. */

/** FNV-1a over UTF-16 code units, then a murmur-style avalanche.
 *  @param {string} str @returns {number} unsigned 32-bit */
export function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** mulberry32: a tiny seeded PRNG. Returns floats in [0, 1).
 *  @param {number} seed @returns {() => number} */
export function rng(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A seeded helper bag: `r()` float, `range(a,b)`, `int(a,b)` inclusive, `pick(arr)`.
 *  @param {string} key */
export function seeded(key) {
  const r = rng(hash32(key))
  return {
    r,
    /** @param {number} a @param {number} b */
    range: (a, b) => a + (b - a) * r(),
    /** @param {number} a @param {number} b */
    int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    /** @template T @param {readonly T[]} arr @returns {T} */
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    /** @param {number} p */
    chance: (p) => r() < p,
  }
}

/** The identity of a note's artwork. @param {{author_name: string, message: string}} e
 *  @param {string} salt */
export function entryKey(e, salt) {
  return salt + "␟" + (e.author_name || "") + "␟" + (e.message || "")
}

/** Round to 2 decimals for compact SVG. @param {number} n */
export function f(n) {
  return String(Math.round(n * 100) / 100)
}
