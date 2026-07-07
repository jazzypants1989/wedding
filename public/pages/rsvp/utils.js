/** @file Shared RSVP form utilities */
/** @import * as Types from './types.js' */

// fireConfetti + setButtonLoading now live in the shared celebrate component so
// the guestbook/gallery can reuse them; re-exported here to keep RSVP imports
// stable. The confetti/sparkle/shake CSS moved to /styles/social.css.
export { fireConfetti, setButtonLoading } from "../../components/celebrate.js"

/** @type {Types.showResult} */
export function showResult(el, message, isError, errorClass, successClass, shakeClass) {
  el.textContent = message
  el.hidden = false
  el.classList.toggle(errorClass, isError)
  el.classList.toggle(successClass, !isError)
  if (isError) {
    el.classList.add(shakeClass)
    el.addEventListener(
      "animationend",
      () => el.classList.remove(shakeClass),
      { once: true },
    )
  }
}

