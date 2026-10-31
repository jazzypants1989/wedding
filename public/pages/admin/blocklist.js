/** @file Requests › Blocked: the people who won't see the invitation-request
 *  form. Drawn inside the Requests split view (petitions.js owns the panel);
 *  this module holds the list, its markup, the "Block someone" dialog route
 *  (/admin/requests/blocked/new) and the Unblock confirm. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */

import { api, openModal, closeModal, showSuccess } from "./utils.js"
import { navigate } from "./router.js"
import { icon } from "./icons.js"
import {
  html,
  formatDate,
  getElement,
  getFormElement,
  getInputElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"

/** @type {GlobalTypes.BlocklistEntry[]} */
let entries = []
/** The entry the Unblock confirm is about, and where to go after. */
/** @type {{ id: number, next: () => string } | null} */
let pendingUnblock = null

/** @type {Types.loadBlocklist} */
export async function loadBlocklist() {
  const res = /** @type {Types.BlocklistResponse} */ (await api("/api/admin/blocklist"))
  entries = res.blocklist
}

/** Newest first. @type {Types.blockedItems} */
export function blockedItems() {
  return entries
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
}

/** What a blocked entry is called in a list. @param {GlobalTypes.BlocklistEntry} e */
function label(e) {
  return e.name || e.email || e.phone || "Someone"
}

/** @type {Types.blockedListMarkup} */
export function blockedListMarkup(selected) {
  const items = blockedItems()
  const tools = html`<div class="pane-tools blocked-tools">
    <span class="muted small">${items.length
      ? `${items.length} blocked · they don't see the request form`
      : "Nobody is blocked."}</span>
    <a class="btn btn-sm" href="/admin/requests/blocked/new">+ Block someone</a>
  </div>`
  if (!items.length) {
    return html`${tools}<p class="list-empty">
        People you block won't be offered the invitation-request form when they look up their
        invitation. Denying a request can block them too.
      </p>`
  }
  return html`${tools}
    <ul class="rows">
      ${items.map((e) => {
        const also = [e.name ? e.email : null, e.name || e.email ? e.phone : null].filter(Boolean)
        return html`<li>
          <a class="row" href="/admin/requests/blocked/b${e.id}" data-select
            aria-current="${e.id === selected ? "true" : "false"}">
            <span class="row-main">
              <span class="row-top"><strong>${label(e)}</strong></span>
              <span class="row-sub">Blocked ${formatDate(e.created_at)}${e.reason
                ? ` · ${e.reason}`
                : also.length
                  ? ` · ${also.join(" · ")}`
                  : ""}</span>
            </span>
          </a>
        </li>`
      })}
    </ul>`
}

/** @type {Types.blockedDetailMarkup} */
export function blockedDetailMarkup(id) {
  const back = html`<a class="m-back" href="/admin/requests/blocked" data-up>${icon("back")}Blocked</a>`
  const e = id !== null ? entries.find((x) => x.id === id) : undefined
  if (!e) {
    return id !== null
      ? html`${back}<div class="detail-empty">That entry isn't on the list any more.</div>`
      : html`<div class="detail-empty">
          ${entries.length ? "Pick someone." : "Nobody is blocked. That's a good thing."}
        </div>`
  }
  return html`${back}
    <article class="detail">
      <header class="detail-head">
        <span class="eyebrow">Blocked · since ${formatDate(e.created_at)}</span>
      </header>
      <h1>${label(e)}</h1>
      <dl class="facts">
        <div><dt>Name <span class="fact-note">close spellings match</span></dt><dd>${e.name || "—"}</dd></div>
        <div><dt>Email <span class="fact-note">exact</span></dt><dd class="fact-break">${e.email || "—"}</dd></div>
        <div><dt>Phone <span class="fact-note">exact</span></dt><dd>${e.phone || "—"}</dd></div>
      </dl>
      ${e.reason ? html`<p class="status-note">Why: ${e.reason}</p>` : ""}
      <p class="muted">They won't see the invitation-request form when they look up their invitation.</p>
    </article>
    <div class="actionbar">
      <button type="button" class="btn btn-lg btn-danger-soft" data-block-action="unblock">Unblock…</button>
    </div>`
}

/** Reset the Block someone dialog for a fresh arrival. @type {Types.prepareBlockForm} */
export function prepareBlockForm() {
  getFormElement("blocklist-form").reset()
  getElement("blocklist-form-error").hidden = true
}

/** @type {Types.handleBlocklistFormSubmit} */
async function handleBlocklistFormSubmit(e) {
  e.preventDefault()
  const errorEl = getElement("blocklist-form-error")
  errorEl.hidden = true
  const name = getInputElement("blocklist-name").value.trim() || null
  const email = getInputElement("blocklist-email").value.trim() || null
  const phone = getInputElement("blocklist-phone").value.trim() || null
  const reason = getTextAreaElement("blocklist-reason").value.trim() || null
  if (!name && !email && !phone) {
    errorEl.textContent = "Fill in a name, an email or a phone number."
    errorEl.hidden = false
    return
  }
  const submitBtn = getButtonElement("blocklist-form-submit")
  submitBtn.disabled = true
  try {
    const res = /** @type {{ id?: number }} */ (
      await api("/api/admin/blocklist", {
        method: "POST",
        body: JSON.stringify({ name, email, phone, reason }),
      })
    )
    await loadBlocklist()
    const id = res.id
    // The new entry replaces the dialog's history entry.
    const to = id ? `/admin/requests/blocked/b${id}` : "/admin/requests/blocked"
    void navigate(to, { replace: true })
    showSuccess(`Blocked ${name || email || phone}`)
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    submitBtn.disabled = false
  }
}

/** @type {Types.confirmUnblock} */
export function confirmUnblock(id, next) {
  const e = entries.find((x) => x.id === id)
  if (!e) return
  pendingUnblock = { id, next }
  getElement("blocklist-delete-modal-title").textContent = `Unblock ${label(e)}?`
  getElement("blocklist-delete-error").hidden = true
  openModal(getDialogElement("blocklist-delete-modal"))
}

/** @type {Types.handleBlocklistDeleteConfirm} */
async function handleBlocklistDeleteConfirm() {
  const p = pendingUnblock
  if (!p) return
  const btn = getButtonElement("confirm-blocklist-delete-btn")
  btn.disabled = true
  const errorEl = getElement("blocklist-delete-error")
  errorEl.hidden = true
  const to = p.next()
  try {
    await api(`/api/admin/blocklist/${p.id}`, { method: "DELETE" })
    closeModal(getDialogElement("blocklist-delete-modal"))
    await loadBlocklist()
    void navigate(to, { replace: true })
    showSuccess("Unblocked")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    pendingUnblock = null
  }
}

/** @type {Types.initBlocklist} */
export function initBlocklist() {
  getFormElement("blocklist-form").addEventListener("submit", handleBlocklistFormSubmit)
  getButtonElement("confirm-blocklist-delete-btn").addEventListener(
    "click",
    handleBlocklistDeleteConfirm,
  )
}
