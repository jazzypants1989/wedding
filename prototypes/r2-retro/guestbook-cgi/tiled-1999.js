/** @file background slot: `tiled-1999` — the wallpaper.gif every personal
 *  homepage had, drawn in code and coloured from the theme tokens, plus a few
 *  twinkling pixel sparkles. Registry-effect shape: create(cfg) → {start, stop}.
 *
 *  The tile is an SVG data URI, which cannot take var(), so the tokens are
 *  resolved to concrete colours at start and again whenever light/dark or the
 *  effect theme flips (MutationObserver on <html>).
 */

import { pixelSvg, svgUrl, resolveColor } from "../shared/pixels.js"
import { seeded } from "../shared/kit.js"
import { ROWS } from "./sprites.js"

/** @typedef {{ tile?: string, scale?: number, twinkle?: number, contrast?: number }} TiledConfig */

export const TILED_DEFAULTS = { tile: "auto", scale: 3, twinkle: 14, contrast: 30 }

export const TILED_HINTS = {
  tile: { options: ["auto", "hearts", "stars", "lace", "checker"] },
  scale: { min: 1, max: 5, step: 1 },
  twinkle: { min: 0, max: 40, step: 1 },
  contrast: { min: 10, max: 70, step: 5 },
}

/** @param {TiledConfig} [config] */
export function createTiled1999(config) {
  const cfg = { ...TILED_DEFAULTS, ...(config || {}) }
  /** @type {HTMLDivElement | null} */
  let layer = null
  /** @type {MutationObserver | null} */
  let observer = null

  function tileFor() {
    const dark = document.documentElement.dataset.theme === "dark"
    const kind = cfg.tile === "auto" ? (dark ? "stars" : "hearts") : cfg.tile
    const k = cfg.contrast
    const bg = resolveColor("var(--color-background)")
    const ink = resolveColor(`color-mix(in srgb, var(--color-primary) ${k}%, var(--color-background))`)
    const ink2 = resolveColor(
      `color-mix(in srgb, var(--color-primary) ${Math.round(k * 0.55)}%, var(--color-background))`,
    )
    if (kind === "hearts") {
      // Two hearts on a half-drop lattice, with pixel "sparkle" dots between.
      const rows = []
      for (let y = 0; y < 24; y++) rows.push(".".repeat(24))
      const put = (/** @type {string[]} */ art, /** @type {number} */ ox, /** @type {number} */ oy, /** @type {string} */ ch) => {
        for (let y = 0; y < art.length; y++) {
          for (let x = 0; x < art[y].length; x++) {
            if (art[y][x] === "." ) continue
            const r = rows[(oy + y) % 24]
            const cx = (ox + x) % 24
            rows[(oy + y) % 24] = r.slice(0, cx) + ch + r.slice(cx + 1)
          }
        }
      }
      put(ROWS.HEART, 1, 1, "a")
      put(ROWS.HEART, 13, 13, "b")
      put(["a"], 18, 4, "a")
      put(["b"], 6, 17, "b")
      return { svg: pixelSvg(rows, { a: ink, b: ink2 }), size: 24, bg }
    }
    if (kind === "stars") {
      const fg = resolveColor(`color-mix(in srgb, var(--fx-bright) ${k + 25}%, var(--color-background))`)
      const gold = resolveColor(`color-mix(in srgb, var(--fx-gold-1) ${k + 25}%, var(--color-background))`)
      const rows = []
      for (let y = 0; y < 32; y++) rows.push(".".repeat(32))
      const rand = seeded("stars-tile")
      const set = (/** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ ch) => {
        const r = rows[y]
        rows[y] = r.slice(0, x) + ch + r.slice(x + 1)
      }
      for (let i = 0; i < 18; i++) set(Math.floor(rand() * 32), Math.floor(rand() * 32), rand() < 0.3 ? "g" : "s")
      // Two four-point stars.
      for (const [cx, cy, ch] of /** @type {Array<[number, number, string]>} */ ([[7, 8, "s"], [23, 22, "g"]])) {
        set(cx, cy, ch)
        set(cx - 1, cy, ch)
        set(cx + 1, cy, ch)
        set(cx, cy - 1, ch)
        set(cx, cy + 1, ch)
      }
      return { svg: pixelSvg(rows, { s: fg, g: gold }), size: 32, bg }
    }
    if (kind === "lace") {
      let dots = ""
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        dots += `<circle cx="${12 + Math.cos(a) * 8}" cy="${12 + Math.sin(a) * 8}" r="1.6" fill="${ink}"/>`
        dots += `<circle cx="${12 + Math.cos(a + 0.26) * 5}" cy="${12 + Math.sin(a + 0.26) * 5}" r="0.8" fill="${ink2}"/>`
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="2.2" fill="none" stroke="${ink}" stroke-width="0.8"/>${dots}<circle cx="0" cy="0" r="1.2" fill="${ink2}"/><circle cx="24" cy="0" r="1.2" fill="${ink2}"/><circle cx="0" cy="24" r="1.2" fill="${ink2}"/><circle cx="24" cy="24" r="1.2" fill="${ink2}"/></svg>`
      return { svg, size: 24, bg }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges"><rect width="8" height="8" fill="${ink2}"/><rect x="8" y="8" width="8" height="8" fill="${ink2}"/></svg>`
    return { svg, size: 16, bg }
  }

  function paint() {
    if (!layer) return
    const t = tileFor()
    const px = t.size * cfg.scale
    layer.style.setProperty("background-color", t.bg)
    layer.style.setProperty("background-image", svgUrl(t.svg))
    layer.style.setProperty("background-size", `${px}px ${px}px`)
  }

  function sparkles() {
    if (!layer) return
    for (const old of layer.querySelectorAll(".t99-sparkle")) old.remove()
    const rand = seeded("tiled-1999-sparkles")
    for (let i = 0; i < cfg.twinkle; i++) {
      const s = document.createElement("span")
      s.className = "t99-sparkle"
      s.innerHTML = pixelSvg(ROWS.SPARKLE, { w: ".t99-shine", y: ".t99-glint" })
      s.style.setProperty("left", (rand() * 100).toFixed(2) + "%")
      s.style.setProperty("top", (rand() * 100).toFixed(2) + "%")
      s.style.setProperty("--t99-delay", (-rand() * 3).toFixed(2) + "s")
      s.style.setProperty("--t99-size", String(cfg.scale * 7) + "px")
      layer.appendChild(s)
    }
  }

  function start() {
    if (layer) return
    layer = document.createElement("div")
    layer.className = "effect-layer tiled-1999"
    layer.setAttribute("aria-hidden", "true")
    document.body.prepend(layer)
    paint()
    sparkles()
    observer = new MutationObserver(paint)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-effect-theme"] })
  }

  function stop() {
    if (observer) observer.disconnect()
    observer = null
    if (layer) layer.remove()
    layer = null
  }

  /** Sketch-only: live param updates. @param {string} key @param {unknown} value */
  function set(key, value) {
    Object.assign(cfg, { [key]: value })
    paint()
    if (key === "twinkle" || key === "scale") sparkles()
  }

  return { start, stop, set }
}
