/** @file The card's private reply UI — a bespoke, warmer thing than the shared
 *  reaction bar. A single-select row of the six wedding emoji + an optional short
 *  note; sending fires confetti + a sparkle and settles into a "Sent 💌" state
 *  that echoes the reply back. A revisit renders the Sent state with no confetti
 *  and a quiet "Update your reply" that reopens the form (the endpoint upserts).
 *
 *  The token is the auth (no account, no CSRF) — a plain POST is all it takes. */
/** @import * as Types from "./types.js" */

import {
  html,
  api,
  getErrorMessage,
  announceCharsRemaining,
  getElement,
  getTypedElement,
  getButtonElement,
} from "../utils.js"
import { REACTION_GLYPHS } from "../../components/reaction-bar.js"
import { fireConfetti, miniSparkle, flyEmoji } from "../../components/celebrate.js"
import { showToast } from "../../components/toast.js"
import { announcePolite } from "../../components/announce.js"

/** The reply note's own cap (shorter than the server's, on purpose — a card
 *  reply is a line or two, not an essay). Must stay ≤ the server's
 *  THANK_YOU_REPLY_MAX_LENGTH (500, in api/thank-you.js) or valid input would be
 *  rejected after the fact; 280 sits comfortably under it. */
const REPLY_MAX = 280

/** Stable reaction key order, mirrored from REACTION_GLYPHS. */
const EMOJI_ORDER = /** @type {Array<keyof typeof REACTION_GLYPHS>} */ (
  Object.keys(REACTION_GLYPHS)
)

/** @type {typeof Types.initReply} */
export function initReply(container, init) {
  const hasReply = !!(init.reply && (init.reply.emoji || init.reply.message))
  if (hasReply && init.reply) {
    renderSent(container, init, init.reply, false)
  } else {
    renderForm(container, init, null)
  }
}

/**
 * @param {HTMLElement} container @param {Types.ReplyInit} init
 * @param {Types.ThankYouReplyView | null} prefill
 */
function renderForm(container, init, prefill) {
  /** @type {string | null} */
  let selected = prefill ? prefill.emoji : null

  const pills = EMOJI_ORDER.map((key) => {
    const isOn = key === selected
    return html`
      <button type="button" class="tc-emoji${isOn ? " tc-emoji-on" : ""}"
        data-emoji="${key}" aria-pressed="${isOn ? "true" : "false"}"
        aria-label="React with ${key.replaceAll("_", " ")}">
        <span aria-hidden="true">${REACTION_GLYPHS[key]}</span>
      </button>`
  })

  container.innerHTML = html`
    <h2 class="tc-reply-title">Send a little something back</h2>
    <div id="tc-emoji-row" class="tc-emoji-row" role="group" aria-label="Pick an emoji">${pills}</div>
    <label class="tc-reply-label" for="tc-reply-text">Add a note (optional)</label>
    <textarea id="tc-reply-text" class="tc-reply-text" rows="3" maxlength="${REPLY_MAX}"
      placeholder="It meant so much — thank you!">${prefill && prefill.message ? prefill.message : ""}</textarea>
    <span id="tc-reply-counter" class="tc-reply-counter" aria-hidden="true">0/${REPLY_MAX}</span>
    <p id="tc-reply-error" class="tc-reply-error" role="alert" hidden></p>
    <button type="button" class="btn btn-primary tc-reply-send" id="tc-reply-send">Send my reply</button>`

  // Ids are page-unique, so the typed getters give non-null narrowed elements
  // that survive into the nested closures below.
  const emojiRow = getElement("tc-emoji-row")
  const textarea = getTypedElement("tc-reply-text", HTMLTextAreaElement)
  const counter = getElement("tc-reply-counter")
  const errorEl = getElement("tc-reply-error")
  const sendBtn = getButtonElement("tc-reply-send")

  /** Reflect the current count (silent visual) + speak only near the limit. */
  function syncCounter() {
    counter.textContent = textarea.value.length + "/" + REPLY_MAX
    announceCharsRemaining(textarea.value.length, REPLY_MAX, textarea)
  }
  textarea.addEventListener("input", syncCounter)
  syncCounter()

  // Single-select: tapping an emoji selects it (or clears it if re-tapped).
  emojiRow.addEventListener("click", (e) => {
    const el = e.target
    if (!(el instanceof Element)) return
    const btn = el.closest(".tc-emoji")
    if (!(btn instanceof HTMLButtonElement)) return
    const key = btn.dataset.emoji || null
    selected = selected === key ? null : key
    emojiRow.querySelectorAll(".tc-emoji").forEach((pill) => {
      if (!(pill instanceof HTMLButtonElement)) return
      const on = pill.dataset.emoji === selected
      pill.setAttribute("aria-pressed", on ? "true" : "false")
      pill.classList.toggle("tc-emoji-on", on)
    })
  })

  sendBtn.addEventListener("click", () => {
    const message = textarea.value.trim()
    if (!selected && !message) {
      errorEl.textContent = "Pick an emoji or write a note to send your reply."
      errorEl.hidden = false
      announcePolite("Pick an emoji or write a note to send your reply.")
      return
    }
    errorEl.hidden = true
    // Capture the tapped pill NOW — renderSent() replaces the form, so its rect
    // has to be read before the send resolves and the pill is gone.
    const originPill = selected
      ? emojiRow.querySelector('.tc-emoji[data-emoji="' + selected + '"]')
      : null
    void send(
      container,
      init,
      sendBtn,
      selected,
      message,
      originPill instanceof HTMLElement ? originPill : null,
    )
  })
}

