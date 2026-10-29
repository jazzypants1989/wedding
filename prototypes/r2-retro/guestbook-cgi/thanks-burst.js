/** @file burst slot: `thanks-for-signing` — the "Thank you for signing my
 *  guestbook!" page every guestbook.cgi redirected to, as a little window with
 *  a spinning pixel envelope and hearts that fly out of it.
 *  Registry-effect shape plus fire(detail): create(cfg) → {start, stop, fire}.
 *
 *  It stays until dismissed (focus moves to its button; Esc closes), because
 *  it is the confirmation, not decoration.
 *
 *  Reduced motion: the window still appears (it is the confirmation), but the
 *  envelope does not spin, the hearts sit still around it and there is no sound.
 */

import { envelope, heart } from "./sprites.js"
import { audioContext, reducedMotion, seeded } from "../shared/kit.js"

export const THANKS_DEFAULTS = { hearts: 12, sound: false }

export const THANKS_HINTS = {
  hearts: { min: 0, max: 24, step: 1 },
}

/** A square-wave "you've got a guestbook entry" jingle: an arpeggio up the
 *  D-major triad, like a General MIDI fanfare through a SoundBlaster. */
function jingle() {
  const ac = audioContext()
  if (!ac) return
  const t0 = ac.currentTime + 0.02
  const notes = [587.33, 739.99, 880, 1174.66]
  const out = ac.createGain()
  out.gain.value = 0.05
  const lp = ac.createBiquadFilter()
  lp.type = "lowpass"
  lp.frequency.value = 2600
  lp.connect(out)
  out.connect(ac.destination)
  notes.forEach((f, i) => {
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = "square"
    o.frequency.value = f
    const t = t0 + i * 0.09
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(1, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 0.6 : 0.16))
    o.connect(g)
    g.connect(lp)
    o.start(t)
    o.stop(t + 0.7)
  })
}

/** @param {Partial<typeof THANKS_DEFAULTS>} [config] */
export function createThanksForSigning(config) {
  const cfg = { ...THANKS_DEFAULTS, ...(config || {}) }
  /** @type {HTMLElement | null} */
  let win = null

  function start() {}

  function close() {
    if (win) win.remove()
    win = null
  }

  /** @param {{ name?: string, id?: number }} [detail] */
  function fire(detail) {
    close()
    const name = (detail && detail.name) || "friend"
    const w = document.createElement("div")
    w.className = "tfs-window"
    w.setAttribute("role", "dialog")
    w.setAttribute("aria-labelledby", "tfs-title")
    w.setAttribute("aria-describedby", "tfs-body")
    const rand = seeded("tfs-" + String((detail && detail.id) || 0))
    let hearts = ""
    for (let i = 0; i < cfg.hearts; i++) hearts += `<span class="tfs-heart">${heart()}</span>`
    w.innerHTML = `
      <div class="tfs-titlebar">
        <span id="tfs-title">guestbook.cgi</span>
        <button type="button" class="tfs-x" aria-label="Close">×</button>
      </div>
      <div class="tfs-body" id="tfs-body">
        <div class="tfs-stage" aria-hidden="true">
          <span class="tfs-env">${envelope()}</span>${hearts}
        </div>
        <p class="tfs-big">Thank you for signing my guestbook!!</p>
        <p>Your entry has been added, <b></b>. Please come back and visit again soon!</p>
        <p class="tfs-buttons"><button type="button" class="tfs-ok">&lt;&lt; Back to the guestbook</button></p>
      </div>`
    const b = w.querySelector(".tfs-body b")
    if (b) b.textContent = name
    // Each heart's flight vector is a CSSOM write (no style= attributes).
    w.querySelectorAll(".tfs-heart").forEach((el, i) => {
      const a = ((i / Math.max(1, cfg.hearts)) * 2 - 0.5) * Math.PI + rand() * 0.4
      const d = 64 + rand() * 54
      const h = /** @type {HTMLElement} */ (el)
      h.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px")
      h.style.setProperty("--dy", (Math.sin(a) * d * 0.6 - 10).toFixed(1) + "px")
      h.style.setProperty("--delay", (i * 0.05).toFixed(2) + "s")
    })
    document.body.appendChild(w)
    win = w
    const ok = /** @type {HTMLButtonElement} */ (w.querySelector(".tfs-ok"))
    ok.addEventListener("click", close)
    w.querySelector(".tfs-x")?.addEventListener("click", close)
    w.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close()
    })
    ok.focus({ preventScroll: true })
    if (cfg.sound && !reducedMotion()) jingle()
  }

  function stop() {
    close()
  }

  /** Sketch-only live params. @param {string} key @param {unknown} value */
  function set(key, value) {
    Object.assign(cfg, { [key]: value })
  }

  return { start, stop, fire, set }
}
