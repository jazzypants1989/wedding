/** @file Note flowers: every guestbook note grows a small plant from how it is written.
 *
 *    each sentence      a branch; the last sentence is the leading shoot
 *    each word          a leaf; longer words, longer leaves; a comma, a pair
 *    ends in  .         a tulip, cupped and upright
 *    ends in  !         a bloom, open to the sky (!!! → three)
 *    ends in  ?         a bud nodding on a crook, like the mark
 *    ends in  …         berries
 *    no full stop       a curled tendril
 *    an emoji           ❤️ heart petals, 🥂 bells, anything else an allium
 *    the author's name  leaf shape, petal shape and count, cup, colours
 *
 *  Pure: note in, SVG string out, no DOM. Seeded from author + message (never the
 *  row id), so the composer's preview is exactly the flower the guest gets, and the
 *  same note draws the same flower on every visit and in print. No Math.random.
 *
 *  Cheap by construction: every part is transformed into world coordinates here
 *  and merged into one <path> per style, so a plant is a handful of elements
 *  however long the note is. Root at (0,0), growing toward −y. */
/** @import * as Types from "./types.js" */

const DEG = Math.PI / 180
const LEAF_SHAPES = /** @type {const} */ (["lance", "ovate", "coin", "blade"])
const PETAL_SHAPES = /** @type {const} */ (["round", "point", "notch", "strap"])
const MAX_BRANCHES = 5
const MAX_BRANCH_LEAVES = 8
const MAX_LEADER_LEAVES = 10
const MAX_EMOJI = 3

/** How many petal hues there are (`.nf-b0`…, in note-flower.css). An author
 *  keeps theirs; a meadow of eight hues no longer reads as one colour. */
const TINTS = 8

/** @param {string} layer */
const tinted = (layer) => Array.from({ length: TINTS }, (_, i) => `${layer} nf-b${i}`)

/** Paint order: the merged paths are emitted in this order, back to front. */
const LAYERS = [
  "nf-stem nf-main",
  "nf-stem",
  "nf-fine",
  "nf-leaf",
  "nf-vein",
  ...tinted("nf-cup"),
  ...tinted("nf-petals"),
  ...tinted("nf-bud"),
  "nf-crease",
  "nf-sepal",
  ...tinted("nf-dot"),
  "nf-berry",
  "nf-shine",
  "nf-eye",
  "nf-eye nf-gold",
]

// ---- Seeded randomness -------------------------------------------------------

/** FNV-1a over UTF-16 code units, then a murmur-style avalanche.
 *  @param {string} str @returns {number} */
function hash32(str) {
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

/** mulberry32 behind a small helper bag. @param {string} key */
function seeded(key) {
  let a = hash32(key)
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    /** @param {number} lo @param {number} hi */
    range: (lo, hi) => lo + (hi - lo) * r(),
    /** @param {number} lo @param {number} hi */
    int: (lo, hi) => lo + Math.floor(r() * (hi - lo + 1)),
    /** @template T @param {readonly T[]} arr @returns {T} */
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    /** @param {number} p */
    chance: (p) => r() < p,
  }
}

/** Round to 2 decimals for compact SVG. @param {number} n */
function f(n) {
  return String(Math.round(n * 100) / 100)
}

// ---- Reading the note (string methods only, no regex) -----------------------

/** A cased letter in any script that has case. @param {string} ch */
function isLetter(ch) {
  return ch.toLowerCase() !== ch.toUpperCase()
}

/** @param {string} ch */
function isDigit(ch) {
  const c = ch.charCodeAt(0)
  return c >= 48 && c <= 57
}

/** @param {string} ch */
function isSpace(ch) {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r"
}

/** @param {number} cp */
function isEmojiCode(cp) {
  return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)
}

/** Joiners, variation selectors and skin tones that ride along with an emoji.
 *  @param {number} cp */
function isEmojiGlue(cp) {
  return cp === 0xfe0f || cp === 0x200d || (cp >= 0x1f3fb && cp <= 0x1f3ff)
}

