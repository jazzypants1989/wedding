/** @file Review posts (today's "Moderation") — a mail-client split. The left
 *  pane is the queue, the right pane the selected post with its author and
 *  every action. Acting advances to the next post in place (replaceState), so
 *  a whole session of a/a/h/a/r is one history entry, and Back leaves Review. */

import { href, esc, actions, hooks, split, mBack, kbd, toast, withSession, wide, seg } from "../ui.js"
import { store, pendingReview, groupsLeft, ago } from "../data.js"
import { photoSvg, avatarSvg, icon } from "../art.js"

const TYPE_LABEL = /** @type {Record<string, string>} */ ({ photo: "Photo", video: "Video", message: "Guestbook message", comment: "Comment" })
const STATUS_LABEL = /** @type {Record<string, string>} */ ({ pending: "To review", approved: "Approved", hidden: "Hidden", rejected: "Rejected" })

/** Ticked rows for bulk actions. Not in the URL: a tick is scratch, not a place. */
const ticked = new Set()

/** @param {URLSearchParams} q */
function filtered(q) {
  const status = q.get("status") || "pending"
  const type = q.get("type") || ""
  return store.review.filter(
    (r) => r.status === status && (!type || r.type === type || (type === "photo" && r.type === "video")),
  )
}

/** @param {any} r */
const itemKey = (r) => r.type + "-" + r.id
/** @param {string} key */
function byKey(key) {
  const id = Number(key.slice(key.lastIndexOf("-") + 1))
  return store.review.find((r) => r.id === id)
}
/** @param {URLSearchParams} q */
function qs(q) {
  const s = q.toString()
  return s ? "?" + s : ""
}

/** @param {any} r */
function thumb(r) {
  if (r.type === "photo" || r.type === "video") return `<span class="thumb">${photoSvg(r.seed, { video: r.type === "video" })}</span>`
  return `<span class="thumb thumb-avatar">${avatarSvg({ name: r.author, hue: (r.id * 37) % 360 })}</span>`
}

/** @param {any} ctx */
function listMarkup(ctx) {
  const q = /** @type {URLSearchParams} */ (ctx.query)
  const status = q.get("status") || "pending"
  const type = q.get("type") || ""
  const items = filtered(q)
  const current = ctx.params.item
  /** @param {Record<string, string>} patch */
  const withQ = (patch) => {
    const n = new URLSearchParams(q)
    for (const k of Object.keys(patch)) {
      if (patch[k]) n.set(k, patch[k])
      else n.delete(k)
    }
    return "/review" + qs(n)
  }
  const statusSeg = seg(
    ["pending", "hidden", "rejected", "approved"].map((s) => ({
      label: STATUS_LABEL[s],
      to: withQ({ status: s === "pending" ? "" : s }),
      n: s === "pending" ? pendingReview().length : 0,
      on: status === s,
    })),
    "Status",
  )
  const typeChips = [["", "All"], ["photo", "Photos & video"], ["message", "Messages"], ["comment", "Comments"]]
    .map(([t, l]) => `<a class="chip" href="${href(withQ({ type: t }))}" data-replace ${type === t ? 'aria-current="true"' : ""}>${l}</a>`)
    .join("")
  const tickedHere = items.filter((r) => ticked.has(r.id))
  const bulk = tickedHere.length
    ? `<div class="bulkbar" role="region" aria-label="Bulk actions">
        <span>${tickedHere.length} ticked</span>
        <button class="btn btn-sm btn-primary" data-action="rv-bulk" data-to="approved">Approve</button>
        <button class="btn btn-sm" data-action="rv-bulk" data-to="hidden">Hide</button>
        <button class="btn btn-sm" data-action="rv-bulk" data-to="rejected">Reject</button>
        <button class="btn btn-sm btn-ghost" data-action="rv-untick">Clear</button>
      </div>`
    : ""
  const rows = items.length
    ? items
        .map((r) => {
          const on = current === itemKey(r)
          return `<li class="row-wrap">
            <label class="tick" title="Tick for bulk (x)"><input type="checkbox" data-action="rv-tick" data-id="${r.id}" ${ticked.has(r.id) ? "checked" : ""} aria-label="Tick ${esc(r.author)}'s ${TYPE_LABEL[r.type]}"></label>
            <a class="row" href="${href("/review/" + itemKey(r) + qs(q))}" data-select ${on ? 'aria-current="true"' : ""}>
              ${thumb(r)}
              <span class="row-main">
                <span class="row-top"><strong>${esc(r.author)}</strong>${r.trusted ? "" : ` <span class="tag">new</span>`}<span class="row-time">${ago(r.minutesAgo)}</span></span>
                <span class="row-sub">${esc(TYPE_LABEL[r.type])}${r.text ? " · " + esc(r.text) : ""}</span>
              </span>
            </a></li>`
        })
        .join("")
    : `<li class="list-empty">${status === "pending" ? doneMarkup() : `No ${STATUS_LABEL[status].toLowerCase()} posts.`}</li>`
  return `<header class="pane-head">
      <h1>Review posts</h1>
      ${statusSeg}
      <div class="chips" role="group" aria-label="Type">${typeChips}</div>
    </header>
    ${bulk}
    <ul class="rows">${rows}</ul>
    <footer class="pane-foot muted">${kbd("j")} ${kbd("k")} move · ${kbd("x")} tick · ${kbd("?")} all keys</footer>`
}

