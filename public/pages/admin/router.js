/** @file The admin router and shell: real paths, Back that undoes navigation,
 *  the sidebar / phone bottom bar / More page, breadcrumbs, the leave guard,
 *  dialog routes and the keyboard. The contract for panel modules is in
 *  public/pages/admin/WORKSPACE.md.
 *
 *  Rules (prototypes/admin-workspace/IA.md §4, §6, §13.3):
 *   - Going somewhere is pushState. Moving a selection inside a list that
 *     already shows one, a redirect, a first load, a filter change are
 *     replaceState. Every place is a real <a href>; plain clicks are
 *     intercepted, cmd/ctrl/middle-click still open a new tab.
 *   - history.state = { idx, prev }. `idx` only ever grows, so a popstate knows
 *     how far it moved: a vetoed Back is undone with history.go(-delta), which
 *     keeps the forward stack. `prev` is the path this entry was pushed from,
 *     so up() can use history.back() and Close and Back agree.
 *   - A panel that registers (registerPanel) is mounted on every arrival at
 *     one of its routes; one that doesn't keeps its load*() (main.js), run
 *     when it is first shown.
 *   - Dialog routes draw their parent panel, then open their <dialog>.
 *     Closing the dialog goes up() to the parent; leaving the route closes it.
 *  No regex (CLAUDE.md). */
/** @import * as Types from './types.js' */

import {
  NAV,
  NAV_GROUPS,
  BOTTOM_NAV,
  ROUTES,
  matchRoute,
  pathFor,
  legacyHashRoute,
  navRoot,
  navHref,
  parentPath,
  redirectPath,
  crumbsFor,
} from "./routes.js"
import { openModal, closeModal, topModal, runUndo } from "./utils.js"
import { icon } from "./icons.js"
import { html, join, getButtonElement, getDialogElement, getElement } from "../utils.js"
import { toggleTheme } from "../../components/theme-toggle.js"

/** Below this width the sidebar is a bottom bar and /admin/more lists the rest.
 *  Matches the CSS breakpoint. */
const WIDE = "(min-width: 900px)"

/** Dialogs Back must never close: the leave guard is answering a navigation,
 *  and the re-login overlay can't be dismissed. */
const STICKY_DIALOGS = new Set(["admin-leave-modal", "reauth-modal"])

/** g-chords: go anywhere from anywhere. */
const CHORDS = /** @type {Record<string, string>} */ ({
  h: "home",
  r: "moderation",
  f: "faces",
  y: "gallery",
  g: "gifts",
  c: "thankyous",
  m: "replies",
  u: "guests",
  s: "site-content",
})

const MEMORY_KEY = "admin-sections"
const LAST_KEY = "admin-last"

/** @type {Map<string, Types.AdminPanel>} */
const panels = new Map()
/** @type {Set<Types.LeaveGuard>} */
const guards = new Set()
/** View scroll per history entry, so Back returns to where you were. */
const scrollByIdx = /** @type {Map<number, number>} */ (new Map())
/** Last path visited inside each section — the sidebar returns you there. */
const memory = readMemory()

/** @type {(tab: string) => void} */
let loadLegacy = () => {}
/** @type {Types.RouteContext | null} */
let current = null
/** @type {Types.RouteMatch | null} */
let currentMatch = null
/** Crumbs a panel set for the place it is showing (setCrumbs). */
/** @type {Types.Crumb[] | null} */
let trail = null
/** The dialog a dialog route opened, while it is open. */
/** @type {{ el: HTMLDialogElement, match: Types.RouteMatch, closing: boolean } | null} */
let routeDialog = null
let curIdx = 0
let started = false
/** Set while a vetoed Back is being undone, so that popstate is not re-handled. */
/** @type {(() => void) | null} */
let suppressPop = null
/** Set when the owner chose Discard on a Back, so the replayed move isn't asked again. */
let bypassGuard = false
let chord = ""
/** @type {ReturnType<typeof setTimeout> | undefined} */
let chordTimer

