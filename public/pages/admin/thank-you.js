/** @file Admin "Thank yous" tab: gift log, card list, the composer with a live
 *  <iframe> preview, and the per-card send wizard.
 *
 *  master/detail (not a modal — the composer needs width): a LIST view (gift
 *  table + card table) swaps in-panel with an EDITOR view. The editor's right
 *  column is an <iframe src="/thanks-preview"> driven by postMessage:
 *
 *    child → parent  { type: "card:preview-ready" }   (handshake, once)
 *    parent → child  { type: "card:preview", payload } (debounced ~160ms/edit)
 *
 *  We hold the first push until the handshake lands, then flush. {name} is
 *  substituted before pushing (renderMessage). Effect params are stored as
 *  sparse partials vs. each effect's defaults (diffConfig) — the effects_config
 *  contract. No regex anywhere (CLAUDE.md). */
/** @import * as Types from "./types.js" */
/** @import * as ThanksTypes from "../thanks/types.js" */
/** @import * as GlobalTypes from "../../../types.js" */

import { state } from "./state.js"
import {
  api,
  openModal,
  closeModal,
  showSuccess,
  showError,
  showLoading,
  showLoadError,
} from "./utils.js"
import { openConfirm } from "./confirm.js"
import {
  html,
  getElement,
  getInputElement,
  getSelectElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getIFrameElement,
  getErrorMessage,
  formatDate,
  copyToClipboard,
  announceCharsRemaining,
  getCoupleName,
} from "../utils.js"
import {
  renderMessage,
  diffConfig,
  THANK_YOU_TEMPLATES,
  buildSeedMessage,
  rerollSeedMessage,
  weaveGift,
  OCCASION_PRESETS,
} from "./thank-you-util.js"
import { fireConfetti } from "../../components/celebrate.js"
import { formatRelative } from "../../components/relative-time.js"
import { renderMonogram } from "../../components/monogram.js"
import { EFFECT_DEFINITIONS } from "../../effects/registry.js"
import { getDefaultConfig, mergeConfig } from "../../effects/config.js"
import { EFFECT_THEMES, resolveTheme } from "../../effects/themes.js"
import { LABELS, getHint } from "../../effects/control-meta.js"
import { buildControl } from "../../components/effect-controls.js"
import { replyGlyph } from "../../components/emoji.js"

/** Live-preview debounce + effect stack cap. */
const PREVIEW_DEBOUNCE_MS = 160
const MEDIA_CAP = 12
const MESSAGE_MAX = 2000
const DEFAULT_THEME = "gratitude"

/** @type {Types.ThankYouModuleState} */
const moduleState = {
  view: "list",
  dirty: false,
  effectsCustomized: false,
  // Whether the couple has hand-edited the message (guards Reroll from clobbering
  // real writing) + how many times Reroll has cycled this draft (D2).
  messageCustomized: false,
  rerollCount: 0,
  guestsLoaded: false,
  guestOptions: [],
  siteTheme: null,
  draft: null,
  previewReady: false,
  pendingPush: false,
  wizard: null,
  picker: { section: "official", selected: new Set() },
  cardFilter: "all",
  nameQuery: "",
  previewDevice: "mobile",
  replyPingEnabled: false,
  story: null,
  // Cards ⇆ Mailbox sub-view (D1). `mailboxOnLoad` lets the Inbox (A1) request
  // that entering the tab lands straight on the Mailbox.
  subView: "cards",
  mailboxOnLoad: false,
}

/** file_key → media list item, populated by the picker / editor resolution. */
const mediaCache = /** @type {Map<string, GlobalTypes.MediaListItem>} */ (new Map())
const loadedSections = new Set()

/** @type {ReturnType<typeof setTimeout> | undefined} */
let pushTimer
/** Retry handle for the readiness handshake. */
let readyPollTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
/** When we started waiting for the preview handshake, to cap retries (E2). */
let readyWaitStartedAt = 0
/** Give up on the preview handshake after this long and show a friendly note. */
const PREVIEW_READY_TIMEOUT_MS = 10000
/** localStorage key prefix for per-card/gift draft autosave (E3). */
const DRAFT_KEY_PREFIX = "ty-draft:"

/** Progress milestones (task 1). Crossing one on a send/mark-sent fires a
 *  confetti burst + a warm toast; the last-celebrated level is persisted so a
 *  plain reload never re-fires. */
const MILESTONE_KEY = "ty-milestone"
const MILESTONES = [25, 50, 75, 100]
/** @type {Record<number, string>} */
const MILESTONE_MESSAGES = {
  25: "A quarter thanked! 💌",
  50: "Halfway there! 🥂",
  75: "Three-quarters of the way there! 🎉",
  100: "Every thank-you sent — all done! 🥂🎉",
}

// ==================== Dirty guard ====================

/** @type {Types.isThankYousDirty} */
export function isThankYousDirty() {
  return moduleState.view === "editor" && moduleState.dirty
}

function markDirty() {
  moduleState.dirty = true
  saveDraftToStorage()
}

// ==================== Draft autosave (E3) ====================

/** localStorage key for the draft being edited: the card id, `gift:<id>` for a
 *  not-yet-saved gift card, or `guest:<id>` for a giftless card (task 3) so two
 *  guests' giftless drafts don't collide. @param {Types.ThankYouDraft} draft
 *  @returns {string} */
function draftStorageKey(draft) {
  if (draft.cardId != null) return DRAFT_KEY_PREFIX + String(draft.cardId)
  if (draft.giftId != null) return DRAFT_KEY_PREFIX + "gift:" + draft.giftId
  return DRAFT_KEY_PREFIX + "guest:" + draft.guestId
}

/** The persistable slice of a draft (what we restore). @param {Types.ThankYouDraft} draft */
function serializeDraft(draft) {
  return JSON.stringify({
    message: draft.message,
    theme: draft.theme,
    reveal: draft.reveal,
    effects: draft.effects,
    mediaKeys: draft.mediaKeys,
  })
}

function saveDraftToStorage() {
  const draft = moduleState.draft
  if (!draft) return
  try {
    localStorage.setItem(draftStorageKey(draft), serializeDraft(draft))
  } catch {
    // Storage full / disabled — autosave is best-effort.
  }
}

/** Clear the autosave for the currently-open draft. */
function clearDraftStorage() {
  const draft = moduleState.draft
  if (!draft) return
  try {
    localStorage.removeItem(draftStorageKey(draft))
  } catch {
    // ignore
  }
}

/** Clear an autosave by its id part (card id string or `gift:<id>`). @param {string} idPart */
function clearDraftKeyById(idPart) {
  try {
    localStorage.removeItem(DRAFT_KEY_PREFIX + idPart)
  } catch {
    // ignore
  }
}

/** Human label for an effect id (LABELS has no index signature). @param {string} id */
function labelFor(id) {
  return /** @type {Record<string, string>} */ (LABELS)[id] || id
}

// ==================== Load + badge ====================

/** @type {Types.loadThankYous} */
export async function loadThankYous() {
  showListView()
  try {
    showLoading(getElement("gifts-tbody"), 7)
    showLoading(getElement("cards-tbody"), 6)
    const [giftsData, cardsData] = await Promise.all([
      api("/api/admin/gifts"),
      api("/api/admin/thank-you"),
    ])
    state.currentGifts = /** @type {Types.GiftsResponse} */ (giftsData).gifts
    state.currentCards = /** @type {Types.CardsResponse} */ (cardsData).cards
    renderGifts()
    renderCards()
    renderProgress()
    void loadReplyPingConfig()
    // Reflect the active sub-view (D1). The Inbox (A1) can deep-link straight to
    // the Mailbox via requestThankYouMailbox(); otherwise keep the last sub-view.
    const target = moduleState.mailboxOnLoad ? "mailbox" : moduleState.subView
    moduleState.mailboxOnLoad = false
    showThankYouSubView(target)
    if (target === "mailbox") void loadMailbox()
  } catch (err) {
    console.error("Failed to load thank-yous:", err)
    showLoadError(getElement("gifts-tbody"), 7, "Couldn't load the gift log.", loadThankYous)
    getElement("cards-tbody").innerHTML = ""
  }
}

/** @type {Types.loadThankYouCount} */
export async function loadThankYouCount() {
  try {
    const counts = /** @type {Types.ThankYouCounts} */ (
      await api("/api/admin/thank-you/counts")
    )
    // Split the badge (task 1): the draft backlog is the plain count, but unread
    // replies — the emotional payoff — get their own heart pip so they can't be
    // drowned out. Defensive if either field is missing on an older backend.
    const drafts = counts.drafts || 0
    const replies = counts.unreadReplies || 0
    const badge = document.getElementById("thankyous-badge")
    if (badge) {
      badge.textContent = String(drafts)
      badge.hidden = drafts <= 0
    }
    const replyBadge = document.getElementById("thankyous-reply-badge")
    if (replyBadge) {
      replyBadge.textContent = `♥ ${replies}`
      replyBadge.hidden = replies <= 0
    }
    // Mirror the unread count onto the Mailbox sub-view pill (D1).
    const mailboxBadge = document.getElementById("tc-mailbox-badge")
    if (mailboxBadge) {
      mailboxBadge.textContent = "♥ " + replies
      mailboxBadge.hidden = replies <= 0
    }
  } catch {
    // Non-critical.
  }
}

/** Load the "email me on first reply" toggle state (task 6). Defensive: the
 *  field may be absent on an older backend, in which case we leave it off. */
async function loadReplyPingConfig() {
  try {
    const config = /** @type {Types.ThankYouSendConfig} */ (
      await api("/api/admin/thank-you/config")
    )
    moduleState.replyPingEnabled = !!config.replyPingEnabled
    const cb = document.getElementById("tc-replyping-toggle")
    if (cb instanceof HTMLInputElement) cb.checked = moduleState.replyPingEnabled
  } catch {
    // Non-critical — leave the toggle at its default.
  }
}

/** Persist the reply-ping toggle (task 6). Reverts the checkbox on failure. */
async function handleReplyPingToggle() {
  const cb = getInputElement("tc-replyping-toggle")
  const next = cb.checked
  try {
    await api("/api/admin/thank-you/config", {
      method: "POST",
      body: JSON.stringify({ replyPingEnabled: next }),
    })
    moduleState.replyPingEnabled = next
    showSuccess(
      next
        ? "You'll be emailed on the first reply to a card."
        : "Reply-notification emails turned off.",
    )
  } catch (err) {
    cb.checked = !next
    showError("Couldn't update that setting: " + getErrorMessage(err))
  }
}

// ==================== Progress ring + milestones (task 1) ====================

/** Compute the thank-you worklist from gift + card lists. Pure — shared by the
 *  tab's progress ring / queue prompt AND the Inbox summary (A1), so the "who do
 *  we still owe" logic lives in exactly one place.
 *
 *  "owed" = distinct guests we owe a thank-you: every guest with a logged gift,
 *  PLUS the guests of any gift-less card (we chose to thank them even without a
 *  gift). "thanked" = those owed guests who have at least one card that's actually
 *  been SENT (`sent_at` set — status sent or viewed); a still-draft card doesn't
 *  count. "remaining" = owed-but-not-thanked, de-duped, in gift order then
 *  gift-less-card order.
 *  @param {GlobalTypes.GiftWithGuest[]} gifts
 *  @param {GlobalTypes.ThankYouCardWithGuest[]} cards
 *  @returns {{ owed: number, thanked: number, remaining: { guestId: number, name: string }[] }} */
