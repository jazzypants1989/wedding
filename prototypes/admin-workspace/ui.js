/** @file Shared helpers for the Workspace prototype: escaping, links, the
 *  split-view frame, toasts, the in-app confirm, the session wrapper. Views
 *  import from here only; app.js fills in `hooks` at boot so nothing imports
 *  the router directly (no import cycles). */

/** Where the prototype is mounted. In the real app this is "/admin". */
export const BASE = "/admin-workspace"

/** @param {string} p an app path like "/review/photo-401" */
export const href = (p) => BASE + p

/** @param {unknown} s */
export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/** Filled in by app.js. */
export const hooks = {
  /** @type {(path: string, opts?: { replace?: boolean }) => void} */
  navigate: () => {},
  /** Re-render the current route in place (after a data change). */
  rerender: () => {},
  /** Go "up": history.back() when the previous entry IS `fallback`, else
   *  replace to it. Used by mobile back chevrons and dialog close.
   *  @type {(fallback: string) => void} */
  up: () => {},
  /** @type {() => string} */
  currentPath: () => "/",
}

/** Delegated click actions: `data-action="name"` → actions[name](el, event). */
/** @type {Record<string, (el: HTMLElement, e: Event) => void>} */
export const actions = {}

/** Phone vs. split. Matches the CSS breakpoint. */
export const wide = () => matchMedia("(min-width: 900px)").matches

/** Navigation guard. A view with unsaved work sets this in its mount(). */
export const guard = {
  /** @type {null | { path: string, dirty: () => boolean, what: string }} */
  current: null,
}

/**
 * The list → detail frame. On a phone only one pane shows: the list when
 * nothing is selected, the detail when something is.
 * @param {{ list: string, detail: string, selected: boolean, label: string, cls?: string }} o
 */
export function split(o) {
  return `<div class="split ${o.selected ? "has-sel" : ""} ${o.cls || ""}">
    <section class="pane pane-list" aria-label="${esc(o.label)}" data-keep-scroll="list">${o.list}</section>
    <section class="pane pane-detail" aria-label="Selected item" data-keep-scroll="detail">${o.detail}</section>
  </div>`
}

/** Mobile-only back chevron for a detail pane. `to` is the list it returns to.
 *  @param {string} to @param {string} label */
export function mBack(to, label) {
  return `<a class="m-back" href="${href(to)}" data-up>
    <svg class="icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4l-6 6 6 6"/></svg>${esc(label)}</a>`
}

/** @param {string} k */
export const kbd = (k) => `<kbd>${esc(k)}</kbd>`

let toastTimer = 0
/** @param {string} msg @param {(() => void) | null} [undo] */
export function toast(msg, undo = null) {
  const root = document.getElementById("toast-root")
  if (!root) return
  root.innerHTML = `<div class="toast" role="status">
    <span>${esc(msg)}</span>
    ${undo ? `<button type="button" class="toast-undo">Undo <kbd>z</kbd></button>` : ""}
  </div>`
  const btn = root.querySelector(".toast-undo")
  lastUndo = undo
  if (btn && undo) {
    btn.addEventListener("click", () => runUndo())
  }
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    root.innerHTML = ""
    lastUndo = null
  }, 6000)
}

/** @type {null | (() => void)} */
let lastUndo = null
export function runUndo() {
  if (!lastUndo) return false
  const fn = lastUndo
  lastUndo = null
  fn()
  const root = document.getElementById("toast-root")
  if (root) root.innerHTML = `<div class="toast" role="status"><span>Undone</span></div>`
  hooks.rerender()
  return true
}

/**
 * In-app confirm. Deliberately NOT a route: it asks a question about a
 * navigation that is in flight, so giving it a history entry of its own would
 * be the thing being navigated.
 * @param {{ title: string, body: string, ok: string, cancel: string, danger?: boolean }} o
 * @returns {Promise<boolean>}
 */
export function confirmBox(o) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog")
    dlg.className = "confirm"
    dlg.innerHTML = `<h2>${esc(o.title)}</h2><p>${esc(o.body)}</p>
      <div class="dlg-actions">
        <button type="button" class="btn" value="no">${esc(o.cancel)}</button>
        <button type="button" class="btn ${o.danger ? "btn-danger" : "btn-primary"}" value="yes">${esc(o.ok)}</button>
      </div>`
    document.body.append(dlg)
    /** @param {boolean} v */
    const done = (v) => {
      dlg.close()
      dlg.remove()
      resolve(v)
    }
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault()
      done(false)
    })
    dlg.addEventListener("click", (e) => {
      const t = /** @type {HTMLElement} */ (e.target)
      const b = t.closest("button")
      if (b) done(b.value === "yes")
    })
    dlg.showModal()
    const first = dlg.querySelector("button")
    if (first) first.focus()
  })
}

/** Session state. Expiry never navigates: it raises an overlay over whatever
 *  is on screen, and the action that hit it is replayed after re-login. */
export const session = {
  expired: false,
  /** @type {Array<() => void>} */
  queued: [],
}

/** Run a mutating action, or queue it behind the re-login overlay.
 *  @param {() => void} fn */
export function withSession(fn) {
  if (!session.expired) {
    fn()
    return
  }
  session.queued.push(fn)
  showRelogin()
}

export function showRelogin() {
  if (document.getElementById("relogin")) return
  const dlg = document.createElement("dialog")
  dlg.id = "relogin"
  dlg.className = "relogin"
  const waiting = session.queued.length
  dlg.innerHTML = `<form method="dialog">
      <h2>You were signed out</h2>
      <p>Thirty quiet minutes ends the session. Everything on screen is still here —
      sign in and you'll carry on from <strong>${esc(hooks.currentPath())}</strong>${waiting ? `, and the action you just took (${waiting}) will finish` : ""}.</p>
      <label>Password <input type="password" name="pw" autocomplete="current-password" required></label>
      <div class="dlg-actions"><button class="btn btn-primary" type="submit">Sign back in</button></div>
    </form>`
  document.body.append(dlg)
  dlg.addEventListener("cancel", (e) => e.preventDefault())
  dlg.querySelector("form")?.addEventListener("submit", () => {
    session.expired = false
    dlg.remove()
    document.body.classList.remove("is-expired")
    const q = session.queued.splice(0)
    for (const fn of q) fn()
    if (q.length) hooks.rerender()
    toast("Signed back in — right where you were")
  })
  document.body.classList.add("is-expired")
  dlg.showModal()
}

/** A count badge, or nothing for zero. @param {number} n @param {string} [cls] */
export const badge = (n, cls = "") => (n > 0 ? `<span class="count ${cls}">${n}</span>` : "")

/** A pill-row of links (segmented control) whose current item is marked.
 *  @param {Array<{ label: string, to: string, n?: number, on: boolean }>} items @param {string} label */
export function seg(items, label) {
  return `<nav class="seg" aria-label="${esc(label)}">${items
    .map(
      (i) =>
        `<a href="${href(i.to)}" ${i.on ? 'aria-current="page"' : ""}>${esc(i.label)}${i.n ? ` <span class="seg-n">${i.n}</span>` : ""}</a>`,
    )
    .join("")}</nav>`
}
