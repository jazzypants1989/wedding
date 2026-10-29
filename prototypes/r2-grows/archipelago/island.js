/** @file Archipelago: every note raises an island.
 *
 *    island size        how much was written
 *    each sentence      a hill; the more words, the broader and higher
 *    each emoji         a sea stack off the coast
 *    the summit         named for the note's most particular word ("Mt. Thanksgiving"),
 *                       its height the note's length in characters
 *    a bay              named for the next most particular word ("Peach Bay")
 *    the island's name  the author's, and its kind (Rock, Cay, Isle, Highlands) by size
 *    a lighthouse       on any note that mentions one, and on every emoji-only rock
 *    a Favorite         gets a capital's star and a name in capitals
 *
 *  Contours come from marching squares over a seeded height field; the coast
 *  is filled, the hills are hypsometric tints, and engraved water-lines ring
 *  the shore. Pure: entry in, SVG string out, centred on (0,0). */

import { seeded, entryKey, f } from "../shared/seed.js"
import { sentences, words, keyName, salientWords, stem } from "../shared/text.js"

/** @import { Entry } from "../shared/fixture.js" */

const G = 44
const COAST = 0.12
const LAND = [0.3, 0.48, 0.66, 0.84]
const WATER = [0.075, 0.042, 0.02]

/**
 * @typedef {{ markup: string, R: number, name: string, summit: string | null, bay: string | null,
 *   elevation: number, peak: number[], words: number }} Island
 */

/** @param {number} t */
const smooth = (t) => t * t * (3 - 2 * t)

/** A seeded 2D value noise on a coarse lattice. @param {() => number} r @param {number} L */
function valueNoise(r, L) {
  const v = Array.from({ length: (L + 1) * (L + 1) }, () => r() * 2 - 1)
  return (/** @type {number} */ x, /** @type {number} */ y) => {
    const gx = ((x + 1) / 2) * L
    const gy = ((y + 1) / 2) * L
    const i = Math.min(L - 1, Math.max(0, Math.floor(gx)))
    const j = Math.min(L - 1, Math.max(0, Math.floor(gy)))
    const tx = smooth(gx - i)
    const ty = smooth(gy - j)
    const a = v[j * (L + 1) + i]
    const b = v[j * (L + 1) + i + 1]
    const c = v[(j + 1) * (L + 1) + i]
    const d = v[(j + 1) * (L + 1) + i + 1]
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
  }
}

/** Marching squares → closed, smoothed loops for one level. Grid coords map to [-1,1].
 *  @param {Float64Array} h @param {number} level @returns {number[][][]} */
function contour(h, level) {
  /** @type {Map<string, {a: number[], b: number[], used: boolean}[]>} */
  const ends = new Map()
  /** @type {{a: number[], b: number[], used: boolean}[]} */
  const segs = []
  const P = (/** @type {number} */ i, /** @type {number} */ j) => h[j * (G + 1) + i]
  const lerp = (/** @type {number} */ i0, /** @type {number} */ j0, /** @type {number} */ i1, /** @type {number} */ j1) => {
    const v0 = P(i0, j0)
    const v1 = P(i1, j1)
    const t = (level - v0) / (v1 - v0 || 1e-9)
    return [i0 + (i1 - i0) * t, j0 + (j1 - j0) * t]
  }
  const key = (/** @type {number[]} */ p) => Math.round(p[0] * 1000) + "," + Math.round(p[1] * 1000)
  const add = (/** @type {number[]} */ a, /** @type {number[]} */ b) => {
    const s = { a, b, used: false }
    segs.push(s)
    for (const k of [key(a), key(b)]) {
      const list = ends.get(k)
      if (list) list.push(s)
      else ends.set(k, [s])
    }
  }
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const c = (P(i, j) > level ? 8 : 0) | (P(i + 1, j) > level ? 4 : 0) | (P(i + 1, j + 1) > level ? 2 : 0) | (P(i, j + 1) > level ? 1 : 0)
      if (c === 0 || c === 15) continue
      const top = () => lerp(i, j, i + 1, j)
      const right = () => lerp(i + 1, j, i + 1, j + 1)
      const bottom = () => lerp(i, j + 1, i + 1, j + 1)
      const left = () => lerp(i, j, i, j + 1)
      switch (c) {
        case 1: case 14: add(left(), bottom()); break
        case 2: case 13: add(bottom(), right()); break
        case 3: case 12: add(left(), right()); break
        case 4: case 11: add(top(), right()); break
        case 6: case 9: add(top(), bottom()); break
        case 7: case 8: add(left(), top()); break
        case 5: add(left(), top()); add(bottom(), right()); break
        case 10: add(top(), right()); add(left(), bottom()); break
      }
    }
  }
  /** @type {number[][][]} */
  const loops = []
  for (const s0 of segs) {
    if (s0.used) continue
    s0.used = true
    const loop = [s0.a, s0.b]
    let cur = s0.b
    for (let guard = 0; guard < 4000; guard++) {
      const list = ends.get(key(cur)) || []
      const next = list.find((s) => !s.used)
      if (!next) break
      next.used = true
      cur = key(next.a) === key(cur) ? next.b : next.a
      loop.push(cur)
    }
    if (loop.length > 4) loops.push(loop.map(([x, y]) => [(x / G) * 2 - 1, (y / G) * 2 - 1]))
  }
  return loops
}

