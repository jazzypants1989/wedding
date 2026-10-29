/** @file Player Piano — the guestbook as one long punched roll.
 *
 *  Each entry's strip spells the signer's name in notes (shared/motif.js). The
 *  strips butt together into a single roll; a brass tracker bar is fixed in
 *  the viewport, and whatever holes cross it play. So the reader's scroll IS
 *  the crank: scroll slowly and it is a lullaby, flick and it is a glissando,
 *  scroll back up and the tunes play backwards.
 *
 *  Sound is muted until the reader presses "Sound" (or a Play button), and is
 *  unavailable under reduced motion. The visuals (holes lighting as they pass
 *  the bar) run either way, because they are the design, not decoration.
 */

import { loadEntries, shortDate, esc } from "../shared/data.js"
import { motifFor, lettersOf, LANES, MAX_NOTES } from "../shared/motif.js"
import * as box from "../shared/musicbox.js"
import { stillness, wireThemeToggle, carryParams } from "../shared/env.js"

/** @typedef {import("../shared/data.js").Entry} Entry */
/** @typedef {import("../shared/motif.js").Motif} Motif */
/** @typedef {{ el: HTMLElement, svg: SVGSVGElement, motif: Motif, top: number, height: number, on: Set<number> }} Row */

const q = new URL(location.href).searchParams
/** Params, as the slot registry would declare them (see SKETCH.md). */
const PARAMS = {
  scale: q.get("scale") === "pentatonic" ? "pentatonic" : "cryptogram",
  tempo: Math.min(0.4, Math.max(0.08, Number(q.get("tempo")) || 0.16)),
}
const ty = Number(q.get("trackerY"))
if (ty >= 25 && ty <= 60) document.documentElement.style.setProperty("--bg-tracker-y", String(ty))

const feed = /** @type {HTMLElement} */ (document.getElementById("pp-feed"))
const live = /** @type {HTMLElement} */ (document.getElementById("pp-live"))
const tracker = /** @type {HTMLElement} */ (document.getElementById("pp-tracker"))
const soundBtn = /** @type {HTMLButtonElement} */ (document.getElementById("pp-sound"))
const crankBtn = /** @type {HTMLButtonElement} */ (document.getElementById("pp-crank"))
const soundNote = /** @type {HTMLElement} */ (document.getElementById("pp-sound-note"))

/** @type {Row[]} */
let rows = []
/** @type {HTMLElement[]} */
let tines = []
let geom = readGeom()
let trackerPx = 0

function readGeom() {
  const cs = getComputedStyle(document.documentElement)
  return {
    lane: parseFloat(cs.getPropertyValue("--lane-w")) || 11,
    unit: parseFloat(cs.getPropertyValue("--card-unit")) || 10,
    lyric: parseFloat(cs.getPropertyValue("--lyric-w")) || 15,
    perf: parseFloat(cs.getPropertyValue("--perf")) || 13,
  }
}

// ---- Drawing ---------------------------------------------------------------

/**
 * One entry's strip, as SVG. Time runs down (the roll moves up past the bar),
 * lanes run left (low) to right (high), and the letters of the name are
 * printed down the margin like the lyrics on an old word-roll.
 * @param {Motif} m @param {{ minUnits?: number, fresh?: number }} [opts]
 */
function rollSvg(m, opts) {
  const o = opts || {}
  const g = geom
  const w = LANES * g.lane + g.lyric
  const units = Math.max(o.minUnits || 0, m.units)
  const h = units * g.unit + 2
  const hw = g.lane * 0.66
  const rx = Math.min(hw / 2, 3)
  let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" focusable="false">`
  for (const L of [0, 7]) {
    const x = (L + 0.5) * g.lane
    s += `<line class="c-line" x1="${x}" x2="${x}" y1="0" y2="${h}"/>`
  }
  m.notes.forEach((n, i) => {
    const y = n.start * g.unit + 1
    const hh = n.dur * g.unit - 2
    const isNew = o.fresh !== undefined && i >= o.fresh ? " is-new" : ""
    /** @param {number} lane @param {string} cls */
    const hole = (lane, cls) =>
      `<rect class="hole${cls}${isNew}" data-i="${i}" x="${(lane * g.lane + (g.lane - hw) / 2).toFixed(2)}" y="${y}" width="${hw.toFixed(2)}" height="${hh}" rx="${rx}"/>`
    s += hole(n.lane, "")
    for (const c of n.chord) s += hole(c, " is-chord")
    if (n.bell) {
      const bl = n.lane + 7 < LANES ? n.lane + 7 : n.lane - 7
      s += `<circle class="bell" cx="${(bl + 0.5) * g.lane}" cy="${y + g.unit * 0.6}" r="${g.lane * 0.36}"/>`
    }
    s += `<text class="lyric" x="${LANES * g.lane + g.lyric / 2}" y="${y + Math.min(g.unit, hh) * 0.82}" text-anchor="middle">${n.letter}</text>`
  })
  return s + "</svg>"
}

