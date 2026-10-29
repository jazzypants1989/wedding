/** @file Workspace admin prototype: the router, the shell (sidebar, top bar,
 *  bottom bar), dialogs-as-routes, the navigation guard, keyboard.
 *
 *  ROUTING RULES (IA.md §4 is the long form):
 *   - Every place is a real path and a real <a href>. Clicks are intercepted;
 *     middle-click / cmd-click still open a new tab.
 *   - Going somewhere is pushState. Moving the selection inside a list that is
 *     already showing a selection is replaceState ("Back undoes navigation, not
 *     motion"). Auto-selecting the first item on a wide screen is replaceState.
 *   - history.state = { idx, prev }. `idx` lets popstate know how far it moved
 *     so a vetoed Back can be reverted with history.go(-delta) without losing
 *     the forward stack; `prev` lets "close"/"up" use history.back() when the
 *     previous entry is where we're going, so Back and Close agree.
 *   - Dialog routes render their parent route underneath, then the dialog. */

import {
  BASE, href, esc, hooks, actions, guard, confirmBox, toast, runUndo, session, showRelogin, wide,
} from "./ui.js"
import { store, save, pendingReview, groupsLeft, askLeft, drafts, unreadReplies, giftsUnthanked } from "./data.js"
import { icon } from "./art.js"
import { homeRoutes } from "./views/home.js"
import { reviewRoutes } from "./views/review.js"
import { facesRoutes } from "./views/faces.js"
import { thanksRoutes } from "./views/thanks.js"
import { miscRoutes } from "./views/misc.js"

/** @typedef {{ params: Record<string, string>, query: URLSearchParams, path: string, prev: string | null }} Ctx */
/** @typedef {{ pattern: string, section: string, title: (c: Ctx) => string, render: (c: Ctx) => string | { redirect: string }, crumbs?: (c: Ctx) => Array<{ label: string, to?: string }>, mount?: (c: Ctx) => void, keys?: (e: KeyboardEvent, c: Ctx) => boolean, sel?: string, parent?: (c: Ctx) => string }} Route */

/** @type {Route[]} */
const ROUTES = [...homeRoutes, ...reviewRoutes, ...facesRoutes, ...thanksRoutes, ...miscRoutes]

// ---------------------------------------------------------------- navigation

/** @type {Record<string, { label: string, to: string, icon: any, count?: () => number, heart?: boolean }>} */
const NAV = {
  home: { label: "Home", to: "/", icon: "home" },
  review: { label: "Review posts", to: "/review", icon: "review", count: () => pendingReview().length },
  faces: { label: "Name faces", to: "/faces", icon: "faces", count: () => groupsLeft().length + askLeft().length },
  gallery: { label: "Gallery", to: "/gallery", icon: "gallery" },
  gifts: { label: "Gifts", to: "/gifts", icon: "gifts", count: () => giftsUnthanked().length },
  cards: { label: "Cards", to: "/cards", icon: "cards", count: () => drafts().length },
  replies: { label: "Replies", to: "/replies", icon: "replies", count: () => unreadReplies().length, heart: true },
  guests: { label: "Guests & RSVPs", to: "/guests", icon: "guests" },
  requests: { label: "Requests", to: "/requests", icon: "requests", count: () => 1 },
  accounts: { label: "Accounts", to: "/accounts", icon: "accounts" },
  content: { label: "Site content", to: "/site/content", icon: "content" },
  effects: { label: "Effects", to: "/site/effects", icon: "effects" },
}

/** Mode-aware grouping: the same items, re-ordered so the season's work is on top. */
const GROUPS = {
  post: [
    { label: "", items: ["home"] },
    { label: "Memories", items: ["review", "faces", "gallery"] },
    { label: "Thank-yous", items: ["gifts", "cards", "replies"] },
    { label: "Guest list", items: ["guests", "accounts", "requests"] },
    { label: "Site", items: ["content", "effects"] },
  ],
  pre: [
    { label: "", items: ["home"] },
    { label: "Guest list", items: ["guests", "requests", "accounts"] },
    { label: "Site", items: ["content", "effects"] },
    { label: "Memories", items: ["review", "gallery", "faces"] },
    { label: "Thank-yous", items: ["gifts", "cards", "replies"] },
  ],
}
const BOTTOM = {
  post: ["home", "review", "faces", "cards"],
  pre: ["home", "guests", "requests", "content"],
}

