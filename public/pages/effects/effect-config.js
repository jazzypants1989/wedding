/** @file Effect configuration — default values and schema for all effects */

/**
 * @typedef {object} ControlSchema
 * @property {string} type - "slider" | "colorPalette" | "select" | "toggle"
 * @property {string} label - Human-readable label
 * @property {number} [min] - Slider min
 * @property {number} [max] - Slider max
 * @property {number} [step] - Slider step
 * @property {string[]} [presets] - Color palette presets
 * @property {Array<{value: string, label: string}>} [choices] - Select choices
 */

/**
 * @typedef {object} EffectConfigEntry
 * @property {Record<string, *>} defaults - Default config values
 * @property {Record<string, ControlSchema>} schema - Schema describing each control
 */

/** Wedding color palette for reuse across effects */
export const WEDDING_COLORS = [
  "rgb(221, 115, 100)",
  "#ff69b4",
  "#ff8fa3",
  "#e8747c",
  "#f4978e",
  "#ffd700",
  "#ffe4e1",
  "#fff",
  "#87ceeb",
  "#c44dff",
]

/** @type {Record<string, EffectConfigEntry>} */
export const EFFECT_CONFIGS = {
  // ==================== Existing Effects ====================

  sparkles: {
    defaults: {
      twinkleSpeed: 50,
      starSize: 50,
      spawnDensity: 50,
      colorMix: ["#fff", "#ffd700", "#ffe4e1", "rgb(221, 115, 100)"],
    },
    schema: {
      twinkleSpeed: { type: "slider", label: "Twinkle Speed", min: 0, max: 100, step: 1 },
      starSize: { type: "slider", label: "Star Size", min: 0, max: 100, step: 1 },
      spawnDensity: { type: "slider", label: "Spawn Density", min: 0, max: 100, step: 1 },
      colorMix: {
        type: "colorPalette",
        label: "Colors",
        presets: ["#fff", "#ffd700", "#ffe4e1", "rgb(221, 115, 100)", "#87ceeb", "#c44dff"],
      },
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
    schema: {
      spinSpeed: { type: "slider", label: "Spin Speed", min: 0, max: 100, step: 1 },
      ballSize: { type: "slider", label: "Ball Size", min: 0, max: 100, step: 1 },
      rayCount: { type: "slider", label: "Number of Rays", min: 2, max: 10, step: 1 },
      rayBrightness: { type: "slider", label: "Ray Brightness", min: 0, max: 100, step: 1 },
      rayColors: {
        type: "colorPalette",
        label: "Ray Colors",
        presets: ["#ffffff", "#ffcccc", "#ccccff", "#ffffcc", "#ccffcc", "#ffccff", "#ffd700", "#ff69b4"],
      },
    },
  },

  cursor: {
    defaults: {
      trailDensity: 50,
      trailType: "mix",
      fadeSpeed: 50,
      size: 50,
    },
    schema: {
      trailDensity: { type: "slider", label: "Trail Density", min: 0, max: 100, step: 1 },
      trailType: {
        type: "select",
        label: "Trail Type",
        choices: [
          { value: "mix", label: "Mix" },
          { value: "hearts", label: "Hearts" },
          { value: "sparkles", label: "Sparkles" },
          { value: "rings", label: "Rings" },
        ],
      },
      fadeSpeed: { type: "slider", label: "Fade Speed", min: 0, max: 100, step: 1 },
      size: { type: "slider", label: "Size", min: 0, max: 100, step: 1 },
    },
  },

  shimmer: {
    defaults: {
      opacity: 50,
      gradientSpeed: 50,
      colorPalette: "iridescent",
      scaleSize: 50,
    },
    schema: {
      opacity: { type: "slider", label: "Opacity", min: 0, max: 100, step: 1 },
      gradientSpeed: { type: "slider", label: "Gradient Speed", min: 0, max: 100, step: 1 },
      colorPalette: {
        type: "select",
        label: "Color Palette",
        choices: [
          { value: "iridescent", label: "Iridescent" },
          { value: "ocean", label: "Ocean" },
          { value: "sunset", label: "Sunset" },
        ],
      },
      scaleSize: { type: "slider", label: "Scale Pattern Size", min: 0, max: 100, step: 1 },
    },
  },

  // ==================== New Effects ====================

  burst: {
    defaults: {
      particleCount: 50,
      colors: ["#fff", "#ffd700", "#ffe4e1", "rgb(221, 115, 100)", "#87ceeb", "#c44dff"],
    },
    schema: {
      particleCount: { type: "slider", label: "Particle Count", min: 10, max: 100, step: 5 },
      colors: {
        type: "colorPalette",
        label: "Colors",
        presets: ["#fff", "#ffd700", "#ffe4e1", "rgb(221, 115, 100)", "#87ceeb", "#c44dff", "#ff69b4", "#f4978e"],
      },
    },
  },

  dividers: {
    defaults: {
      dotDensity: 50,
      color: 50,
    },
    schema: {
      dotDensity: { type: "slider", label: "Dot Density", min: 0, max: 100, step: 1 },
      color: { type: "slider", label: "Color Warmth", min: 0, max: 100, step: 1 },
    },
  },

  namespark: {
    defaults: {
      shimmerSpeed: 50,
      shimmerColor: "gold",
    },
    schema: {
      shimmerSpeed: { type: "slider", label: "Shimmer Speed", min: 0, max: 100, step: 1 },
      shimmerColor: {
        type: "select",
        label: "Shimmer Color",
        choices: [
          { value: "gold", label: "Gold" },
          { value: "white", label: "White" },
          { value: "pink", label: "Pink" },
        ],
      },
    },
  },

  caustics: {
    defaults: {
      intensity: 50,
      speed: 50,
    },
    schema: {
      intensity: { type: "slider", label: "Intensity", min: 0, max: 100, step: 1 },
      speed: { type: "slider", label: "Speed", min: 0, max: 100, step: 1 },
    },
  },

  textglow: {
    defaults: {
      intensity: 50,
    },
    schema: {
      intensity: { type: "slider", label: "Glow Intensity", min: 0, max: 100, step: 1 },
    },
  },

  scrollconfetti: {
    defaults: {
      milestoneCount: 4,
      particleCount: 50,
      celebrationStyle: "burst",
      colors: ["rgb(221, 115, 100)", "#ff69b4", "#ffd700", "#87ceeb", "#fff", "#c44dff"],
    },
    schema: {
      milestoneCount: { type: "slider", label: "Milestone Count", min: 2, max: 8, step: 1 },
      particleCount: { type: "slider", label: "Particle Count", min: 10, max: 100, step: 5 },
      celebrationStyle: {
        type: "select",
        label: "Burst Style",
        choices: [
          { value: "burst", label: "Center Burst" },
          { value: "sides", label: "Side Cannons" },
          { value: "rain", label: "Confetti Rain" },
        ],
      },
      colors: {
        type: "colorPalette",
        label: "Colors",
        presets: ["rgb(221, 115, 100)", "#ff69b4", "#ffd700", "#87ceeb", "#fff", "#c44dff", "#f4978e", "#ff1493"],
      },
    },
  },

  parallaxsparkles: {
    defaults: {
      layerCount: 3,
      density: 50,
      speedMultiplier: 50,
      colorScheme: "gold",
    },
    schema: {
      layerCount: { type: "slider", label: "Depth Layers", min: 2, max: 5, step: 1 },
      density: { type: "slider", label: "Sparkle Density", min: 0, max: 100, step: 1 },
      speedMultiplier: { type: "slider", label: "Parallax Strength", min: 0, max: 100, step: 1 },
      colorScheme: {
        type: "select",
        label: "Color Scheme",
        choices: [
          { value: "gold", label: "Gold & White" },
          { value: "rose", label: "Rose & Pink" },
          { value: "cool", label: "Cool & Purple" },
          { value: "mixed", label: "Mixed Rainbow" },
        ],
      },
    },
  },

  entrance: {
    defaults: {
      entranceStyle: "curtain",
      sparkleIntensity: 50,
      speed: 50,
      colors: ["#ffd700", "#fff", "rgb(221, 115, 100)", "#ff69b4", "#87ceeb", "#c44dff"],
    },
    schema: {
      entranceStyle: {
        type: "select",
        label: "Entrance Style",
        choices: [
          { value: "curtain", label: "Curtain Reveal" },
          { value: "shower", label: "Sparkle Shower" },
          { value: "golden", label: "Golden Burst" },
        ],
      },
      sparkleIntensity: { type: "slider", label: "Sparkle Intensity", min: 0, max: 100, step: 1 },
      speed: { type: "slider", label: "Speed", min: 0, max: 100, step: 1 },
      colors: {
        type: "colorPalette",
        label: "Colors",
        presets: ["#ffd700", "#fff", "rgb(221, 115, 100)", "#ff69b4", "#87ceeb", "#c44dff", "#f4978e", "#ffe4e1"],
      },
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
    schema: {
      beamCount: { type: "slider", label: "Beam Count", min: 1, max: 4, step: 1 },
      sweepSpeed: { type: "slider", label: "Sweep Speed", min: 0, max: 100, step: 1 },
      beamWidth: { type: "slider", label: "Beam Width", min: 0, max: 100, step: 1 },
    },
  },

  reflections: {
    defaults: {
      reflectionCount: 50,
      speed: 50,
      brightness: 50,
    },
    schema: {
      reflectionCount: { type: "slider", label: "Reflection Count", min: 0, max: 100, step: 1 },
      speed: { type: "slider", label: "Speed", min: 0, max: 100, step: 1 },
      brightness: { type: "slider", label: "Brightness", min: 0, max: 100, step: 1 },
    },
  },
}

/** Effect category assignments for the control panel */
export const EFFECT_CATEGORIES = {
  ambient: {
    label: "Ambient",
    effectIds: ["sparkles", "shimmer", "caustics", "parallaxsparkles"],
  },
  interactive: {
    label: "Interactive",
    effectIds: ["cursor", "burst", "textglow", "scrollconfetti", "entrance"],
  },
  decorative: {
    label: "Decorative",
    effectIds: ["disco", "dividers", "namespark", "spotlight", "reflections"],
  },
}

/**
 * Get the default config for a given effect ID.
 * @param {string} id
 * @returns {Record<string, *> | null}
 */
export function getDefaultConfig(id) {
  const entry = EFFECT_CONFIGS[id]
  if (!entry) return null
  return structuredClone(entry.defaults)
}

/**
 * Get the schema for a given effect ID.
 * @param {string} id
 * @returns {Record<string, ControlSchema> | null}
 */
export function getSchema(id) {
  const entry = EFFECT_CONFIGS[id]
  if (!entry) return null
  return entry.schema
}

/**
 * Merge a partial config with defaults, filling missing keys.
 * @param {string} id
 * @param {Record<string, *>} partial
 * @returns {Record<string, *>}
 */
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
