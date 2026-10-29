/** @file burst slot: `print-head` — signing prints a receipt. A strip of
 *  greenbar feeds out of a slot at the top of the screen while the head
 *  chatters across it, printing THANK YOU, <NAME> ♥ in the 5×7 font a pin at
 *  a time (well, a column at a time), then the strip is torn off and drops.
 *  Optional sound: the head's buzz, one burst per character (square wave +
 *  noise). Registry-effect shape plus fire(detail).
 *
 *  Reduced motion: the strip is simply there, fully printed, then fades.
 */

import { dotLine } from "./font57.js"
import { audioContext, reducedMotion } from "../shared/kit.js"

export const PRINTHEAD_DEFAULTS = { cps: 14, sound: false, tear: true }

export const PRINTHEAD_HINTS = {
  cps: { min: 4, max: 40, step: 1 },
}

/** @param {number} chars @param {number} cps */
function buzz(chars, cps) {
  const ac = audioContext()
  if (!ac) return
  const t0 = ac.currentTime + 0.05
  const out = ac.createGain()
  out.gain.value = 0.05
  out.connect(ac.destination)
  const bp = ac.createBiquadFilter()
  bp.type = "bandpass"
  bp.frequency.value = 1900
  bp.Q.value = 1.2
  bp.connect(out)
  for (let i = 0; i < chars; i++) {
    const at = t0 + i / cps
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = "square"
    o.frequency.value = 900 + (i % 3) * 140
    g.gain.setValueAtTime(0.0001, at)
    g.gain.linearRampToValueAtTime(1, at + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.6 / cps)
    o.connect(g)
    g.connect(bp)
    o.start(at)
    o.stop(at + 0.7 / cps)
  }
}

/** @param {Partial<typeof PRINTHEAD_DEFAULTS>} [config] */
export function createPrintHead(config) {
  const cfg = { ...PRINTHEAD_DEFAULTS, ...(config || {}) }
  /** @type {HTMLElement | null} */
  let overlay = null
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer

  function start() {}

  function clear() {
    clearTimeout(timer)
    overlay?.remove()
    overlay = null
  }

  /** @param {{ name?: string }} [detail] */
  function fire(detail) {
    clear()
    const still = reducedMotion()
    const name = ((detail && detail.name) || "friend").toUpperCase()
    const line1 = `THANK YOU, ${name}`
    const text = `${line1} ♥`
    const chars = Array.from(text).length
    const printSeconds = chars / cfg.cps
    const o = document.createElement("div")
    o.className = "ph-overlay" + (still ? " ph-still" : "") + (cfg.tear ? " ph-tear" : "")
    o.setAttribute("aria-hidden", "true")
    o.style.setProperty("--ph-chars", String(chars))
    o.style.setProperty("--ph-print", printSeconds.toFixed(2) + "s")
    o.innerHTML = `
      <div class="ph-slot"><span class="ph-led"></span><span class="ph-label">ON LINE</span></div>
      <div class="ph-paper">
        <div class="ph-line">${dotLine(text, { className: "ph-dots", strike: 2 })}</div>
        <div class="ph-sub">*** ENTRY SAVED ${new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })} ***</div>
        <div class="ph-head"></div>
      </div>`
    document.body.appendChild(o)
    overlay = o
    if (cfg.sound && !still) buzz(chars, cfg.cps)
    timer = setTimeout(clear, (still ? 2.6 : printSeconds + 2.4) * 1000)
  }

  function stop() {
    clear()
  }

  /** Sketch-only live params. @param {string} key @param {unknown} value */
  function set(key, value) {
    Object.assign(cfg, { [key]: value })
  }

  return { start, stop, fire, set }
}
