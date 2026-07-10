/** @file Effect themes — which effects run + per-effect config overrides, per theme.
 *
 * A theme selects a *subset* of the shared effect registry (EFFECT_DEFINITIONS in
 * main.js) by id, and may carry per-effect config overrides that are deep-merged
 * over the defaults (see getEffectiveConfig in config.js). The active theme is
 * chosen by SiteContent.theme, rendered by the server into the <html
 * data-effect-theme> attribute, and read back here on the client.
 *
 * To add a theme: append an entry below, then add a matching
 * `:root[data-effect-theme="<id>"]` brand block in public/styles/tokens.css. The
 * admin picker reads EFFECT_THEMES directly, so it updates automatically.
 */
/** @import * as Types from './types.js' */

/** Shipped default — the original "mermaid-disco" identity. Kept as a literal
 *  here and in content.js / core/static.js (server can't import this browser
 *  module), so all three must agree. */
export const DEFAULT_THEME_ID = "mermaid-disco"

/** @type {Types.EffectTheme[]} */
export const EFFECT_THEMES = [
  {
    id: "mermaid-disco",
    label: "Mermaid Disco",
    // The full registry, unchanged — this is the site's original look.
    effectIds: [
      "disco",
      "cursor",
      "shimmer",
      "dividers",
      "namespark",
      "textglow",
      "parallaxsparkles",
      "entrance",
      "spotlight",
      "reflections",
    ],
  },
  {
    id: "romantic",
    label: "Romantic",
    // Warm, tender: drifting petals + rising hearts over a rose palette.
    effectIds: ["petals", "hearts", "namespark", "shimmer", "dividers", "entrance"],
    configs: {
      namespark: { shimmerColor: "pink" },
      shimmer: { colorPalette: "sunset", opacity: 0.14 },
      dividers: { dotDensity: 14, color: 0.7 },
      entrance: { entranceStyle: "shower", sparkleIntensity: 40, waveCount: 3, speed: 0.8 },
    },
  },
  {
    id: "elegant",
    label: "Elegant",
    // Refined, calm: fine champagne dust + sparse gold accents.
    effectIds: ["dust", "namespark", "dividers", "parallaxsparkles"],
    configs: {
      namespark: { shimmerColor: "gold" },
      dividers: { dotDensity: 10, color: 0.7 },
      parallaxsparkles: {
        colorScheme: "gold",
        density: 10,
        layerCount: 3,
        opacityRange: [0.15, 0.45],
        glowThreshold: 0.85,
      },
    },
  },
  {
    id: "classic",
    label: "Classic",
    // Near-quiet baseline: a whisper of shimmer on the names + faint dividers.
    effectIds: ["namespark", "dividers"],
    configs: {
      namespark: { shimmerColor: "white" },
      dividers: { dotDensity: 8, color: 0.1 },
    },
  },
]

/** @type {Types.resolveTheme} */
export function resolveTheme(id) {
  for (const theme of EFFECT_THEMES) {
    if (theme.id === id) return theme
  }
  // Unknown / missing id → fall back to the shipped default so a stale or
  // garbage attribute never breaks the page.
  for (const theme of EFFECT_THEMES) {
    if (theme.id === DEFAULT_THEME_ID) return theme
  }
  return EFFECT_THEMES[0]
}

/** @type {Types.getActiveThemeId} */
export function getActiveThemeId() {
  try {
    if (typeof document === "undefined") return DEFAULT_THEME_ID
    return document.documentElement.dataset.effectTheme || DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

/** @type {Types.getActiveTheme} */
export function getActiveTheme() {
  return resolveTheme(getActiveThemeId())
}