export function computeWorklist(gifts, cards) {
  /** @type {Set<number>} */
  const owed = new Set()
  for (const g of gifts) owed.add(g.guest_id)
  for (const c of cards) if (c.gift_id == null) owed.add(c.guest_id)
  /** @type {Set<number>} */
  const thanked = new Set()
  for (const c of cards) {
    if (c.sent_at && owed.has(c.guest_id)) thanked.add(c.guest_id)
  }
  /** @type {Set<number>} */
  const seen = new Set()
  /** @type {{ guestId: number, name: string }[]} */
  const remaining = []
  for (const g of gifts) {
    if (thanked.has(g.guest_id) || seen.has(g.guest_id)) continue
    seen.add(g.guest_id)
    remaining.push({ guestId: g.guest_id, name: g.guest_name })
  }
  for (const c of cards) {
    if (c.gift_id != null) continue
    if (thanked.has(c.guest_id) || seen.has(c.guest_id)) continue
    seen.add(c.guest_id)
    remaining.push({ guestId: c.guest_id, name: c.guest_name })
  }
  return { owed: owed.size, thanked: thanked.size, remaining }
}

/** Highest milestone (0/25/50/75/100) a percentage has reached. @param {number} pct */
function milestoneLevel(pct) {
  let level = 0
  for (const m of MILESTONES) if (pct >= m) level = m
  return level
}

/** Render the small SVG progress ring + "N of M thanked" into the tab header.
 *  Hidden entirely when nothing is owed yet. Updates on every data reload, then
 *  checks whether we've crossed a celebration milestone. */
function renderProgress() {
  const el = getElement("tc-progress")
  const { owed, thanked } = computeWorklist(state.currentGifts, state.currentCards)
  if (owed === 0) {
    el.hidden = true
    el.innerHTML = ""
    return
  }
  const done = thanked
  const total = owed
  const pct = Math.round((done / total) * 100)
  const size = 44
  const stroke = 5
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)
  const mid = size / 2
  el.innerHTML = html`
    <svg class="tc-progress-ring" width="${size}" height="${size}"
      viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="tc-progress-track" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${stroke}" />
      <circle class="tc-progress-value" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${mid} ${mid})" />
    </svg>
    <span class="tc-progress-label"><strong>${done}</strong> of <strong>${total}</strong> thanked</span>
    ${done < total
      ? html`<button type="button" id="tc-progress-next" class="btn btn-primary btn-sm tc-progress-next">
          Thank the next →
        </button>`
      : ""}
  `
  el.hidden = false
  checkMilestone(pct)
}

/** Fire the confetti + toast when the ratio crosses a milestone. The last
 *  celebrated level lives in localStorage so a reload can't re-fire it; the very
 *  first render (no stored value) seeds the baseline silently, and a drop (a
 *  card deleted) lowers the bar silently so re-reaching it celebrates again.
 *  @param {number} pct */
function checkMilestone(pct) {
  const level = milestoneLevel(pct)
  let prev = 0
  let seeded = true
  try {
    const raw = localStorage.getItem(MILESTONE_KEY)
    if (raw == null) seeded = false
    else prev = parseInt(raw, 10) || 0
  } catch {
    seeded = false
  }
  const persist = () => {
    try {
      localStorage.setItem(MILESTONE_KEY, String(level))
    } catch {
      // best-effort
    }
  }
  if (!seeded) {
    persist() // baseline — don't celebrate on the first-ever load
    return
  }
  if (level === prev) return
  persist()
  if (level > prev) {
    fireConfetti()
    showSuccess(MILESTONE_MESSAGES[level] || "Milestone reached! 🎉")
  }
}

// ==================== Thank-you queue (task 3) ====================

/** The remaining worklist: owed-but-not-thanked guests, in gift-table order then
 *  gift-less-card order, de-duplicated by guest, filtered by the active name
 *  search (the same filter the tables honor). @returns {{ guestId: number, name: string }[]} */
function remainingWorklist() {
  const q = moduleState.nameQuery
  return computeWorklist(state.currentGifts, state.currentCards).remaining.filter((i) =>
    nameMatches(i.name, q),
  )
}

/** Open the editor for a worklist guest, pre-seeded per task 2: resume their
 *  open draft if any, else compose for their first not-yet-sent gift, else a
 *  gift-less card. @param {number} guestId */
function openWorklistItem(guestId) {
  const draft = state.currentCards.find((c) => c.guest_id === guestId && c.status === "draft")
  if (draft) {
    void openEditorForCard(draft)
    return
  }
  const gift = state.currentGifts.find(
    (g) =>
      g.guest_id === guestId &&
      !state.currentCards.some((c) => c.gift_id === g.id && c.sent_at),
  )
  if (gift) {
    void openEditorForGift(gift)
    return
  }
  const name = guestNameFor(guestId)
  void openEditorForGuestless({ id: guestId, name })
}

/** Best-known display name for a guest id from the in-memory gift/card rows. */
/** @param {number} guestId @returns {string} */
function guestNameFor(guestId) {
  const gift = state.currentGifts.find((g) => g.guest_id === guestId)
  if (gift) return gift.guest_name
  const card = state.currentCards.find((c) => c.guest_id === guestId)
  return card ? card.guest_name : "this guest"
}

/** After a save/send, offer to keep the writing rhythm: a compact inline prompt
 *  with "Next: <guest> →" (focused, so Enter advances) and "Back to list". It is
 *  only ever shown from a save/send success path, and any reload or Back hides it
 *  (showListView), so it never nags on its own. @param {number | null} finishedGuestId */
function showQueuePrompt(finishedGuestId) {
  const el = getElement("tc-queue-prompt")
  const items = remainingWorklist().filter((i) => i.guestId !== finishedGuestId)
  if (items.length === 0) {
    el.hidden = true
    el.innerHTML = ""
    return
  }
  const next = items[0]
  el.innerHTML = html`
    <span class="tc-queue-text"><strong>${items.length}</strong> still to thank.</span>
    <button type="button" class="btn btn-primary btn-sm" id="tc-queue-next" data-guest-id="${next.guestId}">
      Next: ${next.name} →
    </button>
    <button type="button" class="btn btn-secondary btn-sm" id="tc-queue-back">Back to list</button>
    <button type="button" class="tc-queue-dismiss" id="tc-queue-dismiss" aria-label="Dismiss">✕</button>
  `
  el.hidden = false
  getButtonElement("tc-queue-next").focus()
}

/** Hide + clear the queue prompt so it doesn't linger or nag. */
function dismissQueuePrompt() {
  const el = getElement("tc-queue-prompt")
  el.hidden = true
  el.innerHTML = ""
}

/** @param {MouseEvent} e */
function handleQueuePromptClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("button")
  if (!(btn instanceof HTMLButtonElement)) return
  if (btn.id === "tc-queue-next") {
    const guestId = parseInt(btn.dataset.guestId || "", 10)
    dismissQueuePrompt()
    if (!Number.isNaN(guestId)) openWorklistItem(guestId)
  } else {
    // "Back to list" or the dismiss ✕ — just close it.
    dismissQueuePrompt()
  }
}

// ==================== Progress ring action (A2) ====================

/** The progress ring's "Thank the next →" button jumps straight into composing
 *  for the first still-owed guest — surfacing the worklist from a cold tab load,
 *  not only after a save. @param {MouseEvent} e */
function handleProgressClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  if (!target.closest("#tc-progress-next")) return
  const items = remainingWorklist()
  if (items.length) openWorklistItem(items[0].guestId)
}

// ==================== Mailbox (D1) ====================

/** Ask the tab to open on the Mailbox next time it loads (Inbox deep-link, A1). */
/** @type {Types.requestThankYouMailbox} */
export function requestThankYouMailbox() {
  moduleState.mailboxOnLoad = true
}

/** Switch the list view between the Cards tables and the Mailbox feed. Loading
 *  the Mailbox (fetch + mark-seen) is left to the caller so a plain reset to
 *  "cards" costs nothing. @param {"cards" | "mailbox"} view */
function showThankYouSubView(view) {
  moduleState.subView = view
  getElement("tc-cards-view").hidden = view !== "cards"
  getElement("tc-mailbox-view").hidden = view !== "mailbox"
  for (const [id, name] of /** @type {[string, "cards" | "mailbox"][]} */ ([
    ["tc-sub-cards", "cards"],
    ["tc-sub-mailbox", "mailbox"],
  ])) {
    const btn = getButtonElement(id)
    const active = name === view
    btn.classList.toggle("active", active)
    btn.setAttribute("aria-selected", active ? "true" : "false")
  }
}

/** Load + render the cross-card Mailbox feed, then acknowledge any unread replies
 *  it surfaced (mark-seen on view) so the badges clear — the visible unread
 *  highlight persists for this session (based on the fetch-time flags). */
async function loadMailbox() {
  const feed = getElement("tc-mailbox-feed")
  showLoading(feed)
  /** @type {Types.ThankYouRecentReply[]} */
  let replies
  try {
    const data = /** @type {Types.ThankYouRepliesResponse} */ (
      await api("/api/admin/thank-you/replies?limit=200")
    )
    replies = data.replies
  } catch (err) {
    showLoadError(feed, 1, "Couldn't load the mailbox.", () => void loadMailbox())
    return
  }
  renderMailbox(replies)
  await markMailboxSeen(replies)
}

/** @param {Types.ThankYouRecentReply[]} replies */
function renderMailbox(replies) {
  const feed = getElement("tc-mailbox-feed")
  if (replies.length === 0) {
    feed.innerHTML = html`<p class="empty-state">No replies yet — they'll appear here as guests write back. 💌</p>`
    return
  }
  feed.innerHTML = html`${replies.map(mailboxItem)}`
}

/** @param {Types.ThankYouRecentReply} r @returns {string} */
function mailboxItem(r) {
  const glyph = replyGlyph(r.emoji) || "💬"
  return html`
    <div class="tc-mailbox-item ${r.unread ? "is-unread" : ""}" role="listitem">
      ${renderMonogram(r.guestName)}
      <div class="tc-mailbox-body">
        <div class="tc-mailbox-head">
          <span class="tc-mailbox-name">${r.guestName}</span>
          <span class="tc-mailbox-emoji" aria-hidden="true">${glyph}</span>
          ${r.unread ? html`<span class="tc-mailbox-new">New</span>` : ""}
          <span class="tc-mailbox-time">${formatRelative(r.createdAt)}</span>
        </div>
        <div class="tc-mailbox-message">
          ${r.message || html`<span class="text-muted">(no message)</span>`}
        </div>
      </div>
    </div>
  `
}

/** Mark every card with an unread reply as seen (reusing the per-card reply-seen
 *  endpoint), then refresh the badges. Best-effort: a failed ack never blocks
 *  the view. @param {Types.ThankYouRecentReply[]} replies */
async function markMailboxSeen(replies) {
  /** @type {Set<number>} */
  const unreadCardIds = new Set()
  for (const r of replies) if (r.unread) unreadCardIds.add(r.cardId)
  if (unreadCardIds.size === 0) return
  try {
    await Promise.all(
      [...unreadCardIds].map((cardId) =>
        api(`/api/admin/thank-you/${cardId}/reply-seen`, { method: "POST" }),
      ),
    )
  } catch {
    // Non-critical — the badge just stays until the next poll.
  }
  await loadThankYouCount()
}

/** @param {MouseEvent} e */
function handleSubnavClick(e) {
  const target = e.target
  if (!(target instanceof HTMLElement)) return
  if (target.id === "tc-sub-cards" || target.closest("#tc-sub-cards")) {
    showThankYouSubView("cards")
  } else if (target.id === "tc-sub-mailbox" || target.closest("#tc-sub-mailbox")) {
    showThankYouSubView("mailbox")
    void loadMailbox()
  }
}

// ==================== List rendering ====================

/** Case-insensitive substring match — no regex (CLAUDE.md).
 *  @param {string} name @param {string} query @returns {boolean} */
function nameMatches(name, query) {
  if (!query) return true
  return (name || "").toLowerCase().includes(query.toLowerCase())
}

function renderGifts() {
  const tbody = getElement("gifts-tbody")
  const q = moduleState.nameQuery
  const gifts = state.currentGifts.filter((g) => nameMatches(g.guest_name, q))
  if (gifts.length === 0) {
    const msg = state.currentGifts.length
      ? "No gifts match your search."
      : 'No gifts logged yet. Use "Add gift" to start.'
    tbody.innerHTML = html`<tr><td colspan="7" class="empty-state">${msg}</td></tr>`
    return
  }
  tbody.innerHTML = html`${gifts.map(giftRow)}`
}

