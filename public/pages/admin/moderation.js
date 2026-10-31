/** @file Review posts + Accounts — the Workspace split views (prototypes/
 *  admin-workspace/views/review.js, IA §4, §5 A, §13.7).
 *
 *  Review is a mail client: the queue on the left, the selected post on the
 *  right with its author and every action. Acting advances to the next post
 *  with a replace, so a whole session of a/a/h/a/r is one history entry and
 *  Back leaves Review. Every decision is undoable from the toast (`z`), so
 *  nothing asks first except approving the entire backlog and deleting an
 *  account. The URL holds the place: `/admin/review/photo-411?status=hidden&
 *  type=photo&author=a5`.
 *
 *  Accounts lives in the same panel (it shared the old Moderation tab): the
 *  guests who signed in to post, with trust, "Approve their N waiting", "See
 *  their posts" (→ /admin/review?author=a5) and delete. No regex (CLAUDE.md). */
/** @import * as Types from './types.js' */

import { api, openModal, closeModal, showError, showSuccess, showUndo } from "./utils.js"
import {
  html,
  formatDate,
  getElement,
  getTextAreaElement,
  getButtonElement,
  getDialogElement,
  getErrorMessage,
} from "../utils.js"
import { registerPanel, navigate, setCrumbs, setNavBadge, currentPlace } from "./router.js"
import { openConfirm } from "./confirm.js"
import { icon } from "./icons.js"
import { state } from "./state.js"
import { monogramData } from "../../components/monogram.js"

/** The URL's type names → the API's. Photo covers video. */
const API_TYPE = /** @type {const} */ ({ photo: "media", message: "guestbook", comment: "comment" })

/** The row and eyebrow label for each kind of post. */
const KIND_LABEL = /** @type {Record<string, string>} */ ({
  photo: "Photo",
  video: "Video",
  message: "Guestbook message",
  comment: "Comment",
})

/** The same, inside a sentence ("Hannah's photo"). */
const KIND_NOUN = /** @type {Record<string, string>} */ ({
  photo: "photo",
  video: "video",
  message: "message",
  comment: "comment",
})

const STATUS_LABEL = /** @type {Record<string, string>} */ ({
  pending: "To review",
  hidden: "Hidden",
  rejected: "Rejected",
  approved: "Approved",
})

/** The queue loads in pages; the server caps a page at 100. */
const PAGE = 50
const PAGE_MAX = 100

/** An untrusted author with this many approved posts gets the trust nudge (§13.7). */
const NUDGE_AFTER = 3

const WIDE = "(min-width: 900px)"
const isWide = () => window.matchMedia(WIDE).matches

/** Which of the panel's two views is showing. */
let view = /** @type {"review" | "accounts"} */ ("review")

/** Review's list and selection. */
const rv = {
  /** The filter the list was loaded for ("" = must reload). */
  key: "",
  filter: /** @type {Types.ReviewFilter} */ ({ status: "pending", type: "", author: null }),
  items: /** @type {Types.ModerationItem[]} */ ([]),
  hasMore: false,
  loadFailed: false,
  /** A linked post that isn't in the loaded list (decided since, a later page). */
  single: /** @type {Types.ModerationItem | null} */ (null),
  /** The selection the URL names (`photo-411`), or "". */
  sel: "",
  /** The selection could not be found at all. */
  missing: false,
  /** Ticked rows for bulk actions. Not in the URL: a tick is scratch, not a place. */
  ticked: /** @type {Set<string>} */ (new Set()),
  /** Waiting across the whole queue (the badge's number). */
  total: 0,
  /** One action at a time, so a fast double `a` can't approve two posts. */
  busy: false,
  /** Bumped on every mount; a load that finishes after a newer mount is dropped. */
  seq: 0,
}

/** Accounts' list and selection. */
const ac = {
  key: "",
  filter: /** @type {Types.AccountsFilter} */ ({ trusted: "" }),
  accounts: /** @type {Types.AccountRow[]} */ ([]),
  total: 0,
  sel: 0,
  missing: false,
  loadFailed: false,
  busy: false,
  seq: 0,
}

/** Account details (counts) by id — the author card and the Accounts detail. */
const accountCache = /** @type {Map<number, Types.AccountDetail>} */ (new Map())
/** How many sent thank-you cards each photo rides in, by media id. */
const cardRefs = /** @type {Map<number, number>} */ (new Map())

// ------------------------------------------------------------------ helpers

