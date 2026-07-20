/** @file Effect control metadata — human labels, slider/enum bounds, and the
 *  numeric-bounds heuristic for the generic per-parameter control UI.
 *
 *  Extracted from the dev-gated studio (public/pages/studio/controls.js) so the
 *  SAME metadata can drive the thank-you card composer's effect editor, which
 *  ships in production. `serializeConfig` (a studio-only "copy values as a
 *  config literal" formatter) intentionally stays behind in studio/controls.js.
 *
 *  New or unknown params still get a usable control via the heuristic fallback
 *  in numericBounds(), so consumers stay generic across every effect.
 */
/** @import * as Types from "./types.js" */

/** Human-friendly names for each effect id (falls back to the id itself). */
export const LABELS = {
  disco: "Disco Ball",
  cursor: "Cursor Trail",
  shimmer: "Mermaid Shimmer",
  dividers: "Sparkle Dividers",
  namespark: "Name Shimmer",
  textglow: "Text Sparkle",
  parallaxsparkles: "Parallax Sparkles",
  entrance: "Grand Entrance",
  spotlight: "Disco Spotlight",
  reflections: "Mirror Reflections",
  petals: "Rose Petals",
  hearts: "Floating Hearts",
  dust: "Golden Dust",
  starfield: "Starfield",
  shootingstars: "Shooting Stars",
  aurora: "Aurora Wash",
  fireflies: "Fireflies",
  leaves: "Falling Leaves",
  snow: "Snowfall",
  frost: "Frost Shimmer",
  bubbles: "Rising Bubbles",
  caustics: "Caustics",
  lanterns: "Paper Lanterns",
  ribbons: "Silk Ribbons",
  fizz: "Champagne Fizz",
  frameglint: "Frame Glint",
  confettidrift: "Confetti Drift",
  inksparkle: "Ink Sparkle",
  tiltdepth: "Tilt Depth",
}

/**
 * Explicit slider bounds / enum options per effect+param. Anything not listed
 * falls back to numericBounds()'s heuristic. Range-tuple params (e.g.
 * sparkleSizeRange) reuse a single hint for both ends.
 * @type {Record<string, Record<string, Types.ControlHint>>}
 */
