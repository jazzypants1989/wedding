/** @file Pattern Book: every note is threaded onto a loom and woven.
 *
 *  This is real weaving math, not a texture. A note becomes an 8-shaft
 *  *draft*, the notation weavers have used for centuries:
 *
 *    threading   each letter is one warp end. Words are runs: a word climbs
 *                the shafts one letter at a time, the next word climbs back
 *                down. Word boundaries become the points of the diamonds, so
 *                a long word is a wide diamond. The run is mirrored, the way
 *                coverlet drafts are, so the cloth is symmetric.
 *    treadling   "tromp as writ": the picks follow the same letters, so the
 *                motif is square and reads along its diagonal.
 *    tie-up      chosen by the author's name: one of six twill lines, so one
 *                guest's notes all share a texture.
 *    colour      the weft is the author's (one of six theme tokens); the first
 *                letter of every word is thrown in an accent weft, a stripe at
 *                each diamond's point.
 *
 *  Every page of the book is a loom-ready draft: a weaver could thread an
 *  8-shaft loom from it and weave the couple's coverlet for real.
 *
 *  Pure: entry in, SVG string out. */

import { seeded, entryKey, f } from "../shared/seed.js"
import { words, foldLetters } from "../shared/text.js"

/** @import { Entry } from "../shared/fixture.js" */

export const SHAFTS = 8

/** Twill lines: 1 = warp up on that shaft for treadle 0; later treadles rotate it.
 *  Every line keeps floats ≤ 4 so the cloth would actually hold together. */
const TWILLS = [
  { name: "four-and-four", line: [1, 1, 1, 1, 0, 0, 0, 0] },
  { name: "three-one-one-three", line: [1, 1, 1, 0, 1, 0, 0, 0] },
  { name: "broken", line: [1, 1, 0, 1, 1, 0, 0, 0] },
  { name: "two-and-two", line: [1, 1, 0, 0, 1, 1, 0, 0] },
  { name: "three-and-five", line: [1, 1, 1, 0, 0, 0, 0, 0] },
  { name: "lace", line: [1, 0, 1, 1, 1, 0, 1, 0] },
]
const WEFTS = ["c0", "c1", "c2", "c3", "c4", "c5"]

/**
 * @typedef {{ threading: number[], letters: string[], accents: boolean[],
 *   tieup: number[][], twill: string, weft: string, accent: string, half: number }} Draft
 */

/** @param {Entry} e @param {{ends?: number}} [opts] @returns {Draft} */
export function draft(e, opts = {}) {
  const half = Math.max(8, Math.round((opts.ends ?? 48) / 2))
  const who = seeded("loom" + foldLetters(e.author_name))
  const twill = who.pick(TWILLS)
  const weft = who.pick(WEFTS)
  let accent = who.pick(WEFTS)
  if (accent === weft) accent = WEFTS[(WEFTS.indexOf(weft) + 3) % WEFTS.length]

  let ws = words(e.message)
    .map(foldLetters)
    .filter((w) => w.length > 0)
  if (ws.length === 0) {
    // A note with no letters (an emoji) is threaded from its code points.
    const cps = Array.from(e.message).map((c) => String.fromCharCode(97 + ((c.codePointAt(0) || 0) % 26)))
    ws = [cps.join("") || "x", "love"]
  }
  /** @type {number[]} */ const th = []
  /** @type {string[]} */ const letters = []
  /** @type {boolean[]} */ const accents = []
  let shaft = who.int(0, SHAFTS - 1)
  let wi = 0
  while (th.length < half) {
    const w = ws[wi % ws.length]
    const dir = wi % 2 === 0 ? 1 : -1
    for (let i = 0; i < w.length && th.length < half; i++) {
      shaft = (shaft + dir + SHAFTS) % SHAFTS
      th.push(shaft)
      letters.push(w.charAt(i))
      accents.push(i === 0)
    }
    wi++
  }
  const full = th.concat(th.slice(0, -1).reverse())
  const fullLetters = letters.concat(letters.slice(0, -1).reverse())
  const fullAccents = accents.concat(accents.slice(0, -1).reverse())
  const tieup = []
  for (let t = 0; t < SHAFTS; t++) {
    const row = []
    for (let s = 0; s < SHAFTS; s++) row.push(twill.line[(s - t + SHAFTS) % SHAFTS])
    tieup.push(row)
  }
  return { threading: full, letters: fullLetters, accents: fullAccents, tieup, twill: twill.name, weft, accent, half }
}

