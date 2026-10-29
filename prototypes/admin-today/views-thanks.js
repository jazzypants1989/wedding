/** @file Thank-yous: home (progress + next up), gifts, mailbox, the composer
 *  (with an unsaved-changes guard), and the batch send flow (IA.md §4.3). */

import {
  state,
  save,
  logDone,
  draftCards,
  unreadReplies,
  thanksProgress,
  guestById,
  giftById,
  cardById,
} from "./data.js"
import { route, navigate, setQuery, href, returnTo, setGuard, unwindTo, currentIdx } from "./router.js"
import { avatar } from "./art.js"
import { esc, icon, toast, ring, flowBar, wireFlowExit, act, kbd, rerender, plural } from "./ui.js"

const THEMES = {
  Garden: ["#f4efe6", "#5c7a4a"],
  Classic: ["#fbf7f2", "#8a3b2a"],
  Champagne: ["#f7efdc", "#a07a2c"],
  Fiesta: ["#fde9e1", "#c1330d"],
}

const TEMPLATES = [
  ["Warm & general", "Dear {name},\n\nThank you so much for celebrating with us and for your generosity. It meant the world to share our day with you.\n\nWith love,\nJordana & Jesse"],
  ["Registry gift", "Dear {name},\n\nThank you for the {gift}! It already has a place in our home, and we think of you every time we use it.\n\nWith love,\nJordana & Jesse"],
  ["Honeymoon fund", "Dear {name},\n\nThank you for helping send us on our honeymoon. We raised a glass to you more than once.\n\nWith love,\nJordana & Jesse"],
]

function subnav(active) {
  const unread = unreadReplies().length
  const items = [
    ["cards", "/thanks", "Cards"],
    ["gifts", "/thanks/gifts", "Gifts"],
    ["mailbox", "/thanks/mailbox", `Mailbox ${unread ? `<span class="count heart">♥ ${unread}</span>` : ""}`],
  ]
  return `<nav class="subnav" aria-label="Thank-yous">${items
    .map(([k, to, label]) => `<a href="${href(to)}" class="${k === active ? "is-on" : ""}" ${k === active ? 'aria-current="page"' : ""}>${label}</a>`)
    .join("")}</nav>`
}

function fill(text, guestName, giftDesc) {
  return text.replaceAll("{name}", guestName.split(" ")[0]).replaceAll("{gift}", giftDesc ? giftDesc.toLowerCase() : "gift")
}

// ---- home ---------------------------------------------------------------------

route("/thanks", {
  nav: "cards",
  title: () => "Thank-you cards",
  render(ctx) {
    const tp = thanksProgress()
    const drafts = draftCards()
    const next = tp.remaining[0]
    const status = ctx.query.get("status") || ""
    const cards = state.cards.filter((c) => !status || c.status === status)
    const chip = (v, label) => `<button type="button" class="chip ${status === v ? "is-on" : ""}" data-v="${v}" aria-pressed="${status === v}">${label}</button>`
    return `<div class="page">
      <header class="page-head row"><div><p class="eyebrow">Thank-yous</p><h1>Thank-you cards</h1></div>
        <div class="faces-ring">${ring(tp.thanked, tp.owed, 84)}<span class="muted">${tp.thanked} of ${tp.owed}<br>guests thanked</span></div></header>
      ${subnav("cards")}
      <div class="next-up">
        ${next ? `<div class="nu"><p class="eyebrow">Next to thank</p><h3>${esc(guestById(next.guestId)?.name)}</h3><p class="muted">${esc(next.desc)} · ${tp.remaining.length - 1} more after</p><a class="btn btn-primary" href="${href(`/thanks/cards/new?guest=${next.guestId}`)}">Write their card ${icon("next", 16)}</a></div>` : `<div class="nu"><h3>Everyone with a gift has a card.</h3></div>`}
        ${drafts.length ? `<div class="nu"><p class="eyebrow">Ready to send</p><h3>${plural(drafts.length, "finished card")}</h3><p class="muted">${esc(drafts.map((c) => guestById(c.guestId)?.name.split(" ")[0]).join(", "))}</p><a class="btn btn-primary" href="${href("/thanks/send")}">Send them ${icon("next", 16)}</a></div>` : ""}
      </div>
      <div class="chips" role="group" aria-label="Filter cards">${chip("", "All")}${chip("draft", "Drafts")}${chip("sent", "Sent, unopened")}${chip("viewed", "Opened")}</div>
      <ul class="rows">${cards
        .map((c) => {
          const g = guestById(c.guestId)
          const st = c.status === "draft" ? '<span class="pill warn">Draft</span>' : c.status === "sent" ? '<span class="pill">Sent</span>' : '<span class="pill ok">Opened</span>'
          return `<li><a class="row-link" href="${href(`/thanks/cards/${c.id}`)}">${avatar(g?.name || "?", 40)}<span class="row-main"><strong>${esc(g?.name)}</strong> ${st}<span class="row-text muted">${esc(fill(c.message, g?.name || "", "").slice(0, 80))}</span></span>${c.reply ? `<span class="reply-emoji" title="Replied">${c.reply.emoji}</span>` : ""}<span class="row-go">${icon("next")}</span></a></li>`
        })
        .join("")}</ul>
    </div>`
  },
  mount(el) {
    el.querySelectorAll(".chip[data-v]").forEach((c) =>
      c.addEventListener("click", () => {
        setQuery({ status: /** @type {HTMLElement} */ (c).dataset.v || null })
        rerender()
      }),
    )
  },
})

