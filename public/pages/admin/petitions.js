/** @file Requests | Blocked — one split view (prototypes/admin-workspace
 *  views/misc.js, IA §4, §10). Invitation requests on the left, the selected
 *  one on the right with Approve & invite / Deny / Deny & block; acting
 *  advances to the next waiting request (a replace). The blocklist only
 *  exists to filter requests, so it is this section's second tab
 *  (/admin/requests/blocked, drawn by blocklist.js).
 *
 *  Routes: /admin/requests(?status=approved|denied|all) · /admin/requests/p3
 *  (sel) · /admin/requests/blocked · /admin/requests/blocked/b5 (sel) ·
 *  dialog route /admin/requests/blocked/new. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */

import { api, openModal, closeModal, showSuccess, showLoadError } from "./utils.js"
import { loadGuests, rosterGuests } from "./guests.js"
import {
  loadBlocklist,
  blockedListMarkup,
  blockedDetailMarkup,
  blockedItems,
  prepareBlockForm,
  confirmUnblock,
} from "./blocklist.js"
import { registerPanel, navigate, setCrumbs, setNavBadge, currentPlace } from "./router.js"
import { icon } from "./icons.js"
import {
  html,
  formatDate,
  getElement,
  getSelectElement,
  getInputElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"
import { shortAgo } from "./thank-you-util.js"
import { renderMonogram } from "../../components/monogram.js"

/** @type {readonly [Types.PetitionFilter, string][]} */
const CHIPS = [
  ["pending", "Waiting"],
  ["approved", "Approved"],
  ["denied", "Denied"],
  ["all", "All"],
]

/** @type {Types.RequestsView} */
const view = { blocked: false, filter: "pending", id: null, items: [] }

/** Every request (filtered here), and whether they have loaded. */
/** @type {GlobalTypes.Petition[]} */
let petitions = []
let loaded = false

/** @type {Types.updatePetitionBadge} */
export function updatePetitionBadge(count) {
  setNavBadge("petitions", count)
  const n = document.getElementById("requests-seg-n")
  if (n) n.textContent = count > 0 ? String(count) : ""
}

/** @type {Types.loadPetitions} */
export async function loadPetitions() {
  const res = /** @type {Types.PetitionsWithCountsResponse} */ (await api("/api/admin/petitions"))
  petitions = res.petitions
  loaded = true
  updatePetitionBadge(res.counts.pending)
}

/** @type {Types.loadPetitionCount} */
export async function loadPetitionCount() {
  try {
    const counts = /** @type {Types.PetitionCounts} */ (await api("/api/admin/petitions/counts"))
    updatePetitionBadge(counts.pending)
  } catch {
    // Non-critical: the badge just stays as it was.
  }
}

// ---------------------------------------------------------------- helpers

/** @param {string | null} v @returns {Types.PetitionFilter} */
function toFilter(v) {
  return v === "approved" || v === "denied" || v === "all" ? v : "pending"
}

/** "p3" → 3, "b5" → 5. @param {string | undefined} sel @param {string} prefix */
function selId(sel, prefix) {
  if (!sel || !sel.startsWith(prefix)) return null
  const n = Number(sel.slice(prefix.length))
  return Number.isInteger(n) && n > 0 ? n : null
}

function qs() {
  return view.filter === "pending" ? "" : `?status=${view.filter}`
}

/** @param {number} id */
const requestPath = (id) => `/admin/requests/p${id}`

const isWide = () => window.matchMedia("(min-width: 900px)").matches

/** @param {Types.PetitionFilter} f */
function requestItems(f) {
  return petitions
    .filter((p) => f === "all" || p.status === f)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
}

/** @param {number} id */
function petitionById(id) {
  return petitions.find((p) => p.id === id) ?? null
}

/** Lowercased words of a name, without the little ones. @param {string} s */
function words(s) {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.split("").filter((c) => c.toLowerCase() !== c.toUpperCase()).join(""))
    .filter((w) => w.length >= 3)
}

/** Guests this request might be about: same email or phone, a shared surname,
 *  or a first name they mention ("I'm Callum's partner").
 *  @param {GlobalTypes.Petition} p @returns {GlobalTypes.Guest[]} */
