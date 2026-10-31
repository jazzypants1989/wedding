/** @file Guests & RSVPs — one split view (prototypes/admin-workspace views/misc.js,
 *  IA §2, §4, §10). An RSVP is a fact about a guest, so it is a filter in the
 *  list (`?rsvp=yes|no|awaiting|archived`), a line in every row and a block in
 *  the detail — not a tab. Search is `?q=`. Both survive reload.
 *
 *  Routes: /admin/guests · /admin/guests/g12 (sel) · dialog routes
 *  /admin/guests/new, /admin/guests/g12/edit, /admin/guests/import,
 *  /admin/guests/invite(/sent), /admin/guests/g12/invite, /admin/guests/text.
 *  The roster is small (a wedding), so it is loaded whole and filtered here. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */

import { mountInvite } from "./invites.js"
import { mountImport } from "./csv-import.js"
import { mountManualSms } from "./manual-sms.js"
import { api, showError, showSuccess, showLoadError, openModal, closeModal } from "./utils.js"
import { registerPanel, navigate, setCrumbs, currentPlace } from "./router.js"
import { icon } from "./icons.js"
import {
  html,
  formatDate,
  getElement,
  getFormElement,
  getInputElement,
  getSelectElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
  getTextAreaElement,
} from "../utils.js"
import { formatRelative } from "../../components/relative-time.js"
import { renderMonogram } from "../../components/monogram.js"

/** The API's page ceiling (types.js PAGINATION.MAX_PAGE_SIZE). */
const PAGE = 100

/** @type {readonly [Types.GuestFilter, string][]} */
const CHIPS = [
  ["all", "Everyone"],
  ["yes", "Coming"],
  ["no", "Can't come"],
  ["awaiting", "Awaiting reply"],
  ["archived", "Archived"],
]

/** The list head's links to dialog routes; each carries the list's filter. */
const TOOL_LINKS = /** @type {const} */ ([
  ["add-guest-btn", "/admin/guests/new"],
  ["import-csv-btn", "/admin/guests/import"],
  ["send-invites-btn", "/admin/guests/invite"],
  ["manual-sms-btn", "/admin/guests/text"],
])

/** @type {Types.GuestsData} */
const data = {
  guests: [],
  archived: null,
  rsvps: new Map(),
  stats: null,
  loaded: false,
}

/** What the list is showing (from the URL). */
/** @type {Types.GuestsView} */
const view = { filter: "all", q: "", id: null, items: [] }

/** @type {Promise<void> | null} */
let loading = null
/** The dialog route path last prepared, so a remount doesn't reset it. */
let preparedDialog = ""
/** @type {ReturnType<typeof setTimeout> | undefined} */
let searchTimer
/** Thank-you stories already fetched, by guest id. */
const stories = /** @type {Map<number, Types.GuestStory | null>} */ (new Map())
/** The guest the archive / restore confirm is about. */
let confirmId = /** @type {number | null} */ (null)

// ------------------------------------------------------------------ data

/** Every page of one guest query. @param {string} status */
async function fetchAllGuests(status) {
  /** @type {GlobalTypes.GuestWithInviteCount[]} */
  const all = []
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
    if (status) params.set("status", status)
    const res = /** @type {Types.GuestsApiResponse} */ (await api(`/api/admin/guests?${params}`))
    all.push(...res.guests)
    if (res.guests.length < PAGE || all.length >= res.pagination.total) break
  }
  return all
}

/** @type {Types.loadStats} */
export async function loadStats() {
  try {
    const res = /** @type {Types.StatsApiResponse} */ (await api("/api/admin/stats"))
    data.stats = res.stats
    renderSummary()
  } catch (err) {
    console.error("Failed to load stats:", err)
  }
}

/** Reload the roster, the RSVPs and the stats; re-draw if the panel shows.
 *  @type {Types.loadGuests} */