route("/thanks/gifts", {
  nav: "gifts",
  title: () => "Gifts",
  render() {
    return `<div class="page"><header class="page-head row"><div><p class="eyebrow">Thank-yous</p><h1>Gifts</h1>
      <p class="lede">Who gave what. Amounts are for you only — never on a card.</p></div>
      <a class="btn btn-primary" href="${href("/thanks/gifts/new")}">Add a gift</a></header>
      ${subnav("gifts")}
      <table class="table"><thead><tr><th>Guest</th><th>Gift</th><th class="hide-phone">Received</th><th>Card</th></tr></thead><tbody>
      ${state.gifts
        .map((g) => {
          const c = state.cards.find((x) => x.guestId === g.guestId)
          return `<tr><td>${esc(guestById(g.guestId)?.name)}</td><td>${esc(g.desc)}${g.amount ? ` <span class="muted">🔒 $${g.amount}</span>` : ""}</td><td class="hide-phone">${g.received}</td>
          <td>${c ? `<a href="${href(`/thanks/cards/${c.id}`)}">${c.status === "draft" ? "Draft" : "Sent"}</a>` : `<a href="${href(`/thanks/cards/new?guest=${g.guestId}`)}">Write</a>`}</td></tr>`
        })
        .join("")}</tbody></table></div>`
  },
})

route("/thanks/gifts/new", {
  nav: "gifts",
  dialog: true,
  parent: () => "/thanks/gifts",
  title: () => "Add a gift",
  render() {
    return `<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dlg-h">
      <header class="dialog-head"><h2 id="dlg-h">Add a gift</h2><button type="button" class="dialog-close" aria-label="Close (Esc)">${icon("close")}</button></header>
      <form class="stack gift-form">
        <label>From <select name="guest">${state.guests.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select></label>
        <label>What <input name="desc" placeholder="e.g. Ceramic serving bowls" required /></label>
        <label>Amount <span class="muted">(optional, only you see it)</span><input name="amount" inputmode="decimal" /></label>
        <div class="dialog-actions"><button type="button" class="btn btn-secondary dialog-cancel">Cancel</button><button class="btn btn-primary" type="submit">Add gift</button></div>
      </form></div>`
  },
  mount(el) {
    el.querySelector(".gift-form")?.addEventListener("submit", (e) => {
      e.preventDefault()
      const f = new FormData(/** @type {HTMLFormElement} */ (e.target))
      act(() => {
        state.gifts.push({ id: `gf${state.gifts.length + 1}`, guestId: String(f.get("guest")), desc: String(f.get("desc")), amount: Number(f.get("amount")) || 0, received: "2026-10-29" })
        save()
        toast("Gift added — they're on your thank-you list now.")
        returnTo("/thanks/gifts")
      })
    })
  },
})

