/** @file The Stair — the guestbook as notes hung on threads around a spiral.
 *
 *  CSS 3D only: one preserve-3d list, each note rotated round the axis and
 *  dropped a little lower than the last, so the notes wind down a helix like
 *  a stair. Scrolling turns the helix and walks down it; the note in front
 *  is full size and flat to the reader, the rest turn away and fade into the
 *  room. The backs of the far notes show the signer's name.
 *
 *  It is still a list. The DOM is an ordered list of articles in reading
 *  order; screen readers and the keyboard walk it as a list, and focusing a
 *  note turns the stair to it. Under reduced motion (and in print) the stair
 *  is drawn flat: the same spiral seen from the side, a gentle zig-zag of
 *  notes on one continuous thread.
 *
 *  Optional sound: a note's music-box tune (shared/motif.js) plays from where
 *  it hangs, through an HRTF panner, as it turns to face you.
 */

import { loadEntries, shortDate, esc } from "../shared/data.js"
import { motifFor } from "../shared/motif.js"
import * as box from "../shared/musicbox.js"
import { stillness, wireThemeToggle, carryParams } from "../shared/env.js"

/** @typedef {import("../shared/data.js").Entry} Entry */

const q = new URL(location.href).searchParams
const root = document.documentElement
const scroller = /** @type {HTMLElement} */ (document.getElementById("hx-scroller"))
const helix = /** @type {HTMLElement} */ (document.getElementById("hx-helix"))
const counter = /** @type {HTMLElement} */ (document.getElementById("hx-counter"))
const soundBtn = /** @type {HTMLButtonElement} */ (document.getElementById("hx-sound"))
const flatBtn = /** @type {HTMLButtonElement} */ (document.getElementById("hx-flat"))
const note = /** @type {HTMLElement} */ (document.getElementById("hx-note"))

