/** @file tractor-feed sketch — the guestbook as a dot-matrix listing (by day)
 *  and a BBS on a phosphor terminal (by night). */

import { loadFixture, renderEntry, renderFavorite, mountSketchBar } from "../shared/kit.js"
import { dotLine } from "./font57.js"
import { createFanfoldFeed, FANFOLD_DEFAULTS, FANFOLD_HINTS } from "./fanfold-feed.js"
import { createPrintHead, PRINTHEAD_DEFAULTS, PRINTHEAD_HINTS } from "./print-head.js"

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id))

const data = await loadFixture()
const couple = data.couple.display

// Banner: one line wide, stacked on a phone.
const banner = $("tf-banner")
const split = couple.indexOf(" & ")
const lines = split > 0 ? [couple.slice(0, split), couple.slice(split + 1)] : [couple]
banner.insertAdjacentHTML("beforeend", dotLine(couple.toUpperCase(), { className: "tf-banner-wide", strike: 2 }))
banner.insertAdjacentHTML(
  "beforeend",
  `<span class="tf-banner-stack">${lines.map((l) => dotLine(l.toUpperCase(), { strike: 2 })).join("")}</span>`,
)
$("tf-banner-text").textContent = couple

const stamp = data.couple.date.slice(5, 7) + "/" + data.couple.date.slice(8, 10) + "/" + data.couple.date.slice(2, 4)
$("tf-runline").textContent =
  `*** GUESTBK.TXT *** ${data.entries.length} RECORDS *** ${data.couple.location.toUpperCase()} *** ${stamp} ***`
$("tf-count").textContent = String(data.entries.length)

const feed = $("gb-feed")
feed.innerHTML = data.entries.map((e) => renderEntry(e)).join("")
if (data.pinned.length > 0) {
  $("gb-favorites-list").innerHTML = data.pinned.map((e) => renderFavorite(e)).join("")
  $("gb-favorites").hidden = false
}

const background = createFanfoldFeed({})
background.start()
const burst = createPrintHead({})
burst.start()

const form = /** @type {HTMLFormElement} */ ($("gb-composer-form"))
const textarea = /** @type {HTMLTextAreaElement} */ ($("gb-message"))
let nextId = Math.max(0, ...data.entries.map((e) => e.id)) + 1
form.addEventListener("submit", (event) => {
  event.preventDefault()
  const entry = {
    id: nextId++,
    message: textarea.value.trim() || "Ten out of ten. Would attend again.",
    author_name: "Paloma",
    author_trusted: true,
    status: "approved",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    is_own: true,
    reactions: {},
    comment_count: 0,
  }
  feed.insertAdjacentHTML("afterbegin", renderEntry(entry))
  feed.firstElementChild?.classList.add("tf-fresh")
  $("gb-live").textContent = "Your entry was added to the guestbook."
  textarea.value = ""
  burst.fire({ name: entry.author_name })
})

mountSketchBar({
  name: "tractor-feed",
  links: [
    ["guestbook", "./"],
    ["book", "./book.html"],
  ],
  params: [
    { key: "streams", slot: "background", value: FANFOLD_DEFAULTS.streams, hint: FANFOLD_HINTS.streams },
    { key: "speed", slot: "background", value: FANFOLD_DEFAULTS.speed, hint: FANFOLD_HINTS.speed },
    { key: "scanlines", slot: "background", value: FANFOLD_DEFAULTS.scanlines, hint: FANFOLD_HINTS.scanlines },
    { key: "cps", slot: "burst", value: PRINTHEAD_DEFAULTS.cps, hint: PRINTHEAD_HINTS.cps },
    { key: "tear", slot: "burst", value: PRINTHEAD_DEFAULTS.tear },
    { key: "sound", slot: "burst", value: PRINTHEAD_DEFAULTS.sound },
    { key: "dot", slot: "card", value: 0.72, hint: { min: 0.5, max: 1.5, step: 0.05 }, css: "--card-dot" },
    { key: "line", slot: "card", value: 20, hint: { min: 18, max: 28, step: 1 }, css: "--card-line", unit: "px" },
    { key: "phosphor", slot: "card", value: "#46ff7a", css: "--card-phosphor" },
    { key: "bar", slot: "card", value: "#dcefd8", css: "--card-bar" },
  ],
  onParam(def, value) {
    if (def.slot === "background") background.set(def.key, value)
    if (def.slot === "burst") burst.set(def.key, value)
  },
})

if (new URL(location.href).searchParams.get("fire") === "1") burst.fire({ name: "Paloma" })