/** Lowercase a–z only, accents folded ("Sørensen" → "srensen"). @param {string} str */
function foldLetters(str) {
  let out = ""
  for (const ch of str.normalize("NFD").toLowerCase()) {
    const c = ch.charCodeAt(0)
    if (c >= 97 && c <= 122) out += ch
  }
  return out
}

/** @param {string} message */
function countWords(message) {
  let n = 0
  let inWord = false
  for (const ch of message) {
    const wordy = isLetter(ch) || isDigit(ch)
    if (wordy && !inWord) n++
    if (wordy) inWord = true
    else if (isSpace(ch)) inWord = false
  }
  return n
}

/** @type {Types.noteSentences} */
export function noteSentences(message) {
  /** @type {Types.NoteSentence[]} */
  const out = []
  /** @returns {Types.NoteSentence} */
  const blank = () => ({ words: [], end: "", marks: 0, commas: [], emoji: [] })
  let cur = blank()
  let word = ""
  const chars = Array.from(message)
  const flushWord = () => {
    if (word) cur.words.push(word)
    word = ""
  }
  const flushSentence = () => {
    flushWord()
    if (cur.words.length || cur.emoji.length) out.push(cur)
    cur = blank()
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const cp = ch.codePointAt(0) || 0
    if (isEmojiCode(cp)) {
      flushWord()
      let glyph = ch
      while (i + 1 < chars.length && isEmojiGlue(chars[i + 1].codePointAt(0) || 0)) {
        glyph += chars[++i]
      }
      cur.emoji.push(glyph)
      continue
    }
    if (isEmojiGlue(cp)) continue
    if (ch === "!" || ch === "?" || ch === "." || ch === "…") {
      // A dot inside a token ("10.5", "a.m.") is not a sentence end.
      const next = chars[i + 1]
      if (ch === "." && next && !isSpace(next) && next !== "." && next !== "!" && next !== "?") {
        word += ch
        continue
      }
      flushWord()
      let n = ch === "…" ? 3 : 1
      while (i + 1 < chars.length && (chars[i + 1] === ch || chars[i + 1] === "!" || chars[i + 1] === "?")) {
        i++
        n++
      }
      if (cur.words.length === 0 && cur.emoji.length === 0 && out.length) {
        // Stray marks after an emoji-only run attach to the previous sentence.
        out[out.length - 1].marks += n
        continue
      }
      cur.end = ch === "…" ? "." : ch
      cur.marks = n
      flushSentence()
      continue
    }
    if (ch === "," || ch === ";" || ch === ":") {
      flushWord()
      cur.commas.push(cur.words.length)
      continue
    }
    if (isSpace(ch)) {
      flushWord()
      continue
    }
    if (isLetter(ch) || isDigit(ch) || ch === "'" || ch === "’" || ch === "-") word += ch
  }
  flushSentence()
  return out
}

// ---- Geometry ---------------------------------------------------------------

/** Quadratic Bézier point + tangent angle.
 *  @param {number[]} p0 @param {number[]} c @param {number[]} p1 @param {number} t */
function qAt(p0, c, p1, t) {
  const u = 1 - t
  const x = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0]
  const y = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]
  const dx = 2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0])
  const dy = 2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1])
  return { x, y, a: Math.atan2(dy, dx) }
}

/**
 * Path commands in a local frame, written out in world coordinates: rotate by
 * `a` (radians), mirror x when `flip` is -1, then translate to (x, y). Only
 * absolute M/L/Q/C/Z — numbers are consumed as (x, y) pairs.
 * @param {number} x @param {number} y @param {number} a @param {(string | number)[]} cmds
 * @param {number} [flip]
 */
function place(x, y, a, cmds, flip = 1) {
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  let d = ""
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i]
    if (typeof c === "string") {
      d += c
      continue
    }
    const px = c * flip
    const py = /** @type {number} */ (cmds[++i])
    d += `${f(x + px * cos - py * sin)} ${f(y + px * sin + py * cos)} `
  }
  return d
}

