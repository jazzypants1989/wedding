/** @file Guestbook feed + composer: render, keyset pagination, optimistic posts */
/** @import * as Types from "./types.js" */

import {
  html,
  raw,
  api,
  formatDate,
  getCoupleName,
  getElement,
  getButtonElement,
  getTextAreaElement,
  getFormElement,
  getErrorMessage,
  setLoadMoreState,
  announceCharsRemaining,
  shareUrl,
} from "../utils.js"
import { requireAccount, session, onSessionChange } from "../../components/guest-session.js"
import { showToast } from "../../components/toast.js"
import { fireConfetti, miniSparkle, setButtonLoading } from "../../components/celebrate.js"
import { showNote } from "../../components/notice.js"
import { upgradeTimes } from "../../components/relative-time.js"
import { renderReactionBar } from "../../components/reaction-bar.js"
import {
  renderCommentThread,
  postShortcutLabel,
  postShortcutAria,
} from "../../components/comment-thread.js"
import { renderMonogram } from "../../components/monogram.js"
import { flowerSVG } from "../../components/note-flower.js"
import { initMeadow, MEADOW_MAX } from "./meadow.js"
import { initBackdrop } from "./backdrop.js"

const PAGE_SIZE = 20
const MAX_AUTO_FETCHES = 5

/** @type {number | null} */
let nextCursor = null
let reachedEnd = false
let loading = false
let autoFetches = 0
let renderedCount = 0
/** Host mode: the couple, admin-logged-in and not signed in as a guest, can pin. */
let hostMode = false

/** A flower's largest size, in CSS px. The composer preview draws at it; a card
 *  draws the same flower, shrunk if need be to the height of its words
 *  (guestbook.css), so the flower a guest watches grow is the one they get. */
const FLOWER_SIZE = { scale: 0.75, maxW: 120, maxH: 150 }
/** Every entry on the page by id (feed, deep link, own posts), so a pin or
 *  unpin can re-gild the flower that's already drawn. */
const entriesById = /** @type {Map<number, Types.GuestbookFeedEntry>} */ (new Map())
/** Entries in feed order — paged in, plus the guest's own new posts — for the
 *  meadow. A deep-linked entry is prepended to the DOM but not to this. */
let feedEntries = /** @type {Types.GuestbookFeedEntry[]} */ ([])
let redrawMeadow = () => {}
/** @type {IntersectionObserver | null} One observer reveals every card's flower once. */
let growObserver = null

/** The couple's admin `csrf` cookie value, if present (readable — not HttpOnly). */
function adminCsrfCookie() {
  for (const pair of document.cookie.split("; ")) {
    if (pair.startsWith("csrf=")) return pair.slice(5)
  }
  return null
}

/** Host mode: an admin session present and no guest signed in (guest wins). */
function isHostMode() {
  return !session.account && adminCsrfCookie() !== null
}

/** A card's flower: gilded while the note is pinned. @param {Types.GuestbookFeedEntry} entry */
function cardFlower(entry) {
  return flowerSVG(entry, { ...FLOWER_SIZE, gold: entry.pinned })
}

/** The couple's pin toggle on a card (host mode only). @param {Types.GuestbookFeedEntry} entry */
function pinButton(entry) {
  return html`<button type="button" class="gb-pin" data-gb-action="${entry.pinned ? "unpin" : "pin"}"
    data-id="${entry.id}" aria-pressed="${entry.pinned ? "true" : "false"}">Pin</button>`
}

/** @param {Types.GuestbookFeedEntry} entry */
function renderEntry(entry) {
  const cls =
    entry.status === "pending" && entry.is_own
      ? "gb-entry gb-entry-pending"
      : "gb-entry"
  return html`
    <article class="${cls}" data-id="${entry.id}">
      <header class="gb-entry-head">
        <div class="gb-byline">
          ${renderMonogram(entry.author_name)}
          <span class="gb-author">${entry.author_name}</span>
        </div>
        <time datetime="${entry.created_at}" class="gb-time">${formatDate(
          entry.created_at,
        )}</time>
      </header>
      <p class="gb-message">${entry.message}</p>
      <span class="gb-flower nf-grow" aria-hidden="true"
        >${raw(cardFlower(entry))}</span
      >
      ${entry.status === "pending" && entry.is_own
        ? html`<p class="status-badge status-pending gb-pending-chip">
            Awaiting approval — only you can see this
          </p>`
        : ""}
      <footer class="gb-entry-foot">
        ${renderReactionBar("guestbook", entry.id, entry.reactions)}
        ${renderCommentThread("guestbook", entry.id, entry.comment_count)}
        ${entry.status !== "pending"
          ? html`<button type="button" class="gb-share" data-gb-action="share"
              data-id="${entry.id}" aria-label="Share this message">Share</button>`
          : ""}
        ${hostMode && entry.status === "approved" ? pinButton(entry) : ""}
        ${entry.is_own
          ? html`<button type="button" class="gb-delete" data-gb-action="delete"
              data-id="${entry.id}">Delete</button>`
          : ""}
      </footer>
    </article>
  `
}

