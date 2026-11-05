/** @file Effect themes — which effects run + per-effect config overrides, per theme.
 *
 * A theme selects a *subset* of the shared effect registry (EFFECT_DEFINITIONS in
 * main.js) by id, and may carry per-effect config overrides that are deep-merged
 * over the defaults (see getEffectiveConfig in config.js). One of those keys,
 * `pages` ("all" or a list of page ids), says where the effect runs; without it
 * the effect stays on the landing page. The active theme is
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
    // The two that follow a guest around the site. Everything else stays on the
    // landing page, which is what a missing `pages` means.
    configs: {
      cursor: { pages: "all" },
      parallaxsparkles: { pages: "all" },
    },
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
    // Refined, calm: fine champagne dust + sparse gold accents, a whisper of
    // calligraphy sparkle, and a gentle depth-tilt on the couple photo.
    effectIds: ["dust", "namespark", "dividers", "parallaxsparkles", "inksparkle", "tiltdepth"],
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
      // Sparse gold-only glyphs so the calligraphy sparkle stays refined.
      inksparkle: { glyphCount: 9, glyphs: ["✧", "✦"] },
      // Multi-target selector: the couple/hero photo on the landing page, and
      // card/polaroid frames where this theme rides a thank-you card. No match
      // on a page → the effect no-ops. Conservative tilt so it's barely-there.
      tiltdepth: {
        selector: ".couple-photo, .hero-image, .tc-card, .tc-polaroid",
        maxTilt: 4,
        depth: 8,
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
  {
    id: "celestial",
    label: "Celestial",
    // Night sky: twinkling stars, rare shooting streaks, a slow aurora band.
    effectIds: ["starfield", "shootingstars", "aurora", "namespark", "dividers"],
    configs: {
      namespark: { shimmerColor: "white" },
      dividers: { dotDensity: 10, color: 0.4 },
      aurora: { palette: "aurora", opacity: 0.14 },
    },
  },
  {
    id: "garden",
    label: "Garden",
    // Warm daylight garden: blinking fireflies, tumbling leaves, drifting blossoms.
    effectIds: ["fireflies", "leaves", "petals", "namespark", "dividers"],
    configs: {
      namespark: { shimmerColor: "gold" },
      dividers: { dotDensity: 12, color: 0.6 },
      petals: {
        // Recolor petals as soft spring blossoms so they sit with the greens.
        colors: ["#f4c2d0", "#ffd9e2", "#ffffff", "#f6b8a8"],
        petalCount: 14,
      },
    },
  },
  {
    id: "winter",
    label: "Winter",
    // Cool and still: falling snow under a breathing frosted vignette.
    effectIds: ["snow", "frost", "namespark", "dividers"],
    configs: {
      namespark: { shimmerColor: "white" },
      dividers: { dotDensity: 10, color: 0.3 },
      frost: { opacity: 0.45 },
    },
  },
  {
    id: "coastal",
    label: "Coastal",
    // Underwater calm: rising bubbles over shifting light caustics + an ocean sheen.
    effectIds: ["bubbles", "caustics", "shimmer", "namespark", "dividers"],
    configs: {
      namespark: { shimmerColor: "white" },
      dividers: { dotDensity: 12, color: 0.5 },
      shimmer: { colorPalette: "ocean", opacity: 0.13 },
      caustics: { intensity: 45 },
    },
  },
  {
    id: "celebration",
    label: "Celebration",
    // Warm-gold jubilation: champagne fizz, rising paper lanterns, light dust,
    // and a gentle drift of tumbling confetti over it all.
    effectIds: ["fizz", "lanterns", "dust", "confettidrift", "namespark", "dividers"],
    configs: {
      namespark: { shimmerColor: "gold" },
      dividers: { dotDensity: 14, color: 0.7 },
      fizz: { streamCount: 4 },
      lanterns: { lanternCount: 8 },
      dust: { density: 20 },
      // Sparse, slow confetti so it reads as ambient jubilation, not a party popper.
      confettidrift: { pieceCount: 12 },
    },
  },
  {
    id: "gratitude",
    label: "Gratitude",
    // Tender rose thank-you: drifting petals, edge ribbons, rising hearts, a
    // whisper of calligraphy sparkle, and a soft glint across framed keepsakes.
    effectIds: ["petals", "ribbons", "hearts", "inksparkle", "frameglint", "namespark", "dividers"],
    configs: {
      namespark: { shimmerColor: "pink" },
      dividers: { dotDensity: 12, color: 0.7 },
      // No color override: the petals default (config.js) already reads the
      // --fx-rose-* tokens, which retint for light/dark automatically — a
      // hardcoded hex list here would fight that and go stale on retheme.
      petals: { petalCount: 14 },
      hearts: { heartCount: 12 },
      inksparkle: { glyphCount: 9 },
      // Subtle, slow specular sweep across any framed keepsake (.tc-polaroid).
      frameglint: { intensity: 0.4, sweepIntervalMs: 8000 },
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