function possibleMatches(p) {
  const roster = rosterGuests()
  const email = p.email.trim().toLowerCase()
  const digits = (/** @type {string} */ s) => [...s].filter((c) => c >= "0" && c <= "9").join("")
  const phone = p.phone ? digits(p.phone).slice(-10) : ""
  const theirs = words(p.name)
  const surname = theirs.length > 1 ? theirs[theirs.length - 1] : ""
  const said = new Set(
    words(`${p.message ?? ""} ${p.relationship ?? ""}`).map((w) =>
      w.endsWith("s") ? w.slice(0, -1) : w,
    ),
  )
  /** @type {GlobalTypes.Guest[]} */
  const exact = []
  /** @type {GlobalTypes.Guest[]} */
  const near = []
  for (const g of roster) {
    const sameEmail = !!g.email && g.email.toLowerCase() === email
    const samePhone = !!phone && !!g.phone && digits(g.phone).endsWith(phone)
    if (sameEmail || samePhone) {
      exact.push(g)
      continue
    }
    const gw = words(g.name)
    if ((surname && gw.includes(surname)) || (gw[0] && said.has(gw[0]))) near.push(g)
  }
  return [...exact, ...near].slice(0, 3)
}

// ----------------------------------------------------------------- render

function seg() {
  const pending = petitions.filter((p) => p.status === "pending").length
  return html`<nav class="seg" aria-label="Requests">
    <a href="/admin/requests" aria-current="${view.blocked ? "false" : "page"}"
      >Requests <span class="seg-n" id="requests-seg-n">${pending > 0 ? pending : ""}</span></a
    ><a href="/admin/requests/blocked" aria-current="${view.blocked ? "page" : "false"}">Blocked</a>
  </nav>`
}

/** @param {GlobalTypes.Petition} p */
function rowMarkup(p) {
  const sub = p.message ? `“${p.message}”` : p.relationship || p.email
  return html`<li>
    <a class="row" href="${requestPath(p.id) + qs()}" data-select
      aria-current="${p.id === view.id ? "true" : "false"}">
      <span class="avatar">${renderMonogram(p.name)}</span>
      <span class="row-main">
        <span class="row-top"
          ><strong>${p.name}</strong>${p.status === "pending"
            ? html`<span class="row-time">${shortAgo(p.created_at)}</span>`
            : html`<span class="pill ${p.status === "approved" ? "st-opened" : "st-none"}"
                >${p.status === "approved" ? "Approved" : "Denied"}</span
              >`}</span
        >
        <span class="row-sub">${sub}</span>
      </span>
    </a>
  </li>`
}

function renderList() {
  const pane = getElement("requests-list")
  if (view.blocked) {
    pane.innerHTML = html`<header class="pane-head">
        <h1>Requests</h1>
        ${seg()}
      </header>
      ${blockedListMarkup(view.id)}
      <footer class="pane-foot"><kbd>j</kbd> <kbd>k</kbd> move</footer>`
  } else {
    const empty =
      view.filter === "pending"
        ? "No requests waiting."
        : view.filter === "all"
          ? "No invitation requests yet."
          : `Nothing ${view.filter}.`
    pane.innerHTML = html`<header class="pane-head">
        <h1>Requests</h1>
        ${seg()}
        <div class="chips" role="group" aria-label="Show">
          ${CHIPS.map(
            ([key, label]) =>
              html`<a class="chip" data-replace
                href="${key === "pending" ? "/admin/requests" : `/admin/requests?status=${key}`}"
                aria-current="${view.filter === key ? "true" : "false"}">${label}</a
              >`,
          )}
        </div>
      </header>
      ${view.items.length
        ? html`<ul class="rows">
            ${requestItems(view.filter).map(rowMarkup)}
          </ul>`
        : html`<p class="list-empty">${empty}</p>`}
      <footer class="pane-foot">
        <kbd>j</kbd> <kbd>k</kbd> move · <kbd>a</kbd> approve · <kbd>d</kbd> deny
      </footer>`
  }
  const sel = pane.querySelector('[aria-current="true"].row')
  if (sel instanceof HTMLElement) sel.scrollIntoView({ block: "nearest" })
}

