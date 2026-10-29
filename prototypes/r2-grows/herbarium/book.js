/** @file Herbarium — memory book (`data-mb-layout="herbarium"`). The book is a
 *  bound herbarium: a wreath cover grown from everyone, a key to reading a
 *  specimen, one mounted sheet per note (Favorites as TYPE SPECIMENs), and an
 *  index of species. SVG + CSS only, so it prints. This file is the sketch of
 *  the slot's `decorate(root)` hook. */

import { initHarness } from "../shared/harness.js"
import { loadFixture } from "../shared/fixture.js"
import { f, seeded } from "../shared/seed.js"
import { esc, longDate, sentences } from "../shared/text.js"
import { growPlant, plantSVG, binomial } from "./plant.js"
import { PARAMS, applyPalette, growOpts } from "./params.js"

/** @import { Entry, Couple } from "../shared/fixture.js" */

const BOOK_PARAMS = {
  ...PARAMS,
  perSheet: { value: "2", hint: { options: ["1", "2"] } },
}

const values = initHarness({
  sketch: "Herbarium",
  slot: "book: herbarium",
  view: "book",
  links: { guestbook: "./", book: "./book.html" },
  params: BOOK_PARAMS,
  onParams(v) {
    applyPalette(v)
    render()
  },
})
applyPalette(values)

const { couple, entries } = await loadFixture()
const root = /** @type {HTMLElement} */ (document.getElementById("mb-book"))

/** What grew, in a determination slip's words. @param {Entry} e */
function census(e) {
  const sents = sentences(e.message)
  let flowers = 0
  let buds = 0
  let berries = 0
  let tendrils = 0
  let special = 0
  for (const s of sents) {
    special += Math.min(3, s.emoji.length)
    if (!s.words.length) continue
    if (s.end === "!") flowers += Math.min(3, s.marks)
    else if (s.end === "?") buds += Math.min(3, s.marks)
    else if (s.end === "." && s.marks > 1) berries++
    else if (s.end === ".") flowers++
    else tendrils++
  }
  const parts = [
    plural(Math.max(0, sents.length - 1), "branch", "branches"),
    // As drawn: a branch carries at most 9 leaves, the leading shoot 12.
    plural(
      sents.reduce((n, s, i) => n + Math.min(s.words.length, i === sents.length - 1 ? 12 : 9), 0),
      "leaf",
      "leaves",
    ),
    plural(flowers + special, "flower", "flowers"),
    plural(buds, "bud", "buds"),
    plural(berries, "berry cluster", "berry clusters"),
    plural(tendrils, "tendril", "tendrils"),
  ].filter(Boolean)
  return parts.join(" · ")
}

/** @param {number} n @param {string} one @param {string} many */
function plural(n, one, many) {
  return n ? n + " " + (n === 1 ? one : many) : ""
}

/** A round rubber stamp, text on a circle. @param {string} text @param {string} id */
function stamp(text, id) {
  return `<svg class="hbk-stamp" viewBox="-50 -50 100 100" aria-hidden="true"><defs><path id="${id}" d="M-36 0A36 36 0 1 1 36 0A36 36 0 1 1 -36 0"/></defs>
    <circle r="46"/><circle r="29"/><text><textPath href="#${id}" startOffset="0">${esc(text)}</textPath></text>
    <text class="hbk-stamp-mid" y="-2">TYPE</text><text class="hbk-stamp-sub" y="12">J ✶ J</text></svg>`
}

/** @param {Entry} e @param {number} no @param {boolean} half */
function specimen(e, no, half) {
  const opts = { ...growOpts(values), straps: true }
  const len = e.message.length
  const size = len > 300 ? "is-long" : len > 120 ? "is-mid" : "is-short"
  return `<article class="hbk-spec ${half ? "is-half" : "is-full"} ${size}${e.fav ? " is-type" : ""}">
    <div class="hbk-plant">${plantSVG(e, { ...opts, minW: 120 })}</div>
    <p class="hbk-det"><span>Det.</span> ${census(e)}</p>
    ${e.fav ? `<div class="hbk-stamp-wrap">${stamp("HERBARIUM · JORDANA & JESSE · FAVORITE · ", "st" + e.id)}</div>` : ""}
    <div class="hbk-label">
      <p class="hbk-label-head"><span>Herbarium of ${esc(couple.display)}</span><span>No. ${String(no).padStart(4, "0")}</span></p>
      <p class="hbk-binomial">${esc(binomial(e))}</p>
      <p class="hbk-coll">Coll. <strong>${esc(e.author_name)}</strong></p>
      <p class="hbk-when">${longDate(e.created_at)} · ${esc(couple.location)} · ${e.created_at.slice(11, 16)}</p>
      <p class="hbk-notes-h">Field notes</p>
      <p class="hbk-notes">${esc(e.message)}</p>
    </div>
  </article>`
}

/** Every plant, rooted on a ring and growing outward: the wreath.
 *  @param {Entry[]} list */
