/** @file Effect preview renderers — simplified visuals for the config page cards */

import { randomFrom, randomBetween } from "./effect-helpers.js"

/** Effect descriptions for card display */
export const EFFECT_DESCRIPTIONS = {
  hearts: "Floating hearts drift upward with gentle sway",
  sparkles: "Twinkling star shapes that appear and fade",
  confetti: "Colorful confetti burst on click or from center",
  disco: "A spinning disco ball with light rays",
  cursor: "Sparkly trail that follows your cursor",
  rain: "Gently falling sparkle drops",
  shimmer: "Iridescent mermaid-scale shimmer overlay",
  bubbles: "Translucent bubbles floating upward",
  starfield: "Fixed stars twinkling across the viewport",
  petals: "Rose petals tumbling down with 3D rotation",
  shooting: "Bright streaks dashing across the sky",
  fireflies: "Warm golden dots drifting with organic movement",
  aurora: "Slow-moving translucent aurora bands",
  constellation: "Stars with connecting lines forming patterns",
  burst: "A cascade of sparkles on page load",
  dividers: "Shimmering sparkle dots between sections",
  namespark: "A traveling highlight across the couple names",
  caustics: "Dancing underwater light refraction patterns",
  envelope: "A love letter that opens to release a heart",
  golden: "Warm or cool tint based on time of day",
  textglow: "Text sections glow as they scroll into view",
  ripple: "Expanding rings from click point",
  discofloor: "Colorful pulsing tiles at the bottom",
  scrollconfetti: "Confetti bursts as you scroll through the page",
  parallaxsparkles: "Multi-depth sparkles that shift with scrolling",
  entrance: "A choreographed sparkle cascade on page load",
  spotlight: "Sweeping colored spotlight beams across the page",
  reflections: "Small light squares bouncing like disco reflections",
}

/**
 * Create a preview renderer for the given effect.
 * Returns { start, stop } — start begins the preview animation,
 * stop cleans it up.
 *
 * @param {string} effectId
 * @param {HTMLElement} container - The preview box element
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createPreview(effectId, container) {
  var renderer = PREVIEW_RENDERERS[effectId]
  if (!renderer) {
    return { start: function () {}, stop: function () {} }
  }
  return renderer(container)
}

/** Map of effect id to preview renderer factory */
var PREVIEW_RENDERERS = {
  hearts: previewParticles({ shape: "heart", direction: "up", colors: ["rgb(221,115,100)", "#ff69b4", "#ff8fa3"], count: 4, interval: 1200 }),
  sparkles: previewTwinkle({ colors: ["#fff", "#ffd700", "#ffe4e1"], count: 6 }),
  confetti: previewConfetti(),
  disco: previewDisco(),
  cursor: previewTrail(),
  rain: previewParticles({ shape: "dot", direction: "down", colors: ["#fff", "#ffd700", "rgba(221,115,100,0.8)"], count: 5, interval: 800 }),
  shimmer: previewGradient({ colors: ["rgba(200,180,255,0.12)", "rgba(150,220,255,0.1)", "rgba(255,180,200,0.1)"], angle: 135, speed: 4 }),
  bubbles: previewParticles({ shape: "bubble", direction: "up", colors: ["rgba(255,255,255,0.3)", "rgba(200,230,255,0.25)"], count: 3, interval: 1500 }),
  starfield: previewTwinkle({ colors: ["#fff", "#ffd700", "rgba(221,115,100,0.6)"], count: 10 }),
  petals: previewParticles({ shape: "petal", direction: "down", colors: ["rgb(221,115,100)", "#ff69b4", "#e8747c"], count: 3, interval: 1400 }),
  shooting: previewShootingStar(),
  fireflies: previewFireflies(),
  aurora: previewGradient({ colors: ["rgba(0,200,150,0.15)", "rgba(100,0,200,0.1)", "rgba(0,150,200,0.12)"], angle: 0, speed: 6 }),
  constellation: previewConstellation(),
  burst: previewBurst(),
  dividers: previewDividerDots(),
  namespark: previewNameShimmer(),
  caustics: previewGradient({ colors: ["rgba(100,200,255,0.1)", "rgba(150,255,200,0.08)", "rgba(200,150,255,0.08)"], angle: 45, speed: 3 }),
  envelope: previewEnvelope(),
  golden: previewGradient({ colors: ["rgba(255,180,50,0.1)", "rgba(255,140,0,0.08)"], angle: 180, speed: 8 }),
  textglow: previewTextGlow(),
  ripple: previewRipple(),
  discofloor: previewDiscoFloor(),
  scrollconfetti: previewScrollConfetti(),
  parallaxsparkles: previewParallaxSparkles(),
  entrance: previewGrandEntrance(),
  spotlight: previewSpotlight(),
  reflections: previewReflections(),
}

