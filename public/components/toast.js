/** @file Minimal transient toast for cross-surface feedback (e.g. a reaction
 *  that failed to save). Implemented as a NON-modal <dialog> so it also paints
 *  above the modal gallery lightbox (both live in the browser top layer) without
 *  trapping focus or stealing it from whatever the guest was doing. Auto-dismisses.
 */
/** @import * as Types from "./types.js" */

/** @type {HTMLDialogElement | null} */
let host = null
/** @type {ReturnType<typeof setTimeout> | undefined} */
let hideTimer

function ensureHost() {
  if (host) return host
  const el = document.createElement("dialog")
  el.className = "toast"
  // A polite live region so screen readers announce the message; the dialog's
  // own role is overridden since we never trap focus here.
  el.setAttribute("role", "status")
  el.setAttribute("aria-live", "polite")
  document.body.appendChild(el)
  host = el
  return el
}

/** @type {Types.showToast} */
export function showToast(message, opts = {}) {
  const el = ensureHost()
  el.classList.toggle("toast-error", opts.variant === "error")
  el.textContent = message
  if (!el.open) el.show()
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (el.open) el.close()
  }, opts.duration ?? 3200)
}