/** @param {GlobalTypes.GiftWithGuest} gift @returns {string} */
function giftRow(gift) {
  const digital = gift.digital_card_status || "none"
  const draftCard = draftCardForGift(gift.id)
  const hasNonDraftCard = state.currentCards.some(
    (c) => c.gift_id === gift.id && c.status !== "draft",
  )
  // Draft → resume it; an already-sent card exists → make it explicit that a
  // fresh "Compose" opens a *second* card (no accidental duplicates).
  const composeLabel = draftCard
    ? "Edit card"
    : hasNonDraftCard
      ? "Compose another card"
      : "Compose card"
  return html`
    <tr data-gift-id="${gift.id}">
      <td><strong>${gift.guest_name}</strong></td>
      <td class="hide-mobile">${gift.description || "-"}</td>
      <td class="hide-mobile">${gift.amount || "-"}</td>
      <td class="hide-mobile">${gift.received_at || "-"}</td>
      <td>
        <label class="tc-check-label">
          <input type="checkbox" data-action="physical" ${gift.physical_card_sent ? "checked" : ""} />
          <span>${gift.physical_card_sent ? "Sent" : "Not sent"}</span>
        </label>
      </td>
      <td><span class="status-badge status-${digital}">${digital}</span></td>
      <td class="actions-cell">
        <button type="button" class="btn btn-primary btn-sm" data-action="compose">
          ${composeLabel}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" data-action="edit-gift">Edit</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete-gift">Delete</button>
      </td>
    </tr>
  `
}

/** Does a card belong to the given status bucket (task 2)? Buckets are filters,
 *  not a partition — a viewed card can also be an unread reply.
 *  @param {GlobalTypes.ThankYouCardWithGuest} card
 *  @param {Types.ThankYouCardFilter} bucket @returns {boolean} */
function cardMatchesBucket(card, bucket) {
  if (bucket === "all") return true
  if (bucket === "draft") return card.status === "draft"
  if (bucket === "sent/unopened") return card.status !== "draft" && !!card.sent_at && !card.viewed_at
  if (bucket === "viewed") return !!card.viewed_at
  if (bucket === "unread") return !!card.replied_at && !card.reply_seen_at
  return true
}

/** The cards visible under the active status + name filters (task 2).
 *  @returns {GlobalTypes.ThankYouCardWithGuest[]} */
function filteredCards() {
  return state.currentCards.filter(
    (c) => cardMatchesBucket(c, moduleState.cardFilter) && nameMatches(c.guest_name, moduleState.nameQuery),
  )
}

function renderCards() {
  renderStatusChips()
  const tbody = getElement("cards-tbody")
  if (state.currentCards.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="6" class="empty-state">No cards yet. Compose one from a gift, or "Write a card".</td>
    </tr>`
    return
  }
  const cards = filteredCards()
  if (cards.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="6" class="empty-state">No cards match the current filter.</td>
    </tr>`
    return
  }
  tbody.innerHTML = html`${cards.map(cardRow)}`
}

/** @type {{ id: Types.ThankYouCardFilter, label: string }[]} */
const CARD_FILTER_BUCKETS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "sent/unopened", label: "Sent · unopened" },
  { id: "viewed", label: "Viewed" },
  { id: "unread", label: "Unread replies" },
]

/** Clickable status-filter chips with per-bucket counts (task 2). The "unread"
 *  chip is styled as the emotional highlight and doubles as the reply filter. */
function renderStatusChips() {
  const el = getElement("tc-status-chips")
  const cards = state.currentCards
  if (cards.length === 0) {
    el.innerHTML = ""
    return
  }
  el.innerHTML = html`${CARD_FILTER_BUCKETS.map((b) => {
    const count = cards.filter((c) => cardMatchesBucket(c, b.id)).length
    const active = moduleState.cardFilter === b.id
    const isUnread = b.id === "unread"
    const highlight = isUnread && count > 0
    return html`<button type="button"
      class="tc-chip tc-chip-filter ${active ? "is-active" : ""} ${highlight ? "is-unread" : ""}"
      data-filter="${b.id}" aria-pressed="${active ? "true" : "false"}">
      ${isUnread && count > 0 ? html`<span aria-hidden="true">♥</span> ` : ""}<strong>${count}</strong> ${b.label}
    </button>`
  })}`
}

/** @param {MouseEvent} e */
function handleStatusChipsClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-filter]")
  if (!(btn instanceof HTMLElement)) return
  const filter = /** @type {Types.ThankYouCardFilter} */ (btn.dataset.filter || "all")
  moduleState.cardFilter = filter
  renderCards()
}

/** Filter both tables by guest name as the admin types (task 2). */
function handleNameSearchInput() {
  moduleState.nameQuery = getInputElement("tc-name-search").value
  renderGifts()
  renderCards()
}

/** Compact sent → opened → replied timeline for a card row; unreached stages
 *  render dim. (D2) @param {GlobalTypes.ThankYouCardWithGuest} card @returns {string} */
function cardTimeline(card) {
  const sentStep = card.sent_at
    ? html`<span class="tc-tl-step is-done">sent ${formatDate(card.sent_at)}</span>`
    : html`<span class="tc-tl-step is-dim">not sent</span>`
  const openedStep = card.viewed_at
    ? html`<span class="tc-tl-step is-done"
        title="${card.view_count > 1
          ? `Opened ${card.view_count} times (every revisit counts)` +
            (card.last_viewed_at ? ` · last ${formatDate(card.last_viewed_at)}` : "")
          : card.last_viewed_at
            ? "Last opened " + formatDate(card.last_viewed_at)
            : ""}"
        >opened ${formatDate(card.viewed_at)}${card.view_count > 1
          ? html` · ${card.view_count}×`
          : ""}</span>`
    : html`<span class="tc-tl-step is-dim">unopened</span>`
  const repliedStep = card.replied_at
    ? html`<span class="tc-tl-step is-done">replied ${formatDate(card.replied_at)}</span>`
    : html`<span class="tc-tl-step is-dim">no reply</span>`
  return html`<div class="tc-timeline">
    ${sentStep}<span class="tc-tl-sep" aria-hidden="true">→</span>${openedStep}<span
      class="tc-tl-sep" aria-hidden="true">→</span>${repliedStep}
  </div>`
}

/** @param {GlobalTypes.ThankYouCardWithGuest} card @returns {string} */
function cardRow(card) {
  const unread = card.replied_at && !card.reply_seen_at
  const replyCell = card.replied_at
    ? html`<button type="button" class="tc-reply-cell ${unread ? "is-unread" : ""}"
        data-action="reply-seen" title="Mark reply as seen">
        <span class="tc-reply-emoji">${replyGlyph(card.reply_emoji) || "💬"}</span>
        <span class="tc-reply-excerpt">${excerpt(card.reply_message, 40)}</span>
      </button>`
    : html`<span class="text-muted">-</span>`
  const isDraft = card.status === "draft"
  return html`
    <tr data-card-id="${card.id}">
      <td><strong>${card.guest_name}</strong></td>
      <td><span class="status-badge status-${card.status}">${card.status}</span></td>
      <td class="hide-mobile">${card.sent_via || "-"}</td>
      <td class="hide-mobile">${cardTimeline(card)}</td>
      <td>${replyCell}</td>
      <td class="actions-cell">
        ${isDraft && html`<button type="button" class="btn btn-primary btn-sm" data-action="send">Send</button>`}
        <button type="button" class="btn btn-secondary btn-sm" data-action="copy-link">Copy link</button>
        ${isDraft && html`<button type="button" class="btn btn-secondary btn-sm" data-action="edit-card">Edit</button>`}
        ${!isDraft && html`<button type="button" class="btn btn-secondary btn-sm" data-action="resend">Resend</button>`}
        ${!isDraft && html`<button type="button" class="btn btn-secondary btn-sm" data-action="details">Details</button>`}
        ${card.replied_at && html`<button type="button" class="btn btn-secondary btn-sm" data-action="clear-reply">Clear reply</button>`}
        <button type="button" class="btn btn-danger btn-sm" data-action="delete-card">Delete</button>
      </td>
    </tr>
  `
}

/** @param {string | null} text @param {number} max @returns {string} */
function excerpt(text, max) {
  if (!text) return ""
  return text.length > max ? text.slice(0, max) + "…" : text
}

/** @param {number} giftId @returns {GlobalTypes.ThankYouCardWithGuest | undefined} */
function draftCardForGift(giftId) {
  return state.currentCards.find((c) => c.gift_id === giftId && c.status === "draft")
}

// ==================== View toggle ====================

function showListView() {
  moduleState.view = "list"
  moduleState.dirty = false
  // Clear any lingering queue prompt: it should only appear right after a
  // save/send, never on a plain reload or Back (task 3).
  dismissQueuePrompt()
  getElement("thankyous-list").hidden = false
  getElement("thankyous-editor").hidden = true
}

function showEditorView() {
  moduleState.view = "editor"
  getElement("thankyous-list").hidden = true
  getElement("thankyous-editor").hidden = false
}

// ==================== Gift form ====================

/** Load the full guest roster for the gift/recipient pickers (wedding-sized).
 *  Pickers pass `force` so every open refetches — the couple adds guests while
 *  composing cards, and a fetch-once cache hid new guests until a full reload.
 *  @param {boolean} [force] */
async function ensureGuestsLoaded(force = false) {
  if (moduleState.guestsLoaded && !force) return
  const data = /** @type {Types.GuestsApiResponse} */ (
    await api("/api/admin/guests?limit=1000&offset=0")
  )
  moduleState.guestOptions = data.guests.map((g) => ({ id: g.id, name: g.name }))
  moduleState.guestsLoaded = true
}

/** @param {number | null} editGiftId */
async function openGiftModal(editGiftId) {
  const errorEl = getElement("gift-form-error")
  errorEl.hidden = true
  try {
    await ensureGuestsLoaded(true)
  } catch (err) {
    showError("Couldn't load the guest list: " + getErrorMessage(err))
    return
  }
  const select = getSelectElement("gift-guest")
  select.innerHTML = html`${moduleState.guestOptions.map(
    (g) => html`<option value="${g.id}">${g.name}</option>`,
  )}`

  const gift = editGiftId ? state.getGiftById(editGiftId) : null
  getElement("gift-modal-title").textContent = gift ? "Edit gift" : "Add gift"
  getInputElement("gift-id").value = gift ? String(gift.id) : ""
  select.value = gift ? String(gift.guest_id) : select.value
  select.disabled = !!gift // recipient is fixed once logged
  getInputElement("gift-description").value = gift ? gift.description || "" : ""
  getInputElement("gift-amount").value = gift ? gift.amount || "" : ""
  getInputElement("gift-received").value = gift ? gift.received_at || "" : ""
  getTextAreaElement("gift-notes").value = gift ? gift.notes || "" : ""

  openModal(getDialogElement("gift-modal"))
}

/** @param {SubmitEvent} e */
async function handleGiftSubmit(e) {
  e.preventDefault()
  const errorEl = getElement("gift-form-error")
  errorEl.hidden = true
  const idRaw = getInputElement("gift-id").value
  const body = {
    guest_id: parseInt(getSelectElement("gift-guest").value, 10),
    description: getInputElement("gift-description").value.trim() || null,
    amount: getInputElement("gift-amount").value.trim() || null,
    received_at: getInputElement("gift-received").value.trim() || null,
    notes: getTextAreaElement("gift-notes").value.trim() || null,
  }
  const btn = getButtonElement("gift-save-btn")
  btn.disabled = true
  try {
    if (idRaw) {
      await api(`/api/admin/gifts/${idRaw}`, { method: "PUT", body: JSON.stringify(body) })
    } else {
      await api("/api/admin/gifts", { method: "POST", body: JSON.stringify(body) })
    }
    closeModal(getDialogElement("gift-modal"))
    await loadThankYous()
    showSuccess("Gift saved")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
  }
}

