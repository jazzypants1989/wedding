/** @file Herbarium: every note grows a plant from its own grammar.
 *
 *  The grammar → botany key (printed in the book's endpaper, so guests can read
 *  their own plant):
 *
 *    each sentence        a branch; the last sentence is the leading shoot
 *    each word            a leaf on that branch; longer words, longer leaves
 *    a comma              a pair of opposite leaves
 *    ends in  .           a flower — the author decides which kind (star, umbel, bell, cup)
 *    ends in  !           a showy double blossom (!!! → three of them)
 *    ends in  ?           a closed bud
 *    ends in  …           berries: the thought is still ripening
 *    no full stop         a curled tendril, still unfurling
 *    an emoji             a special flower: ❤️ heart-petals, 🎉 an allium burst, 🥂 bellflowers
 *    the author's name    leaf shape, petal shape and count, the basal rosette (one leaf per letter-group)
 *    signed after dark    the blossoms come out as pale night-flowers
 *    a Favorite           gold-hearted blooms, and the book stamps it TYPE SPECIMEN
 *
 *  Pure: entry in, SVG string out. Root at (0,0), growing toward −y. */

import { seeded, entryKey, f } from "../shared/seed.js"
import { sentences, words, keyName, foldLetters, salientWords, stem, hourOf, STOPWORDS } from "../shared/text.js"

/** @import { Entry } from "../shared/fixture.js" */
/** @import { Sentence } from "../shared/text.js" */

const DEG = Math.PI / 180
const LEAF_FAMILIES = ["lance", "ovate", "coin", "frond", "blade"]
const PETAL_FAMILIES = ["round", "point", "notch", "strap"]

/**
 * @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box
 * @typedef {{ markup: string, box: Box, binomial: string, key: string[] }} Plant
 * @typedef {{ leafScale?: number, bloomScale?: number, lean?: number, straps?: boolean }} GrowOpts
 */

/** Quadratic Bézier point + tangent angle. @param {number[]} p0 @param {number[]} c @param {number[]} p1 @param {number} t */
function qAt(p0, c, p1, t) {
  const u = 1 - t
  const x = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0]
  const y = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]
  const dx = 2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0])
  const dy = 2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1])
  return { x, y, a: Math.atan2(dy, dx) }
}

/** Leaf outline along +x, length L. @param {string} fam @param {number} L */
function leafPath(fam, L) {
  const w = L * (fam === "blade" ? 0.09 : fam === "lance" ? 0.2 : fam === "coin" ? 0.4 : 0.32)
  if (fam === "coin") {
    const r = L * 0.36
    return `M0 0L${f(L * 0.28)} 0M${f(L * 0.28)} 0a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`
  }
  if (fam === "frond") {
    // A pinnate frond: a midrib with alternating leaflets.
    let d = `M0 0L${f(L)} 0`
    const n = Math.max(3, Math.round(L / 4))
    for (let i = 1; i <= n; i++) {
      const x = (L * i) / (n + 1)
      const s = (1 - i / (n + 1)) * w * 1.3 + 1
      d += `M${f(x)} 0q${f(s * 0.5)} ${f(-s)} ${f(s * 1.2)} ${f(-s * 1.3)}M${f(x)} 0q${f(s * 0.5)} ${f(s)} ${f(s * 1.2)} ${f(s * 1.3)}`
    }
    return d
  }
  if (fam === "ovate") {
    return `M0 0C${f(L * 0.15)} ${f(-w * 1.5)} ${f(L * 0.8)} ${f(-w * 1.1)} ${f(L)} 0C${f(L * 0.8)} ${f(w * 1.1)} ${f(L * 0.15)} ${f(w * 1.5)} 0 0Z`
  }
  return `M0 0Q${f(L * 0.45)} ${f(-w * 1.6)} ${f(L)} 0Q${f(L * 0.45)} ${f(w * 1.6)} 0 0Z`
}

