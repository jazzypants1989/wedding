/** @file Champagne fizz — fine bubble streams rising in a few tight columns,
 *  each bubble in a stream staggered so the column reads as a continuous fizz. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, cappedCount } from "./effect-utils.js"

const DEFAULT_COLORS = [
  "var(--fx-gold-1)",
  "var(--fx-warm-1)",
  "var(--fx-bright)",
]

/** @type {Types.createChampagneFizz} */
export function createChampagneFizz(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const streamCount = cfg.streamCount !== undefined ? cfg.streamCount : 3
  const bubblesPerStream = cfg.bubblesPerStream !== undefined ? cfg.bubblesPerStream : 14
  const colors = cfg.colors || DEFAULT_COLORS
  const riseDurationRange = cfg.riseDurationRange || [3, 7]
  const delayRange = cfg.delayRange || [0, 5]
  const sizeRange = cfg.sizeRange || [2, 6]

  // Studio maxes can request hundreds of will-change'd bubbles at once; scale
  // both dimensions on mobile and hard-cap the product regardless of config.
  const MAX_TOTAL_BUBBLES = 150

  function getStreamCount() {
    return isMobile() ? Math.ceil(streamCount / 2) : streamCount
  }

  /** @param {number} effectiveStreamCount */
  function getPerStream(effectiveStreamCount) {
    const scaled = isMobile() ? Math.round(bubblesPerStream * 0.5) : bubblesPerStream
    // Cap the total (streams x per-stream) at the ceiling, then divide back.
    const total = cappedCount(effectiveStreamCount * scaled, MAX_TOTAL_BUBBLES)
    return Math.max(1, Math.floor(total / effectiveStreamCount))
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer fizz-container"
    container.setAttribute("aria-hidden", "true")

    const effectiveStreamCount = getStreamCount()
    const perStream = getPerStream(effectiveStreamCount)
    for (let s = 0; s < effectiveStreamCount; s++) {
      // One column per stream; bubbles jitter only a few pixels around it.
      const columnPct = randomBetween(8, 92)
      const rise = randomBetween(riseDurationRange[0], riseDurationRange[1])
      for (let b = 0; b < perStream; b++) {
        const bubble = document.createElement("div")
        bubble.className = "fizz-bubble"
        const size = randomBetween(sizeRange[0], sizeRange[1])
        const jitter = randomBetween(-8, 8)
        const wobble = randomBetween(4, 14) * (Math.random() < 0.5 ? -1 : 1)
        const color = randomFrom(colors)
        bubble.style.width = size + "px"
        bubble.style.height = size + "px"
        bubble.style.left = "calc(" + columnPct + "% + " + jitter + "px)"
        bubble.style.backgroundColor = color
        bubble.style.color = color // currentColor glow
        bubble.style.setProperty("--wobble", wobble + "px")
        bubble.style.setProperty("--fizz-opacity", String(randomBetween(0.4, 0.85)))
        bubble.style.animationDuration = rise + "s"
        // Stagger each bubble across the stream's rise so the column stays full.
        bubble.style.animationDelay =
          randomBetween(delayRange[0], delayRange[1]) + (b / perStream) * rise + "s"
        container.appendChild(bubble)
      }
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
