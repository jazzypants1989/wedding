/** @file A Book of Hours — book layout `hours`.
 *
 *  A medieval book of hours is a book of prayers arranged by the time of day
 *  they are said. This one is the guestbook arranged by the time of day each
 *  note was written: Matins for the 1 am notes, Vespers for the ones written
 *  as the sun went down. Rubrics (the times) in red, drop capitals, and a
 *  cover clock where every guest is one tick at the minute they wrote.
 *
 *  The edition line and the rubric colour follow the anniversary the book is
 *  printed in (or ?at=), so a copy printed on the paper anniversary says so.
 *  SVG and CSS only: it prints exactly as it looks.
 */

import { loadEntries, wallClock, clockLabel, shortDate, esc } from "../shared/data.js"
import { sunAt, shadowOf, HOURS } from "../shared/sun.js"
import { readNow, marriedFor, parseAt } from "../shared/clock.js"
import { wireThemeToggle, carryParams } from "../shared/env.js"

/** @typedef {import("../shared/data.js").Entry} Entry */

const now = readNow()

/** Noon at the top, midnight at the bottom, like a 24-hour dial. @param {number} minutes */
function angleOf(minutes) {
  return (minutes / 1440) * 2 * Math.PI + Math.PI
}

/** @param {number} cx @param {number} cy @param {number} r @param {number} a */
function pt(cx, cy, r, a) {
  return [cx + Math.sin(a) * r, cy - Math.cos(a) * r]
}

