/** @file Effect configuration — default values for all effects.
 *
 * To tweak an effect: edit its `defaults` below and refresh.
 * To disable an effect: remove its entry from EFFECT_DEFINITIONS in effect-manager.js.
 */
/** @import * as Types from './types.js' */

/** Shared color palette used across effects */
export const EFFECT_PALETTE = {
  brand: "rgb(221, 115, 100)",
  gold: "#ffd700",
  white: "#fff",
  blush: "#ffe4e1",
  pink: "#ff69b4",
  sky: "#87ceeb",
  purple: "#c44dff",
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

  burst: {
    defaults: {
      particleCount: 60,
      colors: [
        EFFECT_PALETTE.white,
        EFFECT_PALETTE.gold,
        EFFECT_PALETTE.blush,
        EFFECT_PALETTE.brand,
        EFFECT_PALETTE.sky,
        EFFECT_PALETTE.purple,
      ],
      durationRange: [1.5, 3],
      driftRange: [-40, 40],
      scaleRange: [0.5, 1.5],
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
        "rgba(221, 115, 100, 0.15)",
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
}

/** @type {Types.getDefaultConfig} */
export function getDefaultConfig(id) {
  const entry = EFFECT_CONFIGS[id]
  if (!entry) return null
  return structuredClone(entry.defaults)
}