// ===== Generic preview factories =====

/**
 * Particle preview — spawns small shapes that float up or down.
 */
function previewParticles(opts) {
  return function (container) {
    var intervalId = null
    var count = 0
    var maxCount = opts.count || 4

    function spawnParticle() {
      if (count >= maxCount) return
      var el = document.createElement("div")
      el.className = "preview-particle preview-particle--" + opts.shape

      var w = container.offsetWidth || 150
      var h = container.offsetHeight || 120
      el.style.left = randomBetween(10, w - 20) + "px"

      if (opts.direction === "up") {
        el.style.bottom = "0"
      } else {
        el.style.top = "-10px"
      }

      el.style.backgroundColor = randomFrom(opts.colors)
      var size = randomBetween(6, 12)
      el.style.width = size + "px"
      el.style.height = size + "px"
      el.style.animationDuration = randomBetween(2, 4) + "s"

      if (opts.direction === "down") {
        el.classList.add("preview-particle--fall")
      } else {
        el.classList.add("preview-particle--rise")
      }

      count++
      el.addEventListener("animationend", function () {
        el.remove()
        count--
      })

      container.appendChild(el)
    }

    return {
      start: function () {
        spawnParticle()
        intervalId = setInterval(spawnParticle, opts.interval || 1000)
      },
      stop: function () {
        if (intervalId) clearInterval(intervalId)
        intervalId = null
        count = 0
        var particles = container.querySelectorAll(".preview-particle")
        for (var i = 0; i < particles.length; i++) particles[i].remove()
      },
    }
  }
}

/**
 * Twinkle preview — static dots that pulse in place.
 */
function previewTwinkle(opts) {
  return function (container) {
    var dots = []

    return {
      start: function () {
        var w = container.offsetWidth || 150
        var h = container.offsetHeight || 120
        for (var i = 0; i < (opts.count || 6); i++) {
          var dot = document.createElement("div")
          dot.className = "preview-twinkle"
          dot.style.left = randomBetween(8, w - 16) + "px"
          dot.style.top = randomBetween(8, h - 16) + "px"
          dot.style.backgroundColor = randomFrom(opts.colors)
          dot.style.animationDelay = randomBetween(0, 2) + "s"
          dot.style.animationDuration = randomBetween(1.5, 3) + "s"
          var size = randomBetween(3, 6)
          dot.style.width = size + "px"
          dot.style.height = size + "px"
          container.appendChild(dot)
          dots.push(dot)
        }
      },
      stop: function () {
        for (var i = 0; i < dots.length; i++) dots[i].remove()
        dots = []
      },
    }
  }
}

/**
 * Gradient preview — animated gradient overlay.
 */
function previewGradient(opts) {
  return function (container) {
    var overlay = null

    return {
      start: function () {
        overlay = document.createElement("div")
        overlay.className = "preview-gradient"
        var gradStops = opts.colors.join(", ")
        overlay.style.background = "linear-gradient(" + opts.angle + "deg, " + gradStops + ")"
        overlay.style.backgroundSize = "200% 200%"
        overlay.style.animationDuration = (opts.speed || 4) + "s"
        container.appendChild(overlay)
      },
      stop: function () {
        if (overlay) overlay.remove()
        overlay = null
      },
    }
  }
}

// ===== Specific preview renderers =====

