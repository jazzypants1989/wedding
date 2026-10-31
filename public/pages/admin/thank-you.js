/** @file Thank-yous: Gifts, Cards and Replies, the card composer, and batch send
 *  (prototypes/admin-workspace/views/thanks.js, IA §4 + §5 C + §13).
 *
 *  Places (routes.js, all drawn by this panel):
 *   - Gifts, Cards, Replies: three sibling lists, each a list → detail split
 *     (`/thank-yous/gifts/g41`, `/cards/c17`, `/replies/c17`). Wide screens
 *     auto-select the first item (replace); phones show the list.
 *   - The composer is a route of its own, full width with the live preview
 *     (`/cards/c17/edit`, `/cards/new?gift=41` or `?guest=12`). It is guarded:
 *     leaving with unsaved work asks Keep editing / Discard / Save and leave.
 *     "Save and write the next one" replaces the URL with the next guest who
 *     has no card yet; on the last one it reads "Save and finish".
 *   - Its photo picker is a dialog route inside the guarded path, and lists
 *     the photos the guest is in first (named faces, IA §13.1).
 *   - Batch send is four step routes (`/cards/send`, `/how`, `/check`,
 *     `/done`) over the per-card send endpoints, called one after another.
 *     Sent replaces Check, and Back from Sent rewinds to wherever step 1 was
 *     opened (IA §13.5).
 *   - Dialog routes: log/edit a gift, write a card for any guest, send one card.
 *
 *  The live preview is an <iframe src="/thanks-preview"> driven by postMessage:
 *    child → parent  { type: "card:preview-ready" }   (handshake, once)
 *    parent → child  { type: "card:preview", payload } (debounced ~160ms/edit)
 *  {name} is substituted before pushing (renderMessage). Effect params are
 *  stored as sparse partials vs. each effect's defaults (diffConfig).
 *  No regex anywhere (CLAUDE.md). */
/** @import * as Types from "./types.js" */
/** @import * as ThanksTypes from "../thanks/types.js" */
/** @import * as GlobalTypes from "../../../types.js" */

import { state } from "./state.js"
import { api, closeModal, showSuccess, showError, showUndo } from "./utils.js"
import { openConfirm } from "./confirm.js"
import {
  registerPanel,
  navigate,
  up,
  setCrumbs,
  addGuard,
  setNavBadge,
  currentPlace,
} from "./router.js"
import { icon } from "./icons.js"
import {
  html,
  raw,
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
} from "../utils.js"
import {
  renderMessage,
  diffConfig,
  THANK_YOU_TEMPLATES,
  buildSeedMessage,
  rerollSeedMessage,
  weaveGift,
  OCCASION_PRESETS,
  cardStatus,
  CARD_STATUS_LABEL,
  shortAgo,
  computeWorklist,
  nextToWrite,
  channelOptions,
  defaultChannel,
} from "./thank-you-util.js"
import { fireConfetti } from "../../components/celebrate.js"
import { monogramData } from "../../components/monogram.js"
import { EFFECT_DEFINITIONS } from "../../effects/registry.js"
import { getDefaultConfig, mergeConfig } from "../../effects/config.js"
import { EFFECT_THEMES, resolveTheme } from "../../effects/themes.js"
import { LABELS, getHint } from "../../effects/control-meta.js"
import { buildControl } from "../../components/effect-controls.js"
import { replyGlyph } from "../../components/emoji.js"

// Home (inbox.js) reads the worklist from here.
export { computeWorklist }

const BASE = "/admin/thank-yous"
const GIFTS = BASE + "/gifts"
const CARDS = BASE + "/cards"
const REPLIES = BASE + "/replies"
const SEND = CARDS + "/send"

/** Live-preview debounce + photo cap + message cap. */
const PREVIEW_DEBOUNCE_MS = 160
const MEDIA_CAP = 12
const MESSAGE_MAX = 2000
const DEFAULT_THEME = "gratitude"
/** Give up on the preview handshake after this long and say so. */
const PREVIEW_READY_TIMEOUT_MS = 10000
/** localStorage key prefix for per-card/gift draft autosave. */
const DRAFT_KEY_PREFIX = "ty-draft:"
/** sessionStorage key for the batch-send flow, so a reload mid-flow keeps it. */
const FLOW_KEY = "ty-send-flow"
const WIDE = "(min-width: 900px)"

/** Progress milestones. Crossing one fires a confetti burst + a warm toast; the
 *  last-celebrated level is persisted so a plain reload never re-fires. */
const MILESTONE_KEY = "ty-milestone"
const MILESTONES = [25, 50, 75, 100]
/** @type {Record<number, string>} */
const MILESTONE_MESSAGES = {
  25: "A quarter thanked! 💌",
  50: "Halfway there! 🥂",
  75: "Three-quarters of the way there! 🎉",
  100: "Every thank-you sent — all done! 🥂🎉",
}

/** The card miniature's paper tint, per effect theme (prototype .theme-*). */
const THEME_TINT = /** @type {Record<string, string>} */ ({
  gratitude: "gratitude",
  classic: "gratitude",
  romantic: "romantic",
  elegant: "golden",
  garden: "garden",
  celebration: "confetti",
  "mermaid-disco": "confetti",
  celestial: "celestial",
  winter: "winter",
  coastal: "coastal",
})

/** Composer routes: arriving anywhere else closes the composer. */
const COMPOSER_ROUTES = new Set([
  "thank-yous/cards/new",
  "thank-yous/cards/new/photos",
  "thank-yous/cards/:id/edit",
  "thank-yous/cards/:id/edit/photos",
])
const FLOW_ROUTES = new Set([
  "thank-yous/cards/send",
  "thank-yous/cards/send/how",
  "thank-yous/cards/send/check",
  "thank-yous/cards/send/done",
])

/** @type {Types.ThankYouModuleState} */
const moduleState = {
  loaded: false,
  view: null,
  listKey: "",
  query: "",
  dirty: false,
  effectsCustomized: false,
  messageCustomized: false,
  rerollCount: 0,
  guestsLoaded: false,
  guestOptions: [],
  siteTheme: null,
  coupleName: "",
  config: null,
  draft: null,
  draftKey: null,
  isNew: false,
  restoreSaved: null,
  previewReady: false,
  pendingPush: false,
  picker: { selected: new Set() },
  previewDevice: "mobile",
  replyPingEnabled: false,
  story: null,
  sending: false,
}

/** The batch-send flow (Choose → How → Check → Sent). */
/** @type {Types.ThankYouBatchFlow | null} */
let flow = null
/** The single-card send dialog. */
/** @type {Types.ThankYouSendDialogState | null} */
let sendDialog = null

/** file_key → media list item, populated by the picker / editor resolution. */
const mediaCache = /** @type {Map<string, GlobalTypes.MediaListItem>} */ (new Map())
const loadedSections = new Set()

/** Each arrival bumps this; an async render that finds it moved on stops. */
let mountSeq = 0
/** The route this panel showed before the current arrival ("" from elsewhere). */
let lastRoute = ""
/** @type {(() => void) | null} */
let removeGuard = null
/** @type {ReturnType<typeof setTimeout> | undefined} */
let pushTimer
/** @type {ReturnType<typeof setTimeout> | undefined} */
let readyPollTimer
let readyWaitStartedAt = 0
/** @type {ReturnType<typeof setTimeout> | undefined} */
let seenTimer

// ==================== Small helpers ====================

const isWide = () => window.matchMedia(WIDE).matches

/** "c17" (or a bare "17") → 17; anything else → null.
 *  @param {string | undefined} raw @param {string} prefix */
