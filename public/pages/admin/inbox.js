/** @file Admin "Inbox" tab (A1) — the daily-loop landing surface. Merges three
 *  streams with counts + top-3 previews, each deep-linking into its full tab:
 *    (i)   pending moderation items (reuses the moderation queue endpoint),
 *    (ii)  unread card replies (reuses the recent-replies endpoint / D1),
 *    (iii) the next un-thanked guests (reuses computeWorklist from thank-you.js).
 *  The badge count is refreshed by main.js's existing ~3-min poll (no 2nd timer).
 *  No regex (CLAUDE.md). */
/** @import * as Types from "./types.js" */
/** @import * as GlobalTypes from "../../../types.js" */

import { api, html, getElement } from "../utils.js"
import { formatRelative } from "../../components/relative-time.js"
import { renderMonogram } from "../../components/monogram.js"
import { REACTION_GLYPHS } from "../../components/reaction-bar.js"
import { computeWorklist, requestThankYouMailbox } from "./thank-you.js"

/** How many previews each section shows. */
const PREVIEW_LIMIT = 3

/** Compact single-line preview text for a moderation item. No regex.
 *  @param {Types.ModerationItem} item @returns {string} */
function modPreviewText(item) {
  if (item.content_type === "media") return item.caption || "Photo / video"
  const text = item.message || item.caption || "(no text)"
  const flat = text.split("\n").join(" ").trim()
  return flat.length > 90 ? flat.slice(0, 87) + "…" : flat
}

/** @param {Types.ModerationItem[]} items @param {number} total */
function renderModeration(items, total) {
  getElement("inbox-mod-count").textContent = total > 0 ? `· ${total}` : ""
  const el = getElement("inbox-moderation")
  if (total === 0 || items.length === 0) {
    el.innerHTML = html`<p class="inbox-empty">Nothing waiting for review 🎉</p>`
    return
  }
  el.innerHTML = html`
    <ul class="inbox-list" role="list">
      ${items.slice(0, PREVIEW_LIMIT).map(
        (item) => html`<li class="inbox-item">
          <span class="inbox-item-author">${item.author_name || "The couple"}</span>
          <span class="inbox-item-text">${modPreviewText(item)}</span>
        </li>`,
      )}
    </ul>
    ${total > PREVIEW_LIMIT
      ? html`<p class="inbox-more">+${total - PREVIEW_LIMIT} more</p>`
      : ""}
  `
}

/** @param {Types.ThankYouRecentReply[]} replies @param {number} unreadTotal */
function renderReplies(replies, unreadTotal) {
  getElement("inbox-replies-count").textContent = unreadTotal > 0 ? `· ${unreadTotal}` : ""
  const el = getElement("inbox-replies")
  // Prefer unread replies for the preview; fall back to the most recent.
  const unread = replies.filter((r) => r.unread)
  const shown = (unread.length > 0 ? unread : replies).slice(0, PREVIEW_LIMIT)
  if (shown.length === 0) {
    el.innerHTML = html`<p class="inbox-empty">No replies yet 💌</p>`
    return
  }
  el.innerHTML = html`
    <ul class="inbox-list" role="list">
      ${shown.map((r) => {
        const glyph = r.emoji
          ? REACTION_GLYPHS[/** @type {GlobalTypes.ReactionEmoji} */ (r.emoji)]
          : "💬"
        const snippet = r.message
          ? r.message.length > 70
            ? r.message.slice(0, 67) + "…"
            : r.message
          : "(no message)"
        return html`<li class="inbox-item ${r.unread ? "is-unread" : ""}">
          ${renderMonogram(r.guestName)}
          <span class="inbox-item-author">${r.guestName}</span>
          <span class="inbox-item-emoji" aria-hidden="true">${glyph}</span>
          <span class="inbox-item-text">${snippet}</span>
          <span class="inbox-item-time">${formatRelative(r.createdAt)}</span>
        </li>`
      })}
    </ul>
  `
}

