/** @file Self-contained confetti burst for RSVP success */

const COLORS = [
  "rgb(221, 115, 100)",
  "#ffd700",
  "#ffe4e1",
  "#f0c4b8",
  "#c1330d",
  "#87ceeb",
]

/**
 * Fire a one-shot confetti burst.
 * Respects prefers-reduced-motion.
 */
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
      COLORS[Math.floor(Math.random() * COLORS.length)]

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