function parseKey(raw, prefix) {
  if (!raw) return null
  const s = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  const n = Number(s)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** @param {string} full */
function pathOnly(full) {
  const q = full.indexOf("?")
  return q === -1 ? full : full.slice(0, q)
}

/** @param {string} name */
function firstName(name) {
  const t = (name || "").trim()
  const sp = t.indexOf(" ")
  return sp === -1 ? t : t.slice(0, sp)
}

/** @param {number} n @param {string} one @param {string} many */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

/** @param {string} needle @param {...(string | null | undefined)} hay */
function matches(needle, ...hay) {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return hay.some((h) => (h || "").toLowerCase().includes(q))
}

/** The prototype's initials avatar: a circle in the name's hue. Presentation
 *  attributes, not inline style, so the CSP allows it. @param {string} name */
function avatar(name) {
  const { initial, hue } = monogramData(name)
  return html`<svg class="art" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="20" fill="hsl(${hue} 40% 55%)" />
    <text x="20" y="25" text-anchor="middle" font-size="14" fill="#fff">${initial}</text>
  </svg>`
}

/** @param {GlobalTypes.ThankYouCard} card */
function statusPill(card) {
  const s = cardStatus(card)
  return html`<span class="pill st-${s}">${CARD_STATUS_LABEL[s]}</span>`
}

/** @param {GlobalTypes.ThankYouCard} card */
function isUnread(card) {
  return !!card.replied_at && !card.reply_seen_at && card.status !== "draft"
}

/** @param {GlobalTypes.ThankYouCard} card */
function cardLink(card) {
  return `${location.origin}/thanks?card=${card.token}`
}

/** @param {string} themeId */
function themeLabel(themeId) {
  return EFFECT_THEMES.find((t) => t.id === themeId)?.label ?? themeId
}

/** Human label for an effect id (LABELS has no index signature). @param {string} id */
function labelFor(id) {
  return /** @type {Record<string, string>} */ (LABELS)[id] || id
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

/** @param {string | null} raw
 *  @returns {{ reveal: string, effects: ThanksTypes.CardEffectEntry[] }} */
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

/** Gifts newest first; a gift's latest card (a gift may be re-composed). */
/** @param {number} giftId */
function latestCardForGift(giftId) {
  let best = /** @type {Types.ThankYouCardRow | null} */ (null)
  for (const c of state.currentCards) {
    if (c.gift_id === giftId && (!best || c.id > best.id)) best = c
  }
  return best
}

function drafts() {
  return state.currentCards.filter((c) => c.status === "draft")
}

function giftsWithoutCard() {
  const withCard = new Set(state.currentCards.map((c) => c.gift_id))
  return state.currentGifts.filter((g) => !withCard.has(g.id))
}

/** Owed guests with no card at all yet (Home's "without a card" count). */
function unwrittenCount() {
  const { remaining } = computeWorklist(state.currentGifts, state.currentCards)
  const drafted = new Set(drafts().map((c) => c.guest_id))
  return remaining.filter((r) => !drafted.has(r.guestId)).length
}

function repliesSorted() {
  return state.currentCards
    .filter((c) => c.replied_at && c.status !== "draft")
    .sort((a, b) => (b.replied_at || "").localeCompare(a.replied_at || ""))
}

// ==================== Data + badges ====================

async function refresh() {
  const [giftsData, cardsData] = await Promise.all([
    api("/api/admin/gifts"),
    api("/api/admin/thank-you"),
  ])
  state.currentGifts = /** @type {Types.GiftsResponse} */ (giftsData).gifts
  state.currentCards = /** @type {Types.CardsResponse} */ (cardsData).cards
  moduleState.loaded = true
  updateBadges()
  checkMilestone()
}

/** Sidebar counts as bare numbers: Gifts = guests still without a card, Cards =
 *  drafts waiting to go, Replies = unread replies. */
function updateBadges() {
  setNavBadge("gifts", unwrittenCount())
  setNavBadge("thankyous", drafts().length)
  setNavBadge("replies", state.currentCards.filter(isUnread).length)
}

/** The old "load the tab" entry point: now just a data refresh (main.js). */
/** @type {Types.loadThankYous} */
export async function loadThankYous() {
  await refresh()
}

/** The badge poll (main.js): drafts + unread replies from the cheap counts read. */
/** @type {Types.loadThankYouCount} */
export async function loadThankYouCount() {
  try {
    const counts = /** @type {Types.ThankYouCounts} */ (await api("/api/admin/thank-you/counts"))
    setNavBadge("thankyous", counts.drafts || 0)
    setNavBadge("replies", counts.unreadReplies || 0)
  } catch {
    // Non-critical.
  }
}

async function ensureConfig() {
  if (moduleState.config) return moduleState.config
  const config = /** @type {Types.ThankYouSendConfig} */ (await api("/api/admin/thank-you/config"))
  moduleState.config = config
  moduleState.replyPingEnabled = !!config.replyPingEnabled
  return config
}

/** The site's theme seeds a new card; its couple name signs the miniatures.
 *  Cached after the first read. */
async function ensureSiteContent() {
  if (moduleState.siteTheme) return
  try {
    const data = /** @type {Types.SiteContentResponse} */ (await api("/api/admin/site-content"))
    const theme = typeof data.content.theme === "string" ? data.content.theme : DEFAULT_THEME
    moduleState.siteTheme = EFFECT_THEMES.some((t) => t.id === theme) ? theme : DEFAULT_THEME
    moduleState.coupleName = data.content.couple.display || ""
  } catch {
    moduleState.siteTheme = DEFAULT_THEME
  }
}

/** Pickers refetch every open — the couple adds guests while writing cards.
 *  @param {boolean} [force] */
async function ensureGuestsLoaded(force = false) {
  if (moduleState.guestsLoaded && !force) return
  const data = /** @type {Types.GuestsApiResponse} */ (
    await api("/api/admin/guests?limit=1000&offset=0")
  )
  moduleState.guestOptions = data.guests.map((g) => ({ id: g.id, name: g.name }))
  moduleState.guestsLoaded = true
}

// ==================== Milestones ====================

/** @param {number} pct */
function milestoneLevel(pct) {
  let level = 0
  for (const m of MILESTONES) if (pct >= m) level = m
  return level
}

/** Fire confetti + a toast when the thanked share crosses a milestone. The first
 *  load seeds the baseline silently; a drop lowers the bar silently. */
function checkMilestone() {
  const { owed, thanked } = computeWorklist(state.currentGifts, state.currentCards)
  if (owed === 0) return
  const level = milestoneLevel(Math.round((thanked / owed) * 100))
  let prev = 0
  let seeded = true
  try {
    const stored = localStorage.getItem(MILESTONE_KEY)
    if (stored == null) seeded = false
    else prev = parseInt(stored, 10) || 0
    if (level !== prev || !seeded) localStorage.setItem(MILESTONE_KEY, String(level))
  } catch {
    seeded = false
  }
  if (seeded && level > prev) {
    fireConfetti()
    showSuccess(MILESTONE_MESSAGES[level] || "Milestone reached! 🎉")
  }
}

// ==================== The card miniature ====================

/** A miniature of the card the guest will see (prototype cardPreview).
 *  @param {{ message: string, theme: string, media_keys: string | null, guest_name: string }}
 *    card */
function cardPreview(card) {
  const text = renderMessage(card.message, { name: card.guest_name || "friend" })
  const keys = parseMediaKeys(card.media_keys)
  const shown = keys.slice(0, 4)
  return html`<div class="card-preview theme-${THEME_TINT[card.theme] || "gratitude"}">
    <div class="cp-paper">
      <p class="cp-text">${text}</p>
      ${shown.length
        ? html`<div class="cp-photos">
            ${shown.map(
              (k) =>
                html`<span class="cp-polaroid"
                  ><img src="/media/${k}/thumb" alt="" loading="lazy"
                /></span>`,
            )}${keys.length > shown.length
              ? html`<span class="cp-more">+${keys.length - shown.length}</span>`
              : ""}
          </div>`
        : ""}
      <p class="cp-sign">— ${moduleState.coupleName || "the two of us"}</p>
    </div>
  </div>`
}

// ==================== The list → detail frame ====================

/** @param {"gifts" | "cards" | "replies"} on */
function thanksSeg(on) {
  const items = /** @type {Array<[string, string, string, number]>} */ ([
    ["gifts", "Gifts", GIFTS, giftsWithoutCard().length],
    ["cards", "Cards", CARDS, drafts().length],
    ["replies", "Replies", REPLIES, state.currentCards.filter(isUnread).length],
  ])
  return html`<nav class="seg sub-only" aria-label="Thank-yous">
    ${items.map(
      ([key, label, to, n]) =>
        html`<a href="${to}" aria-current="${key === on ? "page" : "false"}"
          >${label}${n ? html` <span class="seg-n">${n}</span>` : ""}</a
        >`,
    )}
  </nav>`
}

/** @param {string} placeholder */
function searchBox(placeholder) {
  return html`<input
    type="search"
    class="pane-search"
    data-act="search"
    placeholder="${placeholder}"
    aria-label="${placeholder}"
    value="${moduleState.query}"
    autocomplete="off"
  />`
}

/** Draw a split into #ty-view, keeping the list's scroll when the same list is
 *  redrawn (a selection move), and the selected row in view.
 *  @param {string} key
 *  @param {{ head: string, rows: string, foot: string, detail: string, selected: boolean,
 *    label: string }} o */
function drawSplit(key, o) {
  const root = getElement("ty-view")
  const oldList = root.querySelector(".pane-list")
  const keep = moduleState.listKey === key && oldList ? oldList.scrollTop : 0
  const oldSearch = root.querySelector(".pane-search")
  const searchFocused = oldSearch !== null && document.activeElement === oldSearch
  root.innerHTML = html`<div class="split ${o.selected ? "has-sel" : ""}">
    <section class="pane pane-list" aria-label="${o.label}">
      ${raw(o.head)}
      <ul class="rows" id="ty-rows">
        ${raw(o.rows)}
      </ul>
      ${raw(o.foot)}
    </section>
    <section class="pane pane-detail" aria-label="Selected item">${raw(o.detail)}</section>
  </div>`
  moduleState.listKey = key
  const list = root.querySelector(".pane-list")
  if (!(list instanceof HTMLElement)) return
  list.scrollTop = keep
  if (searchFocused) {
    const box = root.querySelector(".pane-search")
    if (box instanceof HTMLInputElement) {
      box.focus()
      box.setSelectionRange(box.value.length, box.value.length)
    }
  }
  const row = list.querySelector('.row[aria-current="true"]')
  if (!(row instanceof HTMLElement) || !isWide()) return
  const head = list.querySelector(".pane-head")
  const top = list.getBoundingClientRect().top + (head ? head.getBoundingClientRect().height : 0)
  const bottom = list.getBoundingClientRect().bottom - 40
  const r = row.getBoundingClientRect()
  if (r.top < top) list.scrollTop -= top - r.top + 6
  else if (r.bottom > bottom) list.scrollTop += r.bottom - bottom + 6
}

/** @param {string} to @param {string} label */
function mBack(to, label) {
  return html`<a class="m-back" href="${to}" data-up>${icon("back")}${label}</a>`
}

/** @param {string} content */
function paneFoot(content) {
  return html`<footer class="pane-foot">${raw(content)}</footer>`
}

function showListView() {
  getElement("ty-view").hidden = false
  getElement("ty-composer").hidden = true
}

// ==================== Gifts ====================

function giftsSorted() {
  const withCard = new Set(state.currentCards.map((c) => c.gift_id))
  const list = state.currentGifts.filter((g) =>
    matches(moduleState.query, g.guest_name, g.description),
  )
  return [...list.filter((g) => !withCard.has(g.id)), ...list.filter((g) => withCard.has(g.id))]
}

/** @param {number | null} selId */
function giftRows(selId) {
  const items = giftsSorted()
  if (items.length === 0) {
    return state.currentGifts.length
      ? html`<li class="list-empty">No gifts match.</li>`
      : html`<li class="list-empty">
          No gifts logged yet. <a href="${GIFTS}/new">Log the first one</a>.
        </li>`
  }
  return html`${items.map((g) => {
    const card = latestCardForGift(g.id)
    return html`<li>
      <a
        class="row"
        href="${GIFTS}/g${g.id}"
        data-select
        aria-current="${g.id === selId ? "true" : "false"}"
      >
        <span class="avatar">${avatar(g.guest_name)}</span>
        <span class="row-main">
          <span class="row-top"
            ><strong>${g.guest_name}</strong>${card
              ? statusPill(card)
              : html`<span class="pill st-none">No card</span>`}</span
          >
          <span class="row-sub">${g.description || "A gift"}</span>
        </span>
      </a>
    </li>`
  })}`
}

/** @param {Types.RouteContext} ctx @param {{ redirect?: boolean }} [opts] */
function showGifts(ctx, opts = {}) {
  const id = parseKey(ctx.params.id, "g")
  if (id === null && opts.redirect !== false && isWide()) {
    const first = giftsSorted()[0]
    if (first) {
      void navigate(`${GIFTS}/g${first.id}`, { replace: true })
      return
    }
  }
  const gift = id !== null ? state.getGiftById(id) : null
  if (id !== null && !gift) {
    void navigate(GIFTS, { replace: true })
    showError("That gift isn't in the log any more.")
    return
  }
  moduleState.view = "gifts"
  showListView()
  const { owed, thanked } = computeWorklist(state.currentGifts, state.currentCards)
  const without = giftsWithoutCard().length
  const head = html`<header class="pane-head">
    <h1>Thank-yous</h1>
    ${thanksSeg("gifts")}
    <div class="pane-tools">
      <span class="muted small" title="${owed ? `${thanked} of ${owed} guests thanked` : ""}"
        >${without} without a card</span
      >
      <a
        class="icon-btn"
        href="/api/admin/thank-you/export/gifts.csv"
        download
        title="Download the gift log (CSV)"
        aria-label="Download the gift log (CSV)"
        >${icon("download")}</a
      >
      <a class="btn btn-sm" href="${GIFTS}/new">+ Log a gift</a>
    </div>
    ${state.currentGifts.length > 6 ? searchBox("Find a guest or gift") : ""}
  </header>`
  drawSplit("gifts", {
    head,
    rows: giftRows(id),
    foot: paneFoot(html`<kbd>j</kbd> <kbd>k</kbd> move · <kbd>w</kbd> write the card`),
    detail: gift ? giftDetail(gift) : html`<div class="detail-empty">Pick a gift.</div>`,
    selected: !!gift,
    label: "Gifts",
  })
  if (gift) setCrumbs([{ label: gift.description || gift.guest_name }])
}

/** @param {GlobalTypes.GiftWithGuest} g */
function giftCta(g) {
  const card = latestCardForGift(g.id)
  const first = firstName(g.guest_name)
  if (!card) {
    return { label: `Write ${first}'s card →`, to: `${CARDS}/new?gift=${g.id}` }
  }
  if (card.status === "draft") {
    return { label: `Finish ${first}'s card →`, to: `${CARDS}/c${card.id}/edit` }
  }
  return null
}

/** @param {GlobalTypes.GiftWithGuest} g */
function giftDetail(g) {
  const card = latestCardForGift(g.id)
  const cta = giftCta(g)
  return html`${mBack(GIFTS, "Gifts")}
    <article class="detail">
      <header class="person-head">
        <span class="avatar avatar-xl">${avatar(g.guest_name)}</span>
        <div>
          <span class="eyebrow">Gift</span>
          <h1>${g.description || "A gift"}</h1>
          <p class="muted">
            from ${g.guest_name}${g.received_at ? html` · received ${g.received_at}` : ""}
          </p>
        </div>
      </header>
      <dl class="facts">
        <div>
          <dt>
            Amount
            <span title="Only you can see this — never shown to guests" aria-label="private">🔒</span>
          </dt>
          <dd>${g.amount || "—"}</dd>
        </div>
        <div>
          <dt>Paper card</dt>
          <dd>
            <label class="inline"
              ><input
                type="checkbox"
                data-act="physical"
                data-id="${g.id}"
                ${g.physical_card_sent ? "checked" : ""}
              />
              Sent by post</label
            >
          </dd>
        </div>
        <div>
          <dt>Digital card</dt>
          <dd>
            ${card
              ? html`${statusPill(card)} <a href="${CARDS}/c${card.id}">Open card</a>`
              : "Not written yet"}
          </dd>
        </div>
      </dl>
      ${g.notes ? html`<p class="gift-notes"><span class="eyebrow">Notes</span> ${g.notes}</p>` : ""}
      ${cta
        ? html`<a class="btn btn-primary btn-lg" href="${cta.to}">${cta.label}</a>`
        : html`<p class="muted small">
            ${firstName(g.guest_name)}'s card has gone out.
            <a href="${CARDS}/new?gift=${g.id}">Write another card</a>
          </p>`}
    </article>
    <div class="actionbar">
      <a class="btn btn-lg" href="${GIFTS}/g${g.id}/edit">Edit gift</a>
      <button
        type="button"
        class="btn btn-lg btn-ghost btn-danger-soft actionbar-end"
        data-act="delete-gift"
        data-id="${g.id}"
      >
        Delete gift
      </button>
    </div>`
}

/** @param {number} giftId @param {boolean} sent */
async function togglePhysical(giftId, sent) {
  const gift = state.getGiftById(giftId)
  if (!gift) return
  /** @param {boolean} value */
  const write = async (value) => {
    await api(`/api/admin/gifts/${giftId}/physical-card`, {
      method: "POST",
      body: JSON.stringify({ sent: value }),
    })
    gift.physical_card_sent = value ? 1 : 0
  }
  try {
    await write(sent)
    const who = firstName(gift.guest_name)
    showUndo(sent ? `Marked ${who}'s paper card as sent` : `${who}'s paper card unmarked`, () => {
      void write(!sent)
        .then(() => rerender())
        .catch((err) => showError("Couldn't undo: " + getErrorMessage(err)))
    })
  } catch (err) {
    showError("Couldn't update the paper card: " + getErrorMessage(err))
    rerender()
  }
}

/** @param {number} giftId */
function confirmDeleteGift(giftId) {
  const gift = state.getGiftById(giftId)
  if (!gift) return
  const order = giftsSorted()
  const at = order.findIndex((g) => g.id === giftId)
  const next = order[at + 1] || order[at - 1] || null
  openConfirm({
    title: "Delete this gift?",
    desc:
      `Remove ${gift.description || "this gift"} from ${gift.guest_name} from the log? ` +
      "Any card written for it stays, without its gift.",
    confirmLabel: "Delete gift",
    danger: true,
    run: async () => {
      await api(`/api/admin/gifts/${giftId}`, { method: "DELETE" })
      await refresh()
      showSuccess("Gift deleted")
      void navigate(next ? `${GIFTS}/g${next.id}` : GIFTS, { replace: true })
    },
  })
}

// ---- gift dialog (routes gifts/new, gifts/:id/edit) ----

/** @param {number | null} editId */
async function openGiftDialog(editId) {
  const errorEl = getElement("gift-form-error")
  errorEl.hidden = true
  const gift = editId !== null ? state.getGiftById(editId) : null
  getElement("gift-modal-title").textContent = gift ? "Edit gift" : "Log a gift"
  const select = getSelectElement("gift-guest")
  try {
    await ensureGuestsLoaded(true)
  } catch (err) {
    errorEl.textContent = "Couldn't load the guest list: " + getErrorMessage(err)
    errorEl.hidden = false
    return
  }
  select.innerHTML = html`${moduleState.guestOptions.map(
    (g) => html`<option value="${g.id}">${g.name}</option>`,
  )}`
  getInputElement("gift-id").value = gift ? String(gift.id) : ""
  if (gift) select.value = String(gift.guest_id)
  select.disabled = !!gift // the giver is fixed once logged
  getInputElement("gift-description").value = gift ? gift.description || "" : ""
  getInputElement("gift-amount").value = gift ? gift.amount || "" : ""
  getInputElement("gift-received").value = gift ? gift.received_at || "" : ""
  getTextAreaElement("gift-notes").value = gift ? gift.notes || "" : ""
  ;(gift ? getInputElement("gift-description") : select).focus()
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
    let id = Number(idRaw)
    if (idRaw) {
      await api(`/api/admin/gifts/${idRaw}`, { method: "PUT", body: JSON.stringify(body) })
    } else {
      const data = /** @type {{ gift: GlobalTypes.Gift }} */ (
        await api("/api/admin/gifts", { method: "POST", body: JSON.stringify(body) })
      )
      id = data.gift.id
    }
    await refresh()
    showSuccess(idRaw ? "Gift saved" : "Gift logged")
    // Replacing the dialog's own entry closes it onto the gift.
    void navigate(`${GIFTS}/g${id}`, { replace: true })
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
  }
}

// ==================== Cards ====================

/** @type {Array<[string, string]>} */
const CARD_CHIPS = [
  ["all", "All"],
  ["draft", "Drafts"],
  ["sent", "Sent"],
  ["opened", "Opened"],
  ["replied", "Replied"],
]

/** @param {URLSearchParams} query */
function cardFilter(query) {
  const s = query.get("status") || "all"
  return CARD_CHIPS.some(([k]) => k === s) ? s : "all"
}

/** @param {URLSearchParams} query */
function cardsFiltered(query) {
  const s = cardFilter(query)
  return state.currentCards.filter(
    (c) =>
      (s === "all" || cardStatus(c) === s) &&
      matches(moduleState.query, c.guest_name, c.message),
  )
}

/** @param {URLSearchParams} query */
function qs(query) {
  const s = cardFilter(query)
  return s === "all" ? "" : "?status=" + s
}

/** @param {URLSearchParams} query @param {number | null} selId */
function cardRows(query, selId) {
  const items = cardsFiltered(query)
  if (items.length === 0) {
    return state.currentCards.length
      ? html`<li class="list-empty">No cards here.</li>`
      : html`<li class="list-empty">
          No cards yet. Write one from a <a href="${GIFTS}">gift</a>, or
          <a href="${CARDS}/write">for anyone</a>.
        </li>`
  }
  return html`${items.map(
    (c) => html`<li>
      <a
        class="row"
        href="${CARDS}/c${c.id}${qs(query)}"
        data-select
        aria-current="${c.id === selId ? "true" : "false"}"
      >
        <span class="avatar">${avatar(c.guest_name)}</span>
        <span class="row-main">
          <span class="row-top"><strong>${c.guest_name}</strong>${statusPill(c)}</span>
          <span class="row-sub">${renderMessage(c.message, { name: c.guest_name })}</span>
        </span>
      </a>
    </li>`,
  )}`
}

/** @param {Types.RouteContext} ctx @param {{ redirect?: boolean }} [opts] */
function showCards(ctx, opts = {}) {
  const id = parseKey(ctx.params.id, "c")
  const items = cardsFiltered(ctx.query)
  if (id === null && opts.redirect !== false && isWide() && items.length) {
    void navigate(`${CARDS}/c${items[0].id}${qs(ctx.query)}`, { replace: true })
    return
  }
  const card = id !== null ? state.getCardById(id) : null
  if (id !== null && !card) {
    void navigate(CARDS, { replace: true })
    showError("That card has been deleted.")
    return
  }
  moduleState.view = "cards"
  showListView()
  const s = cardFilter(ctx.query)
  const n = drafts().length
  const head = html`<header class="pane-head">
    <h1>Thank-yous</h1>
    ${thanksSeg("cards")}
    ${n
      ? html`<a class="cta-strip" href="${SEND}"
          ><span
            ><strong>${plural(n, "draft", "drafts")} ready</strong><br /><span class="small"
              >${n === 1 ? "Send it in four short steps" : "Send them together in four short steps"}</span
            ></span
          ><span class="btn btn-primary btn-sm">Send →</span></a
        >`
      : ""}
    <div class="pane-tools">
      <span class="muted small">${plural(state.currentCards.length, "card", "cards")}</span>
      <a
        class="icon-btn"
        href="/api/admin/thank-you/export/cards.csv"
        download
        title="Download every card (CSV)"
        aria-label="Download every card (CSV)"
        >${icon("download")}</a
      >
      <a class="btn btn-sm" href="${CARDS}/write">+ Write a card</a>
    </div>
    ${state.currentCards.length > 6 ? searchBox("Find a guest") : ""}
    <div class="chips" role="group" aria-label="Status">
      ${CARD_CHIPS.map(
        ([k, label]) =>
          html`<a
            class="chip"
            data-replace
            href="${CARDS}${k === "all" ? "" : "?status=" + k}"
            aria-current="${s === k ? "true" : "false"}"
            >${label}</a
          >`,
      )}
    </div>
  </header>`
  drawSplit("cards" + s, {
    head,
    rows: cardRows(ctx.query, id),
    foot: paneFoot(
      html`<kbd>j</kbd> <kbd>k</kbd> move · <kbd>e</kbd> edit · <kbd>s</kbd> send`,
    ),
    detail: card ? cardDetail(card, ctx.query) : html`<div class="detail-empty">Pick a card.</div>`,
    selected: !!card,
    label: "Cards",
  })
  if (card) setCrumbs([{ label: card.guest_name }])
}

/** @param {Types.ThankYouCardRow} c @param {URLSearchParams} query */
function cardDetail(c, query) {
  const gift = c.gift_id !== null ? state.getGiftById(c.gift_id) : null
  const draft = c.status === "draft"
  const glyph = replyGlyph(c.reply_emoji) || "💬"
  return html`${mBack(CARDS + qs(query), "Cards")}
    <article class="detail">
      <header class="detail-head">
        <span class="eyebrow">Card for ${c.guest_name}${gift ? html` · ${gift.description || "a gift"}` : ""}</span>
        ${statusPill(c)}
      </header>
      ${cardPreview(c)}
      <dl class="facts">
        <div>
          <dt>Theme</dt>
          <dd>${themeLabel(c.theme)}</dd>
        </div>
        <div>
          <dt>Sent</dt>
          <dd>${c.sent_at ? html`by ${c.sent_via || "link"} · ${formatDate(c.sent_at)}` : "Not yet"}</dd>
        </div>
        ${draft
          ? ""
          : html`<div>
              <dt>Opened</dt>
              <dd>
                ${c.viewed_at
                  ? html`${formatDate(c.viewed_at)}${c.view_count > 1
                      ? html` · ${c.view_count} times`
                      : ""}`
                  : "Not yet"}
              </dd>
            </div>`}
        ${c.replied_at
          ? html`<div>
              <dt>Reply</dt>
              <dd>
                <a href="${REPLIES}/c${c.id}"
                  >${glyph} ${c.reply_message ? html`“${c.reply_message}”` : "a reaction"}</a
                >
              </dd>
            </div>`
          : ""}
      </dl>
    </article>
    <div class="actionbar">
      ${draft
        ? html`<a class="btn btn-lg" href="${CARDS}/c${c.id}/edit">Edit <kbd>e</kbd></a>
            <a class="btn btn-primary btn-lg" href="${CARDS}/c${c.id}/send">Send <kbd>s</kbd></a>`
        : html`<button type="button" class="btn btn-primary btn-lg" data-act="copy-link" data-id="${c.id}">
              ${icon("link")} Copy link
            </button>
            <button type="button" class="btn btn-lg" data-act="resend" data-id="${c.id}">Resend</button>`}
      <button type="button" class="btn btn-lg btn-ghost btn-danger-soft actionbar-end" data-act="delete-card" data-id="${c.id}">
        Delete
      </button>
    </div>`
}

/** @param {number} id */
async function copyLinkFor(id) {
  const card = state.getCardById(id)
  if (!card) return
  const ok = await copyToClipboard(cardLink(card))
  if (ok) showSuccess(`${firstName(card.guest_name)}'s card link copied`)
  else showError("Couldn't copy. The link is " + cardLink(card))
}

/** Resend a sent card: the server re-drafts an unopened one in place (same
 *  link → straight to its send dialog) or clones an opened one to a fresh
 *  draft (new link → its composer). @param {number} id */
async function resendCard(id) {
  try {
    const data = /** @type {Types.ThankYouResendResponse} */ (
      await api(`/api/admin/thank-you/${id}/resend`, { method: "POST" })
    )
    await refresh()
    if (data.mode === "reset") {
      showSuccess("Back to a draft, with the same link. Send it again when you're ready.")
      void navigate(`${CARDS}/c${data.card.id}/send`)
    } else {
      showSuccess("They'd already opened it, so this is a fresh copy with a new link.")
      void navigate(`${CARDS}/c${data.card.id}/edit`)
    }
  } catch (err) {
    showError("Couldn't resend the card: " + getErrorMessage(err))
  }
}

/** @param {number} id */
function confirmDeleteCard(id) {
  const card = state.getCardById(id)
  if (!card) return
  const place = currentPlace()
  const inReplies = place?.route.nav === "replies"
  const order = inReplies ? repliesSorted() : cardsFiltered(place?.query ?? new URLSearchParams())
  const at = order.findIndex((c) => c.id === id)
  const next = order[at + 1] || order[at - 1] || null
  const listBase = inReplies ? REPLIES : CARDS
  const filter = inReplies ? "" : qs(place?.query ?? new URLSearchParams())
  openConfirm({
    title: "Delete this card?",
    desc:
      card.status === "draft"
        ? `Delete the draft for ${card.guest_name}? This can't be undone.`
        : `Delete the card ${card.guest_name} was sent? Its link stops working. ` +
          "This can't be undone.",
    confirmLabel: "Delete card",
    danger: true,
    run: async () => {
      await api(`/api/admin/thank-you/${id}`, { method: "DELETE" })
      clearDraftKeyById(String(id))
      await refresh()
      showSuccess("Card deleted")
      const to = next ? `${listBase}/c${next.id}${filter}` : listBase + filter
      void navigate(to, { replace: true })
    },
  })
}

// ---- write a card for anyone (route cards/write) ----

async function openGuestPicker() {
  const list = getElement("tc-guest-picker-list")
  list.innerHTML = html`<li class="list-empty">Loading the guest list…</li>`
  const search = getInputElement("tc-guest-picker-search")
  search.value = ""
  try {
    await ensureGuestsLoaded(true)
  } catch (err) {
    list.innerHTML = html`<li class="list-empty">
      Couldn't load the guest list: ${getErrorMessage(err)}
    </li>`
    return
  }
  renderGuestPicker("")
  search.focus()
}

/** @param {string} query */
function renderGuestPicker(query) {
  const list = getElement("tc-guest-picker-list")
  const found = moduleState.guestOptions.filter((g) => matches(query, g.name))
  if (found.length === 0) {
    list.innerHTML = html`<li class="list-empty">No guests match.</li>`
    return
  }
  list.innerHTML = html`${found.slice(0, 200).map((g) => {
    const card = state.currentCards.find((c) => c.guest_id === g.id)
    return html`<li>
      <button type="button" class="row" data-guest-id="${g.id}">
        <span class="avatar">${avatar(g.name)}</span>
        <span class="row-main"
          ><span class="row-top"><strong>${g.name}</strong>${card ? statusPill(card) : ""}</span></span
        >
      </button>
    </li>`
  })}`
}

/** @param {MouseEvent} e */
function handleGuestPickerClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-guest-id]")
  if (!(btn instanceof HTMLElement)) return
  const id = Number(btn.dataset.guestId)
  const draft = state.currentCards.find((c) => c.guest_id === id && c.status === "draft")
  // Replacing the dialog's entry closes it; Back from the composer is Cards.
  void navigate(draft ? `${CARDS}/c${draft.id}/edit` : `${CARDS}/new?guest=${id}`, {
    replace: true,
  })
}

