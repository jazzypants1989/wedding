/** @file Today (home) and the Review flow (moderation). */

import {
  state,
  save,
  logDone,
  pendingModeration,
  unreadReplies,
  draftCards,
  pendingPetitions,
  unnamedGroups,
  openAsk,
  facesNamed,
  thanksProgress,
  guestById,
  giftById,
} from "./data.js"
import { route, navigate, setQuery, href, returnTo } from "./router.js"
import { scenerySvg, avatar } from "./art.js"
import { esc, icon, toast, meter, ring, flowBar, wireFlowExit, act, kbd, rerender, plural } from "./ui.js"

// ---- the task model --------------------------------------------------------

/**
 * Everything Today can ask of you, in priority order. The order is the
 * argument (IA.md §2): things guests are waiting on first, then warm quick
 * wins, then etiquette with a clock on it, then open-ended work — which is cut
 * into a finishable daily set so Today can actually reach zero.
 */
export function tasks() {
  if (state.mode === "pre") return preTasks()
  /** @type {any[]} */
  const list = []
  const mod = pendingModeration()
  if (mod.length) {
    const kinds = { media: 0, guestbook: 0, comment: 0 }
    for (const m of mod) kinds[/** @type {keyof typeof kinds} */ (m.type)]++
    const parts = []
    if (kinds.media) parts.push(plural(kinds.media, "photo"))
    if (kinds.guestbook) parts.push(plural(kinds.guestbook, "message"))
    if (kinds.comment) parts.push(plural(kinds.comment, "comment"))
    list.push({
      id: "review",
      icon: "review",
      title: `Review ${plural(mod.length, "new post")}`,
      why: "Guests can't see these until you approve them.",
      detail: parts.join(" · "),
      est: `~${Math.max(1, Math.round(mod.length * 0.3))} min`,
      to: `/review/${mod[0].key}`,
      cta: "Start reviewing",
      alt: { to: "/review", label: "See the list" },
    })
  }
  const replies = unreadReplies()
  if (replies.length) {
    const first = replies[0]
    list.push({
      id: "replies",
      icon: "mailbox",
      title: `Read ${plural(replies.length, "card reply", "card replies")}`,
      why: `${esc(guestById(first.guestId)?.name)} replied ${first.reply.emoji} ${first.reply.ago} ago`,
      detail: "",
      est: "1 min",
      to: "/thanks/mailbox",
      cta: "Open mailbox",
    })
  }
  const pets = pendingPetitions()
  if (pets.length) {
    list.push({
      id: "requests",
      icon: "requests",
      title: `Answer ${plural(pets.length, "invitation request")}`,
      why: `${esc(pets[0].name)} asked ${pets[0].ago} ago.`,
      detail: "",
      est: "1 min",
      to: `/guests/requests/${pets[0].id}`,
      cta: "Answer",
    })
  }
  const drafts = draftCards()
  if (drafts.length) {
    const names = drafts.map((c) => guestById(c.guestId)?.name.split(" ")[0])
    list.push({
      id: "send",
      icon: "cards",
      title: `Send ${plural(drafts.length, "finished card")}`,
      why: `Written and waiting: ${esc(names.slice(0, 3).join(", "))}${names.length > 3 ? ` and ${names.length - 3} more` : ""}.`,
      detail: "One pass: pick how to send, check, send.",
      est: "2 min",
      to: "/thanks/send",
      cta: "Send them",
    })
  }
  const tp = thanksProgress()
  if (tp.remaining.length) {
    const next = tp.remaining[0]
    const g = guestById(next.guestId)
    const days = Math.round((Date.parse("2026-10-29") - Date.parse(next.received)) / 86400000)
    list.push({
      id: "thank",
      icon: "gifts",
      title: `Thank ${esc(g?.name)}`,
      why: `${esc(next.desc)} · arrived ${days} days ago — longest waiting.`,
      detail: tp.remaining.length > 1 ? `${tp.remaining.length - 1} more after this` : "the last one!",
      est: "3 min",
      to: `/thanks/cards/new?guest=${next.guestId}`,
      cta: "Write their card",
    })
  }
  const groups = unnamedGroups()
  if (groups.length && !state.setDoneToday) {
    const set = Math.min(5, groups.length)
    list.push({
      id: "faces",
      icon: "faces",
      title: `Name today's ${plural(set, "face group")}`,
      why: `${groups.length} groups left in all — today's set covers about ${groups.slice(0, set).reduce((n, g) => n + g.faces.length, 0)} faces.`,
      detail: "No one is waiting on this. Do a set, stop any time.",
      est: `~${set} min`,
      to: `/faces/groups/f${groups[0].anchor}?set=${set}`,
      cta: "Start the set",
      alt: { to: "/faces", label: "All face work" },
    })
  }
  return list.filter((t) => !state.snoozed.includes(t.id))
}

