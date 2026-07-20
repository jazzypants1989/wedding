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

/** Build a burst palette that leads with `accent` (e.g. a card's `--tc-accent`)
 *  blended into a couple of the base tones, so an origin-colored burst still
 *  carries the base palette's texture instead of reading as a flat single hue.
 *  Returns `base` unchanged when no accent is given — exact current behavior.
 *  @param {string[]} base @param {string} [accent]
 *  @returns {string[]} */
function accentPalette(base, accent) {
  if (!accent) return base
  const blended = base
    .slice(0, 2)
    .map((tone) => "color-mix(in srgb, " + accent + " 65%, " + tone + ")")
  return [accent, ...blended, ...base]
}

/** Fixed containers rely on `animationend` to remove themselves; a
 *  backgrounded tab can drop those events (rAF/animation timers throttle or
 *  pause), leaking an invisible full-viewport `pointer-events:none` div
 *  forever. Every one-shot also arms this as a safety net, cleared the moment
 *  normal teardown actually runs.
 *  @param {HTMLElement} container @param {number} maxDurationMs
 *  @returns {() => void} idempotent cleanup — call from every completion path */
function armContainerSafetyNet(container, maxDurationMs) {
  let removed = false
  const safetyTimer = setTimeout(function () {
    removed = true
    container.remove()
  }, maxDurationMs)
  return function cleanup() {
    if (removed) return
    removed = true
    clearTimeout(safetyTimer)
    container.remove()
  }
}

/** @type {Types.fireConfetti} */
export function fireConfetti(accent) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const container = document.createElement("div")
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden"
  document.body.appendChild(container)

  const colors = accentPalette(CONFETTI_COLORS, accent)
  const count = window.innerWidth < 768 ? 40 : 80
  let remaining = count
  // animationDuration max 2.7s + animationDelay max 0.3s = 3.0s worst case.
  const cleanup = armContainerSafetyNet(container, 3500)

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div")
    piece.className = "confetti-piece"

    const w = 6 + Math.random() * 6
    const h = Math.random() > 0.5 ? w : w * 2.5
    piece.style.width = w + "px"
    piece.style.height = h + "px"
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)]

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
      if (remaining <= 0) cleanup()
    })

    container.appendChild(piece)
  }
}

const FIZZ_COLORS = [
  "#ffd700",
  "#ffe9a1",
  "#fff3b0",
  "#ffcf40",
  cssBrand("--effect-brand", "rgb(221, 115, 100)"),
]

const HEART_COLORS = ["var(--color-primary)", "#ff6b9d", "#ffb7c5", "#ff8fa3"]

/** Resolve the origin point (viewport px) for a one-shot: the centre of
 *  `originEl` if given, else `fallback`.
 *  @param {HTMLElement | null | undefined} originEl
 *  @param {{ x: number, y: number }} fallback
 *  @returns {{ x: number, y: number }} */
