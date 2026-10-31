/** @file Home (IA §2, §13.6) — "what's next", in the order the work runs. Not
 *  a dashboard of numbers: three numbered step cards, each with one obvious
 *  button, and only the first unfinished one highlighted (CSS). Each step
 *  shows its progress in the job's own unit ("38 of 212 faces named"), a
 *  "pick up where you left off" link, and unread replies.
 *  Also feeds the sidebar's Faces and Gifts counts, which no other module
 *  sets. No regex (CLAUDE.md). */
/** @import * as Types from "./types.js" */

import { api } from "./utils.js"
import { html, getElement } from "../utils.js"
import { computeWorklist } from "./thank-you.js"
import { setNavBadge } from "./router.js"
import { icon } from "./icons.js"

const LAST_KEY = "admin-last"

/** "1 photo", "3 photos". @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** "a, b and c". @param {string[]} parts */
function listJoin(parts) {
  if (parts.length <= 1) return parts.join("")
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1]
}

/** @param {Types.HomeStep} s */
function stepCard(s) {
  const done = s.waiting === 0
  return html`<li class="step-card ${done ? "is-done" : ""}">
    <div class="step-num" aria-hidden="true">${done ? icon("check") : String(s.step)}</div>
    <div class="step-body">
      <h2>${s.title}</h2>
      <p>${done ? s.done : s.todo}</p>
      ${s.progress
        ? html`<div class="step-progress">
            <progress class="bar" max="${Math.max(1, s.progress.total)}" value="${s.progress.done}"
              aria-label="${s.title}: ${s.progress.label}"></progress>
            <span class="step-unit">${s.progress.label}</span>
          </div>`
        : ""}
    </div>
    <a class="btn ${done ? "" : "btn-primary"}" href="${s.to}">${done ? "Look again" : s.cta}</a>
  </li>`
}

/** The greeting follows the clock. */
function greeting() {
  const h = new Date().getHours()
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening"
  return `Good ${part}, newlyweds`
}

/** "Pick up where you left off" — the last place visited outside Home. */
function renderResume() {
  let last = ""
  try {
    last = localStorage.getItem(LAST_KEY) ?? ""
  } catch {
    last = ""
  }
  const el = getElement("home-resume")
  if (!last.startsWith("/admin/") || last.startsWith("/admin/more")) {
    el.innerHTML = ""
    return
  }
  const where = last.slice("/admin".length)
  el.innerHTML = html`<a class="resume" href="${last}"
    >${icon("back")}<span>Pick up where you left off</span><code>${where}</code></a
  >`
}

/** @param {Types.HomeData} d */
function render(d) {
  getElement("home-title").textContent = greeting()
  const review = stepCard({
    step: 1,
    waiting: d.review.total,
    title: "Review new posts",
    todo: `${listJoin(
      [
        d.review.media ? count(d.review.media, "photo", "photos") : "",
        d.review.guestbook ? count(d.review.guestbook, "message", "messages") : "",
        d.review.comments ? count(d.review.comments, "comment", "comments") : "",
      ].filter((p) => p !== ""),
    )} ${d.review.total === 1 ? "is" : "are"} waiting before guests can see ${
      d.review.total === 1 ? "it" : "them"
    }.`,
    done: "Nothing waiting. New posts land here.",
    to: "/admin/review",
    cta: `Review ${count(d.review.total, "post", "posts")}`,
  })

  const f = d.faces
  const facesWaiting = f ? f.groups + f.ask : 0
  const faces = stepCard({
    step: 2,
    waiting: facesWaiting,
    title: "Name the faces",
    todo: f
      ? f.groups > 0
        ? `${count(f.groups, "group", "groups")} of look-alike faces${
            f.ask > 0 ? `, then ${count(f.ask, "quick question", "quick questions")}` : ""
          }.`
        : `${count(f.ask, "quick question", "quick questions")} about faces we couldn't place.`
      : "",
    done:
      f && f.total > 0
        ? "Everyone in the photos has a name."
        : "No faces to name yet. They show up here once the photos are scanned.",
    to: "/admin/faces",
    cta: f && f.groups > 0 ? `Name ${count(f.groups, "group", "groups")}` : "Answer the questions",
    progress:
      f && f.total > 0
        ? { done: f.named, total: f.total, label: `${f.named} of ${f.total} faces named` }
        : undefined,
  })

  const t = d.thanks
  const thanks = stepCard({
    step: 3,
    waiting: t.unwritten + t.drafts,
    title: "Thank everyone",
    todo: listJoin(
      [
        t.unwritten ? `${count(t.unwritten, "gift", "gifts")} without a card yet` : "",
        t.drafts
          ? `${count(t.drafts, "card", "cards")} drafted and ready to send`
          : "",
      ].filter((p) => p !== ""),
    ) + ".",
    done: t.owed > 0 ? "Every gift has been thanked." : "No gifts logged yet. Add one under Gifts.",
    to: t.drafts > 0 ? "/admin/thank-yous/cards/send" : "/admin/thank-yous/gifts",
    cta: t.drafts > 0
      ? `Send ${count(t.drafts, "drafted card", "drafted cards")}`
      : `Write ${count(t.unwritten, "card", "cards")}`,
    progress:
      t.owed > 0
        ? { done: t.thanked, total: t.owed, label: `${t.thanked} of ${t.owed} guests thanked` }
        : undefined,
  })

  getElement("home-steps").innerHTML = html`${review}${faces}${thanks}`
  getElement("home-replies").innerHTML =
    d.replies > 0
      ? html`<a class="home-replies" href="/admin/thank-yous/replies"
          >${icon("replies")}<span
            ><strong>${count(d.replies, "new reply", "new replies")}</strong> to your cards</span
          ></a
        >`
      : ""
}