/**
 * A compact card for the admin-pinned "Favorites" strip (list-item semantics).
 * @param {Types.GuestbookFeedEntry} entry
 */
function renderFavorite(entry) {
  return html`
    <li class="gb-fav" data-id="${entry.id}">
      <div class="gb-byline">
        ${renderMonogram(entry.author_name)}
        <span class="gb-author">${entry.author_name}</span>
      </div>
      <p class="gb-fav-message">${entry.message}</p>
      ${hostMode
        ? html`<button type="button" class="gb-unpin" data-gb-action="unpin"
            data-id="${entry.id}">Unpin</button>`
        : ""}
    </li>
  `
}

/** @param {Types.GuestbookFeedEntry[]} pinned */
function renderFavorites(pinned) {
  const section = getElement("gb-favorites")
  const list = getElement("gb-favorites-list")
  if (!pinned || pinned.length === 0) {
    list.innerHTML = ""
    section.hidden = true
    return
  }
  list.innerHTML = html`${pinned.map(renderFavorite)}`
  section.hidden = false
}

/** Refetch the first page purely to refresh the Favorites strip after a pin/unpin.
 *  (The server sends an empty strip while the couple has Favorites switched off.) */
async function refreshFavorites() {
  try {
    const data = /** @type {Types.GuestbookFeedResponse} */ (
      await api("/api/guestbook?limit=1")
    )
    renderFavorites(data.pinned ?? [])
  } catch {
    // Non-fatal: the strip refreshes on next full page load.
  }
}

/**
 * Re-gild a note everywhere it's already drawn: its card's flower, the card's
 * pin toggle, and the meadow if the note stands in it.
 * @param {number} id @param {boolean} pinned
 */
function setEntryPinned(id, pinned) {
  const entry = entriesById.get(id)
  if (!entry) return
  entry.pinned = pinned
  const card = getElement("gb-feed").querySelector(`.gb-entry[data-id="${id}"]`)
  if (card) {
    const slot = card.querySelector(".gb-flower")
    if (slot) slot.innerHTML = cardFlower(entry)
    const toggle = card.querySelector(".gb-pin")
    if (toggle) toggle.outerHTML = String(pinButton(entry))
  }
  if (feedEntries.slice(0, MEADOW_MAX).includes(entry)) redrawMeadow()
}

/**
 * @param {Types.GuestbookFeedEntry[]} entries
 * @param {boolean} prepend
 */
function addEntries(entries, prepend) {
  // Even an empty page must refresh the empty-state CTA — a fresh site's first
  // load reaches here with zero entries and #gb-empty ships hidden in the HTML.
  if (entries.length === 0) {
    updateEmptyState()
    return
  }
  const feed = getElement("gb-feed")
  const frag = document.createDocumentFragment()
  let added = 0
  for (const entry of entries) {
    // Skip an entry already on the page — a ?entry= deep link prepends a row that
    // a later pagination page could otherwise re-append as a duplicate.
    if (feed.querySelector(`.gb-entry[data-id="${entry.id}"]`)) continue
    entriesById.set(entry.id, entry)
    const wrapper = document.createElement("div")
    wrapper.innerHTML = renderEntry(entry)
    const card = wrapper.firstElementChild
    if (card) {
      const flower = card.querySelector(".gb-flower")
      if (growObserver && flower) {
        flower.classList.add("nf-waiting")
        growObserver.observe(flower)
      }
      frag.appendChild(card)
      added += 1
    }
  }
  if (prepend) feed.insertBefore(frag, feed.firstChild)
  else feed.appendChild(frag)
  renderedCount += added
  upgradeTimes(feed)
  updateEmptyState()
}

