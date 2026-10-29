/** @file guestbook.cgi sketch — the guestbook page. Wires the fixture into the
 *  real feed markup, starts the background effect, fires the burst on sign. */

import { loadFixture, renderEntry, renderFavorite, mountSketchBar, reducedMotion } from "../shared/kit.js"
import { createTiled1999, TILED_DEFAULTS, TILED_HINTS } from "./tiled-1999.js"
import { createThanksForSigning, THANKS_DEFAULTS, THANKS_HINTS } from "./thanks-burst.js"
import { heart, sign, envelope } from "./sprites.js"
import { wordart } from "./wordart.js"
import { playCanon } from "./midi.js"

/** @param {string} id */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id))

const data = await loadFixture()
const couple = data.couple.display

// ---- furniture ----
$("cgi-wordart").insertAdjacentHTML("beforeend", wordart(`${couple}'s`, "WEDDING GUESTBOOK", "wa"))
$("cgi-title-text").textContent = `${couple}'s Wedding Guestbook`
for (const id of ["cgi-heart-l", "cgi-heart-r", "cgi-ring-heart", "cgi-ring-heart2", "b88-heart"]) {
  $(id).innerHTML = heart()
}
$("cgi-sign-l").innerHTML = sign()
$("cgi-sign-r").innerHTML = sign()
$("cgi-mail").innerHTML = envelope()
$("cgi-updated").textContent = data.entries.length
  ? new Date(data.entries[0].created_at.replace(" ", "T")).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })
  : "April 26, 2026"

/** @param {number} n */
function paintCounter(n) {
  const digits = String(n).padStart(6, "0")
  const el = $("cgi-odometer")
  el.setAttribute("aria-label", `${n} times`)
  el.innerHTML = ""
  for (const d of digits) {
    const span = document.createElement("span")
    span.className = "cgi-digit"
    span.setAttribute("aria-hidden", "true")
    span.textContent = d
    el.appendChild(span)
  }
}
let count = data.entries.length
paintCounter(count)

// ---- feed (the card slot reads only data-gb-card + real markup) ----
const feed = $("gb-feed")
feed.innerHTML = data.entries.map((e) => renderEntry(e)).join("")
if (data.pinned.length > 0) {
  $("gb-favorites-list").innerHTML = data.pinned.map((e) => renderFavorite(e)).join("")
  $("gb-favorites").hidden = false
}

// ---- slots: background + burst ----
const background = createTiled1999({})
background.start()
const burst = createThanksForSigning({})
burst.start()

// ---- sign ----
const form = /** @type {HTMLFormElement} */ ($("gb-composer-form"))
const textarea = /** @type {HTMLTextAreaElement} */ ($("gb-message"))
let nextId = Math.max(0, ...data.entries.map((e) => e.id)) + 1
form.addEventListener("submit", (event) => {
  event.preventDefault()
  const message = textarea.value.trim() || "What a day. Love you both!"
  const now = new Date().toISOString().slice(0, 19).replace("T", " ")
  const entry = {
    id: nextId++,
    message,
    author_name: "Paloma",
    author_trusted: true,
    status: "approved",
    created_at: now,
    is_own: true,
    reactions: {},
    comment_count: 0,
  }
  feed.insertAdjacentHTML("afterbegin", renderEntry(entry))
  const fresh = /** @type {HTMLElement} */ (feed.firstElementChild)
  fresh.classList.add("cgi-fresh")
  paintCounter(++count)
  $("gb-live").textContent = "Your entry was added to the guestbook."
  textarea.value = ""
  burst.fire({ name: entry.author_name, id: entry.id })
})

// ---- canon_in_d.mid ----
const play = /** @type {HTMLButtonElement} */ ($("cgi-midi-play"))
const stopBtn = /** @type {HTMLButtonElement} */ ($("cgi-midi-stop"))
/** @type {ReturnType<typeof playCanon>} */
let playing = null
/** @type {ReturnType<typeof setInterval> | undefined} */
let clock
if (reducedMotion()) {
  play.disabled = true
  stopBtn.disabled = true
  $("cgi-midi-note").textContent = "sound is off (reduced motion)"
}
play.addEventListener("click", () => {
  if (playing) return
  playing = playCanon(1)
  if (!playing) return
  $("cgi-midi-note").textContent = "♫ now playing"
  clock = setInterval(() => {
    if (!playing) return
    const s = Math.floor(playing.elapsed())
    $("cgi-midi-time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
  }, 500)
})
stopBtn.addEventListener("click", () => {
  if (playing) playing.stop()
  playing = null
  clearInterval(clock)
  $("cgi-midi-time").textContent = "0:00"
  $("cgi-midi-note").textContent = "stopped"
})

// ---- sketch bar ----
const root = document.documentElement
mountSketchBar({
  name: "guestbook-cgi",
  links: [
    ["guestbook", "./"],
    ["book", "./book.html"],
  ],
  params: [
    { key: "tile", slot: "background", value: TILED_DEFAULTS.tile, hint: TILED_HINTS.tile },
    { key: "scale", slot: "background", value: TILED_DEFAULTS.scale, hint: TILED_HINTS.scale },
    { key: "twinkle", slot: "background", value: TILED_DEFAULTS.twinkle, hint: TILED_HINTS.twinkle },
    { key: "contrast", slot: "background", value: TILED_DEFAULTS.contrast, hint: TILED_HINTS.contrast },
    { key: "hearts", slot: "burst", value: THANKS_DEFAULTS.hearts, hint: THANKS_HINTS.hearts },
    { key: "sound", slot: "burst", value: THANKS_DEFAULTS.sound },
    { key: "palette", slot: "card", value: "theme", hint: { options: ["theme", "netscape", "angelfire"] } },
    { key: "font", slot: "card", value: "times", hint: { options: ["times", "verdana", "comic"] } },
    { key: "bevel", slot: "card", value: 2, hint: { min: 1, max: 4, step: 1 }, css: "--card-bevel" },
    { key: "labelWidth", slot: "card", value: 6.5, hint: { min: 4, max: 9, step: 0.5 }, css: "--card-label-w", unit: "em" },
  ],
  onParam(def, value) {
    if (def.slot === "background") background.set(def.key, value)
    if (def.slot === "burst") burst.set(def.key, value)
    if (def.key === "palette") root.dataset.cgiPalette = String(value)
    if (def.key === "font") root.dataset.cgiFont = String(value)
  },
})

// `?palette=netscape` for screenshots.
const palette = new URL(location.href).searchParams.get("palette")
if (palette) root.dataset.cgiPalette = palette
if (new URL(location.href).searchParams.get("fire") === "1") {
  burst.fire({ name: "Paloma", id: 999 })
}