/**
 * The visible name, one span per letter, each tagged with the note it sings.
 * Screen readers get the plain name from the sr-only copy instead.
 * @param {string} name
 */
function singingName(name) {
  let k = 0
  let out = ""
  for (const ch of name) {
    const n = lettersOf(ch).length
    if (n > 0 && k < MAX_NOTES) {
      out += `<span data-i="${k}">${esc(ch)}</span>`
      k += n
    } else out += esc(ch)
  }
  return `<span class="sr-only">${esc(name)}</span><span aria-hidden="true">${out}</span>`
}

/** @param {Entry} e @param {number} pos @param {number} size */
function entryMarkup(e, pos, size) {
  const m = motifFor(e, { scale: /** @type {"cryptogram"} */ (PARAMS.scale) })
  const hearts = (e.reactions.heart && e.reactions.heart.count) || 0
  const name = esc(e.author_name)
  return {
    motif: m,
    html: `<article class="gb-entry${e.favourite ? " is-favourite" : ""}" data-id="${e.id}" aria-labelledby="a-${e.id}" aria-posinset="${pos}" aria-setsize="${size}" tabindex="-1">
  <div class="roll-strip" aria-hidden="true"><div class="roll-lanes">${rollSvg(m)}</div></div>
  <div class="gb-body">
    <header class="gb-head">
      <span class="gb-author" id="a-${e.id}">${singingName(e.author_name)}</span>
      ${e.favourite ? `<span class="gb-fav">Favourite</span>` : ""}
      <time class="gb-time" datetime="${esc(e.created_at)}">${shortDate(e.created_at)}</time>
    </header>
    <p class="gb-message">${esc(e.message)}</p>
    <footer class="gb-foot">
      <p class="roll-spelled"><span class="sr-only">${name}, spelled in notes: ${m.spelled}</span><span aria-hidden="true">${m.notes.map((n, i) => `<span data-i="${i}">${n.name}</span>`).join(" ")}</span></p>
      ${hearts ? `<span class="gb-hearts" aria-label="${hearts} hearts">♥ ${hearts}</span>` : ""}
      <button type="button" class="roll-play" data-play aria-label="Play ${name}’s tune">▶ Play</button>
    </footer>
  </div>
</article>`,
  }
}

/** @type {Entry[]} */
let entries = []
/** @type {Map<number, Motif>} */
const motifs = new Map()

function renderFeed() {
  geom = readGeom()
  let html = ""
  entries.forEach((e, i) => {
    const { motif, html: h } = entryMarkup(e, i + 1, entries.length)
    motifs.set(e.id, motif)
    html += h
  })
  feed.innerHTML = html
  feed.setAttribute("aria-busy", "false")
  const total = entries.reduce((sum, e) => sum + (motifs.get(e.id)?.units || 0), 0)
  const secs = Math.round(total * PARAMS.tempo)
  const end = /** @type {HTMLElement} */ (document.getElementById("pp-end"))
  end.innerHTML = `<span class="roll-strip" aria-hidden="true"></span><span>End of the roll · ${entries.length} tunes · ${Math.floor(secs / 60)} min ${secs % 60} s of music</span>`
  end.hidden = false
  measure()
}

function measure() {
  rows = []
  for (const el of feed.querySelectorAll(".gb-entry")) {
    const article = /** @type {HTMLElement} */ (el)
    const svg = /** @type {SVGSVGElement} */ (article.querySelector("svg"))
    const motif = motifs.get(Number(article.dataset.id))
    if (!svg || !motif) continue
    const r = svg.getBoundingClientRect()
    rows.push({ el: article, svg, motif, top: r.top + scrollY, height: r.height, on: new Set() })
  }
  const first = /** @type {HTMLElement | null} */ (feed.querySelector(".roll-strip"))
  const left = first ? first.getBoundingClientRect().left : 0
  tracker.style.setProperty("--tracker-x", left + "px")
  trackerPx = tracker.getBoundingClientRect().top
  buildTines()
}

function buildTines() {
  if (tines.length === LANES && tines[0].isConnected) {
    tines.forEach((t, lane) => t.style.setProperty("left", geom.perf + (lane + 0.5) * geom.lane + "px"))
    return
  }
  tines = []
  for (let lane = 0; lane < LANES; lane++) {
    const t = document.createElement("span")
    t.className = "pp-tine"
    t.style.setProperty("left", geom.perf + (lane + 0.5) * geom.lane + "px")
    tracker.appendChild(t)
    tines.push(t)
  }
}

