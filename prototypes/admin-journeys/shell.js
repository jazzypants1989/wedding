/** @file The frame every screen sits in: sidebar (desktop) / tab bar (phone),
 *  the journey stepper, the step's exposition, the sticky action bar, toasts,
 *  the leave-guard dialog and the re-login overlay. */

import { html, raw, esc } from "./html.js"
import { db, save } from "./data.js"
import { JOURNEYS, SITE_TOOLS, journeyById, orderedJourneys, journeyProgress } from "./journeys.js"

/**
 * @typedef {import("./html.js").Raw} Raw
 * @typedef {{ label: string, to: string, ready?: boolean }} NavTarget
 * @typedef {{
 *   journey?: string, step?: string, tool?: string, title: string, heading?: Raw | string,
 *   body: Raw, wide?: boolean, introOverride?: Raw, compactIntro?: boolean,
 *   prev?: NavTarget | null, next?: NavTarget | null, status?: string, abRight?: Raw, abWork?: Raw,
 *   acts?: Record<string, (el: HTMLElement, ev: Event) => void>,
 *   keys?: Record<string, () => void>,
 *   mount?: (root: HTMLElement) => void,
 *   guard?: import("./router.js").Guard,
 *   dialog?: { title: string, body: Raw, acts?: Record<string, (el: HTMLElement, ev: Event) => void>, mount?: (root: HTMLElement) => void } | null,
 *   bare?: boolean,
 * }} Screen
 */

/** @param {string} p */
export const L = (p) => "/admin-journeys" + p

// ---------------- sidebar ----------------

/** @param {Screen} s */
function sidebar(s) {
  const { now, later } = orderedJourneys()
  /** @param {any} j @param {boolean} dim */
  const item = (j, dim) => {
    const active = s.journey === j.id
    const pr = journeyProgress(j)
    const badge = j.badge ? j.badge() : ""
    const pct = Math.round(pr.pct * 100)
    const steps = active
      ? html`<ol class="side-steps">
          ${j.steps.map(
            (/** @type {any} */ st, /** @type {number} */ i) => html`<li>
              <a href="${L(st.path)}" class="${s.step === st.id ? "on" : ""} ${pr.states[i].done ? "done" : ""}"
                aria-current="${s.step === st.id ? "page" : "false"}"
                ><span class="n">${pr.states[i].done ? raw("&#10003;") : i + 1}</span>${st.title}</a>
            </li>`,
          )}
        </ol>`
      : ""
    if (j.when === "pre" && db.mode === "post") {
      // Finished season: show the steps flat, as plain tabs.
      return html`${j.steps.map(
        (/** @type {any} */ st) => html`<a class="side-link ${s.step === st.id ? "on" : ""} dim" href="${L(st.path)}"
          aria-current="${s.step === st.id ? "page" : "false"}">${st.title}</a>`,
      )}`
    }
    return html`<div class="side-j ${active ? "open" : ""} ${dim ? "dim" : ""}">
      <a class="side-link ${active ? "on" : ""}" href="${L("/" + j.id)}" aria-current="${active && !s.step ? "page" : "false"}">
        <span class="side-label">${j.nav}</span>
        ${badge ? html`<span class="badge">${badge}</span>` : ""}
        <span class="side-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
      </a>
      ${steps}
    </div>`
  }
  const preTitle = "Before the wedding"
  const postTitle = db.mode === "post" ? "After the wedding" : "After the wedding (later)"
  return html`
    <a class="brand" href="${L("/")}"><span class="brand-mark">J&amp;J</span><span>Admin</span></a>
    <nav aria-label="Admin">
      <a class="side-link home ${s.title === "Home" ? "on" : ""}" href="${L("/")}" aria-current="${s.title === "Home" ? "page" : "false"}">Home</a>
      <p class="side-h">${db.mode === "post" ? postTitle : preTitle}</p>
      ${now.map((j) => item(j, false))}
      <p class="side-h">${db.mode === "post" ? preTitle : postTitle}</p>
      ${later.map((j) => item(j, true))}
      <p class="side-h">Your site</p>
      ${SITE_TOOLS.map(
        (t) => html`<a class="side-link ${s.tool === t.id ? "on" : ""}" href="${L(t.path)}"
          aria-current="${s.tool === t.id ? "page" : "false"}">${t.title}</a>`,
      )}
      <a class="side-link ${s.tool === "all" ? "on" : ""}" href="${L("/all")}">Everything&hellip;</a>
    </nav>
    <div class="side-foot">
      <button type="button" class="ghost" data-act="theme">Light / dark</button>
      <a class="ghost" href="${L("/")}" data-act="view-site">View site ↗</a>
    </div>
  `
}