function preTasks() {
  const awaiting = state.guests.filter((g) => g.status !== "responded").length
  const notInvited = state.guests.filter((g) => g.status === "pending").length
  /** @type {any[]} */
  const list = []
  if (pendingPetitions().length) {
    list.push({ id: "requests", icon: "requests", title: "Answer 1 invitation request", why: "Carla Mendes asked 2 days ago.", detail: "", est: "1 min", to: "/guests/requests/pt8", cta: "Answer" })
  }
  list.push({ id: "invite", icon: "guests", title: `Send ${plural(notInvited, "invitation")}`, why: "These guests haven't been invited yet.", detail: "", est: "2 min", to: "/guests/invite", cta: "Send invites" })
  list.push({ id: "remind", icon: "rsvps", title: `Nudge ${awaiting} guests who haven't replied`, why: "RSVPs close in 3 weeks.", detail: "", est: "2 min", to: "/guests/rsvps?status=awaiting", cta: "See who" })
  return list.filter((t) => !state.snoozed.includes(t.id))
}

/** Total open tasks — the Today badge. */
export function taskCount() {
  return tasks().length
}

// ---- Today -----------------------------------------------------------------

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
}

function todayView() {
  const list = tasks()
  const snoozed = state.snoozed
  const named = facesNamed()
  const tp = thanksProgress()
  const doneToday = state.done
  const post = state.mode === "post"
  const sub = post
    ? "Six months since the wedding. Here's what needs you — top to bottom, in that order."
    : "Twenty-five days to go. Here's what needs you."

  const taskHtml = list
    .map(
      (t, i) => `<li class="task ${i === 0 ? "is-first" : ""}" data-task="${t.id}">
      <span class="task-icon">${icon(t.icon, 22)}</span>
      <div class="task-main">
        <h3 class="task-title">${t.title}</h3>
        <p class="task-why">${t.why}</p>
        ${t.detail ? `<p class="task-detail">${t.detail}</p>` : ""}
      </div>
      <div class="task-actions">
        <a class="btn ${i === 0 ? "btn-primary" : "btn-secondary"} task-go" href="${href(t.to)}">${t.cta} ${icon("next", 16)}</a>
        <span class="task-meta">${icon("clock", 14)} ${t.est}
          ${t.alt ? ` · <a href="${href(t.alt.to)}">${t.alt.label}</a>` : ""}
          · <button type="button" class="linkish task-later" data-id="${t.id}">Later</button></span>
      </div>
    </li>`,
    )
    .join("")

  const allClear = `<div class="all-clear">
      <div class="all-clear-mark">${icon("check", 40)}</div>
      <h2>All caught up.</h2>
      <p>Nothing needs you right now. New posts and replies will show up here.</p>
      ${unnamedGroups().length ? `<p><a href="${href("/faces")}">Feel like naming a few more faces?</a></p>` : ""}
    </div>`

  const progress = post
    ? `<section class="aftermath" aria-label="Wedding aftermath progress">
      <a class="aft" href="${href("/review")}">
        <span class="aft-label">Review queue</span>
        <span class="aft-value">${pendingModeration().length ? `${pendingModeration().length} waiting` : "Clear"}</span>
        ${meter(pendingModeration().length ? 0 : 1, 1)}
      </a>
      <a class="aft" href="${href("/thanks")}">
        <span class="aft-label">Thank-yous sent</span>
        <span class="aft-value">${tp.thanked} of ${tp.owed}</span>
        ${meter(tp.thanked, tp.owed)}
      </a>
      <a class="aft" href="${href("/faces")}">
        <span class="aft-label">Faces named</span>
        <span class="aft-value">${Math.round((named / state.facesTotal) * 100)}%</span>
        ${meter(named, state.facesTotal)}
      </a>
    </section>`
    : ""

  return `<div class="page today">
    <header class="page-head">
      <p class="eyebrow">Today · ${new Date("2026-10-29T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      <h1>${greeting()}, Jordana &amp; Jesse</h1>
      <p class="lede">${list.length ? sub : ""}</p>
    </header>
    ${progress}
    <section aria-labelledby="needs-h">
      <h2 id="needs-h" class="section-h">Needs you ${list.length ? `<span class="count">${list.length}</span>` : ""}</h2>
      ${list.length ? `<ol class="tasks">${taskHtml}</ol>` : allClear}
    </section>
    ${
      snoozed.length
        ? `<p class="snoozed">Put off till tomorrow: ${snoozed.length} · <button type="button" class="linkish unsnooze">bring ${snoozed.length === 1 ? "it" : "them"} back</button></p>`
        : ""
    }
    ${
      doneToday.length
        ? `<section aria-labelledby="done-h" class="done-today">
        <h2 id="done-h" class="section-h">Done today <span class="count done">${doneToday.length}</span></h2>
        <ul>${doneToday
          .slice(0, 8)
          .map((d) => `<li>${icon("check", 16)} ${d.text}</li>`)
          .join("")}${doneToday.length > 8 ? `<li class="muted">…and ${doneToday.length - 8} more</li>` : ""}</ul>
      </section>`
        : ""
    }
    <p class="hint-line">Tip: press ${kbd("/")} or ${kbd("⌘K")} to jump anywhere, ${kbd("?")} for all shortcuts.</p>
  </div>`
}

