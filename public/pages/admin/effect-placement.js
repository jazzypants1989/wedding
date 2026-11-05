/** @file The pure half of the Effects tab's page table: read and write the `pages`
 *  key of an override blob without touching anything else in it. No DOM, so
 *  tests/unit/effect-placement.test.js can run it in Node; effect-config.js does
 *  the drawing.
 */
/** @import * as Types from './types.js' */

import { PLACEABLE_EFFECT_PAGES, effectPlacedOn } from "../../effects/pages.js"

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** @type {Types.parseOverrideText} */
export function parseOverrideText(text) {
  const trimmed = text.trim()
  if (!trimmed) return {}
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  for (const id of Object.keys(parsed)) {
    if (!isPlainObject(parsed[id])) return null
  }
  return /** @type {Types.EffectOverride} */ (parsed)
}

/** @type {Types.placementOf} */
export function placementOf(override, theme, id) {
  const partial = Object.hasOwn(override, id) ? override[id] : undefined
  if (partial && Object.hasOwn(partial, "pages")) return partial.pages
  return theme.configs?.[id]?.pages
}

/** @type {Types.toggledPlacement} */
export function toggledPlacement(current, page, on) {
  const pages = PLACEABLE_EFFECT_PAGES.filter((p) =>
    p === page ? on : effectPlacedOn(current, p),
  )
  return pages.length === PLACEABLE_EFFECT_PAGES.length ? "all" : pages
}

/** @type {Types.withPlacement} */
export function withPlacement(override, theme, id, next) {
  const themePages = theme.configs?.[id]?.pages
  const matchesTheme = PLACEABLE_EFFECT_PAGES.every(
    (p) => effectPlacedOn(next, p) === effectPlacedOn(themePages, p),
  )
  const partial = { ...(Object.hasOwn(override, id) ? override[id] : {}) }
  // Back to what the theme says: say nothing, so a later change to the theme still
  // reaches this effect instead of being pinned by a leftover override.
  if (matchesTheme) delete partial.pages
  else partial.pages = next

  const out = { ...override }
  if (Object.keys(partial).length > 0) out[id] = partial
  else delete out[id]
  return out
}