// ---------------- phone chrome ----------------

/** @param {Screen} s */
function tabbar(s) {
  const tabs = [
    { id: "home", label: "Home", to: "/", on: s.title === "Home", icon: "⌂" },
    { id: "review", label: "Review", to: "/review", on: s.journey === "review", icon: "✉" },
    { id: "faces", label: "Faces", to: "/faces", on: s.journey === "faces", icon: "☺" },
    { id: "thanks", label: "Thanks", to: "/thanks", on: s.journey === "thanks", icon: "♥" },
    { id: "all", label: "All", to: "/all", on: !s.journey && s.title !== "Home", icon: "☰" },
  ]
  const review = journeyById("review")
  const thanks = journeyById("thanks")
  /** @type {Record<string, string>} */
  const badges = {
    review: review && review.badge ? review.badge() : "",
    thanks: thanks && thanks.badge ? thanks.badge() : "",
  }
  return html`${tabs.map(
    (t) => html`<a href="${L(t.to)}" class="${t.on ? "on" : ""}" aria-current="${t.on ? "page" : "false"}">
      <span class="ti" aria-hidden="true">${t.icon}</span><span>${t.label}</span>
      ${badges[t.id] ? html`<span class="badge">${badges[t.id]}</span>` : ""}
    </a>`,
  )}`
}

// ---------------- journey header ----------------

/** @param {Screen} s */
function journeyHead(s) {
  const j = s.journey ? journeyById(s.journey) : null
  if (!j || !s.step) return ""
  const pr = journeyProgress(j)
  const at = j.steps.findIndex((st) => st.id === s.step)
  const step = j.steps[at]
  const seenKey = j.id + "/" + step.id
  const collapsed = db.seenIntro[seenKey]
  const stepper = html`<ol class="stepper" aria-label="${j.title} steps">
    ${j.steps.map((st, i) => {
      const state = i === at ? "current" : pr.states[i].done ? "done" : "todo"
      return html`<li class="${state}">
        <a href="${L(st.path)}" aria-current="${i === at ? "step" : "false"}">
          <span class="num">${state === "done" ? raw("&#10003;") : i + 1}</span>
          <span class="st">${st.title}</span>
          <span class="sc">${pr.states[i].label}</span>
        </a>
      </li>`
    })}
  </ol>`
  const picker = html`<details class="step-picker">
    <summary><span class="sp-n">Step ${at + 1} of ${j.steps.length}</span> <span class="sp-t">${step.title}</span></summary>
    <ol>${j.steps.map(
      (st, i) => html`<li><a href="${L(st.path)}" class="${i === at ? "on" : ""}">
        <span class="num">${pr.states[i].done ? raw("&#10003;") : i + 1}</span> ${st.title}
        <span class="sc">${pr.states[i].label}</span></a></li>`,
    )}</ol>
  </details>
  <div class="mini-progress" aria-hidden="true">${j.steps.map(
    (_, i) => html`<i class="${i < at ? "done" : i === at ? "cur" : ""} ${pr.states[i].done ? "done" : ""}"></i>`,
  )}</div>`
  const heading = s.heading || step.title
  const intro = s.introOverride
    ? s.introOverride
    : s.compactIntro && !collapsed
      ? html`<div class="intro compact">
          <h1 tabindex="-1" id="page-h">${heading}</h1>
          <p class="lede">${step.lede}</p>
        </div>`
      : collapsed
      ? html`<div class="intro small">
          <h1 tabindex="-1" id="page-h">${heading}</h1>
          <button type="button" class="whats" data-act="intro-show" aria-expanded="false">What do I do here?</button>
        </div>`
      : html`<div class="intro">
          <p class="eyebrow">Step ${at + 1} of ${j.steps.length}</p>
          <h1 tabindex="-1" id="page-h">${heading}</h1>
          <p class="lede">${step.lede}</p>
          <ul class="how">${step.how.map((h) => html`<li>${h}</li>`)}</ul>
          <button type="button" class="link-btn" data-act="intro-hide">Got it — make this smaller</button>
        </div>`
  return html`<div class="jhead">
    <a class="jcrumb" href="${L("/" + j.id)}" data-nav="up">${j.title}</a>
    ${stepper}${picker}
  </div>${intro}`
}