route("/", {
  nav: "today",
  title: () => "Today",
  render: todayView,
  mount(el) {
    el.querySelectorAll(".task-later").forEach((b) =>
      b.addEventListener("click", () => {
        const id = /** @type {HTMLElement} */ (b).dataset.id || ""
        state.snoozed.push(id)
        save()
        toast("Moved to tomorrow.", {
          undo: () => {
            state.snoozed = state.snoozed.filter((s) => s !== id)
            save()
            rerender()
          },
        })
        rerender()
      }),
    )
    el.querySelector(".unsnooze")?.addEventListener("click", () => {
      state.snoozed = []
      save()
      rerender()
    })
  },
  keys(e) {
    // Enter on Today starts the top task — the whole page is one decision.
    if (e.key === "Enter") {
      const first = document.querySelector(".task.is-first .task-go")
      if (first instanceof HTMLAnchorElement) {
        first.click()
        return true
      }
    }
    return false
  },
})

// ---- Review (moderation) ---------------------------------------------------

const TYPE_LABEL = { media: "Photo", guestbook: "Message", comment: "Comment" }

function previewOf(m, big = false) {
  if (m.type === "media") {
    return `<figure class="mod-media ${big ? "is-big" : ""}">${scenerySvg(m.hue)}<figcaption>${m.caption ? esc(m.caption) : '<span class="muted">No caption</span>'}</figcaption></figure>`
  }
  if (m.type === "comment") {
    return `<div class="mod-text ${big ? "is-big" : ""}"><p class="mod-parent">On ${esc(m.parent)}</p><p>${esc(m.text)}</p></div>`
  }
  return `<div class="mod-text ${big ? "is-big" : ""}"><p>${esc(m.text)}</p></div>`
}