export async function loadGuests() {
  if (loading) return loading
  loading = (async () => {
    try {
      const [guests, rsvps] = await Promise.all([
        fetchAllGuests(""),
        /** @type {Promise<Types.RSVPsResponse>} */ (api("/api/admin/rsvps")),
        loadStats(),
      ])
      data.guests = guests
      data.rsvps = new Map(rsvps.rsvps.map((r) => [r.guest_id, r]))
      if (data.archived !== null || view.filter === "archived") {
        data.archived = await fetchAllGuests("archived")
      }
      data.loaded = true
    } finally {
      loading = null
    }
  })()
  await loading
  const ctx = currentPlace()
  if (ctx && ctx.route.tab === "guests") draw(ctx)
}

/** The roster as loaded (other modules match against it). */
export function rosterGuests() {
  return data.guests
}

// --------------------------------------------------------------- helpers

/** @param {string | null} v @returns {Types.GuestFilter} */
function toFilter(v) {
  return v === "yes" || v === "no" || v === "awaiting" || v === "archived" ? v : "all"
}

/** "g12" → 12. @param {string | undefined} sel */
function selId(sel) {
  if (!sel || !sel.startsWith("g")) return null
  const n = Number(sel.slice(1))
  return Number.isInteger(n) && n > 0 ? n : null
}

/** The list's own query string ("" or "?rsvp=yes&q=ann"). */
function qs() {
  const p = new URLSearchParams()
  if (view.filter !== "all") p.set("rsvp", view.filter)
  if (view.q) p.set("q", view.q)
  const s = p.toString()
  return s ? "?" + s : ""
}

/** @param {number} id */
const guestPath = (id) => `/admin/guests/g${id}`

/** @param {GlobalTypes.Guest} g @returns {"yes" | "no" | "awaiting"} */
function rsvpOf(g) {
  const r = data.rsvps.get(g.id)
  if (!r) return "awaiting"
  return r.attending ? "yes" : "no"
}

/** @param {GlobalTypes.Guest} g @param {string} q lowercased */
function matches(g, q) {
  if (!q) return true
  const hay = [g.name, g.email ?? "", g.phone ?? "", g.invite_code].join(" ").toLowerCase()
  if (hay.includes(q)) return true
  const digits = [...q].filter((c) => c >= "0" && c <= "9").join("")
  return digits.length >= 3 && (g.phone ?? "").includes(digits)
}

/** @param {Types.GuestFilter} f @param {string} q */
function filtered(f, q) {
  const list = f === "archived" ? (data.archived ?? []) : data.guests
  const needle = q.trim().toLowerCase()
  return list
    .filter((g) => (f === "all" || f === "archived" || rsvpOf(g) === f) && matches(g, needle))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}

/** @param {number} id */
function guestById(id) {
  return (
    data.guests.find((g) => g.id === id) ??
    (data.archived ?? []).find((g) => g.id === id) ??
    null
  )
}

const isWide = () => window.matchMedia("(min-width: 900px)").matches