// ==================== Replies ====================

/** @param {number | null} selId */
function replyRows(selId) {
  const items = repliesSorted().filter((c) =>
    matches(moduleState.query, c.guest_name, c.reply_message),
  )
  if (items.length === 0) {
    return html`<li class="list-empty">
      No replies yet. They'll show up here as guests write back.
    </li>`
  }
  return html`${items.map(
    (c) => html`<li>
      <a
        class="row ${isUnread(c) ? "is-unread" : ""}"
        href="${REPLIES}/c${c.id}"
        data-select
        aria-current="${c.id === selId ? "true" : "false"}"
      >
        <span class="avatar">${avatar(c.guest_name)}</span>
        <span class="row-main">
          <span class="row-top"
            ><strong>${c.guest_name}</strong><span class="row-time">${shortAgo(c.replied_at)}</span></span
          >
          <span class="row-sub">${replyGlyph(c.reply_emoji) || "💬"} ${c.reply_message || ""}</span>
        </span>
      </a>
    </li>`,
  )}`
}

/** @param {Types.RouteContext} ctx */
async function showReplies(ctx) {
  const id = parseKey(ctx.params.id, "c")
  const items = repliesSorted()
  if (id === null && isWide() && items.length) {
    void navigate(`${REPLIES}/c${items[0].id}`, { replace: true })
    return
  }
  const card = id !== null ? items.find((c) => c.id === id) || null : null
  if (id !== null && !card) {
    void navigate(REPLIES, { replace: true })
    return
  }
  try {
    await ensureConfig()
  } catch {
    // The reply-ping toggle just shows its default.
  }
  moduleState.view = "replies"
  showListView()
  const head = html`<header class="pane-head">
    <h1>Thank-yous</h1>
    ${thanksSeg("replies")}
    <label class="inline small reply-ping"
      ><input type="checkbox" data-act="reply-ping" ${moduleState.replyPingEnabled ? "checked" : ""} />
      Email me when a card gets its first reply</label
    >
  </header>`
  drawSplit("replies", {
    head,
    rows: replyRows(id),
    foot: paneFoot(html`<kbd>j</kbd> <kbd>k</kbd> move`),
    detail: card ? replyDetail(card) : html`<div class="detail-empty">Pick a reply.</div>`,
    selected: !!card,
    label: "Replies",
  })
  if (!card) return
  setCrumbs([{ label: card.guest_name }])
  void loadThread(card.id)
  // Opening a reply marks it read; the dot goes a beat later, so you see it go.
  if (isUnread(card)) {
    try {
      await api(`/api/admin/thank-you/${card.id}/reply-seen`, { method: "POST" })
      card.reply_seen_at = new Date().toISOString()
      updateBadges()
      clearTimeout(seenTimer)
      seenTimer = setTimeout(() => {
        const place = currentPlace()
        if (place?.route.nav !== "replies") return
        const rows = document.getElementById("ty-rows")
        if (rows) rows.innerHTML = replyRows(parseKey(place.params.id, "c"))
      }, 600)
    } catch {
      // It stays unread until the next visit.
    }
  }
}

/** @param {Types.ThankYouCardRow} c */
function replyDetail(c) {
  return html`${mBack(REPLIES, "Replies")}
    <article class="detail">
      <header class="detail-head">
        <span class="eyebrow">${c.guest_name} replied ${shortAgo(c.replied_at)}</span>
      </header>
      <p class="reply-glyph" aria-hidden="true">${replyGlyph(c.reply_emoji) || "💬"}</p>
      ${c.reply_message
        ? html`<blockquote class="msg-big">${c.reply_message}</blockquote>`
        : html`<p class="muted">Just a reaction, no words.</p>`}
      <section id="ty-thread" class="thread" hidden></section>
      <p><a href="${CARDS}/c${c.id}">See the card you sent →</a></p>
    </article>
    <div class="actionbar">
      <button type="button" class="btn btn-lg" data-act="clear-reply" data-id="${c.id}">
        Clear this reply
      </button>
    </div>`
}

/** Earlier replies on the same card (the full history, oldest first).
 *  @param {number} cardId */
async function loadThread(cardId) {
  try {
    const data = /** @type {Types.ThankYouCardDetailResponse} */ (
      await api(`/api/admin/thank-you/${cardId}`)
    )
    const el = document.getElementById("ty-thread")
    if (!el || currentPlace()?.params.id !== "c" + cardId) return
    const earlier = data.replies.slice(0, -1)
    if (earlier.length === 0) return
    el.innerHTML = html`<h2>Earlier replies</h2>
      <ol class="thread-list">
        ${earlier.map(
          (r) => html`<li>
            <span class="thread-glyph" aria-hidden="true">${replyGlyph(r.emoji) || "💬"}</span>
            <span>${r.message || html`<span class="muted">a reaction</span>`}</span>
            <span class="muted small">${shortAgo(r.created_at)}</span>
          </li>`,
        )}
      </ol>`
    el.hidden = false
  } catch {
    // The latest reply is already showing.
  }
}

