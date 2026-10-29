/** @file background slot: `fanfold-feed` — by day, two endless streams of
 *  continuous-form paper feed slowly down past the edges of the page, folding
 *  at every perforation; by night, the page is a phosphor CRT (scanlines, a
 *  vignette, and a slow refresh bar rolling down).
 *  Registry-effect shape: create(cfg) → {start, stop}. Pure CSS animation;
 *  reduced motion stills the feed and the roll and keeps everything else.
 */

export const FANFOLD_DEFAULTS = { streams: "both", speed: 4, scanlines: 50 }

export const FANFOLD_HINTS = {
  streams: { options: ["both", "left", "right", "none"] },
  speed: { min: 0, max: 12, step: 1 },
  scanlines: { min: 0, max: 100, step: 5 },
}

/** @param {Partial<typeof FANFOLD_DEFAULTS>} [config] */
export function createFanfoldFeed(config) {
  const cfg = { ...FANFOLD_DEFAULTS, ...(config || {}) }
  /** @type {HTMLDivElement | null} */
  let layer = null

  function paint() {
    if (!layer) return
    layer.dataset.streams = cfg.streams
    // speed is lines per second; one line = 20px, one fold = 11in = 1056px.
    const seconds = cfg.speed > 0 ? 1056 / (cfg.speed * 20) : 0
    layer.style.setProperty("--ff-period", seconds > 0 ? seconds.toFixed(1) + "s" : "0s")
    layer.style.setProperty("--ff-play", cfg.speed > 0 ? "running" : "paused")
    layer.style.setProperty("--ff-scan", String(cfg.scanlines / 100))
  }

  function start() {
    if (layer) return
    layer = document.createElement("div")
    layer.className = "effect-layer fanfold-feed"
    layer.setAttribute("aria-hidden", "true")
    layer.innerHTML = `<div class="ff-stream ff-left"></div><div class="ff-stream ff-right"></div><div class="ff-crt"></div>`
    document.body.prepend(layer)
    paint()
  }

  function stop() {
    layer?.remove()
    layer = null
  }

  /** Sketch-only live params. @param {string} key @param {unknown} value */
  function set(key, value) {
    Object.assign(cfg, { [key]: value })
    paint()
  }

  return { start, stop, set }
}
