/** @file Constellation connector — stars with connecting lines forming patterns */

import { isMobile, randomBetween, mapSlider, prefersReducedMotion } from "./effect-helpers.js"

export function createConstellation(config) {
  const cfg = config || {}
  let canvas = null
  let ctx = null
  let animationId = null
  let reshuffleId = null
  let stars = []
  let active = false
  let mouseX = -1000
  let mouseY = -1000
  let mouseHandler = null

  const connectionDensity = cfg.connectionDensity !== undefined ? cfg.connectionDensity : 50
  const lineColor = cfg.lineColor !== undefined ? cfg.lineColor : 50
  const starCountSlider = cfg.starCount !== undefined ? cfg.starCount : 50

  function getStarCount() {
    const base = isMobile() ? 10 : 20
    return Math.round(mapSlider(starCountSlider, base * 0.5, base * 2))
  }

  function getConnectionRadius() {
    return mapSlider(connectionDensity, 80, 200)
  }

  function getLineAlpha() {
    return mapSlider(lineColor, 0.05, 0.25)
  }

  function initStars() {
    const count = getStarCount()
    stars = []
    for (let i = 0; i < count; i++) {
      stars.push({
        x: randomBetween(20, window.innerWidth - 20),
        y: randomBetween(20, window.innerHeight - 20),
        targetX: 0,
        targetY: 0,
        moving: false,
        size: randomBetween(1.5, 3),
        brightness: randomBetween(0.4, 1),
      })
    }
    for (let i = 0; i < stars.length; i++) {
      stars[i].targetX = stars[i].x
      stars[i].targetY = stars[i].y
    }
  }

  function reshuffleStars() {
    if (!active) return
    const count = Math.min(5, Math.floor(stars.length * 0.3))
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * stars.length)
      stars[idx].targetX = randomBetween(20, window.innerWidth - 20)
      stars[idx].targetY = randomBetween(20, window.innerHeight - 20)
      stars[idx].moving = true
    }
    reshuffleId = setTimeout(reshuffleStars, randomBetween(8000, 12000))
  }

  function render() {
    if (!canvas || !ctx || !active) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    var dpr = window.devicePixelRatio || 1
    var anyMoving = false
    var mouseProximityRadius = 150

    // Update star positions
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]
      if (s.moving) {
        const dx = s.targetX - s.x
        const dy = s.targetY - s.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) {
          s.x = s.targetX
          s.y = s.targetY
          s.moving = false
        } else {
          s.x += dx * 0.02
          s.y += dy * 0.02
          anyMoving = true
        }
      }
    }

    // Draw connections
    const radius = getConnectionRadius()
    const alpha = getLineAlpha()

    for (let i = 0; i < stars.length; i++) {
      let connections = 0
      for (let j = i + 1; j < stars.length; j++) {
        if (connections >= 3) break
        const dx = stars[j].x - stars[i].x
        const dy = stars[j].y - stars[i].y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < radius) {
          // Boost connections near mouse
          var midX = (stars[i].x + stars[j].x) / 2
          var midY = (stars[i].y + stars[j].y) / 2
          var mouseDx = midX - mouseX
          var mouseDy = midY - mouseY
          var mouseDist = Math.sqrt(mouseDx * mouseDx + mouseDy * mouseDy)
          var boost = mouseDist < mouseProximityRadius ? 1 + (1 - mouseDist / mouseProximityRadius) * 2 : 1
          var lineAlpha = Math.min(1, alpha * boost)

          ctx.strokeStyle = "rgba(255, 255, 255, " + lineAlpha + ")"
          ctx.lineWidth = boost > 1.5 ? 1 : 0.5
          ctx.beginPath()
          ctx.moveTo(stars[i].x, stars[i].y)
          ctx.lineTo(stars[j].x, stars[j].y)
          ctx.stroke()
          connections++
        }
      }
    }

    // Also draw connections to mouse cursor if close to stars
    if (mouseX > 0 && mouseY > 0) {
      for (let i = 0; i < stars.length; i++) {
        var mdx = stars[i].x - mouseX
        var mdy = stars[i].y - mouseY
        var mDist = Math.sqrt(mdx * mdx + mdy * mdy)
        if (mDist < mouseProximityRadius) {
          var mAlpha = (1 - mDist / mouseProximityRadius) * 0.3
          ctx.strokeStyle = "rgba(255, 215, 0, " + mAlpha + ")"
          ctx.lineWidth = 0.5
          ctx.beginPath()
          ctx.moveTo(stars[i].x, stars[i].y)
          ctx.lineTo(mouseX, mouseY)
          ctx.stroke()
        }
      }
    }

    // Draw stars
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i]
      // Brightness boost near mouse
      var sdx = s.x - mouseX
      var sdy = s.y - mouseY
      var sDist = Math.sqrt(sdx * sdx + sdy * sdy)
      var starBoost = sDist < mouseProximityRadius ? 1 + (1 - sDist / mouseProximityRadius) * 0.5 : 1
      var drawBrightness = Math.min(1, s.brightness * starBoost)
      var drawSize = s.size * (starBoost > 1 ? 1 + (starBoost - 1) * 0.5 : 1)

      ctx.beginPath()
      ctx.arc(s.x, s.y, drawSize, 0, Math.PI * 2)
      ctx.fillStyle = "rgba(255, 255, 255, " + drawBrightness + ")"
      ctx.shadowBlur = starBoost > 1 ? 8 : 4
      ctx.shadowColor = starBoost > 1 ? "rgba(255, 215, 0, 0.6)" : "rgba(255, 255, 255, 0.5)"
      ctx.fill()
      ctx.shadowBlur = 0
    }

    if (anyMoving || (mouseX > 0 && mouseY > 0)) {
      animationId = requestAnimationFrame(render)
    } else {
      animationId = null
    }
  }

  function handleResize() {
    if (!canvas) return
    var dpr = window.devicePixelRatio || 1
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr
    canvas.style.width = window.innerWidth + "px"
    canvas.style.height = window.innerHeight + "px"
    ctx.scale(dpr, dpr)
    if (!animationId) render()
  }

  function handleMouseMove(e) {
    mouseX = e.clientX
    mouseY = e.clientY
    if (!animationId && active) {
      render()
    }
  }

  function handleMouseLeave() {
    mouseX = -1000
    mouseY = -1000
  }

  function start() {
    if (canvas) return
    if (prefersReducedMotion()) return

    active = true
    var dpr = window.devicePixelRatio || 1
    canvas = document.createElement("canvas")
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr
    canvas.style.position = "fixed"
    canvas.style.inset = "0"
    canvas.style.width = window.innerWidth + "px"
    canvas.style.height = window.innerHeight + "px"
    canvas.style.pointerEvents = "none"
    canvas.style.zIndex = "50"
    document.body.appendChild(canvas)
    ctx = canvas.getContext("2d")
    ctx.scale(dpr, dpr)

    initStars()
    render()
    reshuffleId = setTimeout(reshuffleStars, randomBetween(8000, 12000))
    window.addEventListener("resize", handleResize)

    mouseHandler = handleMouseMove
    document.addEventListener("mousemove", mouseHandler)
    document.addEventListener("mouseleave", handleMouseLeave)
  }

  function stop() {
    active = false
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    if (reshuffleId) {
      clearTimeout(reshuffleId)
      reshuffleId = null
    }
    window.removeEventListener("resize", handleResize)
    if (mouseHandler) {
      document.removeEventListener("mousemove", mouseHandler)
      document.removeEventListener("mouseleave", handleMouseLeave)
      mouseHandler = null
    }
    mouseX = -1000
    mouseY = -1000
    stars = []
    if (canvas) {
      canvas.remove()
      canvas = null
      ctx = null
    }
  }

  return { start, stop }
}