/** "a5" or "5" → 5. @param {string | null} v */
function accountRef(v) {
  if (!v) return null
  const n = Number(v.startsWith("a") ? v.slice(1) : v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** @param {URLSearchParams} q @returns {Types.ReviewFilter} */
function readFilter(q) {
  const s = q.get("status") ?? ""
  const t = q.get("type") ?? ""
  return {
    status: s === "approved" || s === "hidden" || s === "rejected" ? s : "pending",
    type: t === "photo" || t === "message" || t === "comment" ? t : "",
    author: accountRef(q.get("author")),
  }
}

/** The query string a filter writes, "" for the plain queue. @param {Types.ReviewFilter} f */
function queryFor(f) {
  const q = new URLSearchParams()
  if (f.status !== "pending") q.set("status", f.status)
  if (f.type) q.set("type", f.type)
  if (f.author !== null) q.set("author", "a" + f.author)
  const s = q.toString()
  return s ? "?" + s : ""
}

/** @param {Types.ReviewFilter} f */
const listHref = (f) => "/admin/review" + queryFor(f)

/** @param {Types.ModerationItem} item */
function kindOf(item) {
  if (item.content_type === "media") return item.kind === "video" ? "video" : "photo"
  return item.content_type === "guestbook" ? "message" : "comment"
}

/** `photo-411` — the post's anchor in the URL (IA §1.4). @param {Types.ModerationItem} item */
const keyOf = (item) => kindOf(item) + "-" + item.id

/** @param {Types.ModerationItem} item @param {Types.ReviewFilter} f */
const itemHref = (item, f) => "/admin/review/" + keyOf(item) + queryFor(f)

/** `photo-411` → { type: "media", id: 411 }. @param {string} key */
function parseKey(key) {
  const dash = key.lastIndexOf("-")
  if (dash <= 0) return null
  const kind = key.slice(0, dash)
  const id = Number(key.slice(dash + 1))
  if (!Number.isInteger(id) || id <= 0) return null
  /** @type {Types.ModerationContentType | null} */
  const type =
    kind === "photo" || kind === "video"
      ? "media"
      : kind === "message"
        ? "guestbook"
        : kind === "comment"
          ? "comment"
          : null
  return type ? { type, id } : null
}

/** Does this post answer to `key`? (photo-12 and video-12 are the same row.)
 *  @param {Types.ModerationItem} item @param {string} key */
function isKey(item, key) {
  const k = parseKey(key)
  return !!k && k.type === item.content_type && k.id === item.id
}

/** @param {Types.ModerationItem} item */
const authorName = (item) => item.author_name || "The couple"

/** Words that start a name without being one ("Grandpa Walt", "The Okafors"). */
const NOT_A_FIRST_NAME = new Set(
  (
    "the grandpa grandma granny nana papa uncle aunt auntie cousin little " +
    "mr. mrs. ms. mx. dr. professor prof."
  ).split(" "),
)

/** "Hannah Weiss" → "Hannah"; "Grandpa Walt" stays whole. @param {string} name */
function firstName(name) {
  const words = name.trim().split(" ").filter((w) => w !== "")
  if (words.length < 2 || NOT_A_FIRST_NAME.has(words[0].toLowerCase())) return name.trim()
  // "Priya & Sam" → keep the pair.
  if (words[1] === "&" || words[1].toLowerCase() === "and") return name.trim()
  return words[0]
}

/** One line of a long text. @param {string} text @param {number} max */
function oneLine(text, max) {
  const flat = text.split("\n").join(" ").trim()
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat
}

/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** SQLite's "YYYY-MM-DD HH:MM:SS" is UTC with no zone. @param {string} value */
function parseTime(value) {
  let s = value
  if (s.includes(" ") && !s.includes("T")) s = s.replace(" ", "T")
  const t = s.indexOf("T")
  const time = t === -1 ? "" : s.slice(t)
  if (!(time.endsWith("Z") || time.includes("+") || time.includes("-"))) s += "Z"
  return new Date(s).getTime()
}

/** "18m ago", "3h ago", "2d ago", then the date. @param {string} iso */
function ago(iso) {
  const then = parseTime(iso)
  if (Number.isNaN(then)) return ""
  const min = Math.round((Date.now() - then) / 60000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** The prototype's monogram: a tinted circle, white initials (art.js avatarSvg).
 *  @param {string} name @param {string} [initials] */
function avatarArt(name, initials) {
  const { initial, hue } = monogramData(name)
  return html`<svg class="art" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="20" fill="hsl(${hue} 40% 55%)"></circle>
    <text x="20" y="25" text-anchor="middle" font-size="14" font-family="sans-serif" fill="#fff">
      ${initials ?? initial}
    </text>
  </svg>`
}

/** The couple's own uploads have no account: their brand mark stands in. */
function coupleMark() {
  return (document.getElementById("brand-mark")?.textContent ?? "").trim() || "J&J"
}

/** @param {Types.ModerationItem} item */
function authorAvatar(item) {
  return item.account_id === null
    ? avatarArt("The couple", coupleMark())
    : avatarArt(authorName(item))
}

/** The waiting count every surface agrees on (sidebar badge, the seg). */
/** @type {Types.updateModerationBadge} */
export function updateModerationBadge(count) {
  const changed = rv.total !== count
  rv.total = count
  setNavBadge("moderation", count)
  // The seg and the eyebrow's "1 of 14" show the same number.
  if (!changed || !reviewShowing() || rv.key === "") return
  getElement("rv-head").innerHTML = headMarkup()
  const of = document.getElementById("rv-of")
  if (of) of.textContent = listTotal()
}

/** @type {Types.loadModerationCount} */
export async function loadModerationCount() {
  try {
    const data = /** @type {Types.ModerationCountsResponse} */ (
      await api("/api/admin/moderation/counts")
    )
    updateModerationBadge(data.total)
    return data.total
  } catch {
    // Non-critical — the badge just stays where it was.
    return 0
  }
}

/** The Faces count, for the "All caught up → Next" button. */
function facesWaiting() {
  const el = document.getElementById("faces-badge")
  if (!el || el.hidden) return 0
  return Number(el.textContent ?? "0") || 0
}

/** Is the Review view what's on screen right now? */
function reviewShowing() {
  const place = currentPlace()
  return !!place && place.route.tab === "moderation" && view === "review"
}

/** @param {number} id @returns {Promise<Types.AccountDetail | null>} */
async function fetchAccount(id) {
  try {
    const data = /** @type {Types.AccountDetailResponse} */ (
      await api(`/api/admin/accounts/${id}`)
    )
    accountCache.set(id, data.account)
    return data.account
  } catch {
    accountCache.delete(id)
    return null
  }
}

/** Anything about this author changed: forget the cached counts, and the
 *  lists that show them reload on their next showing. @param {number | null} id */
function forgetAccount(id) {
  if (id !== null) accountCache.delete(id)
  ac.key = ""
}

// ================================================================== REVIEW

/** Fetch the queue for a filter (first page, or as many rows as are showing).
 *  @param {Types.ReviewFilter} f @param {{ keep?: boolean }} [opts] */
async function loadQueue(f, opts = {}) {
  const params = new URLSearchParams()
  params.set("status", f.status)
  if (f.type) params.set("type", API_TYPE[f.type])
  if (f.author !== null) params.set("account_id", String(f.author))
  const want = opts.keep ? Math.min(PAGE_MAX, Math.max(PAGE, rv.items.length)) : PAGE
  params.set("limit", String(want))
  params.set("offset", "0")
  const data = /** @type {Types.ModerationQueueResponse} */ (
    await api(`/api/admin/moderation/queue?${params}`)
  )
  rv.items = data.items
  rv.hasMore = data.hasMore
  rv.filter = f
  rv.key = queryFor(f)
  rv.loadFailed = false
  state.currentModeration = rv.items
  // Ticks only make sense on rows that are still here.
  for (const key of [...rv.ticked]) {
    if (!rv.items.some((i) => isKey(i, key))) rv.ticked.delete(key)
  }
}

async function loadMoreQueue() {
  const f = rv.filter
  const params = new URLSearchParams()
  params.set("status", f.status)
  if (f.type) params.set("type", API_TYPE[f.type])
  if (f.author !== null) params.set("account_id", String(f.author))
  params.set("limit", String(PAGE))
  params.set("offset", String(rv.items.length))
  try {
    const data = /** @type {Types.ModerationQueueResponse} */ (
      await api(`/api/admin/moderation/queue?${params}`)
    )
    const seen = new Set(rv.items.map(keyOf))
    rv.items = rv.items.concat(data.items.filter((i) => !seen.has(keyOf(i))))
    rv.hasMore = data.hasMore
    state.currentModeration = rv.items
    renderReview()
  } catch (err) {
    showError(getErrorMessage(err))
  }
}

/** The post the URL selects: from the list, else the one fetched alone. */
function selected() {
  if (!rv.sel) return null
  const listed = rv.items.find((i) => isKey(i, rv.sel))
  if (listed) return listed
  return rv.single && isKey(rv.single, rv.sel) ? rv.single : null
}

/** @type {Types.AdminPanel["mount"]} */
async function mountReview(params, query, ctx) {
  const seq = ++rv.seq
  const switching = view !== "review"
  view = "review"
  showView()
  const f = readFilter(query)
  const fresh = !ctx.samePanel || switching || rv.key !== queryFor(f)
  if (rv.key !== queryFor(f)) rv.ticked.clear()
  rv.sel = params.id ?? ""
  rv.missing = false
  if (fresh) {
    rv.filter = f
    renderLoading()
    try {
      await loadQueue(f)
    } catch (err) {
      if (seq !== rv.seq) return
      rv.items = []
      rv.hasMore = false
      rv.loadFailed = true
      rv.key = ""
      console.error("Couldn't load the review queue:", err)
    }
    void loadModerationCount()
    if (seq !== rv.seq) return
  }
  // Wide screens open the first post; phones show the list (IA §3).
  if (!rv.sel && isWide() && rv.items.length > 0) {
    void navigate(itemHref(rv.items[0], f), { replace: true })
    return
  }
  if (rv.sel && !selected()) {
    const k = parseKey(rv.sel)
    rv.single = null
    if (k) {
      try {
        const data = /** @type {Types.ModerationItemResponse} */ (
          await api(`/api/admin/moderation/${k.type}/${k.id}`)
        )
        rv.single = data.item
      } catch {
        rv.single = null
      }
    }
    if (seq !== rv.seq) return
    rv.missing = !rv.single
  }
  const moved = !ctx.samePanel || ctx.replace || switching
  renderReview()
  if (moved) getElement("rv-detail").scrollTop = 0
  revealSelected()
  const item = selected()
  setCrumbs(item ? [{ label: `${authorName(item)} · ${KIND_LABEL[kindOf(item)]}` }] : [])
  if (item) void enrich(item)
}

/** Fill in what the list doesn't carry: the author's counts, card references. */
/** @param {Types.ModerationItem} item */
async function enrich(item) {
  const key = keyOf(item)
  const jobs = []
  if (item.account_id !== null && !accountCache.has(item.account_id)) {
    jobs.push(fetchAccount(item.account_id))
  }
  if (item.content_type === "media" && item.status !== "rejected" && !cardRefs.has(item.id)) {
    jobs.push(
      api(`/api/admin/media/${item.id}/references`)
        .then((res) => {
          const refs = /** @type {Types.MediaReferencesResponse} */ (res)
          cardRefs.set(item.id, refs.deliveredCardRefs)
        })
        .catch(() => {
          // A failed lookup never blocks a decision; the warning just doesn't show.
        }),
    )
  }
  if (jobs.length === 0) return
  await Promise.all(jobs)
  const now = selected()
  if (!now || keyOf(now) !== key || !reviewShowing()) return
  renderAuthor(now)
  renderRefs(now)
}

function showView() {
  const panel = getElement("tab-moderation")
  getElement("rv-split").hidden = view !== "review"
  getElement("ac-split").hidden = view !== "accounts"
  panel.setAttribute("aria-label", view === "review" ? "Review posts" : "Accounts")
}

function renderLoading() {
  getElement("rv-head").innerHTML = headMarkup()
  getElement("rv-bulk").innerHTML = ""
  getElement("rv-rows").innerHTML = html`<li class="list-empty">
    <span class="spinner" aria-hidden="true"></span>Loading…
  </li>`
  getElement("rv-detail").innerHTML = ""
}

function renderReview() {
  const split = getElement("rv-split")
  split.classList.toggle("has-sel", !!rv.sel)
  getElement("rv-head").innerHTML = headMarkup()
  getElement("rv-bulk").innerHTML = bulkMarkup()
  getElement("rv-rows").innerHTML = rowsMarkup()
  getElement("rv-detail").innerHTML = detailMarkup()
}

/** Keep the selected row in view as j/k walk past the pane's edge — clear of
 *  the sticky header and footer, which scrollIntoView doesn't know about.
 *  @param {string} paneId @param {string} rowsId */
function reveal(paneId, rowsId) {
  if (!isWide()) return
  const pane = getElement(paneId)
  const row = getElement(rowsId).querySelector('.row[aria-current="true"]')
  if (!(row instanceof HTMLElement)) return
  const head = pane.querySelector(".rv-sticky") ?? pane.querySelector(".pane-head")
  const foot = pane.querySelector(".pane-foot")
  const box = pane.getBoundingClientRect()
  const top = box.top + (head instanceof HTMLElement ? head.offsetHeight : 0)
  const bottom = box.bottom - (foot instanceof HTMLElement ? foot.offsetHeight : 0)
  const r = row.getBoundingClientRect()
  if (r.top < top) pane.scrollTop -= top - r.top + 6
  else if (r.bottom > bottom) pane.scrollTop += r.bottom - bottom + 6
}

const revealSelected = () => reveal("rv-list", "rv-rows")

/** Is any filter narrowing the queue beyond its status? */
const narrowed = () => rv.filter.type !== "" || rv.filter.author !== null

/** How many posts the current list holds, as a phrase ("14", "50+"). */
function listTotal() {
  if (rv.filter.status === "pending" && !narrowed()) return String(rv.total || rv.items.length)
  return String(rv.items.length) + (rv.hasMore ? "+" : "")
}

/** The author an ?author= filter names, as best we know it. */
function filterAuthorName() {
  const id = rv.filter.author
  if (id === null) return ""
  const known = accountCache.get(id)?.name ?? rv.items.find((i) => i.account_id === id)?.author_name
  return known ?? "one guest"
}

function headMarkup() {
  const f = rv.filter
  /** @param {Partial<Types.ReviewFilter>} patch */
  const withF = (patch) => listHref({ ...f, ...patch })
  const seg = ["pending", "hidden", "rejected", "approved"].map((s) => {
    const on = f.status === s
    const n = s === "pending" ? (on ? listTotal() : String(rv.total || "")) : ""
    return html`<a href="${withF({ status: /** @type {Types.ReviewFilter["status"]} */ (s) })}"
      data-replace aria-current="${on ? "page" : "false"}"
      >${STATUS_LABEL[s]}${n && n !== "0" ? html` <span class="seg-n">${n}</span>` : ""}</a
    >`
  })
  const chips = /** @type {Array<[Types.ReviewFilter["type"], string]>} */ ([
    ["", "All"],
    ["photo", "Photos & video"],
    ["message", "Messages"],
    ["comment", "Comments"],
  ]).map(
    ([t, label]) =>
      html`<a class="chip" href="${withF({ type: t })}" data-replace
        aria-current="${f.type === t ? "true" : "false"}">${label}</a>`,
  )
  const approveAll =
    f.status === "pending" && !narrowed() && rv.items.length > 0
      ? html`<button type="button" class="btn btn-sm btn-ghost" data-rv="approve-all"
          title="Publish every post waiting, not just the ones loaded here">Approve all</button>`
      : ""
  const author =
    f.author !== null
      ? html`<div class="chips rv-from" role="group" aria-label="Author">
          <a class="chip chip-x" href="${withF({ author: null })}" data-replace aria-current="true"
            aria-label="Show everyone's posts, not just ${filterAuthorName()}'s"
            >From ${filterAuthorName()} <span aria-hidden="true">×</span></a
          >
        </div>`
      : ""
  return html`<div class="rv-title"><h1>Review posts</h1>${approveAll}</div>
    <nav class="seg" aria-label="Status">${seg}</nav>
    <div class="chips" role="group" aria-label="Type">${chips}</div>
    ${author}`
}

/** Ticked rows that are on screen. */
function tickedItems() {
  return rv.items.filter((i) => rv.ticked.has(keyOf(i)))
}

function bulkMarkup() {
  const t = tickedItems()
  if (t.length === 0) return ""
  const s = rv.filter.status
  const all = t.length < rv.items.length
  return html`<div class="bulkbar" role="region" aria-label="Bulk actions">
    <span>${t.length} ticked${all
      ? html` · <button type="button" class="linklike" data-rv="tick-all">Tick all ${rv.items.length}${rv.hasMore ? " loaded" : ""}</button>`
      : ""}</span>
    ${s === "pending" || s === "hidden"
      ? html`<button type="button" class="btn btn-sm btn-primary" data-rv="bulk" data-to="approve">Approve</button>`
      : ""}
    ${s === "pending" || s === "approved"
      ? html`<button type="button" class="btn btn-sm" data-rv="bulk" data-to="hide">Hide</button>`
      : ""}
    ${s === "pending"
      ? html`<button type="button" class="btn btn-sm" data-rv="bulk" data-to="reject">Reject</button>`
      : ""}
    <button type="button" class="btn btn-sm btn-ghost" data-rv="untick">Clear</button>
  </div>`
}

function doneMarkup() {
  const g = facesWaiting()
  return html`<div class="done-state">
    <div class="done-icon">${icon("check")}</div>
    <h2>All caught up</h2>
    <p>Every post has been reviewed. New ones will show up here and on Home.</p>
    ${g
      ? html`<a class="btn btn-primary btn-lg" href="/admin/faces"
          >Next: name the faces (${plural(g, "group", "groups")}) →</a
        >`
      : html`<a class="btn btn-lg" href="/admin">Back to Home</a>`}
  </div>`
}

function emptyListMarkup() {
  const f = rv.filter
  if (rv.loadFailed) {
    return html`<li class="list-empty">
      <p>Couldn't load the posts.</p>
      <button type="button" class="btn btn-sm" data-rv="retry">Try again</button>
    </li>`
  }
  if (f.status === "pending" && !narrowed()) {
    return html`<li class="list-empty">${doneMarkup()}</li>`
  }
  const who = f.author !== null ? ` from ${filterAuthorName()}` : ""
  const what =
    f.type === "photo"
      ? "photos or videos"
      : f.type === "message"
        ? "messages"
        : f.type === "comment"
          ? "comments"
          : "posts"
  const phrase =
    f.status === "pending"
      ? `No ${what}${who} waiting.`
      : `No ${STATUS_LABEL[f.status].toLowerCase()} ${what}${who}.`
  return html`<li class="list-empty">${phrase}</li>`
}

/** @param {Types.ModerationItem} item */
function thumbMarkup(item) {
  if (item.content_type === "media" && item.file_key) {
    if (item.needs_display && item.kind !== "video") {
      return html`<span class="thumb thumb-empty">HEIC</span>`
    }
    const video = item.kind === "video"
    return html`<span class="thumb ${video ? "is-video" : ""}"
      ><img src="/media/${item.file_key}/${video ? "poster" : "thumb"}" alt="" loading="lazy"
    /></span>`
  }
  return html`<span class="thumb thumb-avatar">${authorAvatar(item)}</span>`
}

/** @param {Types.ModerationItem} item */
function rowMarkup(item) {
  const key = keyOf(item)
  const kind = kindOf(item)
  const name = authorName(item)
  const on = key === rv.sel || isKey(item, rv.sel)
  const text = item.content_type === "media" ? item.caption : item.message
  const label = `Tick ${name}'s ${KIND_NOUN[kind]}`
  const box = rv.ticked.has(key)
    ? html`<input type="checkbox" data-tick="${key}" checked aria-label="${label}" />`
    : html`<input type="checkbox" data-tick="${key}" aria-label="${label}" />`
  return html`<li class="row-wrap">
    <label class="tick" title="Tick for bulk (x)">${box}</label>
    <a class="row" href="${itemHref(item, rv.filter)}" data-select aria-current="${on ? "true" : "false"}">
      ${thumbMarkup(item)}
      <span class="row-main">
        <span class="row-top"
          ><strong>${name}</strong>${item.author_trusted === false
            ? html`<span class="tag">new</span>`
            : ""}<span class="row-time">${ago(item.created_at)}</span></span
        >
        <span class="row-sub">${KIND_LABEL[kind]}${text ? ` · ${oneLine(text, 140)}` : ""}</span>
      </span>
    </a>
  </li>`
}

function rowsMarkup() {
  if (rv.items.length === 0) return emptyListMarkup()
  return html`${rv.items.map(rowMarkup)}${rv.hasMore
    ? html`<li class="rows-more">
        <button type="button" class="btn btn-sm btn-block" data-rv="more">Load more</button>
      </li>`
    : ""}`
}

/** The ‹ Review chevron (phones). */
function mBack() {
  return html`<a class="m-back" href="${listHref(rv.filter)}" data-up>${icon("back")}Review</a>`
}

/** @param {Types.ModerationItem} item */
function contentMarkup(item) {
  if (item.content_type === "media") {
    const caption = item.caption ? html`<figcaption>${item.caption}</figcaption>` : ""
    if (!item.file_key) return html`<figure class="media-big is-missing">${caption}</figure>`
    if (item.kind === "video") {
      return html`<figure class="media-big is-video">
          <video controls preload="metadata" poster="/media/${item.file_key}/poster"
            src="/media/${item.file_key}/video"></video>
        </figure>
        ${item.caption ? html`<p class="media-caption">${item.caption}</p>` : ""}`
    }
    if (item.needs_display) {
      return html`<figure class="media-big is-missing">
        <p>No preview: this HEIC photo couldn't be converted. Download the original to see it.</p>
        ${caption}
      </figure>`
    }
    return html`<figure class="media-big">
      <img src="/media/${item.file_key}/display" alt="Photo from ${authorName(item)}" />
      ${caption}
    </figure>`
  }
  if (item.content_type === "guestbook") {
    return html`<blockquote class="msg-big">${item.message ?? ""}</blockquote>`
  }
  return html`${parentMarkup(item)}<blockquote class="msg-big">${item.message ?? ""}</blockquote>`
}

/** A comment shows what it replies to, so a reply is never approved blind.
 *  @param {Types.ModerationItem} item */
function parentMarkup(item) {
  if (item.target_id === null) return ""
  const owner = item.parent_author ?? "the couple"
  const snippet = item.parent_snippet ? oneLine(item.parent_snippet, 160) : ""
  if (item.target_type === "media") {
    const video = item.parent_kind === "video"
    return html`<div class="parent-ctx">
      <span class="muted">Replying to ${owner}'s ${video ? "video" : "photo"}</span>
      <a class="parent-card" href="/gallery?item=${item.target_id}" target="_blank" rel="noopener">
        ${item.parent_file_key
          ? html`<span class="thumb"
              ><img src="/media/${item.parent_file_key}/${video ? "poster" : "thumb"}" alt="" loading="lazy"
            /></span>`
          : ""}
        <span class="parent-text">${snippet || html`<span class="muted">No caption</span>`}</span>
        <span class="parent-open">View ${icon("external")}</span>
      </a>
    </div>`
  }
  return html`<div class="parent-ctx">
    <span class="muted">Replying to ${owner}'s guestbook message</span>
    <a class="parent-card" href="/guestbook?entry=${item.target_id}" target="_blank" rel="noopener">
      <span class="parent-text">${snippet ? `“${snippet}”` : html`<span class="muted">Message unavailable</span>`}</span>
      <span class="parent-open">View ${icon("external")}</span>
    </a>
  </div>`
}

/** @param {Types.ModerationItem} item */
function statusNoteMarkup(item) {
  if (item.status === "pending") {
    // A post linked from a list it isn't in (another filter) still says so.
    return ""
  }
  const what =
    item.status === "approved"
      ? "Approved — it's on the site."
      : item.status === "hidden"
        ? "Hidden — off the site, kept for you."
        : item.content_type === "media"
          ? "Rejected — off the site, its files set aside for a week."
          : "Rejected — it won't be published."
  return html`<p class="status-note">
    ${what} <button type="button" class="linklike" data-rv="restore">Move back to review</button>
  </p>`
}

/** The author card: who posted, whether they're trusted, the nudge (§13.7),
 *  and "Approve their N waiting" (trust applies to new posts only).
 *  @param {Types.ModerationItem} item */
function authorMarkup(item) {
  if (item.account_id === null) {
    return html`<section class="author" id="rv-author">
      <span class="avatar">${authorAvatar(item)}</span>
      <div><strong>The couple</strong><br /><span class="muted">Your own upload</span></div>
    </section>`
  }
  const id = item.account_id
  const a = accountCache.get(id)
  const name = a?.name ?? authorName(item)
  const first = firstName(name)
  const trusted = a ? a.trusted : !!item.author_trusted
  const relation = a?.relation ?? item.author_relation
  const sub = [
    relation ?? "",
    trusted ? "Trusted — new posts go live without review" : "First posts are reviewed",
  ].filter((p) => p !== "")
  const waiting = a ? a.counts.pending : 0
  const nudge = !!a && !trusted && a.counts.approved >= NUDGE_AFTER
  const total = a ? a.post_count - a.counts.rejected : 0
  const trustBtn = html`<button type="button" class="btn btn-sm ${nudge ? "btn-primary" : ""}"
    data-rv="trust">Trust ${first} <kbd>t</kbd></button>`
  const showWaiting = waiting > 1 || (waiting === 1 && item.status !== "pending")
  const links = [
    rv.filter.author === id
      ? ""
      : html`<a href="/admin/review?author=a${id}">See all their posts</a>`,
    html`<a href="/admin/accounts/a${id}">Account</a>`,
  ].filter((l) => l !== "")
  return html`<section class="author ${nudge ? "has-nudge" : ""}" id="rv-author">
    <span class="avatar">${authorAvatar(item)}</span>
    <div>
      <strong>${name}</strong><br /><span class="muted">${sub.join(" · ")}</span>
    </div>
    ${trusted || nudge ? "" : trustBtn}
    ${nudge
      ? html`<div class="trust-nudge">
          <span>${first} has posted ${plural(total, "time", "times")}, and you've approved
            ${a ? a.counts.approved : 0}. Trust them? Their new posts would skip review.</span>
          ${trustBtn}
        </div>`
      : ""}
    <div class="author-more">
      ${showWaiting
        ? html`<button type="button" class="btn btn-sm" data-rv="approve-waiting"
            >Approve their ${waiting} waiting</button
          >`
        : ""}
      <span class="author-links">${links.map((l, i) => html`${i ? " · " : ""}${l}`)}</span>
    </div>
  </section>`
}

/** @param {Types.ModerationItem} item */
function refsMarkup(item) {
  const n = item.content_type === "media" ? cardRefs.get(item.id) ?? 0 : 0
  if (n <= 0 || item.status === "rejected") return html`<p id="rv-refs" hidden></p>`
  return html`<p id="rv-refs" class="status-note is-warn">
    This photo is in ${plural(n, "thank-you card", "thank-you cards")} you've sent. Hiding or
    rejecting it takes it out of ${n === 1 ? "that card" : "those cards"}.
  </p>`
}

/** @param {Types.ModerationItem} item */
function renderAuthor(item) {
  const el = document.getElementById("rv-author")
  if (el) el.outerHTML = String(authorMarkup(item))
}

/** @param {Types.ModerationItem} item */
function renderRefs(item) {
  const el = document.getElementById("rv-refs")
  if (el) el.outerHTML = String(refsMarkup(item))
}

/** Secondary actions that don't decide anything: originals, the official
 *  gallery, a reject that carries a reason. @param {Types.ModerationItem} item */
function extrasMarkup(item) {
  const parts = []
  if (item.content_type === "media" && item.file_key) {
    parts.push(
      html`<a class="btn btn-sm btn-ghost" href="/media/${item.file_key}/original" download
        >Download original</a
      >`,
    )
  }
  if (item.content_type === "media" && item.status === "approved" && item.account_id !== null) {
    parts.push(
      html`<button type="button" class="btn btn-sm btn-ghost" data-rv="promote">
        Move to the official gallery
      </button>`,
    )
  }
  if (item.status === "pending") {
    parts.push(
      html`<button type="button" class="btn btn-sm btn-ghost" data-rv="reject-reason">
        Reject with a reason…
      </button>`,
    )
  }
  return parts.length ? html`<div class="btn-row rv-extras">${parts}</div>` : ""
}

/** @param {Types.ModerationItem} item */
function actionbarMarkup(item) {
  const s = item.status
  /** @param {string} action @param {string} label @param {string} key
   *  @param {string} cls @param {boolean} ok @param {string} title */
  const btn = (action, label, key, cls, ok, title) =>
    ok
      ? html`<button type="button" class="btn btn-lg ${cls}" data-rv="${action}" title="${title}">
          ${label} <kbd>${key}</kbd>
        </button>`
      : html`<button type="button" class="btn btn-lg ${cls}" disabled title="${title}">
          ${label} <kbd>${key}</kbd>
        </button>`
  return html`<div class="actionbar" role="group" aria-label="Decide">
    ${btn("approve", s === "hidden" ? "Republish" : "Approve", "a", "btn-primary",
      s === "pending" || s === "hidden", "Approve: it goes on the site")}
    ${btn("hide", "Hide", "h", "", s === "pending" || s === "approved",
      "Hide: off the site, kept for you")}
    ${btn("reject", "Reject", "r", "btn-danger-soft", s === "pending",
      "Reject: it won't be published")}
  </div>`
}

function detailMarkup() {
  if (rv.loadFailed && !rv.sel) return html`<div class="detail-empty"><p>Nothing to show.</p></div>`
  if (!rv.sel) {
    if (rv.items.length) {
      return html`<div class="detail-empty"><p>Pick a post on the left.</p></div>`
    }
    return rv.filter.status === "pending" && !narrowed()
      ? doneMarkup()
      : html`<div class="detail-empty"><p>Nothing here.</p></div>`
  }
  const item = selected()
  if (!item) {
    if (!rv.missing) return html`${mBack()}`
    return html`${mBack()}
      <div class="detail-empty">
        <p>That post no longer exists. Its author may have deleted it.</p>
        <a class="btn" href="${listHref(rv.filter)}" data-replace>Back to the queue</a>
      </div>`
  }
  const i = rv.items.indexOf(item)
  const prev = i > 0 ? rv.items[i - 1] : null
  const next = i >= 0 ? rv.items[i + 1] ?? null : null
  const kind = kindOf(item)
  const eyebrow = [KIND_LABEL[kind], ago(item.created_at)]
  /** @param {Types.ModerationItem | null} to @param {string} glyph @param {string} label */
  const step = (to, glyph, label) =>
    to
      ? html`<a href="${itemHref(to, rv.filter)}" data-select aria-label="${label}">${glyph}</a>`
      : html`<span aria-hidden="true">${glyph}</span>`
  return html`${mBack()}
    <article class="detail rv-post">
      <header class="detail-head">
        <span class="eyebrow"
          >${eyebrow.join(" · ")}${i >= 0
            ? html` · ${i + 1} of <span id="rv-of">${listTotal()}</span>`
            : ""}</span
        >
        <nav class="stepper-mini" aria-label="Previous and next">
          ${step(prev, "↑", "Previous (k)")} ${step(next, "↓", "Next (j)")}
        </nav>
      </header>
      ${statusNoteMarkup(item)} ${contentMarkup(item)} ${refsMarkup(item)} ${authorMarkup(item)}
      ${extrasMarkup(item)}
    </article>
    ${actionbarMarkup(item)}`
}

// ----------------------------------------------------------- review: acting

/** Where to go once `item` has left the list: the post after it, else the one
 *  before, else the empty queue. Computed from the list BEFORE it left.
 *  @param {Types.ModerationItem[]} before @param {Set<string>} gone */
function nextAfter(before, gone) {
  const at = before.findIndex((i) => isKey(i, rv.sel))
  if (at === -1) return null
  for (let j = at + 1; j < before.length; j++) if (!gone.has(keyOf(before[j]))) return before[j]
  for (let j = at - 1; j >= 0; j--) if (!gone.has(keyOf(before[j]))) return before[j]
  return null
}

/** Posts that left the current list: drop them, then walk on (replace) if the
 *  selection was one of them. @param {Set<string>} gone */
function leaveList(gone) {
  const before = rv.items
  const selGone = !!rv.sel && [...gone].some((k) => {
    const item = before.find((i) => keyOf(i) === k)
    return !!item && isKey(item, rv.sel)
  })
  const next = selGone ? nextAfter(before, gone) : null
  rv.items = before.filter((i) => !gone.has(keyOf(i)))
  state.currentModeration = rv.items
  for (const k of gone) rv.ticked.delete(k)
  if (!reviewShowing()) return
  if (selGone) {
    void navigate(next ? itemHref(next, rv.filter) : listHref(rv.filter), { replace: true })
  } else {
    renderReview()
    const item = selected()
    if (item) void enrich(item)
  }
}

/** The status an action leaves a post in. @param {string} action */
const STATUS_AFTER = /** @type {Record<string, string>} */ ({
  approve: "approved",
  hide: "hidden",
  reject: "rejected",
})

/** Mark authors trusted everywhere they show. @param {number[]} ids @param {boolean} trusted */
function setTrustedLocally(ids, trusted) {
  for (const i of rv.items) {
    if (i.account_id !== null && ids.includes(i.account_id)) i.author_trusted = trusted
  }
  if (rv.single && rv.single.account_id !== null && ids.includes(rv.single.account_id)) {
    rv.single.author_trusted = trusted
  }
  for (const id of ids) {
    const a = accountCache.get(id)
    if (a) a.trusted = trusted
    const row = ac.accounts.find((x) => x.id === id)
    if (row) row.trusted = trusted
  }
}

/** Put posts back (the Undo toast) and, when the action trusted someone,
 *  un-trust them. Then show the first of them again.
 *  @param {Types.ModerationChanged[]} items @param {number[]} untrust */
async function putBack(items, untrust) {
  try {
    const res = /** @type {Types.ModerationRestoreResponse} */ (
      await api("/api/admin/moderation/restore", {
        method: "POST",
        body: JSON.stringify({
          items: items.map((i) => ({ type: i.type, id: i.id, to: i.previousStatus })),
          untrust,
        }),
      })
    )
    if (res.restored < items.length) {
      showError(
        res.restored === 0
          ? "That can't be undone any more — it has changed since."
          : `Put back ${res.restored} of ${items.length}. The rest have changed since.`,
      )
    } else {
      showSuccess("Undone")
    }
  } catch (err) {
    showError(getErrorMessage(err))
    return
  }
  for (const i of items) cardRefs.delete(i.id)
  const single = rv.single
  const mine = single
    ? items.find((i) => i.type === single.content_type && i.id === single.id)
    : null
  if (single && mine) single.status = mine.previousStatus
  setTrustedLocally(untrust, false)
  // Counts moved for every author involved; the cache refills on demand.
  accountCache.clear()
  ac.key = ""
  void loadModerationCount()
  if (view === "accounts" && currentPlace()?.route.tab === "moderation") {
    rv.key = ""
    void refreshAccounts()
    return
  }
  try {
    await loadQueue(rv.filter, { keep: true })
  } catch {
    rv.key = ""
  }
  if (!reviewShowing()) return
  const first = items[0]
  const back = first
    ? rv.items.find((i) => i.content_type === first.type && i.id === first.id)
    : null
  if (back) void navigate(itemHref(back, rv.filter), { replace: true })
  else {
    renderReview()
    const item = selected()
    if (item) void enrich(item)
  }
}

/** Approve / hide / reject one post, advance, offer Undo.
 *  @param {"approve" | "hide" | "reject"} action @param {Types.ModerationItem} item
 *  @param {string} [reason] */
async function act(action, item, reason = "") {
  const s = item.status
  const legal =
    action === "approve"
      ? s === "pending" || s === "hidden"
      : action === "hide"
        ? s === "pending" || s === "approved"
        : s === "pending"
  if (!legal || rv.busy) return
  rv.busy = true
  /** @type {Types.ModerationActionResponse} */
  let res
  try {
    res = /** @type {Types.ModerationActionResponse} */ (
      await api(`/api/admin/moderation/${item.content_type}/${item.id}/${action}`, {
        method: "POST",
        body: reason.trim() ? JSON.stringify({ reason: reason.trim() }) : undefined,
      })
    )
  } catch (err) {
    rv.busy = false
    showError(getErrorMessage(err))
    return
  }
  rv.busy = false
  const was = res.previousStatus || s
  const name = authorName(item)
  const kind = kindOf(item)
  const trustedNow = res.autoTrusted && item.account_id !== null ? [item.account_id] : []
  item.status = STATUS_AFTER[action]
  setTrustedLocally(trustedNow, true)
  forgetAccount(item.account_id)
  void loadModerationCount()

  const refs = item.content_type === "media" ? cardRefs.get(item.id) ?? 0 : 0
  const verb =
    action === "approve"
      ? was === "hidden"
        ? "Republished"
        : "Approved"
      : action === "hide"
        ? "Hidden"
        : "Rejected"
  const notes = [`${verb} · ${firstName(name)}'s ${KIND_NOUN[kind]}`]
  if (trustedNow.length) notes.push(`${firstName(name)} is trusted now`)
  if (refs > 0 && action !== "approve") {
    notes.push(`out of ${plural(refs, "sent card", "sent cards")}`)
  }
  showUndo(notes.join(" · "), () =>
    void putBack([{ type: item.content_type, id: item.id, previousStatus: was }], trustedNow),
  )

  if (rv.items.includes(item) && item.status !== rv.filter.status) {
    leaveList(new Set([keyOf(item)]))
  } else if (reviewShowing()) {
    renderReview()
    void enrich(item)
  }
}

/** `t` / the author card's Trust: new posts skip review; what's waiting stays
 *  waiting (owner decision — "Approve their N waiting" is its own tap).
 *  @param {number} id @param {string} name */
async function trustAccount(id, name) {
  try {
    await api(`/api/admin/accounts/${id}/trust`, {
      method: "POST",
      body: JSON.stringify({ approve_pending: false }),
    })
  } catch (err) {
    showError(getErrorMessage(err))
    return
  }
  setTrustedLocally([id], true)
  forgetAccount(id)
  rerenderAfterAccount(id)
  showUndo(`Trusted ${firstName(name)} · new posts go live without review`, () =>
    void untrustAccount(id, name, true),
  )
}

/** @param {number} id @param {string} name @param {boolean} [quiet] an Undo */
async function untrustAccount(id, name, quiet = false) {
  try {
    await api(`/api/admin/accounts/${id}/untrust`, { method: "POST" })
  } catch (err) {
    showError(getErrorMessage(err))
    return
  }
  setTrustedLocally([id], false)
  forgetAccount(id)
  rerenderAfterAccount(id)
  if (quiet) showSuccess("Undone")
  else {
    showUndo(`${firstName(name)} isn't trusted any more · new posts wait for review`, () =>
      void trustAccount(id, name),
    )
  }
}

/** "Approve their N waiting": one tap, one Undo. @param {number} id @param {string} name */
async function approveWaiting(id, name) {
  /** @type {Types.ApproveWaitingResponse} */
  let res
  try {
    res = /** @type {Types.ApproveWaitingResponse} */ (
      await api(`/api/admin/accounts/${id}/approve-pending`, { method: "POST" })
    )
  } catch (err) {
    showError(getErrorMessage(err))
    return
  }
  setTrustedLocally(res.trustedAccounts, true)
  forgetAccount(id)
  void loadModerationCount()
  const notes = [`Approved ${plural(res.changed, "post", "posts")} from ${firstName(name)}`]
  if (res.trustedAccounts.length) notes.push(`${firstName(name)} is trusted now`)
  if (res.changed > 0) {
    showUndo(notes.join(" · "), () => void putBack(res.items, res.trustedAccounts))
  } else {
    showSuccess("Nothing was waiting")
  }
  const gone = new Set(
    rv.items
      .filter((i) => res.items.some((c) => c.type === i.content_type && c.id === i.id))
      .map(keyOf),
  )
  for (const i of rv.items) if (gone.has(keyOf(i))) i.status = "approved"
  const single = rv.single
  if (single && res.items.some((c) => c.type === single.content_type && c.id === single.id)) {
    single.status = "approved"
  }
  if (view === "accounts") {
    rv.key = ""
    rerenderAfterAccount(id)
    return
  }
  if (rv.filter.status === "pending") leaveList(gone)
  else if (reviewShowing()) renderReview()
}

/** An account changed: redraw whichever view shows it. @param {number} id */
function rerenderAfterAccount(id) {
  if (currentPlace()?.route.tab !== "moderation") return
  if (view === "review") {
    renderReview()
    const item = selected()
    if (item && item.account_id === id) void enrich(item)
  } else {
    void showAccount(id, false)
  }
}

/** The bulk bar. @param {"approve" | "hide" | "reject"} action */
async function bulk(action) {
  const legalFrom =
    action === "approve"
      ? ["pending", "hidden"]
      : action === "hide"
        ? ["pending", "approved"]
        : ["pending"]
  const items = tickedItems().filter((i) => legalFrom.includes(i.status))
  if (items.length === 0 || rv.busy) return
  rv.busy = true
  // Hide/reject takes a photo out of any sent card that holds it: say so.
  let inCards = 0
  if (action !== "approve") {
    const media = items.filter((i) => i.content_type === "media")
    const counts = await Promise.all(
      media.map((m) =>
        cardRefs.has(m.id)
          ? Promise.resolve(cardRefs.get(m.id) ?? 0)
          : api(`/api/admin/media/${m.id}/references`)
              .then((r) => /** @type {Types.MediaReferencesResponse} */ (r).deliveredCardRefs)
              .catch(() => 0),
      ),
    )
    inCards = counts.filter((n) => n > 0).length
  }
  /** @type {Types.ModerationChanged[]} */
  const changed = []
  /** @type {number[]} */
  const trusted = []
  try {
    for (let at = 0; at < items.length; at += PAGE_MAX) {
      const chunk = items.slice(at, at + PAGE_MAX)
      const res = /** @type {Types.ModerationBulkResponse} */ (
        await api("/api/admin/moderation/bulk", {
          method: "POST",
          body: JSON.stringify({
            action,
            items: chunk.map((i) => ({ type: i.content_type, id: i.id })),
          }),
        })
      )
      changed.push(...res.items)
      trusted.push(...res.trustedAccounts)
    }
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    rv.busy = false
  }
  if (changed.length === 0) {
    rv.key = ""
    return
  }
  setTrustedLocally(trusted, true)
  for (const c of changed) {
    forgetAccount(items.find((i) => i.id === c.id && i.content_type === c.type)?.account_id ?? null)
  }
  void loadModerationCount()
  const verb = action === "approve" ? "Approved" : action === "hide" ? "Hidden" : "Rejected"
  const notes = [`${verb} ${plural(changed.length, "post", "posts")}`]
  if (trusted.length) notes.push(`${plural(trusted.length, "new author", "new authors")} trusted`)
  if (inCards) notes.push(`${plural(inCards, "photo", "photos")} came out of sent cards`)
  showUndo(notes.join(" · "), () => void putBack(changed, trusted))
  const gone = new Set(
    items.filter((i) => changed.some((c) => c.type === i.content_type && c.id === i.id)).map(keyOf),
  )
  for (const i of items) if (gone.has(keyOf(i))) i.status = STATUS_AFTER[action]
  rv.ticked.clear()
  leaveList(gone)
}

/** "Approve all": the whole backlog, not just what's loaded. It can't be put
 *  back in one tap, so it asks first. */
function approveAll() {
  openConfirm({
    title: "Approve every waiting post?",
    desc:
      `This publishes all ${plural(rv.total, "post", "posts")} waiting, including ones ` +
      "not loaded here. Authors who aren't trusted yet become trusted, so their new posts " +
      "skip review. " +
      "There's no one-tap undo for this.",
    confirmLabel: "Approve all",
    danger: false,
    run: async () => {
      let changed = 0
      let trusted = 0
      let remaining = 0
      // The server caps one sweep; keep going until the backlog is empty.
      do {
        const res = /** @type {{ changed: number, trusted: number, remaining: number }} */ (
          await api("/api/admin/moderation/approve-all", { method: "POST" })
        )
        changed += res.changed
        trusted += res.trusted
        remaining = res.remaining
        if (res.changed === 0) break
      } while (remaining > 0)
      const parts = [`Approved ${plural(changed, "post", "posts")}`]
      if (trusted) parts.push(`${plural(trusted, "new author", "new authors")} trusted`)
      if (remaining > 0) parts.push(`${remaining} still waiting`)
      showSuccess(parts.join(" · "))
      accountCache.clear()
      ac.key = ""
      rv.ticked.clear()
      await loadQueue(rv.filter)
      void loadModerationCount()
      if (!reviewShowing()) return
      if (rv.sel) void navigate(listHref(rv.filter), { replace: true })
      else renderReview()
    },
  })
}

/** "Move back to review": a decided post goes back in the queue. */
/** @param {Types.ModerationItem} item */
async function restoreToQueue(item) {
  try {
    const res = /** @type {Types.ModerationRestoreResponse} */ (
      await api("/api/admin/moderation/restore", {
        method: "POST",
        body: JSON.stringify({ items: [{ type: item.content_type, id: item.id, to: "pending" }] }),
      })
    )
    if (res.restored === 0) {
      showError(
        item.status === "rejected" && item.content_type === "media"
          ? "Its files have been cleared out since, so it can't come back."
          : "That post has changed since. Reload to see where it is.",
      )
      return
    }
  } catch (err) {
    showError(getErrorMessage(err))
    return
  }
  item.status = "pending"
  forgetAccount(item.account_id)
  cardRefs.delete(item.id)
  void loadModerationCount()
  showSuccess(`Back in review · ${firstName(authorName(item))}'s ${KIND_NOUN[kindOf(item)]}`)
  if (rv.items.includes(item) && rv.filter.status !== "pending") leaveList(new Set([keyOf(item)]))
  else if (reviewShowing()) renderReview()
}

/** @param {Types.ModerationItem} item */
function promote(item) {
  openConfirm({
    title: "Move to the official gallery?",
    desc:
      "This photo moves from the guest feed into the Official section, which you order " +
      "yourselves. It's a move, not a copy.",
    confirmLabel: "Move it",
    danger: false,
    run: async () => {
      await api(`/api/admin/media/${item.id}/promote`, { method: "POST" })
      showSuccess("Moved to the official gallery")
      if (reviewShowing()) renderReview()
    },
  })
}

/** The one reject that asks first: when there's a reason to record.
 *  @param {Types.ModerationItem} item */
function rejectWithReason(item) {
  const dialog = getDialogElement("mod-confirm-modal")
  getElement("mod-confirm-desc").textContent =
    `Reject ${firstName(authorName(item))}'s ${KIND_NOUN[kindOf(item)]}? It won't be published. ` +
    "You can still undo it from the toast."
  getTextAreaElement("mod-confirm-reason").value = ""
  getElement("mod-confirm-error").hidden = true
  dialog.dataset.key = keyOf(item)
  openModal(dialog)
  getTextAreaElement("mod-confirm-reason").focus()
}

async function confirmRejectWithReason() {
  const dialog = getDialogElement("mod-confirm-modal")
  const item = selected()
  if (!item || keyOf(item) !== dialog.dataset.key) {
    closeModal(dialog)
    return
  }
  const reason = getTextAreaElement("mod-confirm-reason").value
  closeModal(dialog)
  await act("reject", item, reason)
}

/** Clicks inside Review's panes. @param {MouseEvent} e */
function onReviewClick(e) {
  const t = e.target
  if (!(t instanceof Element)) return
  const btn = t.closest("[data-rv]")
  if (!(btn instanceof HTMLElement)) return
  const what = btn.dataset.rv ?? ""
  const item = selected()
  if (what === "approve" && item) void act("approve", item)
  else if (what === "hide" && item) void act("hide", item)
  else if (what === "reject" && item) void act("reject", item)
  else if (what === "restore" && item) void restoreToQueue(item)
  else if (what === "trust" && item && item.account_id !== null) {
    void trustAccount(item.account_id, accountCache.get(item.account_id)?.name ?? authorName(item))
  } else if (what === "approve-waiting" && item && item.account_id !== null) {
    const name = accountCache.get(item.account_id)?.name ?? authorName(item)
    void approveWaiting(item.account_id, name)
  } else if (what === "promote" && item) promote(item)
  else if (what === "reject-reason" && item) rejectWithReason(item)
  else if (what === "approve-all") approveAll()
  else if (what === "more") void loadMoreQueue()
  else if (what === "retry") {
    rv.key = ""
    const place = currentPlace()
    if (place) void mountReview(place.params, place.query, { ...place, samePanel: false })
  } else if (what === "bulk") {
    const to = btn.dataset.to
    if (to === "approve" || to === "hide" || to === "reject") void bulk(to)
  } else if (what === "untick") {
    rv.ticked.clear()
    renderReview()
  } else if (what === "tick-all") {
    for (const i of rv.items) rv.ticked.add(keyOf(i))
    renderReview()
  }
}

/** A tick box changed. @param {Event} e */
function onTick(e) {
  const t = e.target
  if (!(t instanceof HTMLInputElement) || !t.dataset.tick) return
  if (t.checked) rv.ticked.add(t.dataset.tick)
  else rv.ticked.delete(t.dataset.tick)
  getElement("rv-bulk").innerHTML = bulkMarkup()
}

/** j/k from the list: replace when a post already shows (IA §1.2).
 *  @param {number} delta */
async function step(delta) {
  const at = rv.items.findIndex((i) => isKey(i, rv.sel))
  let to = at === -1 ? (delta > 0 ? 0 : -1) : at + delta
  if (to >= rv.items.length && rv.hasMore) {
    await loadMoreQueue()
  }
  if (to < 0 || to >= rv.items.length) return
  void navigate(itemHref(rv.items[to], rv.filter), { replace: !!rv.sel })
}

/** @param {KeyboardEvent} e */
function reviewKeys(e) {
  if (e.shiftKey && e.key !== "?") return false
  const k = e.key
  if (k === "j" || k === "ArrowDown") {
    void step(1)
    return true
  }
  if (k === "k" || k === "ArrowUp") {
    void step(-1)
    return true
  }
  const item = selected()
  if (!item) return false
  if (k === "a") return void act("approve", item), true
  if (k === "h") return void act("hide", item), true
  if (k === "r") return void act("reject", item), true
  if (k === "t") {
    const a = item.account_id !== null ? accountCache.get(item.account_id) : undefined
    if (item.account_id !== null && !(a?.trusted ?? item.author_trusted)) {
      void trustAccount(item.account_id, a?.name ?? authorName(item))
    }
    return true
  }
  if (k === "x") {
    const key = keyOf(item)
    if (!rv.items.some((i) => isKey(i, key))) return true
    if (rv.ticked.has(key)) rv.ticked.delete(key)
    else rv.ticked.add(key)
    renderReview()
    return true
  }
  return false
}

// ================================================================ ACCOUNTS

/** @param {URLSearchParams} q @returns {Types.AccountsFilter} */
function readAccountsFilter(q) {
  const t = q.get("trusted") ?? ""
  return { trusted: t === "1" || t === "0" ? t : "" }
}

/** @param {Types.AccountsFilter} f */
const accountsQuery = (f) => (f.trusted ? "?trusted=" + f.trusted : "")

/** @param {number} id @param {Types.AccountsFilter} f */
const accountHref = (id, f) => `/admin/accounts/a${id}` + accountsQuery(f)

/** @param {Types.AccountsFilter} f @param {number} [count] */
async function loadAccounts(f, count = PAGE) {
  const params = new URLSearchParams()
  if (f.trusted) params.set("trusted", f.trusted)
  params.set("limit", String(Math.min(PAGE_MAX, Math.max(PAGE, count))))
  params.set("offset", "0")
  const data = /** @type {Types.AccountsResponse} */ (await api(`/api/admin/accounts?${params}`))
  ac.accounts = data.accounts
  ac.total = data.total
  ac.filter = f
  ac.key = accountsQuery(f) || "all"
  ac.loadFailed = false
  state.currentAccounts = ac.accounts
}

async function loadMoreAccounts() {
  const params = new URLSearchParams()
  if (ac.filter.trusted) params.set("trusted", ac.filter.trusted)
  params.set("limit", String(PAGE))
  params.set("offset", String(ac.accounts.length))
  try {
    const data = /** @type {Types.AccountsResponse} */ (await api(`/api/admin/accounts?${params}`))
    const seen = new Set(ac.accounts.map((a) => a.id))
    ac.accounts = ac.accounts.concat(data.accounts.filter((a) => !seen.has(a.id)))
    ac.total = data.total
    state.currentAccounts = ac.accounts
    renderAccounts()
  } catch (err) {
    showError(getErrorMessage(err))
  }
}

/** Reload the list in place (after a change) and redraw. */
async function refreshAccounts() {
  try {
    await loadAccounts(ac.filter, ac.accounts.length)
  } catch {
    ac.key = ""
  }
  if (ac.sel) await showAccount(ac.sel, false)
  else renderAccounts()
}

/** @type {Types.AdminPanel["mount"]} */
async function mountAccounts(params, query, ctx) {
  const seq = ++ac.seq
  const switching = view !== "accounts"
  view = "accounts"
  showView()
  const f = readAccountsFilter(query)
  const key = accountsQuery(f) || "all"
  const fresh = !ctx.samePanel || switching || ac.key !== key
  ac.sel = accountRef(params.id ?? "") ?? 0
  ac.missing = false
  if (fresh) {
    ac.filter = f
    getElement("ac-head").innerHTML = accountsHeadMarkup()
    getElement("ac-rows").innerHTML = html`<li class="list-empty">
      <span class="spinner" aria-hidden="true"></span>Loading…
    </li>`
    getElement("ac-detail").innerHTML = ""
    try {
      await loadAccounts(f)
    } catch (err) {
      if (seq !== ac.seq) return
      ac.accounts = []
      ac.loadFailed = true
      ac.key = ""
      console.error("Couldn't load the accounts:", err)
    }
    if (seq !== ac.seq) return
  }
  if (!ac.sel && isWide() && ac.accounts.length > 0) {
    void navigate(accountHref(ac.accounts[0].id, f), { replace: true })
    return
  }
  if (!ctx.samePanel || ctx.replace || switching) getElement("ac-detail").scrollTop = 0
  if (ac.sel) await showAccount(ac.sel, true, seq)
  else {
    renderAccounts()
    setCrumbs([])
  }
}

/** Draw the account `id`, from the cache at once and fresh from the server.
 *  @param {number} id @param {boolean} reveal @param {number} [seq] */
async function showAccount(id, reveal, seq) {
  renderAccounts()
  if (reveal) revealAccount()
  const a = await fetchAccount(id)
  if (seq !== undefined && seq !== ac.seq) return
  if (view !== "accounts" || ac.sel !== id) return
  ac.missing = !a
  if (a) {
    const row = ac.accounts.find((x) => x.id === id)
    if (row) {
      row.trusted = a.trusted
      row.post_count = a.post_count
      row.pending_count = a.pending_count
    }
  }
  renderAccounts()
  setCrumbs(a ? [{ label: a.name }] : [])
}

const revealAccount = () => reveal("ac-list", "ac-rows")

function renderAccounts() {
  getElement("ac-split").classList.toggle("has-sel", !!ac.sel)
  getElement("ac-head").innerHTML = accountsHeadMarkup()
  getElement("ac-rows").innerHTML = accountRowsMarkup()
  getElement("ac-detail").innerHTML = accountDetailMarkup()
}

function accountsHeadMarkup() {
  const f = ac.filter
  const chips = /** @type {Array<[Types.AccountsFilter["trusted"], string]>} */ ([
    ["", "Everyone"],
    ["1", "Trusted"],
    ["0", "Not trusted yet"],
  ]).map(
    ([t, label]) =>
      html`<a class="chip" href="/admin/accounts${accountsQuery({ trusted: t })}" data-replace
        aria-current="${f.trusted === t ? "true" : "false"}">${label}</a>`,
  )
  return html`<h1>Accounts</h1>
    <p class="muted small">
      Guests who signed in to post. Trusted accounts skip review; approving someone's first
      post trusts them too.
    </p>
    <div class="chips" role="group" aria-label="Trust">${chips}</div>`
}

/** @param {Types.AccountRow} a */
function accountRowMarkup(a) {
  const on = a.id === ac.sel
  const sub = [
    plural(a.post_count, "post", "posts"),
    a.pending_count ? `${a.pending_count} waiting` : "",
    a.relation ?? "",
  ].filter((p) => p !== "")
  return html`<li>
    <a class="row" href="${accountHref(a.id, ac.filter)}" data-select aria-current="${on ? "true" : "false"}">
      <span class="avatar">${avatarArt(a.name)}</span>
      <span class="row-main">
        <span class="row-top"
          ><strong>${a.name}</strong>${a.trusted ? html`<span class="pill st-opened">Trusted</span>` : ""}</span
        >
        <span class="row-sub">${sub.join(" · ")}</span>
      </span>
    </a>
  </li>`
}

function accountRowsMarkup() {
  if (ac.loadFailed) {
    return html`<li class="list-empty">
      <p>Couldn't load the accounts.</p>
      <button type="button" class="btn btn-sm" data-ac="retry">Try again</button>
    </li>`
  }
  if (ac.accounts.length === 0) {
    return html`<li class="list-empty">
      ${ac.filter.trusted === "0"
        ? "Everyone who has posted is trusted."
        : ac.filter.trusted === "1"
          ? "Nobody is trusted yet."
          : "No one has signed in to post yet."}
    </li>`
  }
  return html`${ac.accounts.map(accountRowMarkup)}${ac.accounts.length < ac.total
    ? html`<li class="rows-more">
        <button type="button" class="btn btn-sm btn-block" data-ac="more">
          Load more (${ac.total - ac.accounts.length} left)
        </button>
      </li>`
    : ""}`
}

function accountDetailMarkup() {
  const back = html`<a class="m-back" href="/admin/accounts${accountsQuery(ac.filter)}" data-up
    >${icon("back")}Accounts</a
  >`
  if (!ac.sel) {
    return html`<div class="detail-empty">
      <p>${ac.accounts.length ? "Pick an account." : "Accounts appear once guests sign in to post."}</p>
    </div>`
  }
  const a = accountCache.get(ac.sel)
  if (!a) {
    return ac.missing
      ? html`${back}<div class="detail-empty"><p>That account no longer exists.</p></div>`
      : back
  }
  const c = a.counts
  const posts = [
    plural(a.post_count, "post", "posts"),
    c.pending ? `${c.pending} waiting` : "",
    c.hidden ? `${c.hidden} hidden` : "",
    c.rejected ? `${c.rejected} rejected` : "",
  ].filter((p) => p !== "")
  const seePosts = `/admin/review?author=a${a.id}${c.pending ? "" : "&status=approved"}`
  return html`${back}
    <article class="detail ac-detail">
      <header class="person-head">
        <span class="avatar avatar-xl">${avatarArt(a.name)}</span>
        <div>
          <h1>${a.name}</h1>
          <p class="muted">${a.relation ? `${a.relation} · ` : ""}Joined ${formatDate(a.created_at)}</p>
        </div>
      </header>
      <dl class="facts">
        <div>
          <dt>Trust</dt>
          <dd>${a.trusted ? "Trusted — skips review" : "Not yet"}</dd>
        </div>
        <div><dt>Posts</dt><dd>${posts.join(" · ")}</dd></div>
        <div>
          <dt>Signed in as</dt>
          <dd>${a.guest_id !== null ? `${a.source}'s party` : "Open sign-up"}</dd>
        </div>
        <div><dt>Recovery email</dt><dd class="fact-break">${a.contact_email || "—"}</dd></div>
      </dl>
      <div class="btn-row">
        ${a.trusted
          ? html`<button type="button" class="btn btn-sm" data-ac="untrust">Stop trusting <kbd>t</kbd></button>`
          : html`<button type="button" class="btn btn-sm" data-ac="trust">Trust <kbd>t</kbd></button>`}
        <a class="btn btn-sm" href="${seePosts}">See their posts</a>
        ${c.pending
          ? html`<button type="button" class="btn btn-sm" data-ac="approve-waiting">
              Approve their ${c.pending} waiting
            </button>`
          : ""}
        <button type="button" class="btn btn-sm btn-danger-soft" data-ac="delete">Delete account…</button>
      </div>
      <p class="muted small ac-note">
        ${a.trusted
          ? "Trust applies to new posts. Stopping it leaves what's already live alone."
          : "Trust applies to new posts. What's already waiting stays in Review until you decide it."}
      </p>
    </article>`
}

/** @param {Types.AccountDetail} a */
function deleteAccount(a) {
  openConfirm({
    title: `Delete ${a.name}'s account?`,
    desc:
      "Their approved posts come off the site and they're signed out everywhere. " +
      "Their files are kept, but there's no one-tap undo for this.",
    confirmLabel: "Delete account",
    danger: true,
    run: async () => {
      await api(`/api/admin/accounts/${a.id}`, { method: "DELETE" })
      accountCache.delete(a.id)
      rv.key = ""
      void loadModerationCount()
      const at = ac.accounts.findIndex((x) => x.id === a.id)
      ac.accounts = ac.accounts.filter((x) => x.id !== a.id)
      ac.total = Math.max(0, ac.total - 1)
      showSuccess(`Deleted ${a.name}'s account`)
      const next = ac.accounts[at] ?? ac.accounts[at - 1] ?? null
      if (currentPlace()?.route.tab !== "moderation" || view !== "accounts") return
      void navigate(
        next && isWide()
          ? accountHref(next.id, ac.filter)
          : "/admin/accounts" + accountsQuery(ac.filter),
        { replace: true },
      )
    },
  })
}

/** @param {MouseEvent} e */
function onAccountsClick(e) {
  const t = e.target
  if (!(t instanceof Element)) return
  const btn = t.closest("[data-ac]")
  if (!(btn instanceof HTMLElement)) return
  const what = btn.dataset.ac ?? ""
  const a = ac.sel ? accountCache.get(ac.sel) : undefined
  if (what === "more") void loadMoreAccounts()
  else if (what === "retry") {
    ac.key = ""
    const place = currentPlace()
    if (place) void mountAccounts(place.params, place.query, { ...place, samePanel: false })
  } else if (!a) return
  else if (what === "trust") void trustAccount(a.id, a.name)
  else if (what === "untrust") void untrustAccount(a.id, a.name)
  else if (what === "approve-waiting") void approveWaiting(a.id, a.name)
  else if (what === "delete") deleteAccount(a)
}

/** @param {KeyboardEvent} e */
function accountKeys(e) {
  if (e.shiftKey && e.key !== "?") return false
  const k = e.key
  if (k === "j" || k === "ArrowDown" || k === "k" || k === "ArrowUp") {
    const delta = k === "j" || k === "ArrowDown" ? 1 : -1
    const at = ac.accounts.findIndex((a) => a.id === ac.sel)
    const to = at === -1 ? (delta > 0 ? 0 : -1) : at + delta
    const next = ac.accounts[to]
    if (next) void navigate(accountHref(next.id, ac.filter), { replace: !!ac.sel })
    return true
  }
  const a = ac.sel ? accountCache.get(ac.sel) : undefined
  if (k === "t" && a) {
    if (a.trusted) void untrustAccount(a.id, a.name)
    else void trustAccount(a.id, a.name)
    return true
  }
  return false
}

// -------------------------------------------------------------------- init

/** @type {Types.loadModeration} */
export async function loadModeration() {
  // The router mounts this panel; a direct call just forces a fresh list.
  rv.key = ""
  ac.key = ""
  const place = currentPlace()
  if (place && place.route.tab === "moderation") {
    await panel.mount(place.params, place.query, { ...place, samePanel: false })
  }
}

const REVIEW_HELP = {
  title: "Review posts",
  keys: /** @type {Array<[string, string]>} */ ([
    ["j k", "Next / previous post"],
    ["a", "Approve"],
    ["h", "Hide — off the site, kept for you"],
    ["r", "Reject"],
    ["t", "Trust the author (new posts skip review)"],
    ["x", "Tick for the bulk bar"],
  ]),
}

const ACCOUNTS_HELP = {
  title: "Accounts",
  keys: /** @type {Array<[string, string]>} */ ([
    ["j k", "Next / previous account"],
    ["t", "Trust / stop trusting"],
  ]),
}

/** @type {Types.AdminPanel} */
const panel = {
  mount(params, query, ctx) {
    return ctx.route.sub === "accounts"
      ? mountAccounts(params, query, ctx)
      : mountReview(params, query, ctx)
  },
  keys(e) {
    return view === "accounts" ? accountKeys(e) : reviewKeys(e)
  },
  get help() {
    return view === "accounts" ? ACCOUNTS_HELP : REVIEW_HELP
  },
}

/** @type {Types.initModeration} */
export function initModeration() {
  registerPanel("moderation", panel)
  getElement("rv-split").addEventListener("click", onReviewClick)
  getElement("rv-rows").addEventListener("change", onTick)
  getElement("ac-split").addEventListener("click", onAccountsClick)
  getButtonElement("mod-confirm-btn").addEventListener("click", () => {
    void confirmRejectWithReason()
  })
}