// ---- mailbox ------------------------------------------------------------------

route("/thanks/mailbox", {
  nav: "mailbox",
  title: () => "Mailbox",
  render() {
    const replies = state.cards.filter((c) => c.reply)
    return `<div class="page"><header class="page-head"><p class="eyebrow">Thank-yous</p><h1>Mailbox 💌</h1>
      <p class="lede">Every reply to your cards, newest first.</p></header>
      ${subnav("mailbox")}
      <ul class="mail">${replies
        .map((c) => {
          const g = guestById(c.guestId)
          return `<li class="${c.reply.unread ? "is-unread" : ""}">${avatar(g?.name || "?", 44)}<div><p><strong>${esc(g?.name)}</strong> <span class="muted">· ${c.reply.ago} ago</span> ${c.reply.unread ? '<span class="pill warn">new</span>' : ""}</p>
          <p class="mail-body"><span class="mail-emoji">${c.reply.emoji}</span> ${esc(c.reply.text)}</p></div></li>`
        })
        .join("")}</ul>
      <label class="muted small"><input type="checkbox" checked /> Email me the moment a card gets its first reply</label></div>`
  },
  mount() {
    // Opening the mailbox reads it — the badge and the Today task clear.
    const unread = unreadReplies()
    if (unread.length) {
      setTimeout(() => {
        for (const c of unread) c.reply.unread = false
        save()
        logDone("cards", `Read ${plural(unread.length, "card reply", "card replies")}`)
        document.dispatchEvent(new Event("badges"))
      }, 1200)
    }
  },
})

// ---- composer -------------------------------------------------------------------