/** @param {number} id */
function confirmClearReply(id) {
  const card = state.getCardById(id)
  if (!card) return
  const order = repliesSorted()
  const at = order.findIndex((c) => c.id === id)
  const next = order[at + 1] || order[at - 1] || null
  openConfirm({
    title: "Clear this reply?",
    desc: `Take ${card.guest_name}'s reply off the card. It stays in the card's history.`,
    confirmLabel: "Clear reply",
    danger: false,
    run: async () => {
      await api(`/api/admin/thank-you/cards/${id}/clear-reply`, { method: "POST" })
      await refresh()
      showSuccess("Reply cleared")
      void navigate(next && next.id !== id ? `${REPLIES}/c${next.id}` : REPLIES, { replace: true })
    },
  })
}

/** @param {HTMLInputElement} cb */
async function toggleReplyPing(cb) {
  const next = cb.checked
  try {
    await api("/api/admin/thank-you/config", {
      method: "POST",
      body: JSON.stringify({ replyPingEnabled: next }),
    })
    moduleState.replyPingEnabled = next
    showSuccess(next ? "You'll get an email on each card's first reply." : "Reply emails are off.")
  } catch (err) {
    cb.checked = !next
    showError("Couldn't change that: " + getErrorMessage(err))
  }
}

// ==================== Composer ====================

/** @type {Types.isThankYousDirty} */
export function isThankYousDirty() {
  return moduleState.draft !== null && moduleState.dirty
}

function markDirty() {
  moduleState.dirty = true
  getElement("tc-dirty-note").hidden = false
  saveDraftToStorage()
}

/** localStorage key for the draft being edited: the card id, `gift:<id>` for a
 *  not-yet-saved gift card, or `guest:<id>` for a giftless one.
 *  @param {Types.ThankYouDraft} draft */
function draftStorageKey(draft) {
  if (draft.cardId != null) return DRAFT_KEY_PREFIX + String(draft.cardId)
  if (draft.giftId != null) return DRAFT_KEY_PREFIX + "gift:" + draft.giftId
  return DRAFT_KEY_PREFIX + "guest:" + draft.guestId
}

/** @param {Types.ThankYouDraft} draft */
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

function clearDraftStorage() {
  const draft = moduleState.draft
  if (!draft) return
  try {
    localStorage.removeItem(draftStorageKey(draft))
  } catch {
    // ignore
  }
}

/** @param {string} idPart */
function clearDraftKeyById(idPart) {
  try {
    localStorage.removeItem(DRAFT_KEY_PREFIX + idPart)
  } catch {
    // ignore
  }
}

/** Build the sparse effect list for a theme.
 *  @param {string} themeId @returns {ThanksTypes.CardEffectEntry[]} */
function seedEffectsFromTheme(themeId) {
  const theme = resolveTheme(themeId)
  return theme.effectIds.map((id) => ({
    id,
    config: theme.configs && theme.configs[id] ? structuredClone(theme.configs[id]) : {},
  }))
}

/** @param {number | null} giftId */
function giftLabelFor(giftId) {
  if (giftId == null) return "No gift: a card just to say thank you"
  const gift = state.getGiftById(giftId)
  return gift && gift.description ? `Gift: ${gift.description}` : "For their gift"
}

/** The composer's identity for a route: arriving at the same one again (after
 *  the photo picker closes) keeps the open draft. @param {Types.RouteContext} ctx */
function composerKey(ctx) {
  const id = parseKey(ctx.params.id, "c")
  if (id !== null) return "card:" + id
  const gift = ctx.query.get("gift")
  if (gift) return "gift:" + gift
  const guest = ctx.query.get("guest")
  return guest ? "guest:" + guest : null
}

/** Arrive at the composer (or its photo dialog). @param {Types.RouteContext} ctx
 *  @returns {Promise<boolean>} whether the composer is showing */
async function showComposer(ctx) {
  let key = composerKey(ctx)
  const isNew = ctx.route.path.startsWith("thank-yous/cards/new")
  // The photo dialog closed onto a bare /cards/new (it was a deep link): keep
  // the open draft and put its gift/guest back in the URL.
  if (isNew && key === null && moduleState.draft && moduleState.draft.cardId === null) {
    const d = moduleState.draft
    const q = d.giftId !== null ? "gift=" + d.giftId : "guest=" + d.guestId
    void navigate(`${CARDS}/new${ctx.route.dialog ? "/photos" : ""}?${q}`, { replace: true })
    return false
  }
  if (key === null) {
    void navigate(GIFTS, { replace: true })
    return false
  }
  if (moduleState.draft && moduleState.draftKey === key) {
    // Back from the photo picker: the draft (and its unsaved edits) is intact.
    showComposerView()
    composerCrumbs()
    return true
  }
  if (moduleState.draft) leaveComposer()

  if (isNew) {
    const giftId = parseKey(ctx.query.get("gift") || undefined, "")
    const guestId = parseKey(ctx.query.get("guest") || undefined, "")
    if (giftId !== null) {
      const gift = state.getGiftById(giftId)
      if (!gift) {
        showError("That gift isn't in the log any more.")
        void navigate(GIFTS, { replace: true })
        return false
      }
      // A draft for this gift already exists: open it rather than start a second.
      const existing = state.currentCards.find((c) => c.gift_id === giftId && c.status === "draft")
      if (existing) {
        void navigate(`${CARDS}/c${existing.id}/edit`, { replace: true })
        return false
      }
      await ensureSiteContent()
      const theme = moduleState.siteTheme || DEFAULT_THEME
      openEditor(key, {
        cardId: null,
        guestId: gift.guest_id,
        giftId: gift.id,
        recipientName: gift.guest_name,
        message: buildSeedMessage(gift, gift.guest_name),
        theme,
        reveal: "confetti",
        effects: seedEffectsFromTheme(theme),
        mediaKeys: [],
        mediaItems: [],
        isNew: true,
        customized: false,
      })
    } else if (guestId !== null) {
      let name = state.currentCards.find((c) => c.guest_id === guestId)?.guest_name
      if (!name) {
        try {
          await ensureGuestsLoaded()
        } catch {
          // Falls through to "not found".
        }
        name = moduleState.guestOptions.find((g) => g.id === guestId)?.name
      }
      if (!name) {
        showError("That guest isn't on the list any more.")
        void navigate(CARDS, { replace: true })
        return false
      }
      await ensureSiteContent()
      const theme = moduleState.siteTheme || DEFAULT_THEME
      openEditor(key, {
        cardId: null,
        guestId,
        giftId: null,
        recipientName: name,
        message: buildSeedMessage(null, name),
        theme,
        reveal: "confetti",
        effects: seedEffectsFromTheme(theme),
        mediaKeys: [],
        mediaItems: [],
        isNew: true,
        customized: false,
      })
    } else {
      void navigate(GIFTS, { replace: true })
      return false
    }
  } else {
    const id = parseKey(ctx.params.id, "c")
    const card = id !== null ? state.getCardById(id) : null
    if (!card) {
      showError("That card has been deleted.")
      void navigate(CARDS, { replace: true })
      return false
    }
    if (card.status !== "draft") {
      showError("That card has gone out, so it can't change. Resend makes a fresh copy.")
      void navigate(`${CARDS}/c${card.id}`, { replace: true })
      return false
    }
    await ensureSiteContent()
    const cfg = parseEffectsConfig(card.effects_config)
    const mediaKeys = parseMediaKeys(card.media_keys)
    let mediaItems = /** @type {ThanksTypes.ThankYouMediaItem[]} */ ([])
    if (mediaKeys.length) {
      try {
        await Promise.all([ensureMediaLoaded("official"), ensureMediaLoaded("guest")])
        mediaItems = mapMediaItems(mediaKeys)
      } catch {
        // The preview omits photos it couldn't resolve.
      }
    }
    openEditor(key, {
      cardId: card.id,
      guestId: card.guest_id,
      giftId: card.gift_id,
      recipientName: card.guest_name,
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
  // Guard the composer's own path; its photo dialog sits inside it.
  removeGuard?.()
  removeGuard = addGuard({
    what: "this thank-you card",
    dirty: isThankYousDirty,
    save: async () => (await saveDraft()) !== null,
    path: pathOnly(ctx.path).endsWith("/photos")
      ? pathOnly(ctx.path).slice(0, -"/photos".length)
      : pathOnly(ctx.path),
  })
  return true
}

function showComposerView() {
  moduleState.view = "composer"
  getElement("ty-view").hidden = true
  getElement("ty-composer").hidden = false
  updateComposerChrome()
}

/** Close the composer (arriving anywhere else). Unsaved edits were discarded at
 *  the guard, so their autosave goes too. */
function leaveComposer() {
  if (moduleState.draft && moduleState.dirty) clearDraftStorage()
  moduleState.draft = null
  moduleState.draftKey = null
  moduleState.dirty = false
  moduleState.story = null
  clearTimeout(pushTimer)
  removeGuard?.()
  removeGuard = null
  getElement("ty-composer").hidden = true
}

function composerCrumbs() {
  const d = moduleState.draft
  if (!d) return
  setCrumbs(
    d.cardId !== null && !moduleState.isNew
      ? [{ label: d.recipientName, href: `${CARDS}/c${d.cardId}` }, { label: "Edit" }]
      : [{ label: d.recipientName }, { label: "New card" }],
  )
}

/** Title, back link, "Save and write the next one" / "Save and finish". */
function updateComposerChrome() {
  const d = moduleState.draft
  if (!d) return
  const isNew = d.cardId === null
  getElement("tc-editor-title").textContent =
    `${isNew ? "New card" : "Edit card"} for ${d.recipientName}`
  getElement("tc-editor-sub").textContent = giftLabelFor(d.giftId)
  const back = /** @type {HTMLAnchorElement} */ (getElement("tc-editor-back"))
  if (!isNew) {
    back.href = `${CARDS}/c${d.cardId}`
    getElement("tc-editor-back-label").textContent = "Card"
  } else if (d.giftId !== null) {
    back.href = `${GIFTS}/g${d.giftId}`
    getElement("tc-editor-back-label").textContent = "Gift"
  } else {
    back.href = CARDS
    getElement("tc-editor-back-label").textContent = "Cards"
  }
  getElement("tc-dirty-note").hidden = !moduleState.dirty
  const next = nextToWrite(state.currentGifts, state.currentCards, d.guestId)
  const nextBtn = getButtonElement("tc-editor-next")
  nextBtn.textContent = next ? "Save and write the next one" : "Save and finish"
  nextBtn.title = next ? `Next: ${next.name}` : "Everyone has a card. Saves and goes back to Cards."
  getElement("tc-name-hint").textContent = `{name} becomes “${d.recipientName}”`
  composerCrumbs()
}

/** @param {string} key @param {Types.OpenEditorInput} seed */
function openEditor(key, seed) {
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
  moduleState.draftKey = key
  moduleState.isNew = seed.isNew
  moduleState.effectsCustomized = seed.customized
  // A brand-new card's message is a seeded starter (safe to replace silently);
  // a saved card's message is the couple's writing.
  moduleState.messageCustomized = !seed.isNew
  moduleState.rerollCount = 0
  // Nothing to lose until something is edited (a new card's starter message
  // regenerates), so arriving and leaving again never asks.
  moduleState.dirty = false
  getElement("tc-editor-error").hidden = true
  offerRestore()
  paintEditor()
  showComposerView()
  const ta = getTextAreaElement("tc-editor-message")
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)
  ta.scrollTop = 0
  getElement("ty-composer").querySelector(".composer-form")?.scrollTo(0, 0)
  schedulePreview()
  void loadGuestStory(seed.guestId)
}

/** Fill every composer control from the draft. */
function paintEditor() {
  const draft = moduleState.draft
  if (!draft) return
  getTextAreaElement("tc-editor-message").value = draft.message
  updateMessageCounter()
  populateTemplateSelect()
  populateThemeSelect(draft.theme)
  renderPresetChips()
  getSelectElement("tc-editor-reveal").value = draft.reveal
  renderEffectStack()
  renderPhotoStrip()
  setPreviewDevice(moduleState.previewDevice)
}

/** An autosave that differs from what's open: offer it in a strip, never a
 *  window.confirm. */
function offerRestore() {
  const draft = moduleState.draft
  const strip = getElement("tc-restore")
  moduleState.restoreSaved = null
  strip.hidden = true
  if (!draft) return
  let saved = null
  try {
    saved = localStorage.getItem(draftStorageKey(draft))
  } catch {
    saved = null
  }
  if (!saved || saved === serializeDraft(draft)) return
  moduleState.restoreSaved = saved
  strip.hidden = false
}

function applyRestore() {
  const draft = moduleState.draft
  const saved = moduleState.restoreSaved
  getElement("tc-restore").hidden = true
  moduleState.restoreSaved = null
  if (!draft || !saved) return
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
    moduleState.messageCustomized = true
    paintEditor()
    markDirty()
    schedulePreview()
  } catch {
    // Corrupt autosave: keep what's open.
  }
}

function discardRestore() {
  getElement("tc-restore").hidden = true
  moduleState.restoreSaved = null
  clearDraftStorage()
}

function populateTemplateSelect() {
  const select = getSelectElement("tc-editor-template")
  select.innerHTML = html`<option value="">Start from…</option>
    ${THANK_YOU_TEMPLATES.map((t) => html`<option value="${t.id}">${t.label}</option>`)}`
  select.value = ""
}

/** @param {string} message */
function setMessage(message) {
  const draft = moduleState.draft
  if (!draft) return
  draft.message = message
  getTextAreaElement("tc-editor-message").value = message
  updateMessageCounter()
  markDirty()
  schedulePreview()
}

function handleTemplateChange() {
  const draft = moduleState.draft
  if (!draft) return
  const select = getSelectElement("tc-editor-template")
  const tpl = THANK_YOU_TEMPLATES.find((t) => t.id === select.value)
  select.value = "" // an action, not a setting
  if (!tpl) return
  const gift = draft.giftId != null ? state.getGiftById(draft.giftId) : null
  const apply = () => {
    // {name} stays a live token so the preview resolves it like any edit.
    setMessage(weaveGift(tpl.message, gift ? gift.description : "", tpl.giftFallback))
    moduleState.messageCustomized = false
  }
  if (moduleState.messageCustomized && draft.message.trim()) {
    openConfirm({
      title: "Replace your message?",
      desc: `Start over from “${tpl.label}”? What you've written goes.`,
      confirmLabel: "Replace it",
      danger: false,
      run: async () => apply(),
    })
  } else {
    apply()
  }
}

function handleReroll() {
  const draft = moduleState.draft
  if (!draft) return
  const apply = () => {
    const gift = draft.giftId != null ? state.getGiftById(draft.giftId) : null
    moduleState.rerollCount += 1
    setMessage(rerollSeedMessage(gift, draft.recipientName, moduleState.rerollCount))
    moduleState.messageCustomized = false
  }
  if (moduleState.messageCustomized && draft.message.trim()) {
    openConfirm({
      title: "Swap in another starter?",
      desc: "What you've written goes.",
      confirmLabel: "Swap it",
      danger: false,
      run: async () => apply(),
    })
  } else {
    apply()
  }
}

function renderPresetChips() {
  getElement("tc-preset-chips").innerHTML = html`${OCCASION_PRESETS.map(
    (p) => html`<button
      type="button"
      class="chip"
      data-preset="${p.id}"
      title="Sets a matching theme and effects"
    >
      ${p.label}
    </button>`,
  )}`
}

/** @param {MouseEvent} e */
function handlePresetChipsClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-preset]")
  if (!(btn instanceof HTMLElement)) return
  const preset = OCCASION_PRESETS.find((p) => p.id === btn.dataset.preset)
  const draft = moduleState.draft
  if (!preset || !draft) return
  draft.theme = preset.theme
  draft.effects = preset.effects.map((entry) => ({
    id: entry.id,
    config: structuredClone(entry.config),
  }))
  moduleState.effectsCustomized = true
  getSelectElement("tc-editor-theme").value = preset.theme
  renderEffectStack()
  markDirty()
  schedulePreview()
  showSuccess(`The ${preset.label} look`)
}

