/** @file Countdown timer for wedding date */
/** @import * as Types from './types.js' */

import { getElement } from "./utils.js"

/** @type {Types.initCountdown} */
export function initCountdown() {
  const countdownEl = getElement("countdown")
  const exactTimeEl = getElement("exact-time")

  const weddingDate = new Date("2026-04-26T11:00:00-07:00")

  /** @type {Types.pad} */
  const pad = (num) => String(num).padStart(2, "0")

  /** @type {Types.formatExactTime} */
  function formatExactTime(ms) {
    const totalSeconds = Math.floor(ms / 1000)
    const days = Math.floor(totalSeconds / (3600 * 24))
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`
  }

  const DAY_MS = 1000 * 60 * 60 * 24

  function update() {
    const now = new Date()
    const diff = weddingDate.getTime() - now.getTime()
    // childNodes[0] is the leading text node; keep the #exact-time span intact
    // (don't overwrite via innerHTML) so all three states share one structure.
    const textNode = countdownEl.childNodes[0]

    if (diff > 0) {
      // Counting down to the ceremony.
      countdownEl.classList.remove("wedding-day", "married")
      const days = Math.floor(diff / DAY_MS)
      if (textNode) {
        textNode.textContent = `${days} Day${days !== 1 ? "s" : ""} To Go! `
      }
      exactTimeEl.textContent = `(${formatExactTime(diff)})`
    } else if (diff > -DAY_MS) {
      // The wedding day itself — celebrate live for the first 24 hours.
      countdownEl.classList.remove("married")
      countdownEl.classList.add("wedding-day")
      if (textNode) textNode.textContent = "Today's the Day! "
      exactTimeEl.textContent = ""
    } else {
      // Permanent post-wedding state.
      countdownEl.classList.remove("wedding-day")
      countdownEl.classList.add("married")
      if (textNode) textNode.textContent = "We're married! 💍 "
      exactTimeEl.textContent = "Relive the day below"
    }
  }

  update()
  const intervalId = setInterval(update, 1000)

  return function cleanup() {
    clearInterval(intervalId)
  }
}