function composer(ctx, card, guestId) {
  const g = guestById(guestId)
  const gift = card ? giftById(card.giftId) : state.gifts.find((x) => x.guestId === guestId)
  const tplIdx = gift && gift.desc.includes("Honeymoon") ? 2 : gift ? 1 : 0
  const msg = card ? card.message : fill(TEMPLATES[tplIdx][1], "{name}", gift?.desc)
  const theme = card ? card.theme : "Garden"
  const isNew = !card
  return `<div class="page composer-page">
    <nav class="crumbs"><a href="${href("/thanks")}">Thank-you cards</a> / ${isNew ? "New card" : "Edit card"}</nav>
    <header class="page-head row"><div><h1>${isNew ? "A card for" : "Card for"} ${esc(g?.name)}</h1>
      <p class="muted">${gift ? `For: ${esc(gift.desc)}` : "No gift logged"} ${card && card.status !== "draft" ? ` · <span class="pill ok">${card.status === "viewed" ? "Opened" : "Sent"}</span>` : ""}</p></div>
      <div class="row-gap"><span class="dirty-note muted" hidden>Unsaved changes</span><button type="button" class="btn btn-primary save-card">Save ${kbd("⌘S")}</button></div></header>
    <div class="composer">
      <form class="stack comp-form">
        <label>Start from <select class="tpl">${TEMPLATES.map(([n], i) => `<option value="${i}" ${i === tplIdx && !card ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Message <span class="muted small">{name} becomes “${esc(g?.name.split(" ")[0])}”</span>
          <textarea class="msg" rows="9">${esc(msg)}</textarea></label>
        <label>Look <select class="theme">${Object.keys(THEMES).map((t) => `<option ${t === theme ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <p class="muted small">Effects, reveal and photos live here too in the real composer.</p>
      </form>
      <div class="card-preview" aria-label="Preview"></div>
    </div>
    <div class="after-save" hidden></div>
  </div>`
}

function mountComposer(el, ctx, card, guestId) {
  const g = guestById(guestId)
  const msg = /** @type {HTMLTextAreaElement} */ (el.querySelector(".msg"))
  const theme = /** @type {HTMLSelectElement} */ (el.querySelector(".theme"))
  const tpl = /** @type {HTMLSelectElement} */ (el.querySelector(".tpl"))
  const preview = /** @type {HTMLElement} */ (el.querySelector(".card-preview"))
  const note = /** @type {HTMLElement} */ (el.querySelector(".dirty-note"))
  const initial = msg.value + "|" + theme.value
  const isDirty = () => msg.value + "|" + theme.value !== initial && !saved
  let saved = false
  const paint = () => {
    const [bg, ink] = THEMES[/** @type {keyof typeof THEMES} */ (theme.value)]
    preview.style.setProperty("--card-bg", bg)
    preview.style.setProperty("--card-ink", ink)
    preview.innerHTML = `<div class="cp-env"><div class="cp-card"><p class="cp-msg">${esc(fill(msg.value, g?.name || "", "")).replaceAll("\n", "<br>")}</p></div></div><p class="muted small cp-cap">Live preview · ${theme.value}</p>`
    note.hidden = !isDirty()
  }
  paint()
  msg.addEventListener("input", paint)
  theme.addEventListener("change", paint)
  tpl.addEventListener("change", () => {
    const gift = state.gifts.find((x) => x.guestId === guestId)
    msg.value = fill(TEMPLATES[Number(tpl.value)][1], "{name}", gift?.desc)
    paint()
  })
  // The guard: any navigation away — link, nav, palette, Back — asks first.
  setGuard({ message: `Your card for ${g?.name.split(" ")[0]} has unsaved changes.`, isDirty, save: () => doSave() })

  const doSave = () => {
    act(() => {
      saved = true
      let c = card
      if (!c) {
        const gift = state.gifts.find((x) => x.guestId === guestId)
        c = { id: `c${state.nextCardId++}`, guestId, giftId: gift?.id || null, status: "draft", message: msg.value, theme: theme.value, sentVia: null, reply: null }
        state.cards.push(c)
      } else {
        c.message = msg.value
        c.theme = theme.value
      }
      save()
      setGuard(null)
      logDone("cards", `Wrote a card for ${esc(g?.name)}`)
      // The card now has an id: the URL becomes its real address (replace —
      // "/new" was never a place you'd want Back to return to).
      if (!card) navigate(`/thanks/cards/${c.id}?saved=1`, { replace: true })
      else {
        toast("Saved.")
        paint()
      }
    })
  }
  el.querySelector(".save-card")?.addEventListener("click", doSave)
  el.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault()
      doSave()
    }
  })

  if (ctx.query.get("saved")) {
    setQuery({ saved: null })
    const tp = thanksProgress()
    const next = tp.remaining[0]
    const box = /** @type {HTMLElement} */ (el.querySelector(".after-save"))
    box.hidden = false
    box.innerHTML = `<div class="after-save-card">${icon("check", 22)}<div><strong>Saved as a draft.</strong> <span class="muted">It'll go out with your next batch.</span></div>
      <div class="row-gap">${next ? `<a class="btn btn-primary" href="${href(`/thanks/cards/new?guest=${next.guestId}`)}" data-replace="true">Next: ${esc(guestById(next.guestId)?.name)} ${icon("next", 16)}</a>` : ""}
      <a class="btn btn-secondary" href="${href(`/thanks/send?cards=${card ? card.id : ctx.params.cid}`)}">Send just this one</a>
      <button type="button" class="btn btn-ghost back-today">Back to Today</button></div></div>`
    box.querySelector(".back-today")?.addEventListener("click", () => returnTo("/"))
  }
}

route("/thanks/cards/new", {
  nav: "cards",
  title: () => "New card",
  render: (ctx) => composer(ctx, null, ctx.query.get("guest") || "g11"),
  mount: (el, ctx) => mountComposer(el, ctx, null, ctx.query.get("guest") || "g11"),
})

route("/thanks/cards/:cid", {
  nav: "cards",
  title: (ctx) => `Card for ${guestById(cardById(ctx.params.cid)?.guestId || "")?.name || "?"}`,
  render(ctx) {
    const c = cardById(ctx.params.cid)
    if (!c) return `<div class="page"><div class="empty">No such card. <a href="${href("/thanks")}">All cards</a></div></div>`
    return composer(ctx, c, c.guestId)
  },
  mount(el, ctx) {
    const c = cardById(ctx.params.cid)
    if (c) mountComposer(el, ctx, c, c.guestId)
  },
})

