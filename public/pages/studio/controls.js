/** @file Effect studio — presentation metadata & config serialization.
 *
 *  Keeps studio-only knowledge (human labels, slider bounds, enum options,
 *  and the "copy values" formatter) out of the runtime effect config. New or
 *  unknown params still get a usable control via the heuristic fallback in
 *  numericBounds(), so the studio stays generic across effects.
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
}

/**
 * Resolve the control hint for an effect+param.
 * @param {string} effectId @param {string} param
 * @returns {Types.ControlHint | undefined}
 */
export function getHint(effectId, param) {
  const perEffect = HINTS[effectId]
  return perEffect ? perEffect[param] : undefined
}

/**
 * Resolve numeric slider bounds from a hint, or heuristically from the current
 * value when no hint exists (keeps unknown params usable).
 * @param {number} value @param {Types.ControlHint} [hint]
 * @returns {Types.NumericBounds}
 */
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

/**
 * Format one value as it would appear in config.js `defaults`.
 * @param {unknown} value @param {number} depth
 * @returns {string}
 */
function formatValue(value, depth) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    const allNumbers = value.every((v) => typeof v === "number")
    if (allNumbers) return "[" + value.join(", ") + "]"
    // String arrays (color palettes) print multiline, matching config.js.
    const pad = "  ".repeat(depth + 1)
    const closePad = "  ".repeat(depth)
    const items = value.map((v) => pad + formatValue(v, depth + 1) + ",")
    return "[\n" + items.join("\n") + "\n" + closePad + "]"
  }
  return JSON.stringify(value)
}

/**
 * Serialize a config object as a pasteable `defaults` literal for config.js.
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
export function serializeConfig(config) {
  const lines = Object.entries(config).map(
    ([key, value]) => "  " + key + ": " + formatValue(value, 1) + ",",
  )
  return "{\n" + lines.join("\n") + "\n}"
}
