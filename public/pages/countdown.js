/** @file Countdown timer for wedding date */
/** @import * as Types from './types.js' */

import { getElement } from "./utils.js"
import { fireConfetti } from "../components/celebrate.js"

/** @type {Types.initCountdown} */
export function initCountdown() {
  const countdownEl = getElement("countdown")
  const exactTimeEl = getElement("exact-time")

  // ISO date is templated into data-wedding-date from content.js (core/static.js).
  const weddingDate = new Date(countdownEl.dataset.weddingDate ?? "")
  if (Number.isNaN(weddingDate.getTime())) {
    // An empty/unparseable date makes every diff comparison false, which would
    // fall through to the permanent "We're married!" state before the wedding.
    // Hide the widget rather than show a wrong state.
    countdownEl.hidden = true
    return () => {}
  }

  // Fire celebratory confetti once per milestone. localStorage makes it
  // once-ever per browser; the in-memory guard backs it up when storage is
  // unavailable (private mode) so a throw can't retrigger it every tick.
  // Only the wedding-day / married states celebrate — never the countdown.
  // fireConfetti() self-gates on prefers-reduced-motion (celebrate.js).
  /** @type {Set<string>} */
  const celebrated = new Set()
  /** @param {string} key */
  function celebrateOnce(key) {
    if (celebrated.has(key)) return
    celebrated.add(key)
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, "1")
    } catch {
      // Storage blocked — the in-memory guard still limits us to one burst.
    }
    fireConfetti()
  }

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
      celebrateOnce("countdownWeddingDayCelebrated")
    } else {
      // Permanent post-wedding state.
      countdownEl.classList.remove("wedding-day")
      countdownEl.classList.add("married")
      if (textNode) textNode.textContent = "We're married! 💍 "
      exactTimeEl.textContent = "Relive the day below"
      celebrateOnce("countdownMarriedCelebrated")
    }
  }

  update()
  const intervalId = setInterval(update, 1000)

  return function cleanup() {
    clearInterval(intervalId)
  }
}