// ---- batch send -------------------------------------------------------------------

function channelFor(g, choice) {
  if (choice === "copy") return "copy"
  if (choice === "email") return g.email ? "email" : "copy"
  if (g.email) return "email"
  if (g.phone) return "sms"
  return "copy"
}
const CH = { email: "Email", sms: "Text", copy: "Copy link yourself" }

function steps(active) {
  const s = [
    ["/thanks/send", "Choose"],
    ["/thanks/send/how", "How"],
    ["/thanks/send/check", "Check & send"],
  ]
  return `<ol class="steps">${s
    .map(([to, label], i) => {
      const n = i + 1
      const cls = n < active ? "is-done" : n === active ? "is-on" : ""
      return `<li class="${cls}">${n < active ? `<button type="button" class="linkish step-link" data-to="${to}">${icon("check", 14)} ${label}</button>` : `<span>${n}. ${label}</span>`}</li>`
    })
    .join("")}</ol>`
}

function batch(ctx) {
  // A spent batch (already sent) never comes back to life via Back/Forward.
  if (!state.sendBatch || state.sendBatch.sent) {
    const only = ctx && ctx.query.get("cards")
    state.sendBatch = { ids: only ? only.split(",") : draftCards().map((c) => c.id), channel: "best", note: "", sent: false, results: [], startIdx: currentIdx() }
    save()
  }
  return state.sendBatch
}

function wireSteps(el) {
  wireFlowExit(el)
  el.querySelectorAll(".step-link").forEach((b) => b.addEventListener("click", () => returnTo(/** @type {HTMLElement} */ (b).dataset.to || "/thanks/send")))
}

route("/thanks/send", {
  nav: "cards",
  flow: true,
  title: () => "Send cards",
  render(ctx) {
    if (state.sendBatch && state.sendBatch.sent && !ctx.query.get("cards")) return spent()
    const b = batch(ctx)
    b.startIdx = currentIdx()
    save()
    const drafts = draftCards()
    return `<div class="page flow-page">${flowBar({ label: "Send cards", exitTo: "/thanks" })}${steps(1)}
      <h1>Which cards are going out?</h1>
      <p class="lede">All finished drafts are ticked. Untick any you want to look at again first.</p>
      <ul class="pick">${drafts
        .map((c) => {
          const g = guestById(c.guestId)
          return `<li><label><input type="checkbox" value="${c.id}" ${b.ids.includes(c.id) ? "checked" : ""}/> ${avatar(g?.name || "?", 36)}
          <span class="row-main"><strong>${esc(g?.name)}</strong><span class="row-text muted">${esc(fill(c.message, g?.name || "", "").slice(0, 70))}…</span></span></label>
          <a class="muted small" href="${href(`/thanks/cards/${c.id}`)}">Open</a></li>`
        })
        .join("")}</ul>
      <div class="actionbar"><span class="muted sel-count">${b.ids.length} selected</span><span class="actionbar-sep"></span>
        <button type="button" class="btn btn-primary btn-big go-next" ${b.ids.length ? "" : "disabled"}>Next: how to send ${icon("next", 16)}</button></div></div>`
  },
  mount(el, ctx) {
    wireSteps(el)
    const b = state.sendBatch
    if (!b || b.sent) return
    el.querySelectorAll('.pick input[type="checkbox"]').forEach((cb) =>
      cb.addEventListener("change", () => {
        b.ids = [...el.querySelectorAll('.pick input[type="checkbox"]:checked')].map((x) => /** @type {HTMLInputElement} */ (x).value)
        save()
        const n = el.querySelector(".sel-count")
        if (n) n.textContent = `${b.ids.length} selected`
        /** @type {HTMLButtonElement} */ (el.querySelector(".go-next")).disabled = !b.ids.length
      }),
    )
    el.querySelector(".go-next")?.addEventListener("click", () => navigate("/thanks/send/how"))
  },
  keys(e) {
    if (e.key === "Enter") {
      /** @type {HTMLButtonElement | null} */ (document.querySelector(".go-next"))?.click()
      return true
    }
    return false
  },
})