/** @param {number} giftId @param {boolean} sent */
async function togglePhysical(giftId, sent) {
  try {
    await api(`/api/admin/gifts/${giftId}/physical-card`, {
      method: "POST",
      body: JSON.stringify({ sent }),
    })
    const gift = state.getGiftById(giftId)
    if (gift) gift.physical_card_sent = sent ? 1 : 0
    renderGifts()
  } catch (err) {
    showError("Couldn't update the physical-card status: " + getErrorMessage(err))
    renderGifts() // revert the checkbox to server truth
  }
}

/** @param {number} giftId */
function confirmDeleteGift(giftId) {
  openConfirm({
    title: "Delete gift",
    desc: "Remove this gift from the log? Any linked cards stay, but lose their gift link.",
    confirmLabel: "Delete",
    danger: true,
    run: async () => {
      await api(`/api/admin/gifts/${giftId}`, { method: "DELETE" })
      await loadThankYous()
      showSuccess("Gift deleted")
    },
  })
}

// ==================== Gifts table interaction ====================

/** @param {MouseEvent} e */
function handleGiftsClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-action]")
  if (!(btn instanceof HTMLElement)) return
  const row = btn.closest("tr")
  if (!(row instanceof HTMLTableRowElement)) return
  const giftId = parseInt(row.dataset.giftId || "", 10)
  if (Number.isNaN(giftId)) return
  const action = btn.dataset.action
  if (action === "physical") return // handled on change
  const gift = state.getGiftById(giftId)
  if (!gift) return
  if (action === "compose") {
    const draft = draftCardForGift(giftId)
    if (draft) void openEditorForCard(draft)
    else void openEditorForGift(gift)
  } else if (action === "edit-gift") {
    void openGiftModal(giftId)
  } else if (action === "delete-gift") {
    confirmDeleteGift(giftId)
  }
}

/** @param {Event} e */
function handleGiftsChange(e) {
  const target = e.target
  if (!(target instanceof HTMLInputElement) || target.dataset.action !== "physical") return
  const row = target.closest("tr")
  if (!(row instanceof HTMLTableRowElement)) return
  const giftId = parseInt(row.dataset.giftId || "", 10)
  if (Number.isNaN(giftId)) return
  void togglePhysical(giftId, target.checked)
}

// ==================== Cards table interaction ====================

/** @param {MouseEvent} e */
function handleCardsClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-action]")
  if (!(btn instanceof HTMLElement)) return
  const row = btn.closest("tr")
  if (!(row instanceof HTMLTableRowElement)) return
  const cardId = parseInt(row.dataset.cardId || "", 10)
  if (Number.isNaN(cardId)) return
  const card = state.getCardById(cardId)
  if (!card) return
  const action = btn.dataset.action
  if (action === "send") openSendWizard(card)
  else if (action === "copy-link") void copyCardLink(card)
  else if (action === "edit-card") void openEditorForCard(card)
  else if (action === "delete-card") confirmDeleteCard(card)
  else if (action === "resend") void resendCard(card)
  else if (action === "details") void openCardDetail(card)
  else if (action === "reply-seen") void openCardDetail(card)
  else if (action === "clear-reply") confirmClearReply(card)
}

/** Clear a reply off the card surface (task 5). History is retained server-side;
 *  the contract endpoint is POST /api/admin/thank-you/cards/:id/clear-reply.
 *  @param {GlobalTypes.ThankYouCardWithGuest} card */
function confirmClearReply(card) {
  openConfirm({
    title: "Clear reply",
    desc: "Remove this reply from the card? It stays in the card's history.",
    confirmLabel: "Clear reply",
    danger: false,
    run: async () => {
      await api(`/api/admin/thank-you/cards/${card.id}/clear-reply`, { method: "POST" })
      await loadThankYous()
      await loadThankYouCount()
      showSuccess("Reply cleared")
    },
  })
}

/** @param {GlobalTypes.ThankYouCardWithGuest} card */
function cardLink(card) {
  return `${location.origin}/thanks?card=${card.token}`
}

/** Copy a card's live link. A draft link 404s publicly until the card is marked
 *  sent, so for a draft we CONFIRM → mark sent (via:"link") → only then copy.
 *  Cancel copies nothing. Already-sent cards copy immediately. (A4)
 *  @param {GlobalTypes.ThankYouCardWithGuest} card */
async function copyCardLink(card) {
  if (card.status !== "draft") {
    const ok = await copyToClipboard(cardLink(card))
    if (ok) showSuccess("Link copied")
    else window.prompt("Copy this link:", cardLink(card))
    return
  }
  openConfirm({
    title: "Copy card link",
    desc: "This makes the link live and marks the card sent. Copy it now?",
    confirmLabel: "Mark sent & copy",
    danger: false,
    run: async () => {
      await api(`/api/admin/thank-you/${card.id}/mark-sent`, {
        method: "POST",
        body: JSON.stringify({ via: "link" }),
      })
      const ok = await copyToClipboard(cardLink(card))
      await loadThankYous()
      await loadThankYouCount()
      if (ok) showSuccess("Marked as sent via link — link copied")
      else window.prompt("Marked as sent. Copy this link:", cardLink(card))
    },
  })
}

/** Resend a sent/viewed card (C1): the server returns {mode:"reset"} (re-drafted,
 *  same token) or {mode:"duplicate"} (a fresh draft clone, new token).
 *  @param {GlobalTypes.ThankYouCardWithGuest} card */
async function resendCard(card) {
  try {
    const data = /** @type {Types.ThankYouResendResponse} */ (
      await api(`/api/admin/thank-you/${card.id}/resend`, { method: "POST" })
    )
    await loadThankYous()
    await loadThankYouCount()
    const fresh = state.getCardById(data.card.id)
    if (data.mode === "reset") {
      showSuccess("Card reset to draft — same link")
      if (fresh) openSendWizard(fresh)
    } else {
      showSuccess("New draft created (new link)")
      if (fresh) void openEditorForCard(fresh)
    }
  } catch (err) {
    showError("Couldn't resend the card: " + getErrorMessage(err))
  }
}

/** Fetch a card's full detail (reply thread + engagement) and show it in a modal.
 *  Opening also acks an unread reply so the badge clears. (D2) */
/** @param {GlobalTypes.ThankYouCardWithGuest} card */
async function openCardDetail(card) {
  const body = getElement("thankyou-detail-body")
  getElement("thankyou-detail-title").textContent = `Card for ${card.guest_name}`
  body.innerHTML = html`<p class="text-muted">Loading…</p>`
  openModal(getDialogElement("thankyou-detail-modal"))
  // Ack an unread reply on open — mirrors the old reply-cell click behavior.
  const wasUnread = card.replied_at && !card.reply_seen_at
  if (wasUnread) void markReplySeen(card)
  try {
    const data = /** @type {Types.ThankYouCardDetailResponse} */ (
      await api(`/api/admin/thank-you/${card.id}`)
    )
    renderCardDetail(data.card)
  } catch (err) {
    body.innerHTML = html`<p class="form-error">Couldn't load the card: ${getErrorMessage(err)}</p>`
  }
}

/** @param {Types.ThankYouCardDetail} card */
function renderCardDetail(card) {
  const body = getElement("thankyou-detail-body")
  const replies = card.replies || []
  const thread =
    replies.length === 0
      ? html`<p class="text-muted">No replies yet.</p>`
      : html`<div class="tc-reply-thread">
          ${replies.map(
            (r) => html`<div class="tc-reply-item">
              <span class="tc-reply-item-emoji" aria-hidden="true"
                >${replyGlyph(r.emoji) || "💬"}</span>
              <div class="tc-reply-item-body">
                <div>${r.message || html`<span class="text-muted">(no message)</span>`}</div>
                <span class="tc-reply-item-time">${formatRelative(r.created_at)}</span>
              </div>
            </div>`,
          )}
        </div>`
  body.innerHTML = html`
    <div class="tc-detail-timeline">${cardTimeline(card)}</div>
    <h3>Replies</h3>
    ${thread}
  `
}

/** @param {GlobalTypes.ThankYouCardWithGuest} card */
function confirmDeleteCard(card) {
  openConfirm({
    title: "Delete card",
    desc: `Delete the thank-you card for ${card.guest_name}? This can't be undone.`,
    confirmLabel: "Delete",
    danger: true,
    run: async () => {
      await api(`/api/admin/thank-you/${card.id}`, { method: "DELETE" })
      clearDraftKeyById(String(card.id))
      await loadThankYous()
      await loadThankYouCount()
      showSuccess("Card deleted")
    },
  })
}

/** @param {GlobalTypes.ThankYouCardWithGuest} card */
async function markReplySeen(card) {
  if (!card.replied_at || card.reply_seen_at) return
  try {
    await api(`/api/admin/thank-you/${card.id}/reply-seen`, { method: "POST" })
    await loadThankYous()
    await loadThankYouCount()
  } catch (err) {
    showError("Couldn't mark the reply as seen: " + getErrorMessage(err))
  }
}

// ==================== Editor ====================

/** Seed a new card's theme from the site's active effect theme, falling back to
 *  the composer default. Cached after the first fetch. (E4) @returns {Promise<string>} */
async function resolveSeedTheme() {
  if (moduleState.siteTheme) return moduleState.siteTheme
  try {
    const data = /** @type {Types.SiteContentResponse} */ (
      await api("/api/admin/site-content")
    )
    const theme = data.content && typeof data.content.theme === "string" ? data.content.theme : DEFAULT_THEME
    moduleState.siteTheme = EFFECT_THEMES.some((t) => t.id === theme) ? theme : DEFAULT_THEME
  } catch {
    moduleState.siteTheme = DEFAULT_THEME
  }
  return moduleState.siteTheme
}

/** Human label for a card's linked gift: description (+amount) resolved from the
 *  loaded gift log, falling back to the id form only if it isn't in memory (4a).
 *  @param {number | null} giftId @returns {string} */
function giftLabelFor(giftId) {
  if (giftId == null) return "No gift linked"
  const gift = state.getGiftById(giftId)
  if (!gift) return "Linked gift #" + giftId
  const desc = gift.description || "(gift logged)"
  return gift.amount ? `${desc} (${gift.amount})` : desc
}

/** @param {GlobalTypes.GiftWithGuest} gift */
async function openEditorForGift(gift) {
  const theme = await resolveSeedTheme()
  const effects = seedEffectsFromTheme(theme)
  openEditor({
    cardId: null,
    guestId: gift.guest_id,
    giftId: gift.id,
    recipientName: gift.guest_name,
    giftLabel: giftLabelFor(gift.id),
    // Smart seed (task 2): best-fitting template chosen from the gift's fields,
    // gift description woven in, {name} resolved — a ready-to-edit default.
    message: buildSeedMessage(gift, gift.guest_name),
    theme,
    reveal: "confetti",
    effects,
    mediaKeys: [],
    mediaItems: [],
    isNew: true,
    customized: false,
  })
}

/** Compose a card for a guest WITHOUT a gift (task 3): the server accepts a null
 *  gift_id. Reached from the "Write a card" guest picker.
 *  @param {{ id: number, name: string }} guest */
async function openEditorForGuestless(guest) {
  const theme = await resolveSeedTheme()
  const effects = seedEffectsFromTheme(theme)
  openEditor({
    cardId: null,
    guestId: guest.id,
    giftId: null,
    recipientName: guest.name,
    giftLabel: "No gift linked",
    // Gift-less: the general starter with {name} resolved (task 2).
    message: buildSeedMessage(null, guest.name),
    theme,
    reveal: "confetti",
    effects,
    mediaKeys: [],
    mediaItems: [],
    isNew: true,
    customized: false,
  })
}

// ---- guest picker (write a card without a gift, task 3) ----