/** @param {GlobalTypes.Petition} p */
function detailMarkup(p) {
  const matches = possibleMatches(p)
  const pending = p.status === "pending"
  return html`<a class="m-back" href="${"/admin/requests" + qs()}" data-up>${icon("back")}Requests</a>
    <article class="detail request-detail">
      <header class="detail-head">
        <span class="eyebrow">Invitation request · ${shortAgo(p.created_at)}</span>
      </header>
      <h1>${p.name}</h1>
      ${p.message
        ? html`<blockquote class="msg-big">${p.message}</blockquote>`
        : html`<p class="muted">They didn't leave a message.</p>`}
      ${matches.length
        ? html`<p class="muted request-match">
            Possible match on the guest list:
            ${matches.map(
              (g, i) => html`${i ? ", " : ""}<a href="/admin/guests/g${g.id}">${g.name}</a>`,
            )}
          </p>`
        : ""}
      <dl class="facts">
        <div><dt>How they know you</dt><dd>${p.relationship || "—"}</dd></div>
        <div><dt>Email</dt><dd class="fact-break">${p.email}</dd></div>
        <div><dt>Phone</dt><dd>${p.phone || "—"}</dd></div>
        <div><dt>Asked</dt><dd>${formatDate(p.created_at)}</dd></div>
      </dl>
      ${pending
        ? ""
        : html`<p class="status-note ${p.status === "approved" ? "is-ok" : ""}">
            ${p.status === "approved" ? "Approved" : "Denied"}${p.reviewed_at
              ? ` ${formatDate(p.reviewed_at)}`
              : ""}${p.admin_notes ? ` — ${p.admin_notes}` : ""}
          </p>`}
    </article>
    ${pending
      ? html`<div class="actionbar">
          <button type="button" class="btn btn-primary btn-lg" data-req-action="approve">
            Approve &amp; invite <kbd>a</kbd>
          </button>
          <button type="button" class="btn btn-lg" data-req-action="deny">Deny <kbd>d</kbd></button>
          <button type="button" class="btn btn-lg btn-danger-soft" data-req-action="block">
            Deny &amp; block <kbd>b</kbd>
          </button>
        </div>`
      : ""}`
}

function doneMarkup() {
  return html`<div class="done-state">
    <span class="done-icon">${icon("check")}</span>
    <h2>No requests waiting</h2>
    <p class="muted">When someone asks for an invitation from the RSVP page, it shows up here.</p>
    <a class="btn" href="/admin/guests">Go to Guests &amp; RSVPs</a>
  </div>`
}

function renderDetail() {
  const pane = getElement("requests-detail")
  getElement("requests-split").classList.toggle("has-sel", view.id !== null)
  if (view.blocked) {
    pane.innerHTML = blockedDetailMarkup(view.id)
    return
  }
  const p = view.id !== null ? petitionById(view.id) : null
  if (p) pane.innerHTML = detailMarkup(p)
  else if (view.id !== null) {
    pane.innerHTML = html`<a class="m-back" href="/admin/requests" data-up>${icon("back")}Requests</a>
      <div class="detail-empty">That request isn't here any more.</div>`
  } else if (view.filter === "pending" && view.items.length === 0) pane.innerHTML = doneMarkup()
  else pane.innerHTML = html`<div class="detail-empty">Pick a request.</div>`
}

/** @param {Types.RouteContext} ctx */
function draw(ctx) {
  view.items = view.blocked ? blockedItems() : requestItems(view.filter)
  if (view.id === null && !ctx.route.dialog && isWide() && view.items.length) {
    const first = view.items[0].id
    const to = view.blocked ? `/admin/requests/blocked/b${first}` : requestPath(first) + qs()
    void navigate(to, { replace: true })
    return
  }
  renderList()
  renderDetail()
  if (view.blocked) {
    const entry = blockedItems().find((b) => b.id === view.id)
    const name = entry ? entry.name || entry.email || entry.phone || "Blocked" : ""
    setCrumbs(
      entry
        ? [{ label: "Blocked", href: "/admin/requests/blocked" }, { label: name }]
        : [{ label: "Blocked" }],
    )
  } else {
    const p = view.id !== null ? petitionById(view.id) : null
    setCrumbs(p ? [{ label: p.name }] : [])
  }
}

