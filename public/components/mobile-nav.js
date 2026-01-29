/** @file Mobile navigation with hamburger menu */
/** @import * as Types from './types.js' */

import { getElement } from "../pages/utils.js"

/** @type {Types.initMobileNav} */
export function initMobileNav() {
  const button = getElement("hamburger-button")
  const wrapper = getElement("mobile-nav-wrapper")
  const nav = getElement("mobile-nav")
  const hamburger = getElement("hamburger-icon")

  let isOpen = false

  /** @type {Types.toggle} */
  function toggle() {
    isOpen = !isOpen
    nav.classList.toggle("open", isOpen)
    hamburger.classList.toggle("open", isOpen)
    button.setAttribute("aria-expanded", String(isOpen))
    document.body.style.overflow = isOpen ? "hidden" : ""
  }

  /** @type {Types.close} */
  function close() {
    if (isOpen) {
      isOpen = false
      nav.classList.remove("open")
      hamburger.classList.remove("open")
      button.setAttribute("aria-expanded", "false")
      document.body.style.overflow = ""
    }
  }

  button.addEventListener("click", toggle)

  button.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      toggle()
    }
  })

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      close()
      button.focus()
    }
  })

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", close)
  })

  document.addEventListener("click", (e) => {
    if (isOpen && e.target instanceof Node && !wrapper.contains(e.target)) {
      close()
    }
  })
}
