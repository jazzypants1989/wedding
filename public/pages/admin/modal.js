/** @file Modal management utilities using native dialog element */
/** @import * as Types from './types.js' */

/** @type {WeakMap<HTMLDialogElement, HTMLElement>} */
const triggerMap = new WeakMap()

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