// ---------------- action bar ----------------

/** @param {Screen} s */
function actionbar(s) {
  if (!s.prev && !s.next && !s.status && !s.abRight) return html``
  return html`<div class="ab-inner ${s.abWork ? "has-work" : ""}">
    ${s.prev
      ? html`<a class="btn ghost ab-prev" href="${L(s.prev.to)}">← <span class="ab-l">${s.prev.label}</span></a>`
      : html`<span></span>`}
    ${s.status ? html`<span class="ab-status" role="status">${s.status}</span>` : html`<span></span>`}
    ${s.abRight
      ? s.abRight
      : s.next
      ? html`<a class="btn ${s.next.ready ? "primary big glow" : "secondary"} ab-next" href="${L(s.next.to)}">
          <span class="ab-k">${s.next.ready ? "Next:" : "Skip ahead:"}</span> <span class="ab-l">${s.next.label}</span> →</a>`
      : html`<span></span>`}
    ${s.abWork ? html`<span class="ab-work">${s.abWork}</span>` : ""}
  </div>`
}

/** Fill prev/next from the journey's step order when a screen didn't. @param {Screen} s */
export function withStepNav(s, ready = false) {
  const j = s.journey ? journeyById(s.journey) : null
  if (!j || !s.step) return s
  const at = j.steps.findIndex((st) => st.id === s.step)
  if (s.prev === undefined) {
    s.prev = at > 0 ? { label: j.steps[at - 1].title, to: j.steps[at - 1].path } : { label: "Overview", to: "/" + j.id }
  }
  if (s.next === undefined) {
    s.next =
      at < j.steps.length - 1
        ? { label: j.steps[at + 1].title, to: j.steps[at + 1].path, ready }
        : j.when === "post"
          ? { label: "Finish", to: "/" + j.id + "/done", ready }
          : null
  }
  return s
}

// ---------------- render ----------------

/** @type {Screen | null} */
let currentScreen = null
/** @type {(() => void) | null} */
let closeDialogFn = null

/** @param {Screen} s @param {{ closeDialog: () => void, path: string }} ctx */
export function paint(s, ctx) {
  currentScreen = s
  closeDialogFn = ctx.closeDialog
  document.title = s.title + " · Admin"
  const side = /** @type {HTMLElement} */ (document.getElementById("sidebar"))
  const main = /** @type {HTMLElement} */ (document.getElementById("main"))
  const ab = /** @type {HTMLElement} */ (document.getElementById("actionbar"))
  const tb = /** @type {HTMLElement} */ (document.getElementById("tabbar"))
  side.innerHTML = sidebar(s).s
  tb.innerHTML = tabbar(s).s
  const head = journeyHead(s)
  const plainHead =
    !s.journey || !s.step
      ? s.heading !== undefined && s.bare
        ? ""
        : html`<div class="intro small plain"><h1 tabindex="-1" id="page-h">${s.heading || s.title}</h1></div>`
      : ""
  main.className = s.wide ? "wide" : ""
  main.innerHTML = html`${head}${plainHead}<div class="content">${s.body}</div>`.s
  ab.innerHTML = actionbar(s).s
  ab.hidden = ab.innerHTML === ""
  document.body.classList.toggle("has-ab", !ab.hidden)
  if (s.mount) s.mount(main)

  const dlg = /** @type {HTMLDialogElement} */ (document.getElementById("route-dialog"))
  if (s.dialog) {
    dlg.innerHTML = html`<form method="dialog" class="dlg">
      <header><h2 id="dlg-h">${s.dialog.title}</h2>
        <button type="button" class="x" data-act="dlg-close" aria-label="Close">✕</button></header>
      <div class="dlg-body">${s.dialog.body}</div>
    </form>`.s
    dlg.setAttribute("aria-labelledby", "dlg-h")
    if (!dlg.open) dlg.showModal()
    if (s.dialog.mount) s.dialog.mount(dlg)
  } else if (dlg.open) {
    dlg.close()
  }

  // Focus the heading so a screen change is announced (not on in-place refresh).
  const h = document.getElementById("page-h")
  if (h && !s.dialog && ctx.path !== lastPath) h.focus({ preventScroll: true })
  lastPath = ctx.path
}
let lastPath = ""

