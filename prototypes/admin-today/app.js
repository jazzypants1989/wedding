/** @file Shell: sidebar / phone bars, route rendering (pages + dialog routes),
 *  the command palette, keyboard help, the unsaved-changes guard dialog, the
 *  global keyboard map and the prototype's dev strip. */

import { state, save, reset } from "./data.js"
import {
  start,
  match,
  navigate,
  currentPath,
  currentQuery,
  overlayState,
  openOverlay,
  closeOverlay,
  previousPath,
  returnTo,
  setGuard,
  href,
} from "./router.js"
import "./views-core.js"
import "./views-faces.js"
import "./views-thanks.js"
import "./views-misc.js"
import { NAV, bottomItems, CHORDS } from "./nav.js"
import { tasks } from "./views-core.js"
import { esc, icon, toast, setRerender, runLastUndo, kbd } from "./ui.js"

const $ = (s) => /** @type {HTMLElement} */ (document.querySelector(s))

// ---- theme --------------------------------------------------------------------

function initTheme() {
  let t = null
  try {
    t = localStorage.getItem("theme")
  } catch {
    // ignore
  }
  if (!t) t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  document.documentElement.dataset.theme = t
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem("theme", next)
  } catch {
    // ignore
  }
  renderChrome(lastCtx)
}

// ---- chrome (sidebar, phone bars, dev strip) ------------------------------------

/** @type {any} */
let lastCtx = null

function renderChrome(ctx) {
  const active = ctx && ctx.view ? ctx.view.nav : ""
  const groups = NAV()
  $("#side-nav").innerHTML = groups
    .map(
      (g) => `<div class="nav-group">${g.label ? `<p class="nav-label">${g.label}</p>` : ""}<ul>${g.items
        .map(
          (it) => `<li><a href="${href(it.to)}" class="nav-item ${it.key === active ? "is-on" : ""}" ${it.key === active ? 'aria-current="page"' : ""}>
          ${icon(it.icon)}<span>${it.label}</span>${it.badge ? `<span class="badge ${it.key === "today" ? "badge-strong" : ""}">${it.badge}</span>` : ""}</a></li>`,
        )
        .join("")}</ul></div>`,
    )
    .join("")
  const dark = document.documentElement.dataset.theme === "dark"
  $("#side-foot").innerHTML = `<button type="button" class="nav-item theme-btn">${icon(dark ? "today" : "moon")}<span>${dark ? "Light" : "Dark"} mode</span></button>`
  $("#side-foot .theme-btn").addEventListener("click", toggleTheme)

  const onMore = active === "more"
  $("#bottombar").innerHTML =
    bottomItems()
      .map(
        (it) => `<a href="${href(it.to)}" class="bb-item ${it.key === active ? "is-on" : ""}" ${it.key === active ? 'aria-current="page"' : ""}>${icon(it.icon, 22)}<span>${it.label === "Review queue" ? "Review" : it.label}</span>${it.badge ? `<span class="bb-badge">${String(it.badge).split(" ")[0]}</span>` : ""}</a>`,
      )
      .join("") +
    `<a href="${href("/more")}" class="bb-item ${onMore || !bottomItems().some((b) => b.key === active) ? "is-on" : ""}">${icon("menu", 22)}<span>More</span></a>`

  const title = ctx && ctx.view ? ctx.view.title(ctx) : ""
  $("#topbar-title").textContent = title

  $("#dev-route").textContent = "/admin" + (currentPath() === "/" ? "" : currentPath()) + location.search
  $("#dev-mode").textContent = state.mode === "post" ? "Mode: after wedding" : "Mode: before wedding"
}

// ---- rendering routes -------------------------------------------------------------

/** @type {{ key: string, idx: number } | null} */
let lastPage = null
/** @type {Record<string, number>} */
const scrollByIdx = {}

function pageKey(path, query) {
  const q = query.toString()
  return path + (q ? "?" + q : "")
}

function renderPage(view, ctx) {
  setGuard(null)
  const main = $("#view")
  main.innerHTML = view.render(ctx)
  document.body.classList.toggle("is-flow", Boolean(view.flow))
  view.mount?.(main, ctx)
}

