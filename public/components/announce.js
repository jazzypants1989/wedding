/** @file Shared SR-only polite live region for async updates that change the
 * page visually but silently for screen readers (reaction counts, posted
 * comments). One region per page, lazily created on first announcement —
 * deliberately NOT used for bulk content like feed pages, which would flood.
 */
/** @import * as Types from "./types.js" */

/** @type {HTMLElement | null} */
let liveRegion = null

/** @type {Types.announcePolite} */
export function announcePolite(message) {
  if (!liveRegion) {
    // Screen readers only announce *changes* to a region that was already in
    // the accessibility tree — so on first use, append it empty and set the
    // text in a later frame. Setting textContent in the same synchronous task
    // it was appended drops the first announcement (VoiceOver/NVDA).
    const region = document.createElement("div")
    region.className = "sr-only"
    region.setAttribute("aria-live", "polite")
    document.body.appendChild(region)
    liveRegion = region
    requestAnimationFrame(() => {
      region.textContent = message
    })
    return
  }
  liveRegion.textContent = message
}