/** Last path visited inside each section — the sidebar returns you there. */
/** @type {Record<string, string>} */
const sectionMemory = JSON.parse(sessionStorage.getItem("ws-sections") || "{}")

/** @param {string} key */
function navHref(key, current = "") {
  const item = NAV[key]
  const remembered = sectionMemory[key]
  // Already in the section → the item takes you to its root. Elsewhere → back
  // to exactly where you left it.
  if (remembered && current !== key) return remembered
  return item.to
}

function renderNav(/** @type {string} */ section) {
  const mode = /** @type {"pre" | "post"} */ (store.mode)
  const groups = GROUPS[mode]
    .map((g) => {
      const items = g.items
        .map((k) => {
          const it = NAV[k]
          const n = it.count ? it.count() : 0
          return `<li><a href="${href(navHref(k, section))}" class="nav-item" data-section="${k}" ${k === section ? 'aria-current="page"' : ""} title="${esc(it.label)}">
            ${icon(it.icon)}<span class="nav-label">${esc(it.label)}</span>
            ${n ? `<span class="count ${it.heart ? "count-heart" : ""}" aria-label="${n} waiting">${n}</span>` : ""}
          </a></li>`
        })
        .join("")
      return `<div class="nav-group">${g.label ? `<h2 class="nav-heading">${g.label}</h2>` : ""}<ul>${items}</ul></div>`
    })
    .join("")
  const side = document.getElementById("sidebar-nav")
  if (side) side.innerHTML = groups
  const modeLabel = document.getElementById("mode-label")
  if (modeLabel) modeLabel.textContent = mode === "post" ? "After the wedding" : "Before the wedding"

  const bottom = document.getElementById("bottombar")
  if (bottom) {
    const inMain = BOTTOM[mode].includes(section)
    bottom.innerHTML =
      BOTTOM[mode]
        .map((k) => {
          const it = NAV[k]
          const n = it.count ? it.count() : 0
          return `<a href="${href(navHref(k, section))}" data-section="${k}" ${k === section ? 'aria-current="page"' : ""}>
          ${icon(it.icon)}<span>${esc(it.label.split(" ")[0] === "Name" ? "Faces" : it.label.split(" ")[0])}</span>${n ? `<span class="count">${n}</span>` : ""}</a>`
        })
        .join("") +
      `<a href="${href("/more")}" data-section="more" ${!inMain ? 'aria-current="page"' : ""}>${icon("more")}<span>More</span></a>`
  }
}

/** The full grouped tree as a page — phones reach everything not on the bottom bar here. */
export function moreMarkup() {
  const mode = /** @type {"pre" | "post"} */ (store.mode)
  return GROUPS[mode]
    .map(
      (g) => `<section class="more-group">${g.label ? `<h2>${g.label}</h2>` : ""}
      ${g.items
        .map((k) => {
          const it = NAV[k]
          const n = it.count ? it.count() : 0
          return `<a class="more-item" href="${href(navHref(k))}">${icon(it.icon)}<span>${esc(it.label)}</span>${n ? `<span class="count">${n}</span>` : ""}</a>`
        })
        .join("")}</section>`,
    )
    .join("")
}

// -------------------------------------------------------------------- router

/** @param {string} pattern @param {string} path */
function matchPattern(pattern, path) {
  const ps = pattern.split("/").filter(Boolean)
  const xs = path.split("/").filter(Boolean)
  if (ps.length !== xs.length) return null
  /** @type {Record<string, string>} */
  const params = {}
  for (let i = 0; i < ps.length; i++) {
    if (ps[i].startsWith(":")) params[ps[i].slice(1)] = decodeURIComponent(xs[i])
    else if (ps[i] !== xs[i]) return null
  }
  return params
}

/** @param {string} path */
function match(path) {
  for (const r of ROUTES) {
    const params = matchPattern(r.pattern, path)
    if (params) return { route: r, params }
  }
  return null
}

/** App path (without BASE) + search, from location. */
function appPath() {
  const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname
  return (p === "" ? "/" : p) + location.search
}
/** @param {string} full */
const pathOnly = (full) => (full.includes("?") ? full.slice(0, full.indexOf("?")) : full)

let curIdx = 0
let suppressPop = 0
/** @type {Route | null} */
let curRoute = null
/** @type {Ctx | null} */
let curCtx = null

/** @param {string} to */
async function passGuard(to) {
  const g = guard.current
  if (!g || !g.dirty() || pathOnly(to).startsWith(g.path)) return true
  const ok = await confirmBox({
    title: "Leave without saving?",
    body: `Your changes to ${g.what} haven't been saved.`,
    ok: "Discard changes",
    cancel: "Keep editing",
    danger: true,
  })
  if (ok) guard.current = null
  return ok
}