/** An arc path from a0 to a1 (radians, clockwise). @param {number} r @param {number} a0 @param {number} a1 */
function arc(r, a0, a1) {
  const [x0, y0] = pt(0, 0, r, a0)
  const [x1, y1] = pt(0, 0, r, a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

/** Sunrise/sunset minutes on a date, by stepping the sun model. @param {{ y: number, mo: number, d: number }} day */
function daylight(day) {
  let rise = 360
  let set = 1200
  for (let m = 0; m < 1440; m += 5) {
    const up = sunAt({ ...day, minutes: m }).elevation > 0
    const prev = sunAt({ ...day, minutes: m - 5 }).elevation > 0
    if (up && !prev) rise = m
    if (!up && prev) set = m
  }
  return { rise, set }
}

/**
 * The cover clock: every entry is a tick at the minute it was written, as
 * long as its message. The canonical hours ring the outside; daylight on the
 * wedding day is the pale band.
 * @param {{ e: Entry, w: ReturnType<typeof wallClock>, hour: string }[]} list
 * @param {{ y: number, mo: number, d: number }} day
 * @param {{ only?: string, size?: number }} [opts]
 */
function clock(list, day, opts) {
  const o = opts || {}
  const R = 100
  const { rise, set } = daylight(day)
  let s = `<svg viewBox="-150 -150 300 300" focusable="false" aria-hidden="true">`
  s += `<path class="bh-day" d="${arc(R + 2, angleOf(rise), angleOf(set))}"/>`
  s += `<circle class="bh-ring" r="${R}"/><circle class="bh-ring is-inner" r="${R * 0.42}"/>`
  for (let h = 0; h < 24; h++) {
    const a = angleOf(h * 60)
    const [x0, y0] = pt(0, 0, R, a)
    const [x1, y1] = pt(0, 0, R + (h % 3 === 0 ? 9 : 4), a)
    s += `<line class="bh-hour-tick" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`
  }
  HOURS.forEach((hr, i) => {
    const a0 = angleOf(hr.from * 60) + 0.05
    const a1 = angleOf(hr.to * 60) - 0.05
    // Names on the lower half would read upside-down on a clockwise path,
    // so they run anticlockwise, a little further out to sit below the ring.
    const mid = angleOf(((hr.from + hr.to) / 2) * 60) % (2 * Math.PI)
    const lower = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2
    const id = `bh-arc-${o.only || "all"}-${i}`
    const r = lower ? R + 25 : R + 17
    let path = arc(r, a0, a1)
    if (lower) {
      const [x0, y0] = pt(0, 0, r, a1)
      const [x1, y1] = pt(0, 0, r, a0)
      path = `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 0 ${x1.toFixed(2)} ${y1.toFixed(2)}`
    }
    const on = !o.only || o.only === hr.id
    if (o.only === hr.id) s += `<path class="bh-sector" d="${arc(R * 0.71, angleOf(hr.from * 60), angleOf(hr.to * 60))}" stroke-width="${R * 0.58}"/>`
    s += `<path id="${id}" d="${path}" fill="none"/><text class="bh-hour-name${on ? "" : " is-off"}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${hr.name}</textPath></text>`
  })
  for (const x of list) {
    const a = angleOf(x.w.minutes)
    const len = 10 + Math.min(1, Math.log(1 + x.e.message.length) / Math.log(500)) * (R * 0.52)
    const [x0, y0] = pt(0, 0, R * 0.44, a)
    const [x1, y1] = pt(0, 0, R * 0.44 + len, a)
    const dim = o.only && x.hour !== o.only ? " is-off" : ""
    s += `<line class="bh-tick${dim}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`
    if (x.e.favourite) s += `<circle class="bh-fav${dim}" cx="${x1.toFixed(2)}" cy="${y1.toFixed(2)}" r="2.6"/>`
  }
  s += `<text class="bh-noon" y="${-R * 0.18}" text-anchor="middle">noon</text><text class="bh-noon" y="${R * 0.27}" text-anchor="middle">midnight</text>`
  return s + "</svg>"
}

/** The sundial glyph from the guestbook card, for the margin. @param {Entry} e */
function dial(e) {
  const s = shadowOf(sunAt(wallClock(e.created_at)))
  if (s.night) return `<svg class="bh-dial" viewBox="0 0 24 24" aria-hidden="true"><path class="bh-moon" d="M15.5 4.5a8 8 0 1 0 4 12.8a6.5 6.5 0 1 1 -4 -12.8z"/></svg>`
  const len = Math.hypot(s.dx, s.dy) || 1
  const k = Math.min(9.5, 3 + len * 0.28) / len
  return `<svg class="bh-dial" viewBox="0 0 24 24" aria-hidden="true"><circle class="bh-dial-face" cx="12" cy="12" r="10"/><line class="bh-dial-shadow" x1="12" y1="12" x2="${(12 + s.dx * k).toFixed(1)}" y2="${(12 + s.dy * k).toFixed(1)}"/></svg>`
}

/** @param {number} h */
function span(h) {
  const t = (/** @type {number} */ x) => (x % 12 === 0 ? 12 : x % 12) + (x < 12 || x === 24 ? " am" : " pm")
  return `${t(h)}`
}

async function main() {
  wireThemeToggle()
  carryParams()
  const printBtn = document.getElementById("bh-print")
  if (printBtn) printBtn.addEventListener("click", () => print())

  const { couple, entries } = await loadEntries()
  const coupleEl = /** @type {HTMLElement} */ (document.getElementById("bh-couple"))
  coupleEl.textContent = couple.display
  const wedding = /** @type {import("../shared/clock.js").Wall} */ (parseAt(couple.date + "T15:00"))

  const list = entries
    .map((e) => {
      const w = wallClock(e.created_at)
      const h = Math.floor(w.minutes / 60)
      const hour = (HOURS.find((x) => h >= x.from && h < x.to) || HOURS[0]).id
      return { e, w, hour }
    })
    .sort((a, b) => a.w.minutes - b.w.minutes || (a.e.created_at < b.e.created_at ? -1 : 1))

  const clockEl = /** @type {HTMLElement} */ (document.getElementById("bh-clock"))
  clockEl.innerHTML = clock(list, wedding)
  clockEl.setAttribute("aria-label", `A 24-hour clock with one mark for each of the ${list.length} notes, at the minute it was written.`)

  const m = marriedFor(wedding, now)
  if (m.gift.accent) {
    document.documentElement.style.setProperty("--bh-material", m.gift.accent)
    document.documentElement.dataset.material = m.gift.name
  }
  const edition = /** @type {HTMLElement} */ (document.getElementById("bh-edition"))
  edition.textContent =
    m.months < 0
      ? ""
      : m.isDay
        ? `The ${m.gift.name} anniversary edition`
        : m.years === 0
          ? `Printed ${m.phrase.toLowerCase()}, while the ink is fresh`
          : `Printed in the ${m.gift.name} years · ${m.phrase.toLowerCase()}`

  let toc = ""
  let html = ""
  for (const hr of HOURS) {
    const these = list.filter((x) => x.hour === hr.id)
    if (!these.length) continue
    toc += `<li><a href="#bh-${hr.id}"><span class="bh-toc-name">${hr.name}</span> <span class="bh-toc-sub">${hr.sub}</span> <span class="bh-toc-n">${these.length}</span></a></li>`
    html += `<section class="bh-chapter" id="bh-${hr.id}" aria-labelledby="bh-${hr.id}-h">
      <header class="bh-opener">
        <figure class="bh-mini" aria-hidden="true">${clock(list, wedding, { only: hr.id })}</figure>
        <div>
          <h2 class="bh-hour" id="bh-${hr.id}-h">${hr.name}</h2>
          <p class="bh-hour-sub">${hr.sub} · ${span(hr.from)} to ${span(hr.to)}</p>
          <p class="bh-hour-n">${these.length} note${these.length === 1 ? "" : "s"}</p>
        </div>
      </header>
      ${these
        .map(
          (x) => `<article class="bh-entry${x.e.favourite ? " is-favourite" : ""}">
        <p class="bh-rubric"><time datetime="${esc(x.e.created_at)}">${clockLabel(x.w.minutes)}</time>${dial(x.e)}</p>
        <div class="bh-body">
          <p class="bh-msg">${esc(x.e.message)}</p>
          <p class="bh-sig">${esc(x.e.author_name)} <span>· ${shortDate(x.e.created_at)}</span></p>
        </div>
      </article>`,
        )
        .join("")}
    </section>`
  }
  const tocEl = /** @type {HTMLElement} */ (document.getElementById("bh-contents-list"))
  tocEl.innerHTML = toc
  const chapters = /** @type {HTMLElement} */ (document.getElementById("bh-chapters"))
  chapters.innerHTML = html
}

void main()