/** @returns {Record<string, string>} */
function readMemory() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(MEMORY_KEY) || "{}")
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

/** The scrolling element: the shell is fixed, only the view scrolls. */
function view() {
  return getElement("view")
}

const isWide = () => window.matchMedia(WIDE).matches

/** "/admin/x?y" → "/admin/x". @param {string} full */
function pathOnly(full) {
  const q = full.indexOf("?")
  return q === -1 ? full : full.slice(0, q)
}

const here = () => location.pathname + location.search

/** What a path shows, following aliases. Unknown paths land on Home.
 *  @param {string} full a /admin path, optionally with ?search */
function resolve(full) {
  let url = full
  let match = matchRoute(pathOnly(url))
  let redirected = false
  const to = match ? redirectPath(match) : null
  if (to !== null) {
    const q = url.indexOf("?")
    url = to + (q === -1 ? "" : url.slice(q))
    match = matchRoute(pathOnly(url))
    redirected = true
  }
  if (!match) return { match: { route: ROUTES[0], params: {} }, url: "/admin", redirected: true }
  return { match, url, redirected }
}

// ------------------------------------------------------------------- guards

/** The guard a move to `toUrl` (drawn by `toTab`) would trip, if any. Re-opening
 *  the place you're on reloads it, so that counts as leaving too.
 *  @param {string} toUrl @param {string} toTab @param {boolean} [reopen] */
function blockingGuard(toUrl, toTab, reopen = false) {
  if (!current || bypassGuard) return null
  for (const g of guards) {
    let leaving = false
    if (g.path !== undefined) {
      leaving = current.path.startsWith(g.path) && (reopen || !toUrl.startsWith(g.path))
    } else if (g.tab !== undefined) {
      leaving = current.route.tab === g.tab && (reopen || toTab !== g.tab)
    }
    if (leaving && g.dirty()) return g
  }
  return null
}

/** The in-app "Leave without saving?" — Keep editing / Discard / Save and
 *  leave (the last only when the guard can save). Resolves true to go on.
 *  @param {Types.LeaveGuard} g @returns {Promise<boolean>} */
function confirmLeave(g) {
  const dialog = getDialogElement("admin-leave-modal")
  getElement("admin-leave-desc").textContent = `Your changes to ${g.what} haven't been saved.`
  const discardBtn = getButtonElement("admin-leave-discard")
  const saveBtn = getButtonElement("admin-leave-save")
  const errorEl = getElement("admin-leave-error")
  errorEl.hidden = true
  saveBtn.hidden = !g.save
  saveBtn.disabled = false
  return new Promise((resolve) => {
    let proceed = false
    const onDiscard = () => {
      proceed = true
      g.discard?.()
      closeModal(dialog)
    }
    const onSave = async () => {
      if (!g.save) return
      saveBtn.disabled = true
      let ok = false
      try {
        ok = await g.save()
      } catch {
        ok = false
      }
      saveBtn.disabled = false
      if (ok) {
        proceed = true
        closeModal(dialog)
      } else {
        errorEl.textContent = "That didn't save. Keep editing to see what's wrong."
        errorEl.hidden = false
      }
    }
    const onSaveClick = () => void onSave()
    discardBtn.addEventListener("click", onDiscard)
    saveBtn.addEventListener("click", onSaveClick)
    dialog.addEventListener(
      "close",
      () => {
        discardBtn.removeEventListener("click", onDiscard)
        saveBtn.removeEventListener("click", onSaveClick)
        resolve(proceed)
      },
      { once: true },
    )
    openModal(dialog)
    // Keep editing is the safe default for Enter.
    getButtonElement("admin-leave-keep").focus()
  })
}

/** @type {Types.addGuard} */
export function addGuard(guard) {
  guards.add(guard)
  return () => {
    guards.delete(guard)
  }
}

/** @type {Types.registerPanel} */
export function registerPanel(tab, panel) {
  panels.set(tab, panel)
}

// -------------------------------------------------------------------- shell

/** The sidebar, drawn once from NAV. On phones the same links are the bottom
 *  bar (CSS shows only BOTTOM_NAV + More), so every badge exists exactly once. */
