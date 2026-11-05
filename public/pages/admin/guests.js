/** @file Guests — one split view (prototypes/admin-workspace views/misc.js,
 *  IA §2, §4, §10). An RSVP is a fact about a guest, so it is a filter in the
 *  list (`?rsvp=yes|no|awaiting|archived`), a line in every row and a block in
 *  the detail — not a tab. Search is `?q=`. Both survive reload.
 *
 *  The people who signed in to the website live here too (owner decision: the
 *  separate Accounts list was the same people twice). Each invitation row
 *  lists who signed in with its code, with Trust / Untrust right there; anyone
 *  who signed up without an invitation is a row of their own, marked so, and
 *  `?rsvp=uninvited` shows just them. Search finds either name. Trust is the
 *  same /api/admin/accounts/:id/trust|untrust Review uses.
 *
 *  Routes: /admin/guests · /admin/guests/g12 (an invitation) · /admin/guests/a7
 *  (a person: lands on their invitation's page when they have one; the old
 *  /admin/accounts/a7 redirects here) · dialog routes /admin/guests/new,
 *  /admin/guests/g12/edit, /admin/guests/import, /admin/guests/invite(/sent),
 *  /admin/guests/g12/invite, /admin/guests/text. The roster is small (a
 *  wedding), so it is loaded whole and filtered here. */
/** @import * as Types from './types.js' */
/** @import * as GlobalTypes from '../../../types.js' */

import { mountInvite } from "./invites.js"
import { mountImport } from "./csv-import.js"
import { mountManualSms } from "./manual-sms.js"
import {
  api,
  showError,
  showSuccess,
  showUndo,
  showLoadError,
  openModal,
  closeModal,
} from "./utils.js"
import { registerPanel, navigate, setCrumbs, currentPlace } from "./router.js"
import { icon } from "./icons.js"
import { openConfirm } from "./confirm.js"
import {
  accountsByGuest,
  entryPath,
  parseRosterSel,
  rosterEntries,
  uninvitedCount,
} from "./guest-accounts.js"
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
  ["uninvited", "No invitation"],
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
  accounts: [],
  accountsFailed: false,
  stats: null,
  loaded: false,
}

/** What the list is showing (from the URL). */
/** @type {Types.GuestsView} */
const view = { filter: "all", q: "", id: null, person: null, focus: null, items: [] }

/** @type {Promise<void> | null} */
let loading = null
/** The dialog route path last prepared, so a remount doesn't reset it. */
let preparedDialog = ""
/** @type {ReturnType<typeof setTimeout> | undefined} */
let searchTimer
/** Thank-you stories already fetched, by guest id. */
const stories = /** @type {Map<number, Types.GuestStory | null>} */ (new Map())
/** The next arrival keeps `view.focus` (it is the one draw() redirected to). */
let focusArmed = false
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