async function openGuestPicker() {
  try {
    await ensureGuestsLoaded(true)
  } catch (err) {
    showError("Couldn't load the guest list: " + getErrorMessage(err))
    return
  }
  getInputElement("tc-guest-picker-search").value = ""
  renderGuestPickerList("")
  openModal(getDialogElement("tc-guest-picker-modal"), getButtonElement("tc-write-card-btn"))
}

/** @param {string} query */
function renderGuestPickerList(query) {
  const q = query.trim().toLowerCase()
  const list = getElement("tc-guest-picker-list")
  const matches = moduleState.guestOptions.filter((g) => !q || g.name.toLowerCase().includes(q))
  if (matches.length === 0) {
    list.innerHTML = html`<li class="text-muted tc-guest-picker-empty">No guests match.</li>`
    return
  }
  list.innerHTML = html`${matches.slice(0, 200).map(
    (g) => html`<li>
      <button type="button" class="tc-guest-picker-item" data-guest-id="${g.id}">${g.name}</button>
    </li>`,
  )}`
}

function handleGuestPickerSearch() {
  renderGuestPickerList(getInputElement("tc-guest-picker-search").value)
}

/** @param {MouseEvent} e */
function handleGuestPickerClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-guest-id]")
  if (!(btn instanceof HTMLElement)) return
  const id = parseInt(btn.dataset.guestId || "", 10)
  if (Number.isNaN(id)) return
  const guest = moduleState.guestOptions.find((g) => g.id === id)
  if (!guest) return
  closeModal(getDialogElement("tc-guest-picker-modal"))
  void openEditorForGuestless(guest)
}

/** @param {GlobalTypes.ThankYouCardWithGuest} card */
async function openEditorForCard(card) {
  const cfg = parseEffectsConfig(card.effects_config)
  const mediaKeys = parseMediaKeys(card.media_keys)
  let mediaItems = /** @type {ThanksTypes.ThankYouMediaItem[]} */ ([])
  if (mediaKeys.length) {
    try {
      await ensureMediaLoaded("official")
      await ensureMediaLoaded("guest")
      mediaItems = mapMediaItems(mediaKeys)
    } catch {
      // Preview simply omits any photos we couldn't resolve.
    }
  }
  openEditor({
    cardId: card.id,
    guestId: card.guest_id,
    giftId: card.gift_id,
    recipientName: card.guest_name,
    giftLabel: giftLabelFor(card.gift_id),
    message: card.message,
    theme: card.theme,
    reveal: cfg.reveal,
    effects: cfg.effects,
    mediaKeys,
    mediaItems,
    isNew: false,
    customized: true,
  })
}

/** @param {Types.OpenEditorInput} seed */
function openEditor(seed) {
  moduleState.draft = {
    cardId: seed.cardId,
    guestId: seed.guestId,
    giftId: seed.giftId,
    recipientName: seed.recipientName,
    message: seed.message,
    theme: seed.theme,
    reveal: seed.reveal,
    effects: seed.effects,
    mediaKeys: seed.mediaKeys,
    mediaItems: seed.mediaItems,
  }
  moduleState.effectsCustomized = seed.customized
  // A brand-new card's message is a seeded starter (safe to Reroll silently); a
  // saved card's message is authored (Reroll must confirm). (D2)
  moduleState.messageCustomized = !seed.isNew
  moduleState.rerollCount = 0
  moduleState.dirty = seed.isNew // a brand-new unsaved draft should warn on leave
  getElement("tc-editor-error").hidden = true

  // Offer to restore a newer autosaved draft before painting the form (E3).
  maybeRestoreDraft()
  const draft = moduleState.draft
  if (!draft) return

  getElement("tc-editor-recipient").textContent = seed.recipientName
  getElement("tc-editor-gift").textContent = seed.giftLabel
  const messageEl = getTextAreaElement("tc-editor-message")
  messageEl.value = draft.message
  updateMessageCounter()
  populateTemplateSelect()
  populateThemeSelect(draft.theme)
  renderPresetChips()
  getSelectElement("tc-editor-reveal").value = draft.reveal
  renderEffectStack()
  renderPhotoStrip()
  setPreviewDevice(moduleState.previewDevice)

  showEditorView()
  getButtonElement("tc-editor-back").focus()
  schedulePreview()
  void loadGuestStory(draft.guestId)
}

/** If a differing autosaved draft exists for the open card/gift, offer to restore
 *  it; discarding clears the key so it won't re-prompt. (E3) */
function maybeRestoreDraft() {
  const draft = moduleState.draft
  if (!draft) return
  let saved = null
  try {
    saved = localStorage.getItem(draftStorageKey(draft))
  } catch {
    saved = null
  }
  if (!saved || saved === serializeDraft(draft)) return
  if (!window.confirm("Restore your unsaved draft?")) {
    clearDraftStorage()
    return
  }
  try {
    const d = JSON.parse(saved)
    if (typeof d.message === "string") draft.message = d.message
    if (typeof d.theme === "string") draft.theme = d.theme
    if (typeof d.reveal === "string") draft.reveal = d.reveal
    if (Array.isArray(d.effects)) draft.effects = d.effects
    if (Array.isArray(d.mediaKeys)) {
      draft.mediaKeys = d.mediaKeys.filter((/** @type {unknown} */ k) => typeof k === "string")
      draft.mediaItems = mapMediaItems(draft.mediaKeys)
    }
    moduleState.effectsCustomized = true
    // A restored draft is the couple's own writing — Reroll must confirm (D2).
    moduleState.messageCustomized = true
    moduleState.dirty = true
  } catch {
    // Corrupt autosave — ignore and keep the seeded draft.
  }
}

/** Fill the message-template picker with the warm starters (E4). */
function populateTemplateSelect() {
  const select = getSelectElement("tc-editor-template")
  select.innerHTML = html`
    <option value="">Choose a starter…</option>
    ${THANK_YOU_TEMPLATES.map((t) => html`<option value="${t.id}">${t.label}</option>`)}
  `
  select.value = ""
}

/** Apply a chosen template to the message (confirm before clobbering non-empty). */
function handleTemplateChange() {
  const draft = moduleState.draft
  if (!draft) return
  const select = getSelectElement("tc-editor-template")
  const id = select.value
  select.value = "" // it's an action trigger, not a persistent selection
  if (!id) return
  const tpl = THANK_YOU_TEMPLATES.find((t) => t.id === id)
  if (!tpl) return
  if (
    draft.message.trim() &&
    !window.confirm("Replace the current message with this template?")
  ) {
    return
  }
  // Weave the linked gift's description into the template's {gift} slot (task 2);
  // {name} stays a live token so the preview resolves it like every other edit.
  const gift = draft.giftId != null ? state.getGiftById(draft.giftId) : null
  const woven = weaveGift(tpl.message, gift ? gift.description : "", tpl.giftFallback)
  draft.message = woven
  getTextAreaElement("tc-editor-message").value = woven
  // A template pick is a starter, not the couple's own writing — Reroll may
  // continue cycling silently from here (D2).
  moduleState.messageCustomized = false
  updateMessageCounter()
  markDirty()
  schedulePreview()
}

/** "↻ Reroll" (D2): cycle to a DIFFERENT starter message. Never clobbers writing
 *  the couple has customized — it confirms first in that case. Deterministic per
 *  click via rerollCount so repeated taps rotate predictably. */
function handleReroll() {
  const draft = moduleState.draft
  if (!draft) return
  if (
    moduleState.messageCustomized &&
    draft.message.trim() &&
    !window.confirm("Replace your edited message with a fresh starter?")
  ) {
    return
  }
  const gift = draft.giftId != null ? state.getGiftById(draft.giftId) : null
  moduleState.rerollCount += 1
  const next = rerollSeedMessage(gift, draft.recipientName, moduleState.rerollCount)
  draft.message = next
  getTextAreaElement("tc-editor-message").value = next
  moduleState.messageCustomized = false
  updateMessageCounter()
  markDirty()
  schedulePreview()
}

// ---- occasion presets (D3) ----

/** Paint the one-tap occasion-preset chips into the editor. */
function renderPresetChips() {
  const el = getElement("tc-preset-chips")
  el.innerHTML = html`${OCCASION_PRESETS.map(
    (p) => html`<button type="button" class="tc-chip tc-preset-chip" data-preset="${p.id}"
      title="Set theme + effects for a ${p.label} feel">${p.label}</button>`,
  )}`
}

/** @param {MouseEvent} e */
function handlePresetChipsClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-preset]")
  if (!(btn instanceof HTMLElement)) return
  const preset = OCCASION_PRESETS.find((p) => p.id === btn.dataset.preset)
  if (preset) applyPreset(preset)
}

/** Apply a preset: set theme + effect stack together, sync the theme <select>,
 *  mark the config dirty/customized, and refresh the live preview.
 *  @param {{ id: string, label: string, theme: string, effects: { id: string, config: Record<string, unknown> }[] }} preset */
function applyPreset(preset) {
  const draft = moduleState.draft
  if (!draft) return
  draft.theme = preset.theme
  draft.effects = preset.effects.map((entry) => ({
    id: entry.id,
    config: structuredClone(entry.config),
  }))
  // Mark customized so a later Theme change warns before replacing these.
  moduleState.effectsCustomized = true
  getSelectElement("tc-editor-theme").value = preset.theme
  renderEffectStack()
  markDirty()
  schedulePreview()
  showSuccess(`Applied the ${preset.label} look`)
}

/** Reset the preview to sealed and play the full reveal choreography once with
 *  the currently selected one-shot ("none" → no burst). (E1) */
function handlePlayReveal() {
  const draft = moduleState.draft
  if (!draft) return
  pushPreview() // flush the latest content first (no-op if not yet ready)
  const frame = getIFrameElement("tc-preview-frame")
  if (!frame.contentWindow || !moduleState.previewReady) return
  frame.contentWindow.postMessage(
    { type: "card:play-reveal", reveal: draft.reveal },
    location.origin,
  )
}

function handleBack() {
  if (isThankYousDirty()) {
    if (!window.confirm("You have unsaved changes to this card. Leave without saving?")) return
    // Discard the abandoned autosave too, so it won't re-prompt to restore later (4b).
    clearDraftStorage()
  }
  moduleState.draft = null
  moduleState.story = null
  showListView()
}

// ---- theme / reveal / message ----

/** @param {string} selected */
function populateThemeSelect(selected) {
  const select = getSelectElement("tc-editor-theme")
  select.innerHTML = html`${EFFECT_THEMES.map(
    (t) => html`<option value="${t.id}">${t.label}</option>`,
  )}`
  select.value = selected
}

function handleThemeChange() {
  const select = getSelectElement("tc-editor-theme")
  const draft = moduleState.draft
  if (!draft) return
  const next = select.value
  if (moduleState.effectsCustomized && draft.effects.length > 0) {
    if (
      !window.confirm(
        "Switching theme replaces your customized effects with this theme's defaults. Continue?",
      )
    ) {
      select.value = draft.theme
      return
    }
  }
  draft.theme = next
  draft.effects = seedEffectsFromTheme(next)
  moduleState.effectsCustomized = false
  markDirty()
  renderEffectStack()
  schedulePreview()
}

function handleRevealChange() {
  if (!moduleState.draft) return
  moduleState.draft.reveal = getSelectElement("tc-editor-reveal").value
  markDirty()
  schedulePreview()
}

function handleMessageInput() {
  if (!moduleState.draft) return
  const el = getTextAreaElement("tc-editor-message")
  moduleState.draft.message = el.value
  // Hand-edited now — Reroll must confirm before replacing it (D2).
  moduleState.messageCustomized = true
  updateMessageCounter()
  announceCharsRemaining(el.value.length, MESSAGE_MAX, el)
  markDirty()
  schedulePreview()
}

function updateMessageCounter() {
  const el = getTextAreaElement("tc-editor-message")
  getElement("tc-message-counter").textContent = `${el.value.length} / ${MESSAGE_MAX}`
}

// ---- effect stack ----

