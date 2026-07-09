/** @file Registry iframe lazy-loading */
/** @import * as Types from './types.js' */

import { getElement, getIFrameElement } from "./utils.js"

/** @type {Types.initRegistryFrame} */
export function initRegistryFrame() {
  const registrySection = getElement("registry")
  const frame = getIFrameElement("registry-frame")
  // The fallback "open in a new window" link is visible by default (progressive
  // enhancement) so it survives with JS off or if this observer never fires; we
  // only lazy-reveal the heavier iframe alongside it.
  const observer = new IntersectionObserver(
    (entries, obs) => {
      if (entries[0].isIntersecting) {
        frame.src = frame.dataset.src || ""
        frame.hidden = false
        obs.disconnect()
      }
    },
    { rootMargin: "200px" },
  )
  observer.observe(registrySection)
}