const HINTS = {
  disco: {
    spinSpeed: { min: 0, max: 20, step: 0.25 },
    ballSize: { min: 20, max: 160, step: 1 },
    rayCount: { min: 0, max: 12, step: 1 },
    rayBrightness: { min: 0, max: 1, step: 0.05 },
    tileSize: { min: 2, max: 20, step: 1 },
    tileGap: { min: 0, max: 8, step: 1 },
    rayDurationRange: { min: 0, max: 15, step: 0.5 },
    rayDelayRange: { min: 0, max: 10, step: 0.5 },
  },
  cursor: {
    trailDensity: { min: 1, max: 60, step: 1 },
    trailType: { options: ["mix", "sparkle", "heart", "star"] },
    throttleMs: { min: 0, max: 200, step: 5 },
    fadeSpeed: { min: 100, max: 2000, step: 50 },
    size: { min: 0.2, max: 3, step: 0.05 },
    minDistance: { min: 0, max: 40, step: 1 },
  },
  shimmer: {
    opacity: { min: 0, max: 1, step: 0.005 },
    gradientSpeed: { min: 0, max: 20, step: 0.5 },
    colorPalette: { options: ["iridescent", "gold", "ocean", "sunset"] },
    scaleSize: { min: 50, max: 500, step: 10 },
    gradientAngle: { min: 0, max: 360, step: 5 },
  },
  dividers: {
    dotDensity: { min: 1, max: 60, step: 1 },
    color: { min: 0, max: 1, step: 0.05 },
    animationDelayStep: { min: 0, max: 1, step: 0.02 },
  },
  namespark: {
    shimmerSpeed: { min: 0, max: 20, step: 0.5 },
    shimmerColor: { options: ["pink", "gold", "white", "brand"] },
  },
  textglow: {
    intensity: { min: 0, max: 20, step: 1 },
    threshold: { min: 0, max: 1, step: 0.05 },
  },
  parallaxsparkles: {
    layerCount: { min: 1, max: 10, step: 1 },
    density: { min: 1, max: 60, step: 1 },
    speedMultiplier: { min: 0, max: 3, step: 0.05 },
    colorScheme: { options: ["rainbow", "gold", "ocean", "monochrome"] },
    sizeRange: { min: 1, max: 20, step: 1 },
    opacityRange: { min: 0, max: 1, step: 0.05 },
    glowThreshold: { min: 0, max: 1, step: 0.05 },
  },
  entrance: {
    entranceStyle: { options: ["curtain", "shower", "golden"] },
    sparkleIntensity: { min: 0, max: 150, step: 1 },
    speed: { min: 0.2, max: 2, step: 0.05 },
    sparkleSizeRange: { min: 1, max: 20, step: 1 },
    waveCount: { min: 1, max: 12, step: 1 },
  },
  spotlight: {
    beamCount: { min: 1, max: 8, step: 1 },
    sweepSpeed: { min: 0, max: 20, step: 0.5 },
    beamWidth: { min: 5, max: 100, step: 1 },
    colorCycleMs: { min: 0, max: 10000, step: 250 },
    beamStagger: { min: 0, max: 5, step: 0.1 },
  },
  reflections: {
    reflectionCount: { min: 0, max: 60, step: 1 },
    speed: { min: 0, max: 3, step: 0.05 },
    brightness: { min: 0, max: 1, step: 0.025 },
    sizeRange: { min: 1, max: 30, step: 1 },
    frameInterval: { min: 16, max: 200, step: 1 },
  },
  // ---- Ambient effects (defaults are heuristic-friendly, but a few params
  //      need explicit bounds/options to keep the studio sliders sensible). ----
  petals: {
    petalCount: { min: 1, max: 60, step: 1 },
    fallDurationRange: { min: 1, max: 30, step: 0.5 },
    delayRange: { min: 0, max: 20, step: 0.5 },
    sizeRange: { min: 4, max: 40, step: 1 },
    swayRange: { min: 0, max: 160, step: 1 },
  },
  hearts: {
    heartCount: { min: 1, max: 60, step: 1 },
    riseDurationRange: { min: 1, max: 30, step: 0.5 },
    delayRange: { min: 0, max: 20, step: 0.5 },
    sizeRange: { min: 4, max: 40, step: 1 },
    driftRange: { min: 0, max: 160, step: 1 },
  },
  dust: {
    density: { min: 1, max: 80, step: 1 },
    driftDurationRange: { min: 2, max: 40, step: 0.5 },
    delayRange: { min: 0, max: 24, step: 0.5 },
    sizeRange: { min: 1, max: 14, step: 0.5 },
    swayRange: { min: 0, max: 90, step: 1 },
  },
  starfield: {
    starCount: { min: 1, max: 200, step: 1 },
    sizeRange: { min: 1, max: 10, step: 0.5 },
    twinkleDurationRange: { min: 1, max: 12, step: 0.5 },
    delayRange: { min: 0, max: 12, step: 0.5 },
  },
  shootingstars: {
    streakCount: { min: 1, max: 20, step: 1 },
    cycleDurationRange: { min: 2, max: 24, step: 0.5 },
    delayRange: { min: 0, max: 24, step: 0.5 },
    lengthRange: { min: 40, max: 400, step: 5 },
  },
  aurora: {
    opacity: { min: 0, max: 1, step: 0.01 },
    speed: { min: 4, max: 60, step: 1 },
    palette: { options: ["aurora", "polar", "dusk"] },
    height: { min: 10, max: 100, step: 1 },
    angle: { min: 0, max: 360, step: 1 },
  },
  fireflies: {
    flyCount: { min: 1, max: 80, step: 1 },
    sizeRange: { min: 1, max: 12, step: 0.5 },
    blinkDurationRange: { min: 1, max: 12, step: 0.5 },
    driftDurationRange: { min: 2, max: 30, step: 0.5 },
    driftRange: { min: 0, max: 160, step: 1 },
  },
  leaves: {
    leafCount: { min: 1, max: 60, step: 1 },
    fallDurationRange: { min: 2, max: 30, step: 0.5 },
    delayRange: { min: 0, max: 20, step: 0.5 },
    sizeRange: { min: 4, max: 40, step: 1 },
    swayRange: { min: 0, max: 160, step: 1 },
  },
  snow: {
    flakeCount: { min: 1, max: 120, step: 1 },
    fallDurationRange: { min: 2, max: 30, step: 0.5 },
    delayRange: { min: 0, max: 20, step: 0.5 },
    sizeRange: { min: 1, max: 16, step: 0.5 },
    swayRange: { min: 0, max: 120, step: 1 },
  },
  frost: {
    opacity: { min: 0, max: 1, step: 0.05 },
    breatheSpeed: { min: 1, max: 30, step: 0.5 },
    clearRadius: { min: 0, max: 100, step: 1 },
  },
  bubbles: {
    bubbleCount: { min: 1, max: 80, step: 1 },
    riseDurationRange: { min: 2, max: 30, step: 0.5 },
    delayRange: { min: 0, max: 20, step: 0.5 },
    sizeRange: { min: 2, max: 48, step: 1 },
    wobbleRange: { min: 0, max: 120, step: 1 },
  },
  caustics: {
    intensity: { min: 0, max: 100, step: 1 },
    speed: { min: 0, max: 100, step: 1 },
    layerCount: { min: 1, max: 5, step: 1 },
  },
  // ---- Six new ambient effects ----
  lanterns: {
    lanternCount: { min: 1, max: 40, step: 1 },
    riseDurationRange: { min: 4, max: 40, step: 0.5 },
    delayRange: { min: 0, max: 20, step: 0.5 },
    sizeRange: { min: 8, max: 60, step: 1 },
    swayRange: { min: 0, max: 120, step: 1 },
  },
  ribbons: {
    ribbonCount: { min: 1, max: 20, step: 1 },
    unfurlDurationRange: { min: 3, max: 30, step: 0.5 },
    delayRange: { min: 0, max: 16, step: 0.5 },
    widthRange: { min: 4, max: 40, step: 1 },
  },
  fizz: {
    streamCount: { min: 1, max: 10, step: 1 },
    bubblesPerStream: { min: 2, max: 40, step: 1 },
    riseDurationRange: { min: 1, max: 16, step: 0.5 },
    delayRange: { min: 0, max: 12, step: 0.5 },
    sizeRange: { min: 1, max: 12, step: 0.5 },
  },
  frameglint: {
    sweepIntervalMs: { min: 1000, max: 20000, step: 250 },
    sweepDurationMs: { min: 200, max: 4000, step: 100 },
    angle: { min: 0, max: 90, step: 1 },
    intensity: { min: 0, max: 1, step: 0.05 },
  },
  confettidrift: {
    pieceCount: { min: 1, max: 60, step: 1 },
    fallDurationRange: { min: 2, max: 30, step: 0.5 },
    delayRange: { min: 0, max: 20, step: 0.5 },
    sizeRange: { min: 2, max: 24, step: 1 },
    spinRange: { min: 0, max: 1080, step: 10 },
  },
  inksparkle: {
    glyphCount: { min: 1, max: 40, step: 1 },
    driftDurationRange: { min: 2, max: 24, step: 0.5 },
    delayRange: { min: 0, max: 16, step: 0.5 },
    sizeRange: { min: 6, max: 40, step: 1 },
    // glyphs is a string[] of text characters, not colors — render text chips.
    glyphs: { kind: "glyphs" },
  },
  tiltdepth: {
    // selector is a free-text string (no options) → the generic builder renders
    // a plain text field; the two numbers get sliders.
    maxTilt: { min: 0, max: 20, step: 0.5 },
    depth: { min: 0, max: 60, step: 1 },
  },
}

/** @type {Types.getHint} */
export function getHint(effectId, param) {
  const perEffect = HINTS[effectId]
  return perEffect ? perEffect[param] : undefined
}

/** @type {Types.numericBounds} */
export function numericBounds(value, hint) {
  if (hint && hint.min !== undefined && hint.max !== undefined) {
    const step =
      hint.step !== undefined
        ? hint.step
        : hint.max <= 1
          ? 0.01
          : Number.isInteger(hint.min) && Number.isInteger(hint.max)
            ? 1
            : 0.05
    return { min: hint.min, max: hint.max, step }
  }
  if (value > 0 && value < 1) return { min: 0, max: 1, step: 0.01 }
  if (Number.isInteger(value)) {
    return { min: 0, max: Math.max(10, value * 3), step: 1 }
  }
  return { min: 0, max: Math.max(1, Math.round(value * 3)), step: 0.05 }
}