/** @param {string} to @param {{ replace?: boolean }} [opts] */
async function navigate(to, opts = {}) {
  const from = appPath()
  if (to === from && !opts.replace) return
  if (!(await passGuard(to))) return
  const st = history.state || { idx: curIdx, prev: null }
  const state = opts.replace ? { idx: curIdx, prev: st.prev } : { idx: curIdx + 1, prev: from }
  if (opts.replace) history.replaceState(state, "", href(to))
  else history.pushState(state, "", href(to))
  curIdx = state.idx
  render()
}

window.addEventListener("popstate", async (e) => {
  if (suppressPop > 0) {
    suppressPop--
    return
  }
  const idx = e.state && typeof e.state.idx === "number" ? e.state.idx : 0
  const delta = idx - curIdx
  const g = guard.current
  if (g && g.dirty() && delta !== 0 && !pathOnly(appPath()).startsWith(g.path)) {
    // popstate cannot be cancelled: the URL has already moved. Put it back
    // first (go(-delta) keeps the forward stack, unlike a re-push), ask, and
    // only then replay the move.
    suppressPop++
    history.go(-delta)
    const ok = await confirmBox({
      title: "Leave without saving?",
      body: `Your changes to ${g.what} haven't been saved.`,
      ok: "Discard changes",
      cancel: "Keep editing",
      danger: true,
    })
    if (ok) {
      guard.current = null
      history.go(delta)
    }
    return
  }
  curIdx = idx
  render()
})

window.addEventListener("beforeunload", (e) => {
  const g = guard.current
  if (g && g.dirty()) e.preventDefault()
})

/** @param {string} fallback */
function up(fallback) {
  const st = history.state
  if (st && st.prev === fallback) history.back()
  else navigate(fallback, { replace: true })
}

hooks.navigate = navigate
hooks.rerender = () => render(true)
hooks.up = up
hooks.currentPath = () => appPath()

// -------------------------------------------------------------------- render

const scrollKeep = new Map()

function render(inPlace = false) {
  const full = appPath()
  const path = pathOnly(full)
  const query = new URLSearchParams(location.search)
  const m = match(path)
  const view = /** @type {HTMLElement} */ (document.getElementById("view"))
  const dialogRoot = /** @type {HTMLElement} */ (document.getElementById("dialog-root"))
  const st = history.state
  /** @type {Ctx} */
  const ctx = { params: m ? m.params : {}, query, path, prev: st && st.prev ? st.prev : null }

  if (!m) {
    view.innerHTML = `<div class="empty"><h1>Nothing here</h1><p>No admin page lives at <code>${esc(path)}</code>.</p><a class="btn btn-primary" href="${href("/")}">Go home</a></div>`
    return
  }

  let route = m.route
  let body = ""
  let dialog = ""
  /** @type {Route | null} */
  let underRoute = null
  if (route.parent) {
    const parentPath = route.parent(ctx)
    const pm = match(pathOnly(parentPath))
    if (pm) {
      underRoute = pm.route
      const pctx = { ...ctx, params: pm.params, path: pathOnly(parentPath) }
      const out = pm.route.render(pctx)
      body = typeof out === "string" ? out : ""
    }
    const d = route.render(ctx)
    if (typeof d !== "string") {
      navigate(d.redirect, { replace: true })
      return
    }
    dialog = d
  } else {
    const out = route.render(ctx)
    if (typeof out !== "string") {
      navigate(out.redirect, { replace: true })
      return
    }
    body = out
  }

  // keep pane scroll across re-renders of the same section
  const sameSection = curRoute && curRoute.section === route.section
  view.querySelectorAll("[data-keep-scroll]").forEach((el) => {
    scrollKeep.set(/** @type {HTMLElement} */ (el).dataset.keepScroll, el.scrollTop)
  })
  view.innerHTML = body
  if (sameSection || inPlace) {
    view.querySelectorAll("[data-keep-scroll]").forEach((el) => {
      const k = /** @type {HTMLElement} */ (el).dataset.keepScroll || ""
      if (scrollKeep.has(k) && k !== "detail") el.scrollTop = scrollKeep.get(k)
    })
  }
  const sel = view.querySelector('.pane-list [aria-current="true"]')
  if (sel) sel.scrollIntoView({ block: "nearest" })

  // dialog
  const open = dialogRoot.querySelector("dialog")
  if (dialog) {
    dialogRoot.innerHTML = `<dialog class="route-dialog" aria-labelledby="dlg-title">${dialog}</dialog>`
    const dlg = /** @type {HTMLDialogElement} */ (dialogRoot.querySelector("dialog"))
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault()
      closeDialog()
    })
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) closeDialog()
    })
    dlg.showModal()
    const af = /** @type {HTMLElement | null} */ (dlg.querySelector("[autofocus], [data-autofocus]"))
    if (af) af.focus()
  } else if (open) {
    dialogRoot.innerHTML = ""
  }

  // chrome
  const section = route.section
  if (route.section !== "more" && route.section !== "home") {
    sectionMemory[section] = full
    sessionStorage.setItem("ws-sections", JSON.stringify(sectionMemory))
  }
  if (section !== "home" && section !== "more") localStorage.setItem("ws-last", full)
  renderNav(section)
  const crumbs = (route.crumbs || (underRoute && underRoute.crumbs) || (() => []))(ctx)
  const bc = document.getElementById("crumbs")
  if (bc) {
    bc.innerHTML = crumbs
      .map((c, i) =>
        i === crumbs.length - 1 || !c.to
          ? `<li><span aria-current="${i === crumbs.length - 1 ? "location" : "false"}">${esc(c.label)}</span></li>`
          : `<li><a href="${href(c.to)}">${esc(c.label)}</a></li>`,
      )
      .join("")
  }
  const title = route.title(ctx)
  if (!inPlace) {
    document.title = title + " · Admin"
    const live = document.getElementById("route-live")
    if (live) live.textContent = title
  }
  document.body.dataset.section = section

  if (guard.current && !path.startsWith(guard.current.path)) guard.current = null
  curRoute = route
  curCtx = ctx
  if (route.mount) route.mount(ctx)
  else if (underRoute && underRoute.mount) underRoute.mount({ ...ctx })
  save()
}

