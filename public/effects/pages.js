/** @file The guest pages the effect manager can run on, and URL → page.
 *
 *  Its own module, with no imports, so autostart.js can resolve the page without
 *  pulling in the registry (which imports every effect factory).
 */
/** @import * as Types from './types.js' */

/** Every page the manager can run on, in nav order.
 *  @type {readonly Types.EffectPage[]} */
export const EFFECT_PAGES = ["home", "guestbook", "gallery", "rsvp", "memory-book"]

/** @type {Types.effectPageFromPath} */
export function effectPageFromPath(pathname) {
  const first = pathname.split("/").filter(Boolean)[0]
  if (first === undefined) return "home"
  const page = /** @type {Types.EffectPage} */ (first)
  return first !== "home" && EFFECT_PAGES.includes(page) ? page : null
}
