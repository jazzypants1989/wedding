/** @file Confetti drift — a calm, continuous fall of tumbling paper confetti.
 *  Deliberately gentle and ambient, distinct from celebrate.js's one-shot burst:
 *  the outer element drifts down with a lateral sway, the inner paper tumbles. */
/** @import * as Types from './types.js' */

import { isMobile, randomFrom, randomBetween, cappedCount } from "./effect-utils.js"

const DEFAULT_COLORS = [
  "var(--fx-gold-1)",
  "var(--fx-rose-1)",
  "var(--fx-cool-1)",
  "var(--fx-warm-1)",
]

// Absolute ceiling regardless of config: the schema allows counts far higher
// than any sane ambient drift, and each piece is a will-change'd node.
const MAX_PIECES = 120

/** @type {Types.createConfettiDrift} */
export function createConfettiDrift(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  const pieceCount = cfg.pieceCount !== undefined ? cfg.pieceCount : 18
  const colors = cfg.colors || DEFAULT_COLORS
  const fallDurationRange = cfg.fallDurationRange || [8, 16]
  const delayRange = cfg.delayRange || [0, 10]
  const sizeRange = cfg.sizeRange || [5, 10]
  const spinRange = cfg.spinRange || [180, 540]

  function getCount() {
    return cappedCount(isMobile() ? Math.round(pieceCount * 0.5) : pieceCount, MAX_PIECES)
  }

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer confetti-drift-container"
    container.setAttribute("aria-hidden", "true")

    const count = getCount()
    for (let i = 0; i < count; i++) {
      // Outer element owns the drift (fall + sway); inner paper owns the tumble.
      const piece = document.createElement("div")
      piece.className = "drift-confetti"
      const size = randomBetween(sizeRange[0], sizeRange[1])
      const drift = randomBetween(30, 90) * (Math.random() < 0.5 ? -1 : 1)
      const spin = randomBetween(spinRange[0], spinRange[1]) * (Math.random() < 0.5 ? -1 : 1)
      piece.style.left = randomBetween(0, 100) + "%"
      piece.style.setProperty("--drift", drift + "px")
      piece.style.setProperty("--confetti-opacity", String(randomBetween(0.4, 0.75)))
      piece.style.animationDuration =
        randomBetween(fallDurationRange[0], fallDurationRange[1]) + "s"
      piece.style.animationDelay = randomBetween(delayRange[0], delayRange[1]) + "s"

      const paper = document.createElement("div")
      paper.className = "drift-confetti-paper"
      paper.style.width = size + "px"
      paper.style.height = size * 0.5 + "px"
      paper.style.backgroundColor = randomFrom(colors)
      paper.style.setProperty("--spin", spin + "deg")
      paper.style.animationDuration = randomBetween(1.4, 3.4) + "s"
      piece.appendChild(paper)

      container.appendChild(piece)
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