/** One petal along +x from the centre, length R. @param {string} fam @param {number} R @param {number} w */
function petalPath(fam, R, w) {
  if (fam === "point") return `M0 0Q${f(R * 0.4)} ${f(-w)} ${f(R)} 0Q${f(R * 0.4)} ${f(w)} 0 0Z`
  if (fam === "notch")
    return `M0 0C${f(R * 0.3)} ${f(-w * 1.3)} ${f(R * 1.05)} ${f(-w * 1.2)} ${f(R)} ${f(-w * 0.25)}L${f(R * 0.82)} 0L${f(R)} ${f(w * 0.25)}C${f(R * 1.05)} ${f(w * 1.2)} ${f(R * 0.3)} ${f(w * 1.3)} 0 0Z`
  if (fam === "strap") return `M0 ${f(-w * 0.35)}L${f(R * 0.9)} ${f(-w * 0.45)}Q${f(R * 1.08)} 0 ${f(R * 0.9)} ${f(w * 0.45)}L0 ${f(w * 0.35)}Z`
  return `M0 0C${f(R * 0.2)} ${f(-w * 1.4)} ${f(R * 1.1)} ${f(-w * 1.2)} ${f(R)} 0C${f(R * 1.1)} ${f(w * 1.2)} ${f(R * 0.2)} ${f(w * 1.4)} 0 0Z`
}

/** Genus from the author, species from the note's most particular word.
 *  "Grandma June" + "…Thanksgiving…" → "Junia thanksgivingensis".
 *  @param {{author_name: string, message: string}} e */
export function binomial(e) {
  const s = seeded(entryKey(e, "binomial"))
  const name = foldLetters(keyName(e.author_name)) || "hospes"
  const gsuf = s.pick(["ia", "anthus", "ella", "opsis", "aria", "ina"])
  const genus = joinLatin(name, gsuf)
  let salient = salientWords(e.message).filter((w) => w !== name)
  if (salient.length === 0) {
    const all = words(e.message).map(foldLetters).filter((w) => w.length >= 3)
    salient = all.filter((w) => !STOPWORDS.has(w))
    if (salient.length === 0) salient = all
  }
  let species
  if (salient.length === 0) {
    const m = e.message
    species = m.includes("🎉") ? "pyrotechnica" : m.includes("🥂") ? "spumans" : m.includes("❤") || m.includes("💛") ? "cordata" : "taciturna"
  } else {
    let best = salient[0]
    for (const w of salient) if (w.length > best.length) best = w
    species = joinLatin(stem(best), s.pick(["ensis", "ii", "ifolia", "iflora", "oides", "ata", "icola"]))
  }
  return genus.charAt(0).toUpperCase() + genus.slice(1) + " " + species
}

/** @param {string} root @param {string} suf */
function joinLatin(root, suf) {
  const vowels = "aeiou"
  let r = root
  while (r.length > 2 && vowels.includes(r.charAt(r.length - 1)) && vowels.includes(suf.charAt(0))) r = r.slice(0, -1)
  if (r.endsWith(suf)) return r
  return r + suf
}

/** Delay bucket class: CSS owns the timing, markup only names a bucket (no style=). @param {number} t 0..1 */
const dl = (t) => "d" + Math.max(0, Math.min(15, Math.round(t * 15)))

