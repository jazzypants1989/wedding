/** @file burst slot: `photocopy` — signing runs the page through the copier.
 *  A green-white scan bar sweeps down the screen, then a rubber stamp thumps
 *  down: "RECEIVED · thank you". Optional sound: the copier's whirr and the
 *  ka-chunk of the stamp, synthesised (filtered noise + a low thump).
 *  Registry-effect shape plus fire(detail).
 *
 *  It draws only its own overlay; it never touches the entry that was added.
 *  Reduced motion: no sweep; the stamp simply appears, holds, and goes.
 */

import { audioContext, reducedMotion } from "../shared/kit.js"

export const PHOTOCOPY_DEFAULTS = { sweep: 1.1, stamp: "RECEIVED", sound: false }

export const PHOTOCOPY_HINTS = {
  sweep: { min: 0.4, max: 3, step: 0.1 },
  stamp: { options: ["RECEIVED", "SIGNED", "COPIED", "XOXO"] },
}

/** @param {number} seconds */
function whirr(seconds) {
  const ac = audioContext()
  if (!ac) return
  const t0 = ac.currentTime + 0.01
  const len = Math.ceil(ac.sampleRate * (seconds + 0.5))
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buf
  const bp = ac.createBiquadFilter()
  bp.type = "bandpass"
  bp.Q.value = 3
  bp.frequency.setValueAtTime(500, t0)
  bp.frequency.linearRampToValueAtTime(1400, t0 + seconds)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(0.09, t0 + 0.15)
  g.gain.setValueAtTime(0.09, t0 + seconds - 0.1)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds + 0.2)
  src.connect(bp)
  bp.connect(g)
  g.connect(ac.destination)
  src.start(t0)
  src.stop(t0 + seconds + 0.4)
  // ka-chunk
  const o = ac.createOscillator()
  const og = ac.createGain()
  const at = t0 + seconds + 0.05
  o.type = "sine"
  o.frequency.setValueAtTime(160, at)
  o.frequency.exponentialRampToValueAtTime(48, at + 0.18)
  og.gain.setValueAtTime(0.0001, at)
  og.gain.linearRampToValueAtTime(0.5, at + 0.005)
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.25)
  o.connect(og)
  og.connect(ac.destination)
  o.start(at)
  o.stop(at + 0.3)
}

/** @param {Partial<typeof PHOTOCOPY_DEFAULTS>} [config] */
export function createPhotocopy(config) {
  const cfg = { ...PHOTOCOPY_DEFAULTS, ...(config || {}) }
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
    const o = document.createElement("div")
    o.className = "pc-overlay"
    o.setAttribute("aria-hidden", "true")
    o.style.setProperty("--pc-sweep", cfg.sweep + "s")
    o.innerHTML = `<div class="pc-bar"></div><div class="pc-stamp"><span class="pc-stamp-big"></span><span class="pc-stamp-small"></span></div>`
    const big = /** @type {HTMLElement} */ (o.querySelector(".pc-stamp-big"))
    big.textContent = cfg.stamp
    const small = /** @type {HTMLElement} */ (o.querySelector(".pc-stamp-small"))
    small.textContent = `thank you, ${(detail && detail.name) || "friend"} ♥`
    if (still) o.classList.add("pc-still")
    document.body.appendChild(o)
    overlay = o
    if (cfg.sound && !still) whirr(cfg.sweep)
    timer = setTimeout(clear, (still ? 2.4 : cfg.sweep + 2) * 1000)
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
