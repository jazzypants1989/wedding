/** @file Card presentation themes — a thin paper/ink/accent/envelope palette per
 *  effect-theme id, harmonized with each theme's brand colors (see the
 *  data-effect-theme brand blocks in public/styles/tokens.css). This is the
 *  card *paper* layer; the ambient particle palette comes for free from setting
 *  document.documentElement.dataset.effectTheme = card.theme.
 *
 *  CARD_THEMES is the runtime source of truth: applyCardTheme() writes the four
 *  values as inline --tc-* custom properties. thanks.css also ships matching
 *  [data-card-theme] blocks as a no-JS fallback (kept in sync by hand; a unit
 *  test asserts CARD_THEMES covers exactly the shipped theme ids). */
/** @import * as Types from "./types.js" */

/** @type {typeof Types.CARD_THEMES} */
export const CARD_THEMES = {
  "mermaid-disco": { paper: "#f7f4ff", ink: "#3a2f5c", accent: "#7c6cd6", envelope: "#6a5acd" },
  romantic: { paper: "#fff5f5", ink: "#7a3a44", accent: "#c67880", envelope: "#b85c66" },
  elegant: { paper: "#fdfaf2", ink: "#5f4a26", accent: "#c6a06e", envelope: "#a9800f" },
  classic: { paper: "#faf9f7", ink: "#403a46", accent: "#8c8290", envelope: "#726b78" },
  celestial: { paper: "#f4f4ff", ink: "#2f2960", accent: "#7c6cd6", envelope: "#4a3f8f" },
  garden: { paper: "#f6fbf1", ink: "#3c5228", accent: "#7aa060", envelope: "#5c7a40" },
  winter: { paper: "#f4faff", ink: "#2f4a62", accent: "#78a0c4", envelope: "#4a6a90" },
  coastal: { paper: "#f1fbfa", ink: "#1f5250", accent: "#4aaaa8", envelope: "#2c6f6d" },
  celebration: { paper: "#fffdf4", ink: "#6a4e18", accent: "#d6a84e", envelope: "#b0862e" },
  gratitude: { paper: "#fff6f8", ink: "#7a3a4e", accent: "#d27890", envelope: "#b85c74" },
}

/** Fallback id when a card names a theme we don't have paper for. */
const FALLBACK_ID = "classic"

/** @type {typeof Types.resolveCardTheme} */
export function resolveCardTheme(id) {
  return CARD_THEMES[id] || CARD_THEMES[FALLBACK_ID]
}

/** @type {typeof Types.applyCardTheme} */
export function applyCardTheme(rootEl, id) {
  const theme = resolveCardTheme(id)
  // data-card-theme carries a known id (never a garbage attribute) so the CSS
  // fallback block matches; inline vars are the authoritative values.
  rootEl.dataset.cardTheme = CARD_THEMES[id] ? id : FALLBACK_ID
  rootEl.style.setProperty("--tc-paper", theme.paper)
  rootEl.style.setProperty("--tc-ink", theme.ink)
  rootEl.style.setProperty("--tc-accent", theme.accent)
  rootEl.style.setProperty("--tc-envelope", theme.envelope)
}