function renderNav() {
  const groups = NAV_GROUPS.map((group) => {
    const items = group.items.map((key) => {
      const item = NAV[key]
      return html`<li>
        <a
          class="nav-item ${BOTTOM_NAV.includes(key) ? "is-primary" : ""}"
          id="tab-btn-${key}"
          data-nav="${key}"
          href="${navRoot(key)}"
          title="${item.label}"
          >${icon(item.icon)}<span class="nav-label">${item.label}</span
          ><span class="nav-short">${item.short ?? item.label}</span>${item.badge
            ? html`<span class="count ${item.heart ? "count-heart" : ""}" id="${item.badge}" hidden
                >0</span
              >`
            : ""}</a
        >
      </li>`
    })
    return html`<div class="nav-group">
      ${group.label ? html`<h2 class="nav-heading">${group.label}</h2>` : ""}
      <ul>
        ${items}
      </ul>
    </div>`
  })
  getElement("admin-nav").innerHTML = html`${groups}<a
      class="nav-item nav-more"
      id="tab-btn-more"
      data-nav="more"
      href="/admin/more"
      >${icon("more")}<span class="nav-label">More</span><span class="nav-short">More</span
      ><span id="admin-nav-more-dot" class="nav-dot" hidden></span
    ></a>`
}

/** Phones: More gets a dot when something it holds (Replies, Requests…) has a
 *  badge showing. */
function updateMoreDot() {
  let waiting = false
  for (const key of Object.keys(NAV)) {
    const id = NAV[key].badge
    if (!id || BOTTOM_NAV.includes(key)) continue
    const el = document.getElementById(id)
    if (el && !el.hidden) waiting = true
  }
  const dot = getElement("admin-nav-more-dot")
  // Write only on a change: the dot is inside the observed nav, and every
  // `hidden` write is a mutation, so an unconditional write would loop.
  if (dot.hidden !== !waiting) dot.hidden = !waiting
}

/** A count is a bare number (the prototype's badges). Older modules write
 *  "♥ 2" into the Replies badge; keep just the digits. Rewriting only when
 *  something other than a digit is there ends the observer's loop. */
function bareCounts() {
  for (const el of getElement("admin-nav").querySelectorAll(".count")) {
    const text = el.textContent ?? ""
    const digits = [...text].filter((c) => c >= "0" && c <= "9").join("")
    if (digits !== text) el.textContent = digits || "0"
  }
}

/** @type {Types.setNavBadge} */
export function setNavBadge(key, count) {
  const id = NAV[key]?.badge
  const el = id ? document.getElementById(id) : null
  if (!el) return
  el.textContent = String(count)
  el.hidden = count <= 0
}

/** The badge a section shows right now, or 0. @param {string} key */
function badgeCount(key) {
  const id = NAV[key]?.badge
  const el = id ? document.getElementById(id) : null
  if (!el || el.hidden) return ""
  return (el.textContent ?? "").trim()
}

/** @type {Types.renderMore} */
export function renderMore() {
  const groups = NAV_GROUPS.map(
    (group) => html`<section class="more-group">
      ${group.label ? html`<h2>${group.label}</h2>` : ""}
      ${group.items.map((key) => {
        const item = NAV[key]
        const n = badgeCount(key)
        return html`<a class="more-item" href="${navHref(key, "more", memory)}"
          >${icon(item.icon)}<span>${item.label}</span>${n
            ? html`<span class="count ${item.heart ? "count-heart" : ""}">${n}</span>`
            : ""}</a
        >`
      })}
    </section>`,
  )
  getElement("admin-more-list").innerHTML = html`${groups}
    <section class="more-group">
      <h2>Settings</h2>
      <button type="button" class="more-item" data-more="theme">
        ${icon("moon")}<span>Light / dark</span>
      </button>
      <a class="more-item" href="/" target="_blank" rel="noopener"
        >${icon("external")}<span>View the site</span></a
      >
      <button type="button" class="more-item" data-more="signout">
        ${icon("signout")}<span>Sign out</span>
      </button>
    </section>`
}

