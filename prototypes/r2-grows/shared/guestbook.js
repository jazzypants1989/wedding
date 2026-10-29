/** @file A faithful stand-in for /guestbook: the real card markup (`.gb-entry`,
 *  byline + monogram, message, foot) and the real site CSS, plus three hooks a
 *  "grown" sketch plugs into:
 *
 *    band(host, entries)       the background piece — everyone's art together
 *    ornament(entry) → svg     one entry's own art, appended aria-hidden to its card
 *    preview(draft) → svg      the composer's live preview while a guest types
 *    fire(entry)               the burst — a new entry has just been signed
 *
 *  Growth is triggered per card by IntersectionObserver (`.is-grown`); under
 *  reduced motion everything is grown on arrival. */

import { renderMonogram } from "/site/components/monogram.js"
import { esc, longDate } from "./text.js"
import { reduced } from "./harness.js"

/**
 * @import { Entry, Couple } from "./fixture.js"
 * @typedef {{ band: (host: HTMLElement, entries: Entry[]) => void,
 *   ornament: (entry: Entry) => string, preview: (draft: Entry) => string,
 *   fire?: (entry: Entry, card: HTMLElement) => void, card?: string,
 *   intro?: string, previewLabel?: string, bandLabel?: string }} GrownHooks
 */

/** @param {Entry} e @param {GrownHooks} hooks */
function cardMarkup(e, hooks) {
  const heart = e.reactions && e.reactions.heart
  return `
    <article class="gb-entry${e.fav ? " is-fav" : ""}" id="e-${e.id}" data-id="${e.id}">
      <div class="gx-orn" aria-hidden="true">${hooks.ornament(e)}</div>
      <header class="gb-entry-head">
        <div class="gb-byline">${renderMonogram(e.author_name)}<span class="gb-author">${esc(e.author_name)}</span></div>
        <time class="gb-time" datetime="${esc(e.created_at)}">${longDate(e.created_at)}</time>
      </header>
      <p class="gb-message">${esc(e.message)}</p>
      <footer class="gb-entry-foot">
        <span class="gx-react">${heart ? "❤️ " + heart.count : "♡"}</span>
        ${e.comment_count ? `<span class="gx-react">💬 ${e.comment_count}</span>` : ""}
        ${e.fav ? '<span class="gx-fav">✨ Favorite</span>' : ""}
      </footer>
    </article>`
}

/** @type {IntersectionObserver | null} */
let io = null

/** @param {ParentNode} scope */
function observeGrowth(scope) {
  const orns = scope.querySelectorAll(".gx-orn:not(.is-grown)")
  if (reduced() || !("IntersectionObserver" in window)) {
    orns.forEach((o) => o.classList.add("is-grown"))
    return
  }
  if (!io) {
    io = new IntersectionObserver(
      (items) => {
        for (const it of items) {
          if (it.isIntersecting) {
            it.target.classList.add("is-grown")
            io?.unobserve(it.target)
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    )
  }
  orns.forEach((o) => io?.observe(o))
}

/** @param {{couple: Couple, entries: Entry[], hooks: GrownHooks, mount: HTMLElement}} opts */
export function renderGuestbook({ couple, entries, hooks, mount }) {
  mount.innerHTML = `
    <header class="site-header text-center gx-header">
      <h1 class="couple-names">${esc(couple.display)}</h1>
      <p class="wedding-info">${longDate(couple.date + " 00:00")} &bull; ${esc(couple.location)}</p>
    </header>
    <section class="content-section gb-section">
      <h2 class="gb-title">Guestbook</h2>
      <p class="gb-intro">${hooks.intro || "Leave us a note — we read every one 💗"}</p>
      <div class="gx-band" data-slot="background" role="img" aria-label="${esc(hooks.bandLabel || "Artwork grown from every note")}"></div>
      <div class="card gb-composer">
        <form class="gx-composer">
          <label class="gx-name-label">Your name <input class="gx-name" value="You" maxlength="60"></label>
          <label for="gx-message" class="sr-only">Your message</label>
          <textarea id="gx-message" class="gb-textarea" rows="3" maxlength="2000" placeholder="Share a memory, a wish, a bit of advice…"></textarea>
          <div class="gx-preview-wrap">
            <div class="gx-preview gx-orn is-grown" aria-hidden="true"></div>
            <p class="gx-preview-label">${hooks.previewLabel || "Your note's artwork grows as you write."}</p>
          </div>
          <div class="gb-composer-actions">
            <button type="submit" class="btn btn-primary">Sign the guestbook</button>
          </div>
        </form>
      </div>
      <div id="gb-feed" class="gb-feed" data-gb-card="${hooks.card || "default"}">
        ${entries.map((e) => cardMarkup(e, hooks)).join("")}
      </div>
    </section>`

  const band = /** @type {HTMLElement} */ (mount.querySelector(".gx-band"))
  hooks.band(band, entries)
  observeGrowth(mount)

  const form = /** @type {HTMLFormElement} */ (mount.querySelector(".gx-composer"))
  const text = /** @type {HTMLTextAreaElement} */ (form.querySelector("textarea"))
  const name = /** @type {HTMLInputElement} */ (form.querySelector(".gx-name"))
  const prev = /** @type {HTMLElement} */ (form.querySelector(".gx-preview"))
  let nextId = 9000
  const draft = () => ({
    id: nextId,
    message: text.value || "",
    author_name: name.value.trim() || "You",
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    reactions: {},
    comment_count: 0,
    fav: false,
    is_own: true,
  })
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let t
  const update = () => {
    clearTimeout(t)
    t = setTimeout(() => {
      prev.innerHTML = text.value.trim() ? hooks.preview(draft()) : ""
      prev.classList.toggle("is-empty", !text.value.trim())
    }, 40)
  }
  text.addEventListener("input", update)
  name.addEventListener("input", update)
  update()

  form.addEventListener("submit", (ev) => {
    ev.preventDefault()
    if (!text.value.trim()) return
    const e = draft()
    nextId++
    entries.unshift(e)
    const feed = /** @type {HTMLElement} */ (mount.querySelector("#gb-feed"))
    feed.insertAdjacentHTML("afterbegin", cardMarkup(e, hooks))
    const card = /** @type {HTMLElement} */ (feed.firstElementChild)
    hooks.band(band, entries)
    observeGrowth(feed)
    if (hooks.fire) hooks.fire(e, card)
    text.value = ""
    update()
    card.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" })
  })

  return {
    /** Re-render everything (a param changed). */
    refresh() {
      hooks.band(band, entries)
      const feed = /** @type {HTMLElement} */ (mount.querySelector("#gb-feed"))
      feed.innerHTML = entries.map((e) => cardMarkup(e, hooks)).join("")
      feed.querySelectorAll(".gx-orn").forEach((o) => o.classList.add("is-grown"))
      update()
    },
  }
}
