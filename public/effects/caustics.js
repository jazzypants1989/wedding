/** @file Underwater caustics — layered radial light ripples drifting slowly, as
 *  if sunlight refracts through water. Pure CSS (see `.caustics-layer*` in
 *  effects.css); this factory just builds and mounts the layers. */
/** @import * as Types from './types.js' */

/** @type {Types.createCaustics} */
export function createCaustics(config) {
  const cfg = config || {}
  /** @type {HTMLDivElement | null} */
  let container = null

  // intensity scales the whole container's opacity (0-100 → 0-1, gently capped).
  const intensity = cfg.intensity !== undefined ? cfg.intensity : 55
  // speed scales animation duration inversely (higher = faster ripples).
  const speed = cfg.speed !== undefined ? cfg.speed : 50
  const layerCount = cfg.layerCount !== undefined ? cfg.layerCount : 3

  function start() {
    if (container) return

    container = document.createElement("div")
    container.className = "effect-layer caustics-container"
    container.setAttribute("aria-hidden", "true")
    container.style.opacity = String(Math.min(1, Math.max(0, intensity / 100)))

    // speed 50 = baseline (1×); 100 halves durations, 25 doubles them.
    const speedFactor = 50 / Math.max(1, speed)
    const layers = Math.min(3, Math.max(1, layerCount))
    for (let i = 1; i <= layers; i++) {
      const layer = document.createElement("div")
      layer.className = "caustics-layer caustics-layer-" + i
      if (speedFactor !== 1) layer.style.animationDuration = 8 * i * speedFactor + "s"
      container.appendChild(layer)
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