/** @param {MouseEvent} e */
function onMoreClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return
  const btn = target.closest("[data-more]")
  if (!(btn instanceof HTMLElement)) return
  if (btn.dataset.more === "theme") toggleTheme()
  else if (btn.dataset.more === "signout") getButtonElement("logout-btn").click()
}

/** The breadcrumbs the current place shows. */
function currentCrumbs() {
  if (!currentMatch) return []
  // A dialog route is drawn over its parent: the trail is the parent's.
  const parent = parentPath(currentMatch)
  const base = parent ? crumbsFor(matchRoute(parent) ?? currentMatch) : crumbsFor(currentMatch)
  if (!trail) return base
  // A panel's trail replaces what follows the section crumb.
  const sectionAt = base.findIndex((c) => c.label === NAV[currentMatch?.route.nav ?? ""]?.label)
  const head = sectionAt === -1 ? base.slice(0, -1) : base.slice(0, sectionAt + 1)
  if (sectionAt !== -1 && trail.length > 0 && !head[sectionAt].href) {
    head[sectionAt] = { label: head[sectionAt].label, href: navRoot(currentMatch.route.nav) }
  }
  return [...head, ...trail]
}

function renderCrumbs() {
  const crumbs = currentCrumbs()
  getElement("crumbs").innerHTML = join(
    crumbs.map((c, i) =>
      i === crumbs.length - 1 || !c.href
        ? html`<li>
            <span aria-current="${i === crumbs.length - 1 ? "location" : "false"}">${c.label}</span>
          </li>`
        : html`<li><a href="${c.href}">${c.label}</a></li>`,
    ),
    "",
  )
  const last = crumbs.length > 0 ? crumbs[crumbs.length - 1].label : "Admin"
  const title = currentMatch?.route.dialog ? currentMatch.route.title : last
  document.title = `${title} · Admin`
}

/** @type {Types.setCrumbs} */
export function setCrumbs(next) {
  trail = next.length > 0 ? next : null
  renderCrumbs()
}

/** "Requests | Blocked": one job that is still two panels. @param {Types.AdminRoute} route */
function renderViewTabs(route) {
  const el = getElement("view-tabs")
  const tabs = NAV[route.nav]?.tabs
  if (!tabs || !tabs.includes(route.path)) {
    el.hidden = true
    el.innerHTML = ""
    return
  }
  el.setAttribute("aria-label", NAV[route.nav].label)
  el.innerHTML = join(
    tabs.map((p) => {
      const r = ROUTES.find((x) => x.path === p)
      if (!r) return ""
      const on = p === route.path ? "page" : "false"
      return html`<a href="${pathFor(r)}" aria-current="${on}">${r.title}</a>`
    }),
    "",
  )
  el.hidden = false
}

/** Light the section, refresh where every sidebar link goes, title the page.
 *  @param {Types.RouteContext} ctx @param {boolean} announce */
function chrome(ctx, announce) {
  const key = ctx.route.nav
  const remember = key !== "home" && key !== "more" && !ctx.route.dialog
  if (remember) {
    memory[key] = ctx.path
    try {
      sessionStorage.setItem(MEMORY_KEY, JSON.stringify(memory))
      localStorage.setItem(LAST_KEY, ctx.path)
    } catch {
      // Private mode: memory lasts as long as the page.
    }
  }
  const inBottom = BOTTOM_NAV.includes(key)
  for (const link of document.querySelectorAll("a[data-nav]")) {
    if (!(link instanceof HTMLAnchorElement)) continue
    const k = link.dataset.nav ?? ""
    const on = k === key || (k === "more" && !inBottom)
    link.classList.toggle("active", on)
    if (on) link.setAttribute("aria-current", "page")
    else link.removeAttribute("aria-current")
    if (k !== "more") link.setAttribute("href", navHref(k, key, memory))
  }
  document.body.dataset.section = key
  renderViewTabs(ctx.route)
  renderCrumbs()
  if (announce) getElement("route-live").textContent = document.title
}

