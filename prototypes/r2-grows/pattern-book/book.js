/** @file Pattern Book — memory book (`data-mb-layout="pattern-book"`). An
 *  old-fashioned coverlet pattern book: the whole coverlet on the cover, a key
 *  to reading a draft, then one loom-ready weaving draft per note beside a
 *  swatch of the cloth it weaves, and a register at the back. SVG + CSS only. */

import { initHarness } from "../shared/harness.js"
import { loadFixture } from "../shared/fixture.js"
import { esc, longDate } from "../shared/text.js"
import { clothSVG, draftSVG, draftFacts, SHAFTS } from "./weave.js"
import { coverletSVG, coverletCols } from "./coverlet.js"
import { PARAMS, applyPalette } from "./params.js"

/** @import { Entry, Couple } from "../shared/fixture.js" */

const BOOK_PARAMS = { ...PARAMS, perSheet: { value: "2", hint: { options: ["1", "2"] } } }
const values = initHarness({
  sketch: "Pattern Book",
  slot: "book: pattern-book",
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

/** @param {Entry} e @param {number} no @param {boolean} half */
function draftPage(e, no, half) {
  const ends = Number(values.ends)
  const facts = draftFacts(e)
  const len = e.message.length
  return `<article class="pbk-draft ${half ? "is-half" : "is-full"} ${len > 300 ? "is-long" : len > 120 ? "is-mid" : ""}">
    <header class="pbk-head"><span class="pbk-no">Draft No. ${no}</span><span class="pbk-for">for ${esc(e.author_name)}</span>${e.fav ? '<span class="pbk-fav">✶ Favorite</span>' : ""}</header>
    <div class="pbk-diagram">${draftSVG(e, { ends })}</div>
    <div class="pbk-side">
      <div class="wv-swatch pbk-swatch">${clothSVG(e, { ends })}</div>
      <p class="pbk-spec">${SHAFTS} shafts · ${facts.ends} ends<br>${facts.twill} twill · tromp as writ</p>
    </div>
    <blockquote class="pbk-msg">${esc(e.message)}</blockquote>
    <p class="pbk-when">${longDate(e.created_at)}</p>
  </article>`
}

/** @param {Entry[]} list @param {Couple} c */
function cover(list, c) {
  return `<section class="mb-sheet pbk-sheet pbk-cover">
    <div class="pbk-cover-cloth">${coverletSVG(list, c, { cols: coverletCols(list.length, true), ends: Number(values.ends), fringe: true, minSlots: 9 })}</div>
    <div class="pbk-cartouche">
      <p class="pbk-kicker">A Pattern Book</p>
      <h1>${esc(c.display)}</h1>
      <p>${list.length} ${list.length === 1 ? "draft" : "drafts"}, one threaded from each note in the guestbook</p>
      <p class="pbk-small">${esc(c.location)} · ${longDate(c.date + " 00:00")}</p>
    </div>
  </section>`
}

/** @param {Entry} sample */
function key(sample) {
  return `<section class="mb-sheet pbk-sheet pbk-key">
    <h2>How a note becomes cloth</h2>
    <p class="pbk-lede">Each page is a weaving draft, the notation weavers have used for three hundred years. Nothing here was designed: the words did it, and the same note always weaves the same cloth.</p>
    <div class="pbk-key-diagram">
      ${draftSVG(sample, { ends: 32 })}
      <ol class="pbk-key-notes">
        <li><b>Threading</b>, across the top. One square per warp thread, on the shaft it is threaded through. Each letter of the note is one thread, written underneath. A word climbs the shafts; the next word climbs back down, so <em>every word boundary is the point of a diamond</em>, and a long word weaves a wide one.</li>
        <li><b>Tie-up</b>, top right. Which shafts each treadle lifts. Your name chooses one of six twills, so all your notes share a texture.</li>
        <li><b>Treadling</b>, down the right: the letters again, <em>tromp as writ</em>, so the motif is square.</li>
        <li><b>Drawdown</b>, the big grid: the cloth. A coloured square is the weft on top, a bare one the warp; the accent rows are the first letter of each word. The dashed line is the mirror; the note is woven forward, then back.</li>
      </ol>
    </div>
    <div class="pbk-key-swatch"><div class="wv-swatch">${clothSVG(sample, { ends: 32 })}</div><p>…which weaves this: “${esc(sample.message)}” — ${esc(sample.author_name)}</p></div>
  </section>`
}

function render() {
  const oldest = entries.slice().reverse()
  const favs = oldest.filter((e) => e.fav)
  const rest = oldest.filter((e) => !e.fav)
  const per = values.perSheet === "1" ? 1 : 2
  const sample = oldest.find((e) => e.message.length > 25 && e.message.length < 60) || oldest[0]
  /** @type {string[]} */
  const sheets = [cover(oldest, couple), key(sample)]
  /** @type {{e: Entry, no: number, page: number}[]} */
  const register = []
  let no = 1
  // Group into sheets: a long note gets a sheet to itself; the rest pair up.
  /** @type {Entry[][]} */
  const groups = []
  /** @type {Entry[]} */
  let pending = []
  for (const e of favs.concat(rest)) {
    if (per === 2 && e.message.length > 200) {
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
    const half = per === 2 && group[0].message.length <= 200
    sheets.push(
      `<section class="mb-sheet pbk-sheet${half ? " is-pair" : ""}">${group
        .map((e) => {
          register.push({ e, no, page: sheets.length + 1 })
          return draftPage(e, no++, half)
        })
        .join("")}</section>`,
    )
  }
  const PER = 40
  for (let i = 0; i < register.length; i += PER) {
    sheets.push(`<section class="mb-sheet pbk-sheet pbk-register">
      ${i === 0 ? "<h2>Register of drafts</h2>" : ""}
      <ol>${register
        .slice(i, i + PER)
        .map((r) => `<li><span class="pbk-r-no">${r.no}</span><span class="pbk-r-sw"><span class="wv-swatch">${clothSVG(r.e, { ends: 24, plain: true })}</span></span><span class="pbk-r-who">${esc(r.e.author_name)}</span><span class="pbk-r-p">p. ${r.page}</span></li>`)
        .join("")}</ol>
      ${i + PER >= register.length ? '<p class="pbk-colophon">Every draft in this book is loom-ready. Thread an eight-shaft loom from any page, treadle it as written, and you will weave that guest’s square. Weave them all, in order, and you have the coverlet on the cover.</p>' : ""}
    </section>`)
  }
  root.innerHTML = sheets.join("")
}

render()
