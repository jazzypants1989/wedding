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

  function update() {
    const now = new Date()
    const diff = weddingDate.getTime() - now.getTime()

    if (diff <= 0) {
      countdownEl.innerHTML = "Today's the Day!"
      countdownEl.classList.add("wedding-day")
    } else {
      countdownEl.classList.remove("wedding-day")
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const textNode = countdownEl.childNodes[0]
      if (textNode) {
        textNode.textContent = `${days} Day${days !== 1 ? "s" : ""} To Go! `
      }
      exactTimeEl.textContent = `(${formatExactTime(diff)})`
    }
  }

  update()
  const intervalId = setInterval(update, 1000)

  return function cleanup() {
    clearInterval(intervalId)
  }
}
