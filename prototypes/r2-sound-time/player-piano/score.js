/** @file The Score — book layout `score`. Every guest's tune engraved as a
 *  line of sheet music, with the letters of their name as the lyrics, then
 *  their message underneath. SVG only, so it prints exactly as it looks.
 *
 *  The same motifFor() as the guestbook roll: the tune you heard while
 *  scrolling is the tune printed here, note for note.
 */

import { loadEntries, shortDate, esc } from "../shared/data.js"
import { motifFor, LANES } from "../shared/motif.js"
import { wireThemeToggle, carryParams } from "../shared/env.js"

/** @typedef {import("../shared/motif.js").Motif} Motif */
/** @typedef {import("../shared/data.js").Entry} Entry */

const q = new URL(location.href).searchParams
/** Book params (see SKETCH.md for their ControlHint shapes). */
const PARAMS = {
  scale: q.get("scale") === "pentatonic" ? "pentatonic" : "cryptogram",
  order: q.get("order") === "alphabetical" ? "alphabetical" : "signed",
  coverBand: q.get("coverBand") === "none" ? "none" : "roll",
}

/** Staff geometry, in SVG user units. S is the gap between staff lines. */
const S = 8
const TOP = 26 // y of the top staff line
const BOTTOM = TOP + 4 * S // y of the bottom line (E4 = lane 2)
const H = BOTTOM + 34 // room for C4's ledger line and the lyrics
const CLEF_W = 34

/** y of a lane's notehead: one lane is one staff step (half a line gap). @param {number} lane */
function yOf(lane) {
  return BOTTOM - (lane - 2) * (S / 2)
}

/** @param {number} dur in eighths */
function advance(dur) {
  return 15 + dur * 7.5
}

/**
 * A treble clef, drawn rather than borrowed from a font: the music-symbol
 * code points are missing from most print fonts. A spiral round the G line,
 * a tall stroke with a loop at the top, and a tail.
 */
function clef() {
  const g = yOf(4) // the G4 line the clef curls around
  return `<g class="sc-clef" transform="translate(6 0)">
    <path d="M12 ${g + 22} C 4 ${g + 24} 2 ${g + 14} 9 ${g + 13} C 15 ${g + 12} 15 ${g + 20} 11 ${g + 20}
      M12 ${g + 22} L 13 ${TOP - 10} C 13.5 ${TOP - 16} 20 ${TOP - 14} 18 ${TOP - 6}
      C 16 ${TOP + 2} 2 ${g - 6} 2 ${g + 2} C 2 ${g + 10} 10 ${g + 12} 15 ${g + 9}
      C 21 ${g + 5} 19 ${g - 4} 12 ${g - 4} C 7 ${g - 4} 6 ${g + 2} 10 ${g + 4}"/>
  </g>`
}

/**
 * Engrave one tune.
 * @param {Motif} m
 * @returns {{ svg: string, width: number }}
 */
function staff(m) {
  let x = CLEF_W + 10
  let notes = ""
  let lyrics = ""
  for (const n of m.notes) {
    const cx = x + 6
    const lanes = [n.lane, ...n.chord]
    const lo = Math.min(...lanes)
    const hi = Math.max(...lanes)
    const hollow = n.dur >= 4
    const dotted = n.dur === 3 || n.dur === 5
    const up = (lo + hi) / 2 < 6
    // Ledger lines: C4 below the staff, A5 and above it.
    for (const L of lanes) {
      if (L <= 0) notes += `<line class="sc-ledger" x1="${cx - 7.5}" x2="${cx + 7.5}" y1="${yOf(0)}" y2="${yOf(0)}"/>`
      if (L >= 12) notes += `<line class="sc-ledger" x1="${cx - 7.5}" x2="${cx + 7.5}" y1="${yOf(12)}" y2="${yOf(12)}"/>`
    }
    for (const L of lanes) {
      const y = yOf(L)
      notes += `<ellipse class="sc-head${hollow ? " is-hollow" : ""}" cx="${cx}" cy="${y}" rx="4.7" ry="3.3" transform="rotate(-22 ${cx} ${y})"/>`
      if (dotted) {
        const dy = L % 2 === 0 ? -S / 4 : 0 // a dot on a line moves up into the space
        notes += `<circle class="sc-dot" cx="${cx + 8.5}" cy="${y + dy}" r="1.3"/>`
      }
    }
    // Stem (none for a whole-note length, which we never reach).
    const sx = up ? cx + 4.3 : cx - 4.3
    const y1 = up ? yOf(lo) - 0.8 : yOf(hi) + 0.8
    const y2 = up ? yOf(hi) - 3.3 * S : yOf(lo) + 3.3 * S
    notes += `<line class="sc-stem" x1="${sx}" x2="${sx}" y1="${y1}" y2="${y2}"/>`
    if (n.dur === 1) {
      notes += up
        ? `<path class="sc-flag" d="M${sx} ${y2} c 0.5 6 8 8 7 15 c 1 -6 -3 -8 -7 -10 z"/>`
        : `<path class="sc-flag" d="M${sx} ${y2} c 0.5 -6 8 -8 7 -15 c 1 6 -3 8 -7 10 z"/>`
    }
    if (n.bell) {
      const by = TOP - 16
      notes += `<path class="sc-bell" d="M${cx} ${by - 4} l4 4 l-4 4 l-4 -4 z"/><text class="sc-bell-label" x="${cx + 7}" y="${by + 3}">bell</text>`
    }
    lyrics += `<text class="sc-lyric" x="${cx}" y="${H - 6}" text-anchor="middle">${n.letter}</text>`
    x += advance(n.dur)
  }
  const width = x + 10
  let lines = ""
  for (let i = 0; i < 5; i++) lines += `<line class="sc-line" x1="0" x2="${width}" y1="${TOP + i * S}" y2="${TOP + i * S}"/>`
  const bar = `<line class="sc-line" x1="${width - 5}" x2="${width - 5}" y1="${TOP}" y2="${BOTTOM}"/><rect class="sc-fill" x="${width - 2.5}" y="${TOP}" width="2.5" height="${4 * S}"/>`
  return {
    svg: `<svg viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" focusable="false" aria-hidden="true">${lines}${clef()}${notes}${bar}${lyrics}</svg>`,
    width,
  }
}

