/** @file Registry iframe lazy-loading */
/** @import * as Types from './types.js' */

import { getElement, getIFrameElement } from "./utils.js"

/** @type {Types.initRegistryFrame} */
export function initRegistryFrame() {
  const registrySection = getElement("registry")
  const frame = getIFrameElement("registry-frame")
  const registryLink = getElement("registry-link")
  const observer = new IntersectionObserver(
    (entries, obs) => {
      if (entries[0].isIntersecting) {
        frame.src = frame.dataset.src || ""
        frame.hidden = false
        registryLink.hidden = false
        obs.disconnect()
      }
    },
    { rootMargin: "200px" },
  )
  observer.observe(registrySection)
}