function previewConfetti() {
  return function (container) {
    var timeoutId = null
    var running = false

    function burst() {
      if (!running) return
      var colors = ["rgb(221,115,100)", "#ff69b4", "#ffd700", "#87ceeb", "#fff", "#c44dff"]
      var w = container.offsetWidth || 150
      var h = container.offsetHeight || 120

      for (var i = 0; i < 8; i++) {
        var p = document.createElement("div")
        p.className = "preview-confetti-piece"
        p.style.backgroundColor = randomFrom(colors)
        p.style.left = (w / 2 + randomBetween(-30, 30)) + "px"
        p.style.top = (h / 3) + "px"
        p.style.setProperty("--tx", randomBetween(-50, 50) + "px")
        p.style.setProperty("--ty", randomBetween(20, 60) + "px")
        p.style.animationDuration = randomBetween(0.8, 1.5) + "s"

        p.addEventListener("animationend", function () { p.remove() })
        container.appendChild(p)
      }

      timeoutId = setTimeout(burst, 3000)
    }

    return {
      start: function () { running = true; burst() },
      stop: function () {
        running = false
        if (timeoutId) clearTimeout(timeoutId)
        var pieces = container.querySelectorAll(".preview-confetti-piece")
        for (var i = 0; i < pieces.length; i++) pieces[i].remove()
      },
    }
  }
}

function previewDisco() {
  return function (container) {
    var ball = null

    return {
      start: function () {
        ball = document.createElement("div")
        ball.className = "preview-disco-ball"

        var shine = document.createElement("div")
        shine.className = "preview-disco-shine"
        ball.appendChild(shine)

        container.appendChild(ball)
      },
      stop: function () {
        if (ball) ball.remove()
        ball = null
      },
    }
  }
}

function previewTrail() {
  return function (container) {
    var animId = null
    var dots = []
    var t = 0

    function animate() {
      t += 0.03
      var w = container.offsetWidth || 150
      var h = container.offsetHeight || 120
      var x = w / 2 + Math.sin(t) * (w * 0.3)
      var y = h / 2 + Math.sin(t * 2) * (h * 0.25)

      var dot = document.createElement("div")
      dot.className = "preview-trail-dot"
      dot.style.left = x + "px"
      dot.style.top = y + "px"
      container.appendChild(dot)
      dots.push(dot)

      setTimeout(function () {
        dot.remove()
        var idx = dots.indexOf(dot)
        if (idx >= 0) dots.splice(idx, 1)
      }, 600)

      animId = requestAnimationFrame(animate)
    }

    return {
      start: function () { t = 0; animate() },
      stop: function () {
        if (animId) cancelAnimationFrame(animId)
        animId = null
        for (var i = 0; i < dots.length; i++) dots[i].remove()
        dots = []
      },
    }
  }
}

function previewShootingStar() {
  return function (container) {
    var timeoutId = null
    var running = false

    function shoot() {
      if (!running) return
      var streak = document.createElement("div")
      streak.className = "preview-shooting-star"
      var h = container.offsetHeight || 120
      streak.style.top = randomBetween(10, h * 0.5) + "px"
      streak.style.left = "-20px"

      streak.addEventListener("animationend", function () { streak.remove() })
      container.appendChild(streak)

      timeoutId = setTimeout(shoot, randomBetween(2000, 4000))
    }

    return {
      start: function () { running = true; shoot() },
      stop: function () {
        running = false
        if (timeoutId) clearTimeout(timeoutId)
        var stars = container.querySelectorAll(".preview-shooting-star")
        for (var i = 0; i < stars.length; i++) stars[i].remove()
      },
    }
  }
}

function previewFireflies() {
  return function (container) {
    var dots = []

    return {
      start: function () {
        var w = container.offsetWidth || 150
        var h = container.offsetHeight || 120
        for (var i = 0; i < 5; i++) {
          var dot = document.createElement("div")
          dot.className = "preview-firefly"
          dot.style.left = randomBetween(15, w - 25) + "px"
          dot.style.top = randomBetween(15, h - 25) + "px"
          dot.style.animationDelay = randomBetween(0, 3) + "s"
          dot.style.animationDuration = randomBetween(3, 6) + "s"
          container.appendChild(dot)
          dots.push(dot)
        }
      },
      stop: function () {
        for (var i = 0; i < dots.length; i++) dots[i].remove()
        dots = []
      },
    }
  }
}