function updateEmptyState() {
  getElement("gb-empty").hidden = renderedCount !== 0
}

/**
 * Delegated feed click → self-delete (own entry) or share (any visible entry).
 * @param {Event} e
 */
function onFeedClick(e) {
  const el = e.target
  if (!(el instanceof Element)) return
  const btn = el.closest("[data-gb-action]")
  if (!(btn instanceof HTMLElement)) return
  const id = btn.dataset.id
  if (!id) return
  const action = btn.dataset.gbAction
  if (action === "delete") {
    if (!window.confirm("Remove your guestbook message?")) return
    void deleteEntry(Number(id), btn)
  } else if (action === "share") {
    void shareEntry(Number(id), btn)
  } else if (action === "pin") {
    void setPinned(Number(id), true, btn)
  } else if (action === "unpin") {
    void setPinned(Number(id), false, btn)
  }
}

/**
 * Admin-only pin/unpin. Posts with the admin `csrf` cookie (host mode), re-gilds
 * the note's flower in place, then refreshes the Favorites strip (empty while
 * the couple has the strip switched off).
 * @param {number} id @param {boolean} pinned @param {HTMLElement} btn
 */
async function setPinned(id, pinned, btn) {
  btn.setAttribute("disabled", "")
  try {
    await api(`/api/admin/guestbook/${id}/${pinned ? "pin" : "unpin"}`, {
      method: "POST",
      csrf: true,
      csrfCookie: "csrf",
    })
    setEntryPinned(id, pinned)
    await refreshFavorites()
    showToast(pinned ? "Pinned" : "Unpinned")
  } catch (err) {
    showToast(getErrorMessage(err), { variant: "error" })
  } finally {
    // The card's toggle may have been replaced; this is a no-op then.
    btn.removeAttribute("disabled")
  }
}

/**
 * Share a deep link to one entry — native share sheet on phones, else copy.
 * Mirrors the gallery lightbox's share affordance so a guest can send someone
 * straight to a single heartfelt note.
 * @param {number} id @param {HTMLElement} btn
 */
async function shareEntry(id, btn) {
  const url = `${location.origin}/guestbook?entry=${id}`
  const prev = btn.textContent
  const result = await shareUrl(url)
  if (result === "shared") return
  btn.textContent = result === "copied" ? "Copied!" : "Press ⌘/Ctrl+C"
  setTimeout(() => {
    btn.textContent = prev
  }, 1500)
}

/**
 * Reveal a deep-linked entry (?entry=N): scroll to it and briefly highlight. If
 * it isn't already loaded, fetch the single entry and prepend it; a 404 (deleted
 * / not visible) gets a gentle toast rather than a silent no-op.
 * @param {number} id
 */
export async function openEntry(id) {
  const feed = getElement("gb-feed")
  let card = feed.querySelector(`.gb-entry[data-id="${id}"]`)
  if (!(card instanceof HTMLElement)) {
    try {
      const entry = /** @type {Types.GuestbookFeedEntry} */ (
        await api(`/api/guestbook/${id}`)
      )
      addEntries([entry], true)
      card = feed.querySelector(`.gb-entry[data-id="${id}"]`)
    } catch {
      showToast("That message isn't available anymore.")
      return
    }
  }
  if (card instanceof HTMLElement) {
    card.scrollIntoView({ behavior: "smooth", block: "center" })
    card.classList.add("gb-entry-highlight")
    setTimeout(() => card.classList.remove("gb-entry-highlight"), 2400)
  }
}

/** @param {number} id @param {HTMLElement} btn */
async function deleteEntry(id, btn) {
  hideError()
  try {
    await api(`/api/guestbook/${id}`, {
      method: "DELETE",
      csrf: true,
      csrfCookie: "guest_csrf",
    })
    const article = btn.closest(".gb-entry")
    if (article) article.remove()
    renderedCount = Math.max(0, renderedCount - 1)
    updateEmptyState()
    const before = feedEntries.length
    feedEntries = feedEntries.filter((e) => e.id !== id)
    if (feedEntries.length !== before) redrawMeadow()
  } catch (err) {
    showError(getErrorMessage(err))
  }
}

/** @param {string} message */
function showError(message) {
  const el = getElement("gb-error")
  el.textContent = message
  el.hidden = false
}

function hideError() {
  getElement("gb-error").hidden = true
}