/** Params (ControlHint shapes in SKETCH.md). */
const P = {
  // Notes per full turn. Phones get fewer, so neighbours swing clear of the front note.
  perTurn: clamp(Number(q.get("perTurn")) || (innerWidth < 640 ? 5 : 7), 4, 14),
  rise: clamp(Number(q.get("rise")) || 70, 20, 160), // px drop per note
  scrollPerNote: 260, // px of page scroll per note
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/** @type {HTMLElement[]} */
let items = []
/** @type {Entry[]} */
let entries = []
let radius = 380
let flat = false
let lastFront = -1

function stepDeg() {
  return 360 / P.perTurn
}

function measureRadius() {
  const w = innerWidth
  radius = w < 640 ? Math.max(190, w * 0.5) : Math.min(460, w * 0.33)
  root.style.setProperty("--hx-radius", radius + "px")
}

/** @param {Entry} e @param {number} i */
function itemMarkup(e, i) {
  const hearts = (e.reactions.heart && e.reactions.heart.count) || 0
  return `<li class="hx-item" data-i="${i}">
    <article class="gb-entry${e.favourite ? " is-favourite" : ""}" tabindex="0" aria-labelledby="hx-a-${e.id}" aria-posinset="${i + 1}" aria-setsize="${entries.length}">
      <div class="hx-face">
        <p class="gb-message">${esc(e.message)}</p>
        <footer class="gb-sig">
          <span class="gb-author" id="hx-a-${e.id}">${esc(e.author_name)}</span>
          <span class="gb-meta">${shortDate(e.created_at)}${hearts ? ` · ♥ ${hearts}` : ""}${e.favourite ? " · favourite" : ""}</span>
        </footer>
      </div>
      <div class="hx-back" aria-hidden="true"><span>${esc(e.author_name)}</span></div>
    </article>
  </li>`
}

function render() {
  helix.innerHTML = entries.map(itemMarkup).join("")
  items = [...helix.querySelectorAll(".hx-item")].map((x) => /** @type {HTMLElement} */ (x))
  items.forEach((el, i) => {
    // Flat mode: the spiral seen from the side is a sine wave.
    el.style.setProperty("--hx-side", Math.sin((i * stepDeg() * Math.PI) / 180).toFixed(3))
    // Every note swings on its own beat (deterministic per position).
    el.style.setProperty("--hx-swing-delay", (-((i * 1.37) % 6)).toFixed(2) + "s")
    el.style.setProperty("--hx-swing-dur", (5.5 + ((i * 0.61) % 2.5)).toFixed(2) + "s")
  })
  const foot = /** @type {HTMLElement} */ (document.getElementById("hx-foot"))
  foot.textContent = `The bottom of the stair · ${entries.length} note${entries.length === 1 ? "" : "s"}`
  layout()
}

function layout() {
  measureRadius()
  scroller.style.setProperty("height", flat ? "auto" : `calc(${Math.max(0, entries.length - 1) * P.scrollPerNote}px + 100vh)`)
  frame()
}

/** Where we are on the stair, in notes (fractional). */
function progress() {
  const top = scroller.getBoundingClientRect().top
  return clamp(-top / P.scrollPerNote, 0, Math.max(0, entries.length - 1))
}

function frame() {
  if (flat) return
  const p = progress()
  const step = stepDeg()
  helix.style.setProperty("transform", `translate3d(0, ${(-p * P.rise).toFixed(1)}px, ${-radius}px) rotateY(${(-p * step).toFixed(2)}deg)`)
  const front = Math.round(p)
  for (let i = 0; i < items.length; i++) {
    const el = items[i]
    const d = i - p
    if (Math.abs(d) > P.perTurn * 1.6) {
      if (!el.classList.contains("is-far")) el.classList.add("is-far")
      continue
    }
    el.classList.remove("is-far")
    const ang = i * step
    el.style.setProperty("transform", `rotateY(${ang.toFixed(2)}deg) translateZ(${radius}px) translateY(${(i * P.rise).toFixed(1)}px)`)
    // Facing: 1 in front, 0 at the side, −1 behind.
    const facing = Math.cos((d * step * Math.PI) / 180)
    const near = 1 - Math.min(1, Math.abs(d) / (P.perTurn * 1.6))
    const op = facing > 0 ? 0.18 + 0.82 * Math.pow(facing, 3) : 0.12 + 0.18 * -facing
    // Opacity on a preserve-3d parent would flatten it (and break the backs),
    // so the faces read it from a custom property instead.
    el.style.setProperty("--hx-op", (op * (0.35 + 0.65 * near)).toFixed(3))
    el.classList.toggle("is-front", i === front)
  }
  counter.textContent = entries.length ? `${front + 1} / ${entries.length}` : ""
  if (front !== lastFront) {
    if (lastFront !== -1 && box.isEnabled() && entries[front]) {
      // The tune comes from where the note hangs: a little to the side it
      // is arriving from, then it settles in front.
      const dir = front > lastFront ? 1 : -1
      box.playMotif(motifFor(entries[front]), { unit: 0.15, velocity: 0.55, position: { x: dir * 0.8, z: -1.2 } })
    }
    lastFront = front
  }
}

/** Scroll so that note i is in front. @param {number} i */
function goTo(i) {
  const idx = clamp(i, 0, entries.length - 1)
  const top = scroller.getBoundingClientRect().top + scrollY + idx * P.scrollPerNote
  scrollTo({ top, behavior: stillness() ? "instant" : "smooth" })
}

/** @param {boolean} on */
function setFlat(on) {
  flat = on
  root.toggleAttribute("data-flat", on)
  flatBtn.setAttribute("aria-pressed", String(on))
  flatBtn.textContent = on ? "◎ Stair" : "☰ Flat"
  if (on) {
    helix.style.removeProperty("transform")
    for (const el of items) {
      el.style.removeProperty("transform")
      el.style.removeProperty("--hx-op")
      el.classList.remove("is-far", "is-front")
    }
  }
  layout()
}

async function main() {
  wireThemeToggle()
  carryParams()
  const data = await loadEntries()
  entries = data.entries
  const c = document.getElementById("hx-couple")
  if (c) c.textContent = data.couple.display

  const still = stillness()
  flat = still || q.get("flat") === "1"
  root.toggleAttribute("data-flat", flat)
  render()
  setFlat(flat)

  if (still) {
    flatBtn.disabled = true
    soundBtn.disabled = true
    note.textContent = "Your device asks for reduced motion, so the stair is drawn flat and stays silent. Every note is here."
    note.hidden = false
  }
  flatBtn.addEventListener("click", () => setFlat(!flat))
  soundBtn.addEventListener("click", () => {
    if (box.isEnabled()) box.disable()
    else box.enable()
    const on = box.isEnabled()
    soundBtn.setAttribute("aria-pressed", String(on))
    soundBtn.textContent = on ? "♪ Sound on" : "♪ Sound off"
  })

  let ticking = false
  addEventListener(
    "scroll",
    () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        frame()
      })
    },
    { passive: true },
  )
  addEventListener("resize", () => layout())

  // Focus turns the stair to the note; arrows step through.
  helix.addEventListener("focusin", (ev) => {
    if (flat) return
    const li = /** @type {HTMLElement} */ (ev.target).closest(".hx-item")
    if (li) goTo(Number(/** @type {HTMLElement} */ (li).dataset.i))
  })
  addEventListener("keydown", (ev) => {
    if (flat || (ev.key !== "ArrowDown" && ev.key !== "ArrowUp")) return
    const tag = /** @type {HTMLElement} */ (ev.target).tagName
    if (tag === "INPUT" || tag === "TEXTAREA") return
    ev.preventDefault()
    const next = clamp(Math.round(progress()) + (ev.key === "ArrowDown" ? 1 : -1), 0, entries.length - 1)
    const art = /** @type {HTMLElement | null} */ (items[next]?.querySelector(".gb-entry"))
    if (art) art.focus({ preventScroll: true })
    goTo(next)
  })
}

void main()