// ---- The tracker: crossings play, the hole under the bar lights ------------

/** First row whose bottom is below y. @param {number} y */
function rowIndexAt(y) {
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].top + rows[mid].height < y) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Play every hole whose top edge the bar crossed between a and b. @param {number} a @param {number} b */
function crossings(a, b) {
  for (let i = rowIndexAt(a); i < rows.length && rows[i].top <= b; i++) {
    const row = rows[i]
    for (const n of row.motif.notes) {
      const y = row.top + n.start * geom.unit + 1
      if (y > a && y <= b) {
        box.pluck(n.lane)
        for (const c of n.chord) box.pluck(c, { velocity: 0.45 })
        if (n.bell) box.pluck(n.lane + 7, { velocity: 0.4, decay: 3 })
      }
    }
  }
}

/** @type {Row | null} */
let current = null

/** Light the holes the bar is inside right now, and the tines above them. @param {number} y */
function underBar(y) {
  const i = rowIndexAt(y)
  const row = rows[i] && rows[i].top <= y ? rows[i] : null
  if (current && current !== row) {
    current.el.classList.remove("is-playing")
    for (const r of current.el.querySelectorAll(".is-on")) r.classList.remove("is-on")
    current.on.clear()
  }
  current = row
  /** @type {Set<number>} */
  const lanes = new Set()
  if (row) {
    const local = (y - row.top - 1) / geom.unit
    row.el.classList.toggle("is-playing", local >= 0 && local <= row.motif.units)
    row.motif.notes.forEach((n, idx) => {
      const inside = local >= n.start && local < n.start + n.dur
      if (inside) {
        lanes.add(n.lane)
        for (const c of n.chord) lanes.add(c)
      }
      if (inside !== row.on.has(idx)) {
        for (const r of row.el.querySelectorAll(`[data-i="${idx}"]`)) r.classList.toggle("is-on", inside)
        if (inside) row.on.add(idx)
        else row.on.delete(idx)
      }
    })
  }
  tines.forEach((t, lane) => t.classList.toggle("is-on", lanes.has(lane)))
}

/** @type {number | null} */
let lastBar = null
let ticking = false
function onScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(() => {
    ticking = false
    const bar = scrollY + trackerPx
    if (lastBar !== null) {
      const a = Math.min(lastBar, bar)
      const b = Math.max(lastBar, bar)
      // A jump (End key, anchor link) is a teleport, not a glissando.
      if (b > a && b - a < innerHeight * 1.5) crossings(a, b)
    }
    lastBar = bar
    underBar(bar)
  })
}

// ---- Controls ----------------------------------------------------------------

function syncSound() {
  const on = box.isEnabled()
  soundBtn.setAttribute("aria-pressed", String(on))
  soundBtn.textContent = on ? "♪ Sound on" : "♪ Sound off"
}

function setupSound() {
  if (!box.canPlay()) {
    soundBtn.disabled = true
    crankBtn.disabled = true
    soundNote.textContent = "Sound and the crank are off because this device asks for reduced motion. The roll is all still here."
    soundNote.hidden = false
    document.documentElement.classList.add("pp-silent")
    for (const b of document.querySelectorAll("[data-play]")) /** @type {HTMLElement} */ (b).hidden = true
    return
  }
  soundBtn.addEventListener("click", () => {
    if (box.isEnabled()) box.disable()
    else box.enable()
    syncSound()
  })
}

/** Play one entry's tune in place, lighting its holes in time. @param {HTMLElement} article */
function playEntry(article) {
  if (!box.isEnabled() && !box.enable()) return
  syncSound()
  const motif = motifs.get(Number(article.dataset.id))
  if (!motif) return
  const secs = box.playMotif(motif, { unit: PARAMS.tempo })
  article.classList.add("is-playing")
  motif.notes.forEach((n, idx) => {
    const els = article.querySelectorAll(`[data-i="${idx}"]`)
    setTimeout(() => els.forEach((r) => r.classList.add("is-on")), n.start * PARAMS.tempo * 1000)
    setTimeout(() => els.forEach((r) => r.classList.remove("is-on")), (n.start + n.dur) * PARAMS.tempo * 1000)
  })
  setTimeout(() => article.classList.remove("is-playing"), secs * 1000 + 200)
}