/** Loops → path data with quadratic smoothing through midpoints. @param {number[][][]} loops @param {number} R */
function loopsPath(loops, R) {
  let d = ""
  for (const L of loops) {
    const n = L.length
    const mid = (/** @type {number} */ k) => [((L[k % n][0] + L[(k + 1) % n][0]) / 2) * R, ((L[k % n][1] + L[(k + 1) % n][1]) / 2) * R]
    const m0 = mid(0)
    d += `M${f(m0[0])} ${f(m0[1])}`
    for (let k = 1; k <= n; k++) {
      const p = L[k % n]
      const m = mid(k)
      d += `Q${f(p[0] * R)} ${f(p[1] * R)} ${f(m[0])} ${f(m[1])}`
    }
    d += "Z"
  }
  return d
}

const KINDS = {
  rock: ["{N} Rock", "{N}'s Skerry", "{N} Stack"],
  cay: ["{N} Cay", "{N} Holm", "Little {N}", "{N} Key"],
  isle: ["{N} Island", "Isle of {N}", "{N}'s Isle", "{N} Island"],
  big: ["Greater {N}", "The {N} Highlands"],
}

/** @param {string} w */
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)

/** @param {Entry} e @param {{scale?: number, rough?: number}} [opts] @returns {Island} */
export function raiseIsland(e, opts = {}) {
  const s = seeded(entryKey(e, "island"))
  const sents = sentences(e.message)
  const nWords = words(e.message).length
  const emoji = sents.reduce((a, x) => a + x.emoji.length, 0)
  const R = Math.min(130, 20 + 9.5 * Math.sqrt(nWords + emoji * 2)) * (opts.scale ?? 1)
  const rough = opts.rough ?? 1

  // Height field: one hill per sentence, value noise for coastline character, radial falloff.
  const noise = valueNoise(s.r, 5)
  const fine = valueNoise(s.r, 11)
  // One ridge per sentence: anisotropic, rotated, spread further apart the more
  // sentences there are, so a long note becomes a sprawling, many-lobed island.
  const spread = Math.min(0.5, 0.14 + 0.07 * sents.length)
  /** @type {{x: number, y: number, A: number, sx: number, sy: number, c: number, sn: number}[]} */
  const hills = []
  sents.forEach((x, k) => {
    const w = x.words.length
    if (!w) return
    const a = s.range(0, Math.PI * 2)
    const rr = sents.length === 1 ? s.range(0, 0.1) : s.range(0.35, 1) * spread
    const sig = 0.13 + 0.04 * Math.sqrt(w + 1)
    const th = s.range(0, Math.PI)
    hills.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr, A: 0.45 + 0.55 * Math.min(1, w / 14), sx: sig * s.range(0.9, 1.7), sy: sig * s.range(0.45, 0.9), c: Math.cos(th), sn: Math.sin(th) })
    // Long sentences throw off a spur.
    if (w > 9) {
      const b = a + s.range(-1.2, 1.2)
      hills.push({ x: Math.cos(b) * (rr + sig), y: Math.sin(b) * (rr + sig), A: 0.35, sx: sig * 0.8, sy: sig * 0.4, c: Math.cos(b), sn: Math.sin(b) })
    }
  })
  if (!hills.length && nWords) hills.push({ x: 0, y: 0, A: 0.6, sx: 0.2, sy: 0.16, c: 1, sn: 0 })
  // Emoji are sea stacks: small, steep, off the main shore.
  for (let k = 0; k < Math.min(3, emoji); k++) {
    const a = s.range(0, Math.PI * 2)
    const r0 = nWords ? 0.6 : k === 0 ? 0 : 0.32
    hills.push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0, A: nWords ? 0.5 : 0.8, sx: 0.08, sy: 0.07, c: 1, sn: 0 })
  }
  const warp = valueNoise(s.r, 4)
  const h = new Float64Array((G + 1) * (G + 1))
  let max = 0
  let peak = [0, 0]
  for (let j = 0; j <= G; j++) {
    for (let i = 0; i <= G; i++) {
      const x0 = (i / G) * 2 - 1
      const y0 = (j / G) * 2 - 1
      // Domain warp: bends the coast into headlands and bays.
      const x = x0 + rough * 0.22 * warp(x0, y0)
      const y = y0 + rough * 0.22 * warp(y0 + 0.37, x0 - 0.21)
      let v = 0
      for (const b of hills) {
        const dx = x - b.x
        const dy = y - b.y
        const u = (dx * b.c + dy * b.sn) / b.sx
        const t = (-dx * b.sn + dy * b.c) / b.sy
        v += b.A * Math.exp(-(u * u + t * t) / 2)
      }
      v += rough * (0.22 * noise(x0, y0) + 0.1 * fine(x0, y0)) * Math.min(1, v * 2.5 + 0.1)
      const dist = Math.sqrt(x0 * x0 + y0 * y0)
      v *= 1 - smooth(Math.min(1, Math.max(0, (dist - 0.66) / 0.32)))
      v = Math.max(0, v)
      h[j * (G + 1) + i] = v
      if (v > max) {
        max = v
        peak = [x0, y0]
      }
    }
  }
  for (let k = 0; k < h.length; k++) h[k] /= max || 1

  const coastLoops = contour(h, COAST)
  let markup = `<g class="ar-water">${WATER.map((l, k) => `<path class="ar-wl ar-wl${k}" d="${loopsPath(contour(h, l), R)}"/>`).join("")}</g>`
  markup += `<path class="ar-land${e.fav ? " ar-fav" : ""}" d="${loopsPath(coastLoops, R)}"/>`
  markup += LAND.map((l, k) => `<path class="ar-hill ar-h${k}" d="${loopsPath(contour(h, l), R)}"/>`).join("")
  markup += `<path class="ar-coast" d="${loopsPath(coastLoops, R)}"/>`

  // Names from the note's own words.
  const N = keyName(e.author_name)
  const sal = salientWords(e.message).filter((w) => w !== N.toLowerCase())
  const uniq = Array.from(new Set(sal.map((w) => w)))
  uniq.sort((a, b) => b.length - a.length)
  const kind = !nWords ? "light" : nWords <= 3 ? "rock" : nWords <= 10 ? "cay" : nWords <= 30 ? "isle" : "big"
  const name = kind === "light" ? N + " Light" : s.pick(KINDS[kind]).replace("{N}", N)
  const summit = nWords >= 6 && uniq[0] ? "Mt. " + cap(uniq[0]) : null
  const bay = nWords >= 10 && uniq[1] ? cap(uniq[1]) + " " + s.pick(["Bay", "Cove", "Sound", "Inlet"]) : null
  const px = peak[0] * R
  const py = peak[1] * R
  if (nWords) markup += `<path class="ar-peak" d="M${f(px)} ${f(py - 3.4)}l3 5.2h-6Z"/>`

  // A lighthouse: on any note that mentions one, and on every wordless rock.
  if (!nWords || e.message.toLowerCase().includes("lighthouse")) {
    let lx = 0
    let ly = 0
    let best = -1
    for (const L of coastLoops) {
      for (const p of L) {
        if (p[0] <= best) continue
        best = p[0]
        lx = p[0] * R
        ly = p[1] * R
      }
    }
    markup += `<g class="ar-light" transform="translate(${f(lx)} ${f(ly)})"><path class="ar-beam" d="M0 -9L22 -16L22 -2Z"/><path class="ar-tower" d="M-2 0L-1.2 -9H1.2L2 0Z"/><circle class="ar-lamp" cy="-9.5" r="1.6"/></g>`
  }
  if (e.fav) markup += `<g class="ar-capital" transform="translate(${f(px + 8)} ${f(py + 6)})"><circle r="3.6"/><path d="M0 -2.4L0.7 -0.7L2.4 -0.7L1 0.4L1.5 2.2L0 1.1L-1.5 2.2L-1 0.4L-2.4 -0.7L-0.7 -0.7Z"/></g>`

  return { markup, R, name, summit, bay, elevation: e.message.length, peak: [px, py], words: nWords }
}

