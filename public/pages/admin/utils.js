/** @file Admin API helpers and modal & notification banner utilities */
/** @import * as Types from './types.js' */

import { getElement, html, api as baseApi } from "../utils.js"
import { state } from "./state.js"

/** @type {WeakMap<HTMLDialogElement, HTMLElement>} */
const triggerMap = new WeakMap()
const banner = getElement("notification-banner")

/** @type {ReturnType<typeof setTimeout> | undefined} */
let dismissTimer

/**
 * Set when a 401 is handled by redirecting to the login screen. The caller's
 * `catch` block would otherwise call `showError` right after, leaving a stale
 * error banner behind the (hidden) dashboard that flashes back on the next
 * successful login. We swallow that one follow-up error. One-shot, with a
 * timeout fallback in case the caller doesn't follow with `showError`.
 */
let authRedirectPending = false

/** The last reversible action's undo, while its toast is up (`z` runs it). */
/** @type {(() => void) | null} */
let pendingUndo = null

/** A toast never covers the action bar it is reporting on (Approve, Hide, Save…):
 *  when one is showing, the toast floats just above it instead of at the foot. */
function liftAboveActionBar() {
  let top = Infinity
  for (const bar of document.querySelectorAll(".tab-content.active .actionbar")) {
    if (!(bar instanceof HTMLElement) || bar.offsetParent === null) continue
    const r = bar.getBoundingClientRect()
    // Pinned to the foot of the view (on phones, just above the bottom bar).
    if (r.height > 0 && r.bottom > window.innerHeight - 100) top = Math.min(top, r.top)
  }
  banner.style.bottom = top === Infinity ? "" : `${Math.round(window.innerHeight - top + 12)}px`
}

/** @param {string} kind @param {number} ms */
function raiseToast(kind, ms) {
  clearTimeout(dismissTimer)
  banner.className = `admin-toast is-${kind}`
  liftAboveActionBar()
  banner.hidden = false
  dismissTimer = setTimeout(() => {
    banner.hidden = true
    pendingUndo = null
  }, ms)
}

/** @type {Types.showError} */
export function showError(message) {
  if (authRedirectPending) {
    authRedirectPending = false
    return
  }
  pendingUndo = null
  banner.textContent = message
  raiseToast("error", 8000)
}

/** @type {Types.showSuccess} */
export function showSuccess(message) {
  pendingUndo = null
  banner.textContent = message
  raiseToast("success", 6000)
}

/**
 * The Undo toast for a reversible action (IA §1.7: undo instead of confirm).
 * The button — or `z` anywhere (router.js) — fires `onUndo` once; the toast
 * stays up for a generous window, since an undo must stay reachable longer
 * than a plain confirmation.
 * @param {string} message @param {() => void} onUndo
 */
export function showUndo(message, onUndo) {
  banner.innerHTML = html`<span>${message}</span>
    <button type="button" class="toast-undo" data-undo-action>Undo <kbd>z</kbd></button>`
  pendingUndo = onUndo
  raiseToast("success", 10000)
  const btn = banner.querySelector("[data-undo-action]")
  if (btn instanceof HTMLButtonElement) {
    btn.addEventListener("click", () => runUndo(), { once: true })
  }
}

/** @type {Types.runUndo} */
export function runUndo() {
  const fn = pendingUndo
  if (!fn) return false
  pendingUndo = null
  clearTimeout(dismissTimer)
  banner.hidden = true
  fn()
  return true
}

/** @type {Types.showLoading} */
export function showLoading(el, colspan) {
  const spinner = html`<span class="spinner" aria-hidden="true"></span>Loading…`
  if (el instanceof HTMLTableSectionElement) {
    el.innerHTML = html`<tr>
      <td colspan="${colspan || 1}" class="loading">${spinner}</td>
    </tr>`
  } else {
    el.innerHTML = html`<div class="loading">${spinner}</div>`
  }
}

/** @type {Types.clearNotification} */
export function clearNotification() {
  clearTimeout(dismissTimer)
  banner.hidden = true
  pendingUndo = null
}

/** @type {Types.showLoadError} */
export function showLoadError(el, colspan, message, retry) {
  // Inline failure state with its own retry — the transient banner alone
  // auto-dismisses and leaves the view stuck on a spinner with no way back.
  const content = html`<div class="load-error">
    <span>${message}</span>
    <button type="button" class="btn btn-sm" data-load-retry>Try again</button>
  </div>`
  if (el instanceof HTMLTableSectionElement) {
    el.innerHTML = html`<tr>
      <td colspan="${colspan || 1}">${content}</td>
    </tr>`
  } else {
    el.innerHTML = content
  }
  const btn = el.querySelector("[data-load-retry]")
  if (btn) btn.addEventListener("click", () => retry(), { once: true })
}

/** Dialogs opened through openModal, oldest first — the top layer's order,
 *  which the DOM can't tell us. The router closes the last one on Back. */
/** @type {HTMLDialogElement[]} */
const modalStack = []

/** @type {Types.topModal} */
export function topModal() {
  for (let i = modalStack.length - 1; i >= 0; i--) {
    if (modalStack[i].open) return modalStack[i]
    modalStack.splice(i, 1)
  }
  return null
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
  const at = modalStack.indexOf(dialog)
  if (at !== -1) modalStack.splice(at, 1)
  modalStack.push(dialog)

  const firstFocusable = dialog.querySelector(
    'input:not([type="hidden"]):not([disabled]), button:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      // A backdrop click targets the <dialog> itself. Anything else is a
      // click inside — including a keyboard-activated button, which reports
      // clientX/Y = 0 and would otherwise read as "outside".
      if (e.target !== dialog) return
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
    onUnauthorized: () => {
      // A 401 means the session expired — redirect to login and clear any
      // banner. Suppress the caller's follow-up showError (see above) so we
      // don't stack a stale error over the login screen.
      authRedirectPending = true
      clearNotification()
      setTimeout(() => {
        authRedirectPending = false
      }, 1000)
      state.onAuthRequired()
    },
  })
}