/**
 * The cover band: the whole guestbook's roll, turned on its side and wrapped
 * like lines of type. Every hole is a letter of somebody's name.
 * @param {Motif[]} motifs
 */
function coverBand(motifs) {
  const total = motifs.reduce((s, m) => s + m.units + 3, 0)
  const rowUnits = Math.max(60, Math.ceil(Math.sqrt(total * 42)))
  const rows = Math.ceil(total / rowUnits)
  const lane = 1.6
  const rowH = LANES * lane + 3
  const W = rowUnits
  let s = `<svg viewBox="0 0 ${W} ${rows * rowH}" preserveAspectRatio="xMidYMid meet" focusable="false">`
  let t = 0
  for (const m of motifs) {
    for (const n of m.notes) {
      for (const L of [n.lane, ...n.chord]) {
        let start = t + n.start
        let left = n.dur - 0.25
        while (left > 0) {
          const r = Math.floor(start / rowUnits)
          const x = start - r * rowUnits
          const len = Math.min(left, rowUnits - x)
          const y = r * rowH + (LANES - 1 - L) * lane + 1.5
          s += `<rect class="sc-band-hole" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${len.toFixed(2)}" height="${lane * 0.62}" rx="0.5"/>`
          start += len
          left -= len
        }
      }
    }
    t += m.units + 3
  }
  return s + "</svg>"
}

/** @param {Entry} e @param {Motif} m */
function entryMarkup(e, m) {
  const { svg, width } = staff(m)
  const name = esc(e.author_name)
  return `<article class="sc-entry${e.favourite ? " is-favourite" : ""}">
    <header class="sc-entry-head">
      <h3 class="sc-name">${name}</h3>
      <span class="sc-meta">${shortDate(e.created_at)} · ${m.notes.length} notes${m.hearts ? ` · ♥ ${m.hearts}` : ""}</span>
    </header>
    <figure class="sc-staff" data-w="${Math.round(width)}" role="img" aria-label="${name}, as music: ${m.spelled}">${svg}</figure>
    <p class="sc-msg">${esc(e.message)}</p>
  </article>`
}

async function main() {
  wireThemeToggle()
  carryParams()
  const printBtn = document.getElementById("sc-print")
  if (printBtn) printBtn.addEventListener("click", () => print())

  const { couple, entries } = await loadEntries()
  const coupleEl = /** @type {HTMLElement} */ (document.getElementById("sc-couple"))
  coupleEl.textContent = couple.display
  const d = new Date(couple.date + "T12:00:00")
  const dateEl = /** @type {HTMLElement} */ (document.getElementById("sc-date"))
  dateEl.textContent =
    d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + " · " + couple.location

  const opts = { scale: /** @type {"cryptogram"} */ (PARAMS.scale) }
  const signed = entries.slice().reverse() // oldest first: a book reads forward
  const ordered =
    PARAMS.order === "alphabetical"
      ? signed.slice().sort((a, b) => a.author_name.localeCompare(b.author_name))
      : signed
  const favs = ordered.filter((e) => e.favourite)
  const rest = ordered.filter((e) => !e.favourite)
  const motifs = new Map(ordered.map((e) => [e.id, motifFor(e, opts)]))

  const band = /** @type {HTMLElement} */ (document.getElementById("sc-band"))
  if (PARAMS.coverBand === "roll") band.innerHTML = coverBand(signed.map((e) => /** @type {Motif} */ (motifs.get(e.id))))
  else band.hidden = true

  const beats = ordered.reduce((s, e) => s + (motifs.get(e.id)?.units || 0), 0)
  const secs = Math.round(beats * 0.16)
  const countText = `${ordered.length} voice${ordered.length === 1 ? "" : "s"} · ${Math.floor(secs / 60)} min ${secs % 60} s of music`
  const countEl = /** @type {HTMLElement} */ (document.getElementById("sc-count"))
  countEl.textContent = countText

  /** @param {Entry[]} list */
  const block = (list) => list.map((e) => entryMarkup(e, /** @type {Motif} */ (motifs.get(e.id)))).join("")
  let html = ""
  if (favs.length) html += `<section class="sc-section"><h2 class="sc-h2">Overture</h2><p class="sc-section-sub">The couple’s favourites</p>${block(favs)}</section>`
  html += `<section class="sc-section"><h2 class="sc-h2">The book</h2><p class="sc-section-sub">${PARAMS.order === "alphabetical" ? "In alphabetical order" : "In the order they were signed"}</p>${block(rest)}</section>`
  html += `<section class="sc-coda"><p class="sc-coda-mark" aria-hidden="true"><svg viewBox="0 0 40 22"><path d="M3 20 C 6 2 34 2 37 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="17" r="2.6" fill="currentColor"/></svg></p><p>Fine.</p><p class="sc-coda-sub">${countText}</p></section>`
  const score = /** @type {HTMLElement} */ (document.getElementById("sc-score"))
  score.innerHTML = html
  // Every staff is engraved at the same size; only a too-wide one shrinks.
  for (const fig of score.querySelectorAll(".sc-staff")) {
    const f = /** @type {HTMLElement} */ (fig)
    f.style.setProperty("--w", f.dataset.w + "px")
  }
}

void main()
