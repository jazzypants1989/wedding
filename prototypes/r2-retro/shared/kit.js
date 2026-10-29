/** @file Shared sketch kit for the round-2 "retro web / zine" sketches.
 *
 *  Dev-only scaffolding, not a slot piece. It does four boring jobs so each
 *  sketch can spend its lines on design:
 *   - loads the shared synthetic fixture (and stretches it to `?n=300`);
 *   - renders entries with the SAME markup the real pages emit
 *     (public/pages/guestbook/feed.js renderEntry, public/pages/memory-book/main.js
 *     entryMarkup), so every `card` stylesheet here is proven against real markup;
 *   - a deterministic per-entry hash (FNV-1a over charCodeAt, no regex);
 *   - the sketch bar: light/dark, entry count, and a params drawer built with the
 *     site's own buildControl(), writing CSS custom properties through the CSSOM.
 *
 *  Query params: `?theme=dark|light`, `?n=3|32|300`, `?fx=<effect-theme>`.
 */

import { html, formatDate } from "/site/pages/utils.js"
import { renderMonogram } from "/site/components/monogram.js"
import { buildControl } from "/site/components/effect-controls.js"

/**
 * @typedef {{ heart?: { count: number, mine: boolean } } & Record<string, { count: number, mine: boolean }>} Reactions
 * @typedef {{ id: number, message: string, author_name: string, author_trusted: boolean,
 *   status: string, created_at: string, is_own: boolean, reactions: Reactions,
 *   comment_count: number }} Entry
 * @typedef {{ display: string, date: string, location: string }} Couple
 * @typedef {{ couple: Couple, entries: Entry[], pinned: Entry[] }} Fixture
 * @typedef {{ min?: number, max?: number, step?: number, options?: string[], kind?: "glyphs" }} ControlHint
 * @typedef {{ key: string, slot: "background" | "burst" | "card" | "book", value: unknown,
 *   hint?: ControlHint, css?: string, unit?: string, note?: string }} ParamDef
 */

/** Read a query param. @param {string} name */
export function query(name) {
  return new URL(location.href).searchParams.get(name)
}

/** FNV-1a 32-bit over UTF-16 code units. Deterministic per input, no regex.
 *  @param {string} str @returns {number} */
export function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** A small deterministic PRNG seeded from a string (mulberry32).
 *  @param {string} seed @returns {() => number} */