function handlePlayReveal() {
  const draft = moduleState.draft
  if (!draft) return
  pushPreview()
  const frame = getIFrameElement("tc-preview-frame")
  if (!frame.contentWindow || !moduleState.previewReady) return
  frame.contentWindow.postMessage(
    { type: "card:play-reveal", reveal: draft.reveal },
    location.origin,
  )
}

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
  const apply = () => {
    draft.theme = next
    draft.effects = seedEffectsFromTheme(next)
    moduleState.effectsCustomized = false
    select.value = next
    markDirty()
    renderEffectStack()
    schedulePreview()
  }
  if (moduleState.effectsCustomized && draft.effects.length > 0) {
    select.value = draft.theme
    openConfirm({
      title: "Switch the theme?",
      desc: "Your effect tweaks are replaced by the new theme's own.",
      confirmLabel: "Switch theme",
      danger: false,
      run: async () => apply(),
    })
  } else {
    apply()
  }
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

function renderEffectStack() {
  const stackEl = getElement("tc-effect-stack")
  stackEl.textContent = ""
  const draft = moduleState.draft
  if (!draft) return
  getElement("tc-effects-count").textContent = draft.effects.length
    ? "· " + draft.effects.map((e) => labelFor(e.id)).join(", ")
    : "· none"
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
    removeBtn.className = "btn btn-sm btn-ghost btn-danger-soft"
    removeBtn.textContent = "Remove"
    removeBtn.addEventListener("click", (ev) => {
      ev.preventDefault()
      draft.effects.splice(idx, 1)
      moduleState.effectsCustomized = true
      markDirty()
      renderEffectStack()
      schedulePreview()
    })
    summary.appendChild(removeBtn)
    details.appendChild(summary)
    const controls = document.createElement("div")
    controls.className = "tc-effect-controls"
    const defaults = getDefaultConfig(entry.id)
    if (defaults) {
      const full = /** @type {Record<string, unknown>} */ (
        mergeConfig(defaults, entry.config || {})
      )
      for (const k of Object.keys(full)) {
        controls.appendChild(
          buildControl(k, full[k], {
            effectId: entry.id,
            getHint,
            onChange: (key, nextVal) => onEffectParamChange(idx, key, nextVal),
          }),
        )
      }
    }
    details.appendChild(controls)
    stackEl.appendChild(details)
  })
  const select = getSelectElement("tc-effect-add-select")
  const options = EFFECT_DEFINITIONS.map((d) => ({ id: d.id, label: labelFor(d.id) }))
  options.sort((a, b) => a.label.localeCompare(b.label))
  select.innerHTML = html`${options.map((o) => html`<option value="${o.id}">${o.label}</option>`)}`
}

/** @param {number} idx @param {string} key @param {unknown} nextVal */
function onEffectParamChange(idx, key, nextVal) {
  const entry = moduleState.draft?.effects[idx]
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

/** Where the photo picker opens for the open draft (inside the guarded path). */
function photosPath() {
  const d = moduleState.draft
  if (!d) return CARDS
  if (d.cardId !== null) return `${CARDS}/c${d.cardId}/edit/photos`
  return `${CARDS}/new/photos?${d.giftId !== null ? "gift=" + d.giftId : "guest=" + d.guestId}`
}

function renderPhotoStrip() {
  const strip = getElement("tc-photo-strip")
  const draft = moduleState.draft
  const keys = draft ? draft.mediaKeys : []
  getElement("tc-photo-count").textContent = `${keys.length} of ${MEDIA_CAP}`
  strip.innerHTML = html`${keys.map((key, idx) => {
      const isVideo = mediaCache.get(key)?.kind === "video"
      return html`<figure class="cp-polaroid" data-key="${key}">
        <img src="/media/${key}/${isVideo ? "poster" : "thumb"}" alt="" loading="lazy" />
        <span class="pol-tools">
          <button
            type="button"
            data-photo-action="left"
            aria-label="Move earlier"
            ${idx === 0 ? "disabled" : ""}
          >‹</button>
          <button type="button" data-photo-action="remove" aria-label="Remove this photo">×</button>
          <button
            type="button"
            data-photo-action="right"
            aria-label="Move later"
            ${idx === keys.length - 1 ? "disabled" : ""}
          >›</button>
        </span>
      </figure>`
    })}<a class="btn btn-sm" href="${photosPath()}">+ Choose</a>`
}

/** @param {MouseEvent} e */
function handlePhotoStripClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-photo-action]")
  if (!(btn instanceof HTMLElement)) return
  const fig = btn.closest(".cp-polaroid")
  const draft = moduleState.draft
  if (!(fig instanceof HTMLElement) || !draft || !fig.dataset.key) return
  const keys = draft.mediaKeys
  const idx = keys.indexOf(fig.dataset.key)
  if (idx === -1) return
  const action = btn.dataset.photoAction
  if (action === "remove") keys.splice(idx, 1)
  else if (action === "left" && idx > 0) [keys[idx - 1], keys[idx]] = [keys[idx], keys[idx - 1]]
  else if (action === "right" && idx < keys.length - 1) {
    ;[keys[idx + 1], keys[idx]] = [keys[idx], keys[idx + 1]]
  } else return
  draft.mediaItems = mapMediaItems(keys)
  markDirty()
  renderPhotoStrip()
  schedulePreview()
}

/** Each picker open refetches (photos get approved while the couple writes).
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

/** A photo we know from somewhere other than the gallery feed (the guest's own
 *  uploads, "photos they're in") — enough for the strip and the preview.
 *  @param {{ file_key: string, kind: string, section?: string, width?: number | null,
 *    height?: number | null, needs_display?: boolean }} m */
function cacheMedia(m) {
  if (mediaCache.has(m.file_key)) return
  mediaCache.set(m.file_key, {
    id: 0,
    file_key: m.file_key,
    kind: m.kind === "video" ? "video" : "image",
    section: m.section === "official" ? "official" : "guest",
    status: "approved",
    caption: null,
    width: m.width ?? null,
    height: m.height ?? null,
    duration_seconds: null,
    needs_display: !!m.needs_display,
    author_name: "",
    is_own: false,
    created_at: "",
  })
}

// ---- photo picker (routes cards/:id/edit/photos, cards/new/photos) ----

/** "Photos they're in" first (IA §13.1), then the rest of the gallery. */
async function openPhotoPicker() {
  const draft = moduleState.draft
  const body = getElement("photo-picker-body")
  if (!draft) return
  moduleState.picker.selected = new Set(draft.mediaKeys)
  const first = firstName(draft.recipientName)
  getElement("photo-picker-title").textContent = `Photos for ${first}'s card`
  body.innerHTML = html`<p class="muted">Loading photos…</p>`
  updatePickerCount()
  /** @type {Types.GuestPhotoItem[]} */
  let theirs = []
  try {
    const [photos] = await Promise.all([
      api(`/api/admin/guests/${draft.guestId}/photos`),
      ensureMediaLoaded("official", true),
      ensureMediaLoaded("guest", true),
    ])
    theirs = /** @type {Types.GuestPhotosResponse} */ (photos).items
  } catch (err) {
    body.innerHTML = html`<p class="status-note is-error">
      Couldn't load photos: ${getErrorMessage(err)}
    </p>`
    return
  }
  if (moduleState.draft !== draft) return
  for (const m of theirs) cacheMedia(m)
  const theirKeys = new Set(theirs.map((m) => m.file_key))
  const rest = [...mediaCache.values()].filter(
    (m) => m.status === "approved" && !theirKeys.has(m.file_key),
  )
  const official = rest.filter((m) => m.section === "official")
  const guest = rest.filter((m) => m.section === "guest")
  /** @param {string} key @param {string} kind @param {number} [faces] */
  const tile = (key, kind, faces) => {
    const on = moduleState.picker.selected.has(key)
    const what = kind === "video" ? "Video" : "Photo"
    const label = faces && faces > 1 ? `${what} (${faces} faces)` : what
    return html`<button
      type="button"
      class="pick"
      data-key="${key}"
      aria-pressed="${on ? "true" : "false"}"
      aria-label="${label}"
    >
      <img src="/media/${key}/${kind === "video" ? "poster" : "thumb"}" alt="" loading="lazy" />
      <span class="pick-check" aria-hidden="true">${icon("check")}</span>
    </button>`
  }
  body.innerHTML = html`<section class="pick-section">
      <h3 class="rows-heading">Photos ${first} is in <span class="seg-n">${theirs.length || ""}</span></h3>
      ${theirs.length
        ? html`<div class="pick-grid">${theirs.map((m) => tile(m.file_key, m.kind, m.faces))}</div>`
        : html`<p class="muted small pick-empty">
            None yet. Once ${first}'s face is named in
            <a href="/admin/faces">Name faces</a> and linked to the guest list, the photos they're
            in show up here first.
          </p>`}
    </section>
    ${official.length
      ? html`<section class="pick-section">
          <h3 class="rows-heading">Official photos</h3>
          <div class="pick-grid">${official.map((m) => tile(m.file_key, m.kind))}</div>
        </section>`
      : ""}
    ${guest.length
      ? html`<section class="pick-section">
          <h3 class="rows-heading">From guests</h3>
          <div class="pick-grid">${guest.map((m) => tile(m.file_key, m.kind))}</div>
        </section>`
      : ""}`
}

function updatePickerCount() {
  const n = moduleState.picker.selected.size
  getElement("picker-count").textContent =
    n >= MEDIA_CAP ? `${n} of ${MEDIA_CAP}, the most a card holds` : `${n} of ${MEDIA_CAP} chosen`
}

/** @param {MouseEvent} e */
function handlePickerClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest(".pick")
  if (!(btn instanceof HTMLElement) || !btn.dataset.key) return
  const key = btn.dataset.key
  const selected = moduleState.picker.selected
  if (selected.has(key)) selected.delete(key)
  else if (selected.size >= MEDIA_CAP) {
    updatePickerCount()
    return
  } else selected.add(key)
  // The same photo can sit in two sections; keep every copy in step.
  for (const el of getElement("photo-picker-body").querySelectorAll(".pick")) {
    if (el instanceof HTMLElement && el.dataset.key === key) {
      el.setAttribute("aria-pressed", selected.has(key) ? "true" : "false")
    }
  }
  updatePickerCount()
}

function confirmPhotoPicker() {
  const draft = moduleState.draft
  if (!draft) return
  const selected = moduleState.picker.selected
  const kept = draft.mediaKeys.filter((k) => selected.has(k))
  for (const k of selected) if (!kept.includes(k)) kept.push(k)
  draft.mediaKeys = kept.slice(0, MEDIA_CAP)
  draft.mediaItems = mapMediaItems(draft.mediaKeys)
  markDirty()
  renderPhotoStrip()
  schedulePreview()
  // Closing goes back to the composer, which keeps the draft.
  closeModal(getDialogElement("photo-picker-modal"))
}

// ---- their story ----

/** @param {number} guestId */
async function loadGuestStory(guestId) {
  moduleState.story = null
  getElement("tc-story-panel").hidden = true
  try {
    const story = /** @type {Types.GuestStory} */ (await api(`/api/admin/guests/${guestId}/story`))
    if (!moduleState.draft || moduleState.draft.guestId !== guestId) return
    moduleState.story = story
    renderStory(story)
  } catch {
    // No story: the panel stays hidden.
  }
}

/** @param {Types.GuestStory} story */
function renderStory(story) {
  /** @type {string[]} */
  const parts = []
  if (story.rsvpNote) {
    parts.push(html`<div class="story-block">
      <h3>Their RSVP note</h3>
      <p>${story.rsvpNote}</p>
    </div>`)
  }
  if (story.guestbookEntry) {
    parts.push(html`<div class="story-block">
      <h3>In the guestbook</h3>
      <p class="story-quote">${story.guestbookEntry.message}</p>
      <button type="button" class="btn btn-sm" data-story="quote">Quote it in the card</button>
    </div>`)
  }
  if (story.media.length) {
    parts.push(html`<div class="story-block">
      <h3>Photos they shared</h3>
      <div class="story-thumbs">
        ${story.media.slice(0, 12).map(
          (m) =>
            html`<img src="/media/${m.fileKey}/${m.kind === "video" ? "poster" : "thumb"}" alt="" loading="lazy" />`,
        )}
      </div>
      <button type="button" class="btn btn-sm" data-story="photos">Add their photos</button>
    </div>`)
  }
  if (story.gifts.length) {
    parts.push(html`<div class="story-block">
      <h3>Gifts</h3>
      <ul>
        ${story.gifts.map(
          (g) =>
            html`<li>
              ${g.description || "A gift"}${g.amount ? html` · ${g.amount}` : ""}${g.physicalCardSent
                ? html` · paper card sent`
                : ""}
            </li>`,
        )}
      </ul>
    </div>`)
  }
  if (story.cards.length > 1 || (story.cards.length === 1 && story.cards[0].status !== "draft")) {
    parts.push(html`<div class="story-block">
      <h3>Cards</h3>
      <ul>
        ${story.cards.map(
          (c) =>
            html`<li>
              ${c.status}${c.sentAt ? html` · sent ${formatDate(c.sentAt)}` : ""}${c.repliedAt
                ? html` · replied`
                : ""}
            </li>`,
        )}
      </ul>
    </div>`)
  }
  const panel = getElement("tc-story-panel")
  if (parts.length === 0) {
    panel.hidden = true
    return
  }
  getElement("tc-story-body").innerHTML = html`${parts}`
  panel.hidden = false
}

