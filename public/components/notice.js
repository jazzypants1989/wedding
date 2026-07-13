/** @file One-time dismissible note, shared by the guestbook/gallery pending
 *  reassurances and the cross-feature nudges. A `once` key persists dismissal
 *  in localStorage so the note doesn't reappear on every reload/post. */
/** @import * as Types from "./types.js" */

import { html } from "../pages/utils.js"

/** @type {Types.showNote} */
export function showNote(el, opts) {
  if (opts.once && seen(opts.once)) return
  if (opts.once) remember(opts.once)

  const link = opts.linkHref
    ? html` <a href="${opts.linkHref}">${opts.linkLabel || "Open"}</a>`
    : ""
  el.classList.add("pending-note")
  if (opts.nudge) el.classList.add("note-nudge")
  el.innerHTML = html`
    <span>${opts.message}${link}</span>
    <button type="button" class="note-dismiss" aria-label="Dismiss">&times;</button>`
  const dismiss = el.querySelector(".note-dismiss")
  if (dismiss instanceof HTMLElement) {
    dismiss.addEventListener("click", () => {
      el.hidden = true
    })
  }
  el.hidden = false
}

/** @param {string} key @returns {boolean} */
function seen(key) {
  try {
    return localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

/** @param {string} key */
function remember(key) {
  try {
    localStorage.setItem(key, "1")
  } catch {
    // localStorage unavailable (private mode) — the note just shows each time.
  }
}