/** @param {number} n @param {string} one @param {string} [many] */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many ?? one + "s")}`
}

/** Row second line: where the RSVP stands. @param {GlobalTypes.GuestWithInviteCount} g */
function rsvpWord(g) {
  if (g.deleted_at) return "Archived"
  const state = rsvpOf(g)
  if (state === "yes") return "Coming"
  if (state === "no") return "Can't come"
  if (g.last_invited_at || g.status === "invited") return "Invited, no reply"
  return "Not invited yet"
}

// ---------------------------------------------------------------- render

function renderSummary() {
  const el = document.getElementById("guests-summary")
  if (!el) return
  const s = data.stats
  el.textContent = s
    ? `${plural(s.total_guests, "party", "parties")} · ` +
      `${plural(s.total_headcount, "person", "people")} coming`
    : ""
}

function renderChips() {
  /** @type {Record<Types.GuestFilter, number | null>} */
  const counts = { all: data.guests.length, yes: 0, no: 0, awaiting: 0, archived: null }
  for (const g of data.guests) counts[rsvpOf(g)] = (counts[rsvpOf(g)] ?? 0) + 1
  if (data.archived) counts.archived = data.archived.length
  const q = view.q ? "&q=" + encodeURIComponent(view.q) : ""
  getElement("guests-chips").innerHTML = html`${CHIPS.map(([key, label]) => {
    const href =
      key === "all"
        ? "/admin/guests" + (q ? "?" + q.slice(1) : "")
        : `/admin/guests?rsvp=${key}${q}`
    const n = counts[key]
    return html`<a class="chip" data-replace href="${href}" aria-current="${view.filter === key ? "true" : "false"}"
      >${label}${n !== null && key !== "all" ? html` <span class="chip-n">${n}</span>` : ""}</a
    >`
  })}`
}

/** @param {GlobalTypes.GuestWithInviteCount} g */
function rowMarkup(g) {
  const r = data.rsvps.get(g.id)
  const seats = r && r.attending ? (r.actual_party_size ?? g.party_size) : g.party_size
  const contact = g.email || g.phone || ""
  return html`<li>
    <a class="row ${g.deleted_at ? "is-archived" : ""}" href="${guestPath(g.id) + qs()}" data-select
      data-id="${g.id}" aria-current="${g.id === view.id ? "true" : "false"}">
      <span class="avatar">${renderMonogram(g.name)}</span>
      <span class="row-main">
        <span class="row-top"><strong>${g.name}</strong><span class="row-time"
            title="${r && r.attending ? "Coming" : "Invited"}">${seats}</span></span>
        <span class="row-sub"><span class="rsvp-word rsvp-${g.deleted_at ? "archived" : rsvpOf(g)}"
            >${rsvpWord(g)}</span>${contact ? ` · ${contact}` : ""}</span>
      </span>
    </a>
  </li>`
}

function renderRows() {
  const rows = getElement("guests-rows")
  const items = view.items
  if (!data.loaded) {
    rows.innerHTML = html`<li class="list-empty">Loading the guest list…</li>`
    return
  }
  if (items.length === 0) {
    const roster = view.filter === "all" && !view.q
    rows.innerHTML = roster
      ? html`<li class="list-empty">
          No guests yet.
          <span class="btn-row">
            <a class="btn btn-sm btn-primary" href="/admin/guests/new">+ Add a guest</a>
            <a class="btn btn-sm" href="/admin/guests/import">Import a CSV</a>
          </span>
        </li>`
      : html`<li class="list-empty">
          ${view.q ? `Nobody matches “${view.q}”` : "Nobody here"}${view.filter !== "all"
            ? html` in this filter. <a href="/admin/guests${view.q ? "?q=" + encodeURIComponent(view.q) : ""}"
                  data-replace>Show everyone</a>`
            : "."}
        </li>`
    return
  }
  rows.innerHTML = html`${items.map(rowMarkup)}`
  const sel = rows.querySelector('[aria-current="true"]')
  if (sel instanceof HTMLElement) sel.scrollIntoView({ block: "nearest" })
}

/** @param {GlobalTypes.Guest} g */
function rsvpLine(g) {
  const r = data.rsvps.get(g.id)
  if (r) {
    const when = `replied ${formatDate(r.submitted_at)}`
    if (!r.attending) return `Can't come · ${when}`
    const n = r.actual_party_size ?? g.party_size
    return `Coming · ${n} of ${g.party_size} · ${when}`
  }
  const gi = /** @type {GlobalTypes.GuestWithInviteCount} */ (g)
  if (g.last_invited_at) {
    const times = gi.invite_count > 1 ? ` (${gi.invite_count}×)` : ""
    return `No reply yet · invited ${formatDate(g.last_invited_at)}${times}`
  }
  return g.status === "invited" ? "No reply yet · invited" : "Not invited yet"
}