/** A circle as a path (rotation-invariant, so it merges with anything).
 *  @param {number} cx @param {number} cy @param {number} r */
function circle(cx, cy, r) {
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`
}

/** An ellipse as a path, its rx axis turned to `rot` (radians).
 *  @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} rot */
function ellipse(cx, cy, rx, ry, rot) {
  const dx = Math.cos(rot) * rx
  const dy = Math.sin(rot) * rx
  const deg = f(rot / DEG)
  const arc = `a${f(rx)} ${f(ry)} ${deg} 1 0 `
  return `M${f(cx - dx)} ${f(cy - dy)}${arc}${f(2 * dx)} ${f(2 * dy)}${arc}${f(-2 * dx)} ${f(-2 * dy)}`
}

/** Leaf outline along +x, length L. @param {Types.FlowerLeafShape} shape @param {number} L */
function leafCmds(shape, L) {
  if (shape === "ovate") {
    const w = L * 0.32
    return ["M", 0, 0, "C", L * 0.15, -w * 1.5, L * 0.8, -w * 1.1, L, 0,
      "C", L * 0.8, w * 1.1, L * 0.15, w * 1.5, 0, 0, "Z"]
  }
  if (shape === "coin") {
    const w = L * 0.4
    return ["M", 0, 0, "C", L * 0.3, -w * 1.8, L * 1.1, -w * 1.4, L, 0,
      "C", L * 1.1, w * 1.4, L * 0.3, w * 1.8, 0, 0, "Z"]
  }
  const w = L * (shape === "blade" ? 0.09 : 0.2)
  return ["M", 0, 0, "Q", L * 0.45, -w * 1.6, L, 0, "Q", L * 0.45, w * 1.6, 0, 0, "Z"]
}

/** One petal along +x from the centre, length R, half-width w.
 *  @param {Types.FlowerPetalShape} shape @param {number} R @param {number} w */
function petalCmds(shape, R, w) {
  if (shape === "point") return ["M", 0, 0, "Q", R * 0.4, -w, R, 0, "Q", R * 0.4, w, 0, 0, "Z"]
  if (shape === "notch") {
    return ["M", 0, 0, "C", R * 0.3, -w * 1.3, R * 1.05, -w * 1.2, R, -w * 0.25,
      "L", R * 0.82, 0, "L", R, w * 0.25, "C", R * 1.05, w * 1.2, R * 0.3, w * 1.3, 0, 0, "Z"]
  }
  if (shape === "strap") {
    // A daisy's ray: long, slim, rounded at the tip.
    return ["M", R * 0.2, 0, "C", R * 0.35, -w * 0.9, R * 0.9, -w * 0.9, R, 0,
      "C", R * 0.9, w * 0.9, R * 0.35, w * 0.9, R * 0.2, 0, "Z"]
  }
  return ["M", 0, 0, "C", R * 0.2, -w * 1.4, R * 1.1, -w * 1.2, R, 0,
    "C", R * 1.1, w * 1.2, R * 0.2, w * 1.4, 0, 0, "Z"]
}

/** A closed bud along +x, length L. @param {number} L */
function budCmds(L) {
  const w = L * 0.36
  return ["M", 0, 0, "C", L * 0.3, -w * 1.6, L * 0.95, -w * 0.5, L, 0,
    "C", L * 0.95, w * 0.5, L * 0.3, w * 1.6, 0, 0, "Z"]
}

/** The two sepals hugging a bud. @param {number} L */
function sepalCmds(L) {
  const w = L * 0.36
  return ["M", 0, 0, "Q", L * 0.35, -w * 1.5, L * 0.55, -w * 0.6, "Q", L * 0.3, -w * 0.3, 0, 0, "Z",
    "M", 0, 0, "Q", L * 0.35, w * 1.5, L * 0.55, w * 0.6, "Q", L * 0.3, w * 0.3, 0, 0, "Z"]
}

// ---- The plant --------------------------------------------------------------

/** @type {Types.growFlower} */
export function growFlower(note, opts = {}) {
  const message = note.message || ""
  const author = note.author_name || ""
  const s = seeded("plant␟" + author + "␟" + message)
  const who = seeded("who" + foldLetters(author))
  const leafShape = who.pick(LEAF_SHAPES)
  const petalShape = who.pick(PETAL_SHAPES)
  const petals = who.int(5, 9)
  // The author's tulip: how wide the cup opens. (One draw, where an older
  // version picked a flower kind, so every other trait keeps its value.)
  const cup = 0.56 + 0.04 * who.int(0, 3)
  const tint = "nf-b" + who.int(0, TINTS - 1)
  const leafTint = who.int(0, 2)
  const gold = Boolean(opts.gold)
  /** @type {Types.FlowerParts} */
  const parts = { branches: 0, leaves: 0, blooms: 0, tulips: 0, buds: 0, berries: 0, tendrils: 0, emoji: 0 }

  /** @type {Map<string, string>} */
  const ink = new Map()
  /** @param {string} layer @param {string} d */
  const add = (layer, d) => ink.set(layer, (ink.get(layer) || "") + d)

  let x0 = -10
  let x1 = 10
  let y0 = -10
  /** @param {number} x @param {number} y @param {number} [r] */
  const grow = (x, y, r = 0) => {
    x0 = Math.min(x0, x - r)
    x1 = Math.max(x1, x + r)
    y0 = Math.min(y0, y - r)
  }

  const sents = noteSentences(message)
  if (sents.length === 0) sents.push({ words: [], end: "", marks: 0, commas: [], emoji: [] })
  // Keep the first few sentences as branches and the last as the leader.
  const capped = sents.length > MAX_BRANCHES + 1 ? [...sents.slice(0, MAX_BRANCHES), sents[sents.length - 1]] : sents
  const H = Math.min(230, 46 + 17 * Math.sqrt(Math.max(1, countWords(message))) + (gold ? 14 : 0))
  const lean = s.range(-11, 11) * DEG
  const root = [0, 0]
  const tip = [Math.sin(lean) * H, -Math.cos(lean) * H]
  const ctrl = [tip[0] * 0.1 + s.range(-0.16, 0.16) * H, -H * 0.55]
  add("nf-stem nf-main", `M0 0Q${f(ctrl[0])} ${f(ctrl[1])} ${f(tip[0])} ${f(tip[1])}`)
  grow(tip[0], tip[1])

  /** @param {number} x @param {number} y @param {number} a @param {number} L */
  const leaf = (x, y, a, L) => {
    add("nf-leaf", place(x, y, a, leafCmds(leafShape, L)))
    // A pale midrib, bowed a little; the open blade is drawn by its edges alone.
    if (leafShape !== "blade") {
      add("nf-vein", place(x, y, a, ["M", L * 0.08, 0, "Q", L * 0.45, L * 0.05, L * 0.8, 0]))
    }
    parts.leaves++
    grow(x + Math.cos(a) * L, y + Math.sin(a) * L, 4)
  }

  // Basal rosette: one small leaf per word of the author's name, plus two.
  let nameWords = 0
  for (const w of author.split(" ")) if (w) nameWords++
  const rosette = Math.min(6, nameWords + 2)
  for (let i = 0; i < rosette; i++) {
    const a = (-90 + (i - (rosette - 1) / 2) * (150 / Math.max(1, rosette - 1)) + s.range(-6, 6)) * DEG
    leaf(0, -1, a, (14 + s.range(0, 8)) * (leafShape === "coin" ? 0.72 : 1))
  }

  /** Leaves along a quadratic run, a word each; a comma sets a pair.
   *  @param {Types.NoteSentence} sen @param {(t: number) => {x: number, y: number, a: number}} at
   *  @param {number} cap @param {number} side @param {number} base */
  const leafRun = (sen, at, cap, side, base) => {
    const m = Math.min(sen.words.length, cap)
    for (let i = 0; i < m; i++) {
      const t = (i + 0.65) / (m + 0.5)
      const p = at(t)
      const wl = sen.words[Math.floor((i * sen.words.length) / m)] || "x"
      const L = (base + 1.45 * Math.min(12, wl.length)) * 1.25 * (1 - 0.32 * t)
      const sgn = i % 2 === 0 ? side : -side
      leaf(p.x, p.y, p.a + sgn * s.range(40, 62) * DEG, L)
      if (sen.commas.includes(i)) leaf(p.x, p.y, p.a - sgn * s.range(40, 62) * DEG, L)
    }
  }

  /** Emoji grow on short pedicels mid-run, or crown a wordless shoot.
   *  @param {Types.NoteSentence} sen @param {(t: number) => {x: number, y: number, a: number}} at */
  const emojiRun = (sen, at) => {
    const list = sen.emoji.slice(0, MAX_EMOJI)
    list.forEach((em, i) => {
      const p = at(sen.words.length ? 0.45 + i * 0.15 : 1)
      const fan = sen.words.length ? (i % 2 === 0 ? -1 : 1) * 50 : (i - (list.length - 1) / 2) * 40
      const dir = p.a + fan * DEG
      const pl = sen.words.length ? 14 : list.length > 1 ? 16 : 4
      const q = [p.x + Math.cos(dir) * pl, p.y + Math.sin(dir) * pl]
      if (pl > 5) add("nf-fine", `M${f(p.x)} ${f(p.y)}L${f(q[0])} ${f(q[1])}`)
      emojiFlower(em, q[0], q[1], i)
      grow(q[0], q[1], 16)
    })
  }

  /** @param {string} em @param {number} x @param {number} y @param {number} i */
  const emojiFlower = (em, x, y, i) => {
    parts.emoji++
    const rot = s.range(0, 360) * DEG
    if (em.includes("❤") || em.includes("💛") || em.includes("💗") || em.includes("💕")) {
      const R = 11
      const heart = ["M", 0, 0, "C", R * 0.35, -R * 0.55, R * 0.95, -R * 0.45, R * 0.68, 0,
        "C", R * 0.95, R * 0.45, R * 0.35, R * 0.55, 0, 0, "Z"]
      let d = ""
      for (let k = 0; k < 5; k++) {
        const a = rot + k * 72 * DEG
        d += place(x + Math.cos(a) * R * 0.18, y + Math.sin(a) * R * 0.18, a, heart)
      }
      add(em.includes("💛") ? "nf-petals nf-b3" : "nf-petals nf-b0", d)
      add("nf-eye nf-gold", circle(x, y, 2.6))
      return
    }
    if (em.includes("🥂")) {
      const bell = ["M", -5, 0, "Q", -5, 9, -7, 11, "L", 7, 11, "Q", 5, 9, 5, 0, "Q", 0, -3, -5, 0, "Z"]
      for (const [dx, rr] of [[-5, 18], [5, -18]]) {
        const a = rr * DEG
        add("nf-fine", place(x + dx, y, a, ["M", 0, -10, "L", 0, 0]))
        add("nf-petals nf-b1", place(x + dx, y, a, bell))
      }
      return
    }
    // 🎉 and any other emoji: an allium, a sphere of radiating florets.
    const R = 10 + i * 2
    const layer = "nf-dot nf-b" + ((i + 2) % 4)
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + rot
      const ex = x + Math.cos(a) * R
      const ey = y + Math.sin(a) * R
      add("nf-fine", `M${f(x)} ${f(y)}L${f(ex)} ${f(ey)}`)
      add(layer, circle(ex, ey, 1.7))
    }
  }

  /** The flower a sentence ends on. @param {Types.NoteSentence} sen @param {number[]} at @param {number} a */
  const tipFor = (sen, at, a) => {
    if (sen.words.length === 0 && sen.emoji.length) return // emoji already crown it
    const chars = sen.words.join(" ").length
    const k = Math.min(3, Math.max(1, sen.marks))
    if (sen.end === "!") {
      const R = Math.min(21, 10 + 1.1 * Math.sqrt(chars))
      for (let i = 0; i < k; i++) {
        const off = i === 0 ? 0 : (i % 2 ? -1 : 1) * 34 * DEG
        const pl = i === 0 ? 0 : R * 1.5
        const bx = at[0] + Math.cos(a + off) * pl
        const by = at[1] + Math.sin(a + off) * pl
        if (pl) add("nf-fine", `M${f(at[0])} ${f(at[1])}L${f(bx)} ${f(by)}`)
        bloom(bx, by, i === 0 ? R : R * 0.72)
        grow(bx, by, R)
      }
    } else if (sen.end === "?") {
      parts.buds += k
      const L = 11 + Math.min(8, chars / 8)
      const d = s.chance(0.5) ? 1 : -1
      // The first nods; a second nods the other way; a third stands up.
      for (let i = 0; i < k; i++) {
        if (i < 2) nodding(at[0], at[1], a, L * (i ? 0.82 : 1), i ? -d : d)
        else {
          budAt(at[0], at[1], a, L * 0.7)
          grow(at[0] + Math.cos(a) * L, at[1] + Math.sin(a) * L, 6)
        }
      }
    } else if (sen.end === "." && sen.marks > 1) {
      berries(at[0], at[1], a, 3 + Math.min(4, sen.marks))
      grow(at[0], at[1], 12)
    } else if (sen.end === ".") {
      tulip(at[0], at[1], a, Math.min(17, 8.5 + 0.95 * Math.sqrt(chars)))
    } else {
      tendril(at[0], at[1], a, 7 + Math.min(6, chars / 12))
      grow(at[0], at[1], 14)
    }
  }

  /** @param {number} x @param {number} y @param {number} R */
  const bloom = (x, y, R) => {
    parts.blooms++
    const rot = s.range(0, 360) * DEG
    // A daisy carries twice the rays, round a wider eye.
    const daisy = petalShape === "strap"
    const n = daisy ? petals * 2 : petals
    const w = ((Math.PI * R) / n) * (daisy ? 0.85 : 0.95)
    const cmds = petalCmds(petalShape, R, w)
    let d = ""
    for (let i = 0; i < n; i++) d += place(x, y, rot + (Math.PI * 2 * i) / n, cmds)
    add("nf-petals " + tint, d)
    add(gold ? "nf-eye nf-gold" : "nf-eye", circle(x, y, R * (daisy ? 0.3 : 0.24)))
  }

  /** The flower a full stop sets: a tulip in profile. Two back petals, a shade
   *  deeper, flare out either side of the front one; a crease down the front
   *  petal turns it into a cup rather than a shield. It turns to the sky
   *  whatever way its branch runs, so a plain sentence ends on an upright cup.
   *  @param {number} x @param {number} y @param {number} a @param {number} R */
  const tulip = (x, y, a, R) => {
    parts.tulips++
    const up = Math.atan2(Math.sin(a) - 1.4, Math.cos(a))
    const H = R * 1.55
    const W = R * cup
    // Back petals: the outer silhouette and both side tips. Their inner edges
    // tuck under the front petal, which is painted after them.
    add("nf-cup " + tint, place(x, y, up, ["M", H * 0.02, 0,
      "C", -H * 0.06, -W * 1.02, H * 0.28, -W * 1.22, H * 0.6, -W * 1.12,
      "C", H * 0.78, -W * 1.04, H * 0.88, -W * 1.06, H * 0.96, -W * 1.1,
      "Q", H * 0.84, -W * 0.56, H * 0.58, -W * 0.06,
      "L", H * 0.58, W * 0.06,
      "Q", H * 0.84, W * 0.56, H * 0.96, W * 1.1,
      "C", H * 0.88, W * 1.06, H * 0.78, W * 1.04, H * 0.6, W * 1.12,
      "C", H * 0.28, W * 1.22, -H * 0.06, W * 1.02, H * 0.02, 0, "Z"]))
    // The front petal: a round-bottomed cup drawing up to a soft point.
    add("nf-bud " + tint, place(x, y, up, ["M", H * 0.04, 0,
      "C", -H * 0.03, -W * 0.96, H * 0.36, -W * 1.02, H * 0.62, -W * 0.84,
      "C", H * 0.84, -W * 0.66, H * 0.98, -W * 0.28, H * 1.08, 0,
      "C", H * 0.98, W * 0.28, H * 0.84, W * 0.66, H * 0.62, W * 0.84,
      "C", H * 0.36, W * 1.02, -H * 0.03, W * 0.96, H * 0.04, 0, "Z"]))
    const lean = s.chance(0.5) ? 1 : -1
    const crease = ["M", H * 0.14, W * 0.1 * lean, "Q", H * 0.6, W * 0.26 * lean, H, W * 0.04 * lean]
    add("nf-crease", place(x, y, up, crease))
    // A Favorite: a gold collar where the cup meets its stem.
    if (gold) {
      const cx = x + Math.cos(up) * H * 0.05
      const cy = y + Math.sin(up) * H * 0.05
      add("nf-eye nf-gold", ellipse(cx, cy, W * 0.52, R * 0.12, up + Math.PI / 2))
    }
    grow(x + Math.cos(up) * H * 0.55, y + Math.sin(up) * H * 0.55, H * 0.75)
  }

  /** A question nods: the stem crooks over like the mark itself and the bud
   *  hangs from it, closed. `d` is the side it bows to.
   *  @param {number} x @param {number} y @param {number} a @param {number} L @param {number} d */
  const nodding = (x, y, a, L, d) => {
    const r = L * 0.8
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const px = Math.cos(a + (d * Math.PI) / 2)
    const py = Math.sin(a + (d * Math.PI) / 2)
    const c1 = [x + ux * r * 1.15, y + uy * r * 1.15]
    const c2 = [x + ux * r * 1.2 + px * r * 1.05, y + uy * r * 1.2 + py * r * 1.05]
    const end = [x + ux * r * 0.7 + px * r * 1.3, y + uy * r * 0.7 + py * r * 1.3]
    const crook = `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(end[0])} ${f(end[1])}`
    add("nf-stem", `M${f(x)} ${f(y)}${crook}`)
    const ba = Math.atan2(end[1] - c2[1], end[0] - c2[0])
    budAt(end[0], end[1], ba, L)
    grow(c2[0], c2[1], 4)
    grow(end[0] + Math.cos(ba) * L, end[1] + Math.sin(ba) * L, L * 0.6)
  }

  /** A closed bud in its sepals, along `a`. @param {number} x @param {number} y
   *  @param {number} a @param {number} L */
  const budAt = (x, y, a, L) => {
    add("nf-bud " + tint, place(x, y, a, budCmds(L)))
    add("nf-crease", place(x, y, a, ["M", L * 0.3, L * 0.05, "Q", L * 0.65, L * 0.1, L * 0.92, 0]))
    add("nf-sepal", place(x, y, a, sepalCmds(L)))
    if (gold) add("nf-eye nf-gold", circle(x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.5, L * 0.12))
  }

  /** @param {number} x @param {number} y @param {number} a @param {number} count */
  const berries = (x, y, a, count) => {
    parts.berries += count
    for (let i = 0; i < count; i++) {
      const aa = a + (i - (count - 1) / 2) * 0.55
      const r = 3.2 + s.range(0, 1.6)
      const dist = 7 + s.range(0, 4)
      const bx = x + Math.cos(aa) * dist
      const by = y + Math.sin(aa) * dist
      add("nf-fine", `M${f(x)} ${f(y)}L${f(bx)} ${f(by)}`)
      add("nf-berry", circle(bx, by, r))
      add("nf-shine", circle(bx - r * 0.35, by - r * 0.35, r * 0.28))
    }
  }

  /** A fiddlehead: a spiral curling back on itself. @param {number} x @param {number} y
   *  @param {number} a @param {number} R */
  const tendril = (x, y, a, R) => {
    parts.tendrils++
    const dir = s.chance(0.5) ? 1 : -1
    /** @type {(string | number)[]} */
    const cmds = ["M", 0, 0]
    const steps = 20
    for (let i = 1; i <= steps; i++) {
      const u = i / steps
      const th = u * 1.6 * Math.PI * 2
      const r = R * (1 - u * 0.85)
      cmds.push("L", u * R * 0.9 + Math.sin(th) * r * 0.6, dir * (1 - Math.cos(th)) * r * 0.6)
    }
    add("nf-fine", place(x, y, a, cmds))
  }

  // Side branches, one per sentence but the last.
  const S = capped.length
  let side = s.chance(0.5) ? 1 : -1
  capped.slice(0, -1).forEach((sen, k) => {
    parts.branches++
    const t = S === 2 ? 0.5 : 0.22 + (0.62 * k) / Math.max(1, S - 2)
    const at = qAt(root, ctrl, tip, t)
    const out = at.a + side * s.range(34, 58) * DEG
    const Lb = Math.min(105, 16 + 12 * Math.sqrt(sen.words.length + sen.emoji.length)) * (1 - 0.3 * t)
    const a0 = [at.x, at.y]
    const end = [at.x + Math.cos(out) * Lb, at.y + Math.sin(out) * Lb * 0.92 - Lb * 0.12]
    const bc = [at.x + Math.cos(out) * Lb * 0.55, at.y + Math.sin(out) * Lb * 0.55 + Lb * 0.12]
    add("nf-stem", `M${f(at.x)} ${f(at.y)}Q${f(bc[0])} ${f(bc[1])} ${f(end[0])} ${f(end[1])}`)
    grow(end[0], end[1], 6)
    const run = (/** @type {number} */ u) => qAt(a0, bc, end, u)
    leafRun(sen, run, MAX_BRANCH_LEAVES, 1, 6)
    emojiRun(sen, run)
    tipFor(sen, end, run(1).a)
    side = -side
  })

  // The leading shoot carries the last sentence.
  const leader = capped[S - 1]
  const lt0 = S > 1 ? 0.3 + 0.5 * ((S - 2) / Math.max(1, S - 1)) : 0.15
  const sub = (/** @type {number} */ u) => qAt(root, ctrl, tip, lt0 + (1 - lt0) * u)
  leafRun(leader, sub, MAX_LEADER_LEAVES, side, 7)
  emojiRun(leader, sub)
  tipFor(leader, tip, qAt(root, ctrl, tip, 1).a)

  const leafLayer = leafShape === "blade" ? "nf-leaf nf-open" : `nf-leaf nf-l${leafTint}`
  let markup = ""
  for (const layer of LAYERS) {
    const d = ink.get(layer)
    if (!d) continue
    markup += `<path class="${layer === "nf-leaf" ? leafLayer : layer}" d="${d.trimEnd()}"/>`
  }
  const pad = 6
  return {
    markup: `<g class="nf-plant">${markup}</g>`,
    box: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: 6 },
    parts,
  }
}

/** @type {Types.flowerSVG} */
export function flowerSVG(note, opts = {}) {
  const p = growFlower(note, opts)
  const { x0, y0, x1, y1 } = p.box
  const w = x1 - x0
  const h = y1 - y0
  // Size follows the plant (a longer note stands taller), capped to its slot.
  const k = Math.min(opts.scale ?? 0.5, (opts.maxW ?? Infinity) / w, (opts.maxH ?? Infinity) / h)
  return `<svg class="nf-svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" width="${Math.round(w * k)}" height="${Math.round(h * k)}" focusable="false" aria-hidden="true">${p.markup}</svg>`
}