// ---------------------------------------------------------------- actions

/** Where to go once the selected request is decided: the next waiting one. */
function nextAfter() {
  const at = view.items.findIndex((p) => p.id === view.id)
  const rest = view.items.filter((p, i) => i !== at && "status" in p && p.status === "pending")
  const after = rest.find((_, i) => i >= at) ?? rest[0]
  return after ? requestPath(after.id) + qs() : "/admin/requests" + qs()
}

/** @type {Types.openApprovePetition} */
export function openApprovePetition(id) {
  const p = petitionById(id)
  getInputElement("approve-petition-id").value = String(id)
  getElement("petition-approve-modal-title").textContent = p ? `Approve ${p.name}?` : "Approve?"
  getSelectElement("approve-party-size").value = "2"
  getInputElement("approve-send-invite").checked = true
  getTextAreaElement("approve-notes").value = ""
  getElement("approve-error").hidden = true
  openModal(getDialogElement("petition-approve-modal"))
}

/** @type {Types.openDenyPetition} */
export function openDenyPetition(id, block = false) {
  const p = petitionById(id)
  getInputElement("deny-petition-id").value = String(id)
  getElement("petition-deny-modal-title").textContent = p
    ? `${block ? "Deny and block" : "Deny"} ${p.name}?`
    : "Deny this request?"
  getInputElement("deny-add-blocklist").checked = block
  getTextAreaElement("deny-notes").value = ""
  getElement("deny-error").hidden = true
  openModal(getDialogElement("petition-deny-modal"))
}

