/** @file Small shared UI helpers: escaping, icons, toasts with Undo, meters,
 *  the flow bar, and the session-expiry "act" wrapper. No regex. */

import { state, save } from "./data.js"
import { href, returnTo, previousPath } from "./router.js"

/** @param {unknown} v */
export function esc(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const ICONS = {
  today: "M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  review: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  faces: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6",
  gallery: "M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01",
  cards: "M4 6h16v12H4zM4 7l8 6 8-6",
  gifts: "M4 10h16v10H4zM2 7h20v3H2zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0",
  mailbox: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8Z",
  guests: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21c0-4 3-6 7-6s7 2 7 6M17 3.5a4 4 0 0 1 0 7M22 21c0-3-2-5-4-5.5",
  rsvps: "M8 2v4M16 2v4M3 8h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 15l2 2 4-4",
  requests: "M12 5v14M5 12h14",
  accounts: "M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z",
  blocklist: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8",
  content: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
  effects: "M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM21 21l-5-5",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12l5 5 9-10",
  moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z",
  back: "M15 18l-6-6 6-6",
  next: "M9 6l6 6-6 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2",
}

/** @param {keyof typeof ICONS | string} name @param {number} [size] */
export function icon(name, size = 18) {
  const d = ICONS[/** @type {keyof typeof ICONS} */ (name)] || ""
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
}

// ---- toasts ---------------------------------------------------------------

/** @param {string} msg @param {{ undo?: () => void, ms?: number }} [opts] */
export function toast(msg, opts = {}) {
  const host = document.getElementById("toasts")
  if (!host) return
  // One toast at a time: a fast run of decisions shows the latest, and Z
  // undoes the latest. A stack of ten toasts is noise.
  for (const old of host.querySelectorAll(".toast")) old.remove()
  const el = document.createElement("div")
  el.className = "toast"
  el.innerHTML = `<span>${msg}</span>${opts.undo ? `<button type="button" class="toast-undo">Undo <kbd>Z</kbd></button>` : ""}`
  host.append(el)
  let gone = false
  const close = () => {
    if (gone) return
    gone = true
    el.classList.add("is-leaving")
    setTimeout(() => el.remove(), 250)
    if (lastUndo === undoFn) lastUndo = null
  }
  const undoFn = opts.undo
    ? () => {
        opts.undo?.()
        close()
      }
    : null
  if (undoFn) {
    lastUndo = undoFn
    el.querySelector(".toast-undo")?.addEventListener("click", undoFn)
  }
  setTimeout(close, opts.ms || 6000)
}
/** @type {null | (() => void)} */
let lastUndo = null
export function runLastUndo() {
  if (lastUndo) {
    lastUndo()
    return true
  }
  return false
}

// ---- meters ---------------------------------------------------------------

export function meter(value, max, cls = "") {
  const pct = max > 0 ? Math.round((value / max) * 100) : 100
  return `<span class="meter ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${value}"><span style="width:${pct}%"></span></span>`
}

export function ring(value, max, size = 64) {
  const pct = max > 0 ? value / max : 1
  const r = 26
  const c = 2 * Math.PI * r
  return `<svg class="ring" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" class="ring-track"/>
    <circle cx="32" cy="32" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="37" text-anchor="middle" class="ring-text">${Math.round(pct * 100)}%</text>
  </svg>`
}

// ---- flow bar -------------------------------------------------------------

/**
 * The strip across the top of every step-by-step screen: where you are, how
 * far along, and one obvious way out. ✕ goes back to wherever you started the
 * run (Today, usually) — by history.back() when that is where Back lands.
 * @param {{ label: string, pos?: number, total?: number, exitTo: string, extra?: string }} o
 */
export function flowBar(o) {
  const prev = previousPath()
  const exit = prev === "/" ? "/" : o.exitTo
  const exitName = exit === "/" ? "Today" : o.label
  const progress =
    o.total !== undefined && o.pos !== undefined
      ? `<span class="flow-pos">${o.pos} of ${o.total}</span>${meter(o.pos - 1, o.total, "flow-meter")}`
      : ""
  return `<div class="flowbar ${progress ? "has-pos" : ""}">
    <button type="button" class="flow-exit" data-exit="${esc(exit)}" aria-label="Exit to ${esc(exitName)}" title="Exit (Esc)">${icon("close")}</button>
    <span class="flow-label">${esc(o.label)}</span>
    ${progress}
    <span class="flow-extra">${o.extra || ""}</span>
  </div>`
}

/** Wire the ✕ in a flow bar. */
export function wireFlowExit(root) {
  root.querySelector(".flow-exit")?.addEventListener("click", (e) => {
    const t = /** @type {HTMLElement} */ (e.currentTarget)
    returnTo(t.dataset.exit || "/")
  })
}

export function link(to, text, cls = "") {
  return `<a href="${href(to)}" class="${cls}">${text}</a>`
}

export function kbd(k) {
  return `<kbd>${esc(k)}</kbd>`
}

// ---- re-render hook (set by app.js; avoids a circular import) ------------

/** @type {() => void} */
let rerenderFn = () => {}
export function setRerender(fn) {
  rerenderFn = fn
}
export function rerender() {
  rerenderFn()
}

export function plural(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`
}

// ---- session expiry -------------------------------------------------------

/** @type {Array<() => void>} */
const queued = []

/**
 * Run a mutation "against the server". If the (simulated) session has
 * expired, the mutation is queued, the re-login overlay opens over the
 * untouched screen, and the queue replays after sign-in. The route, the
 * scroll position and any half-typed input are never touched.
 * @param {() => void} fn
 */
export function act(fn) {
  if (state.expireArmed) {
    queued.push(fn)
    showRelogin()
    return
  }
  fn()
}

function showRelogin() {
  const host = document.getElementById("relogin")
  if (!host || !host.hidden) return
  host.hidden = false
  document.getElementById("app")?.setAttribute("inert", "")
  host.innerHTML = `<div class="relogin-card" role="dialog" aria-modal="true" aria-labelledby="relogin-title">
    <h2 id="relogin-title">Still there?</h2>
    <p>You were away long enough that we signed you out. Sign back in and you'll pick up exactly here —
      <strong>your last action hasn't been lost; it will finish as soon as you're back.</strong></p>
    <form class="relogin-form">
      <label for="relogin-pw">Admin password</label>
      <input id="relogin-pw" type="password" autocomplete="current-password" placeholder="anything works in the demo" />
      <button class="btn btn-primary" type="submit">Sign in and continue</button>
    </form>
  </div>`
  const input = /** @type {HTMLInputElement} */ (host.querySelector("#relogin-pw"))
  input.focus()
  host.querySelector("form")?.addEventListener("submit", (e) => {
    e.preventDefault()
    state.expireArmed = false
    save()
    host.hidden = true
    host.innerHTML = ""
    document.getElementById("app")?.removeAttribute("inert")
    const n = queued.length
    while (queued.length) queued.shift()?.()
    toast(n ? "Signed back in — and finished what you were doing." : "Signed back in.")
  })
}