let cranking = false
function stopCrank() {
  cranking = false
  crankBtn.setAttribute("aria-pressed", "false")
  crankBtn.textContent = "⟳ Crank"
}
function startCrank() {
  if (stillness()) return
  if (!box.isEnabled()) box.enable()
  syncSound()
  cranking = true
  crankBtn.setAttribute("aria-pressed", "true")
  crankBtn.textContent = "■ Stop"
  // One eighth of roll per `tempo` seconds: the music plays at its written speed.
  const speed = geom.unit / PARAMS.tempo
  let last = performance.now()
  let carry = 0
  /** @param {number} t */
  const step = (t) => {
    if (!cranking) return
    carry += ((t - last) / 1000) * speed
    last = t
    const whole = Math.floor(carry)
    if (whole > 0) {
      scrollBy(0, whole)
      carry -= whole
    }
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) return stopCrank()
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// ---- Composer: the burst slot ("punch") ------------------------------------

const nameIn = /** @type {HTMLInputElement} */ (document.getElementById("pp-name"))
const msgIn = /** @type {HTMLTextAreaElement} */ (document.getElementById("pp-msg"))
const compSvg = /** @type {HTMLElement} */ (document.getElementById("pp-composer-svg"))
const compSpelled = /** @type {HTMLElement} */ (document.getElementById("pp-composer-spelled"))
let lastCount = 0

/** The burst: `fire({ name, message })`. Punches any new holes and sounds them. */
function fire(/** @type {{ name: string, message: string }} */ detail) {
  const m = motifFor({ author_name: detail.name, message: detail.message }, { scale: /** @type {"cryptogram"} */ (PARAMS.scale) })
  const fresh = m.notes.length > lastCount ? lastCount : undefined
  compSvg.innerHTML = detail.name.trim() ? rollSvg(m, { minUnits: 14, fresh: stillness() ? undefined : fresh }) : rollSvg({ notes: [], units: 14, spelled: "", hearts: 0, favourite: false })
  compSpelled.textContent = detail.name.trim() ? m.spelled : ""
  if (fresh !== undefined && box.isEnabled()) {
    box.punch()
    const n = m.notes[m.notes.length - 1]
    if (n) box.pluck(n.lane, { velocity: 0.6 })
  }
  lastCount = m.notes.length
}

function setupComposer() {
  fire({ name: "", message: "" })
  nameIn.addEventListener("input", () => fire({ name: nameIn.value, message: msgIn.value }))
  msgIn.addEventListener("input", () => {
    lastCount = Infinity // rhythm changes are not new punches
    fire({ name: nameIn.value, message: msgIn.value })
  })
  const form = /** @type {HTMLFormElement} */ (document.getElementById("pp-composer"))
  form.addEventListener("submit", (ev) => {
    ev.preventDefault()
    const name = nameIn.value.trim()
    const message = msgIn.value.trim()
    if (!name || !message) {
      ;(name ? msgIn : nameIn).focus()
      return
    }
    const now = new Date()
    const p = (/** @type {number} */ n) => (n < 10 ? "0" + n : String(n))
    entries.unshift({
      id: Date.now(),
      author_name: name,
      message,
      created_at: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:00`,
      reactions: {},
      comment_count: 0,
      favourite: false,
    })
    renderFeed()
    nameIn.value = ""
    msgIn.value = ""
    lastCount = 0
    fire({ name: "", message: "" })
    live.textContent = `Signed. Your name is now a tune at the top of the roll.`
    const first = /** @type {HTMLElement} */ (feed.querySelector(".gb-entry"))
    first.focus({ preventScroll: true })
    if (box.isEnabled()) playEntry(first)
  })
}

// ---- Boot --------------------------------------------------------------------

async function main() {
  wireThemeToggle()
  carryParams()
  const data = await loadEntries()
  entries = data.entries
  const coupleEl = document.getElementById("pp-couple")
  if (coupleEl) coupleEl.textContent = data.couple.display
  renderFeed()
  setupSound()
  setupComposer()
  syncSound()

  feed.addEventListener("click", (ev) => {
    const btn = /** @type {HTMLElement} */ (ev.target).closest("[data-play]")
    if (btn) playEntry(/** @type {HTMLElement} */ (btn.closest(".gb-entry")))
  })
  crankBtn.addEventListener("click", () => (cranking ? stopCrank() : startCrank()))
  for (const evt of ["wheel", "touchstart", "keydown"]) addEventListener(evt, () => cranking && stopCrank(), { passive: true })

  addEventListener("scroll", onScroll, { passive: true })
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resizeT
  addEventListener("resize", () => {
    clearTimeout(resizeT)
    resizeT = setTimeout(() => {
      const before = geom.unit + "," + geom.lane
      geom = readGeom()
      if (before !== geom.unit + "," + geom.lane) renderFeed()
      else measure()
      fire({ name: nameIn.value, message: msgIn.value })
      lastBar = null
      onScroll()
    }, 120)
  })
  void document.fonts.ready.then(() => {
    measure()
    onScroll()
  })
  onScroll()
}

void main()
