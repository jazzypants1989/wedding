/** @file Admin API helpers and modal & notification banner utilities */
/** @import * as Types from './types.js' */

import { getElement, api as baseApi } from "../utils.js"
import { state } from "./state.js"

/** @type {WeakMap<HTMLDialogElement, HTMLElement>} */
const triggerMap = new WeakMap()
const banner = getElement("notification-banner")

/** @type {ReturnType<typeof setTimeout> | undefined} */
let dismissTimer

/** @type {Types.showError} */
export function showError(message) {
  clearTimeout(dismissTimer)
  banner.textContent = message
  banner.className = "alert alert-error"
  banner.hidden = false
  dismissTimer = setTimeout(() => {
    banner.hidden = true
  }, 8000)
}

/** @type {Types.clearNotification} */
export function clearNotification() {
  clearTimeout(dismissTimer)
  banner.hidden = true
}

/** @type {Types.openModal} */
export function openModal(dialog, trigger) {
  if (!(dialog instanceof HTMLDialogElement)) {
    console.error("openModal requires a <dialog> element")
    return
  }

  if (trigger) {
    triggerMap.set(dialog, trigger)
  }

  dialog.showModal()

  const firstFocusable = dialog.querySelector(
    'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )
  if (firstFocusable instanceof HTMLElement) {
    firstFocusable.focus()
  }
}

/** @type {Types.closeModal} */
export function closeModal(dialog) {
  if (!(dialog instanceof HTMLDialogElement)) {
    console.error("closeModal requires a <dialog> element")
    return
  }

  dialog.close()

  const trigger = triggerMap.get(dialog)
  if (trigger && typeof trigger.focus === "function") {
    trigger.focus()
    triggerMap.delete(dialog)
  }
}

/** @type {Types.initModals} */
export function initModals() {
  document.querySelectorAll("dialog").forEach((dialog) => {
    if (!(dialog instanceof HTMLDialogElement)) return

    dialog.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(dialog))
    })

    dialog.addEventListener("close", () => {
      const trigger = triggerMap.get(dialog)
      if (trigger && typeof trigger.focus === "function") {
        trigger.focus()
        triggerMap.delete(dialog)
      }
    })

    dialog.addEventListener("click", (e) => {
      const rect = dialog.getBoundingClientRect()
      const isInDialog =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      if (!isInDialog) {
        closeModal(dialog)
      }
    })
  })
}

/** @type {Types.api} */
export function api(endpoint, options = {}) {
  return baseApi(endpoint, {
    ...options,
    csrf: true,
    onUnauthorized: state.onAuthRequired,
  })
}