/** Show exactly one panel. @param {string} tab */
function showOnly(tab) {
  for (const panel of document.querySelectorAll(".tab-content")) {
    if (!(panel instanceof HTMLElement)) continue
    const on = panel.id === `tab-${tab}`
    panel.hidden = !on
    panel.classList.toggle("active", on)
  }
  view().classList.toggle("is-fill", !!document.querySelector(".tab-content.active.panel-fill"))
}

// ------------------------------------------------------------ dialog routes

/** Leaving a dialog route (to anywhere but the same dialog) closes its dialog.
 *  @param {Types.RouteMatch} next */
function settleRouteDialog(next) {
  const rd = routeDialog
  if (!rd) return
  if (next.route.dialog === rd.el.id) {
    rd.match = next
    return
  }
  rd.closing = true
  routeDialog = null
  if (rd.el.open) closeModal(rd.el)
}

/** @param {Types.RouteMatch} match */
function openRouteDialog(match) {
  const id = match.route.dialog ?? ""
  const el = document.getElementById(id)
  if (!(el instanceof HTMLDialogElement)) return
  if (routeDialog && routeDialog.el === el) return
  const rd = { el, match, closing: false }
  routeDialog = rd
  el.addEventListener(
    "close",
    () => {
      if (routeDialog === rd) routeDialog = null
      if (rd.closing) return
      // Closed by the owner (✕, Cancel, Esc, backdrop): go up to the parent.
      // Opened from inside the same panel (a selected guest, a filtered
      // list), Close is Back — it returns to exactly that place.
      const parent = parentPath(rd.match)
      const prev = history.state && typeof history.state.prev === "string" ? history.state.prev : ""
      if (prev && matchRoute(pathOnly(prev))?.route.tab === rd.match.route.tab) history.back()
      else if (parent) up(parent)
    },
    { once: true },
  )
  if (!el.open) openModal(el)
}

// --------------------------------------------------------------- navigation

/** Render a place: its panel, its sub-view pill, its dialog, the chrome.
 *  @param {Types.RouteMatch} match @param {{ replace?: boolean, reopen?: boolean }} [opts] */
function apply(match, opts = {}) {
  const { route, params } = match
  if (route.tab === "more" && isWide()) {
    // The sidebar already shows everything; More is a phone page.
    void navigate("/admin", { replace: true })
    return
  }
  const prevTab = current?.route.tab ?? ""
  const samePanel = !opts.reopen && prevTab === route.tab
  settleRouteDialog(match)
  if (!samePanel && prevTab) panels.get(prevTab)?.unmount?.()
  trail = null

  /** @type {Types.RouteContext} */
  const ctx = {
    route,
    params,
    query: new URLSearchParams(location.search),
    path: here(),
    prev: history.state && typeof history.state.prev === "string" ? history.state.prev : null,
    samePanel,
    replace: !!opts.replace,
  }
  current = ctx
  currentMatch = match
  if (!samePanel) showOnly(route.tab)
  chrome(ctx, !opts.replace)

  const panel = panels.get(route.tab)
  if (panel) {
    Promise.resolve(panel.mount(params, ctx.query, ctx)).catch((err) => console.error(err))
  } else if (!samePanel) {
    loadLegacy(route.tab)
  }
  if (route.dialog) openRouteDialog(match)
}

/** @type {Types.navigate} */
export async function navigate(path, opts = {}) {
  const { match, url } = resolve(path)
  const replace = !!opts.replace
  const reopen = url === here() && !opts.replace
  if (opts.render !== false) {
    const g = blockingGuard(url, match.route.tab, reopen)
    if (g && !(await confirmLeave(g))) return
  }
  if (reopen) {
    // The place you're on: open it fresh, as the old tab buttons did.
    if (opts.render !== false) apply(match, { reopen: true })
    return
  }
  const prev = history.state && typeof history.state.prev === "string" ? history.state.prev : null
  if (replace) {
    history.replaceState({ idx: curIdx, prev }, "", url)
  } else {
    scrollByIdx.set(curIdx, view().scrollTop)
    curIdx += 1
    history.pushState({ idx: curIdx, prev: here() }, "", url)
  }
  if (opts.render === false) {
    const ctx = current
    if (ctx) {
      current = { ...ctx, route: match.route, params: match.params, path: here() }
      currentMatch = match
      chrome(current, false)
    }
    return
  }
  apply(match, { replace })
  // A new place starts at its top, not wherever the last one was scrolled.
  if (!replace) view().scrollTop = 0
}

