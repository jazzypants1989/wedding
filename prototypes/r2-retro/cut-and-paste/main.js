/** @file cut-and-paste sketch — the guestbook page as a photocopied zine. */

import { loadFixture, renderEntry, renderFavorite, mountSketchBar } from "../shared/kit.js"
import { ransom } from "./ransom.js"
import { createXerox, XEROX_DEFAULTS, XEROX_HINTS } from "./xerox.js"
import { createPhotocopy, PHOTOCOPY_DEFAULTS, PHOTOCOPY_HINTS } from "./photocopy-burst.js"

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id))

const data = await loadFixture()

ransom($("zine-title"), "Guestbook", "mast")
ransom($("zine-letters"), "Letters", "letters")
const [y, m, d] = data.couple.date.split("-")
const month = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleString("en-US", { month: "long" })
$("zine-issue").textContent =
  `Issue #1 · ${month} ${Number(d)} ${y} · ${data.couple.location.replaceAll(",", "")} · ${data.entries.length} letters · free / take one`

const feed = $("gb-feed")
feed.innerHTML = data.entries.map((e) => renderEntry(e)).join("")
if (data.pinned.length > 0) {
  $("gb-favorites-list").innerHTML = data.pinned.map((e) => renderFavorite(e)).join("")
  $("gb-favorites").hidden = false
}

const background = createXerox({})
background.start()
const burst = createPhotocopy({})
burst.start()

const form = /** @type {HTMLFormElement} */ ($("gb-composer-form"))
const textarea = /** @type {HTMLTextAreaElement} */ ($("gb-message"))
let nextId = Math.max(0, ...data.entries.map((e) => e.id)) + 1
form.addEventListener("submit", (event) => {
  event.preventDefault()
  const entry = {
    id: nextId++,
    message: textarea.value.trim() || "Best party of the year. You two are the real deal.",
    author_name: "Paloma",
    author_trusted: true,
    status: "approved",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    is_own: true,
    reactions: {},
    comment_count: 0,
  }
  feed.insertAdjacentHTML("afterbegin", renderEntry(entry))
  feed.firstElementChild?.classList.add("zine-fresh")
  $("gb-live").textContent = "Your letter was added to the guestbook."
  textarea.value = ""
  burst.fire({ name: entry.author_name })
})

mountSketchBar({
  name: "cut-and-paste",
  links: [
    ["guestbook", "./"],
    ["zine", "./book.html"],
  ],
  params: [
    { key: "grain", slot: "background", value: XEROX_DEFAULTS.grain, hint: XEROX_HINTS.grain },
    { key: "streaks", slot: "background", value: XEROX_DEFAULTS.streaks, hint: XEROX_HINTS.streaks },
    { key: "lid", slot: "background", value: XEROX_DEFAULTS.lid, hint: XEROX_HINTS.lid },
    { key: "negative", slot: "background", value: XEROX_DEFAULTS.negative },
    { key: "sweep", slot: "burst", value: PHOTOCOPY_DEFAULTS.sweep, hint: PHOTOCOPY_HINTS.sweep },
    { key: "stamp", slot: "burst", value: PHOTOCOPY_DEFAULTS.stamp, hint: PHOTOCOPY_HINTS.stamp },
    { key: "sound", slot: "burst", value: PHOTOCOPY_DEFAULTS.sound },
    { key: "marker", slot: "card", value: "#7c3b30", css: "--card-marker" },
    { key: "tilt", slot: "card", value: 1, hint: { min: 0, max: 2.5, step: 0.25 }, css: "--card-tilt" },
    { key: "type", slot: "card", value: 1, hint: { min: 0.85, max: 1.3, step: 0.05 }, css: "--card-type", unit: "rem" },
    { key: "cols", slot: "card", value: 19, hint: { min: 14, max: 40, step: 1 }, css: "--card-cols", unit: "rem" },
  ],
  onParam(def, value) {
    if (def.slot === "background") background.set(def.key, value)
    if (def.slot === "burst") burst.set(def.key, value)
  },
})
// The marker param above is a swatch; leave the token default in force until it is touched.
document.documentElement.style.removeProperty("--card-marker")

if (new URL(location.href).searchParams.get("fire") === "1") burst.fire({ name: "Paloma" })
