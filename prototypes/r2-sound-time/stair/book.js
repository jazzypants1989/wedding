/** @file The Spiral — book layout `spiral`, the print side of The Stair.
 *
 *  The helix, seen from above, is a spiral. The frontispiece sets every
 *  signer's name along one Archimedean spiral in SVG text, first to sign at
 *  the centre and the last on the outside, fitted exactly with textLength so
 *  it closes cleanly at 3 entries or 300. Then every note in signing order,
 *  each with a small spiral showing where its writer sits on the big one.
 *  SVG + CSS only, so it prints as it looks.
 */

import { loadEntries, shortDate, esc } from "../shared/data.js"
import { wireThemeToggle, carryParams } from "../shared/env.js"

/** @typedef {import("../shared/data.js").Entry} Entry */

const FS = 9 // name size, in spiral units
const R0 = 44 // inner radius: room for the monogram
const SEP = "  ·  "

/**
 * Spiral r = R0 + kθ, clockwise from 12 o'clock.
 * @param {number} k @param {number} theta
 */
function at(k, theta) {
  const r = R0 + k * theta
  return [r * Math.sin(theta), -r * Math.cos(theta)]
}

/** θ at arc length s (the closed-form approximation of the integral). @param {number} k @param {number} s */
function thetaAt(k, s) {
  return (-R0 + Math.sqrt(R0 * R0 + 2 * k * s)) / k
}

/** @param {number} k @param {number} thetaMax @param {number} step */
function spiralPath(k, thetaMax, step) {
  let d = ""
  let len = 0
  let [px, py] = at(k, 0)
  d += `M${px.toFixed(1)} ${py.toFixed(1)}`
  for (let t = step; t <= thetaMax + 1e-9; t += step) {
    const [x, y] = at(k, t)
    len += Math.hypot(x - px, y - py)
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`
    px = x
    py = y
  }
  return { d, len }
}

/** "Jordana & Jesse" → "J & J" @param {string} display */
function monogram(display) {
  return display
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => (w === "&" ? "&" : w.charAt(0)))
    .join(" ")
}

async function main() {
  wireThemeToggle()
  carryParams()
  const btn = document.getElementById("sp-print")
  if (btn) btn.addEventListener("click", () => print())

  const { couple, entries } = await loadEntries()
  const coupleEl = /** @type {HTMLElement} */ (document.getElementById("sp-couple"))
  coupleEl.textContent = couple.display
  const dateEl = /** @type {HTMLElement} */ (document.getElementById("sp-date"))
  const d = new Date(couple.date + "T12:00:00")
  dateEl.textContent = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + " · " + couple.location

  const signed = entries.slice().reverse()
  const names = signed.map((e) => e.author_name)
  const chars = names.join(SEP).length + SEP.length

  // Size the spiral to the text: estimated text length → turns needed.
  const spacing = FS * 1.6
  const k = spacing / (2 * Math.PI)
  const estLen = chars * FS * 0.43
  const thetaMax = Math.max(4 * Math.PI, thetaAt(k, estLen))
  const { d: path, len } = spiralPath(k, thetaMax, 0.04)
  const rMax = R0 + k * thetaMax + FS * 1.5
  const tspans = signed
    .map((e) => `<tspan class="${e.favourite ? "sp-n is-fav" : "sp-n"}">${esc(e.author_name)}</tspan>`)
    .join(`<tspan class="sp-sep">${SEP}</tspan>`)

  const spiral = /** @type {HTMLElement} */ (document.getElementById("sp-spiral"))
  spiral.setAttribute("role", "img")
  spiral.setAttribute("aria-label", `A spiral of all ${names.length} names, in the order they signed: ${names.join(", ")}.`)
  spiral.innerHTML = `<svg viewBox="${-rMax} ${-rMax} ${rMax * 2} ${rMax * 2}" focusable="false" aria-hidden="true">
    <path id="sp-path" d="${path}" fill="none"/>
    <path class="sp-guide" d="${path}" transform="translate(0 ${FS * 0.45})"/>
    <text class="sp-text" font-size="${FS}"><textPath href="#sp-path" textLength="${(len * 0.985).toFixed(1)}" lengthAdjust="spacing">${tspans}</textPath></text>
    <circle class="sp-centre" r="${R0 - FS * 0.9}"/>
    <text class="sp-mono" text-anchor="middle" dominant-baseline="central" font-size="${R0 * 0.42}">${esc(monogram(couple.display))}</text>
  </svg>`

  // A small copy of the spiral for each note, with a dot where its writer sits.
  const mini = spiralPath(k, thetaMax, 0.12).d
  let cum = 0
  const notes = signed
    .map((e, i) => {
      const mid = cum + e.author_name.length / 2
      cum += e.author_name.length + SEP.length
      const th = thetaAt(k, (mid / chars) * len)
      const [x, y] = at(k, th)
      return `<li class="sp-note${e.favourite ? " is-favourite" : ""}">
        <div class="sp-note-head">
          <span class="sp-no">${i + 1}</span>
          <svg class="sp-mini" viewBox="${-rMax} ${-rMax} ${rMax * 2} ${rMax * 2}" aria-hidden="true"><path d="${mini}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rMax * 0.09}"/></svg>
        </div>
        <p class="sp-msg">${esc(e.message)}</p>
        <p class="sp-sig">${esc(e.author_name)} <span>· ${shortDate(e.created_at)}</span></p>
      </li>`
    })
    .join("")
  const list = /** @type {HTMLElement} */ (document.getElementById("sp-notes"))
  list.innerHTML = notes
}

void main()