/** An inset chart of one island, labelled, for a card or a plate.
 *  @param {Entry} e @param {{labels?: boolean, frame?: boolean, rough?: number, V?: number}} [opts] */
export function islandChart(e, opts = {}) {
  const isl = raiseIsland(e, { rough: opts.rough })
  const V = opts.V ?? isl.R * 0.98
  const lab = opts.labels !== false
  const fs = V * 0.11
  const left = isl.peak[0] > 0
  const summit =
    lab && isl.summit
      ? `<text class="ar-t-summit" text-anchor="${left ? "end" : "start"}" x="${f(isl.peak[0] + (left ? -fs * 0.5 : fs * 0.5))}" y="${f(isl.peak[1] - fs * 0.35)}" font-size="${f(fs * 0.8)}">${esc(isl.summit)} <tspan class="ar-t-elev">${isl.elevation}</tspan></text>`
      : ""
  // Soundings: depths in the chart's margin, read from the note's own letters.
  let soundings = ""
  if (opts.frame) {
    const codes = Array.from(e.message).map((c) => c.codePointAt(0) || 0)
    const s = seeded(entryKey(e, "soundings"))
    for (let k = 0; k < 14; k++) {
      const a = s.range(0, Math.PI * 2)
      const r = s.range(0.86, 1.02) * V
      const x = Math.max(-V * 0.9, Math.min(V * 0.9, Math.cos(a) * r))
      const y = Math.max(-V * 0.88, Math.min(V * 0.92, Math.sin(a) * r))
      soundings += `<text x="${f(x)}" y="${f(y)}">${((codes[k % codes.length] || 7) % 37) + 3}</text>`
    }
    soundings = `<g class="ar-sound" font-size="${f(fs * 0.5)}">${soundings}</g><g class="ar-north" transform="translate(${f(V * 0.84)} ${f(-V * 0.78)})"><path d="M0 ${f(-fs)}L${f(fs * 0.32)} ${f(fs * 0.5)}L0 ${f(fs * 0.2)}L${f(-fs * 0.32)} ${f(fs * 0.5)}Z"/><text y="${f(-fs * 1.15)}" font-size="${f(fs * 0.55)}">N</text></g>`
  }
  return `<svg class="ar-chart" viewBox="${f(-V)} ${f(-V)} ${f(2 * V)} ${f(2 * V)}" focusable="false">
    <rect class="ar-sea" x="${f(-V)}" y="${f(-V)}" width="${f(2 * V)}" height="${f(2 * V)}"/>
    ${soundings}
    ${opts.frame ? `<rect class="ar-frame" x="${f(-V + 1)}" y="${f(-V + 1)}" width="${f(2 * V - 2)}" height="${f(2 * V - 2)}"/>` : ""}
    ${isl.markup}${summit}
  </svg>`
}

/** @param {string} v */
function esc(v) {
  return v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

/** Stemmed salient words, for ferry routes between notes that share one. @param {Entry} e */
export function routeWords(e) {
  return Array.from(new Set(salientWords(e.message).map(stem)))
}