function originPoint(originEl, fallback) {
  if (originEl) {
    const rect = originEl.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
  return fallback
}

/** @param {HTMLElement} el @param {() => void} onDone */
function removeOnEnd(el, onDone) {
  el.addEventListener("animationend", function () {
    el.remove()
    onDone()
  })
}

/** @type {Types.champagnePop} */
export function champagnePop(originEl, accent) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const container = document.createElement("div")
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden"
  container.setAttribute("aria-hidden", "true")
  document.body.appendChild(container)

  const { x: cx, y: cy } = originPoint(originEl, {
    x: window.innerWidth / 2,
    y: window.innerHeight - 40,
  })

  const sparkColors = accentPalette(FIZZ_COLORS, accent)
  const sparkCount = window.innerWidth < 768 ? 18 : 32
  let remaining = sparkCount + 2 // sparks + the cork streak + the impact flash
  // Sparks are the longest-lived piece: duration ≤1.3s + delay ≤0.12s ≈ 1.42s.
  const cleanup = armContainerSafetyNet(container, 2000)
  const done = () => {
    remaining--
    if (remaining <= 0) cleanup()
  }

  // Impact flash — a single expanding ring at the origin, fired alongside the
  // cork streak so the pop reads with a burst of light, not just motion.
  const flash = document.createElement("div")
  flash.className = "pop-flash"
  flash.style.left = cx + "px"
  flash.style.top = cy + "px"
  if (accent) flash.style.setProperty("--pop-flash-color", accent)
  removeOnEnd(flash, done)
  container.appendChild(flash)

  // Cork streak — a quick upward trail from the origin.
  const streak = document.createElement("div")
  streak.className = "cork-streak"
  streak.style.left = cx + "px"
  streak.style.top = cy + "px"
  streak.style.setProperty("--pop-tx", (Math.random() - 0.5) * 40 + "px")
  streak.style.setProperty("--pop-ty", -(120 + Math.random() * 90) + "px")
  removeOnEnd(streak, done)
  container.appendChild(streak)

  // Gold fizz spray — radiates up-and-out in the upper hemisphere with a
  // gravity arc (see fizz-spark-fly): each spark overshoots its resting
  // height before settling, instead of traveling a straight radial line.
  for (let i = 0; i < sparkCount; i++) {
    const spark = document.createElement("div")
    spark.className = "fizz-spark"
    // 270deg is straight up in screen coords; spread ±70deg.
    const angle = 270 + (Math.random() - 0.5) * 140
    const rad = (angle * Math.PI) / 180
    const dist = 60 + Math.random() * 160
    const size = 3 + Math.random() * 4
    const color = sparkColors[Math.floor(Math.random() * sparkColors.length)]
    spark.style.left = cx + "px"
    spark.style.top = cy + "px"
    spark.style.width = size + "px"
    spark.style.height = size + "px"
    spark.style.setProperty("--spark-color", color)
    spark.style.color = color
    spark.style.setProperty("--spark-tx", Math.cos(rad) * dist + "px")
    spark.style.setProperty("--spark-ty", Math.sin(rad) * dist + "px")
    spark.style.animationDuration = 0.7 + Math.random() * 0.6 + "s"
    spark.style.animationDelay = Math.random() * 0.12 + "s"
    removeOnEnd(spark, done)
    container.appendChild(spark)
  }
}

/** @type {Types.heartBurst} */
export function heartBurst(originEl, accent) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const container = document.createElement("div")
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden"
  container.setAttribute("aria-hidden", "true")
  document.body.appendChild(container)

  const { x: cx, y: cy } = originPoint(originEl, {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  })

  const heartColors = accentPalette(HEART_COLORS, accent)
  const count = window.innerWidth < 768 ? 10 : 18
  let remaining = count
  // animationDuration max 1.4s + animationDelay max ~0.21s ≈ 1.6s worst case.
  const cleanup = armContainerSafetyNet(container, 2200)
  const done = () => {
    remaining--
    if (remaining <= 0) cleanup()
  }

  // Distance range used below (50–170px) — ring-stagger delay is normalized
  // against it so farther hearts bloom slightly later than near ones.
  const minDist = 50
  const distSpread = 120

  for (let i = 0; i < count; i++) {
    // Outer element flies radially; inner shape holds the static heart rotation.
    const heart = document.createElement("div")
    heart.className = "burst-heart"
    const angle = (i / count) * 360 + (Math.random() * 24 - 12)
    const rad = (angle * Math.PI) / 180
    const dist = minDist + Math.random() * distSpread
    const size = 10 + Math.random() * 10
    // Buoyancy: bias every trajectory upward so the burst blooms rather than
    // scattering evenly in all directions.
    const upwardBias = 20 + Math.random() * 20
    heart.style.left = cx + "px"
    heart.style.top = cy + "px"
    heart.style.setProperty("--burst-tx", Math.cos(rad) * dist + "px")
    heart.style.setProperty("--burst-ty", Math.sin(rad) * dist - upwardBias + "px")
    heart.style.animationDuration = 0.9 + Math.random() * 0.5 + "s"
    // Ring stagger: farther hearts start slightly later so the burst reads as
    // waves blooming outward instead of a single flat pop.
    const ringDelay = ((dist - minDist) / distSpread) * 0.15
    heart.style.animationDelay = ringDelay + Math.random() * 0.06 + "s"

    const shape = document.createElement("div")
    shape.className = "burst-heart-shape"
    shape.style.width = size + "px"
    shape.style.height = size + "px"
    shape.style.backgroundColor = heartColors[i % heartColors.length]
    heart.appendChild(shape)

    removeOnEnd(heart, done)
    container.appendChild(heart)
  }
}