/** Build the sparse effect list for a theme (registry ids + the theme's partials).
 *  @param {string} themeId @returns {ThanksTypes.CardEffectEntry[]} */
function seedEffectsFromTheme(themeId) {
  const theme = resolveTheme(themeId)
  return theme.effectIds.map((id) => ({
    id,
    config: theme.configs && theme.configs[id] ? structuredClone(theme.configs[id]) : {},
  }))
}

function renderEffectStack() {
  const stackEl = getElement("tc-effect-stack")
  stackEl.textContent = ""
  const draft = moduleState.draft
  if (!draft) return
  draft.effects.forEach((entry, idx) => {
    const details = document.createElement("details")
    details.className = "tc-effect-row"

    const summary = document.createElement("summary")
    summary.className = "tc-effect-summary"
    const name = document.createElement("span")
    name.textContent = labelFor(entry.id)
    summary.appendChild(name)
    const removeBtn = document.createElement("button")
    removeBtn.type = "button"
    removeBtn.className = "btn btn-danger btn-sm tc-effect-remove"
    removeBtn.textContent = "Remove"
    removeBtn.addEventListener("click", (ev) => {
      ev.preventDefault()
      removeEffect(idx)
    })
    summary.appendChild(removeBtn)
    details.appendChild(summary)

    const controls = document.createElement("div")
    controls.className = "tc-effect-controls"
    const defaults = getDefaultConfig(entry.id)
    if (defaults) {
      const full = /** @type {Record<string, unknown>} */ (mergeConfig(defaults, entry.config || {}))
      for (const key of Object.keys(full)) {
        controls.appendChild(
          buildControl(key, full[key], {
            effectId: entry.id,
            getHint,
            onChange: (k, nextVal) => onEffectParamChange(idx, k, nextVal),
          }),
        )
      }
    }
    details.appendChild(controls)
    stackEl.appendChild(details)
  })
  populateAddEffectSelect()
}

/** @param {number} idx @param {string} key @param {unknown} nextVal */
function onEffectParamChange(idx, key, nextVal) {
  const draft = moduleState.draft
  if (!draft) return
  const entry = draft.effects[idx]
  if (!entry) return
  const defaults = getDefaultConfig(entry.id)
  if (!defaults) return
  const full = /** @type {Record<string, unknown>} */ (mergeConfig(defaults, entry.config || {}))
  full[key] = nextVal
  entry.config = diffConfig(/** @type {Record<string, unknown>} */ (defaults), full)
  moduleState.effectsCustomized = true
  markDirty()
  schedulePreview()
}

/** @param {number} idx */
function removeEffect(idx) {
  const draft = moduleState.draft
  if (!draft) return
  draft.effects.splice(idx, 1)
  moduleState.effectsCustomized = true
  markDirty()
  renderEffectStack()
  schedulePreview()
}

function populateAddEffectSelect() {
  const select = getSelectElement("tc-effect-add-select")
  const options = EFFECT_DEFINITIONS.map((d) => ({ id: d.id, label: labelFor(d.id) })).sort(
    (a, b) => a.label.localeCompare(b.label),
  )
  select.innerHTML = html`${options.map(
    (o) => html`<option value="${o.id}">${o.label}</option>`,
  )}`
}

function handleAddEffect() {
  const draft = moduleState.draft
  if (!draft) return
  const id = getSelectElement("tc-effect-add-select").value
  if (!id) return
  draft.effects.push({ id, config: {} })
  moduleState.effectsCustomized = true
  markDirty()
  renderEffectStack()
  schedulePreview()
}

// ---- photos ----

function renderPhotoStrip() {
  const strip = getElement("tc-photo-strip")
  const draft = moduleState.draft
  const count = draft ? draft.mediaKeys.length : 0
  getElement("tc-photo-count").textContent = `${count}/${MEDIA_CAP}`
  if (!draft || draft.mediaKeys.length === 0) {
    strip.innerHTML = html`<span class="text-muted">No photos yet.</span>`
    return
  }
  strip.innerHTML = html`${draft.mediaKeys.map((key, idx) => {
    const total = draft.mediaKeys.length
    const item = mediaCache.get(key)
    const isVideo = item && item.kind === "video"
    return html`
      <div class="tc-photo-chip" data-key="${key}">
        <img class="tc-photo-thumb" src="/media/${key}/${isVideo ? "poster" : "thumb"}" alt="" loading="lazy" />
        <div class="tc-photo-chip-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-photo-action="left"
            aria-label="Move left" ${idx === 0 ? "disabled" : ""}>←</button>
          <button type="button" class="btn btn-secondary btn-sm" data-photo-action="right"
            aria-label="Move right" ${idx === total - 1 ? "disabled" : ""}>→</button>
          <button type="button" class="btn btn-danger btn-sm" data-photo-action="remove"
            aria-label="Remove">✕</button>
        </div>
      </div>
    `
  })}`
}

/** @param {MouseEvent} e */
function handlePhotoStripClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-photo-action]")
  if (!(btn instanceof HTMLElement)) return
  const chip = btn.closest(".tc-photo-chip")
  if (!(chip instanceof HTMLElement)) return
  const key = chip.dataset.key
  const draft = moduleState.draft
  if (!draft || !key) return
  const idx = draft.mediaKeys.indexOf(key)
  if (idx === -1) return
  const action = btn.dataset.photoAction
  if (action === "remove") {
    draft.mediaKeys.splice(idx, 1)
  } else if (action === "left" && idx > 0) {
    swap(draft.mediaKeys, idx, idx - 1)
  } else if (action === "right" && idx < draft.mediaKeys.length - 1) {
    swap(draft.mediaKeys, idx, idx + 1)
  } else {
    return
  }
  draft.mediaItems = mapMediaItems(draft.mediaKeys)
  markDirty()
  renderPhotoStrip()
  schedulePreview()
}

/** @param {string[]} arr @param {number} a @param {number} b */
function swap(arr, a, b) {
  const tmp = arr[a]
  arr[a] = arr[b]
  arr[b] = tmp
}

/** The photo picker passes `force` so each section view refetches — photos get
 *  approved/promoted while the couple composes, and a fetch-once cache hid them
 *  until a full reload. Editor-open key mapping keeps the cached fast path.
 *  @param {"official" | "guest"} section @param {boolean} [force] */
async function ensureMediaLoaded(section, force = false) {
  if (loadedSections.has(section) && !force) return
  const data = /** @type {GlobalTypes.MediaListResponse} */ (
    await api(`/api/media?section=${section}&limit=500`)
  )
  for (const item of data.items) mediaCache.set(item.file_key, item)
  loadedSections.add(section)
}

/** @param {string[]} keys @returns {ThanksTypes.ThankYouMediaItem[]} */
function mapMediaItems(keys) {
  /** @type {ThanksTypes.ThankYouMediaItem[]} */
  const out = []
  for (const key of keys) {
    const item = mediaCache.get(key)
    if (item) {
      out.push({
        file_key: key,
        kind: item.kind,
        width: item.width,
        height: item.height,
        needs_display: item.needs_display,
      })
    }
  }
  return out
}

// ---- photo picker modal ----

async function openPhotoPicker() {
  const draft = moduleState.draft
  if (!draft) return
  moduleState.picker.selected = new Set(draft.mediaKeys)
  moduleState.picker.section = "official"
  setPickerSectionUI("official")
  openModal(getDialogElement("photo-picker-modal"))
  await loadPickerSection("official")
}

/** @param {"official" | "guest"} section */
function setPickerSectionUI(section) {
  const off = getButtonElement("picker-section-official")
  const gst = getButtonElement("picker-section-guest")
  off.classList.toggle("active", section === "official")
  off.setAttribute("aria-selected", section === "official" ? "true" : "false")
  gst.classList.toggle("active", section === "guest")
  gst.setAttribute("aria-selected", section === "guest" ? "true" : "false")
}

/** @param {"official" | "guest"} section */
async function loadPickerSection(section) {
  moduleState.picker.section = section
  setPickerSectionUI(section)
  const grid = getElement("photo-picker-grid")
  showLoading(grid)
  try {
    await ensureMediaLoaded(section, true)
  } catch (err) {
    showLoadError(grid, 1, "Couldn't load photos.", () => loadPickerSection(section))
    return
  }
  renderPickerGrid(section)
}

/** @param {"official" | "guest"} section */
function renderPickerGrid(section) {
  const grid = getElement("photo-picker-grid")
  const items = [...mediaCache.values()].filter((i) => i.section === section)
  if (items.length === 0) {
    grid.innerHTML = html`<p class="text-muted">No ${section} photos available.</p>`
    updatePickerCount()
    return
  }
  grid.innerHTML = html`${items.map((item) => {
    const selected = moduleState.picker.selected.has(item.file_key)
    const isVideo = item.kind === "video"
    return html`
      <button type="button" class="tc-picker-item ${selected ? "is-selected" : ""}"
        data-key="${item.file_key}" aria-pressed="${selected ? "true" : "false"}">
        <img src="/media/${item.file_key}/${isVideo ? "poster" : "thumb"}" alt="" loading="lazy" />
        ${selected && html`<span class="tc-picker-check" aria-hidden="true">✓</span>`}
      </button>
    `
  })}`
  updatePickerCount()
}

function updatePickerCount() {
  getElement("picker-count").textContent = `${moduleState.picker.selected.size} of ${MEDIA_CAP} selected`
}

/** @param {MouseEvent} e */
function handlePickerGridClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest(".tc-picker-item")
  if (!(btn instanceof HTMLElement) || !btn.dataset.key) return
  const key = btn.dataset.key
  const selected = moduleState.picker.selected
  if (selected.has(key)) {
    selected.delete(key)
  } else {
    if (selected.size >= MEDIA_CAP) {
      showError(`You can attach up to ${MEDIA_CAP} photos.`)
      return
    }
    selected.add(key)
  }
  renderPickerGrid(moduleState.picker.section)
}

function confirmPhotoPicker() {
  const draft = moduleState.draft
  if (!draft) return
  const selected = moduleState.picker.selected
  // Preserve the existing order for kept keys, then append newly-selected ones.
  const kept = draft.mediaKeys.filter((k) => selected.has(k))
  for (const k of selected) if (!kept.includes(k)) kept.push(k)
  draft.mediaKeys = kept.slice(0, MEDIA_CAP)
  draft.mediaItems = mapMediaItems(draft.mediaKeys)
  markDirty()
  renderPhotoStrip()
  schedulePreview()
  closeModal(getDialogElement("photo-picker-modal"))
}

// ---- guest-story sidecar (task 7) ----

/** Fetch the recipient's story and render the composer sidecar. Defensive: a
 *  404/error just hides the panel silently. @param {number} guestId */
async function loadGuestStory(guestId) {
  moduleState.story = null
  getElement("tc-story-panel").hidden = true
  try {
    const story = /** @type {Types.GuestStory} */ (
      await api(`/api/admin/guests/${guestId}/story`)
    )
    // Guard the async race: the admin may have navigated to another card.
    if (!moduleState.draft || moduleState.draft.guestId !== guestId) return
    moduleState.story = story
    renderStory(story)
  } catch {
    // No story / endpoint absent → leave the panel hidden.
  }
}

