/** @file Archipelago — guestbook view. The background slot is the general
 *  chart; each card carries its own island's inset chart; the composer raises
 *  your island from the sea as you type. */

import { initHarness, reduced } from "../shared/harness.js"
import { loadFixture } from "../shared/fixture.js"
import { renderGuestbook } from "../shared/guestbook.js"
import { esc } from "../shared/text.js"
import { islandChart, raiseIsland } from "./island.js"
import { chartSVG } from "./chart.js"
import { PARAMS, applyPalette } from "./params.js"

/** @import { Entry } from "../shared/fixture.js" */

/** @type {ReturnType<typeof renderGuestbook> | null} */
let page = null
const values = initHarness({
  sketch: "Archipelago",
  slot: "background: chart · card: inset",
  view: "guestbook",
  links: { guestbook: "./", book: "./book.html" },
  params: PARAMS,
  onParams(v) {
    applyPalette(v)
    page?.refresh()
  },
})
applyPalette(values)

const { couple, entries } = await loadFixture()
/** @type {number | null} */
let fresh = null

/** @param {Entry} e */
function inset(e) {
  const isl = raiseIsland(e, { rough: Number(values.coastline) })
  return `<div class="ar-inset ar-rise">${islandChart(e, { labels: false, rough: Number(values.coastline) })}</div>
    <p class="ar-inset-name">${esc(isl.name)}${isl.summit ? `<span>${esc(isl.summit)} · ${isl.elevation}</span>` : ""}</p>`
}

/** @param {HTMLElement} host @param {Entry[]} list */
function band(host, list) {
  const narrow = host.clientWidth < 700
  const W = narrow ? 600 : 1100
  const H = narrow ? 760 : 620
  const { svg } = chartSVG(list, couple, {
    W,
    H,
    links: true,
    routes: Boolean(values.routes),
    labels: /** @type {"all" | "big" | "none"} */ (list.length > 80 && values.labels === "all" ? "big" : values.labels),
    rough: Number(values.coastline),
    fresh,
  })
  host.innerHTML = `<div class="ar-frame-wrap">${svg}</div>
    <p class="ar-cap">${list.length} ${list.length === 1 ? "island" : "islands"}, one raised by each note, around the couple's. Dashed routes join notes that share a word.</p>`
  host.dataset.width = narrow ? "narrow" : "wide"
  if (fresh !== null && !reduced()) {
    const isle = host.querySelector(".is-fresh")
    isle?.classList.add("ar-rise")
    requestAnimationFrame(() => requestAnimationFrame(() => isle?.classList.add("is-grown")))
  }
}

const mount = /** @type {HTMLElement} */ (document.getElementById("main-content"))
page = renderGuestbook({
  couple,
  entries,
  mount,
  hooks: {
    intro: "Leave us a note and it will rise out of the sea as an island. Write more, it grows; name a thing, it gets a mountain.",
    bandLabel: "A sea chart with one island raised by each note",
    previewLabel: "Your island, rising as you type. Each sentence is a hill; your most particular word names the summit.",
    band,
    ornament: inset,
    preview: (d) => islandChart(d, { rough: Number(values.coastline) }),
    fire(e) {
      fresh = e.id
      band(/** @type {HTMLElement} */ (mount.querySelector(".gx-band")), entries)
      fresh = null
    },
  },
})

const host = /** @type {HTMLElement} */ (mount.querySelector(".gx-band"))
mount.addEventListener("pointerover", (ev) => {
  const card = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest(".gb-entry"))
  host.querySelectorAll(".is-lit").forEach((a) => a.classList.remove("is-lit"))
  host.classList.toggle("has-lit", Boolean(card))
  if (card) {
    host.querySelector(`.ar-isle[data-id="${card.dataset.id}"]`)?.classList.add("is-lit")
    host.querySelector(`.ar-t-isle[data-id="${card.dataset.id}"]`)?.classList.add("is-lit")
  }
})
addEventListener("resize", () => {
  const w = host.clientWidth < 700 ? "narrow" : "wide"
  if (w !== host.dataset.width) band(host, entries)
})