/** @param {any} ctx */
function detailMarkup(ctx) {
  const q = ctx.query
  const key = ctx.params.item
  const back = mBack("/review" + qs(q), "Review")
  if (!key) {
    const left = pendingReview().length
    if (left) return `<div class="detail-empty"><p>Pick a post on the left.</p></div>`
    return doneMarkup()
  }
  const r = byKey(key)
  if (!r) return `${back}<div class="detail-empty"><p>That post no longer exists.</p></div>`
  const items = filtered(q)
  const i = items.indexOf(r)
  const next = items[i + 1]
  const prev = items[i - 1]
  let content = ""
  if (r.type === "photo" || r.type === "video") {
    content = `<figure class="media-big">${photoSvg(r.seed, { video: r.type === "video" })}${r.text ? `<figcaption>${esc(r.text)}</figcaption>` : ""}</figure>`
  } else if (r.type === "message") {
    content = `<blockquote class="msg-big">${esc(r.text)}</blockquote>`
  } else {
    content = `<div class="parent-ctx"><span class="muted">Replying to ${esc(r.parent.author)}'s ${r.parent.kind}</span>
        <div class="parent-card">${r.parent.kind === "photo" ? `<span class="thumb">${photoSvg(r.parent.seed)}</span>` : ""}<span>${esc(r.parent.snippet)}</span></div>
      </div>
      <blockquote class="msg-big">${esc(r.text)}</blockquote>`
  }
  const statusNote =
    r.status !== "pending"
      ? `<p class="status-note">${STATUS_LABEL[r.status]}. <button class="linklike" data-action="rv-set" data-id="${r.id}" data-to="pending">Move back to review</button></p>`
      : ""
  return `${back}
    <article class="detail">
      <header class="detail-head">
        <span class="eyebrow">${esc(TYPE_LABEL[r.type])} · ${ago(r.minutesAgo)} · ${i + 1 > 0 ? `${i + 1} of ${items.length}` : ""}</span>
        <nav class="stepper-mini" aria-label="Previous and next">
          ${prev ? `<a href="${href("/review/" + itemKey(prev) + qs(q))}" data-select aria-label="Previous (k)">↑</a>` : `<span aria-hidden="true">↑</span>`}
          ${next ? `<a href="${href("/review/" + itemKey(next) + qs(q))}" data-select aria-label="Next (j)">↓</a>` : `<span aria-hidden="true">↓</span>`}
        </nav>
      </header>
      ${statusNote}
      ${content}
      <section class="author">
        <span class="avatar">${avatarSvg({ name: r.author, hue: (r.id * 37) % 360 })}</span>
        <div><strong>${esc(r.author)}</strong><br><span class="muted">${esc(r.relation)} · ${r.trusted ? "Trusted — posts go live without review" : "First posts are reviewed"}</span></div>
        ${r.trusted ? "" : `<button class="btn btn-sm" data-action="rv-trust" data-id="${r.id}">Trust ${esc(r.author.split(" ")[0])} ${kbd("t")}</button>`}
      </section>
    </article>
    <div class="actionbar" role="group" aria-label="Decide">
      <button class="btn btn-primary btn-lg" data-action="rv-set" data-id="${r.id}" data-to="approved">Approve ${kbd("a")}</button>
      <button class="btn btn-lg" data-action="rv-set" data-id="${r.id}" data-to="hidden" title="Hide: off the site, kept for you">Hide ${kbd("h")}</button>
      <button class="btn btn-lg btn-danger-soft" data-action="rv-set" data-id="${r.id}" data-to="rejected">Reject ${kbd("r")}</button>
    </div>`
}

function doneMarkup() {
  const g = groupsLeft().length
  return `<div class="done-state">
    <div class="done-icon">${icon("check")}</div>
    <h2>All caught up</h2>
    <p>Every post has been reviewed. New ones will show up here and on Home.</p>
    ${g ? `<a class="btn btn-primary btn-lg" href="${href("/faces")}">Next: name the faces (${g} groups) →</a>` : ""}
  </div>`
}

/** Move to the item after `r` in the current list (computed BEFORE it left the list). */
function advance(/** @type {any} */ ctx, /** @type {any[]} */ before, /** @type {any} */ r) {
  const i = before.indexOf(r)
  const after = filtered(ctx.query)
  const next = after.find((x) => before.indexOf(x) > i) || after[after.length - 1]
  const q = qs(ctx.query)
  hooks.navigate(next ? "/review/" + itemKey(next) + q : "/review" + q, { replace: true })
}

/** @type {any} */
let lastCtx = null