/** @type {Types.up} */
export function up(fallback) {
  const st = history.state
  if (st && typeof st.prev === "string" && pathOnly(st.prev) === pathOnly(fallback)) {
    history.back()
  } else {
    void navigate(fallback, { replace: true })
  }
}

/** @type {Types.currentPlace} */
export function currentPlace() {
  return current
}

/** Put the view back where it was for history entry `idx`. Panels load
 *  asynchronously, so try again once the content has had a moment to arrive.
 *  @param {number} idx */
function restoreScroll(idx) {
  const y = scrollByIdx.get(idx) ?? 0
  const el = view()
  el.scrollTop = y
  if (y > 0) {
    setTimeout(() => {
      if (Math.abs(el.scrollTop - y) > 2) el.scrollTop = y
    }, 500)
  }
}

/** Wait for our own history.go() to land. @param {number} delta */
function rewind(delta) {
  return new Promise((done) => {
    suppressPop = () => done(undefined)
    history.go(delta)
  })
}

/** @param {PopStateEvent} e */
async function onPopState(e) {
  if (suppressPop) {
    const done = suppressPop
    suppressPop = null
    done()
    return
  }
  const idx = e.state && typeof e.state.idx === "number" ? e.state.idx : 0
  const delta = idx - curIdx
  const { match } = resolve(here())

  // Back with a plain dialog open closes the dialog (a phone's back gesture,
  // most of all) instead of swapping the section out from under it. A dialog
  // ROUTE is different: Back is how it closes, so let the move through.
  const dialog = topModal() ?? document.querySelector("dialog#reauth-modal[open]")
  const isRouteDialog = routeDialog !== null && dialog === routeDialog.el
  if (dialog && delta !== 0 && !isRouteDialog) {
    await rewind(-delta)
    if (dialog instanceof HTMLDialogElement && !STICKY_DIALOGS.has(dialog.id)) closeModal(dialog)
    return
  }

  const g = blockingGuard(here(), match.route.tab)
  if (g && delta !== 0) {
    // popstate can't be cancelled — the URL has already moved. Put it back,
    // wait for that to land, ask, and only then replay the move.
    await rewind(-delta)
    if (!(await confirmLeave(g))) return
    bypassGuard = true
    history.go(delta)
    return
  }
  bypassGuard = false
  scrollByIdx.set(curIdx, view().scrollTop)
  curIdx = idx
  apply(match)
  restoreScroll(idx)
}

/** Plain left-clicks on /admin links become in-app navigations.
 *  `data-up` → up(); `data-replace` → replace; `data-select` → replace when
 *  the list already shows a selection. @param {MouseEvent} e */
function onDocumentClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const link = target.closest("a[href]")
  if (!(link instanceof HTMLAnchorElement)) return
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    return
  }
  if (link.target && link.target !== "_self") return
  if (link.origin !== location.origin) return
  const path = link.pathname
  if (path !== "/admin" && !path.startsWith("/admin/")) return
  e.preventDefault()
  const to = path + link.search
  if (link.hasAttribute("data-up")) {
    up(to)
    return
  }
  const sel = current?.route.sel
  const replace =
    link.hasAttribute("data-replace") ||
    (link.hasAttribute("data-select") && !!sel && !!current?.params[sel])
  void navigate(to, { replace })
}

// --------------------------------------------------------------------- keys