/** cell[j][i] is true where warp end i is lifted over pick j (tromp as writ).
 *  @param {Draft} d @returns {boolean[][]} */
export function drawdown(d) {
  const n = d.threading.length
  /** @type {boolean[][]} */
  const rows = []
  for (let j = 0; j < n; j++) {
    const tread = d.threading[j]
    const row = []
    for (let i = 0; i < n; i++) row.push(d.tieup[tread][d.threading[i]] === 1)
    rows.push(row)
  }
  return rows
}

/** A rounded rect as path data. @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function rr(x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2)
  return `M${f(x + q)} ${f(y)}h${f(w - 2 * q)}a${f(q)} ${f(q)} 0 0 1 ${f(q)} ${f(q)}v${f(h - 2 * q)}a${f(q)} ${f(q)} 0 0 1 ${f(-q)} ${f(q)}h${f(-(w - 2 * q))}a${f(q)} ${f(q)} 0 0 1 ${f(-q)} ${f(-q)}v${f(-(h - 2 * q))}a${f(q)} ${f(q)} 0 0 1 ${f(q)} ${f(-q)}Z`
}

let uid = 0

/**
 * The woven cloth: every float drawn as a thread, warp vertical, weft horizontal,
 * each shaded across its width by a repeating gradient so it reads as yarn.
 * @param {Entry} e @param {{ends?: number, cls?: string, plain?: boolean}} [opts]
 */
export function clothSVG(e, opts = {}) {
  const d = draft(e, opts)
  const cells = drawdown(d)
  const n = cells.length
  const c = 10
  const g = 1.15
  let warp = ""
  let weftA = ""
  let weftB = ""
  for (let j = 0; j < n; j++) {
    let i = 0
    while (i < n) {
      if (cells[j][i]) {
        i++
        continue
      }
      let k = i
      while (k < n && !cells[j][k]) k++
      const p = rr(i * c + 0.5, j * c + g, (k - i) * c - 1, c - 2 * g, (c - 2 * g) / 2)
      if (d.accents[j]) weftB += p
      else weftA += p
      i = k
    }
  }
  for (let i = 0; i < n; i++) {
    let j = 0
    while (j < n) {
      if (!cells[j][i]) {
        j++
        continue
      }
      let k = j
      while (k < n && cells[k][i]) k++
      warp += rr(i * c + g, j * c + 0.5, c - 2 * g, (k - j) * c - 1, (c - 2 * g) / 2)
      j = k
    }
  }
  const id = "wv" + uid++
  const size = n * c
  const shade = opts.plain
    ? ""
    : `<defs>
      <linearGradient id="${id}h" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${c}" spreadMethod="repeat"><stop class="wv-st-dk" offset="0.08"/><stop class="wv-st-lt" offset="0.42"/><stop class="wv-st-dk" offset="0.92"/></linearGradient>
      <linearGradient id="${id}v" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${c}" y2="0" spreadMethod="repeat"><stop class="wv-st-dk" offset="0.08"/><stop class="wv-st-lt" offset="0.42"/><stop class="wv-st-dk" offset="0.92"/></linearGradient>
    </defs>`
  return `<svg class="wv-cloth ${d.weft} a-${d.accent} ${opts.cls || ""}" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid slice" focusable="false">${shade}
    <rect class="wv-gap" width="${size}" height="${size}"/>
    <path class="wv-weft" d="${weftA}"/>${opts.plain ? "" : `<path class="wv-sheen" fill="url(#${id}h)" d="${weftA}"/>`}
    <path class="wv-weft wv-accent" d="${weftB}"/>${opts.plain ? "" : `<path class="wv-sheen" fill="url(#${id}h)" d="${weftB}"/>`}
    <path class="wv-warp" d="${warp}"/>${opts.plain ? "" : `<path class="wv-sheen" fill="url(#${id}v)" d="${warp}"/>`}
  </svg>`
}