/**
 * @param {HTMLElement} container @param {Types.ReplyInit} init
 * @param {HTMLButtonElement} sendBtn @param {string | null} emoji @param {string} message
 * @param {HTMLElement | null} originPill The tapped emoji pill, for the fly-in.
 */
async function send(container, init, sendBtn, emoji, message, originPill) {
  sendBtn.disabled = true
  sendBtn.classList.add("btn-loading")
  /** @type {Record<string, unknown>} */
  const body = {}
  if (emoji) body.emoji = emoji
  if (message) body.message = message
  try {
    const res = /** @type {Types.ReplyResponse} */ (
      await api("/api/thank-you/" + encodeURIComponent(init.token) + "/reply", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )
    // A soft haptic tick to confirm the send on phones that support it.
    navigator.vibrate?.(10)
    // Send the chosen glyph flying up into the card — a small, warm beat that
    // must run BEFORE renderSent() tears the form (and the pill) down.
    if (emoji && originPill && emoji in REACTION_GLYPHS) {
      const target = container.closest(".tc-card")
      if (target instanceof HTMLElement) {
        flyEmoji(
          REACTION_GLYPHS[/** @type {keyof typeof REACTION_GLYPHS} */ (emoji)],
          originPill,
          target,
        )
      }
    }
    if (init.onSent) init.onSent(res.reply)
    renderSent(container, init, res.reply, true)
  } catch (err) {
    sendBtn.disabled = false
    sendBtn.classList.remove("btn-loading")
    showToast(getErrorMessage(err), { variant: "error" })
  }
}

/**
 * @param {HTMLElement} container @param {Types.ReplyInit} init
 * @param {Types.ThankYouReplyView} reply @param {boolean} celebrate
 */
function renderSent(container, init, reply, celebrate) {
  const glyph =
    reply.emoji && reply.emoji in REACTION_GLYPHS
      ? REACTION_GLYPHS[/** @type {keyof typeof REACTION_GLYPHS} */ (reply.emoji)]
      : ""

  container.innerHTML = html`
    <div class="tc-reply-sent">
      <h2 class="tc-reply-title">Sent 💌</h2>
      <p class="tc-reply-echo">
        ${glyph ? html`<span class="tc-reply-echo-emoji" aria-hidden="true">${glyph}</span>` : ""}
        ${reply.message ? html`<span class="tc-reply-echo-text">${reply.message}</span>` : ""}
      </p>
      <button type="button" class="tc-reply-edit" id="tc-reply-edit">Update your reply</button>
    </div>`

  const editBtn = container.querySelector("#tc-reply-edit")
  if (editBtn instanceof HTMLButtonElement) {
    editBtn.addEventListener("click", () => renderForm(container, init, reply))
  }

  if (celebrate) {
    fireConfetti()
    const title = container.querySelector(".tc-reply-title")
    if (title instanceof HTMLElement) miniSparkle(title)
    announcePolite("Your reply was sent")
  }
}
