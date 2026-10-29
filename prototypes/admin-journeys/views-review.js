/** @file "Keep the guestbook tidy" — new posts (one at a time, or all at once),
 *  favourites, trusted guests. */

import { html, raw, plural } from "./html.js"
import { db, save } from "./data.js"
import { sceneSvg, monogram } from "./art.js"
import { L, toast, withSession, withStepNav } from "./shell.js"

/** @typedef {import("./shell.js").Screen} Screen
 *  @typedef {{ nav: (to: string, o?: { replace?: boolean }) => void, refresh: () => void }} Ctx */

const TYPE = /** @type {Record<string, string>} */ ({ guestbook: "Guestbook message", media: "Photo", comment: "Comment" })

/** @param {string} name */
const hueOf = (name) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/** @param {string} view */
function segmented(view) {
  return html`<div class="seg" role="tablist" aria-label="How to review">
    <a role="tab" href="${L("/review/new")}" data-nav="replace" class="${view === "one" ? "on" : ""}" aria-selected="${view === "one"}">One at a time</a>
    <a role="tab" href="${L("/review/all")}" data-nav="replace" class="${view === "all" ? "on" : ""}" aria-selected="${view === "all"}">All at once</a>
  </div>`
}

/** @param {any} item @param {string} verdict */
function decide(item, verdict) {
  const at = db.pending.indexOf(item)
  db.pending.splice(at, 1)
  db.decided.unshift({ ...item, verdict, at })
  if (verdict === "approved" && item.type === "guestbook") {
    db.approved.unshift({ id: 900 + db.decided.length, author: item.author, text: item.text, pinned: false })
  }
  save()
  return () => {
    db.pending.splice(Math.min(at, db.pending.length), 0, item)
    db.decided.shift()
    if (verdict === "approved" && item.type === "guestbook") db.approved.shift()
    save()
  }
}

/** @param {Ctx} ctx @param {string | null} key @returns {Screen} */
export function newPostsScreen(ctx, key) {
  const items = db.pending
  if (!items.length || !key) {
    const body = html`${segmented("one")}<div class="empty-done"><div class="big-check sm" aria-hidden="true">✓</div>
      <h2>All caught up</h2><p>${db.decided.length ? `You looked at ${plural(db.decided.length, "post")}. ` : ""}New posts will show up on Home as they arrive.</p></div>`
    return withStepNav({ journey: "review", step: "new", title: "Look at new posts", body, status: "Nothing waiting" }, true)
  }
  let at = items.findIndex((/** @type {any} */ x) => x.key === key)
  if (at === -1) at = 0
  const item = items[at]
  const total = items.length
  const acct = db.accounts.find((/** @type {any} */ a) => a.name === item.author)
  const where = `Keep the guestbook tidy · Post ${at + 1} of ${total}`
  /** @param {string} verdict @param {string} msg */
  const act = (verdict, msg) =>
    withSession(where, () => {
      const undo = decide(item, verdict)
      toast(msg, () => {
        undo()
        ctx.nav("/review/new/" + item.key, { replace: true })
      })
      const nxt = db.pending[at] || db.pending[0]
      ctx.nav(nxt ? "/review/new/" + nxt.key : "/review/new", { replace: true })
    })
  const skip = () => {
    const nxt = items[at + 1] || items[0]
    if (nxt.key !== item.key) ctx.nav("/review/new/" + nxt.key, { replace: true })
  }
  const content =
    item.type === "media"
      ? html`<img class="mod-photo" src="${sceneSvg(item.seed)}" alt="Placeholder for a guest photo"><p class="cap">"${item.text}"</p>`
      : html`<blockquote class="mod-text">${item.text}</blockquote>${item.on ? html`<p class="fine">On: ${item.on}</p>` : ""}`
  const body = html`${segmented("one")}
    <div class="mod">
      <div class="ask-meta"><span class="bar"><i style="width:${Math.round(((db.decided.length) / (db.decided.length + total)) * 100)}%"></i></span>
        <p><strong>${plural(total, "post")} waiting</strong></p></div>
      <article class="mod-card ${item.spam ? "spam" : ""}">
        <header>${raw(monogram(item.author, hueOf(item.author)))}<div><strong>${item.author}</strong>
          <span class="fine">${TYPE[item.type]} · ${item.at}</span></div>
          ${item.spam ? html`<span class="pill denied">Looks like spam</span>` : ""}</header>
        ${content}
        ${acct && !acct.trusted && acct.posts > 3
          ? html`<p class="nudge">${item.author.split(" ")[0]} has posted ${acct.posts} times. <a href="${L("/review/trusted")}">Trust them</a> and their posts will go straight up.</p>`
          : ""}
      </article>
      <div class="mod-acts">
        <button type="button" class="btn primary big" data-act="approve"><kbd>a</kbd> Approve — put it on the site</button>
        <div class="mod-sec">
          <button type="button" class="btn secondary" data-act="hide"><kbd>h</kbd> Hide</button>
          <button type="button" class="btn ghost danger-t" data-act="reject"><kbd>r</kbd> Reject</button>
          <button type="button" class="btn ghost" data-act="skip"><kbd>s</kbd> Decide later</button>
        </div>
      </div>
    </div>`
  return withStepNav(
    {
      journey: "review",
      step: "new",
      title: `Post ${at + 1} of ${total}`,
      heading: "Look at new posts",
      abWork: html`<button type="button" class="btn secondary sm" data-act="hide">Hide</button><button type="button" class="btn ghost sm danger-t" data-act="reject">Reject</button><button type="button" class="btn primary" data-act="approve">Approve</button>`,
      body,
      status: `${plural(total, "post")} waiting`,
      acts: {
        approve: () => act("approved", "Approved — it's on the site."),
        hide: () => act("hidden", "Hidden. It's kept, just not shown."),
        reject: () => act("rejected", "Rejected."),
        skip,
      },
      keys: {
        a: () => act("approved", "Approved — it's on the site."),
        h: () => act("hidden", "Hidden. It's kept, just not shown."),
        r: () => act("rejected", "Rejected."),
        s: skip,
      },
    },
    false,
  )
}