function closeDialog() {
  if (!curRoute || !curRoute.parent || !curCtx) return
  up(curRoute.parent(curCtx))
}

// ------------------------------------------------------------------- events

document.addEventListener("click", (e) => {
  const t = /** @type {HTMLElement} */ (e.target)
  const act = /** @type {HTMLElement | null} */ (t.closest("[data-action]"))
  if (act && act.dataset.action && actions[act.dataset.action]) {
    e.preventDefault()
    actions[act.dataset.action](act, e)
    return
  }
  if (t.closest("[data-close]")) {
    e.preventDefault()
    closeDialog()
    return
  }
  const a = /** @type {HTMLAnchorElement | null} */ (t.closest("a[href]"))
  if (!a) return
  const me = /** @type {MouseEvent} */ (e)
  if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0 || a.target) return
  const url = new URL(a.href)
  if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return
  e.preventDefault()
  const to = (url.pathname.slice(BASE.length) || "/") + url.search
  if (a.hasAttribute("data-up")) {
    up(to)
    return
  }
  // Selecting a sibling inside a list that already shows a selection is motion,
  // not navigation: replace, so Back leaves the list instead of replaying it.
  const selKey = curRoute && curRoute.sel
  const replace = a.hasAttribute("data-replace") || (a.hasAttribute("data-select") && !!selKey && !!(curCtx && curCtx.params[selKey]))
  navigate(to, { replace })
})

// Forms in the prototype never submit to a server.
document.addEventListener("submit", (e) => {
  const f = /** @type {HTMLFormElement} */ (e.target)
  if (f.method !== "dialog") e.preventDefault()
})

let chord = ""
let chordTimer = 0
/** g-chords: go anywhere from anywhere. */
const CHORDS = /** @type {Record<string, string>} */ ({
  h: "home", r: "review", f: "faces", y: "gallery", g: "gifts", c: "cards", m: "replies", u: "guests", s: "content",
})