/** @param {GlobalTypes.GuestWithInviteCount} g */
function detailMarkup(g) {
  const r = data.rsvps.get(g.id)
  const archived = !!g.deleted_at
  const canInvite = !archived && !r && (!!g.email || !!g.phone)
  const back = html`<a class="m-back" href="${"/admin/guests" + qs()}" data-up
    >${icon("back")}Guests</a
  >`
  const rsvpBlock = r
    ? html`<section class="detail-block">
        <h2>Their RSVP</h2>
        <dl class="facts">
          <div><dt>Food</dt><dd>${r.dietary_restrictions || "Nothing noted"}</dd></div>
          <div><dt>Anything else</dt><dd>${r.additional_info || "—"}</dd></div>
        </dl>
        ${r.message ? html`<blockquote class="rsvp-msg">${r.message}</blockquote>` : ""}
      </section>`
    : ""
  return html`${back}
    <article class="detail guest-detail">
      <header class="person-head">
        <span class="avatar avatar-xl">${renderMonogram(g.name)}</span>
        <div>
          <h1>${g.name}</h1>
          <p class="muted">
            Party of ${g.party_size}${archived ? html` · <span class="tag">Archived</span>` : ""}
          </p>
        </div>
      </header>
      <dl class="facts">
        <div><dt>RSVP</dt><dd>${rsvpLine(g)}</dd></div>
        <div><dt>Email</dt><dd class="fact-break">${g.email || "—"}</dd></div>
        <div><dt>Phone</dt><dd>${g.phone || "—"}</dd></div>
        <div><dt>Invite code</dt><dd><code>${g.invite_code}</code></dd></div>
      </dl>
      ${rsvpBlock}
      ${g.notes
        ? html`<section class="detail-block">
            <h2>Notes</h2>
            <p class="guest-notes">${g.notes}</p>
          </section>`
        : ""}
      <div id="guest-story" class="detail-block" hidden></div>
      <div class="btn-row">
        ${archived
          ? html`<button type="button" class="btn btn-sm" data-guest-action="restore">Restore…</button>`
          : html`<a class="btn btn-sm" href="${guestPath(g.id)}/edit${qs()}">Edit</a>
              ${canInvite
                ? html`<a class="btn btn-sm" href="${guestPath(g.id)}/invite${qs()}"
                    >${g.last_invited_at || g.status === "invited" ? "Resend invite" : "Send invite"}</a
                  >`
                : ""}
              <button type="button" class="btn btn-sm" data-guest-action="copy-link">Copy RSVP link</button>
              <button type="button" class="btn btn-sm" data-guest-action="archive">Archive…</button>`}
      </div>
    </article>`
}

function renderDetail() {
  const pane = getElement("guests-detail")
  const g = view.id !== null ? guestById(view.id) : null
  getElement("guests-split").classList.toggle("has-sel", view.id !== null)
  if (!g) {
    pane.innerHTML =
      view.id !== null && data.loaded
        ? html`<a class="m-back" href="${"/admin/guests" + qs()}" data-up>${icon("back")}Guests</a>
            <div class="detail-empty">That guest isn't on the list any more.</div>`
        : html`<div class="detail-empty">${data.loaded ? "Pick a guest." : ""}</div>`
    return
  }
  pane.innerHTML = detailMarkup(/** @type {GlobalTypes.GuestWithInviteCount} */ (g))
  void showStory(g.id)
}

/** The thank-you line: what they gave, where their card is.
 *  @param {number} id */
async function showStory(id) {
  if (!stories.has(id)) {
    try {
      stories.set(id, /** @type {Types.GuestStory} */ (await api(`/api/admin/guests/${id}/story`)))
    } catch {
      stories.set(id, null)
    }
  }
  const story = stories.get(id)
  const el = document.getElementById("guest-story")
  if (!story || !el || view.id !== id) return
  const gift = story.gifts[0]
  const card = story.cards[0]
  if (!gift && !card) return
  /** @type {string[]} */
  const parts = []
  if (gift) parts.push(`Gift: ${gift.description || "logged"}`)
  if (card) {
    if (card.status === "draft") parts.push("Card: a draft")
    else {
      const bits = []
      if (card.sentAt) bits.push(`sent ${formatRelative(card.sentAt)}`)
      if (card.viewedAt) bits.push("opened")
      if (card.repliedAt) bits.push("they replied")
      parts.push(`Card: ${bits.length ? bits.join(", ") : card.status}`)
    }
  } else parts.push("No card yet")
  const href = card ? `/admin/thank-yous/cards/${card.id}` : "/admin/thank-yous/gifts"
  el.innerHTML = html`<h2>Thank-you</h2>
    <a class="cta-strip" href="${href}"
      ><span>${parts.join(" · ")}</span><span class="small">${card ? "Open the card" : "Gifts"} ›</span></a
    >`
  el.hidden = false
}