function reviewList(ctx) {
  const type = ctx.query.get("type") || ""
  const status = ctx.query.get("status") || "pending"
  const items = state.moderation.filter(
    (m) => (!type || m.type === type) && m.status === status,
  )
  const pending = pendingModeration()
  const chip = (key, val, label, cur) =>
    `<button type="button" class="chip ${cur === val ? "is-on" : ""}" data-q="${key}" data-v="${val}" aria-pressed="${cur === val}">${label}</button>`
  return `<div class="page">
    <header class="page-head row">
      <div><p class="eyebrow">Memories</p><h1>Review queue</h1>
      <p class="lede">Posts from guests who aren't trusted yet wait here. Approving someone's post trusts them for next time.</p></div>
      ${pending.length ? `<a class="btn btn-primary" href="${href(`/review/${pending[0].key}`)}">Review ${pending.length} one by one ${icon("next", 16)}</a>` : ""}
    </header>
    <div class="chips" role="group" aria-label="Filter">
      ${chip("status", "pending", `Waiting (${pending.length})`, status)}
      ${chip("status", "approved", "Approved", status)}
      ${chip("status", "hidden", "Hidden", status)}
      ${chip("status", "rejected", "Rejected", status)}
      <span class="chip-sep"></span>
      ${chip("type", "", "All kinds", type)}
      ${chip("type", "media", "Photos", type)}
      ${chip("type", "guestbook", "Messages", type)}
      ${chip("type", "comment", "Comments", type)}
    </div>
    ${
      items.length
        ? `<ul class="rows">${items
            .map(
              (m) => `<li><a class="row-link" href="${href(`/review/${m.key}`)}">
          <span class="row-thumb">${m.type === "media" ? scenerySvg(m.hue) : avatar(m.author, 40)}</span>
          <span class="row-main"><strong>${esc(m.author)}</strong> <span class="muted">· ${TYPE_LABEL[/** @type {keyof typeof TYPE_LABEL} */ (m.type)]} · ${m.ago} ago</span>
            <span class="row-text">${esc(m.text || m.caption || "Photo")}</span></span>
          <span class="row-go">${icon("next")}</span></a></li>`,
            )
            .join("")}</ul>`
        : `<div class="empty">${status === "pending" ? "Nothing waiting. 🎉" : "Nothing here."}</div>`
    }
  </div>`
}

route("/review", {
  nav: "review",
  title: () => "Review queue",
  render: reviewList,
  mount(el) {
    el.querySelectorAll(".chip[data-q]").forEach((c) =>
      c.addEventListener("click", () => {
        const d = /** @type {HTMLElement} */ (c).dataset
        setQuery({ [d.q || ""]: d.v === "pending" && d.q === "status" ? null : d.v })
        rerender()
      }),
    )
  },
})

route("/review/done", {
  nav: "review",
  flow: true,
  title: () => "Queue clear",
  render() {
    const next = tasks()[0]
    return `<div class="page flow-page">
      ${flowBar({ label: "Review", exitTo: "/review" })}
      <div class="celebrate">
        <div class="all-clear-mark">${icon("check", 44)}</div>
        <h1>Queue clear.</h1>
        <p class="lede">Every guest post is decided. New ones will show up on Today.</p>
        <div class="celebrate-actions">
          ${next ? `<a class="btn btn-primary" href="${href(next.to)}">Next: ${next.title} ${icon("next", 16)}</a>` : ""}
          <button type="button" class="btn btn-secondary back-today">Back to Today</button>
        </div>
      </div>
    </div>`
  },
  mount(el) {
    wireFlowExit(el)
    el.querySelector(".back-today")?.addEventListener("click", () => returnTo("/"))
  },
})

function nextPendingAfter(key) {
  const all = state.moderation
  const i = all.findIndex((m) => m.key === key)
  for (let k = 1; k <= all.length; k++) {
    const m = all[(i + k) % all.length]
    if (m.status === "pending" && m.key !== key) return m
  }
  return null
}
function prevPendingBefore(key) {
  const all = state.moderation
  const i = all.findIndex((m) => m.key === key)
  for (let k = 1; k <= all.length; k++) {
    const m = all[(i - k + all.length) % all.length]
    if (m.status === "pending" && m.key !== key) return m
  }
  return null
}

const VERB = { approved: "Approved", hidden: "Hid", rejected: "Rejected" }

function decide(m, status) {
  act(() => {
    const before = m.status
    m.status = status
    if (status === "approved") {
      const acct = state.accounts.find((a) => a.name === m.author)
      if (acct) acct.trusted = true
    }
    save()
    const what = `${m.author.split(" ")[0]}'s ${TYPE_LABEL[/** @type {keyof typeof TYPE_LABEL} */ (m.type)].toLowerCase()}`
    logDone("review", `${VERB[/** @type {keyof typeof VERB} */ (status)]} ${esc(what)}`)
    const next = nextPendingAfter(m.key)
    // Advancing because the item is DONE replaces — Back leaves the run.
    navigate(next ? `/review/${next.key}` : "/review/done", { replace: true })
    toast(`${VERB[/** @type {keyof typeof VERB} */ (status)]} ${esc(what)}.`, {
      undo: () => {
        m.status = before
        state.done.shift()
        save()
        navigate(`/review/${m.key}`, { replace: true })
      },
    })
  })
}