/** @param {boolean} isAuto */
async function loadPage(isAuto) {
  if (loading || reachedEnd) return
  loading = true
  hideError()
  const btn = getButtonElement("gb-loadmore")
  // Spinner only on the empty first paint; later pages have the Load-more button.
  const firstPaint = getElement("gb-feed").childElementCount === 0
  const loadingEl = getElement("gb-loading")
  if (firstPaint) loadingEl.hidden = false
  try {
    const query =
      nextCursor !== null
        ? `?before=${nextCursor}&limit=${PAGE_SIZE}`
        : `?limit=${PAGE_SIZE}`
    const data = /** @type {Types.GuestbookFeedResponse} */ (
      await api(`/api/guestbook${query}`)
    )
    // The pinned "Favorites" strip only ships on the first page, and is empty
    // unless the couple has it switched on. Cards gild from `entry.pinned`.
    if (data.pinned) renderFavorites(data.pinned)
    addEntries(data.entries, false)
    // The meadow holds the newest MEADOW_MAX; later pages don't change it.
    const meadowWasFull = feedEntries.length >= MEADOW_MAX
    feedEntries.push(...data.entries)
    if (!meadowWasFull) redrawMeadow()
    nextCursor = data.nextCursor
    setLoadMoreState(btn, "reset")
    if (nextCursor === null) {
      reachedEnd = true
      btn.hidden = true
    } else {
      btn.hidden = false
    }
    if (isAuto) autoFetches += 1
  } catch (err) {
    showError(getErrorMessage(err))
    setLoadMoreState(btn, "retry")
  } finally {
    loading = false
    if (firstPaint) loadingEl.hidden = true
  }
}

/** The guest's own new card settles in under the composer, once. Its flower
 *  then grows like every other card's (reduced motion: it's simply there).
 *  @param {number} id */
function landNewCard(id) {
  const card = getElement("gb-feed").querySelector(`.gb-entry[data-id="${id}"]`)
  if (!(card instanceof HTMLElement)) return
  card.classList.add("gb-entry-new")
  card.addEventListener("animationend", () => card.classList.remove("gb-entry-new"), { once: true })
}

/** @param {Types.ContentStatus} status */
function celebrate(status) {
  const btn = getButtonElement("gb-submit")
  // A held-pending post gets the modest sparkle, not full confetti — the note
  // landed, but it isn't live yet, and the pending note right below says so.
  // The first-ever *published* post gets full confetti (once, guarded); later
  // posts a small sparkle. All no-op under prefers-reduced-motion.
  if (status !== "pending" && !localStorage.getItem("gbCelebrated")) {
    localStorage.setItem("gbCelebrated", "1")
    fireConfetti()
  } else {
    miniSparkle(btn)
  }
}

function showPendingNote() {
  // One-time only (spec — Phase 2 §5); shared dismissible-note helper, same
  // treatment as the gallery pending note.
  showNote(getElement("gb-pending-note"), {
    message: `Thanks! ${getCoupleName()} approve messages from new folks — yours will appear for everyone soon.`,
    once: "gbPendingNoteSeen",
  })
}

function showGalleryNudge() {
  // Cross-pollinate: after signing, nudge toward adding photos.
  showNote(getElement("gb-nudge"), {
    message: "Thanks for signing! Got photos from the day? Add them to the gallery 📸",
    once: "guestbookToGalleryNudge",
    linkHref: "/gallery",
    linkLabel: "Add photos",
    nudge: true,
  })
}

/** @param {string} message */
async function submitPost(message) {
  const btn = getButtonElement("gb-submit")
  setButtonLoading(btn, true)
  hideError()
  try {
    const data = /** @type {Types.GuestbookPostResponse} */ (
      await api("/api/guestbook", {
        method: "POST",
        csrf: true,
        csrfCookie: "guest_csrf",
        body: JSON.stringify({ message }),
      })
    )
    const composer = getTextAreaElement("gb-message")
    composer.value = ""
    // Refresh the live counter for the now-empty field (a programmatic value
    // change fires no input event) and put the cursor back so a guest can write
    // another note without re-clicking.
    composer.dispatchEvent(new Event("input", { bubbles: true }))
    composer.focus()
    addEntries([data.entry], true)
    feedEntries.unshift(data.entry)
    landNewCard(data.entry.id)
    redrawMeadow()
    // Announce only this own post (the feed itself is not a live region, 2.15).
    getElement("gb-live").textContent =
      data.status === "pending"
        ? "Your message was posted and is awaiting approval."
        : "Your message was posted."
    celebrate(data.status)
    // One note at a time: a held post explains itself; a live one may nudge.
    if (data.status === "pending") showPendingNote()
    else showGalleryNudge()
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    setButtonLoading(btn, false)
  }
}