/** Wire global delegated handlers once. @param {{ refresh: () => void }} app */
export function wireShell(app) {
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-act]") : null
    if (!t || !(t instanceof HTMLElement)) return
    const act = t.dataset.act || ""
    if (act === "theme") return toggleTheme()
    if (act === "view-site") {
      e.preventDefault()
      return toast("In the real admin this opens the public site in a new tab.")
    }
    if (act === "dlg-close") return closeDialogFn && closeDialogFn()
    if (act === "intro-hide" || act === "intro-show") {
      const s = currentScreen
      if (s && s.journey && s.step) {
        db.seenIntro[s.journey + "/" + s.step] = act === "intro-hide"
        save()
        app.refresh()
        const btn = document.querySelector(act === "intro-hide" ? "[data-act=intro-show]" : "[data-act=intro-hide]")
        if (btn instanceof HTMLElement) btn.focus()
      }
      return
    }
    const s = currentScreen
    if (!s) return
    const handler = (s.dialog && s.dialog.acts && s.dialog.acts[act]) || (s.acts && s.acts[act])
    if (handler) {
      e.preventDefault()
      handler(t, e)
    }
  })
  document.addEventListener("keydown", (e) => {
    const s = currentScreen
    if (!s || !s.keys || e.metaKey || e.ctrlKey || e.altKey) return
    const tgt = e.target
    if (tgt instanceof HTMLInputElement || tgt instanceof HTMLTextAreaElement || tgt instanceof HTMLSelectElement) {
      if (e.key !== "Enter" || !(tgt instanceof HTMLInputElement)) return
      const fn = s.keys["Enter"]
      if (fn) {
        e.preventDefault()
        fn()
      }
      return
    }
    const dlg = document.getElementById("route-dialog")
    if (dlg instanceof HTMLDialogElement && dlg.open) return
    const fn = s.keys[e.key]
    if (fn) {
      e.preventDefault()
      fn()
    }
  })
  const dlg = /** @type {HTMLDialogElement} */ (document.getElementById("route-dialog"))
  // Esc on a route dialog = Back to its parent route, never a stranded URL.
  dlg.addEventListener("cancel", (e) => {
    e.preventDefault()
    if (closeDialogFn) closeDialogFn()
  })
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg && closeDialogFn) closeDialogFn()
  })
}

// ---------------- theme ----------------

export function initTheme() {
  const t = localStorage.getItem("aj-theme")
  const dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
  document.documentElement.dataset.theme = dark ? "dark" : "light"
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
  document.documentElement.dataset.theme = next
  localStorage.setItem("aj-theme", next)
}

// ---------------- toasts ----------------

/** @param {string} msg @param {(() => void) | null} [undo] */
export function toast(msg, undo = null) {
  const box = /** @type {HTMLElement} */ (document.getElementById("toasts"))
  const el = document.createElement("div")
  el.className = "toast"
  el.setAttribute("role", "status")
  el.innerHTML = html`<span>${msg}</span>${undo ? html`<button type="button">Undo</button>` : ""}`.s
  if (undo) {
    const b = el.querySelector("button")
    if (b)
      b.addEventListener("click", () => {
        undo()
        el.remove()
      })
  }
  box.replaceChildren(el)
  setTimeout(() => el.remove(), 6000)
}

// ---------------- leave guard ----------------

