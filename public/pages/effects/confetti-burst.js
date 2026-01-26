/** @file Confetti burst effect — canvas-based particle explosion */

import { isMobile, randomFrom, randomBetween, mapSlider, prefersReducedMotion } from "./effect-helpers.js"

const DEFAULT_COLORS = [
  "rgb(221, 115, 100)",
  "#ff69b4",
  "#ffd700",
  "#87ceeb",
  "#fff",
  "#f4978e",
  "#c44dff",
]

export function createConfettiBurst(config) {
  const cfg = config || {}
  let canvas = null
  let ctx = null
  let animationId = null
  let particles = []
  let clickHandler = null

  const particleCountSlider = cfg.particleCount !== undefined ? cfg.particleCount : 50
  const burstOrigin = cfg.burstOrigin || "click"
  const gravitySlider = cfg.gravity !== undefined ? cfg.gravity : 50
  const colors = cfg.colors || DEFAULT_COLORS

  function getParticleCount() {
    const base = isMobile() ? 30 : 60
    return Math.round(mapSlider(particleCountSlider, base * 0.3, base * 2))
  }

  function getGravity() {
    return mapSlider(gravitySlider, 0.08, 0.4)
  }

  function createParticles(originX, originY) {
    const count = getParticleCount()
    const gravity = getGravity()
    const newParticles = []

    for (let i = 0; i < count; i++) {
      const shapeRoll = Math.random()
      let shape = "rect"
      if (shapeRoll > 0.85) shape = "heart"
      else if (shapeRoll > 0.7) shape = "streamer"
      else if (shapeRoll > 0.5) shape = "circle"

      newParticles.push({
        x: originX,
        y: originY,
        vx: (Math.random() - 0.5) * 16,
        vy: -(Math.random() * 12 + 4),
        gravity: gravity,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        width: 4 + Math.random() * 8,
        height: 3 + Math.random() * 6,
        color: randomFrom(colors),
        opacity: 1,
        drag: 0.975,
        wobble: Math.random() * 10,
        wobbleSpeed: 0.04 + Math.random() * 0.1,
        shape: shape,
      })
    }

    return newParticles
  }

  function drawHeart(p) {
    const s = p.width * 0.3
    ctx.beginPath()
    ctx.moveTo(0, -s * 0.3)
    ctx.bezierCurveTo(-s, -s * 1.2, -s * 1.5, s * 0.3, 0, s * 1.2)
    ctx.bezierCurveTo(s * 1.5, s * 0.3, s, -s * 1.2, 0, -s * 0.3)
    ctx.closePath()
    ctx.fill()
  }

  function burst(x, y) {
    if (!canvas || !ctx) return
    particles = particles.concat(createParticles(x, y))
    if (!animationId) {
      loop()
    }
  }

  function loop() {
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    var dpr = window.devicePixelRatio || 1

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      p.vy += p.gravity
      p.vx *= p.drag
      p.x += p.vx
      p.y += p.vy
      p.rotation += p.rotationSpeed
      p.wobble += p.wobbleSpeed
      p.x += Math.sin(p.wobble) * 0.5
      p.opacity -= 0.006

      // Floor bounce
      if (p.y > (canvas.height / dpr) - 20 && p.vy > 0) {
        p.vy *= -0.4
        p.vx *= 0.8
        p.y = (canvas.height / dpr) - 20
      }

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate((p.rotation * Math.PI) / 180)
      ctx.globalAlpha = Math.max(0, p.opacity)
      ctx.fillStyle = p.color

      if (p.shape === "circle") {
        ctx.beginPath()
        ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (p.shape === "heart") {
        drawHeart(p)
      } else if (p.shape === "streamer") {
        ctx.fillRect(-1.5, -p.height, 3, p.height * 2)
      } else {
        ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height)
      }

      ctx.restore()
    }

    particles = particles.filter(function (p) {
      return p.opacity > 0 && p.y < (canvas.height / (window.devicePixelRatio || 1)) + 50
    })

    if (particles.length > 0) {
      animationId = requestAnimationFrame(loop)
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      animationId = null
    }
  }

  function handleResize() {
    if (!canvas) return
    var dpr = window.devicePixelRatio || 1
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr
    ctx.scale(dpr, dpr)
  }

  function handleClick(e) {
    burst(e.clientX, e.clientY)
  }

  function start() {
    if (canvas) return

    if (prefersReducedMotion()) return

    var dpr = window.devicePixelRatio || 1
    canvas = document.createElement("canvas")
    canvas.width = window.innerWidth * dpr
    canvas.height = window.innerHeight * dpr
    canvas.style.position = "fixed"
    canvas.style.inset = "0"
    canvas.style.width = window.innerWidth + "px"
    canvas.style.height = window.innerHeight + "px"
    canvas.style.pointerEvents = "none"
    canvas.style.zIndex = "55"
    document.body.appendChild(canvas)
    ctx = canvas.getContext("2d")
    ctx.scale(dpr, dpr)

    window.addEventListener("resize", handleResize)

    // Initial burst from center
    burst(window.innerWidth / 2, window.innerHeight * 0.25)

    // Enable click bursts in click mode
    if (burstOrigin !== "center") {
      clickHandler = handleClick
      document.addEventListener("click", clickHandler)
    }
  }

  function stop() {
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    if (clickHandler) {
      document.removeEventListener("click", clickHandler)
      clickHandler = null
    }
    window.removeEventListener("resize", handleResize)
    particles = []
    if (canvas) {
      canvas.remove()
      canvas = null
      ctx = null
    }
  }

  return { start, stop }
}