/** @param {Types.GuestStory} story */
function renderStory(story) {
  const panel = getElement("tc-story-panel")
  const body = getElement("tc-story-body")
  /** @type {string[]} */
  const parts = []
  if (story.rsvpNote) {
    parts.push(html`<div class="tc-story-block"><h4>RSVP note</h4><p>${story.rsvpNote}</p></div>`)
  }
  if (story.guestbookEntry) {
    parts.push(html`<div class="tc-story-block">
      <h4>Guestbook</h4>
      <p class="tc-story-quote">${story.guestbookEntry.message}</p>
      <button type="button" class="btn btn-secondary btn-sm" id="tc-story-quote-btn">
        Quote their guestbook entry
      </button>
    </div>`)
  }
  if (story.media.length) {
    parts.push(html`<div class="tc-story-block">
      <h4>Their photos</h4>
      <div class="tc-story-thumbs">
        ${story.media.slice(0, 12).map(
          (m) => html`<img class="tc-story-thumb"
            src="/media/${m.fileKey}/${m.kind === "video" ? "poster" : "thumb"}" alt="" loading="lazy" />`,
        )}
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="tc-story-photos-btn">Add their photos</button>
    </div>`)
  }
  if (story.gifts.length) {
    parts.push(html`<div class="tc-story-block">
      <h4>Gifts</h4>
      <ul class="tc-story-list">
        ${story.gifts.map(
          (g) => html`<li>${g.description || "(gift)"}${g.amount ? html` · ${g.amount}` : ""}${g.physicalCardSent
            ? html` · physical card sent`
            : ""}</li>`,
        )}
      </ul>
    </div>`)
  }
  if (story.cards.length) {
    parts.push(html`<div class="tc-story-block">
      <h4>Prior cards</h4>
      <ul class="tc-story-list">
        ${story.cards.map(
          (c) => html`<li>${c.status}${c.sentAt ? html` · sent ${formatDate(c.sentAt)}` : ""}${c.repliedAt
            ? html` · replied`
            : ""}</li>`,
        )}
      </ul>
    </div>`)
  }
  if (parts.length === 0) {
    panel.hidden = true
    return
  }
  body.innerHTML = html`${parts}`
  panel.hidden = false
  const quoteBtn = document.getElementById("tc-story-quote-btn")
  if (quoteBtn instanceof HTMLButtonElement) quoteBtn.addEventListener("click", handleQuoteGuestbook)
  const photosBtn = document.getElementById("tc-story-photos-btn")
  if (photosBtn instanceof HTMLButtonElement) photosBtn.addEventListener("click", handleAddTheirPhotos)
}

/** Seed the media cache with the guest's own photos so the strip/preview can
 *  resolve thumbnails without a separate section fetch. @param {Types.GuestStory["media"]} media */
function seedStoryMedia(media) {
  for (const m of media) {
    if (mediaCache.has(m.fileKey)) continue
    const kind = /** @type {GlobalTypes.MediaKind} */ (m.kind === "video" ? "video" : "image")
    mediaCache.set(m.fileKey, {
      id: 0,
      file_key: m.fileKey,
      kind,
      section: "guest",
      status: "approved",
      caption: null,
      width: null,
      height: null,
      duration_seconds: null,
      needs_display: false,
      author_name: "",
      is_own: false,
      created_at: "",
    })
  }
}

/** One-click assist: attach the guest's own photos, respecting the media cap (7). */
function handleAddTheirPhotos() {
  const draft = moduleState.draft
  const story = moduleState.story
  if (!draft || !story) return
  seedStoryMedia(story.media)
  let added = 0
  for (const m of story.media) {
    if (draft.mediaKeys.length >= MEDIA_CAP) break
    if (draft.mediaKeys.includes(m.fileKey)) continue
    draft.mediaKeys.push(m.fileKey)
    added++
  }
  if (added === 0) {
    showError(`Nothing to add — already attached, or the ${MEDIA_CAP}-photo limit is reached.`)
    return
  }
  draft.mediaItems = mapMediaItems(draft.mediaKeys)
  markDirty()
  renderPhotoStrip()
  schedulePreview()
  showSuccess(`Added ${added} photo${added === 1 ? "" : "s"}.`)
}

/** One-click assist: append the guest's guestbook line as a P.S. the admin can
 *  edit (task 7). Capped to the message limit. */
function handleQuoteGuestbook() {
  const draft = moduleState.draft
  const story = moduleState.story
  if (!draft || !story || !story.guestbookEntry) return
  const ps = `\n\nP.S. …"${story.guestbookEntry.message}" — we loved this.`
  draft.message = (draft.message + ps).slice(0, MESSAGE_MAX)
  getTextAreaElement("tc-editor-message").value = draft.message
  updateMessageCounter()
  markDirty()
  schedulePreview()
}

// ---- save ----

async function handleSave() {
  const draft = moduleState.draft
  if (!draft) return
  const errorEl = getElement("tc-editor-error")
  errorEl.hidden = true
  if (!draft.message.trim()) {
    errorEl.textContent = "The card needs a message."
    errorEl.hidden = false
    return
  }
  const btn = getButtonElement("tc-editor-save")
  btn.disabled = true
  /** @type {Record<string, unknown>} */
  const body = {
    gift_id: draft.giftId,
    message: draft.message,
    theme: draft.theme,
    effects_config: { reveal: draft.reveal, effects: draft.effects },
    media_keys: draft.mediaKeys,
  }
  try {
    if (draft.cardId) {
      await api(`/api/admin/thank-you/${draft.cardId}`, { method: "PUT", body: JSON.stringify(body) })
    } else {
      body.guest_id = draft.guestId
      await api("/api/admin/thank-you", { method: "POST", body: JSON.stringify(body) })
    }
    clearDraftStorage()
    const finishedGuestId = draft.guestId
    moduleState.dirty = false
    moduleState.draft = null
    await loadThankYous()
    await loadThankYouCount()
    showSuccess("Card saved")
    // Keep the writing rhythm: offer the next un-thanked guest (task 3).
    showQueuePrompt(finishedGuestId)
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
  }
}

// ==================== Preview device toggle (4d) ====================

/** Toggle the live-preview width. Mobile (~390px) is the default because guests
 *  overwhelmingly open cards on phones. @param {"mobile" | "desktop"} device */
function setPreviewDevice(device) {
  moduleState.previewDevice = device
  const wrap = getElement("tc-preview-wrap")
  wrap.classList.toggle("device-mobile", device === "mobile")
  wrap.classList.toggle("device-desktop", device === "desktop")
  const mobileBtn = getButtonElement("tc-preview-mobile")
  const desktopBtn = getButtonElement("tc-preview-desktop")
  mobileBtn.classList.toggle("active", device === "mobile")
  desktopBtn.classList.toggle("active", device === "desktop")
  mobileBtn.setAttribute("aria-pressed", device === "mobile" ? "true" : "false")
  desktopBtn.setAttribute("aria-pressed", device === "desktop" ? "true" : "false")
}

// ==================== Live preview protocol ====================

function schedulePreview() {
  clearTimeout(pushTimer)
  pushTimer = setTimeout(pushPreview, PREVIEW_DEBOUNCE_MS)
}

function pushPreview() {
  const draft = moduleState.draft
  if (!draft) return
  const frame = getIFrameElement("tc-preview-frame")
  if (!frame.contentWindow) return
  if (!moduleState.previewReady) {
    moduleState.pendingPush = true
    if (!readyWaitStartedAt) readyWaitStartedAt = Date.now()
    // Give up after ~10s instead of polling forever, and tell the admin the
    // preview couldn't load rather than leaving a silent blank pane (E2).
    if (Date.now() - readyWaitStartedAt > PREVIEW_READY_TIMEOUT_MS) {
      clearTimeout(readyPollTimer)
      getElement("tc-preview-unavailable").hidden = false
      return
    }
    // Close the handshake race: the iframe loads at page load and may have
    // posted its initial "ready" before our listener existed (or after — order
    // isn't guaranteed). Prompt it to re-announce, and keep prompting on a short
    // interval until its reply flips previewReady and flushes the pending push.
    frame.contentWindow.postMessage({ type: "card:preview-hello" }, location.origin)
    clearTimeout(readyPollTimer)
    readyPollTimer = setTimeout(() => {
      if (!moduleState.previewReady) pushPreview()
    }, 150)
    return
  }
  clearTimeout(readyPollTimer)
  readyWaitStartedAt = 0
  getElement("tc-preview-unavailable").hidden = true
  const message = {
    type: "card:preview",
    payload: {
      themeId: draft.theme,
      recipientName: draft.recipientName,
      message: renderMessage(draft.message, { name: draft.recipientName || "friend" }),
      reveal: draft.reveal,
      effects: draft.effects,
      mediaItems: draft.mediaItems,
      coupleName: getCoupleName(),
    },
  }
  frame.contentWindow.postMessage(message, location.origin)
}

/** @param {MessageEvent} e */
function handlePreviewMessage(e) {
  if (e.origin !== location.origin) return
  const data = e.data
  if (!data || typeof data !== "object") return
  if (data.type !== "card:preview-ready") return
  moduleState.previewReady = true
  if (moduleState.pendingPush) {
    moduleState.pendingPush = false
    pushPreview()
  }
}

// ==================== Send wizard ====================

/** @param {GlobalTypes.ThankYouCardWithGuest} card */
async function openSendWizard(card) {
  moduleState.wizard = { cardId: card.id, recipientName: card.guest_name, step: "config", config: null }
  getElement("tysend-recipient-summary").innerHTML = html`Sending the card for
    <strong>${card.guest_name}</strong>.`
  getElement("tysend-error").hidden = true
  getElement("tysend-step-config").hidden = false
  getElement("tysend-step-preview").hidden = true
  getElement("tysend-step-results").hidden = true
  getButtonElement("tysend-back-btn").hidden = true
  // Start empty: an untouched textarea sends customMessage=null so the server
  // routes email through the branded HTML template (A3). The default is shown
  // read-only below the box instead of prefilled.
  getTextAreaElement("tysend-message").value = ""
  const nextBtn = getButtonElement("tysend-next-btn")
  nextBtn.textContent = "Preview"
  nextBtn.disabled = false

  try {
    const config = /** @type {Types.ThankYouSendConfig} */ (
      await api("/api/admin/thank-you/config")
    )
    moduleState.wizard.config = config
    applySendConfigUI(config)
  } catch (err) {
    showError("Couldn't load send options: " + getErrorMessage(err))
    return
  }
  openModal(getDialogElement("thankyou-send-modal"))
  updateSendDefaultPreview()
}

/** @param {Types.ThankYouSendConfig} config */
function applySendConfigUI(config) {
  applyChannelStatus("tysend-email-status", config.email.configured, "email")
  applyChannelStatus("tysend-sms-status", config.sms.configured, "sms")
  const emailRadio = sendChannelRadio("email")
  const smsRadio = sendChannelRadio("sms")
  // Land on a usable channel: first configured, else manual.
  if (emailRadio && emailRadio.disabled) {
    if (smsRadio && !smsRadio.disabled) smsRadio.checked = true
    else {
      const manual = sendChannelRadio("manual")
      if (manual) manual.checked = true
    }
  }
  updateSendPrimaryLabel()
}

/** Label the primary wizard button for the selected channel. Email/SMS open a
 *  preview step first ("Preview"); manual has no preview and immediately marks
 *  the card sent, so it gets an explicit, commit-flavored label that is then
 *  routed through a confirm dialog in handleSendNext. */
function updateSendPrimaryLabel() {
  getButtonElement("tysend-next-btn").textContent =
    selectedSendChannel() === "manual" ? "Mark as sent…" : "Preview"
}

/** @param {string} statusId @param {boolean} configured @param {string} channel */
function applyChannelStatus(statusId, configured, channel) {
  const status = getElement(statusId)
  status.textContent = configured ? "(configured)" : "(not set up)"
  status.classList.toggle("text-success", configured)
  status.classList.toggle("text-danger", !configured)
  const radio = sendChannelRadio(channel)
  if (radio) radio.disabled = !configured
}

/** @param {string} value @returns {HTMLInputElement | null} */
function sendChannelRadio(value) {
  const el = document.querySelector(`input[name="tysend-channel"][value="${value}"]`)
  return el instanceof HTMLInputElement ? el : null
}

function selectedSendChannel() {
  const checked = document.querySelector('input[name="tysend-channel"]:checked')
  return checked instanceof HTMLInputElement ? checked.value : "email"
}

/** Show the selected channel's default message read-only (A3). The textarea
 *  stays empty unless the admin types a custom message; manual falls back to the
 *  email default as its composable base. */
