/** @file The Long Day — the guestbook folded onto one 24-hour day.
 *
 *  Entries are ordered by the minute they were written, whatever the date, so
 *  scrolling the page is a day passing: the 3 am notes, the noon notes, the
 *  ones written in the car home. The page opens at the visitor's own hour,
 *  and a "now" thread marks where they are among the guests.
 *
 *  card `sundial`  : every card is lit by the sun as it stood over the venue
 *                    when that note was written (shared/sun.js): a long gold
 *                    shadow at 7 pm, a short one at noon, lamplight at 3 am.
 *                    Deterministic per entry, so it prints the same way.
 *  background `daylight` : the sky behind the page follows the hour being
 *                    read; the sun or moon tracks across it.
 *  Time effects (from the visitor's clock, or ?at=):
 *    - the ink ages: fresh this year, browner each anniversary (iron-gall ink
 *      really does this), never less legible than AA;
 *    - the accent takes the traditional anniversary material;
 *    - on the anniversary itself the notes write themselves in again, and a
 *      note written on this day a year ago at this hour is pointed out.
 */

import { loadEntries, wallClock, clockLabel, shortDate, esc } from "../shared/data.js"
import { sunAt, shadowOf, canonicalHour, HOURS } from "../shared/sun.js"
import { readNow, marriedFor, presets, formatAt, daysBetween, parseAt } from "../shared/clock.js"
import { stillness, wireThemeToggle, carryParams } from "../shared/env.js"

/** @typedef {import("../shared/data.js").Entry} Entry */

const root = document.documentElement
const dayEl = /** @type {HTMLElement} */ (document.getElementById("hr-day"))
const sky = /** @type {HTMLElement} */ (document.getElementById("hr-sky"))
const orb = /** @type {HTMLElement} */ (document.getElementById("hr-orb"))
const now = readNow()

// ---- Sky ---------------------------------------------------------------------

/** Sky stops: [hour, zenith, horizon]. Mixed with the theme background in CSS. */
const SKY = [
  [0, "#0b1030", "#1b2150"],
  [4, "#141a40", "#33305e"],
  [5.5, "#39477a", "#e0957a"],
  [7, "#86aedb", "#f4d4ae"],
  [12, "#7fbeea", "#d9edff"],
  [16.5, "#93bde2", "#f1dfbb"],
  [19.3, "#6a7ab4", "#f39f63"],
  [20.6, "#2f3268", "#b05a78"],
  [22, "#121738", "#24285a"],
  [24, "#0b1030", "#1b2150"],
]