/** @param {MouseEvent} e */
function handleStoryClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-story]")
  const draft = moduleState.draft
  const story = moduleState.story
  if (!(btn instanceof HTMLElement) || !draft || !story) return
  if (btn.dataset.story === "quote" && story.guestbookEntry) {
    const ps = `\n\nP.S. …"${story.guestbookEntry.message}" — we loved this.`
    setMessage((draft.message + ps).slice(0, MESSAGE_MAX))
  } else if (btn.dataset.story === "photos") {
    let added = 0
    for (const m of story.media) {
      cacheMedia({ file_key: m.fileKey, kind: m.kind })
      if (draft.mediaKeys.length >= MEDIA_CAP) break
      if (draft.mediaKeys.includes(m.fileKey)) continue
      draft.mediaKeys.push(m.fileKey)
      added++
    }
    if (added === 0) {
      showError(`Nothing to add: they're already on the card, or it holds ${MEDIA_CAP}.`)
      return
    }
    draft.mediaItems = mapMediaItems(draft.mediaKeys)
    markDirty()
    renderPhotoStrip()
    schedulePreview()
    showSuccess(`Added ${plural(added, "photo", "photos")}`)
  }
}

// ---- save ----

/** Save the open draft. Resolves the card id, or null (the error is shown).
 *  @returns {Promise<number | null>} */
async function saveDraft() {
  const draft = moduleState.draft
  if (!draft) return null
  const errorEl = getElement("tc-editor-error")
  errorEl.hidden = true
  if (!draft.message.trim()) {
    errorEl.textContent = "The card needs a message."
    errorEl.hidden = false
    getTextAreaElement("tc-editor-message").focus()
    return null
  }
  /** @type {Record<string, unknown>} */
  const body = {
    gift_id: draft.giftId,
    message: draft.message,
    theme: draft.theme,
    effects_config: { reveal: draft.reveal, effects: draft.effects },
    media_keys: draft.mediaKeys,
  }
  const buttons = [getButtonElement("tc-editor-save"), getButtonElement("tc-editor-next")]
  for (const b of buttons) b.disabled = true
  try {
    let id = draft.cardId
    if (id !== null) {
      await api(`/api/admin/thank-you/${id}`, { method: "PUT", body: JSON.stringify(body) })
    } else {
      body.guest_id = draft.guestId
      const data = /** @type {{ card: GlobalTypes.ThankYouCard }} */ (
        await api("/api/admin/thank-you", { method: "POST", body: JSON.stringify(body) })
      )
      id = data.card.id
    }
    clearDraftStorage()
    draft.cardId = id
    moduleState.draftKey = "card:" + id
    moduleState.dirty = false
    getElement("tc-dirty-note").hidden = true
    await refresh()
    return id
  } catch (err) {
    errorEl.textContent = "That didn't save: " + getErrorMessage(err)
    errorEl.hidden = false
    return null
  } finally {
    for (const b of buttons) b.disabled = false
  }
}

/** "Save card": save, then up to the card (a new one replaces its own URL). */
async function handleSave() {
  const wasNew = moduleState.isNew
  const name = moduleState.draft?.recipientName ?? ""
  const id = await saveDraft()
  if (id === null) return
  showSuccess(`Saved ${firstName(name)}'s card`)
  if (wasNew) void navigate(`${CARDS}/c${id}`, { replace: true })
  else up(`${CARDS}/c${id}`)
}

/** "Save and write the next one" (IA §13.2): save, then replace the URL with the
 *  next guest who has no card yet. The last one reads "Save and finish" and
 *  goes up to Cards, where the drafts wait to be sent. */
async function handleSaveNext() {
  const draft = moduleState.draft
  if (!draft) return
  const guestId = draft.guestId
  const name = draft.recipientName
  const id = await saveDraft()
  if (id === null) return
  const next = nextToWrite(state.currentGifts, state.currentCards, guestId)
  if (!next) {
    showSuccess(`Saved ${firstName(name)}'s card. Everyone has one now.`)
    up(CARDS)
    return
  }
  showSuccess(`Saved ${firstName(name)}'s card. Next: ${next.name}`)
  void navigate(
    next.giftId !== null
      ? `${CARDS}/new?gift=${next.giftId}`
      : `${CARDS}/new?guest=${next.guestId}`,
    { replace: true },
  )
}

// ---- live preview ----

/** Phone is the default: guests open cards on phones. @param {"mobile" | "desktop"} device */
function setPreviewDevice(device) {
  moduleState.previewDevice = device
  const wrap = getElement("tc-preview-wrap")
  wrap.classList.toggle("device-mobile", device === "mobile")
  wrap.classList.toggle("device-desktop", device === "desktop")
  const phone = device === "mobile"
  getButtonElement("tc-preview-mobile").setAttribute("aria-pressed", phone ? "true" : "false")
  getButtonElement("tc-preview-desktop").setAttribute("aria-pressed", phone ? "false" : "true")
}

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
    if (Date.now() - readyWaitStartedAt > PREVIEW_READY_TIMEOUT_MS) {
      clearTimeout(readyPollTimer)
      getElement("tc-preview-unavailable").hidden = false
      return
    }
    // The iframe may have announced "ready" before we listened: ask again until
    // it answers.
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
  frame.contentWindow.postMessage(
    {
      type: "card:preview",
      payload: {
        themeId: draft.theme,
        recipientName: draft.recipientName,
        message: renderMessage(draft.message, { name: draft.recipientName || "friend" }),
        reveal: draft.reveal,
        effects: draft.effects,
        mediaItems: draft.mediaItems,
        coupleName: moduleState.coupleName || "the two of us",
      },
    },
    location.origin,
  )
}

/** @param {MessageEvent} e */
function handlePreviewMessage(e) {
  if (e.origin !== location.origin) return
  const data = e.data
  if (!data || typeof data !== "object" || data.type !== "card:preview-ready") return
  moduleState.previewReady = true
  if (moduleState.pendingPush) {
    moduleState.pendingPush = false
    pushPreview()
  }
}

// ==================== Send one card (route cards/:id/send) ====================

/** @param {Types.ThankYouCardRow} card */
function contactOf(card) {
  return { email: card.guest_email, phone: card.guest_phone }
}

/** @param {Types.ThankYouSendConfig} config */
function configured(config) {
  return { email: config.email.configured, sms: config.sms.configured }
}

/** Plain words for what the site can't do without its keys.
 *  @param {Types.ThankYouSendConfig} config */
function keysNote(config) {
  const email = config.email.configured
  const sms = config.sms.configured
  if (email && sms) return ""
  if (!email && !sms) {
    return (
      "Email and text messages aren't set up on this site yet (there are no Resend or " +
      "Twilio keys), so cards go as links you send yourself."
    )
  }
  return !email
    ? "Email isn't set up on this site yet (there's no Resend key)."
    : "Text messages aren't set up on this site yet (there are no Twilio keys)."
}