function updateSendDefaultPreview() {
  const wizard = moduleState.wizard
  if (!wizard || !wizard.config) return
  const channel = selectedSendChannel()
  getElement("tysend-message-group").hidden = false
  const def =
    channel === "sms" ? wizard.config.sms.defaultMessage : wizard.config.email.defaultMessage
  getElement("tysend-default-preview").textContent = def
}

async function handleSendNext() {
  const wizard = moduleState.wizard
  if (!wizard) return
  const errorEl = getElement("tysend-error")
  errorEl.hidden = true
  const nextBtn = getButtonElement("tysend-next-btn")
  const backBtn = getButtonElement("tysend-back-btn")

  if (wizard.step === "config") {
    const channel = selectedSendChannel()
    if (channel === "manual") {
      // Manual has no preview step — it commits (mark-sent, link goes live), so
      // confirm before doing it. The confirm dialog surfaces its own errors and
      // stays open on failure; success leaves the send modal on its results step.
      openConfirm({
        title: "Mark as sent",
        desc: "This marks the card sent so its link goes live. You'll then get the composed message to copy and share yourself.",
        confirmLabel: "Mark as sent",
        danger: false,
        run: async () => {
          const data = /** @type {Types.ThankYouCardResponse} */ (
            await api(`/api/admin/thank-you/${wizard.cardId}/mark-sent`, {
              method: "POST",
              body: JSON.stringify({ via: "manual" }),
            })
          )
          clearDraftKeyById(String(wizard.cardId))
          renderSendResultsManual(data.card ? data.card.token : "")
          wizard.step = "results"
          getElement("tysend-step-config").hidden = true
          getElement("tysend-step-results").hidden = false
          nextBtn.textContent = "Done"
        },
      })
      return
    }

    // email / sms → preview
    const customMessage = getTextAreaElement("tysend-message").value.trim() || null
    nextBtn.disabled = true
    nextBtn.textContent = "Loading…"
    try {
      const data = /** @type {Types.ThankYouPreviewResponse} */ (
        await api("/api/admin/thank-you/preview", {
          method: "POST",
          body: JSON.stringify({ cardId: wizard.cardId, type: channel, customMessage }),
        })
      )
      renderSendPreview(data)
      wizard.step = "preview"
      getElement("tysend-step-config").hidden = true
      getElement("tysend-step-preview").hidden = false
      backBtn.hidden = false
      // A skipped recipient (no contact) leaves Send disabled; Back returns to config.
      nextBtn.textContent = data.skipped ? "Can't send" : "Send"
      nextBtn.disabled = !!data.skipped
    } catch (err) {
      errorEl.textContent = getErrorMessage(err)
      errorEl.hidden = false
      nextBtn.textContent = "Preview"
      nextBtn.disabled = false
    }
  } else if (wizard.step === "preview") {
    const channel = selectedSendChannel()
    const customMessage = getTextAreaElement("tysend-message").value.trim() || null
    nextBtn.disabled = true
    nextBtn.textContent = "Sending…"
    backBtn.disabled = true
    try {
      await api("/api/admin/thank-you/send", {
        method: "POST",
        body: JSON.stringify({ cardId: wizard.cardId, type: channel, customMessage }),
      })
      clearDraftKeyById(String(wizard.cardId))
      renderSendResultsSent()
      wizard.step = "results"
      getElement("tysend-step-preview").hidden = true
      getElement("tysend-step-results").hidden = false
      backBtn.hidden = true
      nextBtn.textContent = "Done"
      nextBtn.disabled = false
    } catch (err) {
      errorEl.textContent = getErrorMessage(err)
      errorEl.hidden = false
      nextBtn.disabled = false
      nextBtn.textContent = "Send"
    } finally {
      backBtn.disabled = false
    }
  } else {
    // results → close + refresh
    const sentCard = state.getCardById(wizard.cardId)
    const finishedGuestId = sentCard ? sentCard.guest_id : null
    closeModal(getDialogElement("thankyou-send-modal"))
    moduleState.wizard = null
    await loadThankYous()
    await loadThankYouCount()
    // Keep the writing rhythm after a send/mark-sent (task 3).
    showQueuePrompt(finishedGuestId)
  }
}

function handleSendBack() {
  const wizard = moduleState.wizard
  if (!wizard || wizard.step !== "preview") return
  wizard.step = "config"
  getElement("tysend-step-preview").hidden = true
  getElement("tysend-step-config").hidden = false
  getButtonElement("tysend-back-btn").hidden = true
  const nextBtn = getButtonElement("tysend-next-btn")
  nextBtn.textContent = "Preview"
  nextBtn.disabled = false
}

/** @param {Types.ThankYouPreviewResponse} data */
function renderSendPreview(data) {
  const el = getElement("tysend-preview-content")
  if (data.skipped) {
    el.innerHTML = html`<div class="alert alert-warning">
      Can't send by ${data.type}: ${data.skipped.reason}. Try another channel or copy the link.
    </div>`
    return
  }
  const header = html`<p>Will send by <strong>${data.type}</strong> to
    <strong>${data.recipient.name}</strong> (${data.recipient.contact}):</p>`
  // For email, render the full branded HTML in a fully-sandboxed iframe when the
  // backend supplies it (4c); fall back to the text preview otherwise.
  if (data.type === "email" && data.emailHtml) {
    el.innerHTML = html`${header}
      <div class="tysend-email-preview">
        <iframe class="tysend-email-frame" sandbox="" title="Email preview"></iframe>
      </div>`
    const frame = el.querySelector(".tysend-email-frame")
    if (frame instanceof HTMLIFrameElement) frame.srcdoc = data.emailHtml
    return
  }
  el.innerHTML = html`${header}
    <div class="preview-message">${data.recipient.messagePreview}</div>`
}

function renderSendResultsSent() {
  getElement("tysend-results-content").innerHTML = html`
    <div class="alert alert-success">Sent! The card is on its way.</div>
  `
}

/** Manual "copy the message myself" result: show the fully composed message
 *  (recipient name + live link resolved) in a copyable block. Recorded as
 *  via:"manual". (C3) @param {string} token */
function renderSendResultsManual(token) {
  const wizard = moduleState.wizard
  const link = token ? `${location.origin}/thanks?card=${token}` : ""
  const custom = getTextAreaElement("tysend-message").value.trim()
  const template = custom || (wizard && wizard.config ? wizard.config.email.defaultMessage : "")
  const name = wizard ? wizard.recipientName : "friend"
  const composed = renderMessage(template, { name, url: link })
  getElement("tysend-results-content").innerHTML = html`
    <div class="alert alert-success">Marked as sent. Copy this message and share it however you like:</div>
    <textarea id="tysend-manual-message" class="tc-manual-message" rows="7" readonly>${composed}</textarea>
    <div class="tc-copy-link-row">
      <button type="button" id="tysend-copy-btn" class="btn btn-secondary btn-sm">Copy message</button>
    </div>
  `
  const copyBtn = document.getElementById("tysend-copy-btn")
  if (copyBtn instanceof HTMLButtonElement) {
    copyBtn.addEventListener("click", async () => {
      const ok = await copyToClipboard(composed)
      copyBtn.textContent = ok ? "Copied!" : "Copy failed"
    })
  }
}

// ==================== Parse helpers ====================

/** @param {string | null} raw @returns {{ reveal: string, effects: ThanksTypes.CardEffectEntry[] }} */
function parseEffectsConfig(raw) {
  if (!raw) return { reveal: "confetti", effects: [] }
  try {
    const o = JSON.parse(raw)
    const reveal = o && typeof o.reveal === "string" ? o.reveal : "confetti"
    const effects = o && Array.isArray(o.effects) ? o.effects : []
    return { reveal, effects }
  } catch {
    return { reveal: "confetti", effects: [] }
  }
}

/** @param {string | null} raw @returns {string[]} */
function parseMediaKeys(raw) {
  if (!raw) return []
  try {
    const a = JSON.parse(raw)
    return Array.isArray(a) ? a.filter((k) => typeof k === "string") : []
  } catch {
    return []
  }
}

// ==================== Init ====================

/** @type {Types.initThankYous} */
export function initThankYous() {
  // Preview handshake listener — attached once, before the iframe may post ready.
  window.addEventListener("message", handlePreviewMessage)

  getElement("gifts-tbody").addEventListener("click", handleGiftsClick)
  getElement("gifts-tbody").addEventListener("change", handleGiftsChange)
  getElement("cards-tbody").addEventListener("click", handleCardsClick)

  // Filters, search, reply-ping toggle, and the "Write a card" picker (tasks 2/3/6).
  getInputElement("tc-name-search").addEventListener("input", handleNameSearchInput)
  getElement("tc-status-chips").addEventListener("click", handleStatusChipsClick)
  getInputElement("tc-replyping-toggle").addEventListener("change", handleReplyPingToggle)
  getButtonElement("tc-write-card-btn").addEventListener("click", () => void openGuestPicker())
  getInputElement("tc-guest-picker-search").addEventListener("input", handleGuestPickerSearch)
  getElement("tc-guest-picker-list").addEventListener("click", handleGuestPickerClick)

  // Post-save/send "next guest" queue prompt (task 3).
  getElement("tc-queue-prompt").addEventListener("click", handleQueuePromptClick)
  // Progress-ring "Thank the next →" jump (A2) + Cards⇆Mailbox toggle (D1).
  getElement("tc-progress").addEventListener("click", handleProgressClick)
  getButtonElement("tc-sub-cards").addEventListener("click", handleSubnavClick)
  getButtonElement("tc-sub-mailbox").addEventListener("click", handleSubnavClick)

  // Live-preview device-width toggle (4d) — mobile is the default.
  getButtonElement("tc-preview-mobile").addEventListener("click", () => setPreviewDevice("mobile"))
  getButtonElement("tc-preview-desktop").addEventListener("click", () => setPreviewDevice("desktop"))

  getButtonElement("gift-add-btn").addEventListener("click", () => void openGiftModal(null))
  getElement("gift-form").addEventListener("submit", (e) =>
    handleGiftSubmit(/** @type {SubmitEvent} */ (e)),
  )

  getButtonElement("tc-editor-back").addEventListener("click", handleBack)
  getButtonElement("tc-editor-save").addEventListener("click", handleSave)
  getTextAreaElement("tc-editor-message").addEventListener("input", handleMessageInput)
  getSelectElement("tc-editor-template").addEventListener("change", handleTemplateChange)
  getButtonElement("tc-reroll-btn").addEventListener("click", handleReroll)
  getElement("tc-preset-chips").addEventListener("click", handlePresetChipsClick)
  getSelectElement("tc-editor-theme").addEventListener("change", handleThemeChange)
  getSelectElement("tc-editor-reveal").addEventListener("change", handleRevealChange)
  getButtonElement("tc-play-reveal-btn").addEventListener("click", handlePlayReveal)
  getButtonElement("tc-effect-add-btn").addEventListener("click", handleAddEffect)
  getButtonElement("tc-photos-btn").addEventListener("click", () => void openPhotoPicker())
  getElement("tc-photo-strip").addEventListener("click", handlePhotoStripClick)

  getButtonElement("picker-section-official").addEventListener("click", () =>
    loadPickerSection("official"),
  )
  getButtonElement("picker-section-guest").addEventListener("click", () =>
    loadPickerSection("guest"),
  )
  getElement("photo-picker-grid").addEventListener("click", handlePickerGridClick)
  getButtonElement("picker-confirm-btn").addEventListener("click", confirmPhotoPicker)

  getButtonElement("tysend-next-btn").addEventListener("click", handleSendNext)
  getButtonElement("tysend-back-btn").addEventListener("click", handleSendBack)
  document.querySelectorAll('input[name="tysend-channel"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updateSendDefaultPreview()
      updateSendPrimaryLabel()
    })
  })

  // Warn before a full page unload drops an unsaved card. In-app tab switches
  // are guarded via isThankYousDirty() in main.js. (C6)
  window.addEventListener("beforeunload", (e) => {
    if (!isThankYousDirty()) return
    e.preventDefault()
    e.returnValue = ""
  })
}
