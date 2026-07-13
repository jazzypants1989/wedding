/** @file Moderation tab (Phase 6) — combined queue across guestbook / media /
 *  comments with type + status filters, per-row + bulk approve/reject/hide, a
 *  detail modal (full content + author + all applicable actions), and an
 *  Accounts sub-view with trust / untrust / delete. */
/** @import * as Types from './types.js' */

import { state } from "./state.js"
import {
  api,
  openModal,
  closeModal,
  showError,
  showSuccess,
  showLoading,
} from "./utils.js"
import {
  html,
  formatDate,
  getElement,
  getInputElement,
  getSelectElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** @type {Record<Types.ModerationContentType, string>} */
const TYPE_LABELS = {
  guestbook: "Message",
  media: "Photo/Video",
  comment: "Comment",
}

/** Which sub-view is showing. */
let subView = "queue"
/** When set, the queue is filtered to one account's items. */
let accountFilter = /** @type {number | null} */ (null)
/** Selected queue rows for bulk actions, keyed "type:id". */
const selected = new Set()
/** Queue pagination cursor + flags (the server queue is offset-paged). */
const QUEUE_PAGE_SIZE = 50
let queueOffset = 0
let queueHasMore = false
let queueLoading = false
/** The item currently shown in the detail modal. */
let detailItem = /** @type {Types.ModerationItem | null} */ (null)
/** Index of the detail item within state.currentModeration (review-mode nav). */
let detailIndex = -1
/** The pending confirm-dialog action. */
let confirmState =
  /** @type {null | { title: string, desc: string, confirmLabel: string, danger: boolean, showRelease: boolean, showReason?: boolean, run: () => Promise<void>, onComplete?: () => void }} */ (
    null
  )

// ---- badge ----------------------------------------------------------------

/** @type {Types.updateModerationBadge} */
export function updateModerationBadge(count) {
  const badge = document.getElementById("moderation-badge")
  if (badge) {
    badge.textContent = String(count)
    badge.hidden = count <= 0
  }
}

/** @type {Types.loadModerationCount} */
export async function loadModerationCount() {
  try {
    const data = /** @type {Types.ModerationCountsResponse} */ (
      await api("/api/admin/moderation/counts")
    )
    updateModerationBadge(data.total)
  } catch (err) {
    // Non-critical — the tab still loads on demand.
  }
}

// ---- sub-view switching ---------------------------------------------------

/** @param {"queue" | "accounts"} view */
function showSubView(view) {
  subView = view
  getElement("mod-view-queue").hidden = view !== "queue"
  getElement("mod-view-accounts").hidden = view !== "accounts"
  for (const [id, name] of [
    ["mod-sub-queue", "queue"],
    ["mod-sub-accounts", "accounts"],
  ]) {
    const btn = getButtonElement(id)
    const active = name === view
    btn.classList.toggle("active", active)
    btn.setAttribute("aria-selected", active ? "true" : "false")
  }
  if (view === "queue") loadQueue()
  else loadAccounts()
}

/** @type {Types.loadModeration} */
export async function loadModeration() {
  // Entering the tab always starts on the unfiltered queue — a stale
  // account filter from a prior "View" must not silently persist (C2).
  accountFilter = null
  showSubView("queue")
}

// ---- queue ----------------------------------------------------------------

/**
 * Load the queue. `append` fetches the next offset page and adds to the table;
 * otherwise it resets to the first page (used on filter change / after actions).
 * The server queue is offset-paged and returns `hasMore` — without paging, only
 * the first 50 items were ever reachable while the badge showed the true total.
 * @param {boolean} [append]
 */
async function loadQueue(append = false) {
  if (queueLoading) return
  queueLoading = true
  const type = getSelectElement("mod-type-filter").value
  const status = getSelectElement("mod-status-filter").value
  const params = new URLSearchParams()
  if (type) params.set("type", type)
  if (status) params.set("status", status)
  if (accountFilter !== null) params.set("account_id", String(accountFilter))
  if (!append) queueOffset = 0
  params.set("limit", String(QUEUE_PAGE_SIZE))
  params.set("offset", String(queueOffset))

  try {
    if (!append) showLoading(getElement("moderation-tbody"), 6)
    const data = /** @type {Types.ModerationQueueResponse} */ (
      await api(`/api/admin/moderation/queue?${params}`)
    )
    if (append) {
      state.currentModeration = state.currentModeration.concat(data.items)
      appendQueueRows(data.items)
    } else {
      state.currentModeration = data.items
      selected.clear()
      getInputElement("mod-select-all").checked = false
      renderQueue(data.items)
    }
    queueOffset += data.items.length
    queueHasMore = data.hasMore
    updateLoadMore()
    updateBulkBar()
    getElement("mod-account-filter-note").hidden = accountFilter === null
    await loadModerationCount()
  } catch (err) {
    console.error("Failed to load moderation queue:", err)
    showError("Failed to load the moderation queue. Please refresh the page.")
  } finally {
    queueLoading = false
  }
}

function updateLoadMore() {
  getButtonElement("mod-loadmore").hidden = !queueHasMore
}

/** @param {Types.ModerationItem[]} items */
function renderQueue(items) {
  const tbody = getElement("moderation-tbody")
  if (items.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="6" class="empty-state">Nothing here 🎉</td>
    </tr>`
    return
  }
  tbody.innerHTML = html`${items.map(rowMarkup)}`
}

/**
 * Append a page of rows. If "select all" is currently on, newly-loaded rows are
 * selected too, so select-all keeps meaning "everything I've loaded".
 * @param {Types.ModerationItem[]} items
 */
function appendQueueRows(items) {
  if (items.length === 0) return
  const tbody = getElement("moderation-tbody")
  tbody.insertAdjacentHTML("beforeend", String(html`${items.map(rowMarkup)}`))
  if (getInputElement("mod-select-all").checked) {
    for (const item of items) {
      selected.add(itemKey(item))
      const box = tbody.querySelector(`.mod-row-check[data-key="${itemKey(item)}"]`)
      if (box instanceof HTMLInputElement) box.checked = true
    }
  }
}

/** @param {Types.ModerationItem} item @returns {string} */
function itemKey(item) {
  return `${item.content_type}:${item.id}`
}

/** @param {string} type @param {number} id @returns {Types.ModerationItem | null} */
function findItem(type, id) {
  return (
    state.currentModeration.find(
      (m) => m.content_type === type && m.id === id,
    ) || null
  )
}

/** @param {Types.ModerationItem} item @returns {string} */
function rowMarkup(item) {
  return html`
    <tr data-type="${item.content_type}" data-id="${item.id}">
      <td class="mod-check-col">
        <input type="checkbox" class="mod-row-check" data-key="${itemKey(item)}"
          aria-label="Select item" />
      </td>
      <td>${previewCell(item)}</td>
      <td class="hide-mobile">${TYPE_LABELS[item.content_type]}</td>
      <td>${authorCell(item)}</td>
      <td class="hide-mobile">${formatDate(item.created_at)}</td>
      <td class="actions-cell">${rowActions(item)}</td>
    </tr>
  `
}

/** @param {Types.ModerationItem} item @returns {string} */
function previewCell(item) {
  if (item.content_type === "media" && item.file_key) {
    if (item.needs_display && item.kind !== "video") {
      return html`<button type="button" class="mod-thumb mod-thumb-empty mod-preview-btn"
        data-action="detail">HEIC</button>`
    }
    const variant = item.kind === "video" ? "poster" : "thumb"
    return html`<button type="button" class="mod-preview-btn" data-action="detail">
      <img class="mod-thumb" src="/media/${item.file_key}/${variant}" alt="" loading="lazy" />
    </button>`
  }
  const text = item.message || item.caption || "(no text)"
  return html`<button type="button" class="mod-preview-btn mod-preview-text"
    data-action="detail">${preview(text)}</button>`
}

/** @param {Types.ModerationItem} item @returns {string} */
function authorCell(item) {
  const name = item.author_name || "The couple"
  return html`${name}${trustBadge(item.author_trusted)}`
}

/** @param {boolean | null} trusted @returns {string} */
function trustBadge(trusted) {
  if (trusted === null) return ""
  return html`<span class="trust-badge ${trusted ? "is-trusted" : ""}"
    >${trusted ? "trusted" : "new"}</span
  >`
}

/** @param {Types.ModerationItem} item @returns {string} */
function rowActions(item) {
  const btns = []
  if (item.status === "pending" || item.status === "hidden") {
    btns.push(
      html`<button class="btn btn-primary btn-sm" data-action="approve">Approve</button>`,
    )
  }
  if (item.status === "pending") {
    btns.push(
      html`<button class="btn btn-danger btn-sm" data-action="reject">Reject</button>`,
    )
  }
  if (item.status === "approved") {
    btns.push(
      html`<button class="btn btn-secondary btn-sm" data-action="hide">Hide</button>`,
    )
  }
  btns.push(
    html`<button class="btn btn-secondary btn-sm" data-action="detail">Details</button>`,
  )
  return html`${btns}`
}

/**
 * Truncate a message to a short single-line preview.
 * @param {string} message @returns {string}
 */
function preview(message) {
  const flat = message.split("\n").join(" ").trim()
  return flat.length > 120 ? flat.slice(0, 117) + "…" : flat
}

// ---- queue interaction ----------------------------------------------------

/** @param {MouseEvent} e */
function handleQueueClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("button[data-action]")
  if (!btn) return

  const row = btn.closest("tr")
  if (!(row instanceof HTMLTableRowElement)) return
  const type = row.dataset.type || ""
  const id = parseInt(row.dataset.id || "", 10)
  if (Number.isNaN(id)) return
  const item = findItem(type, id)
  if (!item) return

  const action = btn.getAttribute("data-action")
  if (action === "detail") openDetail(item)
  else if (action === "approve") openConfirm("approve", [item])
  else if (action === "reject") openConfirm("reject", [item])
  else if (action === "hide") openConfirm("hide", [item])
}

/** @param {Event} e */
function handleQueueChange(e) {
  const target = e.target
  if (!(target instanceof HTMLInputElement)) return
  if (!target.classList.contains("mod-row-check")) return
  const key = target.dataset.key
  if (!key) return
  if (target.checked) selected.add(key)
  else selected.delete(key)
  updateBulkBar()
}

function handleSelectAll() {
  const checked = getInputElement("mod-select-all").checked
  selected.clear()
  document.querySelectorAll(".mod-row-check").forEach((box) => {
    if (!(box instanceof HTMLInputElement)) return
    box.checked = checked
    if (checked && box.dataset.key) selected.add(box.dataset.key)
  })
  updateBulkBar()
}

function updateBulkBar() {
  getElement("mod-bulk-bar").hidden = selected.size === 0
  // Disclose that a bulk action only touches loaded rows when more remain, so
  // "select all → approve" isn't mistaken for acting on the whole backlog.
  const selectAll = getInputElement("mod-select-all").checked
  const hint = selectAll && queueHasMore ? " · Load more to include the rest" : ""
  getElement("mod-bulk-count").textContent = `${selected.size} selected${hint}`
}

/** @returns {Types.ModerationItem[]} */
function bulkItems() {
  /** @type {Types.ModerationItem[]} */
  const items = []
  for (const key of selected) {
    const idx = key.indexOf(":")
    const item = findItem(key.slice(0, idx), parseInt(key.slice(idx + 1), 10))
    if (item) items.push(item)
  }
  return items
}

function handleBulkApprove() {
  const items = bulkItems()
  if (items.length) openConfirm("approve", items)
}

function handleBulkReject() {
  const items = bulkItems()
  if (items.length) openConfirm("reject", items)
}

// ---- confirm dialog -------------------------------------------------------

/**
 * @param {{ title: string, desc: string, confirmLabel: string, danger: boolean, showRelease: boolean, showReason?: boolean, run: () => Promise<void>, onComplete?: () => void }} cfg
 */
function openConfirmDialog(cfg) {
  confirmState = cfg
  getElement("mod-confirm-title").textContent = cfg.title
  getElement("mod-confirm-desc").textContent = cfg.desc
  getElement("mod-confirm-release-row").hidden = !cfg.showRelease
  getInputElement("mod-confirm-release").checked = false
  getElement("mod-confirm-reason-row").hidden = !cfg.showReason
  getTextAreaElement("mod-confirm-reason").value = ""
  getElement("mod-confirm-error").hidden = true
  const btn = getButtonElement("mod-confirm-btn")
  btn.textContent = cfg.confirmLabel
  btn.className = cfg.danger ? "btn btn-danger" : "btn btn-primary"
  openModal(getDialogElement("mod-confirm-modal"))
}

async function handleConfirm() {
  if (!confirmState) return
  const btn = getButtonElement("mod-confirm-btn")
  const onComplete = confirmState.onComplete
  btn.disabled = true
  try {
    await confirmState.run()
    closeModal(getDialogElement("mod-confirm-modal"))
    // Run only on success (the queue has been reloaded inside run()).
    if (onComplete) onComplete()
  } catch (err) {
    const el = getElement("mod-confirm-error")
    el.textContent = getErrorMessage(err)
    el.hidden = false
  } finally {
    btn.disabled = false
  }
}

/**
 * @param {"approve" | "reject" | "hide"} action
 * @param {Types.ModerationItem[]} items
 * @param {() => void} [onComplete] Runs after a successful confirm (review-mode advance).
 */
function openConfirm(action, items, onComplete) {
  const single = items.length === 1 ? items[0] : null

  if (action === "approve") {
    const untrusted =
      single && single.author_trusted === false && single.account_id !== null
    const desc = single
      ? untrusted
        ? `Approve this item and trust ${single.author_name}? Their future posts will go live instantly.`
        : "Approve this item? It will appear publicly."
      : `Approve ${items.length} selected items? Any untrusted authors will be trusted so their future posts go live instantly.`
    openConfirmDialog({
      title: "Approve",
      desc,
      confirmLabel: "Approve",
      danger: false,
      showRelease: !!(single && single.account_id !== null),
      run: async () => {
        const releasePending = single
          ? getInputElement("mod-confirm-release").checked
          : false
        await runModeration(action, items, releasePending)
      },
      onComplete,
    })
    return
  }

  if (action === "reject") {
    const desc = single
      ? single.content_type === "media"
        ? "Reject this item? Its files are removed from the server (the record is kept for audit)."
        : "Reject this item? It won't be published (the author keeps their account)."
      : `Reject ${items.length} selected items? Rejected photos and videos have their files removed.`
    openConfirmDialog({
      title: "Reject",
      desc,
      confirmLabel: "Reject",
      danger: true,
      showRelease: false,
      // A single reject can carry an optional reason (recorded in the audit
      // log); bulk reject would need a per-item reason, so it's single-only.
      showReason: !!single,
      run: () => {
        const reason = single
          ? getTextAreaElement("mod-confirm-reason").value
          : ""
        return runModeration(action, items, false, reason)
      },
      onComplete,
    })
    return
  }

  // hide — single only (no bulk hide)
  openConfirmDialog({
    title: "Hide",
    desc: "Hide this item from the site? You can approve it again later to restore it. Guests who already viewed it may keep seeing it from their browser cache for up to ~24 hours — hiding removes it from the site, not from their device.",
    confirmLabel: "Hide",
    danger: false,
    showRelease: false,
    run: () => runModeration(action, items, false),
    onComplete,
  })
}

/**
 * @param {"approve" | "reject" | "hide"} action
 * @param {Types.ModerationItem[]} items
 * @param {boolean} releasePending
 * @param {string} [reason] Optional rejection reason (single reject only).
 */
async function runModeration(action, items, releasePending, reason = "") {
  if (items.length === 1) {
    const it = items[0]
    let body
    if (action === "approve" && releasePending) {
      body = JSON.stringify({ releasePending: true })
    } else if (action === "reject" && reason.trim()) {
      body = JSON.stringify({ reason: reason.trim() })
    }
    const res = /** @type {Types.ModerationActionResponse} */ (
      await api(`/api/admin/moderation/${it.content_type}/${it.id}/${action}`, {
        method: "POST",
        body,
      })
    )
    // Surface the side effects the confirm dialog promised (auto-trust / backlog
    // release) so the admin sees they happened (C3).
    if (action === "approve") {
      const parts = []
      if (res.autoTrusted) parts.push(`Trusted ${it.author_name || "the author"}`)
      if (res.released)
        parts.push(`released ${res.released} more item${res.released === 1 ? "" : "s"}`)
      if (parts.length) showSuccess(parts.join(" · "))
    }
  } else {
    const res = /** @type {Types.ModerationBulkResponse} */ (
      await api("/api/admin/moderation/bulk", {
        method: "POST",
        body: JSON.stringify({
          action,
          items: items.map((i) => ({ type: i.content_type, id: i.id })),
        }),
      })
    )
    // Surface the standing side effect a bulk approve carries (auto-trust) so
    // the couple sees how many authors will now post without review.
    if (action === "approve") {
      const parts = [`Approved ${res.changed}`]
      if (res.trusted) {
        parts.push(`trusted ${res.trusted} new author${res.trusted === 1 ? "" : "s"}`)
      }
      showSuccess(parts.join(" · "))
    }
  }
  await loadQueue()
}

// ---- detail modal ---------------------------------------------------------

/** @param {Types.ModerationItem} item */
function openDetail(item) {
  renderDetail(item)
  openModal(getDialogElement("moderation-modal"))
}

/** Render (or re-render) the detail modal for an item + its review-mode nav. */
/** @param {Types.ModerationItem} item */
function renderDetail(item) {
  detailItem = item
  detailIndex = state.currentModeration.findIndex(
    (m) => m.content_type === item.content_type && m.id === item.id,
  )
  getElement("moderation-error").hidden = true
  getElement("moderation-detail-body").innerHTML = detailBody(item)
  getElement("moderation-detail-actions").innerHTML = detailActions(item)
  updateDetailNav()
}

/**
 * Show/position the Prev/Next reviewer controls. Hidden unless the modal item is
 * part of a multi-item loaded queue (a lone/deep-linked item has nothing to step
 * through). Load-more extends the queue, so Next can reach freshly-loaded items.
 */
function updateDetailNav() {
  const total = state.currentModeration.length
  const nav = getElement("mod-detail-nav")
  if (detailIndex < 0 || total <= 1) {
    nav.hidden = true
    return
  }
  nav.hidden = false
  getElement("mod-detail-position").textContent = `${detailIndex + 1} of ${total}${
    queueHasMore ? "+" : ""
  }`
  getButtonElement("mod-detail-prev").disabled = detailIndex <= 0
  getButtonElement("mod-detail-next").disabled = detailIndex >= total - 1
}

/** Step the detail modal to the neighbouring queued item. @param {number} delta */
function stepDetail(delta) {
  const next = detailIndex + delta
  const item = state.currentModeration[next]
  if (item) renderDetail(item)
}

/** @param {Types.ModerationItem} item @returns {string} */
function detailBody(item) {
  let media = ""
  if (item.content_type === "media" && item.file_key) {
    if (item.kind === "video") {
      media = html`<video class="mod-detail-media" controls preload="metadata"
        poster="/media/${item.file_key}/poster"
        src="/media/${item.file_key}/video"></video>`
    } else if (item.needs_display) {
      media = html`<div class="mod-detail-missing">
        No preview available — this HEIC couldn't be processed in the browser. Use the
        original download below.
      </div>`
    } else {
      media = html`<img class="mod-detail-media"
        src="/media/${item.file_key}/display" alt="" />`
    }
  }
  const text = item.message
    ? html`<blockquote class="moderation-quote">${item.message}</blockquote>`
    : ""
  const caption = item.caption
    ? html`<p><strong>Caption:</strong> ${item.caption}</p>`
    : ""
  const name = item.author_name || "The couple"
  const relation = item.author_relation
    ? html` · <span class="mod-detail-relation">${item.author_relation}</span>`
    : ""
  const author = html`<div class="mod-detail-author">
    <strong>${name}</strong>${trustBadge(item.author_trusted)}${relation} ·
    ${TYPE_LABELS[item.content_type]} · ${formatDate(item.created_at)}
  </div>`
  return html`${media}${text}${caption}${author}`
}

/** @param {Types.ModerationItem} item @returns {string} */
function detailActions(item) {
  const btns = []
  if (item.status === "pending" || item.status === "hidden") {
    btns.push(html`<button class="btn btn-primary" data-action="approve">Approve</button>`)
  }
  if (item.status === "pending") {
    btns.push(html`<button class="btn btn-danger" data-action="reject">Reject</button>`)
  }
  if (item.status === "approved") {
    btns.push(html`<button class="btn btn-secondary" data-action="hide">Hide</button>`)
  }
  if (item.author_trusted === false && item.account_id !== null) {
    btns.push(
      html`<button class="btn btn-secondary" data-action="trust">Move to trusted</button>`,
    )
  }
  if (item.content_type === "media") {
    if (item.status === "approved") {
      btns.push(
        html`<button class="btn btn-secondary" data-action="promote">Move to official</button>`,
      )
    }
    if (item.file_key) {
      btns.push(
        html`<a class="btn btn-secondary" href="/media/${item.file_key}/original"
          download>Download original</a>`,
      )
    }
  }
  return html`${btns}`
}

/** @param {MouseEvent} e */
function handleDetailActions(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("button[data-action]")
  if (!btn) return
  const item = detailItem
  if (!item) return

  const action = btn.getAttribute("data-action")
  const dialog = getDialogElement("moderation-modal")
  // Review-mode: after acting, reopen the modal on the item that slid into this
  // slot (the acted one left the queue) so the couple keeps draining without
  // reopening rows. The queue is empty → stays closed.
  const resumeAt = detailIndex
  const advance = () => reopenReview(resumeAt)
  if (action === "approve") {
    closeModal(dialog)
    openConfirm("approve", [item], advance)
  } else if (action === "reject") {
    closeModal(dialog)
    openConfirm("reject", [item], advance)
  } else if (action === "hide") {
    closeModal(dialog)
    openConfirm("hide", [item], advance)
  } else if (action === "trust" && item.account_id !== null) {
    closeModal(dialog)
    openTrustConfirm(item.account_id, item.author_name || "this account", "trust")
  } else if (action === "promote") {
    closeModal(dialog)
    openPromoteConfirm(item)
  }
}

/** Reopen the detail modal on whatever item now occupies `index` (review flow). */
/** @param {number} index */
function reopenReview(index) {
  const items = state.currentModeration
  if (items.length === 0) return // queue drained — stay closed
  const i = Math.min(Math.max(0, index), items.length - 1)
  openDetail(items[i])
}

/** @param {Types.ModerationItem} item */
function openPromoteConfirm(item) {
  openConfirmDialog({
    title: "Move to official",
    desc: "Move this photo into the Official gallery section? It leaves the guest feed — this is a move, not a copy.",
    confirmLabel: "Move to official",
    danger: false,
    showRelease: false,
    run: async () => {
      await api(`/api/admin/media/${item.id}/promote`, { method: "POST" })
      await loadQueue()
    },
  })
}

// ---- accounts sub-view ----------------------------------------------------

async function loadAccounts() {
  const trusted = getSelectElement("mod-account-trusted-filter").value
  const params = new URLSearchParams()
  if (trusted) params.set("trusted", trusted)
  try {
    showLoading(getElement("accounts-tbody"), 6)
    const data = /** @type {Types.AccountsResponse} */ (
      await api(`/api/admin/accounts?${params}`)
    )
    state.currentAccounts = data.accounts
    renderAccounts(data.accounts)
  } catch (err) {
    console.error("Failed to load accounts:", err)
    showError("Failed to load accounts. Please refresh the page.")
  }
}

/** @param {Types.AccountRow[]} accounts */
function renderAccounts(accounts) {
  const tbody = getElement("accounts-tbody")
  if (accounts.length === 0) {
    tbody.innerHTML = html`<tr>
      <td colspan="6" class="empty-state">No accounts yet</td>
    </tr>`
    return
  }
  tbody.innerHTML = html`${accounts.map(accountRow)}`
}

/** @param {Types.AccountRow} a @returns {string} */
function accountRow(a) {
  return html`
    <tr data-id="${a.id}">
      <td><strong>${a.name}</strong></td>
      <td class="hide-mobile">${a.source}</td>
      <td>${trustBadge(a.trusted)}</td>
      <td class="hide-mobile">${a.post_count}</td>
      <td class="hide-mobile">${formatDate(a.created_at)}</td>
      <td class="actions-cell">
        <button class="btn btn-secondary btn-sm" data-action="view">View</button>
        ${a.trusted
          ? html`<button class="btn btn-secondary btn-sm" data-action="untrust">Untrust</button>`
          : html`<button class="btn btn-primary btn-sm" data-action="trust">Trust</button>`}
        <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
      </td>
    </tr>
  `
}

/** @param {MouseEvent} e */
function handleAccountsClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("button[data-action]")
  if (!btn) return
  const row = btn.closest("tr")
  if (!(row instanceof HTMLTableRowElement)) return
  const id = parseInt(row.dataset.id || "", 10)
  if (Number.isNaN(id)) return
  const account = state.getAccountById(id)
  if (!account) return

  const action = btn.getAttribute("data-action")
  if (action === "view") {
    accountFilter = id
    showSubView("queue")
  } else if (action === "trust") {
    openTrustConfirm(id, account.name, "trust")
  } else if (action === "untrust") {
    openTrustConfirm(id, account.name, "untrust")
  } else if (action === "delete") {
    openAccountDeleteConfirm(id, account.name)
  }
}

/**
 * @param {number} id @param {string} name @param {"trust" | "untrust"} mode
 */
function openTrustConfirm(id, name, mode) {
  if (mode === "trust") {
    openConfirmDialog({
      title: "Trust account",
      desc: `Trust ${name}? Their held content can go live and their future posts will skip review.`,
      confirmLabel: "Trust",
      danger: false,
      showRelease: true,
      run: async () => {
        const approvePending = getInputElement("mod-confirm-release").checked
        await api(`/api/admin/accounts/${id}/trust`, {
          method: "POST",
          body: JSON.stringify({ approve_pending: approvePending }),
        })
        await refreshAfterAccountAction()
      },
    })
  } else {
    openConfirmDialog({
      title: "Untrust account",
      desc: `Untrust ${name}? Their existing posts stay live, but future posts will be held for review.`,
      confirmLabel: "Untrust",
      danger: false,
      showRelease: false,
      run: async () => {
        await api(`/api/admin/accounts/${id}/untrust`, { method: "POST" })
        await refreshAfterAccountAction()
      },
    })
  }
}

/** @param {number} id @param {string} name */
function openAccountDeleteConfirm(id, name) {
  openConfirmDialog({
    title: "Delete account",
    desc: `Delete ${name}? Their approved content is hidden from the site and their sessions end immediately. Files are kept (reversible until items are individually rejected).`,
    confirmLabel: "Delete",
    danger: true,
    showRelease: false,
    run: async () => {
      await api(`/api/admin/accounts/${id}`, { method: "DELETE" })
      await refreshAfterAccountAction()
    },
  })
}

async function refreshAfterAccountAction() {
  if (subView === "accounts") await loadAccounts()
  else await loadQueue()
  await loadModerationCount()
}

// ---- init -----------------------------------------------------------------

/** @type {Types.initModeration} */
export function initModeration() {
  getButtonElement("mod-sub-queue").addEventListener("click", () => {
    // Clicking the Queue pill clears any account filter set via a row's "View";
    // navigating there via "View" sets the filter and calls showSubView directly.
    accountFilter = null
    showSubView("queue")
  })
  getButtonElement("mod-sub-accounts").addEventListener("click", () =>
    showSubView("accounts"),
  )
  // Arrow-wrap so the change Event isn't passed as loadQueue's `append` arg.
  getSelectElement("mod-type-filter").addEventListener("change", () => loadQueue())
  getSelectElement("mod-status-filter").addEventListener("change", () => loadQueue())
  getSelectElement("mod-account-trusted-filter").addEventListener(
    "change",
    loadAccounts,
  )

  getElement("moderation-tbody").addEventListener("click", handleQueueClick)
  getElement("moderation-tbody").addEventListener("change", handleQueueChange)
  getInputElement("mod-select-all").addEventListener("change", handleSelectAll)
  getButtonElement("mod-loadmore").addEventListener("click", () => loadQueue(true))
  getButtonElement("mod-bulk-approve").addEventListener("click", handleBulkApprove)
  getButtonElement("mod-bulk-reject").addEventListener("click", handleBulkReject)
  getButtonElement("mod-clear-account").addEventListener("click", () => {
    accountFilter = null
    loadQueue()
  })

  getElement("accounts-tbody").addEventListener("click", handleAccountsClick)
  getButtonElement("mod-detail-prev").addEventListener("click", () => stepDetail(-1))
  getButtonElement("mod-detail-next").addEventListener("click", () => stepDetail(1))
  getElement("moderation-detail-actions").addEventListener(
    "click",
    handleDetailActions,
  )
  getButtonElement("mod-confirm-btn").addEventListener("click", handleConfirm)
}