let lastNav = ""
function onRender(m) {
  const idx = history.state ? history.state.idx : 0
  // An Undo belongs to the area it was offered in; leaving the area drops it
  // (except arriving back on Today, which is where finished tasks return).
  if (m.view.nav !== lastNav) {
    if (lastNav && m.view.nav !== "today") for (const t of document.querySelectorAll(".toast")) t.remove()
    lastNav = m.view.nav
  }
  if (lastPage) scrollByIdx[lastPage.idx] = scrollY
  const ctx = { ...m, query: currentQuery() }
  lastCtx = ctx
  const layer = $("#dialog-layer")

  if (m.view.dialog) {
    // A dialog route draws over the page you came from; on a cold load (or a
    // shared link) it draws over its declared parent instead.
    if (!lastPage) {
      const parentPath = m.view.parent(ctx)
      const pm = match(parentPath)
      if (pm) {
        renderPage(pm.view, { ...pm, query: new URLSearchParams() })
        lastPage = { key: parentPath, idx }
      }
    }
    layer.hidden = false
    layer.innerHTML = m.view.render(ctx)
    m.view.mount?.(layer, ctx)
    wireDialog(layer, m.view, ctx)
    const first = layer.querySelector(
      "input, select, textarea, a.btn, button:not(.dialog-close):not(.dialog-cancel)",
    )
    const target = first instanceof HTMLElement ? first : layer.querySelector(".dialog-close")
    requestAnimationFrame(() => /** @type {HTMLElement | null} */ (target)?.focus())
  } else {
    const key = pageKey(m.path, ctx.query)
    const wasDialog = !layer.hidden
    const hadOverlay = !$("#overlay-layer").hidden
    layer.hidden = true
    layer.innerHTML = ""
    // Opening/closing a dialog or the palette over the same page keeps the
    // page exactly as it was — half-typed text included.
    const keep = lastPage && lastPage.key === key && (wasDialog || hadOverlay || m.overlay)
    if (!keep) {
      const sameScreen = lastPage && lastPage.key.split("?")[0] === m.path
      renderPage(m.view, ctx)
      if (!sameScreen) {
        scrollTo(0, scrollByIdx[idx] || 0)
        const h = $("#view h1")
        if (h) {
          h.tabIndex = -1
          h.focus({ preventScroll: true })
        }
      }
    }
    lastPage = { key, idx }
  }

  renderOverlay(m.overlay)
  renderChrome(ctx)
  document.title = `${m.view.title(ctx)} · Admin`
}

function closeDialog(view, ctx) {
  const prev = previousPath()
  const pm = prev ? match(prev) : null
  if (pm && !pm.view.dialog) history.back()
  else navigate(view.parent(ctx), { replace: true })
}

function wireDialog(layer, view, ctx) {
  const close = () => closeDialog(view, ctx)
  layer.querySelectorAll(".dialog-close, .dialog-cancel").forEach((b) => b.addEventListener("click", close))
  layer.onclick = (e) => {
    if (e.target === layer) close()
  }
}

function rerender() {
  const m = match(currentPath()) || match("/404")
  if (!m) return
  const ctx = { ...m, path: currentPath(), query: currentQuery(), overlay: overlayState() }
  lastCtx = ctx
  if (m.view.dialog) onRender(ctx)
  else {
    renderPage(m.view, ctx)
    renderChrome(ctx)
  }
}

// ---- overlays: palette + help -------------------------------------------------------

function paletteItems() {
  /** @type {{ label: string, sub: string, to: string, icon: string }[]} */
  const items = []
  for (const t of tasks()) items.push({ label: t.title, sub: "Today", to: t.to, icon: t.icon })
  for (const g of NAV()) for (const it of g.items) items.push({ label: it.label, sub: g.label || "Home", to: it.to, icon: it.icon })
  const extra = [
    ["Add a gift", "Thank-yous", "/thanks/gifts/new", "gifts"],
    ["Send finished cards", "Thank-yous", "/thanks/send", "cards"],
    ["Name face groups", "Faces", "/faces/groups", "faces"],
    ["Quick confirms", "Faces", "/faces/ask", "faces"],
    ["Same moment", "Faces", "/faces/moments", "faces"],
    ["Set-aside photos", "Faces", "/faces/set-aside", "faces"],
    ["People in photos", "Faces", "/faces/people", "faces"],
    ["Undo a naming pass (History)", "Faces", "/faces/history", "faces"],
    ["Add a guest", "Guests", "/guests/new", "guests"],
    ["Import guests from CSV", "Guests", "/guests/import", "guests"],
    ["Send invites", "Guests", "/guests/invite", "guests"],
    ["Add official photos", "Gallery", "/gallery/upload", "gallery"],
    ["Most loved photos", "Gallery", "/gallery/loved", "gallery"],
    ["Everything", "All sections", "/more", "menu"],
  ]
  for (const [label, sub, to, ic] of extra) items.push({ label, sub, to, icon: ic })
  for (const g of state.guests) items.push({ label: g.name, sub: "Guest", to: `/guests/${g.id}`, icon: "guests" })
  for (const p of state.people) items.push({ label: p.name, sub: "Person in photos", to: `/faces/people/${p.id}`, icon: "faces" })
  for (const c of state.cards) {
    const g = state.guests.find((x) => x.id === c.guestId)
    items.push({ label: `Card for ${g?.name}`, sub: c.status === "draft" ? "Draft card" : "Sent card", to: `/thanks/cards/${c.id}`, icon: "cards" })
  }
  return items
}

