/** @file Sketch harness: the top bar (view, entry count, light/dark, theme,
 *  motion) and a params drawer built by the site's real `buildControl()`, fed
 *  by each sketch's ControlHint declarations. Screen-only; hidden in print.
 *
 *  URL params, so any state is a shareable link and a screenshot target:
 *    ?n=3|32|300  ?dark=1  ?theme=<effect theme>  ?motion=reduce  */

import { buildControl } from "/site/components/effect-controls.js"

const THEMES = "mermaid-disco romantic elegant classic celestial garden winter coastal celebration gratitude".split(" ")

/**
 * @typedef {{ value: unknown, hint?: {min?: number, max?: number, step?: number, options?: string[], kind?: "glyphs"}, css?: string, unit?: string }} Param
 * @typedef {{ sketch: string, slot: string, view: "guestbook" | "book", links: {guestbook: string, book: string},
 *   params: Record<string, Param>, onParams?: (values: Record<string, unknown>) => void }} HarnessOptions
 */

const q = new URLSearchParams(location.search)
const root = document.documentElement

let stored = "light"
try {
  stored = localStorage.getItem("theme") || "light"
} catch {}
root.dataset.theme = q.has("dark") ? (q.get("dark") === "0" ? "light" : "dark") : stored
root.dataset.effectTheme = q.get("theme") || "mermaid-disco"
const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)")
const syncMotion = () => {
  root.dataset.motion = q.get("motion") === "reduce" || reducedQuery.matches ? "reduce" : "ok"
}
syncMotion()
reducedQuery.addEventListener("change", syncMotion)

export const reduced = () => root.dataset.motion === "reduce"

/** @param {string} key @param {string | null} value */
function linkWith(key, value) {
  const next = new URLSearchParams(location.search)
  if (value === null) next.delete(key)
  else next.set(key, value)
  const s = next.toString()
  return location.pathname + (s ? "?" + s : "")
}

/** Carry the current query string across the guestbook ↔ book toggle. @param {string} href */
function keepQuery(href) {
  return href + location.search
}

/** @param {HarnessOptions} opts @returns {Record<string, unknown>} */
export function initHarness(opts) {
  /** @type {Record<string, unknown>} */
  const values = {}
  for (const [k, p] of Object.entries(opts.params)) values[k] = p.value
  applyCss(opts.params, values)

  const bar = document.createElement("div")
  bar.className = "hx-bar"
  bar.setAttribute("role", "toolbar")
  bar.setAttribute("aria-label", "Sketch controls")
  const n = q.get("n") || "32"
  const dark = root.dataset.theme === "dark"
  bar.innerHTML = `
    <a class="hx-home" href="/r2-grows/">r2 · grows</a>
    <strong class="hx-name">${opts.sketch}</strong>
    <span class="hx-seg" aria-label="View">
      <a href="${keepQuery(opts.links.guestbook)}" ${opts.view === "guestbook" ? 'aria-current="page"' : ""}>Guestbook</a>
      <a href="${keepQuery(opts.links.book)}" ${opts.view === "book" ? 'aria-current="page"' : ""}>Memory book</a>
    </span>
    <span class="hx-seg" aria-label="Entries">
      ${["3", "32", "300"].map((v) => `<a href="${linkWith("n", v === "32" ? null : v)}" ${n === v ? 'aria-current="true"' : ""}>${v}</a>`).join("")}
    </span>
    <a class="hx-btn" href="${linkWith("dark", dark ? "0" : "1")}">${dark ? "☀ light" : "☾ dark"}</a>
    <a class="hx-btn" href="${linkWith("motion", q.get("motion") === "reduce" ? null : "reduce")}">${reduced() ? "▶ motion" : "❚❚ still"}</a>
    <label class="hx-theme">theme
      <select>${THEMES.map((t) => `<option ${t === root.dataset.effectTheme ? "selected" : ""}>${t}</option>`).join("")}</select>
    </label>
    <button type="button" class="hx-btn" aria-expanded="false" aria-controls="hx-drawer">params</button>
    ${opts.view === "book" ? '<button type="button" class="hx-btn hx-print">🖨 print</button>' : ""}
  `
  document.body.prepend(bar)
  const select = /** @type {HTMLSelectElement} */ (bar.querySelector("select"))
  select.addEventListener("change", () => {
    location.href = linkWith("theme", select.value === "mermaid-disco" ? null : select.value)
  })
  const print = bar.querySelector(".hx-print")
  if (print) print.addEventListener("click", () => window.print())

  const drawer = document.createElement("aside")
  drawer.id = "hx-drawer"
  drawer.className = "hx-drawer"
  drawer.hidden = true
  drawer.innerHTML = `<h2>Slot: <code>${opts.slot}</code></h2><p class="hx-note">Built by the site's <code>buildControl()</code> from the ControlHint declarations in SKETCH.md.</p>`
  const hints = Object.fromEntries(Object.entries(opts.params).map(([k, p]) => [k, p.hint]))
  for (const k of Object.keys(opts.params)) {
    drawer.appendChild(
      buildControl(k, /** @type {any} */ (values[k]), {
        effectId: opts.sketch,
        getHint: (/** @type {string} */ _id, /** @type {string} */ key) => hints[key],
        onChange: (/** @type {string} */ key, /** @type {unknown} */ next) => {
          values[key] = next
          applyCss(opts.params, values)
          if (opts.onParams) opts.onParams(values)
        },
      }),
    )
  }
  document.body.appendChild(drawer)
  const toggle = /** @type {HTMLButtonElement} */ (bar.querySelector("[aria-controls]"))
  toggle.addEventListener("click", () => {
    drawer.hidden = !drawer.hidden
    toggle.setAttribute("aria-expanded", String(!drawer.hidden))
  })
  return values
}

/** CSS params are custom properties, written through the CSSOM (never `style=`).
 *  @param {Record<string, Param>} params @param {Record<string, unknown>} values */
function applyCss(params, values) {
  for (const [k, p] of Object.entries(params)) {
    if (p.css) root.style.setProperty(p.css, String(values[k]) + (p.unit || ""))
  }
}
