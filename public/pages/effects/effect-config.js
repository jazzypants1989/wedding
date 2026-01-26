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

  hearts: {
    defaults: {
      speed: 50,
      density: 50,
      sizeMin: 0.5,
      sizeMax: 1.5,
      swayIntensity: 50,
      colors: ["rgb(221, 115, 100)", "#ff69b4", "#ff8fa3", "#e8747c", "#f4978e"],
    },
    schema: {
      speed: { type: "slider", label: "Float Speed", min: 0, max: 100, step: 1 },
      density: { type: "slider", label: "Density", min: 0, max: 100, step: 1 },
      sizeMin: { type: "slider", label: "Min Size", min: 0.2, max: 1.5, step: 0.1 },
      sizeMax: { type: "slider", label: "Max Size", min: 0.5, max: 2.5, step: 0.1 },
      swayIntensity: { type: "slider", label: "Sway Intensity", min: 0, max: 100, step: 1 },
      colors: {
        type: "colorPalette",
        label: "Colors",
        presets: ["rgb(221, 115, 100)", "#ff69b4", "#ff8fa3", "#e8747c", "#f4978e", "#ff1493", "#dc143c", "#ffd700"],
      },
    },
  },

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

  confetti: {
    defaults: {
      particleCount: 50,
      burstOrigin: "click",
      gravity: 50,
      colors: ["rgb(221, 115, 100)", "#ff69b4", "#ffd700", "#87ceeb", "#fff", "#f4978e", "#c44dff"],
    },
    schema: {
      particleCount: { type: "slider", label: "Particle Count", min: 10, max: 100, step: 5 },
      burstOrigin: {
        type: "select",
        label: "Burst Origin",
        choices: [
          { value: "click", label: "Click Position" },
          { value: "center", label: "Center Top" },
        ],
      },
      gravity: { type: "slider", label: "Gravity", min: 0, max: 100, step: 1 },
      colors: {
        type: "colorPalette",
        label: "Colors",
        presets: ["rgb(221, 115, 100)", "#ff69b4", "#ffd700", "#87ceeb", "#fff", "#f4978e", "#c44dff", "#ff1493"],
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

  rain: {
    defaults: {
      fallSpeed: 50,
      density: 50,
      driftAmount: 50,
      glowIntensity: 50,
    },
    schema: {
      fallSpeed: { type: "slider", label: "Fall Speed", min: 0, max: 100, step: 1 },
      density: { type: "slider", label: "Density", min: 0, max: 100, step: 1 },
      driftAmount: { type: "slider", label: "Drift Amount", min: 0, max: 100, step: 1 },
      glowIntensity: { type: "slider", label: "Glow Intensity", min: 0, max: 100, step: 1 },
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

  bubbles: {
    defaults: {
      sizeMin: 20,
      sizeMax: 60,
      riseSpeed: 50,
      density: 50,
      transparency: 50,
    },
    schema: {
      sizeMin: { type: "slider", label: "Min Size (px)", min: 10, max: 40, step: 2 },
      sizeMax: { type: "slider", label: "Max Size (px)", min: 30, max: 80, step: 2 },
      riseSpeed: { type: "slider", label: "Rise Speed", min: 0, max: 100, step: 1 },
      density: { type: "slider", label: "Density", min: 0, max: 100, step: 1 },
      transparency: { type: "slider", label: "Transparency", min: 0, max: 100, step: 1 },
    },
  },

  starfield: {
    defaults: {
      starCount: 50,
      pulseSpeed: 50,
      brightness: 50,
      colorDistribution: "mixed",
    },
    schema: {
      starCount: { type: "slider", label: "Star Count", min: 10, max: 100, step: 5 },
      pulseSpeed: { type: "slider", label: "Pulse Speed", min: 0, max: 100, step: 1 },
      brightness: { type: "slider", label: "Brightness", min: 0, max: 100, step: 1 },
      colorDistribution: {
        type: "select",
        label: "Color Distribution",
        choices: [
          { value: "mixed", label: "Mixed (white, gold, rose)" },
          { value: "white", label: "White Only" },
          { value: "warm", label: "Warm (gold, rose)" },
        ],
      },
    },
  },

  // ==================== New Effects ====================

  petals: {
    defaults: {
      density: 50,
      windDirection: 50,
      sizeMin: 0.7,
      sizeMax: 1.3,
      colors: ["rgb(221, 115, 100)", "#ff69b4", "#ff8fa3", "#e8747c", "#f4978e", "#dc143c", "#c44040"],
    },
    schema: {
      density: { type: "slider", label: "Density", min: 0, max: 100, step: 1 },
      windDirection: { type: "slider", label: "Wind Direction", min: 0, max: 100, step: 1 },
      sizeMin: { type: "slider", label: "Min Size", min: 0.3, max: 1.0, step: 0.1 },
      sizeMax: { type: "slider", label: "Max Size", min: 0.8, max: 2.0, step: 0.1 },
      colors: {
        type: "colorPalette",
        label: "Colors",
        presets: ["rgb(221, 115, 100)", "#ff69b4", "#ff8fa3", "#e8747c", "#f4978e", "#dc143c", "#c44040", "#ffd700"],
      },
    },
  },

  shooting: {
    defaults: {
      frequency: 50,
      trailLength: 50,
      colorTint: "white",
    },
    schema: {
      frequency: { type: "slider", label: "Frequency", min: 0, max: 100, step: 1 },
      trailLength: { type: "slider", label: "Trail Length", min: 0, max: 100, step: 1 },
      colorTint: {
        type: "select",
        label: "Color Tint",
        choices: [
          { value: "white", label: "Classic White" },
          { value: "golden", label: "Golden" },
          { value: "rose", label: "Rose" },
          { value: "mixed", label: "Mixed" },
        ],
      },
    },
  },

  fireflies: {
    defaults: {
      warmth: 50,
      count: 50,
      glowIntensity: 50,
    },
    schema: {
      warmth: { type: "slider", label: "Warmth", min: 0, max: 100, step: 1 },
      count: { type: "slider", label: "Count", min: 0, max: 100, step: 1 },
      glowIntensity: { type: "slider", label: "Glow Intensity", min: 0, max: 100, step: 1 },
    },
  },

  aurora: {
    defaults: {
      colorPalette: "cool",
      intensity: 50,
      speed: 50,
    },
    schema: {
      colorPalette: {
        type: "select",
        label: "Color Palette",
        choices: [
          { value: "cool", label: "Northern (cool)" },
          { value: "warm", label: "Tropical (warm)" },
          { value: "pastel", label: "Pastel Dream" },
        ],
      },
      intensity: { type: "slider", label: "Intensity", min: 0, max: 100, step: 1 },
      speed: { type: "slider", label: "Wave Speed", min: 0, max: 100, step: 1 },
    },
  },

  constellation: {
    defaults: {
      connectionDensity: 50,
      lineColor: 50,
      starCount: 50,
    },
    schema: {
      connectionDensity: { type: "slider", label: "Connection Density", min: 0, max: 100, step: 1 },
      lineColor: { type: "slider", label: "Line Brightness", min: 0, max: 100, step: 1 },
      starCount: { type: "slider", label: "Star Count", min: 0, max: 100, step: 1 },
    },
  },

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

  envelope: {
    defaults: {
      frequency: 50,
    },
    schema: {
      frequency: { type: "slider", label: "Open Frequency", min: 0, max: 100, step: 1 },
    },
  },

  golden: {
    defaults: {
      mode: "auto",
    },
    schema: {
      mode: {
        type: "select",
        label: "Mode",
        choices: [
          { value: "auto", label: "Auto (time-based)" },
          { value: "day", label: "Day" },
          { value: "golden", label: "Golden Hour" },
          { value: "night", label: "Night" },
        ],
      },
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

  ripple: {
    defaults: {
      ringCount: 2,
      color: 50,
    },
    schema: {
      ringCount: { type: "slider", label: "Ring Count", min: 1, max: 3, step: 1 },
      color: { type: "slider", label: "Color Warmth", min: 0, max: 100, step: 1 },
    },
  },

  discofloor: {
    defaults: {
      tileCount: 50,
      colorPalette: 50,
      pattern: "chase",
    },
    schema: {
      tileCount: { type: "slider", label: "Tile Count", min: 0, max: 100, step: 1 },
      colorPalette: { type: "slider", label: "Color Variety", min: 0, max: 100, step: 1 },
      pattern: {
        type: "select",
        label: "Pattern",
        choices: [
          { value: "chase", label: "Chase" },
          { value: "pulse", label: "Pulse" },
          { value: "rainbow", label: "Rainbow Sweep" },
          { value: "wave", label: "Wave" },
        ],
      },
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
    effectIds: ["hearts", "sparkles", "rain", "shimmer", "bubbles", "starfield", "petals", "fireflies", "aurora", "constellation", "caustics", "parallaxsparkles"],
  },
  interactive: {
    label: "Interactive",
    effectIds: ["confetti", "cursor", "burst", "ripple", "textglow", "scrollconfetti", "entrance"],
  },
  decorative: {
    label: "Decorative",
    effectIds: ["disco", "dividers", "namespark", "envelope", "golden", "discofloor", "shooting", "spotlight", "reflections"],
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