/** @param {any} r @param {string} to */
function setStatus(r, to) {
  withSession(() => {
    const before = filtered(lastCtx.query)
    const was = r.status
    r.status = to
    ticked.delete(r.id)
    const verb = { approved: "Approved", hidden: "Hidden", rejected: "Rejected", pending: "Moved back to review" }[to]
    toast(`${verb} · ${r.author}'s ${TYPE_LABEL[r.type].toLowerCase()}`, () => {
      r.status = was
      hooks.navigate("/review/" + itemKey(r) + qs(lastCtx.query), { replace: true })
    })
    // Phone and desktop both walk on to the next post (replace), so Back from
    // anywhere in a run of decisions returns to wherever the run started.
    if (before.includes(r)) advance(lastCtx, before, r)
    else hooks.rerender()
  })
}

actions["rv-set"] = (el) => {
  const r = store.review.find((x) => x.id === Number(el.dataset.id))
  if (r) setStatus(r, el.dataset.to || "approved")
}
actions["rv-trust"] = (el) => {
  const r = store.review.find((x) => x.id === Number(el.dataset.id))
  if (!r) return
  withSession(() => {
    const same = store.review.filter((x) => x.author === r.author)
    const held = same.filter((x) => x.status === "pending")
    for (const x of same) x.trusted = true
    for (const x of held) x.status = "approved"
    toast(`Trusted ${r.author} — ${held.length} waiting ${held.length === 1 ? "post" : "posts"} approved too`, () => {
      for (const x of same) x.trusted = false
      for (const x of held) x.status = "pending"
    })
    advance(lastCtx, filtered(lastCtx.query).concat(held), r)
  })
}
actions["rv-tick"] = (el) => {
  const id = Number(el.dataset.id)
  if (ticked.has(id)) ticked.delete(id)
  else ticked.add(id)
  hooks.rerender()
}
actions["rv-untick"] = () => {
  ticked.clear()
  hooks.rerender()
}
actions["rv-bulk"] = (el) => {
  const to = el.dataset.to || "approved"
  withSession(() => {
    const items = store.review.filter((r) => ticked.has(r.id))
    const was = items.map((r) => r.status)
    for (const r of items) r.status = to
    ticked.clear()
    toast(`${items.length} posts ${to}`, () => items.forEach((r, i) => (r.status = was[i])))
    hooks.navigate("/review" + qs(lastCtx.query), { replace: true })
  })
}

/** @type {any[]} */
export const reviewRoutes = [
  {
    pattern: "/review",
    section: "review",
    sel: "item",
    title: () => "Review posts",
    crumbs: () => [{ label: "Memories" }, { label: "Review posts" }],
    render: (/** @type {any} */ ctx) => {
      lastCtx = ctx
      const items = filtered(ctx.query)
      if (wide() && items.length) return { redirect: "/review/" + itemKey(items[0]) + qs(ctx.query) }
      return split({ list: listMarkup(ctx), detail: detailMarkup(ctx), selected: false, label: "Posts" })
    },
    keys: reviewKeys,
  },
  {
    pattern: "/review/:item",
    section: "review",
    sel: "item",
    title: (/** @type {any} */ ctx) => {
      const r = byKey(ctx.params.item)
      return r ? `${TYPE_LABEL[r.type]} from ${r.author}` : "Review posts"
    },
    crumbs: (/** @type {any} */ ctx) => {
      const r = byKey(ctx.params.item)
      return [{ label: "Memories" }, { label: "Review posts", to: "/review" + qs(ctx.query) }, { label: r ? `${r.author} · ${TYPE_LABEL[r.type]}` : "?" }]
    },
    render: (/** @type {any} */ ctx) => {
      lastCtx = ctx
      return split({ list: listMarkup(ctx), detail: detailMarkup(ctx), selected: true, label: "Posts" })
    },
    keys: reviewKeys,
  },
]

/** @param {KeyboardEvent} e @param {any} ctx */
function reviewKeys(e, ctx) {
  const items = filtered(ctx.query)
  const r = ctx.params.item ? byKey(ctx.params.item) : null
  const i = r ? items.indexOf(r) : -1
  const q = qs(ctx.query)
  const go = (/** @type {any} */ x) => x && hooks.navigate("/review/" + itemKey(x) + q, { replace: !!r })
  if (e.key === "j" || e.key === "ArrowDown") {
    go(items[i + 1] || (i < 0 ? items[0] : null))
    return true
  }
  if (e.key === "k" || e.key === "ArrowUp") {
    go(items[i - 1])
    return true
  }
  if (!r) return false
  if (e.key === "a") return setStatus(r, "approved"), true
  if (e.key === "h") return setStatus(r, "hidden"), true
  if (e.key === "r") return setStatus(r, "rejected"), true
  if (e.key === "t" && !r.trusted) {
    const b = /** @type {HTMLElement | null} */ (document.querySelector('[data-action="rv-trust"]'))
    if (b) b.click()
    return true
  }
  if (e.key === "x") {
    if (ticked.has(r.id)) ticked.delete(r.id)
    else ticked.add(r.id)
    hooks.rerender()
    return true
  }
  return false
}
