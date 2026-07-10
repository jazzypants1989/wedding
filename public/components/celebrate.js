/** @file Shared celebration + button-state helpers.
 *
 * Extracted from the RSVP page so the guestbook (and later the gallery) can
 * reuse the exact same confetti/sparkle motion. The RSVP modules now re-import
 * from here. Every animation no-ops under prefers-reduced-motion.
 */
/** @import * as Types from "./types.js" */

/** @type {Types.setButtonLoading} */
export function setButtonLoading(btn, isLoading) {
  btn.disabled = isLoading
  if (isLoading) {
    btn.classList.add("btn-loading")
  } else {
    btn.classList.remove("btn-loading")
  }
}

// Brand colors single-sourced from the --effect-brand[-dark] CSS tokens
// (public/styles/tokens.css), same read as public/effects/config.js so the
// wedding's brand isn't hardcoded in a second place. Guarded for non-DOM contexts.
/** @param {string} token @param {string} fallback @returns {string} */
function cssBrand(token, fallback) {
  return (
    (typeof getComputedStyle === "function" &&
      getComputedStyle(document.documentElement).getPropertyValue(token).trim()) ||
    fallback
  )
}

const CONFETTI_COLORS = [
  cssBrand("--effect-brand", "rgb(221, 115, 100)"),
  "#ffd700",
  "#ffe4e1",
  "#f0c4b8",
  cssBrand("--effect-brand-dark", "#c1330d"),
  "#87ceeb",
]

/** @type {Types.fireConfetti} */
export function fireConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const container = document.createElement("div")
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden"
  document.body.appendChild(container)

  const count = window.innerWidth < 768 ? 40 : 80
  let remaining = count

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div")
    piece.className = "confetti-piece"

    const w = 6 + Math.random() * 6
    const h = Math.random() > 0.5 ? w : w * 2.5
    piece.style.width = w + "px"
    piece.style.height = h + "px"
    piece.style.backgroundColor =
      CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]

    piece.style.left = 30 + Math.random() * 40 + "%"
    piece.style.top = 20 + Math.random() * 20 + "%"

    const angle = (Math.random() - 0.5) * 120
    const distance = 200 + Math.random() * 400
    const tx = Math.sin((angle * Math.PI) / 180) * distance
    const ty = 300 + Math.random() * 400
    const rotation = (Math.random() - 0.5) * 1080

    piece.style.setProperty("--confetti-tx", tx + "px")
    piece.style.setProperty("--confetti-ty", ty + "px")
    piece.style.setProperty("--confetti-rot", rotation + "deg")

    const duration = 1.2 + Math.random() * 1.5
    piece.style.animationDuration = duration + "s"
    piece.style.animationDelay = Math.random() * 0.3 + "s"

    piece.addEventListener("animationend", function () {
      piece.remove()
      remaining--
      if (remaining <= 0) container.remove()
    })

    container.appendChild(piece)
  }
}

/** @type {Types.miniSparkle} */
export function miniSparkle(element) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const rect = element.getBoundingClientRect()
  const count = 9
  const colors = ["var(--color-primary)", "#FFD700", "#FFF0D4"]
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  for (let i = 0; i < count; i++) {
    const dot = document.createElement("div")
    dot.className = "mini-sparkle"

    const angle = (i / count) * 360 + (Math.random() * 20 - 10)
    const rad = (angle * Math.PI) / 180
    const dist = 18 + Math.random() * 35
    const size = 3 + Math.random() * 4

    dot.style.left = cx + "px"
    dot.style.top = cy + "px"
    dot.style.setProperty("--sparkle-size", size + "px")
    dot.style.setProperty("--sparkle-color", colors[i % colors.length])
    dot.style.setProperty("--sparkle-tx", Math.cos(rad) * dist + "px")
    dot.style.setProperty("--sparkle-ty", Math.sin(rad) * dist + "px")
    dot.style.animationDelay = Math.random() * 120 + "ms"

    dot.addEventListener("animationend", () => dot.remove())
    document.body.appendChild(dot)
  }
}
