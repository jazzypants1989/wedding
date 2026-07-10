/** @file Effect configuration — default values for all effects.
 *
 * To tweak an effect: edit its `defaults` below and refresh.
 * To disable an effect: remove its entry from EFFECT_DEFINITIONS in effect-manager.js.
 */
/** @import * as Types from './types.js' */

import { getActiveTheme } from "./themes.js"

// Brand color — single source is the `--effect-brand` CSS token
// (public/styles/tokens.css), read here so the palette isn't a second place to
// edit the wedding's brand color. Guarded for non-DOM contexts (tests/SSR); the
// fallback mirrors the token value.
/** Read a CSS custom property off :root, falling back in non-DOM contexts
 *  (tests/SSR) or when the token is absent/empty.
 *  @param {string} name @param {string} fallback @returns {string} */
function readToken(name, fallback) {
  return (
    (typeof getComputedStyle === "function" &&
      getComputedStyle(document.documentElement).getPropertyValue(name).trim()) ||
    fallback
  )
}

const brand = readToken("--effect-brand", "rgb(221, 115, 100)")

/** Compose an `rgba()` from the `rgb(r, g, b)` brand color (no regex). If the
 *  token isn't in functional `rgb(` form (e.g. a hex re-skin), fall back to the
 *  opaque brand color rather than emitting invalid CSS.
 *  @param {number} alpha @returns {string} */
export function brandAlpha(alpha) {
  if (!brand.startsWith("rgb(")) return brand
  return brand.replaceAll("rgb(", "rgba(").replaceAll(")", ", " + alpha + ")")
}

/** Shared color palette used across effects */
export const EFFECT_PALETTE = {
  brand,
  gold: readToken("--effect-gold", "#ffd700"),
  white: readToken("--effect-white", "#fff"),
  blush: readToken("--effect-blush", "#ffe4e1"),
  pink: readToken("--effect-pink", "#ff69b4"),
  sky: readToken("--effect-sky", "#87ceeb"),
  purple: readToken("--effect-purple", "#c44dff"),
}

/** @type {typeof Types.EFFECT_CONFIGS} */
export const EFFECT_CONFIGS = {
  disco: {
    defaults: {
      spinSpeed: 4.75,
      ballSize: 88,
      rayCount: 6,
      rayBrightness: 0.4,
      rayColors: [
        "rgba(255, 255, 255, 0.5)",
        "rgba(255, 200, 200, 0.4)",
        "rgba(200, 200, 255, 0.4)",
        "rgba(255, 255, 200, 0.4)",
        "rgba(200, 255, 200, 0.3)",
        "rgba(255, 200, 255, 0.3)",
      ],
      tileSize: 7,
      tileGap: 1,
      rayDurationRange: [3, 8],
      rayDelayRange: [0, 3],
    },
  },

  cursor: {
    defaults: {
      trailDensity: 23,
      trailType: "mix",
      throttleMs: 65,
      fadeSpeed: 650,
      size: 1.15,
      colors: [
        EFFECT_PALETTE.brand,
        EFFECT_PALETTE.pink,
        EFFECT_PALETTE.gold,
        EFFECT_PALETTE.blush,
        EFFECT_PALETTE.white,
      ],
      minDistance: 5,
    },
  },

  shimmer: {
    defaults: {
      opacity: 0.175,
      gradientSpeed: 5,
      colorPalette: "iridescent",
      scaleSize: 240,
      gradientAngle: 240,
    },
  },

  dividers: {
    defaults: {
      dotDensity: 19,
      color: 0.5,
      animationDelayStep: 0.1,
    },
  },

  namespark: {
    defaults: {
      shimmerSpeed: 8,
      shimmerColor: "pink",
    },
  },

  textglow: {
    defaults: {
      intensity: 8,
      threshold: 0.5,
    },
  },

  parallaxsparkles: {
    defaults: {
      layerCount: 5,
      density: 17,
      speedMultiplier: 0.5,
      colorScheme: "rainbow",
      sizeRange: [2, 5],
      opacityRange: [0.2, 0.7],
      glowThreshold: 0.6,
    },
  },

  entrance: {
    defaults: {
      entranceStyle: "curtain",
      sparkleIntensity: 69,
      speed: 0.95,
      colors: [
        EFFECT_PALETTE.gold,
        EFFECT_PALETTE.white,
        EFFECT_PALETTE.brand,
        EFFECT_PALETTE.pink,
        EFFECT_PALETTE.sky,
        EFFECT_PALETTE.purple,
      ],
      sparkleSizeRange: [3, 8],
      waveCount: 5,
    },
  },

  spotlight: {
    defaults: {
      beamCount: 3,
      sweepSpeed: 7.5,
      beamWidth: 38,
      colors: [
        brandAlpha(0.15),
        "rgba(255, 105, 180, 0.12)",
        "rgba(255, 215, 0, 0.1)",
        "rgba(135, 206, 235, 0.12)",
        "rgba(196, 77, 255, 0.1)",
      ],
      colorCycleMs: 3000,
      beamStagger: 1.5,
    },
  },

  reflections: {
    defaults: {
      reflectionCount: 22,
      speed: 0.9,
      brightness: 0.425,
      colors: [
        "rgba(255, 255, 255, 0.6)",
        "rgba(255, 215, 0, 0.5)",
        "rgba(255, 200, 200, 0.4)",
        "rgba(200, 200, 255, 0.4)",
        "rgba(200, 255, 200, 0.3)",
      ],
      sizeRange: [4, 14],
      frameInterval: 33,
    },
  },

  petals: {
    defaults: {
      petalCount: 18,
      fallDurationRange: [6, 12],
      delayRange: [0, 8],
      sizeRange: [10, 20],
      swayRange: [20, 60],
      colors: ["var(--fx-rose-1)", "var(--fx-rose-3)", "var(--fx-rose-2)", "var(--fx-rose-2)"],
    },
  },

  hearts: {
    defaults: {
      heartCount: 14,
      riseDurationRange: [7, 13],
      delayRange: [0, 9],
      sizeRange: [10, 18],
      driftRange: [15, 50],
      colors: ["var(--fx-rose-1)", "var(--fx-rose-3)", "var(--fx-rose-1)", "var(--fx-rose-2)"],
    },
  },

  dust: {
    defaults: {
      density: 26,
      driftDurationRange: [10, 20],
      delayRange: [0, 12],
      sizeRange: [2, 5],
      swayRange: [10, 30],
      colors: ["var(--fx-gold-1)", "var(--fx-gold-3)", "var(--fx-warm-1)", "var(--fx-gold-2)"],
    },
  },

  starfield: {
    defaults: {
      starCount: 70,
      sizeRange: [1, 3],
      twinkleDurationRange: [2, 6],
      delayRange: [0, 6],
      colors: ["var(--fx-bright)", "var(--fx-cool-1)", "var(--fx-warm-1)", "var(--fx-cool-2)"],
    },
  },

  shootingstars: {
    defaults: {
      streakCount: 5,
      cycleDurationRange: [5, 11],
      delayRange: [0, 12],
      lengthRange: [120, 220],
      colors: ["var(--fx-bright)", "var(--fx-cool-1)", "var(--fx-warm-1)"],
    },
  },

  aurora: {
    defaults: {
      opacity: 0.16,
      speed: 24,
      palette: "aurora",
      height: 55,
      angle: 105,
    },
  },

  fireflies: {
    defaults: {
      flyCount: 22,
      sizeRange: [2, 5],
      blinkDurationRange: [2, 5],
      driftDurationRange: [8, 16],
      driftRange: [20, 70],
      colors: ["var(--fx-gold-1)", "var(--fx-green-2)", "var(--fx-gold-2)", "var(--fx-green-1)"],
    },
  },

  leaves: {
    defaults: {
      leafCount: 16,
      fallDurationRange: [7, 14],
      delayRange: [0, 9],
      sizeRange: [10, 20],
      swayRange: [30, 80],
      colors: ["var(--fx-leaf-1)", "var(--fx-leaf-2)", "var(--fx-gold-3)", "var(--fx-leaf-3)", "var(--fx-leaf-2)"],
    },
  },

  snow: {
    defaults: {
      flakeCount: 40,
      fallDurationRange: [6, 13],
      delayRange: [0, 10],
      sizeRange: [3, 8],
      swayRange: [15, 55],
      colors: ["var(--fx-bright)", "var(--fx-cool-1)", "var(--fx-cool-2)"],
    },
  },

  frost: {
    defaults: {
      opacity: 0.5,
      breatheSpeed: 9,
      color: "#dceeff",
      clearRadius: 42,
    },
  },

  bubbles: {
    defaults: {
      bubbleCount: 20,
      riseDurationRange: [8, 16],
      delayRange: [0, 10],
      sizeRange: [6, 22],
      wobbleRange: [15, 50],
    },
  },

  caustics: {
    defaults: {
      intensity: 55,
      speed: 50,
      layerCount: 3,
    },
  },
}