/** @type {Set<string>} */
const checked = new Set()

/** @param {Ctx} ctx @returns {Screen} */
export function allPostsScreen(ctx) {
  const items = db.pending
  for (const k of [...checked]) if (!items.some((/** @type {any} */ x) => x.key === k)) checked.delete(k)
  /** @param {string} verdict */
  const bulk = (verdict) =>
    withSession("Keep the guestbook tidy · All at once", () => {
      const chosen = items.filter((/** @type {any} */ x) => checked.has(x.key))
      for (const it of chosen) decide(it, verdict)
      checked.clear()
      toast(`${verdict === "approved" ? "Approved" : "Rejected"} ${plural(chosen.length, "post")}.`)
      ctx.refresh()
    })
  const body = html`${segmented("all")}
    ${items.length
      ? html`<div class="toolbar">
          <button type="button" class="btn secondary sm" data-act="all">${checked.size === items.length ? "Select none" : "Select all"}</button>
          <button type="button" class="btn primary sm" data-act="bulk-approve" ${checked.size ? "" : raw("disabled")}>Approve ${checked.size || ""}</button>
          <button type="button" class="btn ghost sm danger-t" data-act="bulk-reject" ${checked.size ? "" : raw("disabled")}>Reject ${checked.size || ""}</button></div>
        <ul class="modlist">${items.map(
          (/** @type {any} */ it) => html`<li class="${it.spam ? "spam" : ""}">
            <label class="ck"><input type="checkbox" data-act="ck" data-key="${it.key}" ${checked.has(it.key) ? raw("checked") : ""}><span class="sr-only">Select</span></label>
            ${it.type === "media" ? html`<img class="thumb" src="${sceneSvg(it.seed)}" alt="">` : raw(monogram(it.author, hueOf(it.author)))}
            <a href="${L("/review/new/" + it.key)}" data-nav="replace"><strong>${it.author}</strong> <span class="fine">${TYPE[it.type]} · ${it.at}</span>
              <span class="ml-t">${it.text}</span></a>
            ${it.spam ? html`<span class="pill denied">spam?</span>` : ""}</li>`,
        )}</ul>`
      : html`<div class="empty-done"><div class="big-check sm" aria-hidden="true">✓</div><h2>All caught up</h2></div>`}`
  return withStepNav(
    {
      journey: "review",
      step: "new",
      title: "All waiting posts",
      heading: "Look at new posts",
      body,
      status: `${plural(items.length, "post")} waiting`,
      acts: {
        ck: (el) => {
          const k = el.dataset.key || ""
          if (checked.has(k)) checked.delete(k)
          else checked.add(k)
          ctx.refresh()
        },
        all: () => {
          if (checked.size === items.length) checked.clear()
          else for (const it of items) checked.add(it.key)
          ctx.refresh()
        },
        "bulk-approve": () => bulk("approved"),
        "bulk-reject": () => bulk("rejected"),
      },
    },
    items.length === 0,
  )
}

/** @param {Ctx} ctx @returns {Screen} */
export function favoritesScreen(ctx) {
  const body = html`<ul class="favs">${db.approved.map(
    (/** @type {any} */ a) => html`<li class="${a.pinned ? "pinned" : ""}">
      <button type="button" class="star" data-act="pin" data-id="${a.id}" aria-pressed="${a.pinned}" aria-label="${a.pinned ? "Unpin" : "Pin"} ${a.author}'s message">${a.pinned ? "★" : "☆"}</button>
      <div><p>${a.text}</p><span class="fine">— ${a.author}</span></div></li>`,
  )}</ul>`
  return withStepNav(
    {
      journey: "review",
      step: "favorites",
      title: "Pin your favourites",
      body,
      status: `${db.approved.filter((/** @type {any} */ a) => a.pinned).length} pinned`,
      acts: {
        pin: (el) =>
          withSession("Keep the guestbook tidy · Favourites", () => {
            const a = db.approved.find((/** @type {any} */ x) => x.id === Number(el.dataset.id))
            a.pinned = !a.pinned
            save()
            ctx.refresh()
          }),
      },
    },
    true,
  )
}

/** @param {Ctx} ctx @returns {Screen} */
export function trustedScreen(ctx) {
  const body = html`<ul class="accts">${db.accounts.map(
    (/** @type {any} */ a) => html`<li>${raw(monogram(a.name, hueOf(a.name)))}<div><strong>${a.name}</strong>
      <span class="fine">${plural(a.posts, "post")}</span></div>
      <label class="switch"><input type="checkbox" role="switch" data-act="trust" data-id="${a.id}" ${a.trusted ? raw("checked") : ""}>
        <span>${a.trusted ? "Trusted" : "Not trusted"}</span></label></li>`,
  )}</ul>`
  return withStepNav(
    {
      journey: "review",
      step: "trusted",
      title: "Trust the regulars",
      body,
      status: `${db.accounts.filter((/** @type {any} */ a) => a.trusted).length} trusted`,
      acts: {
        trust: (el) =>
          withSession("Keep the guestbook tidy · Trusted guests", () => {
            const a = db.accounts.find((/** @type {any} */ x) => x.id === Number(el.dataset.id))
            a.trusted = !a.trusted
            save()
            toast(a.trusted ? `${a.name}'s posts will go straight up.` : `${a.name}'s posts will wait for you.`)
            ctx.refresh()
          }),
      },
    },
    true,
  )
}