function previewConstellation() {
  return function (container) {
    var canvas = null

    return {
      start: function () {
        canvas = document.createElement("canvas")
        canvas.className = "preview-canvas"
        var w = container.offsetWidth || 150
        var h = container.offsetHeight || 120
        canvas.width = w
        canvas.height = h
        container.appendChild(canvas)

        var ctx = canvas.getContext("2d")
        var points = []
        for (var i = 0; i < 8; i++) {
          points.push({ x: randomBetween(10, w - 10), y: randomBetween(10, h - 10) })
        }

        // Draw connections
        ctx.strokeStyle = "rgba(255,255,255,0.2)"
        ctx.lineWidth = 1
        for (var a = 0; a < points.length; a++) {
          for (var b = a + 1; b < points.length; b++) {
            var dx = points[a].x - points[b].x
            var dy = points[a].y - points[b].y
            var dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 60) {
              ctx.beginPath()
              ctx.moveTo(points[a].x, points[a].y)
              ctx.lineTo(points[b].x, points[b].y)
              ctx.stroke()
            }
          }
        }

        // Draw stars
        ctx.fillStyle = "rgba(255,255,255,0.8)"
        for (var s = 0; s < points.length; s++) {
          ctx.beginPath()
          ctx.arc(points[s].x, points[s].y, 2, 0, Math.PI * 2)
          ctx.fill()
        }
      },
      stop: function () {
        if (canvas) canvas.remove()
        canvas = null
      },
    }
  }
}

function previewBurst() {
  return function (container) {
    var timeoutId = null
    var running = false

    function burst() {
      if (!running) return
      var w = container.offsetWidth || 150
      var colors = ["#fff", "#ffd700", "#ffe4e1", "rgb(221,115,100)"]

      for (var i = 0; i < 10; i++) {
        var p = document.createElement("div")
        p.className = "preview-burst-particle"
        p.style.left = randomBetween(5, w - 10) + "px"
        p.style.top = "-5px"
        p.style.backgroundColor = randomFrom(colors)
        p.style.animationDelay = randomBetween(0, 0.5) + "s"

        p.addEventListener("animationend", function () { p.remove() })
        container.appendChild(p)
      }

      timeoutId = setTimeout(burst, 4000)
    }

    return {
      start: function () { running = true; burst() },
      stop: function () {
        running = false
        if (timeoutId) clearTimeout(timeoutId)
        var parts = container.querySelectorAll(".preview-burst-particle")
        for (var i = 0; i < parts.length; i++) parts[i].remove()
      },
    }
  }
}

function previewDividerDots() {
  return function (container) {
    var row = null

    return {
      start: function () {
        row = document.createElement("div")
        row.className = "preview-divider-row"
        var w = container.offsetWidth || 150

        for (var i = 0; i < 10; i++) {
          var dot = document.createElement("div")
          dot.className = "preview-divider-dot"
          dot.style.animationDelay = (i * 0.12) + "s"
          row.appendChild(dot)
        }

        container.appendChild(row)
      },
      stop: function () {
        if (row) row.remove()
        row = null
      },
    }
  }
}

function previewNameShimmer() {
  return function (container) {
    var text = null

    return {
      start: function () {
        text = document.createElement("div")
        text.className = "preview-name-shimmer"
        text.textContent = "J & J"
        container.appendChild(text)
      },
      stop: function () {
        if (text) text.remove()
        text = null
      },
    }
  }
}

function previewEnvelope() {
  return function (container) {
    var envelope = null

    return {
      start: function () {
        envelope = document.createElement("div")
        envelope.className = "preview-envelope"

        var flap = document.createElement("div")
        flap.className = "preview-envelope-flap"

        var heart = document.createElement("div")
        heart.className = "preview-envelope-heart"

        envelope.appendChild(flap)
        envelope.appendChild(heart)
        container.appendChild(envelope)
      },
      stop: function () {
        if (envelope) envelope.remove()
        envelope = null
      },
    }
  }
}

function previewTextGlow() {
  return function (container) {
    var text = null

    return {
      start: function () {
        text = document.createElement("div")
        text.className = "preview-text-glow"
        text.textContent = "Wedding text glows as you scroll"
        container.appendChild(text)
      },
      stop: function () {
        if (text) text.remove()
        text = null
      },
    }
  }
}

function previewRipple() {
  return function (container) {
    var timeoutId = null
    var running = false

    function ripple() {
      if (!running) return
      var w = container.offsetWidth || 150
      var h = container.offsetHeight || 120

      var ring = document.createElement("div")
      ring.className = "preview-ripple-ring"
      ring.style.left = (w / 2) + "px"
      ring.style.top = (h / 2) + "px"

      ring.addEventListener("animationend", function () { ring.remove() })
      container.appendChild(ring)

      timeoutId = setTimeout(ripple, 2500)
    }

    return {
      start: function () { running = true; ripple() },
      stop: function () {
        running = false
        if (timeoutId) clearTimeout(timeoutId)
        var rings = container.querySelectorAll(".preview-ripple-ring")
        for (var i = 0; i < rings.length; i++) rings[i].remove()
      },
    }
  }
}

