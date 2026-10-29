/** @file cut-and-paste sketch — the memory book as a fold-and-staple zine. */

import { loadFixture, renderBook, mountSketchBar, query } from "../shared/kit.js"
import { decorate, howTo } from "./zine-a5.js"

const data = await loadFixture()
document.getElementById("mb-entries")?.insertAdjacentHTML("beforeend", renderBook(data.entries, data.pinned))
const status = document.getElementById("mb-status")
if (status) status.hidden = true
document.getElementById("mb-print")?.addEventListener("click", () => window.print())

/** @type {import("./zine-a5.js").ZineContext} */
const ctx = {
  couple: data.couple.display,
  date: data.couple.date,
  location: data.couple.location,
  total: data.entries.length,
  paper: query("paper") === "a4" ? "a4" : "letter",
  mode: query("print") === "pages" ? "pages" : "booklet",
}
const result = decorate(document.documentElement, ctx)
howTo(ctx, result)

// Fit the spreads to narrow screens. Measured pagination already happened, so
// zoom only changes how big the pages look, never what is on them.
const reading = /** @type {HTMLElement} */ (document.querySelector(".zine-reading"))
function fit() {
  const page = /** @type {HTMLElement | null} */ (reading.querySelector(".zp"))
  if (!page) return
  const wide = innerWidth >= 900
  const need = page.offsetWidth * (wide ? 2 : 1) + 32
  reading.style.setProperty("zoom", String(Math.min(1, innerWidth / need)))
}
fit()
addEventListener("resize", fit)

mountSketchBar({
  name: "zine-a5",
  links: [
    ["guestbook", "./"],
    ["zine", "./book.html"],
  ],
  params: [
    { key: "paper", slot: "book", value: ctx.paper, hint: { options: ["letter", "a4"] }, note: "re-paginates" },
    { key: "print", slot: "book", value: ctx.mode, hint: { options: ["booklet", "pages"] } },
    { key: "tilt", slot: "book", value: 1, hint: { min: 0, max: 2.5, step: 0.25 }, css: "--mb-tilt" },
    { key: "toner", slot: "book", value: 1, hint: { min: 0, max: 1, step: 0.1 }, css: "--mb-toner" },
  ],
  onParam(def, value) {
    if (def.key === "paper" || def.key === "print") {
      const url = new URL(location.href)
      url.searchParams.set(def.key, String(value))
      location.href = url.pathname + url.search
    }
  },
})