/** @param {{ guestId: number, name: string }[]} remaining */
function renderUnthanked(remaining) {
  getElement("inbox-unthanked-count").textContent =
    remaining.length > 0 ? `· ${remaining.length}` : ""
  const el = getElement("inbox-unthanked")
  if (remaining.length === 0) {
    el.innerHTML = html`<p class="inbox-empty">Everyone's been thanked 🥂</p>`
    return
  }
  el.innerHTML = html`
    <ul class="inbox-list" role="list">
      ${remaining.slice(0, PREVIEW_LIMIT).map(
        (g) => html`<li class="inbox-item">
          <span class="inbox-item-author">${g.name}</span>
        </li>`,
      )}
    </ul>
    ${remaining.length > PREVIEW_LIMIT
      ? html`<p class="inbox-more">+${remaining.length - PREVIEW_LIMIT} more</p>`
      : ""}
  `
}

/** Update just the tab badge (actionable = pending review + unread replies). */
/** @param {number} modTotal @param {number} unreadReplies */
function setInboxBadge(modTotal, unreadReplies) {
  const badge = document.getElementById("inbox-badge")
  if (!badge) return
  const total = modTotal + unreadReplies
  badge.textContent = String(total)
  badge.hidden = total <= 0
}

/** @type {Types.loadInbox} */
export async function loadInbox() {
  const errorEl = getElement("inbox-error")
  errorEl.hidden = true
  try {
    const [modCounts, modQueue, tyCounts, replies, gifts, cards] = await Promise.all([
      api("/api/admin/moderation/counts"),
      api("/api/admin/moderation/queue?status=pending&limit=" + PREVIEW_LIMIT),
      api("/api/admin/thank-you/counts"),
      api("/api/admin/thank-you/replies?limit=50"),
      api("/api/admin/gifts"),
      api("/api/admin/thank-you"),
    ])
    const modTotal = /** @type {Types.ModerationCountsResponse} */ (modCounts).total
    const modItems = /** @type {Types.ModerationQueueResponse} */ (modQueue).items
    const unreadReplies = /** @type {Types.ThankYouCounts} */ (tyCounts).unreadReplies || 0
    const replyList = /** @type {Types.ThankYouRepliesResponse} */ (replies).replies
    const giftRows = /** @type {Types.GiftsResponse} */ (gifts).gifts
    const cardRows = /** @type {Types.CardsResponse} */ (cards).cards
    const { remaining } = computeWorklist(giftRows, cardRows)

    renderModeration(modItems, modTotal)
    renderReplies(replyList, unreadReplies)
    renderUnthanked(remaining)
    setInboxBadge(modTotal, unreadReplies)
  } catch (err) {
    errorEl.textContent = "Couldn't load the inbox. Try switching tabs and back."
    errorEl.hidden = false
  }
}

/** Badge-only refresh for main.js's existing poll (no 2nd timer). Two cheap
 *  count GETs; leaves the previews alone unless the tab is reloaded. */
/** @type {Types.refreshInboxBadge} */
export async function refreshInboxBadge() {
  try {
    const [modCounts, tyCounts] = await Promise.all([
      api("/api/admin/moderation/counts"),
      api("/api/admin/thank-you/counts"),
    ])
    setInboxBadge(
      /** @type {Types.ModerationCountsResponse} */ (modCounts).total,
      /** @type {Types.ThankYouCounts} */ (tyCounts).unreadReplies || 0,
    )
  } catch {
    // Non-critical.
  }
}

/** Deep-link a section's "Open →" into its full tab (and the Mailbox sub-view
 *  for replies). Clicking a tab button routes through main.js's switchTab. */
/** @param {MouseEvent} e */
function handleInboxClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest(".inbox-jump")
  if (!(btn instanceof HTMLElement)) return
  const jump = btn.dataset.jump
  if (jump === "moderation") {
    clickTab("tab-btn-moderation")
  } else if (jump === "mailbox") {
    requestThankYouMailbox()
    clickTab("tab-btn-thankyous")
  } else if (jump === "thankyous") {
    clickTab("tab-btn-thankyous")
  }
}

/** @param {string} id */
function clickTab(id) {
  const btn = document.getElementById(id)
  if (btn instanceof HTMLElement) btn.click()
}

/** @type {Types.initInbox} */
export function initInbox() {
  getElement("tab-inbox").addEventListener("click", handleInboxClick)
}