route("/review/:key", {
  nav: "review",
  flow: true,
  title: (ctx) => "Review",
  render(ctx) {
    const m = state.moderation.find((x) => x.key === ctx.params.key)
    if (!m) return `<div class="page"><div class="empty">That post is gone. <a href="${href("/review")}">Back to the queue</a></div></div>`
    const pending = pendingModeration()
    const pos = pending.findIndex((x) => x.key === m.key) + 1
    const decidedNote =
      m.status !== "pending"
        ? `<p class="notice">Already ${m.status}. You can change your mind below.</p>`
        : ""
    const trust = m.trusted
      ? `<span class="pill ok">Trusted</span>`
      : m.firstPost
        ? `<span class="pill warn">First post</span> <span class="muted">Approving trusts ${esc(m.author.split(" ")[0])}'s future posts.</span>`
        : `<span class="pill">Not trusted yet</span>`
    return `<div class="page flow-page">
      ${flowBar({
        label: "Review",
        pos: pos || undefined,
        total: pos ? pending.length : undefined,
        exitTo: "/review",
        extra: `<a href="${href("/review")}" class="muted">List</a>`,
      })}
      <article class="review-card">
        <header class="review-author">${avatar(m.author, 44)}
          <div><strong>${esc(m.author)}</strong> <span class="muted">· ${TYPE_LABEL[/** @type {keyof typeof TYPE_LABEL} */ (m.type)]} · ${m.ago} ago</span>
          <div class="trust">${trust}</div></div>
        </header>
        ${decidedNote}
        ${previewOf(m, true)}
      </article>
      <div class="actionbar" role="group" aria-label="Decide">
        <button type="button" class="btn btn-primary btn-big" data-do="approved">Approve ${kbd("A")}</button>
        <button type="button" class="btn btn-secondary btn-big" data-do="hidden">Hide ${kbd("H")}</button>
        <button type="button" class="btn btn-danger-soft btn-big" data-do="rejected">Reject ${kbd("R")}</button>
        <span class="actionbar-sep"></span>
        <button type="button" class="btn btn-ghost" data-step="-1" aria-label="Previous">${icon("back")} ${kbd("K")}</button>
        <button type="button" class="btn btn-ghost" data-step="1" aria-label="Skip">Skip ${kbd("J")}</button>
      </div>
      <p class="hint-line hide-phone">Decisions save instantly and can be undone (${kbd("Z")}). Nothing asks “are you sure?”.</p>
    </div>`
  },
  mount(el, ctx) {
    wireFlowExit(el)
    const m = state.moderation.find((x) => x.key === ctx.params.key)
    if (!m) return
    el.querySelectorAll("[data-do]").forEach((b) =>
      b.addEventListener("click", () => decide(m, /** @type {HTMLElement} */ (b).dataset.do)),
    )
    el.querySelectorAll("[data-step]").forEach((b) =>
      b.addEventListener("click", () => step(m, Number(/** @type {HTMLElement} */ (b).dataset.step))),
    )
  },
  keys(e, ctx) {
    const m = state.moderation.find((x) => x.key === ctx.params.key)
    if (!m) return false
    const k = e.key.toLowerCase()
    if (k === "a") decide(m, "approved")
    else if (k === "h") decide(m, "hidden")
    else if (k === "r") decide(m, "rejected")
    else if (k === "j" || e.key === "ArrowRight") step(m, 1)
    else if (k === "k" || e.key === "ArrowLeft") step(m, -1)
    else return false
    return true
  },
})

function step(m, d) {
  const n = d > 0 ? nextPendingAfter(m.key) : prevPendingBefore(m.key)
  // Browsing within the run is a bookmark, not a history step: replace.
  if (n) navigate(`/review/${n.key}`, { replace: true })
}
