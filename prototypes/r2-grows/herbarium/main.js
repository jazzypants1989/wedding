/** @file Herbarium — guestbook view. The background slot is a meadow grown from
 *  every note (oldest at the back); each card carries its own plant; the
 *  composer grows yours as you type. */

import { initHarness, reduced } from "../shared/harness.js"
import { loadFixture } from "../shared/fixture.js"
import { renderGuestbook } from "../shared/guestbook.js"
import { seeded, f } from "../shared/seed.js"
import { esc } from "../shared/text.js"
import { growPlant, plantSVG } from "./plant.js"
import { PARAMS, applyPalette, growOpts } from "./params.js"

/** @import { Entry } from "../shared/fixture.js" */

let opts = growOpts(Object.fromEntries(Object.entries(PARAMS).map(([k, p]) => [k, p.value])))
/** @type {ReturnType<typeof renderGuestbook> | null} */
let page = null

const values = initHarness({
  sketch: "Herbarium",
  slot: "background: meadow · card: specimen",
  view: "guestbook",
  links: { guestbook: "./", book: "./book.html" },
  params: PARAMS,
  onParams(v) {
    applyPalette(v)
    opts = growOpts(v)
    page?.refresh()
  },
})
applyPalette(values)

/** Lay every plant into a meadow: rows recede (smaller, paler), oldest at the
 *  back, so the garden visibly fills in as the week goes on.
 *  @param {HTMLElement} host @param {Entry[]} entries */
function meadow(host, entries) {
  const narrow = host.clientWidth < 700
  const W = narrow ? 700 : 1400
  const H = narrow ? 330 : 300
  const n = entries.length
  const rows = n <= (narrow ? 6 : 12) ? 1 : n <= (narrow ? 20 : 40) ? 2 : Math.ceil(Math.sqrt(n / (narrow ? 2.5 : 4)))
  const perRow = Math.ceil(n / rows)
  const slot = W / Math.max(perRow, narrow ? 4 : 7)
  const base = Math.min(1.45, slot / 50)
  const front = H - 22
  const gap = rows > 1 ? Math.min(62, (H - 170) / (rows - 1)) : 0
  const oldestFirst = entries.slice().reverse()
  const fresh = host.dataset.ready === "1" && !reduced() ? entries[0]?.id : null

  let out = ""
  for (let r = 0; r < rows; r++) {
    const depth = rows === 1 ? 1 : 0.5 + (0.5 * r) / (rows - 1)
    const y = front - (rows - 1 - r) * gap
    const inRow = oldestFirst.slice(r * perRow, (r + 1) * perRow)
    const span = inRow.length * slot
    const x0 = (W - span) / 2 + (r % 2 ? slot * 0.25 : 0)
    let row = ""
    inRow.forEach((e, i) => {
      const s = seeded("meadow" + e.id)
      const x = x0 + (i + 0.5) * slot + s.range(-0.28, 0.28) * slot
      const sc = base * depth * s.range(0.88, 1.08)
      const p = growPlant(e, opts)
      const grownCls = e.id === fresh ? "hb-m is-fresh" : "hb-m is-grown"
      row += `<a href="#e-${e.id}" class="${grownCls}" data-id="${e.id}" aria-label="${esc(e.author_name)}'s plant"><g transform="translate(${f(x)} ${f(y)}) scale(${f(sc)})">${p.markup}</g></a>`
    })
    out += `<g class="hb-row hb-depth${Math.round(depth * 4)}">${row}</g>`
  }
  // "Room to grow": a near-empty garden shows its waiting plots, not a void.
  let plots = ""
  if (n < 8) {
    for (let i = 0; i < 8 - n; i++) {
      const s = seeded("plot" + i)
      const x = (W * (i + 0.5)) / (8 - n) + s.range(-20, 20)
      plots += `<g class="hb-plot" transform="translate(${f(x)} ${front})"><path d="M-9 0Q0 -6 9 0"/><path d="M0 -3L0 -16M-4 -16L4 -16"/></g>`
    }
  }
  const ground = `<path class="hb-ground" d="M0 ${front - 4}C${W * 0.25} ${front - 14} ${W * 0.6} ${front + 6} ${W} ${front - 8}L${W} ${H}L0 ${H}Z"/>`
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" class="hb-meadow">${ground}${plots}${out}</svg>
    <p class="hb-meadow-cap">${n} ${n === 1 ? "note" : "notes"}, ${n} ${n === 1 ? "plant" : "plants"} — tap one to find its note.</p>`
  host.dataset.ready = "1"
  host.dataset.width = narrow ? "narrow" : "wide"
  if (fresh !== null) {
    requestAnimationFrame(() => requestAnimationFrame(() => host.querySelector(".is-fresh")?.classList.add("is-grown")))
  } else if (!reduced() && !host.dataset.grownOnce) {
    // First arrival: the meadow grows row by row, back to front.
    host.querySelectorAll(".hb-m").forEach((a) => a.classList.remove("is-grown"))
    host.dataset.grownOnce = "1"
    host.querySelectorAll(".hb-row").forEach((g, r) => {
      setTimeout(() => g.querySelectorAll(".hb-m").forEach((a) => a.classList.add("is-grown")), 120 + r * 160)
    })
  }
}

const { couple, entries } = await loadFixture()
const mount = /** @type {HTMLElement} */ (document.getElementById("main-content"))
page = renderGuestbook({
  couple,
  entries,
  mount,
  hooks: {
    card: "default",
    intro: "Leave us a note — it will grow into something. Every sentence is a branch; end one with <b>!</b> and it blooms.",
    bandLabel: "A meadow with one plant grown from each note",
    previewLabel: "Your plant grows as you write: sentences branch, words leaf, ! blooms, ? buds.",
    band: meadow,
    ornament: (e) => plantSVG(e, { ...opts, minW: 70 }),
    preview: (d) => plantSVG(d, { ...opts, minW: 70 }),
    fire(e, card) {
      card.classList.add("hb-new")
    },
  },
})

// Hovering a note lights its plant in the meadow.
const band = /** @type {HTMLElement} */ (mount.querySelector(".gx-band"))
mount.addEventListener("pointerover", (ev) => {
  const card = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest(".gb-entry"))
  const id = card ? card.dataset.id : null
  band.classList.toggle("has-lit", Boolean(id))
  band.querySelectorAll(".hb-m.is-lit").forEach((a) => a.classList.remove("is-lit"))
  if (id) band.querySelector(`.hb-m[data-id="${id}"]`)?.classList.add("is-lit")
})

let lastWidth = band.dataset.width
addEventListener("resize", () => {
  const w = band.clientWidth < 700 ? "narrow" : "wide"
  if (w !== lastWidth) {
    lastWidth = w
    meadow(band, entries)
  }
})