/** @param {string} hex */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** @param {string} a @param {string} b @param {number} t */
function mix(a, b, t) {
  const x = rgb(a)
  const y = rgb(b)
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(", ")})`
}

/** Paint the sky for a fractional hour 0..24. @param {number} hour */
function paintSky(hour) {
  const h = ((hour % 24) + 24) % 24
  let i = 0
  while (i < SKY.length - 2 && /** @type {number} */ (SKY[i + 1][0]) <= h) i++
  const [h0, top0, bot0] = SKY[i]
  const [h1, top1, bot1] = SKY[i + 1]
  const t = (h - /** @type {number} */ (h0)) / (/** @type {number} */ (h1) - /** @type {number} */ (h0))
  sky.style.setProperty("--sky-top", mix(/** @type {string} */ (top0), /** @type {string} */ (top1), t))
  sky.style.setProperty("--sky-bot", mix(/** @type {string} */ (bot0), /** @type {string} */ (bot1), t))
  // The orb: the sun from 6 to 20, the moon otherwise, each on its own arc.
  const day = h >= 6 && h < 20.5
  const span = day ? (h - 6) / 14.5 : ((h + 24 - 20.5) % 24) / 9.5
  orb.classList.toggle("is-moon", !day)
  root.dataset.sky = h < 5.6 || h >= 20.4 ? "dark" : "day"
  orb.style.setProperty("--orb-x", (8 + span * 84).toFixed(2) + "vw")
  orb.style.setProperty("--orb-y", (70 - Math.sin(span * Math.PI) * 52).toFixed(2) + "vh")
}

// ---- Entries -----------------------------------------------------------------

/**
 * The little sundial in each card's corner: a gnomon and its shadow, or a
 * crescent moon after dark. SVG, so it prints.
 * @param {ReturnType<typeof shadowOf>} s
 */
function dial(s) {
  if (s.night) {
    return `<svg class="hr-dial" viewBox="0 0 24 24" aria-hidden="true"><path class="hr-moon" d="M15.5 4.5a8 8 0 1 0 4 12.8a6.5 6.5 0 1 1 -4 -12.8z"/></svg>`
  }
  const len = Math.hypot(s.dx, s.dy) || 1
  const k = Math.min(9.5, 3 + len * 0.28) / len
  return `<svg class="hr-dial" viewBox="0 0 24 24" aria-hidden="true"><circle class="hr-dial-face" cx="12" cy="12" r="10"/><line class="hr-dial-shadow" x1="12" y1="12" x2="${(12 + s.dx * k).toFixed(1)}" y2="${(12 + s.dy * k).toFixed(1)}"/><circle class="hr-dial-pin" cx="12" cy="12" r="1.6"/></svg>`
}

/** @param {Entry} e */
function entryMarkup(e) {
  const w = wallClock(e.created_at)
  const s = shadowOf(sunAt(w))
  const hour = canonicalHour(w.minutes)
  return `<article class="gb-entry${s.night ? " is-night" : ""}" data-id="${e.id}" aria-labelledby="hr-a-${e.id}">
    <header class="gb-head">
      <time class="hr-time" datetime="${esc(e.created_at)}">${clockLabel(w.minutes)}</time>
      ${dial(s)}
    </header>
    <p class="gb-message">${esc(e.message)}</p>
    <p class="gb-sig"><span id="hr-a-${e.id}">${esc(e.author_name)}</span> · ${shortDate(e.created_at)}<span class="sr-only">, written ${s.night ? "after dark" : "in daylight"}, at ${hour.name.toLowerCase()}</span></p>
  </article>`
}

/** @param {number} h */
function hourLabel(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12
  return { n: h === 0 ? "12" : String(h12), ap: h < 12 ? "am" : "pm", word: h === 0 ? "midnight" : h === 12 ? "noon" : "" }
}

/** @type {{ h: number, el: HTMLElement, top: number, height: number }[]} */
let sections = []

/** @param {Entry[]} entries @param {string} coupleDate */
function render(entries, coupleDate) {
  const wedding = parseAt(coupleDate + "T15:00")
  const sorted = entries
    .map((e) => ({ e, w: wallClock(e.created_at) }))
    .sort((a, b) => a.w.minutes - b.w.minutes || (a.e.created_at < b.e.created_at ? -1 : 1))

  /** @type {Map<number, typeof sorted>} */
  const byHour = new Map()
  for (const x of sorted) {
    const h = Math.floor(x.w.minutes / 60)
    if (!byHour.has(h)) byHour.set(h, [])
    byHour.get(h)?.push(x)
  }

  // "A year ago, at this hour": a note written on this calendar day, within
  // the hour, in an earlier year.
  const echoes = sorted.filter(
    (x) => x.w.mo === now.mo && x.w.d === now.d && x.w.y < now.y && Math.abs(x.w.minutes - now.minutes) <= 60,
  )

  const nowHour = Math.floor(now.minutes / 60)
  let html = ""
  for (let h = 0; h < 24; h++) {
    const list = byHour.get(h) || []
    const lab = hourLabel(h)
    const block = HOURS.find((x) => x.from === h)
    let items = ""
    let placedNow = h !== nowHour
    for (const x of list) {
      if (!placedNow && x.w.minutes > now.minutes) {
        items += nowMarker(echoes)
        placedNow = true
      }
      items += entryMarkup(x.e)
    }
    if (!placedNow) items += nowMarker(echoes)
    html += `<section class="hr-hour${list.length ? "" : " is-empty"}${block ? " starts-block" : ""}" data-hour="${h}" aria-label="${lab.word || lab.n + " " + lab.ap}${list.length ? `, ${list.length} note${list.length === 1 ? "" : "s"}` : ""}">
      <div class="hr-rail" aria-hidden="true">
        <span class="hr-rail-n">${lab.n}</span><span class="hr-rail-ap">${lab.word || lab.ap}</span>
        ${block ? `<span class="hr-rail-block">${block.name}</span>` : ""}
      </div>
      <div class="hr-notes">${items}</div>
    </section>`
  }
  dayEl.innerHTML = html

  // CSSOM writes only (no style= attributes): each card's own light, and its ink age.
  for (const el of dayEl.querySelectorAll(".gb-entry")) {
    const a = /** @type {HTMLElement} */ (el)
    const e = entries.find((x) => x.id === Number(a.dataset.id))
    if (!e) continue
    const w = wallClock(e.created_at)
    const sun = sunAt(w)
    const s = shadowOf(sun)
    a.style.setProperty("--sun-dx", s.dx + "px")
    a.style.setProperty("--sun-dy", s.dy + "px")
    a.style.setProperty("--sun-blur", s.blur + "px")
    a.style.setProperty("--sun-warm", String(s.warmth))
    a.style.setProperty("--sun-az", sun.azimuth.toFixed(0) + "deg")
    const years = Math.max(0, daysBetween({ ...w }, now) / 365.25)
    a.style.setProperty("--ink-age", Math.min(1, Math.pow(years / 30, 0.6)).toFixed(3))
  }

  // The anniversary: a material accent and, on the day, the notes write in again.
  if (wedding) {
    const m = marriedFor(wedding, now)
    if (m.gift.accent) {
      root.style.setProperty("--hr-material", m.gift.accent)
      root.dataset.material = m.gift.name
    }
    if (m.isDay) root.dataset.anniversary = String(m.years)
    const ann = /** @type {HTMLElement} */ (document.getElementById("hr-anniv"))
    ann.textContent = m.isDay
      ? `${m.phrase}: the ${m.gift.name} anniversary. The book is writing itself in again.`
      : `${m.phrase}.${m.years >= 1 ? ` The ${m.gift.name} years.` : " The ink is still fresh."}`
  }
}

/** @param {{ e: Entry, w: ReturnType<typeof wallClock> }[]} echoes */
function nowMarker(echoes) {
  const yrs = echoes.length ? now.y - echoes[0].w.y : 0
  const echo = echoes.length
    ? `<span class="hr-now-echo">${yrs === 1 ? "One year" : yrs + " years"} ago tonight, within this hour, ${esc(echoes.map((x) => x.e.author_name).join(" and "))} wrote the note${echoes.length > 1 ? "s" : ""} beside you.</span>`
    : ""
  return `<div class="hr-now" id="hr-now" tabindex="-1"><span class="hr-now-label">Now · ${clockLabel(now.minutes)}</span>${echo}</div>`
}

function measure() {
  sections = [...dayEl.querySelectorAll(".hr-hour")].map((el) => {
    const r = el.getBoundingClientRect()
    return { h: Number(/** @type {HTMLElement} */ (el).dataset.hour), el: /** @type {HTMLElement} */ (el), top: r.top + scrollY, height: r.height }
  })
}

/** The hour (fractional) being read at the middle of the viewport. */
function hourAtView() {
  const y = scrollY + innerHeight * 0.5
  if (!sections.length || y < sections[0].top) return 0
  for (const s of sections) {
    if (y < s.top + s.height) return s.h + (y - s.top) / s.height
  }
  return 24
}

// ---- Time machine --------------------------------------------------------------

/** @param {string} coupleDate */
function setupMachine(coupleDate) {
  const input = /** @type {HTMLInputElement} */ (document.getElementById("hr-at"))
  const hour = /** @type {HTMLInputElement} */ (document.getElementById("hr-hour"))
  const box = /** @type {HTMLElement} */ (document.getElementById("hr-presets"))
  input.value = formatAt(now)
  hour.value = String(now.minutes / 60)
  /** @param {string} at */
  const go = (at) => {
    const url = new URL(location.href)
    url.searchParams.set("at", at)
    location.href = url.pathname + url.search
  }
  input.addEventListener("change", () => input.value && go(input.value))
  hour.addEventListener("change", () => {
    const m = Math.round(Number(hour.value) * 60)
    go(formatAt({ ...now, minutes: m }))
  })
  const wedding = parseAt(coupleDate + "T15:00")
  if (!wedding) return
  const now0 = document.createElement("button")
  now0.type = "button"
  now0.className = "r2-btn"
  now0.textContent = "Real now"
  now0.addEventListener("click", () => {
    const url = new URL(location.href)
    url.searchParams.delete("at")
    location.href = url.pathname + url.search
  })
  box.appendChild(now0)
  for (const p of presets(wedding)) {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "r2-btn"
    b.textContent = p.label
    b.addEventListener("click", () => go(p.at))
    box.appendChild(b)
  }
}

// ---- Boot --------------------------------------------------------------------

async function main() {
  wireThemeToggle()
  carryParams()
  const { couple, entries } = await loadEntries()
  const c = document.getElementById("hr-couple")
  if (c) c.textContent = couple.display
  render(entries, couple.date)
  setupMachine(couple.date)
  await document.fonts.ready
  measure()

  const still = stillness()
  const open = new URL(location.href).searchParams.get("open")
  const marker = /** @type {HTMLElement | null} */ (document.getElementById("hr-now"))
  if (marker && open !== "top") {
    scrollTo({ top: marker.getBoundingClientRect().top + scrollY - innerHeight * 0.45, behavior: "instant" })
  }

  if (still) {
    // Still: the sky shows the visitor's own hour and does not move with scroll.
    paintSky(now.minutes / 60)
  } else {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        paintSky(hourAtView())
      })
    }
    addEventListener("scroll", onScroll, { passive: true })
    onScroll()
  }
  addEventListener("resize", measure)

  // On the anniversary the notes are written in again as they come into view.
  if (root.dataset.anniversary && !still) {
    const io = new IntersectionObserver(
      (list) => {
        for (const it of list) {
          if (it.isIntersecting) {
            it.target.classList.add("is-written")
            io.unobserve(it.target)
          }
        }
      },
      { rootMargin: "0px 0px -15% 0px" },
    )
    for (const el of dayEl.querySelectorAll(".gb-entry")) io.observe(el)
  }
}

void main()
