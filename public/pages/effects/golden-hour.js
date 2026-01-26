/** @file Golden hour / time-of-day theming — warm/cool overlay based on local time */

export function createGoldenHour(config) {
  const cfg = config || {}
  let overlay = null
  let intervalId = null

  const mode = cfg.mode || "auto"

  function getTimePhase() {
    if (mode !== "auto") return mode

    const hour = new Date().getHours()
    if (hour >= 17 && hour < 19) return "golden"
    if (hour >= 20 || hour < 6) return "night"
    return "day"
  }

  function applyPhase() {
    if (!overlay) return
    const phase = getTimePhase()

    if (phase === "golden") {
      overlay.style.background = "linear-gradient(to bottom, rgba(255, 180, 50, 0.06), rgba(255, 140, 0, 0.04))"
      overlay.style.opacity = "1"
    } else if (phase === "night") {
      overlay.style.background = "linear-gradient(to bottom, rgba(20, 20, 60, 0.08), rgba(10, 10, 40, 0.05))"
      overlay.style.opacity = "1"
    } else {
      overlay.style.opacity = "0"
    }
  }

  function start() {
    if (overlay) return

    overlay = document.createElement("div")
    overlay.className = "golden-hour-overlay"
    overlay.style.position = "fixed"
    overlay.style.inset = "0"
    overlay.style.pointerEvents = "none"
    overlay.style.zIndex = "39"
    overlay.style.transition = "background 60s ease, opacity 60s ease"

    document.body.appendChild(overlay)
    applyPhase()

    // Update every 10 minutes
    intervalId = setInterval(applyPhase, 600000)
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
    if (overlay) {
      overlay.remove()
      overlay = null
    }
  }

  return { start, stop }
}
