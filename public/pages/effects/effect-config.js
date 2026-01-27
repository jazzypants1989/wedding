/** @file Effect configuration — default values for all effects.
 *
 * To tweak an effect: edit its `defaults` below and refresh.
 * To disable an effect: remove its entry from EFFECT_DEFINITIONS in effect-manager.js.
 */
/** @import * as Types from './types.js' */

/** @type {typeof Types.EFFECT_CONFIGS} */
export const EFFECT_CONFIGS = {
  sparkles: {
    defaults: {
      twinkleSpeed: 50,
      starSize: 50,
      spawnDensity: 50,
      colorMix: ["#fff", "#ffd700", "#ffe4e1", "rgb(221, 115, 100)"],
    },
  },

  disco: {
    defaults: {
      spinSpeed: 50,
      ballSize: 50,
      rayCount: 6,
      rayBrightness: 50,
      rayColors: [
        "rgba(255, 255, 255, 0.5)",
        "rgba(255, 200, 200, 0.4)",
        "rgba(200, 200, 255, 0.4)",
        "rgba(255, 255, 200, 0.4)",
        "rgba(200, 255, 200, 0.3)",
        "rgba(255, 200, 255, 0.3)",
      ],
    },
  },

  cursor: {
    defaults: {
      trailDensity: 50,
      trailType: "mix",
      fadeSpeed: 50,
      size: 50,
    },
  },

  shimmer: {
    defaults: {
      opacity: 50,
      gradientSpeed: 50,
      colorPalette: "iridescent",
      scaleSize: 50,
    },
  },

  burst: {
    defaults: {
      particleCount: 50,
      colors: [
        "#fff",
        "#ffd700",
        "#ffe4e1",
        "rgb(221, 115, 100)",
        "#87ceeb",
        "#c44dff",
      ],
    },
  },

  dividers: {
    defaults: {
      dotDensity: 50,
      color: 50,
    },
  },

  namespark: {
    defaults: {
      shimmerSpeed: 50,
      shimmerColor: "pink",
    },
  },

  caustics: {
    defaults: {
      intensity: 50,
      speed: 50,
    },
  },

  textglow: {
    defaults: {
      intensity: 50,
    },
  },

  parallaxsparkles: {
    defaults: {
      layerCount: 5,
      density: 35,
      speedMultiplier: 80,
      colorScheme: "rainbow",
    },
  },

  entrance: {
    defaults: {
      entranceStyle: "curtain",
      sparkleIntensity: 50,
      speed: 50,
      colors: [
        "#ffd700",
        "#fff",
        "rgb(221, 115, 100)",
        "#ff69b4",
        "#87ceeb",
        "#c44dff",
      ],
    },
  },

  spotlight: {
    defaults: {
      beamCount: 3,
      sweepSpeed: 50,
      beamWidth: 50,
      colors: [
        "rgba(221, 115, 100, 0.15)",
        "rgba(255, 105, 180, 0.12)",
        "rgba(255, 215, 0, 0.1)",
        "rgba(135, 206, 235, 0.12)",
        "rgba(196, 77, 255, 0.1)",
      ],
    },
  },

  reflections: {
    defaults: {
      reflectionCount: 50,
      speed: 50,
      brightness: 50,
    },
  },
}

/** @type {Types.getDefaultConfig} */
export function getDefaultConfig(id) {
  const entry = EFFECT_CONFIGS[id]
  if (!entry) return null
  return structuredClone(entry.defaults)
}

/** @type {Types.mergeWithDefaults} */
export function mergeWithDefaults(id, partial) {
  const defaults = getDefaultConfig(id)
  if (!defaults) return partial || {}
  if (!partial) return defaults
  const merged = structuredClone(defaults)
  for (const key of Object.keys(partial)) {
    if (key in merged) {
      merged[key] = partial[key]
    }
  }
  return merged
}
