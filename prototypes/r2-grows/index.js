/** @file Index: one fictional note rendered by all three generators. */

import { loadFixture } from "./shared/fixture.js"
import { esc } from "./shared/text.js"
import { plantSVG } from "./herbarium/plant.js"
import { clothSVG } from "./pattern-book/weave.js"
import { islandChart } from "./archipelago/island.js"

const q = new URLSearchParams(location.search)
let theme = "light"
try {
  theme = localStorage.getItem("theme") || "light"
} catch {}
document.documentElement.dataset.theme = q.get("dark") === "1" ? "dark" : theme

const { entries } = await loadFixture()
const note = entries.find((e) => e.author_name === "Grandma June") || entries[0]
const set = (/** @type {string} */ id, /** @type {string} */ html) => {
  const el = document.getElementById(id)
  if (el) el.innerHTML = html
}
set("ix-note", `“${esc(note.message)}” <cite>— ${esc(note.author_name)}</cite>`)
set("ix-plant", plantSVG(note, { leafScale: 1.25, minW: 90 }))
set("ix-cloth", `<div class="ix-swatch">${clothSVG(note)}</div>`)
set("ix-isle", islandChart(note))