export function seeded(seed) {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Load the shared fixture and size it to `?n=` (default: the fixture as-is).
 *  Past 32 entries the fixture is cycled with fresh ids and dates, newest first,
 *  so the 300-entry case exercises pagination without inventing new people.
 *  @returns {Promise<Fixture>} */
export async function loadFixture() {
  const res = await fetch("/fixtures/entries.json")
  const data = /** @type {Fixture} */ (await res.json())
  const n = Number(query("n")) || data.entries.length
  /** @type {Entry[]} */
  let entries
  if (n <= data.entries.length) {
    entries = data.entries.slice(0, n)
  } else {
    entries = []
    const start = Date.parse("2026-04-26T18:00:00Z")
    for (let i = 0; i < n; i++) {
      const base = data.entries[i % data.entries.length]
      const id = 100 + n - i
      const when = new Date(start + (n - i) * 47 * 60 * 1000)
      const stamp = when.toISOString().slice(0, 19).replace("T", " ")
      entries.push({ ...base, id, created_at: stamp })
    }
  }
  const shown = new Set(entries.map((e) => e.id))
  const pinned = n <= data.entries.length ? data.pinned.filter((p) => shown.has(p.id)) : data.pinned
  return { couple: data.couple, entries, pinned }
}

/** The guestbook feed entry, mirroring feed.js renderEntry (no host/own actions).
 *  @param {Entry} entry @returns {string} */
export function renderEntry(entry) {
  const heart = entry.reactions.heart
  return html`
    <article class="gb-entry" data-id="${entry.id}">
      <header class="gb-entry-head">
        <div class="gb-byline">
          ${renderMonogram(entry.author_name)}
          <span class="gb-author">${entry.author_name}</span>
        </div>
        <time datetime="${entry.created_at}" class="gb-time">${formatDate(entry.created_at)}</time>
      </header>
      <p class="gb-message">${entry.message}</p>
      <footer class="gb-entry-foot">
        <div class="reaction-bar" role="group" aria-label="Reactions">
          <button type="button" class="reaction-pill${heart && heart.mine ? " reaction-mine" : ""}"
            aria-pressed="${heart && heart.mine ? "true" : "false"}" aria-label="Heart">
            <span class="reaction-glyph" aria-hidden="true">❤️</span>
            <span class="reaction-count">${heart ? heart.count : ""}</span>
          </button>
        </div>
        ${entry.comment_count > 0
          ? html`<button type="button" class="comment-toggle">${entry.comment_count} ${entry.comment_count === 1 ? "reply" : "replies"}</button>`
          : ""}
        <button type="button" class="gb-share" aria-label="Share this message">Share</button>
      </footer>
    </article>
  `
}

/** The Favorites strip item, mirroring feed.js renderFavorite.
 *  @param {Entry} entry @returns {string} */
export function renderFavorite(entry) {
  return html`
    <li class="gb-fav" data-id="${entry.id}">
      <div class="gb-byline">
        ${renderMonogram(entry.author_name)}
        <span class="gb-author">${entry.author_name}</span>
      </div>
      <p class="gb-fav-message">${entry.message}</p>
    </li>
  `
}

/** The memory-book entry, mirroring memory-book/main.js entryMarkup — plus
 *  `data-id`, which SKETCH.md proposes adding upstream (one attribute) so a
 *  book piece can be deterministic per entry the way a card already is.
 *  @param {Entry} entry @param {boolean} favorite @returns {string} */
export function renderBookEntry(entry, favorite) {
  const name = entry.author_name || "A guest"
  return html`
    <article class="mb-entry ${favorite ? "is-favorite" : ""}" data-id="${entry.id}">
      <div class="mb-entry-head">
        ${renderMonogram(name)}
        <span class="mb-entry-author">${name}</span>
        ${favorite ? html`<span class="mb-entry-fav" aria-label="Favorite">✨</span>` : ""}
        <span class="mb-entry-date">${formatDate(entry.created_at)}</span>
      </div>
      <p class="mb-entry-message">${entry.message}</p>
    </article>
  `
}

/** The memory book body, mirroring memory-book/main.js render(): Favorites first,
 *  then every other message, then the count line.
 *  @param {Entry[]} entries @param {Entry[]} pinned @returns {string} */
export function renderBook(entries, pinned) {
  const pinnedIds = new Set(pinned.map((p) => p.id))
  const rest = entries.filter((e) => !pinnedIds.has(e.id))
  const total = pinned.length + rest.length
  const fav =
    pinned.length > 0
      ? html`<section class="mb-section mb-section-favorites">
          <h2 class="mb-section-title">Favorites</h2>
          ${pinned.map((e) => renderBookEntry(e, true))}
        </section>`
      : ""
  const all =
    rest.length > 0
      ? html`<section class="mb-section mb-section-all">
          ${pinned.length > 0 ? html`<h2 class="mb-section-title">Every message</h2>` : ""}
          ${rest.map((e) => renderBookEntry(e, false))}
        </section>`
      : ""
  return html`${fav}${all}
    <p class="mb-count">${total} message${total === 1 ? "" : "s"} in all.</p>`
}

/** Apply `?theme=` / `?fx=` before first paint (call from a module at the top). */
export function applyTheme() {
  const root = document.documentElement
  const theme = query("theme") || localStorage.getItem("r2-retro-theme") || "light"
  root.dataset.theme = theme === "dark" ? "dark" : "light"
  const fx = query("fx")
  if (fx) root.dataset.effectTheme = fx
}

/** Whether the visitor asked for reduced motion. */
export function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Write one CSS param through the CSSOM (never a style= attribute; the CSP
 *  blocks those). @param {ParamDef} def @param {unknown} value */
function writeCss(def, value) {
  if (!def.css) return
  const text = typeof value === "number" ? String(value) + (def.unit || "") : String(value)
  document.documentElement.style.setProperty(def.css, text)
}

/**
 * Mount the sketch bar: page links, light/dark, entry count and a params drawer.
 * @param {{ name: string, links: Array<[string, string]>, params: ParamDef[],
 *   onParam?: (def: ParamDef, value: unknown) => void, extra?: HTMLElement }} opts
 */
export function mountSketchBar(opts) {
  const bar = document.createElement("aside")
  bar.className = "sk-bar"
  // `?bar=0` hides the bar (for clean screenshots).
  if (query("bar") === "0") bar.hidden = true
  bar.setAttribute("aria-label", "Sketch controls (dev only)")

  const head = document.createElement("div")
  head.className = "sk-bar-head"
  const title = document.createElement("strong")
  title.textContent = opts.name
  head.appendChild(title)
  for (const [label, href] of opts.links) {
    const a = document.createElement("a")
    a.href = href + location.search
    a.textContent = label
    head.appendChild(a)
  }
  const all = document.createElement("a")
  all.href = "/r2-retro/"
  all.textContent = "all sketches"
  head.appendChild(all)
  bar.appendChild(head)

  const row = document.createElement("div")
  row.className = "sk-bar-row"
  const themeBtn = document.createElement("button")
  themeBtn.type = "button"
  const paintTheme = () => {
    themeBtn.textContent = document.documentElement.dataset.theme === "dark" ? "☾ dark" : "☀ light"
  }
  paintTheme()
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
    document.documentElement.dataset.theme = next
    localStorage.setItem("r2-retro-theme", next)
    paintTheme()
    document.dispatchEvent(new CustomEvent("sk-theme"))
  })
  row.appendChild(themeBtn)
  for (const n of ["3", "32", "300"]) {
    const a = document.createElement("a")
    const url = new URL(location.href)
    url.searchParams.set("n", n)
    a.href = url.pathname + url.search
    a.textContent = n
    if ((query("n") || "32") === n) a.setAttribute("aria-current", "true")
    row.appendChild(a)
  }
  const toggle = document.createElement("button")
  toggle.type = "button"
  toggle.textContent = "params"
  toggle.setAttribute("aria-expanded", "false")
  row.appendChild(toggle)
  bar.appendChild(row)
  if (opts.extra) bar.appendChild(opts.extra)

  const drawer = document.createElement("div")
  drawer.className = "sk-drawer"
  drawer.hidden = true
  /** @type {Record<string, ControlHint>} */
  const hints = {}
  for (const def of opts.params) {
    if (def.hint) hints[def.key] = def.hint
    writeCss(def, def.value)
  }
  /** @type {string} */
  let lastSlot = ""
  for (const def of opts.params) {
    if (def.slot !== lastSlot) {
      const h = document.createElement("p")
      h.className = "sk-slot"
      h.textContent = def.slot
      drawer.appendChild(h)
      lastSlot = def.slot
    }
    const control = buildControl(def.key, def.value, {
      effectId: opts.name,
      getHint: (_id, key) => hints[key],
      onChange: (_key, next) => {
        writeCss(def, next)
        if (opts.onParam) opts.onParam(def, next)
      },
    })
    if (def.css) control.title = def.css
    drawer.appendChild(control)
  }
  toggle.addEventListener("click", () => {
    drawer.hidden = !drawer.hidden
    toggle.setAttribute("aria-expanded", String(!drawer.hidden))
  })
  bar.appendChild(drawer)
  document.body.appendChild(bar)
}

/** Lazily-created shared AudioContext. Sound is muted by default, refused under
 *  reduced motion, and only ever created inside a user gesture.
 *  @returns {AudioContext | null} */
let audio = /** @type {AudioContext | null} */ (null)
export function audioContext() {
  if (reducedMotion()) return null
  if (!audio) audio = new AudioContext()
  if (audio.state === "suspended") void audio.resume()
  return audio
}