function spent() {
  return `<div class="page flow-page">${flowBar({ label: "Send cards", exitTo: "/thanks" })}<div class="notice big"><p>That batch has already gone out — nothing will be sent twice.</p><p><a href="${href("/thanks/send/done")}" data-replace="true">See what was sent</a> · <a href="${href("/thanks")}">All cards</a></p></div></div>`
}

route("/thanks/send/how", {
  nav: "cards",
  flow: true,
  title: () => "Send cards · how",
  render() {
    const b = state.sendBatch
    if (!b) return `<div class="page"><div class="empty"><a href="${href("/thanks/send")}">Start a batch</a></div></div>`
    if (b.sent) return spent()
    const opt = (v, label, sub) => `<label class="choice ${b.channel === v ? "is-on" : ""}"><input type="radio" name="ch" value="${v}" ${b.channel === v ? "checked" : ""}/><span><strong>${label}</strong><span class="muted">${sub}</span></span></label>`
    return `<div class="page flow-page">${flowBar({ label: "Send cards", exitTo: "/thanks" })}${steps(2)}
      <h1>How should they go?</h1>
      <div class="choices">${opt("best", "The best way for each guest", "Email if we have it, otherwise a text, otherwise a link for you to copy.")}${opt("email", "Email only", "Guests without an email get a link to copy.")}${opt("copy", "I'll send the links myself", "You get a list of links to paste anywhere.")}</div>
      <table class="table"><thead><tr><th>Guest</th><th>Goes by</th></tr></thead><tbody>${b.ids
        .map((id) => {
          const g = guestById(cardById(id)?.guestId || "")
          return `<tr><td>${esc(g?.name)}</td><td>${CH[/** @type {keyof typeof CH} */ (channelFor(g, b.channel))]}</td></tr>`
        })
        .join("")}</tbody></table>
      <div class="actionbar"><button type="button" class="btn btn-ghost go-back">${icon("back", 16)} Back</button><span class="actionbar-sep"></span><button type="button" class="btn btn-primary btn-big go-next">Next: check ${icon("next", 16)}</button></div></div>`
  },
  mount(el) {
    wireSteps(el)
    const b = state.sendBatch
    if (!b || b.sent) return
    el.querySelectorAll('input[name="ch"]').forEach((r) =>
      r.addEventListener("change", () => {
        b.channel = /** @type {HTMLInputElement} */ (r).value
        save()
        rerender()
      }),
    )
    el.querySelector(".go-back")?.addEventListener("click", () => returnTo("/thanks/send"))
    el.querySelector(".go-next")?.addEventListener("click", () => navigate("/thanks/send/check"))
  },
  keys(e) {
    if (e.key === "Enter") {
      navigate("/thanks/send/check")
      return true
    }
    return false
  },
})

route("/thanks/send/check", {
  nav: "cards",
  flow: true,
  title: () => "Send cards · check",
  render() {
    const b = state.sendBatch
    if (!b) return `<div class="page"><div class="empty"><a href="${href("/thanks/send")}">Start a batch</a></div></div>`
    if (b.sent) return spent()
    const counts = { email: 0, sms: 0, copy: 0 }
    for (const id of b.ids) counts[/** @type {keyof typeof counts} */ (channelFor(guestById(cardById(id)?.guestId || ""), b.channel))]++
    const first = guestById(cardById(b.ids[0])?.guestId || "")
    return `<div class="page flow-page">${flowBar({ label: "Send cards", exitTo: "/thanks" })}${steps(3)}
      <h1>Ready to send ${plural(b.ids.length, "card")}</h1>
      <p class="lede">${[counts.email && `${counts.email} by email`, counts.sms && `${counts.sms} by text`, counts.copy && `${counts.copy} for you to copy`].filter(Boolean).join(" · ")}</p>
      <div class="email-preview"><p class="muted small">What ${esc(first?.name.split(" ")[0])} will get (the card itself opens from the link):</p>
        <div class="ep"><p><strong>Subject:</strong> A little something from Jordana &amp; Jesse</p><p>Hi ${esc(first?.name.split(" ")[0])} — we made you something. Open it here: <u>jordanaandjesse.com/thanks?card=…</u></p></div>
        <label class="stack small">Add a personal line to the email <span class="muted">(optional)</span><input class="note" value="${esc(b.note)}" placeholder="Leave blank for the default"/></label></div>
      <div class="actionbar"><button type="button" class="btn btn-ghost go-back">${icon("back", 16)} Back</button><span class="actionbar-sep"></span><button type="button" class="btn btn-primary btn-big do-send">Send ${plural(b.ids.length, "card")}</button></div>
      <div class="sending" hidden></div></div>`
  },
  mount(el) {
    wireSteps(el)
    const b = state.sendBatch
    if (!b || b.sent) return
    el.querySelector(".note")?.addEventListener("input", (e) => {
      b.note = /** @type {HTMLInputElement} */ (e.target).value
      save()
    })
    el.querySelector(".go-back")?.addEventListener("click", () => returnTo("/thanks/send/how"))
    el.querySelector(".do-send")?.addEventListener("click", () => send(el, b))
  },
})