/** @type {Types.sealBreak} */
export function sealBreak(originEl, accent) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  const container = document.createElement("div")
  container.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:1000;overflow:hidden"
  container.setAttribute("aria-hidden", "true")
  document.body.appendChild(container)

  const { x: cx, y: cy } = originPoint(originEl, {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  })

  // The wax colour: the card's accent when given, else the brand tone.
  const wax = accent || cssBrand("--effect-brand", "rgb(184, 92, 102)")
  const shardCount = window.innerWidth < 768 ? 6 : 9
  // Two seal halves + the shards all report back before teardown.
  let remaining = 2 + shardCount
  // Halves fall ~0.7s, shards ≤1.1s — safety net a touch beyond.
  const cleanup = armContainerSafetyNet(container, 1500)
  const done = () => {
    remaining--
    if (remaining <= 0) cleanup()
  }

  // The wax splits into two semicircular halves that rotate + drop apart.
  for (const dir of [-1, 1]) {
    const half = document.createElement("div")
    half.className = dir < 0 ? "tc-seal-half tc-seal-half-l" : "tc-seal-half tc-seal-half-r"
    half.style.left = cx + "px"
    half.style.top = cy + "px"
    half.style.setProperty("--seal-color", wax)
    half.style.setProperty("--half-tx", dir * (22 + Math.random() * 14) + "px")
    half.style.setProperty("--half-rot", dir * (40 + Math.random() * 34) + "deg")
    removeOnEnd(half, done)
    container.appendChild(half)
  }

  // Small wax shards flung outward, each caught by gravity as it flies.
  for (let i = 0; i < shardCount; i++) {
    const shard = document.createElement("div")
    shard.className = "tc-seal-shard"
    const angle = (i / shardCount) * 360 + (Math.random() * 30 - 15)
    const rad = (angle * Math.PI) / 180
    const dist = 28 + Math.random() * 58
    const size = 4 + Math.random() * 5
    shard.style.left = cx + "px"
    shard.style.top = cy + "px"
    shard.style.width = size + "px"
    shard.style.height = size + "px"
    shard.style.setProperty("--seal-color", wax)
    shard.style.setProperty("--shard-tx", Math.cos(rad) * dist + "px")
    shard.style.setProperty("--shard-ty", Math.sin(rad) * dist + "px")
    shard.style.animationDuration = 0.7 + Math.random() * 0.4 + "s"
    removeOnEnd(shard, done)
    container.appendChild(shard)
  }
}

/** @type {Types.flyEmoji} */
export function flyEmoji(glyph, originEl, targetEl) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  if (!glyph || !originEl || !targetEl) return

  const from = originPoint(originEl, { x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const to = originPoint(targetEl, { x: window.innerWidth / 2, y: window.innerHeight / 2 })

  const el = document.createElement("div")
  el.className = "tc-fly-emoji"
  el.setAttribute("aria-hidden", "true")
  el.textContent = glyph
  el.style.left = from.x + "px"
  el.style.top = from.y + "px"
  el.style.setProperty("--fly-tx", to.x - from.x + "px")
  el.style.setProperty("--fly-ty", to.y - from.y + "px")

  // Body-direct like miniSparkle; a safety timer covers a dropped animationend
  // (backgrounded tab) so the fixed node can't leak.
  const safety = setTimeout(() => el.remove(), 1600)
  el.addEventListener("animationend", () => {
    clearTimeout(safety)
    el.remove()
  })
  document.body.appendChild(el)
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