/** @param {Types.RouteContext} ctx */
function draw(ctx) {
  view.items = filtered(view.filter, view.q)
  if (data.loaded && view.id === null && !ctx.route.dialog && isWide() && view.items.length) {
    // Wide screens open on the first guest (a replace, never a dead entry).
    void navigate(guestPath(view.items[0].id) + qs(), { replace: true })
    return
  }
  renderSummary()
  renderChips()
  renderRows()
  renderDetail()
  // The list's tools open over this same filtered list.
  for (const [id, path] of TOOL_LINKS) getElement(id).setAttribute("href", path + qs())
  const g = view.id !== null ? guestById(view.id) : null
  setCrumbs(g ? [{ label: g.name }] : [])
}

// ----------------------------------------------------------- guest form

/** Fill the add / edit dialog. @param {number | null} id */
function prepareGuestForm(id) {
  const g = id !== null ? guestById(id) : null
  getFormElement("guest-form").reset()
  getElement("guest-form-error").hidden = true
  getInputElement("guest-id").value = g ? String(g.id) : ""
  getElement("guest-modal-title").textContent = g ? `Edit ${g.name}` : "Add a guest"
  getButtonElement("guest-form-submit").textContent = g ? "Save" : "Add guest"
  if (!g) return
  getInputElement("guest-name").value = g.name
  getInputElement("guest-email").value = g.email || ""
  getInputElement("guest-phone").value = g.phone || ""
  getSelectElement("guest-party-size").value = String(g.party_size)
  getTextAreaElement("guest-notes").value = g.notes || ""
}

/** @type {Types.handleGuestFormSubmit} */
async function handleGuestFormSubmit(e) {
  e.preventDefault()
  const submitBtn = getButtonElement("guest-form-submit")
  if (submitBtn.disabled) return
  submitBtn.disabled = true
  const errorEl = getElement("guest-form-error")
  errorEl.hidden = true

  const id = getInputElement("guest-id").value
  const body = {
    name: getInputElement("guest-name").value,
    email: getInputElement("guest-email").value || null,
    phone: getInputElement("guest-phone").value || null,
    party_size: parseInt(getSelectElement("guest-party-size").value, 10),
    notes: getTextAreaElement("guest-notes").value || null,
  }
  try {
    if (id) {
      await api(`/api/admin/guests/${id}`, { method: "PUT", body: JSON.stringify(body) })
      await loadGuests()
      closeModal(getDialogElement("guest-modal"))
      showSuccess(`Saved ${body.name}`)
    } else {
      const res = /** @type {{ guest: GlobalTypes.Guest }} */ (
        await api("/api/admin/guests", { method: "POST", body: JSON.stringify(body) })
      )
      await loadGuests()
      // The new guest's page replaces the dialog's entry: Back returns to
      // wherever "+ Add" was pressed.
      void navigate(guestPath(res.guest.id) + qs(), { replace: true })
      showSuccess(`Added ${res.guest.name}`)
    }
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    submitBtn.disabled = false
  }
}

// ------------------------------------------------- archive / restore / link

/** @param {number} id */
function confirmArchive(id) {
  const g = guestById(id)
  if (!g) return
  confirmId = id
  getElement("delete-modal-title").textContent = `Archive ${g.name}?`
  getElement("delete-rsvp-warning").hidden = !data.rsvps.has(id)
  getElement("delete-error").hidden = true
  openModal(getDialogElement("delete-modal"))
}

