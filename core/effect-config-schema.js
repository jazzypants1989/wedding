/** @file Server-visible schema of the browser effect-config shape.
 *
 *  `public/effects/config.js` (EFFECT_CONFIGS) is the single source of truth for
 *  effect ids + their tunable keys, but it's a browser module (reads CSS tokens
 *  at import, pulls in DOM types) so the server can't import it without breaking
 *  the server tsconfig. This is a plain-data mirror of just the *ids and keys*,
 *  used by api/admin/effect-config.js to validate an override before storing it.
 *
 *  Drift is guarded by tests/unit/effect-config-schema.test.js, which imports
 *  both this map and the real EFFECT_CONFIGS and asserts the ids + keys match
 *  (same pattern as THEME_IDS ↔ EFFECT_THEMES). When you add or rename an effect
 *  key in config.js, update the matching entry here. Zero deps, no regex.
 */

/** Each effect id → the set of config keys an override may set for it.
 *  @type {Record<string, ReadonlySet<string>>} */
export const EFFECT_CONFIG_KEYS = {
  disco: new Set([
    "spinSpeed", "ballSize", "rayCount", "rayBrightness", "rayColors",
    "tileSize", "tileGap", "rayDurationRange", "rayDelayRange",
  ]),
  cursor: new Set([
    "trailDensity", "trailType", "throttleMs", "fadeSpeed", "size", "colors", "minDistance",
  ]),
  shimmer: new Set(["opacity", "gradientSpeed", "colorPalette", "scaleSize", "gradientAngle"]),
  dividers: new Set(["dotDensity", "color", "animationDelayStep"]),
  namespark: new Set(["shimmerSpeed", "shimmerColor"]),
  textglow: new Set(["intensity", "threshold"]),
  parallaxsparkles: new Set([
    "layerCount", "density", "speedMultiplier", "colorScheme",
    "sizeRange", "opacityRange", "glowThreshold",
  ]),
  entrance: new Set([
    "entranceStyle", "sparkleIntensity", "speed", "colors", "sparkleSizeRange", "waveCount",
  ]),
  spotlight: new Set(["beamCount", "sweepSpeed", "beamWidth", "colors", "colorCycleMs", "beamStagger"]),
  reflections: new Set(["reflectionCount", "speed", "brightness", "colors", "sizeRange", "frameInterval"]),
  petals: new Set(["petalCount", "fallDurationRange", "delayRange", "sizeRange", "swayRange", "colors"]),
  hearts: new Set(["heartCount", "riseDurationRange", "delayRange", "sizeRange", "driftRange", "colors"]),
  dust: new Set(["density", "driftDurationRange", "delayRange", "sizeRange", "swayRange", "colors"]),
  starfield: new Set(["starCount", "sizeRange", "twinkleDurationRange", "delayRange", "colors"]),
  shootingstars: new Set(["streakCount", "cycleDurationRange", "delayRange", "lengthRange", "colors"]),
  aurora: new Set(["opacity", "speed", "palette", "height", "angle"]),
  fireflies: new Set([
    "flyCount", "sizeRange", "blinkDurationRange", "driftDurationRange", "driftRange", "colors",
  ]),
  leaves: new Set(["leafCount", "fallDurationRange", "delayRange", "sizeRange", "swayRange", "colors"]),
  snow: new Set(["flakeCount", "fallDurationRange", "delayRange", "sizeRange", "swayRange", "colors"]),
  frost: new Set(["opacity", "breatheSpeed", "color", "clearRadius"]),
  bubbles: new Set(["bubbleCount", "riseDurationRange", "delayRange", "sizeRange", "wobbleRange"]),
  caustics: new Set(["intensity", "speed", "layerCount"]),
}
