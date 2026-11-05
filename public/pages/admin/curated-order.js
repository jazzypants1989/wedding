/** @file The curated grid shows part of a section; reorder takes all of it. Pure,
 *  no DOM, so it runs in a unit test. A row is one of three things to this grid:
 *
 *    on the site    approved
 *    off the site   hidden or pending, shown under Hidden and restorable
 *    neither        rejected or still uploading: never shown, still in the set
 *                   reorder demands
 */
/** @import * as Types from './types.js' */

/** @type {Types.isCuratedRowOnSite} */
export function isCuratedRowOnSite(row) {
  return row.status === "approved"
}

/** @type {Types.isCuratedRowOffSite} */
export function isCuratedRowOffSite(row) {
  return row.status === "hidden" || row.status === "pending"
}

/** @type {Types.applyShownOrder} */
export function applyShownOrder(all, shown) {
  // The shown rows trade places among the slots they already hold; everything
  // else keeps its slot. So reordering what guests see doesn't shuffle the hidden
  // photos, and one that's unhidden later returns to where it was in the sequence.
  const shownIds = new Set(shown.map((row) => row.id))
  let next = 0
  return all.map((row) => (shownIds.has(row.id) ? shown[next++] : row))
}

/** @type {Types.curatedDropIndex} */
export function curatedDropIndex(from, over, after) {
  // The slot is counted in the list as it stands, the dragged photo included.
  // Taking it out first shifts every later slot back by one.
  const slot = after ? over + 1 : over
  return slot > from ? slot - 1 : slot
}