function wreath(list) {
  const n = list.length
  const opts = growOpts(values)
  const rings = n > 90 ? 3 : n > 36 ? 2 : 1
  let out = ""
  list.forEach((e, i) => {
    const ring = i % rings
    const k = Math.floor(i / rings)
    const per = Math.ceil(n / rings)
    const r0 = 112 + ring * 30
    const ang = ((k + ring * 0.5) / per) * 360 - 90
    const s = seeded("wreath" + e.id)
    const p = growPlant(e, opts)
    const tall = -p.box.y0
    const fit = Math.min(1, ((2 * Math.PI * r0) / Math.max(per, 8)) / 38, (238 - r0) / tall)
    out += `<g transform="rotate(${f(ang + 90 + s.range(-4, 4))}) translate(0 ${-r0}) scale(${f(fit * (rings > 1 ? 1 - ring * 0.08 : 1))})">${p.markup}</g>`
  })
  return `<svg class="hbk-wreath is-grown" viewBox="-250 -250 500 500" aria-hidden="true">${out}</svg>`
}

/** The endpaper: a key to reading your own plant, drawn by the same code. */
function key() {
  const opts = growOpts(values)
  const rows = [
    ["A wish.", "a full stop sets a flower; the author picks its kind"],
    ["A wish!", "an exclamation: a showy blossom"],
    ["A wish?", "a question: a bud, still closed"],
    ["A wish…", "an ellipsis: berries, still ripening"],
    ["A wish", "no full stop: a tendril, still unfurling"],
    ["A wish, a hope.", "a comma: a pair of opposite leaves"],
    ["A wish. A hope. A home.", "each sentence: its own branch"],
    ["🎉", "an emoji: a special flower"],
  ]
  const cells = rows
    .map(([msg, gloss], i) => {
      const e = /** @type {Entry} */ ({ id: -1 - i, message: msg, author_name: "The Key", created_at: "2026-04-26 15:00:00", reactions: {}, comment_count: 0, fav: false })
      return `<figure class="hbk-key-cell"><div class="hbk-key-plant">${plantSVG(e, { ...opts, minW: 80 })}</div><figcaption><q>${esc(msg)}</q><span>${esc(gloss)}</span></figcaption></figure>`
    })
    .join("")
  return `<section class="mb-sheet hbk-sheet hbk-keysheet">
    <h2>How to read a specimen</h2>
    <p class="hbk-lede">Every note in this book grew its plant from its own grammar. Nobody chose these; the words did. The same note grows the same plant every time.</p>
    <div class="hbk-key-grid">${cells}</div>
    <p class="hbk-lede hbk-small">Your name decides the shape of your leaves, your petals and their number, and the rosette at the root. Notes signed after dark bloom pale. Favorites are mounted as type specimens.</p>
  </section>`
}

/** @param {Entry[]} list @param {Couple} c */
function cover(list, c) {
  return `<section class="mb-sheet hbk-sheet hbk-cover">
    ${wreath(list)}
    <div class="hbk-cover-text">
      <p class="hbk-cover-kicker">Herbarium</p>
      <h1>${esc(c.display)}</h1>
      <p class="hbk-cover-sub">${list.length} ${list.length === 1 ? "specimen" : "specimens"}, grown from the guestbook</p>
      <p class="hbk-cover-place">${esc(c.location)} · ${longDate(c.date + " 00:00")}</p>
    </div>
  </section>`
}

function render() {
  const oldest = entries.slice().reverse()
  const favs = oldest.filter((e) => e.fav)
  const rest = oldest.filter((e) => !e.fav)
  const per = values.perSheet === "1" ? 1 : 2
  /** @type {string[]} */
  const sheets = [cover(oldest, couple), key()]
  /** @type {{e: Entry, page: number, no: number}[]} */
  const index = []
  let no = 1
  for (const e of favs) {
    index.push({ e, page: sheets.length + 1, no })
    sheets.push(`<section class="mb-sheet hbk-sheet">${specimen(e, no++, false)}</section>`)
  }
  // Group into sheets: a long note always gets a sheet to itself; the rest pair up.
  /** @type {Entry[][]} */
  const groups = []
  /** @type {Entry[]} */
  let pending = []
  for (const e of rest) {
    if (per === 2 && e.message.length > 220) {
      groups.push([e])
      continue
    }
    pending.push(e)
    if (pending.length === per) {
      groups.push(pending)
      pending = []
    }
  }
  if (pending.length) groups.push(pending)
  for (const group of groups) {
    const half = per === 2 && (group.length === 2 || group[0].message.length <= 220)
    const body = group
      .map((e) => {
        index.push({ e, page: sheets.length + 1, no })
        return specimen(e, no++, half)
      })
      .join("")
    sheets.push(`<section class="mb-sheet hbk-sheet${half ? " is-pair" : ""}">${body}</section>`)
  }
  index.sort((a, b) => (binomial(a.e) < binomial(b.e) ? -1 : 1))
  const perIndexSheet = 46
  for (let i = 0; i < index.length; i += perIndexSheet) {
    const chunk = index.slice(i, i + perIndexSheet)
    sheets.push(`<section class="mb-sheet hbk-sheet hbk-index">
      ${i === 0 ? "<h2>Index of species</h2>" : ""}
      <ol>${chunk.map((x) => `<li><i>${esc(binomial(x.e))}</i><span class="hbk-dots"></span><span class="hbk-ix-who">${esc(x.e.author_name)}</span><span class="hbk-ix-p">${x.page}</span></li>`).join("")}</ol>
      ${i + perIndexSheet >= index.length ? `<p class="hbk-colophon">Grown deterministically from ${index.length} notes. No plant was chosen; each one is its note.</p>` : ""}
    </section>`)
  }
  root.innerHTML = sheets.join("")
}

render()