async function handleArchiveConfirm() {
  const btn = getButtonElement("confirm-delete-btn")
  const id = confirmId
  if (btn.disabled || id === null) return
  btn.disabled = true
  const errorEl = getElement("delete-error")
  errorEl.hidden = true
  const name = guestById(id)?.name ?? "Guest"
  // Advance to the next guest in the list (owner decision: instantly).
  const at = view.items.findIndex((g) => g.id === id)
  const next = view.items[at + 1] ?? view.items[at - 1] ?? null
  try {
    await api(`/api/admin/guests/${id}`, { method: "DELETE" })
    closeModal(getDialogElement("delete-modal"))
    await loadGuests()
    void navigate(next ? guestPath(next.id) + qs() : "/admin/guests" + qs(), { replace: true })
    showSuccess(`Archived ${name} — find them under Archived`)
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    confirmId = null
  }
}

/** @param {number} id */
function confirmRestore(id) {
  const g = guestById(id)
  if (!g) return
  confirmId = id
  getElement("restore-modal-title").textContent = `Restore ${g.name}?`
  getElement("restore-error").hidden = true
  openModal(getDialogElement("restore-modal"))
}

async function handleRestoreConfirm() {
  const btn = getButtonElement("confirm-restore-btn")
  const id = confirmId
  if (btn.disabled || id === null) return
  btn.disabled = true
  const errorEl = getElement("restore-error")
  errorEl.hidden = true
  try {
    await api(`/api/admin/guests/${id}/restore`, { method: "POST" })
    closeModal(getDialogElement("restore-modal"))
    data.archived = data.archived ? data.archived.filter((g) => g.id !== id) : null
    await loadGuests()
    // Back on the list: show them there.
    void navigate(guestPath(id), { replace: true })
    showSuccess("Restored to the guest list")
  } catch (err) {
    errorEl.textContent = getErrorMessage(err)
    errorEl.hidden = false
  } finally {
    btn.disabled = false
    confirmId = null
  }
}

/** @param {number} id @param {HTMLButtonElement} btn */
async function copyRsvpLink(id, btn) {
  const g = guestById(id)
  if (!g) return
  const url = `${location.origin}/rsvp?code=${encodeURIComponent(g.invite_code)}`
  try {
    await navigator.clipboard.writeText(url)
    btn.textContent = "Copied ✓"
    setTimeout(() => (btn.textContent = "Copy RSVP link"), 1500)
  } catch {
    showError(`Couldn't copy — the link is ${url}`)
  }
}

/** @param {MouseEvent} e */
function onDetailClick(e) {
  const t = e.target
  if (!(t instanceof Element)) return
  const btn = t.closest("[data-guest-action]")
  if (!(btn instanceof HTMLButtonElement) || view.id === null) return
  const action = btn.dataset.guestAction
  if (action === "archive") confirmArchive(view.id)
  else if (action === "restore") confirmRestore(view.id)
  else if (action === "copy-link") void copyRsvpLink(view.id, btn)
}

// ---------------------------------------------------------------- search

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    view.q = getInputElement("guest-search").value.trim()
    // A new search starts from its first match (a replace: typing is not
    // navigation).
    void navigate("/admin/guests" + qs(), { replace: true })
  }, 220)
}

// --------------------------------------------------------- the panel

/** Prepare the dialog a dialog route opens, once per arrival.
 *  @param {Types.RouteContext} ctx */
function prepareDialog(ctx) {
  const at = ctx.path.indexOf("?")
  const key = at === -1 ? ctx.path : ctx.path.slice(0, at)
  if (!ctx.route.dialog) {
    preparedDialog = ""
    return
  }
  if (key === preparedDialog) return
  preparedDialog = key
  const path = ctx.route.path
  if (path === "guests/new") prepareGuestForm(null)
  else if (path === "guests/:guest/edit") prepareGuestForm(view.id)
  else if (path === "guests/import") mountImport()
  else if (path === "guests/text") void mountManualSms()
  else if (path === "guests/invite") {
    void mountInvite({ kind: "bulk", filter: view.filter, q: view.q })
  }
  else if (path === "guests/invite/sent") void mountInvite({ kind: "sent" })
  else if (path === "guests/:guest/invite" && view.id !== null) {
    const g = guestById(view.id)
    void mountInvite({ kind: "one", id: view.id, name: g ? g.name : "this guest" })
  }
}