/**
 * The weaving draft itself, in standard notation: threading across the top
 * (one square per end, on its shaft), the tie-up top-right, the treadling down
 * the right, the drawdown in the middle — and, under the threading, the
 * letters each end was threaded from.
 * @param {Entry} e @param {{ends?: number}} [opts]
 */
export function draftSVG(e, opts = {}) {
  const d = draft(e, opts)
  const cells = drawdown(d)
  const n = cells.length
  const c = 10
  const gap = 12
  const lettersH = 14
  const top = SHAFTS * c + gap + lettersH
  const W = n * c + gap + SHAFTS * c
  const H = top + n * c
  let ink = ""
  let grid = ""
  // threading
  d.threading.forEach((s, i) => {
    ink += `M${i * c} ${(SHAFTS - 1 - s) * c}h${c}v${c}h${-c}Z`
  })
  // tie-up
  const tx = n * c + gap
  d.tieup.forEach((row, t) =>
    row.forEach((v, s) => {
      if (v) ink += `M${tx + t * c} ${(SHAFTS - 1 - s) * c}h${c}v${c}h${-c}Z`
    }),
  )
  // treadling (tromp as writ)
  d.threading.forEach((s, j) => {
    ink += `M${tx + s * c} ${top + j * c}h${c}v${c}h${-c}Z`
  })
  // drawdown: the weft-on-top squares, in the author's weft, so it reads like the cloth
  let dd = ""
  let ddAcc = ""
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      if (!cells[j][i]) {
        const sq = `M${i * c} ${top + j * c}h${c}v${c}h${-c}Z`
        if (d.accents[j]) ddAcc += sq
        else dd += sq
      }
  // grid lines
  const lines = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number} */ cols, /** @type {number} */ rows) => {
    let p = ""
    for (let i = 0; i <= cols; i++) p += `M${x0 + i * c} ${y0}v${rows * c}`
    for (let j = 0; j <= rows; j++) p += `M${x0} ${y0 + j * c}h${cols * c}`
    return p
  }
  grid += lines(0, 0, n, SHAFTS) + lines(tx, 0, SHAFTS, SHAFTS) + lines(tx, top, SHAFTS, n) + lines(0, top, n, n)
  let text = ""
  d.letters.forEach((L, i) => {
    text += `<text x="${i * c + c / 2}" y="${SHAFTS * c + gap / 2 + 9}" class="${d.accents[i] ? "wv-l-acc" : ""}">${L}</text>`
  })
  // A tick every word start along the drawdown's right edge, as a weaver's pick count.
  return `<svg class="wv-draft wv-cloth ${d.weft} a-${d.accent}" viewBox="-2 -2 ${W + 4} ${H + 4}" focusable="false" aria-hidden="true">
    <path class="wv-dd" d="${dd}"/><path class="wv-dd wv-dd-acc" d="${ddAcc}"/><path class="wv-grid" d="${grid}"/><path class="wv-ink" d="${ink}"/>
    <g class="wv-letters">${text}</g>
    <path class="wv-mirror" d="M${(d.half - 0.5) * c} ${SHAFTS * c + 2}v${H - SHAFTS * c - 2}"/>
  </svg>`
}

/** Plain-language facts for a draft caption. @param {Entry} e */
export function draftFacts(e) {
  const d = draft(e)
  return { ends: d.threading.length, twill: d.twill, words: words(e.message).length }
}