/** Everyone who has signed in to the website, every page. */
async function fetchAllAccounts() {
  /** @type {Types.AccountRow[]} */
  const all = []
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
    const res = /** @type {Types.AccountsResponse} */ (await api(`/api/admin/accounts?${params}`))
    all.push(...res.accounts)
    if (res.accounts.length < PAGE || all.length >= res.total) break
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
      const [guests, rsvps, accounts] = await Promise.all([
        fetchAllGuests(""),
        /** @type {Promise<Types.RSVPsResponse>} */ (api("/api/admin/rsvps")),
        // Who signed in is a part of the page, not the page: the roster still
        // shows if it fails.
        fetchAllAccounts().catch((err) => {
          console.error("Failed to load who signed in:", err)
          return null
        }),
        loadStats(),
      ])
      data.guests = guests
      data.rsvps = new Map(rsvps.rsvps.map((r) => [r.guest_id, r]))
      data.accounts = accounts ?? []
      data.accountsFailed = accounts === null
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
  return v === "yes" || v === "no" || v === "awaiting" || v === "archived" || v === "uninvited"
    ? v
    : "all"
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

/** @param {Types.GuestFilter} f @param {string} q */
function filtered(f, q) {
  return rosterEntries({
    guests: data.guests,
    archived: data.archived,
    accounts: data.accounts,
    filter: f,
    q,
    rsvpOf,
  })
}

/** @param {number} id */
function accountById(id) {
  return data.accounts.find((a) => a.id === id) ?? null
}

/** The people who signed in with this guest's code. @param {number} guestId */
function accountsOf(guestId) {
  return accountsByGuest(data.accounts).get(guestId) ?? []
}

/** Is this row the one the detail shows? @param {Types.RosterEntry} e */
function isSelected(e) {
  return e.kind === "guest" ? e.guest.id === view.id : e.account.id === view.person
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
  const counts = {
    all: data.guests.length,
    yes: 0,
    no: 0,
    awaiting: 0,
    archived: null,
    uninvited: uninvitedCount(data.accounts),
  }
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

/** "Trusted" / "Not trusted", as a pill. @param {Types.AccountRow} a */
function trustPill(a) {
  return a.trusted
    ? html`<span class="pill st-opened">Trusted</span>`
    : html`<span class="pill st-none">Not trusted</span>`
}

/** "seen 3 days ago", while a sign-in is still live. @param {Types.AccountRow} a */
function seenWords(a) {
  return a.last_seen_at ? `seen ${formatRelative(a.last_seen_at)}` : ""
}

/** The one Trust / Untrust button, the same wherever it is drawn.
 *  @param {Types.AccountRow} a */
function trustButton(a) {
  return a.trusted
    ? html`<button type="button" class="btn btn-sm trust-btn" data-account-action="untrust"
        data-account-id="${a.id}" aria-label="Untrust ${a.name}"
        title="Their new posts wait for review again">Untrust</button>`
    : html`<button type="button" class="btn btn-sm trust-btn" data-account-action="trust"
        data-account-id="${a.id}" aria-label="Trust ${a.name}"
        title="Their new posts go live without review">Trust</button>`
}

/** One person who signed in with an invitation, under its row.
 *  @param {Types.AccountRow} a */
function personLineMarkup(a) {
  const seen = seenWords(a)
  return html`<li class="row-person ${a.id === view.focus ? "is-focus" : ""}">
    <span class="row-person-main">
      <span class="row-person-name">${a.name}</span>
      ${trustPill(a)}${seen ? html`<span class="row-person-seen">${seen}</span>` : ""}
    </span>
    ${trustButton(a)}
  </li>`
}

/** @param {Types.RosterEntry} e */
function rowMarkup(e) {
  if (e.kind === "person") return personRowMarkup(e)
  const g = e.guest
  const r = data.rsvps.get(g.id)
  const seats = r && r.attending ? (r.actual_party_size ?? g.party_size) : g.party_size
  const contact = g.email || g.phone || ""
  return html`<li class="roster-item">
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
    ${e.accounts.length
      ? html`<ul class="row-people" aria-label="Signed in to the website with ${g.name}'s invitation">
          ${e.accounts.map(personLineMarkup)}
        </ul>`
      : ""}
  </li>`
}

/** Someone with no invitation on the list: a row of their own, marked so.
 *  @param {Extract<Types.RosterEntry, { kind: "person" }>} e */
function personRowMarkup(e) {
  const a = e.account
  const seen = seenWords(a)
  return html`<li class="roster-item">
    <div class="row-wrap">
      <a class="row" href="${entryPath(e) + qs()}" data-select
        aria-current="${a.id === view.person ? "true" : "false"}">
        <span class="avatar">${renderMonogram(a.name)}</span>
        <span class="row-main">
          <span class="row-top"><strong>${a.name}</strong>${trustPill(a)}</span>
          <span class="row-sub"><span class="no-invite"
              title="${e.archivedInvite
                ? "Signed in with an invitation that's archived"
                : "Signed up on the website without an invitation"}"
              >${e.archivedInvite ? "Invitation archived" : "Signed up, no invitation"}</span
            >${seen ? ` · ${seen}` : ""}</span>
        </span>
      </a>
      ${trustButton(a)}
    </div>
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
          ${view.q
            ? `Nobody matches “${view.q}”`
            : view.filter === "uninvited"
              ? "Nobody has signed up without an invitation"
              : "Nobody here"}${view.filter !== "all"
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
      ${siteBlock(g)}
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

/** "On the website": who signed in with this invitation, each with what the
 *  old Accounts page offered. @param {GlobalTypes.Guest} g */
function siteBlock(g) {
  const own = accountsOf(g.id)
  const body = data.accountsFailed
    ? html`<p class="muted small">Couldn't load who has signed in. Reload the page to try again.</p>`
    : own.length === 0
      ? html`<p class="muted small">Nobody has signed in to the website with this invitation yet.</p>`
      : html`<ul class="site-people">${own.map((a) => siteCardMarkup(a, true))}</ul>`
  return html`<section class="detail-block" aria-label="Signed in to the website">
    <h2>On the website</h2>
    ${body}
  </section>`
}

/** One person who signed in: trust, what they posted, how to remove them.
 *  @param {Types.AccountRow} a @param {boolean} named draw their name (a
 *  household's page lists several; a person's own page has it as its title) */
function siteCardMarkup(a, named) {
  const facts = [
    a.relation ?? "",
    `joined ${formatDate(a.created_at)}`,
    seenWords(a),
    a.post_count ? plural(a.post_count, "post") : "no posts yet",
    a.pending_count ? `${a.pending_count} waiting for review` : "",
  ].filter((p) => p !== "")
  const seePosts = `/admin/review?author=a${a.id}${a.pending_count ? "" : "&status=approved"}`
  return html`<li class="site-person ${a.id === view.focus ? "is-focus" : ""}"
    data-site-person="${a.id}">
    <div class="site-person-top">${named ? html`<strong>${a.name}</strong>` : ""}${trustPill(a)}</div>
    <p class="muted small">${facts.join(" · ")}</p>
    <p class="small">
      ${a.trusted
        ? "Their new posts go live without review. Untrusting them leaves what's already live alone."
        : "Their posts wait for you in Review. Trusting them applies to new posts; what's waiting stays until you decide it."}
    </p>
    ${a.contact_email
      ? html`<p class="muted small fact-break">Recovery email: ${a.contact_email}</p>`
      : ""}
    <div class="btn-row">
      ${trustButton(a)}
      ${a.post_count
        ? html`<a class="btn btn-sm" href="${seePosts}"
            >${a.pending_count ? `Review their ${a.pending_count} waiting` : "See their posts"}</a
          >`
        : ""}
      <button type="button" class="btn btn-sm btn-danger-soft" data-account-action="remove"
        data-account-id="${a.id}">Remove from the website…</button>
    </div>
  </li>`
}

/** A person with no invitation on the list: their own page.
 *  @param {Types.AccountRow} a */
function personDetailMarkup(a) {
  const back = html`<a class="m-back" href="${"/admin/guests" + qs()}" data-up
    >${icon("back")}Guests</a
  >`
  const archivedInvite = a.guest_id !== null
  return html`${back}
    <article class="detail guest-detail">
      <header class="person-head">
        <span class="avatar avatar-xl">${renderMonogram(a.name)}</span>
        <div>
          <h1>${a.name}</h1>
          <p class="muted">
            ${archivedInvite ? "Signed in with an invitation that's archived" : "Signed up without an invitation"}
          </p>
        </div>
      </header>
      <p class="muted small person-note">
        ${archivedInvite
          ? html`They used ${a.source}'s invite code.
              <a href="${guestPath(/** @type {number} */ (a.guest_id))}?rsvp=archived">See the archived invitation</a>`
          : "They signed up on the website without an invite code, so they aren't on the guest list. They can still post."}
      </p>
      <section class="detail-block" aria-label="On the website">
        <h2>On the website</h2>
        <ul class="site-people">${siteCardMarkup(a, false)}</ul>
      </section>
    </article>`
}

function renderDetail() {
  const pane = getElement("guests-detail")
  const g = view.id !== null ? guestById(view.id) : null
  const p = view.person !== null ? accountById(view.person) : null
  getElement("guests-split").classList.toggle("has-sel", view.id !== null || view.person !== null)
  if (p && !g) {
    pane.innerHTML = personDetailMarkup(p)
    return
  }
  if (!g) {
    pane.innerHTML =
      (view.id !== null || view.person !== null) && data.loaded
        ? html`<a class="m-back" href="${"/admin/guests" + qs()}" data-up>${icon("back")}Guests</a>
            <div class="detail-empty">
              ${view.id !== null
                ? "That guest isn't on the list any more."
                : "That person isn't on the website any more."}
            </div>`
        : html`<div class="detail-empty">${data.loaded ? "Pick a guest." : ""}</div>`
    return
  }
  pane.innerHTML = detailMarkup(/** @type {GlobalTypes.GuestWithInviteCount} */ (g))
  // Arrived by a person (`a7`, an old Accounts link): point at them.
  const focus = pane.querySelector(".site-person.is-focus")
  if (focus instanceof HTMLElement) focus.scrollIntoView({ block: "nearest" })
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
  // `a7` (a row, or an old /admin/accounts/a7 link): someone whose invitation
  // is on the list lands on its page, pointed at; anyone else has their own.
  if (view.person !== null && data.loaded && !ctx.route.dialog) {
    const a = accountById(view.person)
    const home = a && a.guest_id !== null ? data.guests.find((g) => g.id === a.guest_id) : null
    if (a && home) {
      view.focus = a.id
      focusArmed = true
      void navigate(guestPath(home.id) + qs(), { replace: true })
      return
    }
  }
  view.items = filtered(view.filter, view.q)
  const none = view.id === null && view.person === null
  if (data.loaded && none && !ctx.route.dialog && isWide() && view.items.length) {
    // Wide screens open on the first guest (a replace, never a dead entry).
    void navigate(entryPath(view.items[0]) + qs(), { replace: true })
    return
  }
  renderSummary()
  renderChips()
  renderRows()
  renderDetail()
  // The list's tools open over this same filtered list.
  for (const [id, path] of TOOL_LINKS) getElement(id).setAttribute("href", path + qs())
  const g = view.id !== null ? guestById(view.id) : null
  const p = view.person !== null ? accountById(view.person) : null
  setCrumbs(g ? [{ label: g.name }] : p ? [{ label: p.name }] : [])
}

// ----------------------------------------------------- trust / untrust

/** Trust or untrust from the list or a guest's page: the same endpoints and
 *  the same rule as Review's author card (new posts only; what's waiting
 *  stays waiting), with one Undo.
 *  @param {number} id @param {boolean} trusted @param {boolean} [quiet] an Undo */
async function setTrust(id, trusted, quiet = false) {
  const a = accountById(id)
  if (!a) return
  try {
    if (trusted) {
      await api(`/api/admin/accounts/${id}/trust`, {
        method: "POST",
        body: JSON.stringify({ approve_pending: false }),
      })
    } else {
      await api(`/api/admin/accounts/${id}/untrust`, { method: "POST" })
    }
  } catch (err) {
    showError(getErrorMessage(err))
    return
  }
  a.trusted = trusted
  redrawKeepingFocus(id)
  if (quiet) showSuccess("Undone")
  else if (trusted) {
    showUndo(`Trusted ${a.name} · their new posts go live without review`, () =>
      void setTrust(id, false, true),
    )
  } else {
    showUndo(`${a.name} isn't trusted any more · their new posts wait for review`, () =>
      void setTrust(id, true, true),
    )
  }
}

/** Redraw the list and the page in place; the button that was pressed is
 *  redrawn too, so keyboard focus moves to its replacement.
 *  @param {number} id */
function redrawKeepingFocus(id) {
  const active = document.activeElement
  const where =
    active instanceof HTMLElement && active.dataset.accountId === String(id)
      ? active.closest("#guests-rows, #guests-detail")?.id ?? ""
      : ""
  const ctx = currentPlace()
  if (!ctx || ctx.route.tab !== "guests") return
  view.items = filtered(view.filter, view.q)
  renderChips()
  renderRows()
  renderDetail()
  if (!where) return
  const again = document.querySelector(`#${where} [data-account-id="${id}"].trust-btn`)
  if (again instanceof HTMLElement) again.focus()
}

/** "Remove from the website…": the old Accounts page's delete. The invitation
 *  (if any) and its RSVP stay. @param {number} id */
function confirmRemove(id) {
  const a = accountById(id)
  if (!a) return
  openConfirm({
    title: `Remove ${a.name} from the website?`,
    desc:
      "Their approved posts come off the site and they're signed out everywhere." +
      (a.guest_id !== null ? " Their invitation and RSVP stay on the guest list." : "") +
      " Their files are kept, but there's no one-tap undo for this.",
    confirmLabel: "Remove from the website",
    danger: true,
    run: async () => {
      await api(`/api/admin/accounts/${id}`, { method: "DELETE" })
      data.accounts = data.accounts.filter((x) => x.id !== id)
      showSuccess(`Removed ${a.name} from the website`)
      const ctx = currentPlace()
      if (!ctx || ctx.route.tab !== "guests") return
      if (view.person === id) {
        void navigate("/admin/guests" + qs(), { replace: true })
      } else {
        draw(ctx)
      }
    },
  })
}

/** A Trust / Untrust / Remove press, from the list or the page.
 *  @param {MouseEvent} e @returns {boolean} whether it was one */
function onAccountAction(e) {
  const t = e.target
  if (!(t instanceof Element)) return false
  const btn = t.closest("[data-account-action]")
  if (!(btn instanceof HTMLButtonElement)) return false
  const id = Number(btn.dataset.accountId)
  if (!Number.isInteger(id) || id <= 0) return true
  const action = btn.dataset.accountAction
  if (action === "trust") void setTrust(id, true)
  else if (action === "untrust") void setTrust(id, false)
  else if (action === "remove") confirmRemove(id)
  return true
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
  const at = view.items.findIndex((e) => e.kind === "guest" && e.guest.id === id)
  const next = at === -1 ? null : (view.items[at + 1] ?? view.items[at - 1] ?? null)
  try {
    await api(`/api/admin/guests/${id}`, { method: "DELETE" })
    closeModal(getDialogElement("delete-modal"))
    await loadGuests()
    void navigate(next ? entryPath(next) + qs() : "/admin/guests" + qs(), { replace: true })
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
  if (onAccountAction(e)) return
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
  const keep = ctx.route.dialog && !params.guest && ctx.samePanel
  const sel = parseRosterSel(params.guest)
  view.id = sel?.kind === "guest" ? sel.id : keep && !sel ? view.id : null
  view.person = sel?.kind === "account" ? sel.id : keep && !sel ? view.person : null
  // The pointer at one person lasts for the arrival that asked for it.
  if (focusArmed) focusArmed = false
  else view.focus = null
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
  const at = items.findIndex(isSelected)
  const next = items[Math.max(0, Math.min(items.length - 1, at === -1 ? 0 : at + step))]
  if (next && !isSelected(next)) {
    void navigate(entryPath(next) + qs(), { replace: view.id !== null || view.person !== null })
  }
}

/** @type {Types.initGuests} */
export function initGuests() {
  getFormElement("guest-form").addEventListener("submit", handleGuestFormSubmit)
  getButtonElement("confirm-delete-btn").addEventListener("click", handleArchiveConfirm)
  getButtonElement("confirm-restore-btn").addEventListener("click", handleRestoreConfirm)
  getInputElement("guest-search").addEventListener("input", onSearchInput)
  getElement("guests-detail").addEventListener("click", onDetailClick)
  getElement("guests-rows").addEventListener("click", (e) => void onAccountAction(e))
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
      title: "Guests",
      keys: [
        ["j k", "Next / previous guest"],
        ["/", "Search"],
        ["e", "Edit the guest"],
      ],
    },
  })
}