/** @param {Record<string, string>} params @param {URLSearchParams} query
 *  @param {Types.RouteContext} ctx */
async function mount(params, query, ctx) {
  view.filter = toFilter(query.get("rsvp"))
  view.q = query.get("q") ?? ""
  // A list-level dialog (Add, Import, Invite…) opens over the guest you were
  // looking at, so the page underneath doesn't change.
  const keep = ctx.route.dialog && !params.guest && ctx.samePanel ? view.id : null
  view.id = selId(params.guest) ?? keep
  const search = getInputElement("guest-search")
  if (document.activeElement !== search) search.value = view.q

  const stale = !data.loaded || !ctx.samePanel || (view.filter === "archived" && !data.archived)
  // The dialog opens straight after this returns: prepare it before any wait.
  if (data.loaded) prepareDialog(ctx)
  if (stale) {
    if (!data.loaded) {
      renderRows()
      renderDetail()
    }
    try {
      if (view.filter === "archived" && !data.archived) {
        data.archived = await fetchAllGuests("archived")
      }
      if (!data.loaded || !ctx.samePanel) await loadGuests()
    } catch (err) {
      console.error("Failed to load guests:", err)
      showLoadError(getElement("guests-rows"), 1, "Couldn't load the guest list.", () => {
        const c = currentPlace()
        if (c) void mount(c.params, c.query, c)
      })
      return
    }
    if (currentPlace() !== ctx) return
    prepareDialog(ctx)
  }
  draw(ctx)
}

/** j / k: the next / previous guest (a replace). @param {number} step */
function move(step) {
  const items = view.items
  if (items.length === 0) return
  const at = items.findIndex((g) => g.id === view.id)
  const next = items[Math.max(0, Math.min(items.length - 1, at === -1 ? 0 : at + step))]
  if (next && next.id !== view.id) {
    void navigate(guestPath(next.id) + qs(), { replace: view.id !== null })
  }
}

/** @type {Types.initGuests} */
export function initGuests() {
  getFormElement("guest-form").addEventListener("submit", handleGuestFormSubmit)
  getButtonElement("confirm-delete-btn").addEventListener("click", handleArchiveConfirm)
  getButtonElement("confirm-restore-btn").addEventListener("click", handleRestoreConfirm)
  getInputElement("guest-search").addEventListener("input", onSearchInput)
  getElement("guests-detail").addEventListener("click", onDetailClick)
  // The ⋯ menu closes once an item in it is chosen, or on a click elsewhere.
  const menu = getElement("guests-menu")
  menu.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest(".ws-menu-item")) {
      menu.removeAttribute("open")
    }
  })
  document.addEventListener("click", (e) => {
    if (e.target instanceof Node && !menu.contains(e.target)) menu.removeAttribute("open")
  })

  registerPanel("guests", {
    mount,
    unmount() {
      preparedDialog = ""
      getElement("guests-menu").removeAttribute("open")
    },
    keys(e, ctx) {
      if (e.key === "j") move(1)
      else if (e.key === "k") move(-1)
      else if (e.key === "/") getInputElement("guest-search").focus()
      else if (e.key === "e" && view.id !== null && !ctx.route.dialog) {
        const g = guestById(view.id)
        if (!g || g.deleted_at) return false
        void navigate(guestPath(view.id) + "/edit" + qs())
      } else return false
      return true
    },
    help: {
      title: "Guests & RSVPs",
      keys: [
        ["j k", "Next / previous guest"],
        ["/", "Search"],
        ["e", "Edit the guest"],
      ],
    },
  })
}
