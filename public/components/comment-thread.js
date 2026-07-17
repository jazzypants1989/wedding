/** @file Shared comment thread for guestbook entries and gallery media.
 *
 * Collapsed by default everywhere ("N comments" toggle). First expand fetches
 * and renders the thread (oldest-first); the composer is gated by requireAccount
 * and appends optimistically. Own comments carry a delete button; own pending
 * comments show the awaiting-approval chip (visible only to their author via the
 * API). One delegated click + submit listener covers a whole page.
 */
/** @import * as Types from "./types.js" */

import { html, api, getErrorMessage } from "../pages/utils.js"
import { requireAccount } from "./guest-session.js"
import { formatRelative, upgradeTimes } from "./relative-time.js"
import { announcePolite } from "./announce.js"

/** Max comment length — mirrors the server limit; drives the counter + maxlength. */
const COMMENT_MAXLENGTH = 500

/** @type {Types.renderCommentThread} */
export function renderCommentThread(targetType, targetId, count = 0) {
  return html`
    <div class="comment-thread" data-comment-thread data-target-type="${targetType}"
      data-target-id="${targetId}" data-expanded="false">
      <button type="button" class="comment-toggle" data-comment-action="toggle"
        aria-expanded="false">
        <span class="comment-toggle-label">${countLabel(count)}</span>
      </button>
      <div class="comment-body" data-comment-body hidden></div>
    </div>`
}

/** @type {Types.initCommentThreads} */
export function initCommentThreads(root = document.body) {
  root.addEventListener("click", onClick)
  root.addEventListener("submit", onSubmit)
  root.addEventListener("input", onInput)
}

/** Live "N/500" counter for the comment textarea (2.6). @param {Event} e */
function onInput(e) {
  const input = e.target
  if (!(input instanceof HTMLTextAreaElement)) return
  if (!input.matches("[data-comment-input]")) return
  const form = input.closest("[data-comment-form]")
  const counter = form && form.querySelector("[data-comment-counter]")
  if (counter instanceof HTMLElement) {
    counter.textContent = `${input.value.length}/${COMMENT_MAXLENGTH}`
  }
}

/** @param {number} count @returns {string} */
function countLabel(count) {
  if (count <= 0) return "Comment"
  return count === 1 ? "1 comment" : `${count} comments`
}

/** @param {Types.CommentListItem} c */
function renderComment(c) {
  const pending = c.status === "pending" && c.is_own
  return html`
    <li class="comment${pending ? " comment-pending" : ""}" data-comment-id="${c.id}">
      <div class="comment-head">
        <span class="comment-author">${c.author_name}</span>
        <time class="comment-time" datetime="${c.created_at}">${formatRelative(
          c.created_at,
        )}</time>
      </div>
      <p class="comment-message">${c.message}</p>
      ${pending
        ? html`<span class="status-badge status-pending comment-pending-chip"
            >Awaiting approval — only you can see this</span
          >`
        : ""}
      ${c.is_own
        ? html`<button type="button" class="comment-delete" data-comment-action="delete"
            data-comment-id="${c.id}">Delete</button>`
        : ""}
    </li>`
}

function composerMarkup() {
  return html`
    <form class="comment-composer" data-comment-form>
      <textarea class="comment-input" data-comment-input rows="2" maxlength="${COMMENT_MAXLENGTH}"
        placeholder="Add a comment…" aria-label="Add a comment"></textarea>
      <span class="char-counter" data-comment-counter aria-hidden="true">0/${COMMENT_MAXLENGTH}</span>
      <button type="submit" class="btn btn-small comment-submit">Post</button>
    </form>
    <p class="comment-error" data-comment-error hidden></p>`
}

/** @param {HTMLElement} thread @returns {HTMLElement} */
function getBody(thread) {
  const body = thread.querySelector("[data-comment-body]")
  if (!(body instanceof HTMLElement)) throw new Error("comment body missing")
  return body
}

/** @param {HTMLElement} thread */
function context(thread) {
  return {
    targetType: thread.dataset.targetType || "",
    targetId: thread.dataset.targetId || "",
  }
}

/** @param {Event} e */
function onClick(e) {
  const el = e.target
  if (!(el instanceof Element)) return
  const actionEl = el.closest("[data-comment-action]")
  if (!(actionEl instanceof HTMLElement)) return
  const thread = actionEl.closest("[data-comment-thread]")
  if (!(thread instanceof HTMLElement)) return
  const action = actionEl.dataset.commentAction
  if (action === "toggle") void onToggle(thread)
  else if (action === "delete") void onDelete(thread, actionEl)
}

/** @param {HTMLElement} thread */
async function onToggle(thread) {
  const body = getBody(thread)
  const toggleBtn = thread.querySelector(".comment-toggle")
  const expanded = thread.dataset.expanded === "true"
  thread.dataset.expanded = expanded ? "false" : "true"
  if (toggleBtn instanceof HTMLElement) {
    toggleBtn.setAttribute("aria-expanded", expanded ? "false" : "true")
  }
  body.hidden = expanded
  if (!expanded && thread.dataset.loaded !== "true") {
    await loadComments(thread)
  }
}