/** @param {number} cardId */
async function openSendDialog(cardId) {
  const body = getElement("tysend-body")
  const errorEl = getElement("tysend-error")
  const next = getButtonElement("tysend-next-btn")
  errorEl.hidden = true
  next.disabled = false
  getButtonElement("tysend-cancel").hidden = false
  const card = state.getCardById(cardId)
  if (!card || card.status !== "draft") {
    sendDialog = null
    getElement("thankyou-send-title").textContent = "Send the card"
    body.innerHTML = html`<p class="status-note">
      ${card ? `${firstName(card.guest_name)}'s card has already gone out.` : "That card is gone."}
    </p>`
    getButtonElement("tysend-preview-btn").hidden = true
    next.textContent = "Close"
    sendDialog = { cardId, stage: "closed", channel: "link" }
    return
  }
  body.innerHTML = html`<p class="muted">Loading…</p>`
  let config
  try {
    config = await ensureConfig()
  } catch (err) {
    body.innerHTML = html`<p class="status-note is-error">
      Couldn't load the send options: ${getErrorMessage(err)}
    </p>`
    return
  }
  const contact = contactOf(card)
  const opts = channelOptions(contact, configured(config))
  const pick = defaultChannel(contact, configured(config))
  sendDialog = { cardId, stage: "pick", channel: pick }
  getElement("thankyou-send-title").textContent = `Send ${firstName(card.guest_name)}'s card`
  const note = keysNote(config)
  body.innerHTML = html`<fieldset class="channels">
      <legend class="sr-only">How should it go?</legend>
      ${opts.map(
        (o) => html`<label class="radio ${o.ok ? "" : "is-off"}"
          ><input type="radio" name="tysend-channel" value="${o.key}" ${o.key === pick ? "checked" : ""} ${o.ok ? "" : "disabled"} />
          ${o.label}${o.why ? html`<span class="muted small"> — ${o.why}</span>` : ""}</label
        >`,
      )}
    </fieldset>
    <p class="muted small">
      ${contact.email || "No email on file"}${contact.phone ? html` · ${contact.phone}` : ""}
    </p>
    ${note ? html`<p class="status-note">${note}</p>` : ""}
    <details class="send-note">
      <summary>Change the note that carries the link</summary>
      <textarea id="tysend-message" rows="3" placeholder="Leave blank to use the default"></textarea>
      <p class="muted small">{name} and {url} are filled in for you. The default:</p>
      <pre id="tysend-default-preview" class="send-default"></pre>
    </details>
    <div id="tysend-preview" class="send-preview" hidden></div>`
  updateSendButtons()
}

function selectedChannel() {
  const checked = document.querySelector('input[name="tysend-channel"]:checked')
  return checked instanceof HTMLInputElement
    ? /** @type {Types.ThankYouChannel} */ (checked.value)
    : "link"
}

function updateSendButtons() {
  if (!sendDialog || sendDialog.stage !== "pick") return
  const channel = selectedChannel()
  sendDialog.channel = channel
  const next = getButtonElement("tysend-next-btn")
  next.textContent =
    channel === "email"
      ? "Send the email"
      : channel === "sms"
        ? "Send the text"
        : "Make the link live"
  getButtonElement("tysend-preview-btn").hidden = channel === "link"
  const config = moduleState.config
  const pre = document.getElementById("tysend-default-preview")
  if (pre && config) {
    pre.textContent = channel === "sms" ? config.sms.defaultMessage : config.email.defaultMessage
  }
  const preview = document.getElementById("tysend-preview")
  if (preview) preview.hidden = true
}

function customMessage() {
  const ta = document.getElementById("tysend-message")
  return ta instanceof HTMLTextAreaElement ? ta.value.trim() || null : null
}

async function previewSend() {
  if (!sendDialog) return
  const el = document.getElementById("tysend-preview")
  if (!el) return
  const errorEl = getElement("tysend-error")
  errorEl.hidden = true
  try {
    const data = /** @type {Types.ThankYouPreviewResponse} */ (
      await api("/api/admin/thank-you/preview", {
        method: "POST",
        body: JSON.stringify({
          cardId: sendDialog.cardId,
          type: sendDialog.channel,
          customMessage: customMessage(),
        }),
      })
    )
    if (data.skipped) {
      el.innerHTML = html`<p class="status-note">Can't send by ${data.type}: ${data.skipped.reason}.</p>`
    } else if (data.type === "email" && data.emailHtml) {
      el.innerHTML = html`<p class="small">To ${data.recipient.contact}</p>
        <iframe class="send-email-frame" sandbox="" title="Email preview"></iframe>`
      const frame = el.querySelector("iframe")
      if (frame) frame.srcdoc = data.emailHtml
    } else {
      el.innerHTML = html`<p class="small">To ${data.recipient.contact}</p>
        <pre class="send-default">${data.recipient.messagePreview}</pre>`
    }
    el.hidden = false
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  }
}

async function handleSendNext() {
  const s = sendDialog
  if (!s) return
  if (s.stage !== "pick") {
    closeModal(getDialogElement("thankyou-send-modal"))
    return
  }
  const card = state.getCardById(s.cardId)
  if (!card) return
  const errorEl = getElement("tysend-error")
  const next = getButtonElement("tysend-next-btn")
  errorEl.hidden = true
  next.disabled = true
  const label = next.textContent
  next.textContent = "Sending…"
  try {
    const message = customMessage()
    const result = await sendOneCard(s.cardId, s.channel, message)
    if (!result.ok) throw new Error(result.error || "Didn't send")
    clearDraftKeyById(String(s.cardId))
    await refresh()
    const fresh = state.getCardById(s.cardId) || card
    if (s.channel === "link") {
      showLinkResult(fresh, message)
    } else {
      const how = s.channel === "sms" ? "text" : "email"
      showSuccess(`Sent ${firstName(card.guest_name)}'s card by ${how}`)
      // Replacing the dialog's entry closes it onto the card.
      void navigate(`${CARDS}/c${s.cardId}`, { replace: true })
    }
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
    next.textContent = label
  } finally {
    next.disabled = false
  }
}

/** The link is live: show it and a ready-made message to paste.
 *  @param {Types.ThankYouCardRow} card @param {string | null} custom */
function showLinkResult(card, custom) {
  if (!sendDialog) return
  sendDialog.stage = "done"
  const link = cardLink(card)
  const template = custom || moduleState.config?.email.defaultMessage || "{url}"
  const composed = renderMessage(template, { name: card.guest_name, url: link })
  getElement("tysend-body").innerHTML = html`<div class="send-done">
    <div class="done-icon">${icon("check")}</div>
    <p><strong>${firstName(card.guest_name)}'s card is live.</strong> Send them the link however you like.</p>
    <div class="copy-row">
      <input type="text" readonly value="${link}" aria-label="Card link" />
      <button type="button" class="btn" data-copy="${link}">Copy link</button>
    </div>
    <label class="small">Or paste this message
      <textarea readonly rows="5">${composed}</textarea></label>
    <button type="button" class="btn btn-sm" data-copy="${composed}">Copy the message</button>
  </div>`
  getButtonElement("tysend-preview-btn").hidden = true
  getButtonElement("tysend-cancel").hidden = true
  getButtonElement("tysend-next-btn").textContent = "Done"
}

/** One card, one channel, through the existing per-card endpoints.
 *  @param {number} id @param {Types.ThankYouChannel} via @param {string | null} [custom]
 *  @returns {Promise<Types.ThankYouBatchResult>} */
async function sendOneCard(id, via, custom = null) {
  try {
    if (via === "link") {
      await api(`/api/admin/thank-you/${id}/mark-sent`, {
        method: "POST",
        body: JSON.stringify({ via: "link" }),
      })
    } else {
      await api("/api/admin/thank-you/send", {
        method: "POST",
        body: JSON.stringify({ cardId: id, type: via, customMessage: custom }),
      })
    }
    return { id, via, ok: true, error: null }
  } catch (err) {
    return { id, via, ok: false, error: getErrorMessage(err) }
  }
}

// ==================== Batch send (Choose → How → Check → Sent) ====================

const histIdx = () =>
  history.state && typeof history.state.idx === "number" ? history.state.idx : 0

function saveFlow() {
  if (!flow) return
  try {
    sessionStorage.setItem(
      FLOW_KEY,
      JSON.stringify({
        ids: flow.ids,
        channel: flow.channel,
        sent: flow.sent,
        results: flow.results,
      }),
    )
  } catch {
    // The flow lives as long as the page.
  }
}

/** @returns {Types.ThankYouBatchFlow | null} */
function loadFlow() {
  try {
    const raw = sessionStorage.getItem(FLOW_KEY)
    if (!raw) return null
    const f = JSON.parse(raw)
    if (!f || !Array.isArray(f.ids)) return null
    return {
      ids: f.ids.filter((/** @type {unknown} */ n) => typeof n === "number"),
      channel: f.channel && typeof f.channel === "object" ? f.channel : {},
      sent: !!f.sent,
      results: Array.isArray(f.results) ? f.results : [],
      // History positions don't survive a reload (the router renumbers).
      chooseIdx: null,
      originIdx: null,
      doneIdx: null,
      rewind: false,
    }
  } catch {
    return null
  }
}

/** All the drafts, ticked (IA §5 C step 1). @param {Types.RouteContext} ctx
 *  @returns {Types.ThankYouBatchFlow} */
function freshFlow(ctx) {
  return {
    ids: drafts().map((c) => c.id),
    channel: {},
    sent: false,
    results: [],
    chooseIdx: histIdx(),
    originIdx: ctx.prev ? histIdx() - 1 : null,
    doneIdx: null,
    rewind: false,
  }
}

/** Back from Sent lands on a step before it: collapse the finished flow and
 *  rewind to wherever step 1 was opened (IA §13.5). @returns {boolean} */
function maybeRewind() {
  const f = flow
  if (!f || !f.sent || !f.rewind || f.doneIdx === null || histIdx() >= f.doneIdx) return false
  f.rewind = false
  if (f.originIdx !== null && f.originIdx < histIdx()) history.go(f.originIdx - histIdx())
  else void navigate(CARDS, { replace: true })
  return true
}

/** The flow's cards, still drafts, in list order. */
function flowCards() {
  if (!flow) return []
  const ids = new Set(flow.ids)
  return drafts().filter((c) => ids.has(c.id))
}

/** @param {Types.ThankYouCardRow} card */
function flowChannel(card) {
  const config = moduleState.config
  const conf = config ? configured(config) : { email: false, sms: false }
  const picked = flow?.channel[String(card.id)]
  const opts = channelOptions(contactOf(card), conf)
  if (picked && opts.some((o) => o.key === picked && o.ok)) return picked
  return defaultChannel(contactOf(card), conf)
}

/** @param {number} on */
function flowHead(on) {
  const steps = /** @type {Array<[string, string]>} */ ([
    ["Choose", SEND],
    ["How", SEND + "/how"],
    ["Check", SEND + "/check"],
    ["Sent", SEND + "/done"],
  ])
  return html`<header class="flow-head">
    <a class="btn btn-ghost" href="${CARDS}">${icon("back")} Cards</a>
    <ol class="flow" aria-label="Send cards, step by step">
      ${steps.map(([label, to], i) => {
        const n = i + 1
        const done = n < on
        const inner = html`<span class="flow-n" aria-hidden="true">${done ? icon("check") : n}</span
          ><span class="flow-label">${label}</span>`
        return html`<li>
          ${done && on < 4
            ? html`<a href="${to}" class="is-done">${inner}</a>`
            : html`<span class="${done ? "is-done" : ""}" aria-current="${n === on ? "step" : "false"}"
                >${inner}</span
              >`}
        </li>`
      })}
    </ol>
  </header>`
}

/** @param {string} markup */
function drawSingle(markup) {
  moduleState.view = "flow"
  moduleState.listKey = ""
  showListView()
  getElement("ty-view").innerHTML = html`<div class="single">${raw(markup)}</div>`
}

function goneOut() {
  drawSingle(html`${flowHead(4)}
    <div class="done-state">
      <h2>That batch has gone out</h2>
      <p>Going back can't un-send it.</p>
      <div class="btn-row">
        <a class="btn" href="${SEND}/done">See what was sent</a>
        <a class="btn btn-primary" href="${CARDS}">Back to cards</a>
      </div>
    </div>`)
}

/** Step 1: which drafts are going. @param {Types.RouteContext} ctx */
function flowChoose(ctx) {
  if (maybeRewind()) return
  flow = flow || loadFlow()
  // Forward onto the step 1 of a batch that has gone out: say so (IA §5 C).
  if (flow && flow.sent && flow.chooseIdx === histIdx()) return goneOut()
  // Opened afresh (from Cards, Home…) → every draft ticked again. Back to it
  // from How, or from a card's composer, keeps what was unticked.
  const sameEntry = flow !== null && flow.chooseIdx === histIdx()
  const fromFlow = FLOW_ROUTES.has(lastRoute) || COMPOSER_ROUTES.has(lastRoute)
  if (!flow || flow.sent || (!sameEntry && !fromFlow)) {
    flow = freshFlow(ctx)
    saveFlow()
  } else if (!sameEntry) {
    flow.chooseIdx = histIdx()
  }
  const all = drafts()
  if (all.length === 0) {
    drawSingle(html`${flowHead(1)}
      <div class="done-state">
        <h2>No drafts to send</h2>
        <p>Every card you've written has gone out.</p>
        <a class="btn btn-primary" href="${GIFTS}">Write some cards</a>
      </div>`)
    return
  }
  const n = flowCards().length
  drawSingle(html`${flowHead(1)}
    <header class="single-head">
      <h1>Which cards are going out?</h1>
      <p class="muted">All your drafts are ticked. Untick any you want to hold back.</p>
    </header>
    <ul class="pairs">
      ${all.map(
        (c) => html`<li>
          <label class="pair"
            ><input type="checkbox" data-act="tick" data-id="${c.id}" ${flow?.ids.includes(c.id) ? "checked" : ""} />
            <span class="avatar">${avatar(c.guest_name)}</span>
            <span
              ><strong>${c.guest_name}</strong><br /><span class="muted small pair-sub"
                >${renderMessage(c.message, { name: c.guest_name })}</span
              ></span
            >
            <a class="small" href="${CARDS}/c${c.id}/edit">Edit</a></label
          >
        </li>`,
      )}
    </ul>
    <div class="actionbar">
      <a
        class="btn btn-primary btn-lg ${n ? "" : "is-disabled"}"
        aria-disabled="${n ? "false" : "true"}"
        href="${SEND}/how"
        id="ty-flow-next"
        >Next: how to send ${n} →</a
      >
    </div>`)
}

/** Step 2: the channel for each card, pre-picked. @param {Types.RouteContext} ctx */
async function flowHow(ctx) {
  if (maybeRewind()) return
  flow = flow || loadFlow() || freshFlow(ctx)
  if (flow.sent) return goneOut()
  /** @type {Types.ThankYouSendConfig} */
  let config
  try {
    config = await ensureConfig()
  } catch (err) {
    showError("Couldn't load the send options: " + getErrorMessage(err))
    return
  }
  const cards = flowCards()
  if (cards.length === 0) {
    void navigate(SEND, { replace: true })
    return
  }
  const note = keysNote(config)
  drawSingle(html`${flowHead(2)}
    <header class="single-head">
      <h1>How should each one go?</h1>
      <p class="muted">We picked the best way we have for each guest. Change any you like.</p>
      ${note ? html`<p class="status-note">${note}</p>` : ""}
    </header>
    <ul class="send-list">
      ${cards.map((c) => {
        const ch = flowChannel(c)
        return html`<li>
          <span class="avatar">${avatar(c.guest_name)}</span><strong>${c.guest_name}</strong>
          <span class="channels-inline" role="radiogroup" aria-label="How to send ${c.guest_name}'s card">
            ${channelOptions(contactOf(c), configured(config)).map(
              (o) => html`<label class="radio ${o.ok ? "" : "is-off"}" title="${o.why}"
                ><input type="radio" name="ch-${c.id}" value="${o.key}" data-act="channel" data-id="${c.id}" ${o.key === ch ? "checked" : ""} ${o.ok ? "" : "disabled"} />
                ${o.label}</label
              >`,
            )}
          </span>
        </li>`
      })}
    </ul>
    <div class="actionbar">
      <a class="btn btn-lg" href="${SEND}" data-up>← Back</a>
      <a class="btn btn-primary btn-lg" href="${SEND}/check">Next: check →</a>
    </div>`)
}

/** @param {Types.ThankYouChannel} ch */
function channelWords(ch) {
  return ch === "email" ? "by email" : ch === "sms" ? "by text" : "as a link you send"
}

/** Step 3: every recipient, their channel and address, before anything goes
 *  (owner decision on SMS). @param {Types.RouteContext} ctx */
async function flowCheck(ctx) {
  if (maybeRewind()) return
  flow = flow || loadFlow() || freshFlow(ctx)
  if (flow.sent) return goneOut()
  try {
    await Promise.all([ensureConfig(), ensureSiteContent()])
  } catch (err) {
    showError("Couldn't load the send options: " + getErrorMessage(err))
    return
  }
  const cards = flowCards()
  if (cards.length === 0) {
    void navigate(SEND, { replace: true })
    return
  }
  /** @type {Record<Types.ThankYouChannel, number>} */
  const by = { email: 0, sms: 0, link: 0 }
  for (const c of cards) by[flowChannel(c)]++
  drawSingle(html`${flowHead(3)}
    <header class="single-head">
      <h1>Ready to send ${plural(cards.length, "card", "cards")}</h1>
      <p class="summary">
        ${by.email ? html`<span>${by.email} by email</span>` : ""}${by.sms
          ? html`<span>${by.sms} by text</span>`
          : ""}${by.link
          ? html`<span>${by.link} as ${by.link === 1 ? "a link" : "links"} you'll copy</span>`
          : ""}
      </p>
      ${by.sms
        ? html`<p class="status-note">
            ${plural(by.sms, "text message goes", "text messages go")} out in this pass, one
            after another. Each is listed below with its number.
          </p>`
        : ""}
    </header>
    <div class="check-grid">
      ${cards.map((c) => {
        const ch = flowChannel(c)
        const to = ch === "email" ? c.guest_email : ch === "sms" ? c.guest_phone : null
        return html`<figure class="check-card">
          ${cardPreview(c)}
          <figcaption>
            <strong>${c.guest_name}</strong> · ${channelWords(ch)}${to
              ? html`<br /><span class="muted">${to}</span>`
              : ""}
          </figcaption>
        </figure>`
      })}
    </div>
    <div class="actionbar">
      <a class="btn btn-lg" href="${SEND}/how" data-up>← Back</a>
      <button type="button" class="btn btn-primary btn-lg" data-act="batch-send" id="ty-batch-send">
        Send ${plural(cards.length, "card", "cards")}
      </button>
      <progress id="ty-batch-progress" class="batch-progress" max="${cards.length}" value="0" hidden></progress>
    </div>`)
}

/** Send the batch, one card after another, then Sent replaces Check. */
async function runBatch() {
  const f = flow
  if (!f || f.sent || moduleState.sending) return
  const cards = flowCards()
  if (cards.length === 0) return
  moduleState.sending = true
  const btn = document.getElementById("ty-batch-send")
  const bar = document.getElementById("ty-batch-progress")
  if (btn instanceof HTMLButtonElement) btn.disabled = true
  if (bar instanceof HTMLProgressElement) bar.hidden = false
  /** @type {Types.ThankYouBatchResult[]} */
  const results = []
  for (let i = 0; i < cards.length; i++) {
    if (btn) btn.textContent = `Sending ${i + 1} of ${cards.length}…`
    const c = cards[i]
    const ch = flowChannel(c)
    results.push(await sendOneCard(c.id, ch))
    if (bar instanceof HTMLProgressElement) bar.value = i + 1
    clearDraftKeyById(String(c.id))
  }
  f.sent = true
  f.results = results
  saveFlow()
  moduleState.sending = false
  try {
    await refresh()
  } catch {
    // The results list still shows what happened.
  }
  if (currentPlace()?.route.path !== "thank-yous/cards/send/check") {
    showSuccess(`Sent ${plural(results.filter((r) => r.ok).length, "card", "cards")}`)
    return
  }
  // Replace, not push: Sent takes Check's place, so Back can never land on a
  // live Send button. Back from Sent then rewinds to where step 1 was opened.
  await navigate(`${SEND}/done`, { replace: true })
  f.doneIdx = histIdx()
  f.rewind = true
}

/** @param {Types.ThankYouBatchResult} r */
function resultWords(r) {
  if (!r.ok) return html`<span class="status-note is-error small">${r.error || "Didn't send"}</span>`
  if (r.via === "link") return html`<span class="muted">Link ready to send</span>`
  return html`<span class="muted">Sent ${channelWords(r.via)}</span>`
}

/** Step 4: per-card results; failures can be retried, links copied. */
function flowDone() {
  flow = flow || loadFlow()
  const f = flow
  if (!f || !f.sent) {
    void navigate(SEND, { replace: true })
    return
  }
  const ok = f.results.filter((r) => r.ok)
  const sent = ok.filter((r) => r.via !== "link").length
  const links = ok.filter((r) => r.via === "link").length
  const failed = f.results.length - ok.length
  const heading =
    sent && links
      ? `${sent} on their way, ${links} ready to share`
      : links
        ? `${plural(links, "card", "cards")} ready to share`
        : sent
          ? `${plural(sent, "card", "cards")} on ${sent === 1 ? "its" : "their"} way`
          : "Nothing went out"
  drawSingle(html`${flowHead(4)}
    <div class="done-state">
      <div class="done-icon ${failed && !ok.length ? "is-failed" : ""}">
        ${icon(failed && !ok.length ? "alert" : "replies")}
      </div>
      <h2>${heading}</h2>
      <p>Opens and replies will show up in <a href="${REPLIES}">Replies</a>.</p>
    </div>
    ${failed
      ? html`<p class="status-note is-error">
          ${plural(failed, "card", "cards")} didn't go. Try again, or send ${failed === 1 ? "it" : "them"} as a
          link.
          ${failed > 1 ? html`<button type="button" class="btn btn-sm" data-act="retry-all">Try all again</button>` : ""}
        </p>`
      : ""}
    ${links > 1
      ? html`<p class="done-tools">
          <button type="button" class="btn btn-sm" data-act="copy-all">${icon("link")} Copy all the links</button>
        </p>`
      : ""}
    <ul class="send-list">
      ${f.results.map((r) => {
        const c = state.getCardById(r.id)
        const name = c ? c.guest_name : "A guest"
        return html`<li class="${r.ok ? "" : "is-failed"}">
          <span class="avatar">${avatar(name)}</span><strong>${name}</strong>
          ${resultWords(r)}
          ${!r.ok
            ? html`<button type="button" class="btn btn-sm" data-act="retry" data-id="${r.id}">Try again</button>
                ${r.via !== "link"
                  ? html`<button type="button" class="btn btn-sm btn-ghost" data-act="retry-link" data-id="${r.id}">
                      Send as a link
                    </button>`
                  : ""}`
            : r.via === "link"
              ? html`<button type="button" class="btn btn-sm" data-act="copy-link" data-id="${r.id}">Copy link</button>`
              : icon("check")}
        </li>`
      })}
    </ul>
    <div class="actionbar">
      <a class="btn btn-primary btn-lg" href="${CARDS}">Done</a>
    </div>`)
}

/** @param {number[]} ids @param {Types.ThankYouChannel | null} via null = same channel */
async function retry(ids, via) {
  const f = flow
  if (!f || moduleState.sending) return
  moduleState.sending = true
  for (const id of ids) {
    const i = f.results.findIndex((r) => r.id === id)
    if (i === -1) continue
    f.results[i] = await sendOneCard(id, via ?? f.results[i].via)
  }
  moduleState.sending = false
  saveFlow()
  try {
    await refresh()
  } catch {
    // Show what we know.
  }
  if (currentPlace()?.route.path === "thank-yous/cards/send/done") flowDone()
}

async function copyAllLinks() {
  const f = flow
  if (!f) return
  const lines = f.results
    .filter((r) => r.ok && r.via === "link")
    .map((r) => state.getCardById(r.id))
    .filter((c) => c !== null)
    .map((c) => `${c.guest_name}: ${cardLink(c)}`)
  const ok = await copyToClipboard(lines.join("\n"))
  if (ok) showSuccess(`Copied ${plural(lines.length, "link", "links")}`)
  else showError("Couldn't copy the links.")
}

// ==================== Clicks, changes, keys ====================

/** @param {MouseEvent} e */
function handleViewClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const el = target.closest("[data-act]")
  if (!(el instanceof HTMLElement)) return
  const act = el.dataset.act
  const id = Number(el.dataset.id)
  if (act === "delete-gift") confirmDeleteGift(id)
  else if (act === "copy-link") void copyLinkFor(id)
  else if (act === "resend") void resendCard(id)
  else if (act === "delete-card") confirmDeleteCard(id)
  else if (act === "clear-reply") confirmClearReply(id)
  else if (act === "batch-send") void runBatch()
  else if (act === "retry") void retry([id], null)
  else if (act === "retry-link") void retry([id], "link")
  else if (act === "retry-all") {
    void retry(
      (flow?.results ?? []).filter((r) => !r.ok).map((r) => r.id),
      null,
    )
  } else if (act === "copy-all") void copyAllLinks()
}

/** @param {Event} e */
function handleViewChange(e) {
  const t = e.target
  if (!(t instanceof HTMLInputElement)) return
  const act = t.dataset.act
  const id = Number(t.dataset.id)
  if (act === "physical") void togglePhysical(id, t.checked)
  else if (act === "reply-ping") void toggleReplyPing(t)
  else if (act === "tick" && flow) {
    flow.ids = t.checked ? [...flow.ids, id] : flow.ids.filter((x) => x !== id)
    saveFlow()
    const n = flowCards().length
    const next = document.getElementById("ty-flow-next")
    if (next) {
      next.textContent = `Next: how to send ${n} →`
      next.classList.toggle("is-disabled", n === 0)
      next.setAttribute("aria-disabled", n ? "false" : "true")
    }
  } else if (act === "channel" && flow) {
    flow.channel[String(id)] = /** @type {Types.ThankYouChannel} */ (t.value)
    saveFlow()
  }
}

/** Filter the list as you type (rows only, so the box keeps focus).
 *  @param {Event} e */
function handleViewInput(e) {
  const t = e.target
  if (!(t instanceof HTMLInputElement) || t.dataset.act !== "search") return
  moduleState.query = t.value
  const place = currentPlace()
  const rows = document.getElementById("ty-rows")
  if (!place || !rows) return
  if (moduleState.view === "gifts") rows.innerHTML = giftRows(parseKey(place.params.id, "g"))
  else if (moduleState.view === "cards") {
    rows.innerHTML = cardRows(place.query, parseKey(place.params.id, "c"))
  }
}

/** The ids the showing list moves through with j / k.
 *  @param {Types.RouteContext} ctx
 *  @returns {{ ids: number[], prefix: string, base: string, suffix: string } | null} */
function listOf(ctx) {
  if (moduleState.view === "gifts") {
    return { ids: giftsSorted().map((g) => g.id), prefix: "g", base: GIFTS, suffix: "" }
  }
  if (moduleState.view === "cards") {
    const ids = cardsFiltered(ctx.query).map((c) => c.id)
    return { ids, prefix: "c", base: CARDS, suffix: qs(ctx.query) }
  }
  if (moduleState.view === "replies") {
    return { ids: repliesSorted().map((c) => c.id), prefix: "c", base: REPLIES, suffix: "" }
  }
  return null
}

/** @type {NonNullable<Types.AdminPanel["keys"]>} */
function keys(e, ctx) {
  if (ctx.route.dialog) return false
  const list = listOf(ctx)
  if (!list) return false
  const sel = parseKey(ctx.params.id, list.prefix)
  if (e.key === "j" || e.key === "k") {
    const i = sel === null ? -1 : list.ids.indexOf(sel)
    const to = e.key === "j" ? (i < 0 ? list.ids[0] : list.ids[i + 1]) : list.ids[i - 1]
    if (to !== undefined) {
      void navigate(`${list.base}/${list.prefix}${to}${list.suffix}`, { replace: sel !== null })
    }
    return true
  }
  if (sel === null) return false
  if (moduleState.view === "cards") {
    const card = state.getCardById(sel)
    if (!card || card.status !== "draft") return false
    if (e.key === "e") {
      void navigate(`${CARDS}/c${sel}/edit`)
      return true
    }
    if (e.key === "s") {
      void navigate(`${CARDS}/c${sel}/send`)
      return true
    }
  }
  if (moduleState.view === "gifts" && e.key === "w") {
    const gift = state.getGiftById(sel)
    const cta = gift ? giftCta(gift) : null
    if (cta) void navigate(cta.to)
    return !!cta
  }
  return false
}

/** Redraw what's showing from the cached data (after an in-place change). */
function rerender() {
  const place = currentPlace()
  if (place && place.route.tab === "thankyous") void draw(place)
}

/** Render the place the router is showing.
 *  @param {Types.RouteContext} ctx @param {number} [seq] */
async function draw(ctx, seq = mountSeq) {
  const path = ctx.route.path
  if (!COMPOSER_ROUTES.has(path) && moduleState.draft) leaveComposer()
  const dialog = !!ctx.route.dialog
  // A dialog route draws its parent underneath, unless that's already showing.
  switch (path) {
    case "thank-yous/gifts":
    case "thank-yous/gifts/:id":
      return showGifts(ctx)
    case "thank-yous/gifts/new":
      if (moduleState.view !== "gifts") showGifts(ctx, { redirect: false })
      return openGiftDialog(null)
    case "thank-yous/gifts/:id/edit": {
      const gift = state.getGiftById(parseKey(ctx.params.id, "g") ?? 0)
      if (moduleState.view !== "gifts" || !ctx.samePanel) showGifts(ctx, { redirect: false })
      else if (gift) setCrumbs([{ label: gift.description || gift.guest_name }])
      return openGiftDialog(gift ? gift.id : null)
    }
    case "thank-yous/cards":
    case "thank-yous/cards/:id":
      return showCards(ctx)
    case "thank-yous/cards/write":
      if (moduleState.view !== "cards") showCards(ctx, { redirect: false })
      return openGuestPicker()
    case "thank-yous/cards/:id/send": {
      const card = state.getCardById(parseKey(ctx.params.id, "c") ?? 0)
      if (moduleState.view !== "cards" || !ctx.samePanel) showCards(ctx, { redirect: false })
      else if (card) setCrumbs([{ label: card.guest_name }])
      return openSendDialog(card ? card.id : 0)
    }
    case "thank-yous/cards/new":
    case "thank-yous/cards/:id/edit":
      await showComposer(ctx)
      return
    case "thank-yous/cards/new/photos":
    case "thank-yous/cards/:id/edit/photos":
      if ((await showComposer(ctx)) && seq === mountSeq) await openPhotoPicker()
      return
    case "thank-yous/cards/send":
      return flowChoose(ctx)
    case "thank-yous/cards/send/how":
      return flowHow(ctx)
    case "thank-yous/cards/send/check":
      return flowCheck(ctx)
    case "thank-yous/cards/send/done":
      return flowDone()
    case "thank-yous/replies":
    case "thank-yous/replies/:id":
      return showReplies(ctx)
    default:
      if (!dialog) void navigate(CARDS, { replace: true })
  }
}

/** @type {Types.AdminPanel["mount"]} */
async function mount(params, query, ctx) {
  const seq = ++mountSeq
  // Fresh data on entering the section; moves inside it use what's loaded.
  if (!ctx.samePanel || !moduleState.loaded) {
    try {
      await Promise.all([refresh(), ensureSiteContent()])
    } catch (err) {
      if (seq !== mountSeq) return
      showListView()
      getElement("ty-view").innerHTML = html`<div class="single">
        <div class="done-state">
          <h2>Couldn't load your thank-yous</h2>
          <p class="muted">${getErrorMessage(err)}</p>
          <a class="btn btn-primary" href="${pathOnly(ctx.path)}">Try again</a>
        </div>
      </div>`
      return
    }
  }
  if (seq !== mountSeq) return
  await draw(ctx, seq)
  lastRoute = ctx.route.path
}

function unmount() {
  if (moduleState.draft) leaveComposer()
  moduleState.view = null
  moduleState.listKey = ""
  moduleState.query = ""
  lastRoute = ""
  clearTimeout(seenTimer)
}

// ==================== Init ====================

/** @type {Types.initThankYous} */
export function initThankYous() {
  registerPanel("thankyous", {
    mount,
    unmount,
    keys,
    help: {
      title: "Thank-yous",
      keys: [
        ["j k", "Next / previous"],
        ["e", "Edit the card (drafts)"],
        ["s", "Send the card (drafts)"],
        ["w", "Write the gift's card"],
      ],
    },
  })

  // Preview handshake listener — attached before the iframe may post ready.
  window.addEventListener("message", handlePreviewMessage)

  const view = getElement("ty-view")
  view.addEventListener("click", handleViewClick)
  view.addEventListener("change", handleViewChange)
  view.addEventListener("input", handleViewInput)

  // Composer.
  getButtonElement("tc-editor-save").addEventListener("click", () => void handleSave())
  getButtonElement("tc-editor-next").addEventListener("click", () => void handleSaveNext())
  getElement("tc-editor-form").addEventListener("submit", (e) => e.preventDefault())
  getTextAreaElement("tc-editor-message").addEventListener("input", handleMessageInput)
  getSelectElement("tc-editor-template").addEventListener("change", handleTemplateChange)
  getButtonElement("tc-reroll-btn").addEventListener("click", handleReroll)
  getElement("tc-preset-chips").addEventListener("click", handlePresetChipsClick)
  getSelectElement("tc-editor-theme").addEventListener("change", handleThemeChange)
  getSelectElement("tc-editor-reveal").addEventListener("change", handleRevealChange)
  getButtonElement("tc-play-reveal-btn").addEventListener("click", handlePlayReveal)
  getButtonElement("tc-effect-add-btn").addEventListener("click", handleAddEffect)
  getElement("tc-photo-strip").addEventListener("click", handlePhotoStripClick)
  getElement("tc-story-body").addEventListener("click", handleStoryClick)
  getButtonElement("tc-restore-yes").addEventListener("click", applyRestore)
  getButtonElement("tc-restore-no").addEventListener("click", discardRestore)
  getButtonElement("tc-preview-mobile").addEventListener("click", () => setPreviewDevice("mobile"))
  getButtonElement("tc-preview-desktop").addEventListener("click", () =>
    setPreviewDevice("desktop"),
  )

  // Dialog routes.
  getElement("gift-form").addEventListener("submit", (e) =>
    handleGiftSubmit(/** @type {SubmitEvent} */ (e)),
  )
  getElement("photo-picker-body").addEventListener("click", handlePickerClick)
  getButtonElement("picker-confirm-btn").addEventListener("click", confirmPhotoPicker)
  getInputElement("tc-guest-picker-search").addEventListener("input", (e) => {
    const t = e.target
    if (t instanceof HTMLInputElement) renderGuestPicker(t.value)
  })
  getElement("tc-guest-picker-list").addEventListener("click", handleGuestPickerClick)
  const sendModal = getDialogElement("thankyou-send-modal")
  getButtonElement("tysend-next-btn").addEventListener("click", () => void handleSendNext())
  getButtonElement("tysend-preview-btn").addEventListener("click", () => void previewSend())
  sendModal.addEventListener("change", (e) => {
    const t = e.target
    if (t instanceof HTMLInputElement && t.name === "tysend-channel") updateSendButtons()
  })
  sendModal.addEventListener("click", (e) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const btn = t.closest("[data-copy]")
    if (!(btn instanceof HTMLButtonElement)) return
    void copyToClipboard(btn.dataset.copy || "").then((ok) => {
      btn.textContent = ok ? "Copied" : "Couldn't copy"
    })
  })

  // A reload or closed tab drops unsaved work: the browser asks. In-app moves
  // are asked by the router's guard.
  window.addEventListener("beforeunload", (e) => {
    if (!isThankYousDirty()) return
    e.preventDefault()
    e.returnValue = ""
  })
}
