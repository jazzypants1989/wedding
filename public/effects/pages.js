/** @file The guest pages the effect manager can run on, and URL → page.
 *
 *  Its own module, with no imports, so autostart.js can resolve the page without
 *  pulling in the registry (which imports every effect factory).
 */
/** @import * as Types from './types.js' */

/** Every page the manager can run on, in nav order.
 *  @type {readonly Types.EffectPage[]} */
export const EFFECT_PAGES = ["home", "guestbook", "gallery", "rsvp", "memory-book"]

/** The pages an effect can be placed on: what `pages: "all"` means, and the only
 *  ids a `pages` list can usefully name. Not memory-book: that is a print page,
 *  and nothing that animates belongs on it. core/effect-config-schema.js keeps its
 *  own copy for the server (tests/unit/effect-config-schema.test.js guards it).
 *  @type {readonly Types.EffectPage[]} */
export const PLACEABLE_EFFECT_PAGES = ["home", "guestbook", "gallery", "rsvp"]

/** @type {Types.effectPlacedOn} */
export function effectPlacedOn(pages, page) {
  if (!PLACEABLE_EFFECT_PAGES.includes(page)) return false
  if (pages === "all") return true
  if (Array.isArray(pages)) return pages.includes(page)
  // Missing, or a value no layer should have let through: as it always was.
  return page === "home"
}

/** @type {Types.effectPageFromPath} */
export function effectPageFromPath(pathname) {
  const first = pathname.split("/").filter(Boolean)[0]
  if (first === undefined) return "home"
  const page = /** @type {Types.EffectPage} */ (first)
  return first !== "home" && EFFECT_PAGES.includes(page) ? page : null
}