/** @param {HTMLElement} thread */
async function loadComments(thread) {
  const body = getBody(thread)
  const { targetType, targetId } = context(thread)
  body.innerHTML = html`<p class="comment-loading">Loading…</p>`
  try {
    const data = /** @type {Types.CommentListResponse} */ (
      await api(`/api/${targetType}/${targetId}/comments`)
    )
    // The empty line keeps a zero-comment expand from reading as a no-op
    // (just a bare text box); appendComment removes it on the first post.
    body.innerHTML = html`
      <ul class="comment-list" data-comment-list>
        ${data.comments.map(renderComment)}
      </ul>
      ${data.comments.length === 0
        ? html`<p class="comment-empty" data-comment-empty>
            No comments yet — say something nice ✨</p>`
        : ""}
      ${composerMarkup()}`
    upgradeTimes(body)
    thread.dataset.loaded = "true"
    updateCount(thread)
  } catch (err) {
    body.innerHTML = html`<p class="comment-error">${getErrorMessage(err)}</p>`
  }
}

/** @param {Event} e */
function onSubmit(e) {
  const form = e.target
  if (!(form instanceof HTMLFormElement)) return
  if (!form.matches("[data-comment-form]")) return
  e.preventDefault()
  const thread = form.closest("[data-comment-thread]")
  if (!(thread instanceof HTMLElement)) return
  const input = form.querySelector("[data-comment-input]")
  if (!(input instanceof HTMLTextAreaElement)) return
  const message = input.value.trim()
  if (!message) {
    input.focus()
    return
  }
  // Browse freely; gate only at write. This exact post replays after sign-in.
  requireAccount(() => void postComment(thread, input, message))
}

/**
 * @param {HTMLElement} thread
 * @param {HTMLTextAreaElement} input
 * @param {string} message
 */
async function postComment(thread, input, message) {
  const { targetType, targetId } = context(thread)
  clearError(thread)
  try {
    const data = /** @type {Types.CommentPostResponse} */ (
      await api(`/api/${targetType}/${targetId}/comments`, {
        method: "POST",
        csrf: true,
        csrfCookie: "guest_csrf",
        body: JSON.stringify({ message }),
      })
    )
    input.value = ""
    // Let the existing input handler (onInput) reset the "N/500" counter.
    input.dispatchEvent(new Event("input", { bubbles: true }))
    appendComment(thread, data.comment)
    updateCount(thread)
    // The appended node is silent to screen readers — say what happened
    // (pending comments look posted to their author but aren't public yet).
    announcePolite(
      data.comment.status === "pending"
        ? "Comment sent — the couple will approve it soon"
        : "Comment posted",
    )
  } catch (err) {
    showError(thread, getErrorMessage(err))
  }
}

/** @param {HTMLElement} thread @param {Types.CommentListItem} comment */
function appendComment(thread, comment) {
  const empty = thread.querySelector("[data-comment-empty]")
  if (empty) empty.remove()
  const list = thread.querySelector("[data-comment-list]")
  if (!(list instanceof HTMLElement)) return
  const wrapper = document.createElement("template")
  wrapper.innerHTML = renderComment(comment)
  const node = wrapper.content.firstElementChild
  if (node) {
    list.appendChild(node)
    upgradeTimes(node)
  }
}

/** @param {HTMLElement} thread @param {HTMLElement} btn */
async function onDelete(thread, btn) {
  const id = btn.dataset.commentId
  if (!id) return
  if (!window.confirm("Delete this comment?")) return
  clearError(thread)
  try {
    await api(`/api/comments/${id}`, {
      method: "DELETE",
      csrf: true,
      csrfCookie: "guest_csrf",
    })
    const li = btn.closest(".comment")
    if (li) li.remove()
    updateCount(thread)
  } catch (err) {
    showError(thread, getErrorMessage(err))
  }
}

/** Recompute the toggle label from the approved comments now in the DOM. */
/** @param {HTMLElement} thread */
function updateCount(thread) {
  const list = thread.querySelector("[data-comment-list]")
  const label = thread.querySelector(".comment-toggle-label")
  if (!(label instanceof HTMLElement)) return
  const approved = list
    ? list.querySelectorAll(".comment:not(.comment-pending)").length
    : 0
  label.textContent = countLabel(approved)
  // Broadcast the fresh approved count so a page rendering the thread from
  // cached data (the gallery lightbox) can write it back and stay faithful.
  const { targetType, targetId } = context(thread)
  if (targetType && targetId) {
    window.dispatchEvent(
      new CustomEvent("comment:changed", {
        detail: { targetType, targetId: Number(targetId), count: approved },
      }),
    )
  }
}

/** @param {HTMLElement} thread @param {string} message */
function showError(thread, message) {
  const el = thread.querySelector("[data-comment-error]")
  if (!(el instanceof HTMLElement)) return
  el.textContent = message
  el.hidden = false
}

/** @param {HTMLElement} thread */
function clearError(thread) {
  const el = thread.querySelector("[data-comment-error]")
  if (el instanceof HTMLElement) el.hidden = true
}
