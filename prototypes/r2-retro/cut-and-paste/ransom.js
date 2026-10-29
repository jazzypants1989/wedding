/** @file Ransom-note lettering: every letter cut from a different "magazine".
 *  Deterministic: the same text and seed always cut the same letters, so the
 *  cover looks identical on every visit and in print. The visual letters are
 *  aria-hidden; the real text rides along in an sr-only span. */

import { seeded } from "../shared/kit.js"

const VARIANTS = 8
const EDGES = 4

/**
 * @param {HTMLElement} el the element to fill (its text is replaced)
 * @param {string} text
 * @param {string} seed
 */
export function ransom(el, text, seed) {
  const rand = seeded(seed + "|" + text)
  el.textContent = ""
  el.classList.add("ransom")
  const sr = document.createElement("span")
  sr.className = "sr-only"
  sr.textContent = text
  const vis = document.createElement("span")
  vis.className = "ransom-vis"
  vis.setAttribute("aria-hidden", "true")
  let word = document.createElement("span")
  word.className = "ransom-word"
  let last = -1
  for (const ch of text) {
    if (ch === " ") {
      vis.appendChild(word)
      word = document.createElement("span")
      word.className = "ransom-word"
      continue
    }
    let v = Math.floor(rand() * VARIANTS)
    if (v === last) v = (v + 1 + Math.floor(rand() * (VARIANTS - 1))) % VARIANTS
    last = v
    const s = document.createElement("span")
    s.className = `rl rl-${v} rl-e${Math.floor(rand() * EDGES)}`
    s.textContent = rand() < 0.7 ? ch.toUpperCase() : ch.toLowerCase()
    s.style.setProperty("--rl-rot", ((rand() - 0.5) * 14).toFixed(1) + "deg")
    s.style.setProperty("--rl-y", ((rand() - 0.5) * 0.16).toFixed(3) + "em")
    s.style.setProperty("--rl-size", (0.82 + rand() * 0.36).toFixed(2) + "em")
    word.appendChild(s)
  }
  vis.appendChild(word)
  el.append(sr, vis)
}