/** @type {Types.handleApproveConfirm} */
async function handleApproveConfirm() {
  const id = Number(getInputElement("approve-petition-id").value)
  const sendInvite = getInputElement("approve-send-invite").checked
  const btn = getButtonElement("confirm-approve-btn")
  if (btn.disabled) return
  btn.disabled = true
  btn.textContent = "Approving…"
  const name = petitionById(id)?.name ?? "them"
  const next = nextAfter()
  try {
    const res = /** @type {{ inviteSent?: boolean, guest?: GlobalTypes.Guest }} */ (
      await api(`/api/admin/petitions/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          party_size: parseInt(getSelectElement("approve-party-size").value, 10),
          send_invite: sendInvite,
          admin_notes: getTextAreaElement("approve-notes").value || null,
        }),
      })
    )
    closeModal(getDialogElement("petition-approve-modal"))
    await Promise.all([loadPetitions(), loadGuests()])
    void navigate(next, { replace: true })
    showSuccess(
      res.inviteSent
        ? `Approved — invite sent to ${name}`
        : sendInvite
          ? `Approved — ${name} is on the guest list, ` +
            "but the invite didn't go (email isn't set up)"
          : `Approved — ${name} is on the guest list`,
    )
  } catch (err) {
    const el = getElement("approve-error")
    el.textContent = getErrorMessage(err)
    el.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = "Approve & invite"
  }
}

/** @type {Types.handleDenyConfirm} */
async function handleDenyConfirm() {
  const id = Number(getInputElement("deny-petition-id").value)
  const block = getInputElement("deny-add-blocklist").checked
  const btn = getButtonElement("confirm-deny-btn")
  if (btn.disabled) return
  btn.disabled = true
  btn.textContent = "Denying…"
  const name = petitionById(id)?.name ?? "the request"
  const next = nextAfter()
  try {
    await api(`/api/admin/petitions/${id}/deny`, {
      method: "POST",
      body: JSON.stringify({
        add_to_blocklist: block,
        admin_notes: getTextAreaElement("deny-notes").value || null,
      }),
    })
    closeModal(getDialogElement("petition-deny-modal"))
    await Promise.all([loadPetitions(), block ? loadBlocklist() : Promise.resolve()])
    void navigate(next, { replace: true })
    showSuccess(block ? `Denied and blocked ${name}` : `Denied ${name}`)
  } catch (err) {
    const el = getElement("deny-error")
    el.textContent = getErrorMessage(err)
    el.hidden = false
  } finally {
    btn.disabled = false
    btn.textContent = "Deny"
  }
}

/** @param {string} action */
function act(action) {
  if (view.blocked || view.id === null) return false
  const p = petitionById(view.id)
  if (!p || p.status !== "pending") return false
  if (action === "approve") openApprovePetition(p.id)
  else if (action === "deny") openDenyPetition(p.id, false)
  else if (action === "block") openDenyPetition(p.id, true)
  else return false
  return true
}

/** @param {MouseEvent} e */
function onDetailClick(e) {
  const t = e.target
  if (!(t instanceof Element)) return
  const req = t.closest("[data-req-action]")
  if (req instanceof HTMLElement) {
    act(req.dataset.reqAction ?? "")
    return
  }
  const unblock = t.closest("[data-block-action]")
  if (unblock instanceof HTMLElement && view.id !== null) {
    confirmUnblock(view.id, () => {
      const at = view.items.findIndex((b) => b.id === view.id)
      const next = view.items[at + 1] ?? view.items[at - 1]
      return next && next.id !== view.id
        ? `/admin/requests/blocked/b${next.id}`
        : "/admin/requests/blocked"
    })
  }
}

// ------------------------------------------------------------------ panel

let preparedDialog = ""

/** @param {Record<string, string>} params @param {URLSearchParams} query
 *  @param {Types.RouteContext} ctx */
async function mount(params, query, ctx) {
  view.blocked = ctx.route.path.startsWith("requests/blocked")
  view.filter = toFilter(query.get("status"))
  view.id = view.blocked ? selId(params.entry, "b") : selId(params.req, "p")
  if (ctx.route.dialog && preparedDialog !== ctx.route.path) prepareBlockForm()
  preparedDialog = ctx.route.dialog ? ctx.route.path : ""
  if (!loaded || !ctx.samePanel) {
    if (!loaded) {
      getElement("requests-list").innerHTML = html`<p class="list-empty">Loading…</p>`
      getElement("requests-detail").innerHTML = ""
    }
    try {
      await Promise.all([
        loadPetitions(),
        loadBlocklist(),
        rosterGuests().length ? Promise.resolve() : loadGuests(),
      ])
    } catch (err) {
      console.error("Failed to load requests:", err)
      showLoadError(getElement("requests-list"), 1, "Couldn't load the requests.", () => {
        const c = currentPlace()
        if (c) void mount(c.params, c.query, c)
      })
      return
    }
    if (currentPlace() !== ctx) return
  }
  draw(ctx)
}

/** @param {number} step */
function move(step) {
  const items = view.items
  if (!items.length) return
  const at = items.findIndex((p) => p.id === view.id)
  const next = items[Math.max(0, Math.min(items.length - 1, at === -1 ? 0 : at + step))]
  if (!next || next.id === view.id) return
  const to = view.blocked ? `/admin/requests/blocked/b${next.id}` : requestPath(next.id) + qs()
  void navigate(to, { replace: view.id !== null })
}

/** @type {Types.initPetitions} */
export function initPetitions() {
  getButtonElement("confirm-approve-btn").addEventListener("click", handleApproveConfirm)
  getButtonElement("confirm-deny-btn").addEventListener("click", handleDenyConfirm)
  getElement("requests-detail").addEventListener("click", onDetailClick)
  registerPanel("petitions", {
    mount,
    unmount() {
      preparedDialog = ""
    },
    keys(e) {
      if (e.key === "j") move(1)
      else if (e.key === "k") move(-1)
      else if (e.key === "a") return act("approve")
      else if (e.key === "d") return act("deny")
      else if (e.key === "b") return act("block")
      else return false
      return true
    },
    help: {
      title: "Requests",
      keys: [
        ["j k", "Next / previous"],
        ["a", "Approve & invite"],
        ["d", "Deny"],
        ["b", "Deny & block"],
      ],
    },
  })
}