/**
 * The composer grows the guest's flower as they type: seeded from their account
 * name and the trimmed message, exactly what the posted card will draw.
 * @param {HTMLTextAreaElement} messageEl
 */
function initFlowerPreview(messageEl) {
  const preview = getElement("gb-flower-preview")
  let queued = false
  const paint = () => {
    queued = false
    const message = messageEl.value.trim()
    preview.classList.toggle("is-empty", message === "")
    preview.innerHTML = message
      ? flowerSVG({ author_name: session.account?.name ?? "", message }, FLOWER_SIZE)
      : ""
  }
  const schedule = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(paint)
  }
  messageEl.addEventListener("input", schedule)
  onSessionChange(schedule)
  paint()
}

/** @param {Event} e */
function onComposerSubmit(e) {
  e.preventDefault()
  const textarea = getTextAreaElement("gb-message")
  const message = textarea.value.trim()
  if (!message) {
    textarea.focus()
    return
  }
  // Browse freely; gate only at write. A signed-out guest gets the auth sheet,
  // and this exact post replays after they sign in.
  requireAccount(() => submitPost(message))
}

/** @type {Types.initFeed} */
export function initFeed() {
  // Resolve host mode once (session was loaded before init) so the pin
  // affordances render for the couple browsing their own guestbook.
  hostMode = isHostMode()
  if (hostMode) document.body.classList.add("gb-host")

  getElement("gb-composer-form").addEventListener("submit", onComposerSubmit)
  getElement("gb-feed").addEventListener("click", onFeedClick)
  // The Favorites strip shares the same delegated action handler (pin/unpin/share).
  getElement("gb-favorites-list").addEventListener("click", onFeedClick)

  // Live character counter (2.6) — mirrors the textarea's maxlength.
  const messageEl = getTextAreaElement("gb-message")
  const counterEl = getElement("gb-counter")
  const updateCounter = () => {
    counterEl.textContent = `${messageEl.value.length}/2000`
    announceCharsRemaining(messageEl.value.length, 2000, counterEl)
  }
  messageEl.addEventListener("input", updateCounter)
  updateCounter()
  initFlowerPreview(messageEl)

  // Each card's flower grows in once, the first time it scrolls into view.
  // Under reduced motion there is no observer, and every flower is simply there.
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (!reduce) {
    growObserver = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (!record.isIntersecting) continue
          record.target.classList.remove("nf-waiting")
          growObserver?.unobserve(record.target)
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    )
  }

  redrawMeadow = initMeadow(
    getElement("gb-meadow"),
    () => feedEntries,
    (id) => void openEntry(id),
  )
  redrawMeadow()
  initBackdrop()

  // Same accelerator as the comment composer (components/comment-thread.js):
  // Cmd/Ctrl+Enter signs, bare Enter keeps its paragraph break — entries here
  // are the long-form ones, so newlines matter more, not less.
  messageEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    getFormElement("gb-composer-form").requestSubmit()
  })
  messageEl.setAttribute("aria-keyshortcuts", postShortcutAria())
  getElement("gb-hint").textContent = postShortcutLabel()

  getElement("gb-empty-cta").addEventListener("click", () => {
    getTextAreaElement("gb-message").focus()
  })

  const loadMoreBtn = getButtonElement("gb-loadmore")
  loadMoreBtn.addEventListener("click", () => {
    autoFetches = 0 // a manual click re-arms auto-loading
    loadPage(false)
  })

  // The Load-more button doubles as an infinite-scroll sentinel until the guest
  // has been auto-fed MAX_AUTO_FETCHES pages, after which they must click once
  // (keeps the footer reachable).
  const observer = new IntersectionObserver(
    (records) => {
      for (const record of records) {
        if (
          record.isIntersecting &&
          autoFetches < MAX_AUTO_FETCHES &&
          !reachedEnd &&
          !loading
        ) {
          loadPage(true)
        }
      }
    },
    { rootMargin: "600px" },
  )
  observer.observe(loadMoreBtn)

  // Return the first page's load so callers can await it (the ?entry= deep link
  // scrolls to the entry only once the feed has painted).
  return loadPage(false)
}