function previewDiscoFloor() {
  return function (container) {
    var row = null
    var intervalId = null

    return {
      start: function () {
        row = document.createElement("div")
        row.className = "preview-disco-floor"
        var colors = ["rgb(221,115,100)", "#ff69b4", "#ffd700", "#87ceeb", "#fff", "#c44dff"]

        for (var i = 0; i < 8; i++) {
          var tile = document.createElement("div")
          tile.className = "preview-disco-tile"
          tile.style.backgroundColor = randomFrom(colors)
          row.appendChild(tile)
        }

        container.appendChild(row)

        intervalId = setInterval(function () {
          if (!row) return
          var tiles = row.children
          for (var t = 0; t < tiles.length; t++) {
            if (Math.random() > 0.6) {
              tiles[t].style.backgroundColor = randomFrom(colors)
            }
          }
        }, 600)
      },
      stop: function () {
        if (intervalId) clearInterval(intervalId)
        intervalId = null
        if (row) row.remove()
        row = null
      },
    }
  }
}

function previewScrollConfetti() {
  return function (container) {
    var timeoutId = null
    var running = false

    function burst() {
      if (!running) return
      var colors = ["rgb(221,115,100)", "#ff69b4", "#ffd700", "#87ceeb", "#c44dff"]
      var w = container.offsetWidth || 150
      var h = container.offsetHeight || 120

      // Show a scroll indicator then burst
      var indicator = document.createElement("div")
      indicator.className = "preview-scroll-indicator"
      indicator.style.top = randomBetween(h * 0.3, h * 0.7) + "px"
      container.appendChild(indicator)

      setTimeout(function () {
        if (!running) return
        indicator.remove()
        for (var i = 0; i < 10; i++) {
          var p = document.createElement("div")
          p.className = "preview-confetti-piece"
          p.style.backgroundColor = randomFrom(colors)
          p.style.left = (w / 2 + randomBetween(-30, 30)) + "px"
          p.style.top = (h / 2) + "px"
          p.style.setProperty("--tx", randomBetween(-50, 50) + "px")
          p.style.setProperty("--ty", randomBetween(-30, 50) + "px")
          p.style.animationDuration = randomBetween(0.8, 1.5) + "s"
          p.addEventListener("animationend", function () { p.remove() })
          container.appendChild(p)
        }
      }, 600)

      timeoutId = setTimeout(burst, 3500)
    }

    return {
      start: function () { running = true; burst() },
      stop: function () {
        running = false
        if (timeoutId) clearTimeout(timeoutId)
        var pieces = container.querySelectorAll(".preview-confetti-piece, .preview-scroll-indicator")
        for (var i = 0; i < pieces.length; i++) pieces[i].remove()
      },
    }
  }
}

function previewParallaxSparkles() {
  return function (container) {
    var dots = []
    var animId = null
    var t = 0

    return {
      start: function () {
        var w = container.offsetWidth || 150
        var h = container.offsetHeight || 120
        var colors = ["#ffd700", "#fff", "rgba(255,215,0,0.6)", "#ffe4e1"]

        for (var layer = 0; layer < 3; layer++) {
          var depth = (layer + 1) / 3
          for (var i = 0; i < 4; i++) {
            var dot = document.createElement("div")
            dot.className = "preview-parallax-dot"
            var size = randomBetween(2, 5) * depth
            dot.style.width = size + "px"
            dot.style.height = size + "px"
            dot.style.left = randomBetween(5, w - 10) + "px"
            dot.style.top = randomBetween(5, h - 10) + "px"
            dot.style.backgroundColor = randomFrom(colors)
            dot.style.opacity = String(0.3 + depth * 0.5)
            dot._depth = depth
            dot._baseY = parseFloat(dot.style.top)
            if (depth > 0.6) {
              dot.style.boxShadow = "0 0 " + Math.round(size * 2) + "px " + randomFrom(colors)
            }
            container.appendChild(dot)
            dots.push(dot)
          }
        }

        function animate() {
          t += 0.02
          for (var d = 0; d < dots.length; d++) {
            var shift = Math.sin(t) * 15 * dots[d]._depth
            dots[d].style.transform = "translateY(" + shift + "px)"
          }
          animId = requestAnimationFrame(animate)
        }
        animate()
      },
      stop: function () {
        if (animId) cancelAnimationFrame(animId)
        animId = null
        for (var i = 0; i < dots.length; i++) dots[i].remove()
        dots = []
        t = 0
      },
    }
  }
}