function send(el, b) {
  act(() => {
    const box = /** @type {HTMLElement} */ (el.querySelector(".sending"))
    const btn = /** @type {HTMLButtonElement} */ (el.querySelector(".do-send"))
    btn.disabled = true
    box.hidden = false
    let i = 0
    const tick = () => {
      box.innerHTML = `<p>Sending ${Math.min(i + 1, b.ids.length)} of ${b.ids.length}…</p>`
      if (i < b.ids.length) {
        const c = cardById(b.ids[i])
        if (c) {
          const ch = channelFor(guestById(c.guestId), b.channel)
          c.status = "sent"
          c.sentVia = ch
          b.results.push({ id: c.id, ch })
        }
        i++
        setTimeout(tick, 280)
        return
      }
      b.sent = true
      save()
      logDone("cards", `Sent ${plural(b.ids.length, "thank-you card")}`)
      // Collapse the three steps into one entry: the outcome.
      unwindTo(b.startIdx, "/thanks/send/done", "/thanks/send")
    }
    tick()
  })
}

route("/thanks/send/done", {
  nav: "cards",
  flow: true,
  title: () => "Cards sent",
  render() {
    const b = state.sendBatch
    if (!b || !b.sent) return `<div class="page"><div class="empty">Nothing sent yet. <a href="${href("/thanks/send")}">Send cards</a></div></div>`
    const tp = thanksProgress()
    const copies = b.results.filter((r) => r.ch === "copy")
    return `<div class="page flow-page">${flowBar({ label: "Send cards", exitTo: "/thanks" })}
      <div class="celebrate"><div class="all-clear-mark">${icon("check", 44)}</div>
      <h1>${plural(b.results.length, "card")} on the way.</h1>
      <p class="faces-ring">${ring(tp.thanked, tp.owed, 84)}</p>
      <p class="lede">${tp.thanked} of ${tp.owed} guests thanked. You'll see replies in the Mailbox.</p></div>
      ${copies.length ? `<div class="notice"><strong>${plural(copies.length, "link")} to send yourself:</strong><ul class="rows">${copies.map((r) => `<li class="row-static"><span class="row-main">${esc(guestById(cardById(r.id)?.guestId || "")?.name)}</span><button type="button" class="btn btn-secondary btn-sm copy">Copy link</button></li>`).join("")}</ul></div>` : ""}
      <ul class="rows">${b.results.map((r) => `<li class="row-static">${icon("check", 16)}<span class="row-main">${esc(guestById(cardById(r.id)?.guestId || "")?.name)}</span><span class="muted">${CH[/** @type {keyof typeof CH} */ (r.ch)]}</span></li>`).join("")}</ul>
      <div class="celebrate-actions"><button type="button" class="btn btn-primary back-today">Back to Today</button><a class="btn btn-secondary" href="${href("/thanks")}">All cards</a></div></div>`
  },
  mount(el) {
    wireFlowExit(el)
    el.querySelector(".back-today")?.addEventListener("click", () => returnTo("/"))
    el.querySelectorAll(".copy").forEach((b) => b.addEventListener("click", () => toast("Link copied.")))
  },
})
