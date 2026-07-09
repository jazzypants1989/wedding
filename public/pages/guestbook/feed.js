/** @file Guestbook feed + composer: render, keyset pagination, optimistic posts */
/** @import * as Types from "./types.js" */

import {
  html,
  api,
  formatDate,
  getElement,
  getButtonElement,
  getTextAreaElement,
  getErrorMessage,
} from "../utils.js"
import { requireAccount } from "../../components/guest-session.js"
import { fireConfetti, miniSparkle, setButtonLoading } from "../../components/celebrate.js"
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
  for (const entry of entries) {
    const wrapper = document.createElement("div")
    wrapper.innerHTML = renderEntry(entry)
    const card = wrapper.firstElementChild
    if (card) frag.appendChild(card)
  }
  if (prepend) feed.insertBefore(frag, feed.firstChild)
  else feed.appendChild(frag)
  renderedCount += entries.length
  upgradeTimes(feed)
  updateEmptyState()
}

function updateEmptyState() {
  getElement("gb-empty").hidden = renderedCount > 0
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
    if (nextCursor === null) {
      reachedEnd = true
      btn.hidden = true
    } else {
      btn.hidden = false
    }
    if (isAuto) autoFetches += 1
  } catch (err) {
    showError(getErrorMessage(err))
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
  const note = getElement("gb-pending-note")
  note.innerHTML = html`
    <span>Thanks! Jordana &amp; Jesse approve messages from new folks — yours
      will appear for everyone soon.</span>
    <button type="button" class="gb-note-dismiss" id="gb-note-dismiss"
      aria-label="Dismiss">&times;</button>
  `
  note.hidden = false
  getButtonElement("gb-note-dismiss").addEventListener("click", () => {
    note.hidden = true
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
    getTextAreaElement("gb-message").value = ""
    addEntries([data.entry], true)
    celebrate(data.status)
    if (data.status === "pending") showPendingNote()
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

  loadPage(false)
}
