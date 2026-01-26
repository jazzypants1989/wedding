/** @file Grand entrance — choreographed welcome cascade on page load */

import { isMobile, randomFrom, randomBetween, mapSlider, prefersReducedMotion } from "./effect-helpers.js"

export function createGrandEntrance(config) {
  const cfg = config || {}
  let overlay = null
  let sparkleContainer = null
  let animationId = null
  let timeoutIds = []
  let active = false

  const entranceStyle = cfg.entranceStyle || "curtain"
  const sparkleIntensity = cfg.sparkleIntensity !== undefined ? cfg.sparkleIntensity : 50
  const speed = cfg.speed !== undefined ? cfg.speed : 50
  const colors = cfg.colors || ["#ffd700", "#fff", "rgb(221, 115, 100)", "#ff69b4", "#87ceeb", "#c44dff"]

  function getSparkleCount() {
    var base = isMobile() ? 25 : 60
    return Math.round(mapSlider(sparkleIntensity, base * 0.3, base * 2))
  }

  function getSpeedFactor() {
    return mapSlider(speed, 1.5, 0.4, true)
  }

  function createSparkleWave(startY, waveWidth) {
    if (!sparkleContainer || !active) return
    var count = getSparkleCount()
    var w = window.innerWidth

    for (var i = 0; i < count; i++) {
      var sparkle = document.createElement("div")
      sparkle.className = "grand-entrance-sparkle"

      var x = randomBetween(0, w)
      var y = startY + randomBetween(-waveWidth, waveWidth)
      sparkle.style.left = x + "px"
      sparkle.style.top = y + "px"

      var size = randomBetween(3, 8)
      sparkle.style.width = size + "px"
      sparkle.style.height = size + "px"
      sparkle.style.backgroundColor = randomFrom(colors)

      var duration = randomBetween(0.8, 2)
      sparkle.style.animationDuration = duration + "s"
      sparkle.style.animationDelay = randomBetween(0, 0.5) + "s"

      sparkle.addEventListener("animationend", function () {
        sparkle.remove()
      })

      sparkleContainer.appendChild(sparkle)
    }
  }

  function runCurtainEntrance() {
    var speedFactor = getSpeedFactor()

    // Stage 1: Overlay appears
    overlay = document.createElement("div")
    overlay.className = "grand-entrance-overlay"
    overlay.style.animationDuration = (1.2 * speedFactor) + "s"
    document.body.appendChild(overlay)

    // Stage 2: Sparkle cascade from top to bottom
    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    document.body.appendChild(sparkleContainer)

    var h = window.innerHeight
    var waveCount = 5
    var waveDelay = 300 * speedFactor

    for (var w = 0; w < waveCount; w++) {
      var tid = setTimeout(function (waveIdx) {
        return function () {
          if (!active) return
          var y = (h * waveIdx) / waveCount
          createSparkleWave(y, h / waveCount)
        }
      }(w), w * waveDelay + 200 * speedFactor)
      timeoutIds.push(tid)
    }

    // Stage 3: Overlay fades out
    var fadeId = setTimeout(function () {
      if (overlay && active) {
        overlay.classList.add("grand-entrance-overlay--fade")
        var removeId = setTimeout(function () {
          if (overlay) {
            overlay.remove()
            overlay = null
          }
        }, 1000 * speedFactor)
        timeoutIds.push(removeId)
      }
    }, (waveCount * waveDelay) + 600 * speedFactor)
    timeoutIds.push(fadeId)

    // Stage 4: Final cleanup
    var cleanupId = setTimeout(function () {
      cleanupAll()
    }, (waveCount * waveDelay) + 3000 * speedFactor)
    timeoutIds.push(cleanupId)
  }

  function runSparkleShower() {
    var speedFactor = getSpeedFactor()

    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    document.body.appendChild(sparkleContainer)

    var waveCount = 8
    var waveDelay = 200 * speedFactor

    for (var w = 0; w < waveCount; w++) {
      var tid = setTimeout(function (waveIdx) {
        return function () {
          if (!active) return
          createSparkleWave(-20, 60)
        }
      }(w), w * waveDelay)
      timeoutIds.push(tid)
    }

    var cleanupId = setTimeout(function () {
      cleanupAll()
    }, waveCount * waveDelay + 3000 * speedFactor)
    timeoutIds.push(cleanupId)
  }

  function runGoldenReveal() {
    var speedFactor = getSpeedFactor()

    overlay = document.createElement("div")
    overlay.className = "grand-entrance-overlay grand-entrance-overlay--golden"
    overlay.style.animationDuration = (2 * speedFactor) + "s"
    document.body.appendChild(overlay)

    sparkleContainer = document.createElement("div")
    sparkleContainer.className = "effect-layer grand-entrance-sparkles"
    document.body.appendChild(sparkleContainer)

    // Radial sparkle burst from center
    var burstId = setTimeout(function () {
      if (!active) return
      var cx = window.innerWidth / 2
      var cy = window.innerHeight / 2
      var count = getSparkleCount()

      for (var i = 0; i < count; i++) {
        var angle = (Math.PI * 2 * i) / count
        var dist = randomBetween(50, Math.max(window.innerWidth, window.innerHeight) * 0.6)
        var sparkle = document.createElement("div")
        sparkle.className = "grand-entrance-sparkle grand-entrance-sparkle--radial"
        sparkle.style.left = cx + "px"
        sparkle.style.top = cy + "px"
        sparkle.style.setProperty("--tx", (Math.cos(angle) * dist) + "px")
        sparkle.style.setProperty("--ty", (Math.sin(angle) * dist) + "px")
        sparkle.style.backgroundColor = randomFrom(colors)

        var size = randomBetween(3, 7)
        sparkle.style.width = size + "px"
        sparkle.style.height = size + "px"
        sparkle.style.animationDuration = randomBetween(1, 2.5) + "s"
        sparkle.style.animationDelay = randomBetween(0, 0.3) + "s"

        sparkle.addEventListener("animationend", function () { sparkle.remove() })
        sparkleContainer.appendChild(sparkle)
      }
    }, 400 * speedFactor)
    timeoutIds.push(burstId)

    var fadeId = setTimeout(function () {
      if (overlay && active) {
        overlay.classList.add("grand-entrance-overlay--fade")
        var removeId = setTimeout(function () {
          if (overlay) { overlay.remove(); overlay = null }
        }, 1000 * speedFactor)
        timeoutIds.push(removeId)
      }
    }, 1500 * speedFactor)
    timeoutIds.push(fadeId)

    var cleanupId = setTimeout(function () {
      cleanupAll()
    }, 4000 * speedFactor)
    timeoutIds.push(cleanupId)
  }

  function cleanupAll() {
    if (sparkleContainer) {
      sparkleContainer.remove()
      sparkleContainer = null
    }
    if (overlay) {
      overlay.remove()
      overlay = null
    }
  }

  function start() {
    if (active) return
    if (prefersReducedMotion()) return

    active = true

    if (entranceStyle === "shower") {
      runSparkleShower()
    } else if (entranceStyle === "golden") {
      runGoldenReveal()
    } else {
      runCurtainEntrance()
    }
  }

  function stop() {
    active = false
    for (var i = 0; i < timeoutIds.length; i++) {
      clearTimeout(timeoutIds[i])
    }
    timeoutIds = []
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    cleanupAll()
  }

  return { start, stop }
}