function previewGrandEntrance() {
  return function (container) {
    var timeoutId = null
    var running = false

    function entrance() {
      if (!running) return
      var w = container.offsetWidth || 150
      var h = container.offsetHeight || 120
      var colors = ["#ffd700", "#fff", "rgb(221,115,100)", "#ff69b4", "#87ceeb"]

      // Flash overlay
      var flash = document.createElement("div")
      flash.className = "preview-entrance-flash"
      container.appendChild(flash)

      // Sparkle cascade
      setTimeout(function () {
        if (!running) return
        flash.remove()
        for (var i = 0; i < 15; i++) {
          var sparkle = document.createElement("div")
          sparkle.className = "preview-entrance-sparkle"
          sparkle.style.left = randomBetween(5, w - 10) + "px"
          sparkle.style.top = "-5px"
          sparkle.style.backgroundColor = randomFrom(colors)
          var size = randomBetween(3, 6)
          sparkle.style.width = size + "px"
          sparkle.style.height = size + "px"
          sparkle.style.animationDelay = randomBetween(0, 0.6) + "s"
          sparkle.addEventListener("animationend", function () { sparkle.remove() })
          container.appendChild(sparkle)
        }
      }, 400)

      timeoutId = setTimeout(entrance, 5000)
    }

    return {
      start: function () { running = true; entrance() },
      stop: function () {
        running = false
        if (timeoutId) clearTimeout(timeoutId)
        var els = container.querySelectorAll(".preview-entrance-flash, .preview-entrance-sparkle")
        for (var i = 0; i < els.length; i++) els[i].remove()
      },
    }
  }
}

function previewSpotlight() {
  return function (container) {
    var beams = []

    return {
      start: function () {
        var colors = ["rgba(221,115,100,0.2)", "rgba(255,215,0,0.15)", "rgba(135,206,235,0.2)"]

        for (var i = 0; i < 2; i++) {
          var beam = document.createElement("div")
          beam.className = "preview-spotlight-beam"
          beam.style.backgroundColor = colors[i]
          beam.style.animationDuration = (3 + i * 1.5) + "s"
          if (i % 2 === 1) beam.style.animationDirection = "reverse"
          container.appendChild(beam)
          beams.push(beam)
        }
      },
      stop: function () {
        for (var i = 0; i < beams.length; i++) beams[i].remove()
        beams = []
      },
    }
  }
}

function previewReflections() {
  return function (container) {
    var squares = []
    var animId = null
    var t = 0

    return {
      start: function () {
        var w = container.offsetWidth || 150
        var h = container.offsetHeight || 120

        for (var i = 0; i < 6; i++) {
          var sq = document.createElement("div")
          sq.className = "preview-reflection-square"
          sq._x = randomBetween(10, w - 20)
          sq._y = randomBetween(10, h - 20)
          sq._vx = (Math.random() - 0.5) * 1.5
          sq._vy = (Math.random() - 0.5) * 1.5
          sq._phase = randomBetween(0, Math.PI * 2)
          container.appendChild(sq)
          squares.push(sq)
        }

        function animate() {
          t += 0.03
          var cw = container.offsetWidth || 150
          var ch = container.offsetHeight || 120

          for (var s = 0; s < squares.length; s++) {
            var sq = squares[s]
            sq._x += sq._vx
            sq._y += sq._vy
            if (sq._x < 0 || sq._x > cw - 8) sq._vx *= -1
            if (sq._y < 0 || sq._y > ch - 8) sq._vy *= -1
            sq._phase += 0.04
            sq.style.opacity = String(0.3 + 0.5 * Math.abs(Math.sin(sq._phase)))
            sq.style.transform = "translate(" + Math.round(sq._x) + "px, " + Math.round(sq._y) + "px) rotate(" + Math.round(sq._phase * 20) + "deg)"
          }
          animId = requestAnimationFrame(animate)
        }
        animate()
      },
      stop: function () {
        if (animId) cancelAnimationFrame(animId)
        animId = null
        for (var i = 0; i < squares.length; i++) squares[i].remove()
        squares = []
        t = 0
      },
    }
  }
}