/** No regex: every whitespace-separated word must appear somewhere. */
function filterItems(items, q) {
  const words = q.toLowerCase().split(" ").filter(Boolean)
  if (!words.length) return items.slice(0, 9)
  const scored = []
  for (const it of items) {
    const hay = (it.label + " " + it.sub).toLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    const starts = it.label.toLowerCase().startsWith(words[0]) ? 0 : 1
    scored.push({ it, s: starts })
  }
  scored.sort((a, b) => a.s - b.s)
  return scored.slice(0, 9).map((x) => x.it)
}

let palSel = 0
function renderOverlay(name) {
  const layer = $("#overlay-layer")
  if (!name) {
    layer.hidden = true
    layer.innerHTML = ""
    return
  }
  layer.hidden = false
  if (name === "palette") {
    layer.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Jump to">
      <div class="pal-input-row">${icon("search")}<input class="pal-input" placeholder="Jump to… a section, a guest, a card, a task" aria-label="Jump to" autocomplete="off" /><kbd>Esc</kbd></div>
      <ul class="pal-list" role="listbox"></ul>
      <p class="pal-foot">${kbd("↑")}${kbd("↓")} choose · ${kbd("⏎")} go · Back or ${kbd("Esc")} closes</p></div>`
    const input = /** @type {HTMLInputElement} */ (layer.querySelector(".pal-input"))
    const list = /** @type {HTMLElement} */ (layer.querySelector(".pal-list"))
    const all = paletteItems()
    let shown = filterItems(all, "")
    const draw = () => {
      list.innerHTML = shown
        .map((it, i) => `<li role="option" aria-selected="${i === palSel}" class="${i === palSel ? "is-sel" : ""}" data-i="${i}">${icon(it.icon)}<span>${esc(it.label)}</span><span class="pal-sub">${esc(it.sub)}</span></li>`)
        .join("") || `<li class="pal-empty">Nothing matches.</li>`
    }
    palSel = 0
    draw()
    input.focus()
    input.addEventListener("input", () => {
      shown = filterItems(all, input.value)
      palSel = 0
      draw()
    })
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") palSel = Math.min(shown.length - 1, palSel + 1)
      else if (e.key === "ArrowUp") palSel = Math.max(0, palSel - 1)
      else if (e.key === "Enter" && shown[palSel]) {
        // Otherwise the Enter's default action lands on whatever the new
        // screen focuses (a dialog's first button) and presses it.
        e.preventDefault()
        navigate(shown[palSel].to)
        return
      } else return
      e.preventDefault()
      draw()
    })
    list.addEventListener("click", (e) => {
      const li = /** @type {Element} */ (e.target).closest("li[data-i]")
      if (li) navigate(shown[Number(/** @type {HTMLElement} */ (li).dataset.i)].to)
    })
  } else if (name === "help") {
    const row = (k, d) => `<tr><td>${k}</td><td>${d}</td></tr>`
    layer.innerHTML = `<div class="palette help" role="dialog" aria-modal="true" aria-labelledby="help-h">
      <header class="dialog-head"><h2 id="help-h">Keyboard</h2><button type="button" class="dialog-close" aria-label="Close">${icon("close")}</button></header>
      <div class="help-cols"><table><tbody>
      ${row(`${kbd("/")} or ${kbd("⌘K")}`, "Jump anywhere")}
      ${row(kbd("?"), "This list")}
      ${row(`${kbd("g")} ${kbd("t")}`, "Today")}
      ${row(`${kbd("g")} ${kbd("r")}`, "Review queue")}
      ${row(`${kbd("g")} ${kbd("f")}`, "Faces")}
      ${row(`${kbd("g")} ${kbd("c")} / ${kbd("m")}`, "Cards / Mailbox")}
      ${row(`${kbd("g")} ${kbd("g")}`, "Guest list")}
      ${row(kbd("Z"), "Undo the last thing")}
      ${row(kbd("Esc"), "Close / leave a flow")}
      </tbody></table><table><tbody>
      ${row(kbd("⏎"), "Today: start the top task")}
      ${row(`${kbd("A")} ${kbd("H")} ${kbd("R")}`, "Review: approve / hide / reject")}
      ${row(`${kbd("J")} ${kbd("K")}`, "Review: skip / previous")}
      ${row(`${kbd("←")} ${kbd("→")}`, "Faces: previous / next face")}
      ${row(`${kbd("X")}`, "Faces: not this person")}
      ${row(`${kbd("[")} ${kbd("]")}`, "Faces: previous / skip group")}
      ${row(`${kbd("1")} ${kbd("2")}`, "Quick confirms: pick a name")}
      ${row(`${kbd("⌘S")}`, "Composer: save")}
      </tbody></table></div></div>`
    layer.querySelector(".dialog-close")?.addEventListener("click", closeOverlay)
  }
  layer.onclick = (e) => {
    if (e.target === layer) closeOverlay()
  }
}

// ---- the guard dialog ------------------------------------------------------------------

function onGuard(g, proceed) {
  const host = $("#guard-layer")
  host.hidden = false
  host.innerHTML = `<div class="dialog-card guard" role="alertdialog" aria-modal="true" aria-labelledby="guard-h" aria-describedby="guard-d">
    <h2 id="guard-h">Leave without saving?</h2>
    <p id="guard-d">${esc(g.message)}</p>
    <div class="dialog-actions"><button type="button" class="btn btn-ghost g-discard">Discard changes</button>
    <button type="button" class="btn btn-secondary g-stay">Keep editing</button>
    ${g.save ? `<button type="button" class="btn btn-primary g-save">Save and go</button>` : ""}</div></div>`
  const done = () => {
    host.hidden = true
    host.innerHTML = ""
  }
  /** @type {HTMLElement} */ (host.querySelector(".g-stay")).focus()
  host.querySelector(".g-stay")?.addEventListener("click", done)
  host.querySelector(".g-discard")?.addEventListener("click", () => {
    done()
    proceed()
  })
  host.querySelector(".g-save")?.addEventListener("click", () => {
    done()
    g.save()
    proceed()
  })
}

// ---- keyboard -----------------------------------------------------------------------------

let pendingG = false
function onKey(e) {
  if (!$("#relogin").hidden) return
  if (!$("#guard-layer").hidden) {
    if (e.key === "Escape") /** @type {HTMLElement} */ ($("#guard-layer .g-stay")).click()
    return
  }
  const ov = overlayState()
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault()
    if (ov === "palette") closeOverlay()
    else openOverlay("palette")
    return
  }
  if (ov) {
    if (e.key === "Escape") {
      e.preventDefault()
      closeOverlay()
    }
    return
  }
  const t = /** @type {HTMLElement} */ (e.target)
  const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable
  if (typing) {
    if (e.key === "Escape") t.blur()
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const ctx = lastCtx
  if (pendingG) {
    pendingG = false
    const to = CHORDS[/** @type {keyof typeof CHORDS} */ (e.key)]
    if (to) {
      e.preventDefault()
      navigate(to)
    }
    return
  }
  if (e.key === "/") {
    e.preventDefault()
    openOverlay("palette")
  } else if (e.key === "?") openOverlay("help")
  else if (e.key === "g") {
    pendingG = true
    setTimeout(() => (pendingG = false), 1200)
  } else if (e.key === "z" || e.key === "Z") runLastUndo()
  else if (e.key === "Escape") {
    if (ctx && ctx.view.dialog) closeDialog(ctx.view, ctx)
    else /** @type {HTMLElement | null} */ (document.querySelector(".flow-exit"))?.click()
  } else if (ctx && ctx.view.keys) {
    // Enter only means "go" when nothing focusable has focus.
    if (e.key === "Enter" && t !== document.body && t.id !== "view" && t.tagName !== "H1") return
    if (ctx.view.keys(e, ctx)) e.preventDefault()
  }
}

// ---- boot ------------------------------------------------------------------------------------

function boot() {
  initTheme()
  setRerender(rerender)
  document.addEventListener("keydown", onKey)
  document.addEventListener("badges", () => renderChrome(lastCtx))
  $("#search-btn").addEventListener("click", () => openOverlay("palette"))
  $("#topbar-search").addEventListener("click", () => openOverlay("palette"))
  $("#dev-mode").addEventListener("click", () => {
    state.mode = state.mode === "post" ? "pre" : "post"
    save()
    rerender()
  })
  $("#dev-expire").addEventListener("click", () => {
    state.expireArmed = true
    save()
    toast("Session expired (simulated). Your next action will ask you to sign in — and then finish.")
  })
  $("#dev-reset").addEventListener("click", () => {
    reset()
    sessionStorage.removeItem("admin-today-entries")
    location.href = href("/")
  })
  start({ onRender, onGuard })
}

boot()