document.addEventListener("keydown", (e) => {
  const t = /** @type {HTMLElement} */ (e.target)
  const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable
  if (document.querySelector("dialog[open].confirm, dialog[open].relogin")) return
  if (typing && e.key !== "Escape") return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (typing && e.key === "Escape") {
    t.blur()
    return
  }
  if (chord === "g") {
    chord = ""
    const k = CHORDS[e.key]
    if (k) {
      e.preventDefault()
      navigate(navHref(k))
    }
    return
  }
  if (e.key === "g") {
    chord = "g"
    clearTimeout(chordTimer)
    chordTimer = window.setTimeout(() => (chord = ""), 1200)
    return
  }
  if (e.key === "?") {
    e.preventDefault()
    toggleHelp()
    return
  }
  if (e.key === "z" && runUndo()) {
    e.preventDefault()
    return
  }
  if (document.querySelector("#dialog-root dialog[open]")) {
    if (curRoute && curRoute.keys && curCtx && curRoute.keys(e, curCtx)) e.preventDefault()
    return
  }
  if (curRoute && curRoute.keys && curCtx && curRoute.keys(e, curCtx)) {
    e.preventDefault()
    return
  }
  if (e.key === "Escape" && curCtx && curRoute && curRoute.sel && curCtx.params[curRoute.sel] && !wide()) {
    const listPath = curCtx.path.split("/").slice(0, -1).join("/") || "/"
    up(listPath)
  }
})

function toggleHelp() {
  const existing = document.getElementById("help")
  if (existing) {
    existing.remove()
    return
  }
  const d = document.createElement("dialog")
  d.id = "help"
  d.className = "help"
  d.innerHTML = `<h2>Keyboard</h2>
    <div class="help-cols">
      <dl><dt>Anywhere</dt>
        <dd><kbd>g</kbd> <kbd>h</kbd> Home</dd><dd><kbd>g</kbd> <kbd>r</kbd> Review posts</dd>
        <dd><kbd>g</kbd> <kbd>f</kbd> Name faces</dd><dd><kbd>g</kbd> <kbd>c</kbd> Cards</dd>
        <dd><kbd>g</kbd> <kbd>g</kbd> Gifts</dd><dd><kbd>g</kbd> <kbd>m</kbd> Replies</dd>
        <dd><kbd>z</kbd> Undo last action</dd><dd><kbd>?</kbd> This sheet</dd></dl>
      <dl><dt>Any list</dt>
        <dd><kbd>j</kbd> / <kbd>k</kbd> Next / previous</dd><dd><kbd>x</kbd> Tick for bulk</dd>
        <dd><kbd>Esc</kbd> Close / back to list</dd></dl>
      <dl><dt>Review posts</dt>
        <dd><kbd>a</kbd> Approve</dd><dd><kbd>h</kbd> Hide</dd><dd><kbd>r</kbd> Reject</dd><dd><kbd>t</kbd> Trust author</dd></dl>
      <dl><dt>Name faces</dt>
        <dd><kbd>Enter</kbd> Yes, that's them</dd><dd><kbd>1</kbd>–<kbd>3</kbd> Pick a suggestion</dd>
        <dd><kbd>/</kbd> Someone else…</dd><dd><kbd>←</kbd> <kbd>→</kbd> Faces in the group</dd>
        <dd><kbd>e</kbd> Leave this face out</dd><dd><kbd>s</kbd> Skip group</dd></dl>
    </div>
    <form method="dialog"><button class="btn">Close</button></form>`
  document.body.append(d)
  d.addEventListener("close", () => d.remove())
  d.showModal()
}

// --------------------------------------------------------------- chrome bits

actions["theme"] = () => {
  const root = document.documentElement
  const next = root.dataset.theme === "dark" ? "light" : "dark"
  root.dataset.theme = next
  localStorage.setItem("ws-theme", next)
}
actions["mode"] = () => {
  store.mode = store.mode === "post" ? "pre" : "post"
  render(true)
  toast(store.mode === "post" ? "Showing after-the-wedding order" : "Showing before-the-wedding order")
}
actions["expire"] = () => {
  session.expired = true
  toast("Session expired (simulated). Your next action will ask you to sign in.")
}
actions["expire-now"] = () => {
  session.expired = true
  showRelogin()
}
actions["help"] = () => toggleHelp()
actions["reset"] = () => {
  sessionStorage.clear()
  localStorage.removeItem("ws-last")
  location.href = href("/")
}

const savedTheme = localStorage.getItem("ws-theme")
if (savedTheme) document.documentElement.dataset.theme = savedTheme
else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark"

if (location.search.includes("reset")) {
  history.replaceState({ idx: 0, prev: null }, "", location.pathname)
  sessionStorage.removeItem("ws-sections")
}
if (!history.state || typeof history.state.idx !== "number") {
  history.replaceState({ idx: 0, prev: null }, "", location.href)
}
curIdx = history.state.idx
render()
// Re-render on breakpoint change: list views auto-select on wide screens only.
matchMedia("(min-width: 900px)").addEventListener("change", () => render(true))
