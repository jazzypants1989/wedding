/** @file Pattern Book — guestbook view. The background slot is the coverlet,
 *  pieced from every note's cloth; each card carries a pinked swatch of its
 *  own; the composer threads the loom as you type. */

import { initHarness } from "../shared/harness.js"
import { loadFixture } from "../shared/fixture.js"
import { renderGuestbook } from "../shared/guestbook.js"
import { esc, words, foldLetters } from "../shared/text.js"
import { seeded } from "../shared/seed.js"
import { clothSVG } from "./weave.js"
import { coverletSVG, coverletCols } from "./coverlet.js"
import { PARAMS, applyPalette } from "./params.js"

/** @import { Entry } from "../shared/fixture.js" */

/** @type {ReturnType<typeof renderGuestbook> | null} */
let page = null
const values = initHarness({
  sketch: "Pattern Book",
  slot: "background: coverlet · card: swatch",
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

/** The letters a swatch was threaded from, word by word. @param {Entry} e */
function threadLine(e) {
  const ws = words(e.message).map(foldLetters).filter(Boolean)
  let out = ""
  for (const w of ws) {
    if (out.length + w.length > 22) break
    out += (out ? "·" : "") + w
  }
  return out || "♥"
}

/** @param {Entry} e */
function swatch(e) {
  const tilt = seeded("tilt" + e.id).range(-4, 4)
  return `<div class="wv-swatch wv-weavable t${Math.round(tilt + 4)}">${clothSVG(e, { ends: Number(values.ends) })}</div>
    <p class="wv-thread">${esc(threadLine(e)).replaceAll("·", "·<wbr>")}</p>`
}

/** @param {HTMLElement} host @param {Entry[]} list */
function band(host, list) {
  const narrow = host.clientWidth < 700
  host.innerHTML = `<div class="cv-frame">${coverletSVG(list, couple, {
    cols: coverletCols(list.length, narrow),
    ends: Number(values.ends),
    links: true,
    fringe: true,
    minSlots: narrow ? 8 : 12,
    fresh,
  })}</div>
    <p class="cv-cap">The coverlet: ${list.length} ${list.length === 1 ? "square" : "squares"}, one woven from each note, framed by a border woven from your names.</p>`
  host.dataset.width = narrow ? "narrow" : "wide"
  if (fresh !== null) {
    const tile = host.querySelector(".is-fresh")
    requestAnimationFrame(() => requestAnimationFrame(() => tile?.classList.add("is-grown")))
  }
}

const mount = /** @type {HTMLElement} */ (document.getElementById("main-content"))
page = renderGuestbook({
  couple,
  entries,
  mount,
  hooks: {
    intro: "Leave us a note and it will be woven into the coverlet. Every word is a run of thread; the cloth is your sentence.",
    bandLabel: "A coverlet with one woven square per note",
    previewLabel: "Your square, threaded letter by letter as you type. Long words weave wide diamonds.",
    band,
    ornament: swatch,
    preview: (d) => `<div class="wv-swatch">${clothSVG(d, { ends: Number(values.ends) })}</div>`,
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
  host.querySelectorAll(".cv-tile.is-lit").forEach((a) => a.classList.remove("is-lit"))
  host.classList.toggle("has-lit", Boolean(card))
  if (card) host.querySelector(`.cv-tile[data-id="${card.dataset.id}"]`)?.classList.add("is-lit")
})
addEventListener("resize", () => {
  const w = host.clientWidth < 700 ? "narrow" : "wide"
  if (w !== host.dataset.width) band(host, entries)
})
