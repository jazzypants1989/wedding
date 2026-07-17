/** @file Guestbook feed + composer: render, keyset pagination, optimistic posts */
/** @import * as Types from "./types.js" */

import {
  html,
  api,
  formatDate,
  getCoupleName,
  getElement,
  getButtonElement,
  getTextAreaElement,
  getErrorMessage,
  setLoadMoreState,
  announceCharsRemaining,
  shareUrl,
} from "../utils.js"
import { requireAccount } from "../../components/guest-session.js"
import { showToast } from "../../components/toast.js"
import { fireConfetti, miniSparkle, setButtonLoading } from "../../components/celebrate.js"
import { showNote } from "../../components/notice.js"
import { upgradeTimes } from "../../components/relative-time.js"
import { renderReactionBar } from "../../components/reaction-bar.js"
import { renderCommentThread } from "../../components/comment-thread.js"

const PAGE_SIZE = 20
const MAX_AUTO_FETCHES = 5

/** @type {number | null} */
let nextCursor = null
let reachedEnd = false
let loading = false
let autoFetches = 0
let renderedCount = 0

/** @param {Types.GuestbookFeedEntry} entry */
function renderEntry(entry) {
  const cls =
    entry.status === "pending" && entry.is_own
      ? "gb-entry gb-entry-pending"
      : "gb-entry"
  return html`
    <article class="${cls}" data-id="${entry.id}">
      <header class="gb-entry-head">
        <span class="gb-author">${entry.author_name}</span>
        <time datetime="${entry.created_at}" class="gb-time">${formatDate(
          entry.created_at,
        )}</time>
      </header>
      <p class="gb-message">${entry.message}</p>
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
        ${entry.is_own
          ? html`<button type="button" class="gb-delete" data-gb-action="delete"
              data-id="${entry.id}">Delete</button>`
          : ""}
      </footer>
    </article>
  `
}

/**
 * @param {Types.GuestbookFeedEntry[]} entries
 * @param {boolean} prepend
 */
function addEntries(entries, prepend) {
  if (entries.length === 0) return
  const feed = getElement("gb-feed")
  const frag = document.createDocumentFragment()
  let added = 0
  for (const entry of entries) {
    // Skip an entry already on the page — a ?entry= deep link prepends a row that
    // a later pagination page could otherwise re-append as a duplicate.
    if (feed.querySelector(`.gb-entry[data-id="${entry.id}"]`)) continue
    const wrapper = document.createElement("div")
    wrapper.innerHTML = renderEntry(entry)
    const card = wrapper.firstElementChild
    if (card) {
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
  getElement("gb-empty").hidden = renderedCount > 0
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
  if (btn.dataset.gbAction === "delete") {
    if (!window.confirm("Delete your guestbook message?")) return
    void deleteEntry(Number(id), btn)
  } else if (btn.dataset.gbAction === "share") {
    void shareEntry(Number(id), btn)
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
    addEntries(data.entries, false)
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

/** @param {Types.ContentStatus} status */
function celebrate(status) {
  const btn = getButtonElement("gb-submit")
  // First-ever post gets full confetti (once, guarded); later posts a small
  // sparkle. Both no-op under prefers-reduced-motion.
  if (!localStorage.getItem("gbCelebrated")) {
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
    // Announce only this own post (the feed itself is not a live region, 2.15).
    getElement("gb-live").textContent =
      data.status === "pending"
        ? "Your message was posted and is awaiting approval."
        : "Your message was posted."
    celebrate(data.status)
    if (data.status === "pending") showPendingNote()
    showGalleryNudge()
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    setButtonLoading(btn, false)
  }
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
  getElement("gb-composer-form").addEventListener("submit", onComposerSubmit)
  getElement("gb-feed").addEventListener("click", onFeedClick)

  // Live character counter (2.6) — mirrors the textarea's maxlength.
  const messageEl = getTextAreaElement("gb-message")
  const counterEl = getElement("gb-counter")
  const updateCounter = () => {
    counterEl.textContent = `${messageEl.value.length}/2000`
    announceCharsRemaining(messageEl.value.length, 2000, counterEl)
  }
  messageEl.addEventListener("input", updateCounter)
  updateCounter()

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