/** @param {string} what @returns {Promise<"stay" | "discard" | "save">} */
export function confirmLeave(what) {
  const dlg = /** @type {HTMLDialogElement} */ (document.getElementById("guard-dialog"))
  dlg.innerHTML = html`<form method="dialog" class="dlg small">
    <header><h2>Leave without saving?</h2></header>
    <div class="dlg-body"><p>You have unsaved changes to <strong>${what}</strong>.</p></div>
    <footer class="dlg-foot">
      <button value="stay" class="btn secondary" autofocus>Keep editing</button>
      <button value="discard" class="btn ghost danger-t">Discard</button>
      <button value="save" class="btn primary">Save and leave</button>
    </footer>
  </form>`.s
  dlg.showModal()
  return new Promise((resolve) => {
    dlg.addEventListener(
      "close",
      () => {
        const v = dlg.returnValue
        resolve(v === "discard" || v === "save" ? v : "stay")
      },
      { once: true },
    )
  })
}

// ---------------- re-login overlay ----------------

/** Run a mutation; if the session has expired, ask for the password IN PLACE
 *  (overlay over the current screen), then run it. Route, scroll, drafts and the
 *  open group are untouched because nothing navigated.
 *  @param {string} where @param {() => void} fn */
export function withSession(where, fn) {
  // Doing the step's work once is proof you've read the exposition: shrink it.
  const s = currentScreen
  if (s && s.journey && s.step && !db.seenIntro[s.journey + "/" + s.step]) {
    db.seenIntro[s.journey + "/" + s.step] = true
    save()
  }
  if (!db.sessionExpired) return fn()
  const el = /** @type {HTMLElement} */ (document.getElementById("relogin"))
  el.innerHTML = html`<div class="relogin-card" role="dialog" aria-modal="true" aria-labelledby="rl-h">
    <h2 id="rl-h">Welcome back</h2>
    <p>You were away long enough that we signed you out to keep things safe.
      <strong>Your place is saved</strong> — you'll carry on right where you were:</p>
    <p class="rl-where">${where}</p>
    <form class="rl-form">
      <label for="rl-pw">Password</label>
      <input id="rl-pw" type="password" autocomplete="current-password" required>
      <button class="btn primary big" type="submit">Carry on</button>
    </form>
    <p class="fine">Prototype: any password works.</p>
  </div>`.s
  el.hidden = false
  const input = /** @type {HTMLInputElement} */ (el.querySelector("#rl-pw"))
  input.focus()
  const form = /** @type {HTMLFormElement} */ (el.querySelector("form"))
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    db.sessionExpired = false
    save()
    el.hidden = true
    fn()
  })
}

// ---------------- prototype drawer ----------------

/** @param {{ refresh: () => void, reset: () => void }} app */
export function wireDrawer(app) {
  const btn = /** @type {HTMLElement} */ (document.getElementById("proto-btn"))
  const drawer = /** @type {HTMLElement} */ (document.getElementById("proto-drawer"))
  const draw = () => {
    drawer.innerHTML = html`<h2>Prototype controls</h2>
      <p class="fine">Fake data only. Not part of the design.</p>
      <label class="row"><span>Season</span>
        <select data-proto="mode"><option value="post" ${db.mode === "post" ? raw("selected") : ""}>After the wedding</option>
        <option value="pre" ${db.mode === "pre" ? raw("selected") : ""}>Before the wedding</option></select></label>
      <button type="button" class="btn secondary" data-proto="expire">Expire my session</button>
      <button type="button" class="btn secondary" data-proto="theme">Light / dark</button>
      <button type="button" class="btn secondary" data-proto="reset">Reset demo data</button>
      <a class="btn ghost" href="/admin-journeys/IA.md" target="_blank">Read IA.md ↗</a>`.s
  }
  btn.addEventListener("click", () => {
    drawer.hidden = !drawer.hidden
    btn.setAttribute("aria-expanded", String(!drawer.hidden))
    draw()
  })
  drawer.addEventListener("change", (e) => {
    const t = e.target
    if (t instanceof HTMLSelectElement && t.dataset.proto === "mode") {
      db.mode = t.value
      save()
      app.refresh()
    }
  })
  drawer.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-proto]") : null
    if (!(t instanceof HTMLElement)) return
    const p = t.dataset.proto
    if (p === "expire") {
      db.sessionExpired = true
      save()
      toast("Session expired. Your next action will ask for the password — without losing your place.")
    } else if (p === "theme") toggleTheme()
    else if (p === "reset") {
      app.reset()
      toast("Demo data reset.")
    }
  })
}

export { esc, JOURNEYS }
