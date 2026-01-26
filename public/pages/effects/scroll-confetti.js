/** @file Scroll confetti — fires confetti bursts at scroll milestones */

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

export function createScrollConfetti(config) {
  const cfg = config || {}
  let canvas = null
  let ctx = null
  let animationId = null
  let particles = []
  let scrollHandler = null
  let firedMilestones = new Set()

  const milestoneCount = cfg.milestoneCount !== undefined ? cfg.milestoneCount : 4
  const particleCountSlider = cfg.particleCount !== undefined ? cfg.particleCount : 50
  const colors = cfg.colors || DEFAULT_COLORS
  const celebrationStyle = cfg.celebrationStyle || "burst"

  function getParticleCount() {
    var base = isMobile() ? 20 : 45
    return Math.round(mapSlider(particleCountSlider, base * 0.4, base * 1.8))
  }

  function getMilestones() {
    var count = Math.max(2, Math.min(8, milestoneCount))
    var milestones = []
    for (var i = 1; i <= count; i++) {
      milestones.push(i / (count + 1))
    }
    return milestones
  }

  function getScrollProgress() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop
    var scrollHeight = document.documentElement.scrollHeight - window.innerHeight
    if (scrollHeight <= 0) return 0
    return Math.max(0, Math.min(1, scrollTop / scrollHeight))
  }

  function createParticles(originX, originY) {
    var count = getParticleCount()
    var newParticles = []

    for (var i = 0; i < count; i++) {
      var angle = (Math.PI * 2 * i) / count + randomBetween(-0.3, 0.3)
      var speed = randomBetween(3, 12)

      newParticles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        gravity: 0.15,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 10,
        width: 4 + Math.random() * 7,
        height: 3 + Math.random() * 5,
        color: randomFrom(colors),
        opacity: 1,
        drag: 0.97,
        shape: Math.random() > 0.5 ? "rect" : "circle",
      })
    }

    return newParticles
  }

  function fireBurst(milestone) {
    if (!canvas || !ctx) return

    var w = window.innerWidth
    var h = window.innerHeight

    if (celebrationStyle === "sides") {
      particles = particles.concat(createParticles(20, h * 0.4))
      particles = particles.concat(createParticles(w - 20, h * 0.4))
    } else if (celebrationStyle === "rain") {
      for (var r = 0; r < 3; r++) {
        particles = particles.concat(createParticles(randomBetween(w * 0.2, w * 0.8), -10))
      }
    } else {
      particles = particles.concat(createParticles(w / 2, h * 0.35))
    }

    if (!animationId) {
      loop()
    }
  }

  function loop() {
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    var dpr = window.devicePixelRatio || 1

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i]
      p.vy += p.gravity
      p.vx *= p.drag
      p.x += p.vx
      p.y += p.vy
      p.rotation += p.rotationSpeed
      p.opacity -= 0.008

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate((p.rotation * Math.PI) / 180)
      ctx.globalAlpha = Math.max(0, p.opacity)
      ctx.fillStyle = p.color

      if (p.shape === "circle") {
        ctx.beginPath()
        ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2)
        ctx.fill()
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

  function onScroll() {
    var progress = getScrollProgress()
    var milestones = getMilestones()

    for (var i = 0; i < milestones.length; i++) {
      var key = String(i)
      if (firedMilestones.has(key)) continue

      if (progress >= milestones[i]) {
        firedMilestones.add(key)
        fireBurst(milestones[i])
      }
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

    firedMilestones = new Set()
    scrollHandler = onScroll
    window.addEventListener("scroll", scrollHandler, { passive: true })
    window.addEventListener("resize", handleResize)
  }

  function stop() {
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
    if (scrollHandler) {
      window.removeEventListener("scroll", scrollHandler)
      scrollHandler = null
    }
    window.removeEventListener("resize", handleResize)
    particles = []
    firedMilestones = new Set()
    if (canvas) {
      canvas.remove()
      canvas = null
      ctx = null
    }
  }

  return { start, stop }
}