/** @type {Types.getDefaultConfig} */
export function getDefaultConfig(id) {
  const entry = EFFECT_CONFIGS[id]
  if (!entry) return null
  return structuredClone(entry.defaults)
}

/** Browser localStorage key holding per-browser effect config overrides written
 *  by the effect studio (Track 3). Shape: `{ [effectId]: Partial<config> }`. */
export const OVERRIDE_STORAGE_KEY = "effect-config-override"

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** In-place deep merge mirroring core/site-content.js `applyOverride`: plain
 *  objects recurse (merge key-by-key), arrays/scalars/null replace wholesale,
 *  `undefined` is ignored. Skips prototype-pollution keys. No regex.
 *  @param {Record<string, unknown>} target
 *  @param {Record<string, unknown>} override */
function mergeInto(target, override) {
  for (const key of Object.keys(override)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue
    const val = override[key]
    const cur = target[key]
    if (isPlainObject(val) && isPlainObject(cur)) {
      mergeInto(cur, val)
    } else if (val !== undefined) {
      target[key] = val
    }
  }
}

/** Read the studio's per-browser override map, guarding corrupt/absent JSON by
 *  returning null (mirrors resolveSiteContent's fall-back discipline).
 *  @returns {Record<string, unknown> | null} */
function readLocalOverride() {
  try {
    if (typeof localStorage === "undefined") return null
    const raw = localStorage.getItem(OVERRIDE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** @type {Types.getEffectiveConfig} */
export function getEffectiveConfig(id) {
  // Base is already a structuredClone (getDefaultConfig) — safe to mutate.
  const base = getDefaultConfig(id)
  if (!base) return null
  // Layer 1: the active theme's per-effect override.
  const themeConfigs = getActiveTheme().configs
  const themeCfg = themeConfigs ? themeConfigs[id] : undefined
  if (isPlainObject(themeCfg)) mergeInto(base, themeCfg)
  // Layer 2: the studio's per-browser override (wins over defaults + theme).
  const local = readLocalOverride()
  const localCfg = local ? local[id] : undefined
  if (isPlainObject(localCfg)) mergeInto(base, localCfg)
  return base
}
