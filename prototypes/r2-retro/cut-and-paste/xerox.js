/** @file background slot: `xerox` — the page is a photocopy. Toner speckle
 *  (SVG feTurbulence, thresholded to sparse dots), the dark smear a copier
 *  leaves where the lid didn't close, and a couple of drum streaks. In dark
 *  mode it is a negative copy: black stock, white toner.
 *  Registry-effect shape: create(cfg) → {start, stop}. Nothing moves, so
 *  reduced motion needs no special case.
 */

import { svgUrl, resolveColor } from "../shared/pixels.js"
import { seeded } from "../shared/kit.js"

export const XEROX_DEFAULTS = { grain: 40, streaks: 2, lid: 45, negative: true }

export const XEROX_HINTS = {
  grain: { min: 0, max: 100, step: 5 },
  streaks: { min: 0, max: 5, step: 1 },
  lid: { min: 0, max: 100, step: 5 },
}

/** @param {Partial<typeof XEROX_DEFAULTS>} [config] */
export function createXerox(config) {
  const cfg = { ...XEROX_DEFAULTS, ...(config || {}) }
  /** @type {HTMLDivElement | null} */
  let layer = null
  /** @type {MutationObserver | null} */
  let observer = null

  function paint() {
    if (!layer) return
    const dark = document.documentElement.dataset.theme === "dark" && cfg.negative
    const paper = resolveColor(
      dark
        ? "color-mix(in srgb, var(--color-background) 35%, #0d0c0b)"
        : "color-mix(in srgb, var(--color-background) 30%, #f7f6f1)",
    )
    const toner = dark ? "1" : "0"
    // Threshold the noise so only its peaks become dots. More grain = lower bar.
    const t = 0.76 - cfg.grain * 0.0016
    const slope = 16
    const fine = `<filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 ${toner} 0 0 0 0 ${toner} 0 0 0 0 ${toner} ${slope} 0 0 0 ${(-slope * t).toFixed(2)}"/></filter>`
    const blotch = `<filter id="b" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="4" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 ${toner} 0 0 0 0 ${toner} 0 0 0 0 ${toner} 0.9 0 0 0 -0.38"/></filter>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260">${fine}${blotch}<rect width="260" height="260" filter="url(#b)" opacity="0.35"/><rect width="260" height="260" filter="url(#f)"/></svg>`

    const rand = seeded("xerox-streaks")
    const layers = [svgUrl(svg)]
    const ink = dark ? "255 255 255" : "0 0 0"
    for (let i = 0; i < cfg.streaks; i++) {
      const x = (8 + rand() * 84).toFixed(1)
      const w = (0.08 + rand() * 0.25).toFixed(2)
      const a = (0.04 + rand() * 0.06).toFixed(3)
      layers.push(
        `linear-gradient(90deg, transparent ${x}%, rgb(${ink} / ${a}) ${x}%, rgb(${ink} / ${a}) calc(${x}% + ${w}%), transparent calc(${x}% + ${w}%))`,
      )
    }
    // The lid gap: a soft dark band down one edge, heavier at the corners.
    const lid = cfg.lid / 100
    layers.push(
      `linear-gradient(90deg, rgb(${ink} / ${(lid * 0.38).toFixed(3)}), transparent 9%, transparent 93%, rgb(${ink} / ${(lid * 0.16).toFixed(3)}))`,
    )
    layer.style.setProperty("background-color", paper)
    layer.style.setProperty("background-image", layers.reverse().join(", "))
    layer.style.setProperty(
      "background-size",
      layers.map((_, i) => (i === layers.length - 1 ? "260px 260px" : "100% 100%")).join(", "),
    )
    layer.style.setProperty("box-shadow", `inset 0 0 ${Math.round(40 + lid * 120)}px rgb(${ink} / ${(lid * 0.22).toFixed(3)})`)
  }

  function start() {
    if (layer) return
    layer = document.createElement("div")
    layer.className = "effect-layer xerox-layer"
    layer.setAttribute("aria-hidden", "true")
    document.body.prepend(layer)
    paint()
    observer = new MutationObserver(paint)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-effect-theme"] })
  }

  function stop() {
    observer?.disconnect()
    observer = null
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
