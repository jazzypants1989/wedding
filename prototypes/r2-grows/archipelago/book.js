/** @file Archipelago — memory book (`data-mb-layout="atlas"`). An atlas of the
 *  guestbook: the general chart, a legend, one plate per island with the note
 *  printed as its sailing directions, and a gazetteer that cites both the
 *  plate and the grid square on the general chart. SVG + CSS only. */

import { initHarness } from "../shared/harness.js"
import { loadFixture } from "../shared/fixture.js"
import { esc, longDate } from "../shared/text.js"
import { islandChart, raiseIsland } from "./island.js"
import { chartSVG } from "./chart.js"
import { PARAMS, applyPalette } from "./params.js"

/** @import { Entry, Couple } from "../shared/fixture.js" */

const BOOK_PARAMS = { ...PARAMS, perSheet: { value: "2", hint: { options: ["1", "2"] } } }
const values = initHarness({
  sketch: "Archipelago",
  slot: "book: atlas",
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

/** @param {Entry} e @param {number} no @param {boolean} half @param {string} ref */
function plate(e, no, half, ref) {
  const rough = Number(values.coastline)
  const isl = raiseIsland(e, { rough })
  const len = e.message.length
  return `<article class="abk-plate ${half ? "is-half" : "is-full"} ${len > 300 ? "is-long" : len > 120 ? "is-mid" : ""}${e.fav ? " is-fav" : ""}">
    <div class="abk-map">${islandChart(e, { frame: true, rough })}</div>
    <div class="abk-text">
      <p class="abk-plate-no">Plate ${no}${ref ? ` · chart ${ref}` : ""}</p>
      <h2 class="abk-name">${esc(isl.name)}</h2>
      <p class="abk-survey">Surveyed by <strong>${esc(e.author_name)}</strong>, ${longDate(e.created_at)}</p>
      <dl class="abk-facts">
        ${isl.summit ? `<div><dt>Summit</dt><dd>${esc(isl.summit)}, ${isl.elevation} ft</dd></div>` : `<div><dt>Height</dt><dd>${isl.elevation} ft</dd></div>`}
        ${isl.bay ? `<div><dt>Anchorage</dt><dd>${esc(isl.bay)}</dd></div>` : ""}
        ${e.fav ? "<div><dt>Status</dt><dd>Capital · a Favorite</dd></div>" : ""}
      </dl>
      <p class="abk-dir-h">Sailing directions</p>
      <p class="abk-dir">${esc(e.message)}</p>
    </div>
  </article>`
}

function legend() {
  const rows = [
    ["Size", "how much was written. A word or two makes a rock; a letter makes highlands."],
    ["Hills", "one per sentence. A long sentence throws off a spur."],
    ["Summit", "named for the note’s most particular word; its height is the note’s length."],
    ["Anchorage", "named for the next most particular word."],
    ["Sea stacks", "one for each emoji."],
    ["Lighthouse", "on any note that mentions one, and on every rock with no words at all."],
    ["Ferry routes", "dashed: two notes that share an uncommon word, labelled with it."],
    ["Capital ✶", "a Favorite."],
  ]
  const samples = [
    ["🎉", "a rock, with a light"],
    ["Cheers to you both.", "one sentence, one hill"],
    ["We danced. We cried. We ate far too much cake.", "three sentences"],
    ["Here is our advice for what it is worth. Keep laughing at the same dumb things. Keep a running list of places you want to go and go to one every year. Say thank you for the small stuff.", "a long letter"],
  ]
  return `<section class="mb-sheet abk-sheet abk-legend">
    <h2 class="abk-h">Legend</h2>
    <p class="abk-lede">Nobody drew these islands. Each one rose from its note, and the same note raises the same island every time.</p>
    <dl class="abk-legend-list">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <div class="abk-samples">${samples
      .map(([msg, cap]) => {
        const e = /** @type {Entry} */ ({ id: -1, author_name: "The Key", message: msg, created_at: "2026-04-26 12:00:00", reactions: {}, comment_count: 0, fav: false })
        return `<figure>${islandChart(e, { labels: false, rough: Number(values.coastline), V: 100 })}<figcaption><q>${esc(msg.length > 30 ? msg.slice(0, 28) + "…" : msg)}</q>${esc(cap)}</figcaption></figure>`
      })
      .join("")}</div>
  </section>`
}

function render() {
  const rough = Number(values.coastline)
  const { svg, placed } = chartSVG(entries, couple, {
    W: 600,
    H: 780,
    routes: Boolean(values.routes),
    labels: entries.length > 80 ? "big" : /** @type {"all" | "big" | "none"} */ (values.labels),
    rough,
  })
  const refOf = new Map(placed.map((p) => [p.e.id, p.ref]))
  const oldest = entries.slice().reverse()
  const favs = oldest.filter((e) => e.fav)
  const rest = oldest.filter((e) => !e.fav)
  const per = values.perSheet === "1" ? 1 : 2
  /** @type {string[]} */
  const sheets = [
    `<section class="mb-sheet abk-sheet abk-cover">
      <div class="abk-cartouche"><p>An Atlas of the Guestbook</p><h1>${esc(couple.display)}</h1><p class="abk-small">${entries.length} islands surveyed · ${esc(couple.location)} · ${longDate(couple.date + " 00:00")}</p></div>
      <div class="abk-general">${svg}</div>
    </section>`,
    legend(),
  ]
  /** @type {{name: string, kind: string, ref: string, plate: number}[]} */
  const gaz = []
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
  let no = 1
  for (const group of groups) {
    const half = per === 2 && group[0].message.length <= 200
    sheets.push(
      `<section class="mb-sheet abk-sheet${half ? " is-pair" : ""}">${group
        .map((e) => {
          const isl = raiseIsland(e, { rough })
          const ref = refOf.get(e.id) || ""
          gaz.push({ name: isl.name, kind: "island", ref, plate: no })
          if (isl.summit) gaz.push({ name: isl.summit, kind: "summit", ref, plate: no })
          if (isl.bay) gaz.push({ name: isl.bay, kind: "anchorage", ref, plate: no })
          return plate(e, no++, half, ref)
        })
        .join("")}</section>`,
    )
  }
  const sortKey = (/** @type {string} */ n) => (n.startsWith("Mt. ") ? n.slice(4) : n.startsWith("Isle of ") ? n.slice(8) : n.startsWith("Little ") ? n.slice(7) : n.startsWith("Greater ") ? n.slice(8) : n.startsWith("The ") ? n.slice(4) : n).toLowerCase()
  gaz.sort((a, b) => (sortKey(a.name) < sortKey(b.name) ? -1 : 1))
  const PER = 56
  for (let i = 0; i < gaz.length; i += PER) {
    sheets.push(`<section class="mb-sheet abk-sheet abk-gaz">
      ${i === 0 ? '<h2 class="abk-h">Gazetteer</h2>' : ""}
      <ol>${gaz
        .slice(i, i + PER)
        .map((g) => `<li><span class="abk-g-name">${esc(g.name)}</span><span class="abk-g-kind">${g.kind}</span><span class="abk-dots"></span><span class="abk-g-ref">${g.ref}</span><span class="abk-g-pl">pl. ${g.plate}</span></li>`)
        .join("")}</ol>
    </section>`)
  }
  root.innerHTML = sheets.join("")
}

render()