/** @param {Entry} e @param {GrowOpts} [opts] @returns {Plant} */
export function growPlant(e, opts = {}) {
  const s = seeded(entryKey(e, "plant"))
  const who = seeded("who" + foldLetters(e.author_name))
  const leafFam = who.pick(LEAF_FAMILIES)
  const petalFam = who.pick(PETAL_FAMILIES)
  const petals = who.int(5, 9)
  const modestFam = who.pick(["star", "umbel", "bell", "cup"])
  const bloomTint = "b" + who.int(0, 3)
  const leafTint = "l" + who.int(0, 2)
  const hour = hourOf(e.created_at)
  const night = hour >= 21 || hour < 5
  const leafScale = opts.leafScale ?? 1
  const bloomScale = opts.bloomScale ?? 1

  const sents = sentences(e.message)
  if (sents.length === 0) sents.push({ words: ["…"], end: "", marks: 0, commas: [], emoji: [] })
  const totalWords = Math.max(1, words(e.message).length)
  const H = Math.min(230, 46 + 17 * Math.sqrt(totalWords) + (e.fav ? 14 : 0))
  const lean = (opts.lean ?? 1) * s.range(-11, 11) * DEG
  const tip = [Math.sin(lean) * H, -Math.cos(lean) * H]
  const ctrl = [tip[0] * 0.1 + s.range(-0.16, 0.16) * H, -H * 0.55]
  const root = [0, 0]

  /** @type {string[]} */ const stems = []
  /** @type {string[]} */ const leaves = []
  /** @type {string[]} */ const tips = []
  let x0 = -10
  let x1 = 10
  let y0 = -H
  const grow = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ r = 0) => {
    x0 = Math.min(x0, x - r)
    x1 = Math.max(x1, x + r)
    y0 = Math.min(y0, y - r)
  }
  grow(tip[0], tip[1])

  stems.push(`<path class="hb-stem hb-main" pathLength="1" d="M0 0Q${f(ctrl[0])} ${f(ctrl[1])} ${f(tip[0])} ${f(tip[1])}"/>`)

  // Basal rosette: one small leaf per word of the author's name, plus two.
  const nameWords = Math.min(6, words(e.author_name).length + 2)
  for (let i = 0; i < nameWords; i++) {
    const a = (-90 + (i - (nameWords - 1) / 2) * (150 / Math.max(1, nameWords - 1)) + s.range(-6, 6)) * DEG
    const L = (14 + s.range(0, 8)) * leafScale
    leaves.push(leafAt(0, -1, a, L, leafFam, leafTint, 0.02 + i * 0.01))
    grow(Math.cos(a) * L, Math.sin(a) * L, 4)
  }

  const S = sents.length
  const branches = sents.slice(0, -1)
  const leader = sents[S - 1]
  let side = s.chance(0.5) ? 1 : -1
  branches.forEach((sen, k) => {
    const t = S === 2 ? 0.5 : 0.22 + (0.62 * k) / Math.max(1, S - 2)
    const at = qAt(root, ctrl, tip, t)
    const out = at.a + side * s.range(34, 58) * DEG
    const Lb = Math.min(105, 16 + 12 * Math.sqrt(sen.words.length + sen.emoji.length)) * (1 - 0.3 * t)
    const end = [at.x + Math.cos(out) * Lb, at.y + Math.sin(out) * Lb * 0.92 - Lb * 0.12]
    const bc = [at.x + Math.cos(out) * Lb * 0.55, at.y + Math.sin(out) * Lb * 0.55 + Lb * 0.12]
    stems.push(`<path class="hb-stem ${dl(t * 0.55)}" pathLength="1" d="M${f(at.x)} ${f(at.y)}Q${f(bc[0])} ${f(bc[1])} ${f(end[0])} ${f(end[1])}"/>`)
    grow(end[0], end[1], 6)
    leafRun(sen, [at.x, at.y], bc, end, t * 0.55)
    tipFor(sen, end, qAt([at.x, at.y], bc, end, 1).a, t * 0.55 + 0.35)
    side = -side
  })

  // The leading shoot carries the last sentence.
  const lt0 = S > 1 ? 0.3 + 0.5 * ((S - 2) / Math.max(1, S - 1)) : 0.15
  const sub = (/** @type {number} */ t) => qAt(root, ctrl, tip, lt0 + (1 - lt0) * t)
  const n = Math.min(leader.words.length, 12)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.6) / (n + 0.4)
    const p = sub(t)
    const wl = leader.words[Math.floor((i * leader.words.length) / n)] || "x"
    const L = (7 + 1.5 * Math.min(12, wl.length)) * leafScale * (1 - 0.35 * t)
    const pair = leader.commas.includes(i)
    const sgn = i % 2 === 0 ? side : -side
    leaves.push(leafAt(p.x, p.y, p.a + sgn * s.range(42, 62) * DEG, L, leafFam, leafTint, 0.1 + t * 0.6))
    if (pair) leaves.push(leafAt(p.x, p.y, p.a - sgn * s.range(42, 62) * DEG, L, leafFam, leafTint, 0.1 + t * 0.6))
    grow(p.x, p.y, L)
  }
  emojiRun(leader, sub, 0.6)
  tipFor(leader, tip, qAt(root, ctrl, tip, 1).a, 0.85)

  // A note with a heart reaction or two gets a visitor.
  const hearts = e.reactions && e.reactions.heart ? e.reactions.heart.count : 0
  if (hearts >= 3) {
    const p = qAt(root, ctrl, tip, s.range(0.45, 0.75))
    const bx = p.x + (s.chance(0.5) ? 1 : -1) * s.range(16, 26)
    tips.push(butterfly(bx, p.y - 8, s.range(-20, 20), dl(1)))
    grow(bx, p.y - 8, 10)
  }

  /** @param {Sentence} sen @param {number[]} a @param {number[]} c @param {number[]} b @param {number} t0 */
  function leafRun(sen, a, c, b, t0) {
    const m = Math.min(sen.words.length, 9)
    for (let i = 0; i < m; i++) {
      const t = (i + 0.7) / (m + 0.6)
      const p = qAt(a, c, b, t)
      const wl = sen.words[Math.floor((i * sen.words.length) / m)] || "x"
      const L = (6 + 1.35 * Math.min(12, wl.length)) * leafScale * (1 - 0.3 * t)
      const sgn = i % 2 === 0 ? 1 : -1
      const pair = sen.commas.includes(i)
      leaves.push(leafAt(p.x, p.y, p.a + sgn * s.range(40, 65) * DEG, L, leafFam, leafTint, t0 + t * 0.3))
      if (pair) leaves.push(leafAt(p.x, p.y, p.a - sgn * s.range(40, 65) * DEG, L, leafFam, leafTint, t0 + t * 0.3))
      grow(p.x, p.y, L)
    }
    emojiRun(sen, (t) => qAt(a, c, b, t), t0)
  }

  /** Emoji grow on their own short pedicel mid-branch, or crown a wordless shoot.
   *  @param {Sentence} sen @param {(t: number) => {x: number, y: number, a: number}} at @param {number} t0 */
  function emojiRun(sen, at, t0) {
    const n = Math.min(3, sen.emoji.length)
    sen.emoji.slice(0, 3).forEach((em, i) => {
      const p = at(sen.words.length ? 0.45 + i * 0.15 : 1)
      const fan = sen.words.length ? (i % 2 === 0 ? -1 : 1) * 50 : (i - (n - 1) / 2) * 40
      const dir = p.a + fan * DEG
      const pl = sen.words.length ? 14 : n > 1 ? 16 : 4
      const q = [p.x + Math.cos(dir) * pl, p.y + Math.sin(dir) * pl]
      if (pl > 5) stems.push(`<path class="hb-stem hb-fine ${dl(t0 + 0.3)}" pathLength="1" d="M${f(p.x)} ${f(p.y)}L${f(q[0])} ${f(q[1])}"/>`)
      tips.push(emojiFlower(em, q[0], q[1], i, t0 + 0.4))
      grow(q[0], q[1], 16)
    })
  }

  /** @param {Sentence} sen @param {number[]} at @param {number} a @param {number} t */
  function tipFor(sen, at, a, t) {
    const chars = sen.words.join(" ").length
    if (sen.words.length === 0 && sen.emoji.length) return // emoji already drawn
    const k = Math.min(3, Math.max(1, sen.marks))
    if (sen.end === "!") {
      const R = Math.min(21, 10 + 1.1 * Math.sqrt(chars)) * bloomScale
      for (let i = 0; i < k; i++) {
        const off = i === 0 ? 0 : (i % 2 ? -1 : 1) * 34 * DEG
        const pl = i === 0 ? 0 : R * 1.5
        const bx = at[0] + Math.cos(a + off) * pl
        const by = at[1] + Math.sin(a + off) * pl
        if (pl) stems.push(`<path class="hb-stem hb-fine ${dl(t)}" pathLength="1" d="M${f(at[0])} ${f(at[1])}L${f(bx)} ${f(by)}"/>`)
        tips.push(bloom(bx, by, i === 0 ? R : R * 0.72, s.range(0, 360), t + i * 0.05))
        grow(bx, by, R)
      }
    } else if (sen.end === "?") {
      for (let i = 0; i < k; i++) {
        const off = (i - (k - 1) / 2) * 30 * DEG
        tips.push(bud(at[0], at[1], a + off, 8 + Math.min(8, chars / 10), t))
        grow(at[0] + Math.cos(a + off) * 16, at[1] + Math.sin(a + off) * 16, 6)
      }
    } else if (sen.end === "." && sen.marks > 1) {
      tips.push(berries(at[0], at[1], a, 3 + Math.min(4, sen.marks), t))
      grow(at[0], at[1], 12)
    } else if (sen.end === ".") {
      const R = Math.min(13, 6 + 0.8 * Math.sqrt(chars)) * bloomScale
      tips.push(modest(at[0], at[1], a, R, t))
      grow(at[0], at[1], R * 1.6)
    } else {
      tips.push(tendril(at[0], at[1], a, 7 + Math.min(6, chars / 12), t))
      grow(at[0], at[1], 14)
    }
  }

  /** @param {number} x @param {number} y @param {number} a @param {number} L @param {string} fam @param {string} tint @param {number} t */
  function leafAt(x, y, a, L, fam, tint, t) {
    const open = fam === "frond" || fam === "blade"
    return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a / DEG)})"><path class="hb-leaf ${open ? "hb-open" : tint} ${dl(t)}" d="${leafPath(fam, L)}"/>${
      open || fam === "coin" ? "" : `<path class="hb-vein ${dl(t)}" d="M${f(L * 0.08)} 0L${f(L * 0.8)} 0"/>`
    }</g>`
  }

  /** @param {number} x @param {number} y @param {number} R @param {number} rot @param {number} t */
  function bloom(x, y, R, rot, t) {
    let p = ""
    const w = (Math.PI * R) / petals * (petalFam === "strap" ? 0.75 : 0.95)
    const pd = petalPath(petalFam, R, w)
    for (let i = 0; i < petals; i++) p += `<path transform="rotate(${f(rot + (360 * i) / petals)})" d="${pd}"/>`
    // A second, smaller whorl for richness on big blooms.
    let inner = ""
    if (R > 11) {
      const pd2 = petalPath(petalFam, R * 0.55, w * 0.6)
      for (let i = 0; i < petals; i++) inner += `<path transform="rotate(${f(rot + (360 * (i + 0.5)) / petals)})" d="${pd2}"/>`
    }
    let dots = ""
    const nd = Math.min(9, Math.round(R / 2))
    for (let i = 0; i < nd; i++) {
      const aa = (i / nd) * Math.PI * 2 + rot * DEG
      dots += `<circle cx="${f(Math.cos(aa) * R * 0.32)}" cy="${f(Math.sin(aa) * R * 0.32)}" r="${f(R * 0.06)}"/>`
    }
    return `<g transform="translate(${f(x)} ${f(y)})"><g class="hb-tip ${dl(t)}"><g class="hb-petals ${night ? "hb-night" : bloomTint}">${p}</g>${
      inner ? `<g class="hb-petals hb-inner ${night ? "hb-night" : bloomTint}">${inner}</g>` : ""
    }<circle class="hb-eye${e.fav ? " hb-gold" : ""}" r="${f(R * 0.24)}"/><g class="hb-dots">${dots}</g></g></g>`
  }

  /** The everyday flower a full stop sets. Kind is per author, so one guest's
   *  sentences all flower alike.
   *  @param {number} x @param {number} y @param {number} a @param {number} R @param {number} t */
  function modest(x, y, a, R, t) {
    const tint = night ? "hb-night" : bloomTint
    const wrap = (/** @type {string} */ inner, /** @type {number} */ rot, sx = 1) =>
      `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${sx} 1)"><g class="hb-tip ${dl(t)}">${inner}</g></g>`
    if (modestFam === "star") {
      let p = ""
      const pd = petalPath("point", R, R * 0.42)
      for (let i = 0; i < 5; i++) p += `<path transform="rotate(${f(i * 72)})" d="${pd}"/>`
      return wrap(`<g class="hb-petals ${tint}">${p}</g><circle class="hb-eye${e.fav ? " hb-gold" : ""}" r="${f(R * 0.2)}"/>`, s.range(0, 72))
    }
    if (modestFam === "umbel") {
      let rays = ""
      const n = 7
      for (let i = 0; i < n; i++) {
        const aa = (-0.5 + i / (n - 1)) * 1.9
        const ex = Math.cos(aa) * R * 1.3
        const ey = Math.sin(aa) * R * 1.3
        let fl = ""
        for (let k = 0; k < 5; k++) {
          const b = (k / 5) * Math.PI * 2
          fl += `<circle cx="${f(ex + Math.cos(b) * R * 0.2)}" cy="${f(ey + Math.sin(b) * R * 0.2)}" r="${f(R * 0.16)}"/>`
        }
        rays += `<path class="hb-stem-static" d="M0 0L${f(ex)} ${f(ey)}"/><g class="hb-floret ${tint}">${fl}</g>`
      }
      return wrap(rays, a / DEG)
    }
    if (modestFam === "bell") {
      // Nodding bells along an arching tip, mouths down.
      let out = ""
      for (let i = 0; i < 3; i++) {
        const bx = (i + 1) * R * 0.72
        const by = -R * 0.3 + i * i * R * 0.22
        const r = R * (0.62 - i * 0.1)
        out += `<path class="hb-stem-static" d="M${f(bx)} ${f(by)}l0 ${f(r * 0.6)}"/><path class="hb-bud ${tint}" d="M${f(bx - r * 0.55)} ${f(by + r * 0.6)}Q${f(bx)} ${f(by - r * 0.2)} ${f(bx + r * 0.55)} ${f(by + r * 0.6)}Q${f(bx + r * 0.7)} ${f(by + r * 1.4)} ${f(bx + r * 0.9)} ${f(by + r * 1.6)}L${f(bx - r * 0.9)} ${f(by + r * 1.6)}Q${f(bx - r * 0.7)} ${f(by + r * 1.4)} ${f(bx - r * 0.55)} ${f(by + r * 0.6)}Z"/>`
      }
      const arch = `<path class="hb-stem-static" d="M0 0Q${f(R * 1.2)} ${f(-R * 0.9)} ${f(R * 2.5)} ${f(R * 0.3)}"/>`
      return wrap(arch + out, 0, Math.cos(a) < -0.2 ? -1 : 1)
    }
    // cup: a tulip in profile, petals overlapping.
    const w = R * 0.62
    const cup = `<path class="hb-bud ${tint}" d="M0 ${f(-w * 0.2)}C${f(R * 0.2)} ${f(-w * 1.5)} ${f(R * 1.1)} ${f(-w * 1.3)} ${f(R * 1.25)} ${f(-w * 0.75)}L${f(R * 0.95)} 0L${f(R * 1.25)} ${f(w * 0.75)}C${f(R * 1.1)} ${f(w * 1.3)} ${f(R * 0.2)} ${f(w * 1.5)} 0 ${f(w * 0.2)}Z"/><path class="hb-vein" d="M${f(R * 0.1)} 0Q${f(R * 0.7)} ${f(-w * 0.3)} ${f(R * 1.15)} ${f(-w * 0.7)}M${f(R * 0.1)} 0Q${f(R * 0.7)} ${f(w * 0.3)} ${f(R * 1.15)} ${f(w * 0.7)}"/>`
    return wrap(cup, a / DEG)
  }

  /** @param {number} x @param {number} y @param {number} a @param {number} L @param {number} t */
  function bud(x, y, a, L, t) {
    const w = L * 0.36
    return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a / DEG)})"><g class="hb-tip ${dl(t)}"><path class="hb-bud ${night ? "hb-night" : bloomTint}" d="M0 0C${f(L * 0.3)} ${f(-w * 1.6)} ${f(L * 0.95)} ${f(-w * 0.5)} ${f(L)} 0C${f(L * 0.95)} ${f(w * 0.5)} ${f(L * 0.3)} ${f(w * 1.6)} 0 0Z"/><path class="hb-sepal ${leafTint}" d="M0 0Q${f(L * 0.35)} ${f(-w * 1.5)} ${f(L * 0.55)} ${f(-w * 0.6)}Q${f(L * 0.3)} ${f(-w * 0.3)} 0 0ZM0 0Q${f(L * 0.35)} ${f(w * 1.5)} ${f(L * 0.55)} ${f(w * 0.6)}Q${f(L * 0.3)} ${f(w * 0.3)} 0 0Z"/></g></g>`
  }

  /** @param {number} x @param {number} y @param {number} a @param {number} count @param {number} t */
  function berries(x, y, a, count, t) {
    let out = ""
    for (let i = 0; i < count; i++) {
      const aa = a + (i - (count - 1) / 2) * 0.55
      const r = 3.2 + s.range(0, 1.6)
      const d = i === 0 && count === 1 ? 3 : 7 + s.range(0, 4)
      const bx = Math.cos(aa) * d
      const by = Math.sin(aa) * d
      out += `<path class="hb-stem-static" d="M0 0L${f(bx)} ${f(by)}"/><circle class="hb-berry" cx="${f(bx)}" cy="${f(by)}" r="${f(r)}"/><circle class="hb-shine" cx="${f(bx - r * 0.35)}" cy="${f(by - r * 0.35)}" r="${f(r * 0.28)}"/>`
    }
    return `<g transform="translate(${f(x)} ${f(y)})"><g class="hb-tip ${dl(t)}">${out}</g></g>`
  }

  /** A fiddlehead: an Archimedean spiral curling back on itself.
   *  @param {number} x @param {number} y @param {number} a @param {number} R @param {number} t */
  function tendril(x, y, a, R, t) {
    let d = "M0 0"
    const turns = 1.6
    const steps = 28
    const dirSign = s.chance(0.5) ? 1 : -1
    for (let i = 1; i <= steps; i++) {
      const u = i / steps
      const th = u * turns * Math.PI * 2
      const r = R * (1 - u * 0.85)
      const px = u * R * 0.9 + Math.sin(th) * r * 0.6
      const py = dirSign * (1 - Math.cos(th)) * r * 0.6
      d += `L${f(px)} ${f(py)}`
    }
    return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a / DEG)})"><g class="hb-tip ${dl(t)}"><path class="hb-stem-static" d="${d}"/></g></g>`
  }

  /** @param {string} em @param {number} x @param {number} y @param {number} i @param {number} t */
  function emojiFlower(em, x, y, i, t) {
    const rot = s.range(0, 360)
    if (em.includes("❤") || em.includes("💛") || em.includes("💗") || em.includes("💕")) {
      let p = ""
      const R = 11 * bloomScale
      for (let k = 0; k < 5; k++) {
        p += `<path transform="rotate(${f(rot + k * 72)}) translate(${f(R * 0.18)} 0) rotate(90)" d="M0 0C${f(-R * 0.55)} ${f(-R * 0.35)} ${f(-R * 0.45)} ${f(-R * 0.95)} 0 ${f(-R * 0.68)}C${f(R * 0.45)} ${f(-R * 0.95)} ${f(R * 0.55)} ${f(-R * 0.35)} 0 0Z"/>`
      }
      return `<g transform="translate(${f(x)} ${f(y)})"><g class="hb-tip ${dl(t)}"><g class="hb-petals ${em.includes("💛") ? "b3" : "b0"}">${p}</g><circle class="hb-eye hb-gold" r="2.6"/></g></g>`
    }
    if (em.includes("🥂")) {
      const bell = (/** @type {number} */ dx, /** @type {number} */ rr) =>
        `<g transform="translate(${dx} 0) rotate(${rr})"><path class="hb-stem-static" d="M0 -10L0 0"/><path class="hb-petals b1" d="M-5 0Q-5 9 -7 11L7 11Q5 9 5 0Q0 -3 -5 0Z"/></g>`
      return `<g transform="translate(${f(x)} ${f(y)})"><g class="hb-tip ${dl(t)}">${bell(-5, 18)}${bell(5, -18)}</g></g>`
    }
    // 🎉 and any other emoji: an allium — a sphere of radiating florets.
    let rays = ""
    const R = (10 + i * 2) * bloomScale
    for (let k = 0; k < 18; k++) {
      const aa = (k / 18) * Math.PI * 2 + rot * DEG
      const ex = Math.cos(aa) * R
      const ey = Math.sin(aa) * R
      rays += `<path d="M0 0L${f(ex)} ${f(ey)}"/><circle cx="${f(ex)}" cy="${f(ey)}" r="1.7"/>`
    }
    return `<g transform="translate(${f(x)} ${f(y)})"><g class="hb-tip ${dl(t)}"><g class="hb-allium b${(i + 2) % 4}">${rays}</g></g></g>`
  }

  /** A small visitor for a well-loved note. @param {number} x @param {number} y @param {number} rot @param {string} d */
  function butterfly(x, y, rot, d) {
    const wing = "M0 0C-3 -7 -10 -8 -9 -2C-8 2 -3 2 0 0ZM0 0C-2 4 -7 7 -6 3C-5 1 -2 0 0 0Z"
    return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})"><g class="hb-tip ${d}"><path class="hb-wing" d="${wing}"/><path class="hb-wing" transform="scale(-1 1)" d="${wing}"/><path class="hb-stem-static" d="M0 -3L0 3M0 -3L-2 -6M0 -3L2 -6"/></g></g>`
  }

  const pad = 6
  const box = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: 6 }
  const sway = "s" + s.int(0, 4)
  // Mounting straps, as a real herbarium sheet stitches its specimen down.
  let straps = ""
  if (opts.straps) {
    for (const t of [0.12, 0.5]) {
      const p = qAt(root, ctrl, tip, t)
      straps += `<rect class="hb-strap" x="-2.2" y="-7" width="4.4" height="14" rx="0.6" transform="translate(${f(p.x)} ${f(p.y)}) rotate(${f(p.a / DEG + s.range(-8, 8))})"/>`
    }
  }
  const markup = `<g class="hb-plant ${sway}">${stems.join("")}${leaves.join("")}${tips.join("")}${straps}</g>`
  return { markup, box, binomial: binomial(e), key: [leafFam, petalFam, String(petals)] }
}

/** Wrap a plant in its own fitted <svg>. @param {Entry} e @param {GrowOpts & {cls?: string, minW?: number}} [opts] */
export function plantSVG(e, opts = {}) {
  const p = growPlant(e, opts)
  let { x0, y0, x1, y1 } = p.box
  const minW = opts.minW ?? 0
  const w = x1 - x0
  if (w < minW) {
    x0 -= (minW - w) / 2
    x1 += (minW - w) / 2
  }
  return `<svg class="hb-svg ${opts.cls || ""}" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}" preserveAspectRatio="xMidYMax meet" focusable="false">${p.markup}</svg>`
}
