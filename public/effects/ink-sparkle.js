/** @file Ink sparkle — drifting calligraphy-glyph sparkles (✧ ❋ ✦) that fade in
 *  and out along a gentle curved path, evoking the shimmer of wet handwriting. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, cappedCount } from "./effect-utils.js"

const DEFAULT_COLORS = [
  "var(--fx-gold-1)",
  "var(--fx-rose-1)",
  "var(--fx-warm-1)",
  "var(--fx-bright)",
]

const DEFAULT_GLYPHS = ["✧", "❋", "✦"]

// Absolute ceiling regardless of config: each glyph is an animated node, and
// the schema permits counts far higher than any legible sparkle field.
const MAX_GLYPHS = 60

/** @type {Types.createInkSparkle} */
export function createInkSparkle(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const glyphCount = cfg.glyphCount !== undefined ? cfg.glyphCount : 14
  const colors = cfg.colors || DEFAULT_COLORS
  const glyphs = cfg.glyphs || DEFAULT_GLYPHS
  const driftDurationRange = cfg.driftDurationRange || [6, 12]
  const delayRange = cfg.delayRange || [0, 8]
  const sizeRange = cfg.sizeRange || [10, 18]

  function getCount() {
    return cappedCount(isMobile() ? Math.round(glyphCount * 0.5) : glyphCount, MAX_GLYPHS)
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer ink-sparkle-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      const glyph = document.createElement("div")
      glyph.className = "ink-sparkle"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const dx = randomBetween(12, 46) * (Math.random() < 0.5 ? -1 : 1)
      const dy = randomBetween(-30, -8)
      const color = randomFrom(colors)
      glyph.textContent = randomFrom(glyphs)
      glyph.style.left = randomBetween(4, 96) + "%"
      glyph.style.top = randomBetween(10, 90) + "%"
      glyph.style.fontSize = size + "px"
      glyph.style.color = color
      glyph.style.setProperty("--ink-dx", dx + "px")
      glyph.style.setProperty("--ink-dy", dy + "px")
      glyph.style.setProperty("--ink-opacity", String(randomBetween(0.45, 0.85)))
      glyph.style.animationDuration =
        randomBetween(driftDurationRange[0], driftDurationRange[1]) + "s"
      glyph.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"
      container.appendChild(glyph)
    }

    document.body.appendChild(container)
  }

  function stop() {
    if (container) {
      container.remove()
      container = null
    }
  }

  return { start, stop }
}