/** Faces are computed fresh on the server (clustering), so they are fetched
 *  here and on the Faces screen only — never on the badge poll.
 *  @returns {Promise<Types.HomeData["faces"]>} */
async function loadFaces() {
  try {
    const o = /** @type {Types.FacesOverviewResponse} */ (await api("/api/admin/faces/overview"))
    // Counted the way the Faces stepper counts: a group of two or more is a
    // group; a lone face is a quick question. The ask queue ranks every unnamed
    // face, so adding its length would count faces in groups twice.
    const faces = {
      groups: o.groups.filter((g) => g.size >= 2).length,
      ask: o.groups.filter((g) => g.size === 1 && g.media.length === 1).length,
      named: o.counts.identified,
      total: o.counts.faces,
    }
    setNavBadge("faces", faces.groups + faces.ask)
    return faces
  } catch {
    return null
  }
}

/** Gifts and cards → the thank-you step's numbers.
 *  @returns {Promise<Types.HomeData["thanks"]>} */
async function loadThanks() {
  const [gifts, cards, counts] = await Promise.all([
    api("/api/admin/gifts"),
    api("/api/admin/thank-you"),
    api("/api/admin/thank-you/counts"),
  ])
  const giftRows = /** @type {Types.GiftsResponse} */ (gifts).gifts
  const cardRows = /** @type {Types.CardsResponse} */ (cards).cards
  const c = /** @type {Types.ThankYouCounts} */ (counts)
  const { owed, thanked, remaining } = computeWorklist(giftRows, cardRows)
  const drafted = new Set(
    cardRows.filter((card) => card.status === "draft").map((card) => card.guest_id),
  )
  const unwritten = remaining.filter((r) => !drafted.has(r.guestId)).length
  setNavBadge("gifts", unwritten)
  return { owed, thanked, unwritten, drafts: c.drafts || 0, unread: c.unreadReplies || 0 }
}

/** @type {Types.loadHome} */
export async function loadHome() {
  const errorEl = getElement("inbox-error")
  errorEl.hidden = true
  renderResume()
  try {
    const [modCounts, faces, thanks] = await Promise.all([
      api("/api/admin/moderation/counts"),
      loadFaces(),
      loadThanks(),
    ])
    const review = /** @type {Types.ModerationCountsResponse} */ (modCounts)
    render({ review, faces, thanks, replies: thanks.unread })
  } catch {
    errorEl.textContent = "Couldn't load what's waiting. Reload the page to try again."
    errorEl.hidden = false
  }
}

/** The badge poll's share (main.js): the Gifts count, which only Home computes.
 *  @type {Types.refreshHomeBadges} */
export async function refreshHomeBadges() {
  try {
    await loadThanks()
  } catch {
    // Non-critical.
  }
}
