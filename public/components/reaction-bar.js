/** @file Shared emoji reaction bar for guestbook entries and gallery media.
 *
 * The server speaks stable keys (heart, clap, …); this module owns the glyphs.
 * Toggling is optimistic: flip the pill immediately, then reconcile with the
 * server's fresh `{ active, counts }` so concurrent toggles from other guests
 * (or a double-tap race) converge. One delegated listener covers a whole page.
 */
/** @import * as Types from "./types.js" */

import { html, api, getErrorMessage } from "../pages/utils.js"
import { requireAccount } from "./guest-session.js"
import { miniSparkle } from "./celebrate.js"
import { showToast } from "./toast.js"
import { announcePolite } from "./announce.js"

/** Stable reaction key → display glyph. Must stay in sync with REACTION_EMOJI. */
export const REACTION_GLYPHS = Object.freeze({
  heart: "❤️",
  clap: "👏",
  laugh: "😂",
  heart_eyes: "😍",
  cheers: "🥂",
  fire: "🔥",
})

/** @type {Types.ReactionEmojiKey[]} */
const EMOJI_ORDER = /** @type {Types.ReactionEmojiKey[]} */ (
  Object.keys(REACTION_GLYPHS)
)

/** @type {Types.renderReactionBar} */
export function renderReactionBar(targetType, targetId, reactions = {}) {
  const pills = EMOJI_ORDER.map((emoji) => {
    const state = reactions[emoji]
    const count = state ? state.count : 0
    const mine = state ? state.mine : false
    return html`
      <button type="button" class="reaction-pill${mine ? " reaction-mine" : ""}"
        data-emoji="${emoji}" aria-pressed="${mine ? "true" : "false"}"
        aria-label="React with ${emoji.replaceAll("_", " ")}">
        <span class="reaction-glyph" aria-hidden="true">${REACTION_GLYPHS[emoji]}</span>
        <span class="reaction-count">${count > 0 ? count : ""}</span>
      </button>`
  })
  return html`
    <div class="reaction-bar" role="group" aria-label="Reactions" data-reaction-bar
      data-target-type="${targetType}" data-target-id="${targetId}">
      ${pills}
    </div>`
}

/** @type {Types.initReactionBars} */
export function initReactionBars(root = document.body) {
  root.addEventListener("click", (e) => {
    const el = e.target
    if (!(el instanceof Element)) return
    const btn = el.closest(".reaction-pill")
    if (!(btn instanceof HTMLButtonElement)) return
    const bar = btn.closest("[data-reaction-bar]")
    if (!(bar instanceof HTMLElement)) return
    const targetType = bar.dataset.targetType
    const targetId = bar.dataset.targetId
    const emoji = btn.dataset.emoji
    if (!targetType || !targetId || !emoji) return
    // Browse freely; gate only at write. The toggle replays after sign-in.
    requireAccount(() => void toggle(btn, bar, targetType, Number(targetId), emoji))
  })
}

/**
 * @param {HTMLButtonElement} btn
 * @param {HTMLElement} bar
 * @param {string} targetType
 * @param {number} targetId
 * @param {string} emoji
 */
async function toggle(btn, bar, targetType, targetId, emoji) {
  const wasPressed = btn.getAttribute("aria-pressed") === "true"
  const wasCount = countOf(btn)
  // Optimistic flip.
  setPill(btn, !wasPressed, wasCount + (wasPressed ? -1 : 1))
  if (!wasPressed) miniSparkle(btn)

  try {
    const res = /** @type {Types.ReactionToggleResponse} */ (
      await api("/api/reactions/toggle", {
        method: "POST",
        csrf: true,
        csrfCookie: "guest_csrf",
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          emoji,
        }),
      })
    )
    reconcile(bar, res, emoji)
    // The pill's visual count change is silent to screen readers (aria-pressed
    // flips, but the new count is never spoken) — announce the outcome.
    const plain = emoji.replaceAll("_", " ")
    const total = res.counts[emoji] ?? 0
    announcePolite(
      res.active
        ? `Reacted with ${plain} — ${total} total`
        : `Removed your ${plain} reaction`,
    )
  } catch (err) {
    // Roll back to the pre-toggle state; the server is the source of truth.
    setPill(btn, wasPressed, wasCount)
    console.warn("Reaction toggle failed:", getErrorMessage(err))
    showToast("Couldn't save your reaction — please try again.", { variant: "error" })
  }
}

/**
 * Reconcile every pill in the bar against the server's fresh counts. The toggled
 * emoji's `mine` comes from `active`; other emojis keep their local `mine` (the
 * server only reports the caller's state for what they just toggled).
 * @param {HTMLElement} bar
 * @param {Types.ReactionToggleResponse} res
 * @param {string} toggledEmoji
 */
function reconcile(bar, res, toggledEmoji) {
  const pills = bar.querySelectorAll(".reaction-pill")
  pills.forEach((pill) => {
    if (!(pill instanceof HTMLButtonElement)) return
    const emoji = pill.dataset.emoji
    if (!emoji) return
    const count = res.counts[emoji] ?? 0
    const pressed =
      emoji === toggledEmoji
        ? res.active
        : pill.getAttribute("aria-pressed") === "true"
    setPill(pill, pressed, count)
  })
  announceChange(bar)
}

/**
 * Broadcast this bar's freshly-reconciled state so a page that re-renders the
 * bar from cached data (the gallery lightbox, off the grid's in-memory item)
 * can write it back and stay faithful. Built from the DOM so it always matches
 * what the guest currently sees. @param {HTMLElement} bar
 */
function announceChange(bar) {
  const targetType = bar.dataset.targetType
  const targetId = bar.dataset.targetId
  if (!targetType || !targetId) return
  /** @type {Record<string, { count: number, mine: boolean }>} */
  const reactions = {}
  bar.querySelectorAll(".reaction-pill").forEach((pill) => {
    if (!(pill instanceof HTMLButtonElement)) return
    const emoji = pill.dataset.emoji
    if (!emoji) return
    const count = countOf(pill)
    const mine = pill.getAttribute("aria-pressed") === "true"
    // Match ReactionSummary semantics: only emojis with ≥1 reaction.
    if (count > 0) reactions[emoji] = { count, mine }
  })
  window.dispatchEvent(
    new CustomEvent("reaction:changed", {
      detail: { targetType, targetId: Number(targetId), reactions },
    }),
  )
}

/** @param {HTMLButtonElement} btn @param {boolean} pressed @param {number} count */
function setPill(btn, pressed, count) {
  btn.setAttribute("aria-pressed", pressed ? "true" : "false")
  btn.classList.toggle("reaction-mine", pressed)
  const countEl = btn.querySelector(".reaction-count")
  if (!(countEl instanceof HTMLElement)) return
  const safe = count > 0 ? count : 0
  const nextText = safe > 0 ? String(safe) : ""
  const changed = countEl.textContent !== nextText
  countEl.textContent = nextText
  // Retrigger the bump keyframe only when this count actually changed, so an
  // unrelated pill doesn't animate on every reconcile (no-op under reduced motion).
  if (changed) {
    countEl.classList.remove("reaction-bump")
    void countEl.offsetWidth
    countEl.classList.add("reaction-bump")
  }
}

/** @param {HTMLButtonElement} btn @returns {number} */
function countOf(btn) {
  const countEl = btn.querySelector(".reaction-count")
  const n = countEl ? parseInt(countEl.textContent || "0", 10) : 0
  return Number.isNaN(n) ? 0 : n
}