/** The ? sheet: the shell's keys, plus the showing panel's. */
function toggleKeys() {
  const dialog = getDialogElement("admin-keys-modal")
  if (dialog.open) {
    closeModal(dialog)
    return
  }
  const help = current ? panels.get(current.route.tab)?.help : undefined
  getElement("admin-keys-panel").innerHTML = help
    ? html`<dl>
        <dt>${help.title}</dt>
        ${help.keys.map(
          ([keys, what]) =>
            html`<dd>${keys.split(" ").map((k) => html`<kbd>${k}</kbd> `)}${what}</dd>`,
        )}
      </dl>`
    : ""
  openModal(dialog)
}

/** @param {KeyboardEvent} e */
function onKeyDown(e) {
  if (!getElement("dashboard-section").classList.contains("active")) return
  if (document.querySelector("#admin-leave-modal[open], #reauth-modal[open]")) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const t = e.target
  const typing =
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  if (typing) {
    if (e.key === "Escape" && t instanceof HTMLElement && !t.closest("dialog")) t.blur()
    return
  }
  if (chord === "g") {
    chord = ""
    clearTimeout(chordTimer)
    const key = CHORDS[e.key]
    if (key) {
      e.preventDefault()
      void navigate(navHref(key, current?.route.nav ?? "", memory))
    }
    return
  }
  if (e.key === "?") {
    e.preventDefault()
    toggleKeys()
    return
  }
  // A dialog owns the keyboard (Esc closes it natively).
  if (topModal()) return
  if (e.key === "g") {
    chord = "g"
    clearTimeout(chordTimer)
    chordTimer = setTimeout(() => (chord = ""), 1200)
    return
  }
  if (e.key === "z" && runUndo()) {
    e.preventDefault()
    return
  }
  const panel = current ? panels.get(current.route.tab) : undefined
  if (current && panel?.keys && panel.keys(e, current)) {
    e.preventDefault()
    return
  }
  // Phones: Esc on an item goes back to its list.
  const sel = current?.route.sel
  if (e.key === "Escape" && current && sel && current.params[sel] && !isWide()) {
    up(pathOnly(current.path).split("/").slice(0, -1).join("/"))
  }
}

// ---------------------------------------------------------------- lifecycle

/** @type {Types.initRouter} */
export function initRouter(load) {
  loadLegacy = load
  renderNav()
  // The router puts the scroll back itself, after the panel has rendered.
  history.scrollRestoration = "manual"
  document.addEventListener("click", onDocumentClick)
  document.addEventListener("keydown", onKeyDown)
  window.addEventListener("popstate", (e) => void onPopState(e))
  getElement("tab-more").addEventListener("click", onMoreClick)
  getButtonElement("admin-keys-btn").addEventListener("click", toggleKeys)
  // Badges are shown and hidden by each module; More's dot (and the More page,
  // if it is showing) follow them.
  new MutationObserver((records) => {
    const touched = records.some((r) => {
      const el = r.target instanceof Element ? r.target : r.target.parentElement
      return el !== null && el.classList.contains("count")
    })
    if (!touched) return
    bareCounts()
    updateMoreDot()
    if (current?.route.tab === "more") renderMore()
  }).observe(getElement("admin-nav"), {
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
    characterData: true,
    childList: true,
  })
  updateMoreDot()
  // Crossing the breakpoint: More only exists on phones.
  window.matchMedia(WIDE).addEventListener("change", () => {
    if (current?.route.tab === "more" && isWide()) void navigate("/admin", { replace: true })
  })
}

/** @type {Types.startRouter} */
export function startRouter() {
  // An old #tab link (digest email, bookmark) lands on its path; an unknown
  // /admin/... path lands on Home. Both are replaces, never a dead entry.
  const legacy = legacyHashRoute(location.hash)
  const resolved = legacy ? resolve(pathFor(legacy)) : resolve(here())
  if (!started) {
    started = true
    curIdx = 0
    history.replaceState({ idx: 0, prev: null }, "", resolved.url)
  } else if (resolved.url !== here()) {
    history.replaceState({ idx: curIdx, prev: null }, "", resolved.url)
  }
  current = null
  currentMatch = null
  apply(resolved.match, { replace: true })
}
