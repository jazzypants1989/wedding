/** @file The card's private reply UI — a bespoke, warmer thing than the shared
 *  reaction bar. A single-select row of quick-pick emoji, a box that takes ANY
 *  emoji from the guest's own keyboard, and an optional short note; sending fires confetti + a sparkle and settles into a "Sent 💌" state
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
import { REPLY_QUICK_PICKS, replyGlyph, lastEmojiIn } from "../../components/emoji.js"
import { fireConfetti, miniSparkle, flyEmoji } from "../../components/celebrate.js"
import { showToast } from "../../components/toast.js"
import { announcePolite } from "../../components/announce.js"

/** The reply note's own cap (shorter than the server's, on purpose — a card
 *  reply is a line or two, not an essay). Must stay ≤ the server's
 *  THANK_YOU_REPLY_MAX_LENGTH (500, in api/thank-you.js) or valid input would be
 *  rejected after the fact; 280 sits comfortably under it. */
const REPLY_MAX = 280

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
  /** The chosen glyph, from a pill or the any-emoji box. @type {string | null} */
  let selected = prefill ? replyGlyph(prefill.emoji) || null : null
  const isQuickPick = (/** @type {string | null} */ g) => REPLY_QUICK_PICKS.some((p) => p.glyph === g)
  // A previous reply that is not a quick pick goes back into the box it came from.
  const prefillCustom = selected && !isQuickPick(selected) ? selected : ""

  const pills = REPLY_QUICK_PICKS.map(({ glyph, label }) => {
    const isOn = glyph === selected
    return html`
      <button type="button" class="tc-emoji${isOn ? " tc-emoji-on" : ""}"
        data-emoji="${glyph}" aria-pressed="${isOn ? "true" : "false"}"
        aria-label="React with ${label}">
        <span aria-hidden="true">${glyph}</span>
      </button>`
  })

  container.innerHTML = html`
    <h2 class="tc-reply-title">Send a little something back</h2>
    <div id="tc-emoji-row" class="tc-emoji-row" role="group" aria-label="Pick an emoji">
      ${pills}
      <input id="tc-emoji-any" class="tc-emoji-any${prefillCustom ? " tc-emoji-on" : ""}"
        type="text" maxlength="32" autocomplete="off" autocorrect="off" spellcheck="false"
        enterkeyhint="done" value="${prefillCustom}" placeholder="any emoji"
        aria-label="Or type any emoji from your keyboard" aria-describedby="tc-emoji-hint" />
    </div>
    <p id="tc-emoji-hint" class="tc-emoji-hint" role="status"></p>
    <label class="tc-reply-label" for="tc-reply-text">Add a note (optional)</label>
    <textarea id="tc-reply-text" class="tc-reply-text" rows="3" maxlength="${REPLY_MAX}"
      placeholder="It meant so much — thank you!">${prefill && prefill.message ? prefill.message : ""}</textarea>
    <span id="tc-reply-counter" class="tc-reply-counter" aria-hidden="true">0/${REPLY_MAX}</span>
    <p id="tc-reply-error" class="tc-reply-error" role="alert" hidden></p>
    <button type="button" class="btn btn-primary tc-reply-send" id="tc-reply-send">Send my reply</button>`

  // Ids are page-unique, so the typed getters give non-null narrowed elements
  // that survive into the nested closures below.
  const emojiRow = getElement("tc-emoji-row")
  const anyInput = getTypedElement("tc-emoji-any", HTMLInputElement)
  const hint = getElement("tc-emoji-hint")
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

  /** Paint the pills and the box from `selected`. */
  function syncSelection() {
    emojiRow.querySelectorAll(".tc-emoji").forEach((pill) => {
      if (!(pill instanceof HTMLButtonElement)) return
      const on = pill.dataset.emoji === selected
      pill.setAttribute("aria-pressed", on ? "true" : "false")
      pill.classList.toggle("tc-emoji-on", on)
    })
    anyInput.classList.toggle("tc-emoji-on", !!selected && anyInput.value === selected)
  }

  // Single-select: tapping an emoji selects it (or clears it if re-tapped). A
  // pill replaces whatever is in the any-emoji box.
  emojiRow.addEventListener("click", (e) => {
    const el = e.target
    if (!(el instanceof Element)) return
    const btn = el.closest(".tc-emoji")
    if (!(btn instanceof HTMLButtonElement)) return
    const glyph = btn.dataset.emoji || null
    selected = selected === glyph ? null : glyph
    anyInput.value = ""
    hint.textContent = ""
    syncSelection()
  })

  // The any-emoji box keeps exactly one emoji — the last one typed — because
  // emoji keyboards append, and a reply carries a single emoji. Text that holds
  // no emoji at all gets a gentle pointer at the emoji keyboard instead.
  anyInput.addEventListener("input", () => {
    const raw = anyInput.value
    const glyph = lastEmojiIn(raw)
    if (glyph) {
      if (raw !== glyph) anyInput.value = glyph
      selected = glyph
      hint.textContent = ""
    } else {
      // No emoji in the box: a selection that came from the box is gone; a
      // tapped pill stays chosen.
      if (!isQuickPick(selected)) selected = null
      hint.textContent = raw.trim() ? "Just one emoji here, from your emoji keyboard." : ""
    }
    syncSelection()
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
    const originPill = !selected
      ? null
      : anyInput.value === selected
        ? anyInput
        : [...emojiRow.querySelectorAll(".tc-emoji")].find(
            (pill) => pill instanceof HTMLElement && pill.dataset.emoji === selected,
          ) ?? null
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
    if (emoji && originPill) {
      const target = container.closest(".tc-card")
      if (target instanceof HTMLElement) flyEmoji(emoji, originPill, target)
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
  const glyph = replyGlyph(reply.emoji)

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
