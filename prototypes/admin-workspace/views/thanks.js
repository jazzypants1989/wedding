/** @file Thank-yous: Gifts, Cards and Replies are three sibling lists (each a
 *  list → detail split), the composer is a full-width route of its own (it
 *  needs the width for the live preview, and it's guarded), and sending a batch
 *  is a four-step flow whose steps are routes — so Back steps back through it. */

import { href, esc, actions, hooks, guard, split, mBack, kbd, toast, withSession, wide, seg } from "../ui.js"
import { store, guest, gift, drafts, unreadReplies, giftsUnthanked, ago } from "../data.js"
import { avatarSvg, photoSvg, icon } from "../art.js"

const REPLY_GLYPH = /** @type {Record<string, string>} */ ({ heart: "♥", laugh: "☺" })

/** @param {any} c */
function statusOf(c) {
  if (c.status === "draft") return ["Draft", "st-draft"]
  if (c.reply) return ["Replied", "st-replied"]
  if (c.status === "viewed") return ["Opened", "st-opened"]
  return ["Sent", "st-sent"]
}
/** @param {any} c */
const pill = (c) => `<span class="pill ${statusOf(c)[1]}">${statusOf(c)[0]}</span>`
/** @param {any} c */
const nameOf = (c) => (guest(c.guestId) || { name: "?" }).name
/** @param {any} c */
const firstName = (c) => nameOf(c).split(" ")[0]

/** @param {string} on */
function thanksSeg(on) {
  return seg(
    [
      { label: "Gifts", to: "/gifts", n: giftsUnthanked().length, on: on === "gifts" },
      { label: "Cards", to: "/cards", n: drafts().length, on: on === "cards" },
      { label: "Replies", to: "/replies", n: unreadReplies().length, on: on === "replies" },
    ],
    "Thank-yous",
  ).replace('class="seg"', 'class="seg sub-only"')
}

/** A miniature of the card the guest will see. @param {any} c @param {string} [msg] */
function cardPreview(c, msg) {
  const text = (msg !== undefined ? msg : c.message).replaceAll("{name}", firstName(c))
  return `<div class="card-preview theme-${esc(c.theme.split(" ")[0])}">
    <div class="cp-env" aria-hidden="true"></div>
    <div class="cp-paper">
      <p class="cp-text">${esc(text)}</p>
      <div class="cp-photos">${Array.from({ length: c.photos }, (_, i) => `<span class="cp-polaroid">${photoSvg(c.id * 10 + i)}</span>`).join("")}</div>
      <p class="cp-sign">— Jordana &amp; Jesse</p>
    </div>
  </div>`
}

// -------------------------------------------------------------------- gifts

/** @param {any} ctx */
function giftsView(ctx) {
  const id = ctx.params.gift ? Number(ctx.params.gift.slice(1)) : null
  if (id === null && wide()) {
    const first = giftsUnthanked()[0] || store.gifts[0]
    return { redirect: "/gifts/g" + first.id }
  }
  const g = id !== null ? gift(id) : null
  const sorted = [...giftsUnthanked(), ...store.gifts.filter((x) => !giftsUnthanked().includes(x))]
  const list = `<header class="pane-head"><h1>Thank-yous</h1>${thanksSeg("gifts")}
      <div class="pane-tools"><span class="muted small">${giftsUnthanked().length} without a card</span><a class="btn btn-sm" href="${href("/gifts/new")}">+ Log a gift</a></div></header>
    <ul class="rows">${sorted
      .map((x) => {
        const c = store.cards.find((k) => k.giftId === x.id)
        const gu = guest(x.guestId)
        return `<li><a class="row" href="${href("/gifts/g" + x.id)}" data-select ${x === g ? 'aria-current="true"' : ""}>
          <span class="avatar">${avatarSvg({ name: gu ? gu.name : "?", hue: x.id * 23 })}</span>
          <span class="row-main"><span class="row-top"><strong>${esc(gu ? gu.name : "?")}</strong>${c ? pill(c) : `<span class="pill st-none">No card</span>`}</span>
          <span class="row-sub">${esc(x.description)}</span></span></a></li>`
      })
      .join("")}</ul>`
  let detail = `<div class="detail-empty">Pick a gift.</div>`
  if (g) {
    const gu = guest(g.guestId)
    const c = store.cards.find((k) => k.giftId === g.id)
    detail = `${mBack("/gifts", "Gifts")}<article class="detail">
      <header class="person-head"><span class="avatar avatar-xl">${avatarSvg({ name: gu ? gu.name : "?", hue: g.id * 23 })}</span>
        <div><span class="eyebrow">Gift</span><h1>${esc(g.description)}</h1><p class="muted">from ${esc(gu ? gu.name : "?")} · received ${esc(g.received)}</p></div></header>
      <dl class="facts">
        <div><dt>Amount <span title="Only you can see this">🔒</span></dt><dd>${esc(g.amount || "—")}</dd></div>
        <div><dt>Paper card</dt><dd><label class="inline"><input type="checkbox" data-action="tg-physical" data-id="${g.id}" ${g.physicalCard ? "checked" : ""}> Sent by post</label></dd></div>
        <div><dt>Digital card</dt><dd>${c ? `${pill(c)} <a href="${href("/cards/c" + c.id)}">Open card</a>` : "Not written yet"}</dd></div>
      </dl>
      ${c ? "" : `<a class="btn btn-primary btn-lg" href="${href("/cards/new?gift=" + g.id)}">Write ${esc(gu ? gu.name.split(" ")[0] : "")}'s card →</a>`}
    </article>`
  }
  return split({ list, detail, selected: !!g, label: "Gifts" })
}

function giftNewDialog() {
  return `<header class="dlg-head"><h2 id="dlg-title">Log a gift</h2><button class="dlg-x" data-close aria-label="Close">×</button></header>
    <form class="form">
      <label>Guest <select data-autofocus>${store.guests.map((gu) => `<option>${esc(gu.name)}</option>`).join("")}</select></label>
      <label>What was it? <input placeholder="e.g. Honeymoon dinner fund"></label>
      <label>Amount <span class="muted small">— only you see this</span><input placeholder="optional"></label>
    </form>
    <footer class="dlg-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-close>Save gift</button></footer>`
}

actions["tg-physical"] = (el) => {
  const g = gift(Number(el.dataset.id))
  if (g) g.physicalCard = !g.physicalCard
  hooks.rerender()
}

// -------------------------------------------------------------------- cards

/** @param {URLSearchParams} q */
function cardFilter(q) {
  const s = q.get("status") || "all"
  return store.cards.filter((c) => s === "all" || statusOf(c)[0].toLowerCase() === s)
}

/** @param {any} ctx */
function cardsView(ctx) {
  const q = ctx.query
  const id = ctx.params.card ? Number(ctx.params.card.slice(1)) : null
  const items = cardFilter(q)
  if (id === null && wide() && items.length) return { redirect: "/cards/c" + items[0].id + (q.toString() ? "?" + q : "") }
  const c = id !== null ? store.cards.find((x) => x.id === id) : null
  const s = q.get("status") || "all"
  const chips = [["all", "All"], ["draft", "Drafts"], ["sent", "Sent"], ["opened", "Opened"], ["replied", "Replied"]]
    .map(([k, l]) => `<a class="chip" data-replace href="${href("/cards" + (k === "all" ? "" : "?status=" + k))}" ${s === k ? 'aria-current="true"' : ""}>${l}</a>`)
    .join("")
  const qs = q.toString() ? "?" + q : ""
  const dr = drafts().length
  const list = `<header class="pane-head"><h1>Thank-yous</h1>${thanksSeg("cards")}
      ${dr ? `<a class="cta-strip" href="${href("/cards/send")}"><span><strong>${dr} drafts ready</strong><br><span class="small">Send them together in four short steps</span></span><span class="btn btn-primary btn-sm">Send →</span></a>` : ""}
      <div class="chips" role="group" aria-label="Status">${chips}</div></header>
    <ul class="rows">${items
      .map(
        (x) => `<li><a class="row" href="${href("/cards/c" + x.id + qs)}" data-select ${x === c ? 'aria-current="true"' : ""}>
        <span class="avatar">${avatarSvg({ name: nameOf(x), hue: x.giftId * 23 })}</span>
        <span class="row-main"><span class="row-top"><strong>${esc(nameOf(x))}</strong>${pill(x)}</span>
        <span class="row-sub">${esc(x.message.replaceAll("{name}", firstName(x)))}</span></span></a></li>`,
      )
      .join("")}</ul>`
  let detail = `<div class="detail-empty">Pick a card.</div>`
  if (c) {
    const g = gift(c.giftId)
    detail = `${mBack("/cards" + qs, "Cards")}<article class="detail">
      <header class="detail-head"><span class="eyebrow">Card for ${esc(nameOf(c))} · ${esc(g ? g.description : "")}</span>${pill(c)}</header>
      ${cardPreview(c)}
      <dl class="facts">
        <div><dt>Theme</dt><dd>${esc(c.theme)}</dd></div>
        <div><dt>Sent</dt><dd>${c.via ? "by " + c.via : "Not yet"}</dd></div>
        ${c.reply ? `<div><dt>Reply</dt><dd><a href="${href("/replies/c" + c.id)}">${REPLY_GLYPH[c.reply.emoji]} “${esc(c.reply.text)}”</a></dd></div>` : ""}
      </dl>
    </article>
    <div class="actionbar">
      <a class="btn ${c.status === "draft" ? "" : "btn-primary"} btn-lg" href="${href("/cards/c" + c.id + "/edit")}">Edit ${kbd("e")}</a>
      ${c.status === "draft" ? `<a class="btn btn-primary btn-lg" href="${href("/cards/c" + c.id + "/send")}">Send ${kbd("s")}</a>` : `<button class="btn btn-lg" data-action="tc-copy">Copy link</button>`}
    </div>`
  }
  return split({ list, detail, selected: !!c, label: "Cards" })
}

/** @param {KeyboardEvent} e @param {any} ctx */
function cardKeys(e, ctx) {
  const items = cardFilter(ctx.query)
  const id = ctx.params.card ? Number(ctx.params.card.slice(1)) : null
  const c = id !== null ? store.cards.find((x) => x.id === id) : null
  const i = c ? items.indexOf(c) : -1
  const qs = ctx.query.toString() ? "?" + ctx.query : ""
  if (e.key === "j" || e.key === "k") {
    const to = e.key === "j" ? items[i + 1] || (i < 0 ? items[0] : null) : items[i - 1]
    if (to) hooks.navigate("/cards/c" + to.id + qs, { replace: !!c })
    return true
  }
  if (!c) return false
  if (e.key === "e") return hooks.navigate("/cards/c" + c.id + "/edit"), true
  if (e.key === "s" && c.status === "draft") return hooks.navigate("/cards/c" + c.id + "/send"), true
  return false
}

actions["tc-copy"] = () => toast("Card link copied")

// ----------------------------------------------------------------- composer

let dirty = false

/** @param {any} ctx */
function composerView(ctx) {
  const isNew = ctx.path === "/cards/new"
  /** @type {any} */
  let c
  if (isNew) {
    const g = gift(Number(ctx.query.get("gift")))
    if (!g) return { redirect: "/gifts" }
    c = { id: 0, giftId: g.id, guestId: g.guestId, status: "draft", message: `Dear {name}, thank you so much for the ${g.description.toLowerCase()}. `, theme: "gratitude", photos: 1, reply: null }
  } else {
    c = store.cards.find((x) => x.id === Number(ctx.params.card.slice(1)))
    if (!c) return { redirect: "/cards" }
  }
  const back = isNew ? "/gifts/g" + c.giftId : "/cards/c" + c.id
  return `<div class="composer" data-card="${c.id}" data-gift="${c.giftId}">
    <header class="composer-head">
      <a class="btn btn-ghost" href="${href(back)}" data-up>${icon("back")} ${isNew ? "Gift" : "Card"}</a>
      <h1>${isNew ? "New card" : "Edit card"} for ${esc(nameOf(c))}</h1>
      <span class="dirty-note" id="dirty-note" hidden>Unsaved changes</span>
      <button class="btn btn-primary" data-action="tc-save">Save card</button>
    </header>
    <div class="composer-body">
      <form class="form composer-form">
        <label>Message <span class="muted small">— {name} becomes “${esc(firstName(c))}”</span>
          <textarea id="tc-msg" rows="7" data-autofocus>${esc(c.message)}</textarea></label>
        <div class="form-row">
          <label>Theme <select id="tc-theme">${["gratitude", "golden hour", "garden", "confetti"].map((t) => `<option ${t === c.theme ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <label>Reveal <select><option>Confetti burst</option><option>Heart burst</option><option>None (quiet)</option></select></label>
        </div>
        <label>Photos <span class="muted small">${c.photos} of 12</span></label>
        <div class="cp-photos cp-photos-edit">${Array.from({ length: c.photos }, (_, i) => `<span class="cp-polaroid">${photoSvg(c.id * 10 + i)}</span>`).join("")}<button type="button" class="btn btn-sm">+ Choose</button></div>
        <p class="muted small">Try typing, then press the browser's Back button: you'll be asked before anything is thrown away.</p>
      </form>
      <aside class="composer-preview" aria-label="Live preview" id="tc-preview">${cardPreview(c)}</aside>
    </div>
  </div>`
}

/** @param {any} ctx */
function composerMount(ctx) {
  dirty = false
  guard.current = { path: ctx.path, dirty: () => dirty, what: "this card" }
  const ta = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("tc-msg"))
  const prev = document.getElementById("tc-preview")
  const note = document.getElementById("dirty-note")
  if (!ta || !prev) return
  ta.focus()
  ta.addEventListener("input", () => {
    dirty = true
    if (note) note.hidden = false
    const root = /** @type {HTMLElement} */ (document.querySelector(".composer"))
    const id = Number(root.dataset.card)
    const base = store.cards.find((x) => x.id === id) || { id: 0, giftId: Number(root.dataset.gift), guestId: gift(Number(root.dataset.gift))?.guestId, theme: "gratitude", photos: 1 }
    prev.innerHTML = cardPreview(base, ta.value)
  })
}

actions["tc-save"] = () => {
  const root = /** @type {HTMLElement | null} */ (document.querySelector(".composer"))
  const ta = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("tc-msg"))
  const th = /** @type {HTMLSelectElement | null} */ (document.getElementById("tc-theme"))
  if (!root || !ta || !th) return
  withSession(() => {
    const id = Number(root.dataset.card)
    let c = store.cards.find((x) => x.id === id)
    if (!c) {
      const g = gift(Number(root.dataset.gift))
      if (!g) return
      c = { id: store.nextId++, giftId: g.id, guestId: g.guestId, status: "draft", via: null, message: "", theme: "gratitude", photos: 1, reply: null }
      store.cards.push(c)
    }
    c.message = ta.value
    c.theme = th.value
    dirty = false
    guard.current = null
    toast(`Saved ${firstName(c)}'s card`)
    const next = giftsUnthanked()[0]
    if (id === 0) hooks.navigate("/cards/c" + c.id, { replace: true })
    else hooks.up("/cards/c" + c.id)
    if (next && id === 0) {
      window.setTimeout(() => toast(`Saved. Next without a card: ${(guest(next.guestId) || { name: "" }).name}`), 50)
    }
  })
}
actions["noop"] = () => {}

// ------------------------------------------------------- single send dialog

/** @param {any} ctx */
function sendOneDialog(ctx) {
  const c = store.cards.find((x) => x.id === Number(ctx.params.card.slice(1)))
  if (!c) return { redirect: "/cards" }
  const gu = guest(c.guestId)
  const ch = defaultChannel(c)
  return `<header class="dlg-head"><h2 id="dlg-title">Send ${esc(firstName(c))}'s card</h2><button class="dlg-x" data-close aria-label="Close">×</button></header>
    <fieldset class="channels"><legend>How?</legend>
      ${channelOptions(c, ch, "one")}
    </fieldset>
    <p class="muted small">${gu && gu.email ? esc(gu.email) : "No email on file"}${gu && gu.phone ? " · " + esc(gu.phone) : ""}</p>
    <footer class="dlg-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-action="tc-send-one" data-id="${c.id}" data-autofocus>Send</button></footer>`
}

/** @param {any} c */
function defaultChannel(c) {
  const gu = guest(c.guestId)
  if (gu && gu.email) return "email"
  if (gu && gu.phone) return "sms"
  return "link"
}
/** @param {any} c @param {string} ch @param {string} name */
function channelOptions(c, ch, name) {
  const gu = guest(c.guestId)
  return [
    ["email", "Email", gu && gu.email],
    ["sms", "Text message", gu && gu.phone],
    ["link", "Copy a link (send it yourself)", true],
  ]
    .map(
      ([k, l, ok]) => `<label class="radio ${ok ? "" : "is-off"}"><input type="radio" name="ch-${name}-${c.id}" value="${k}" ${k === ch ? "checked" : ""} ${ok ? "" : "disabled"} data-card="${c.id}"> ${l}</label>`,
    )
    .join("")
}

actions["tc-send-one"] = (el) => {
  const c = store.cards.find((x) => x.id === Number(el.dataset.id))
  if (!c) return
  const pick = /** @type {HTMLInputElement | null} */ (document.querySelector(`input[name="ch-one-${c.id}"]:checked`))
  withSession(() => {
    c.status = "sent"
    c.via = pick ? pick.value : "email"
    toast(`Sent ${firstName(c)}'s card`)
    hooks.up("/cards/c" + c.id)
  })
}

// --------------------------------------------------------- batch send flow

/** @param {number} on */
function flowHead(on) {
  const steps = [["Choose", "/cards/send"], ["How", "/cards/send/how"], ["Check", "/cards/send/check"], ["Sent", "/cards/send/done"]]
  return `<header class="flow-head">
    <a class="btn btn-ghost" href="${href("/cards")}">${icon("back")} Cards</a>
    <ol class="flow flow-compact" aria-label="Send cards, step by step">${steps
      .map(([l, to], i) => {
        const n = i + 1
        const state = n < on ? "is-done" : ""
        const link = n < on && on < 4
        return `<li>${link ? `<a href="${href(to)}" class="${state}">` : `<span class="${state}" ${n === on ? 'aria-current="step"' : ""}>`}
          <span class="flow-n" aria-hidden="true">${n < on ? icon("check") : n}</span><span class="flow-label">${l}</span>${link ? "</a>" : "</span>"}</li>`
      })
      .join("")}</ol></header>`
}

function flow() {
  if (!store.sendFlow || store.sendFlow.sent) {
    store.sendFlow = { ids: drafts().map((c) => c.id), channel: {}, sent: false, results: [] }
  }
  return store.sendFlow
}

function sendStep1() {
  const f = store.sendFlow && !store.sendFlow.sent ? store.sendFlow : flow()
  const all = drafts()
  if (!all.length) return `<div class="single">${flowHead(1)}<div class="done-state"><h2>No drafts to send</h2><a class="btn btn-primary" href="${href("/gifts")}">Write some cards</a></div></div>`
  return `<div class="single">${flowHead(1)}
    <header class="single-head"><h1>Which cards are going out?</h1><p class="muted">All your drafts are ticked. Untick any you want to hold back.</p></header>
    <ul class="pairs">${all
      .map(
        (c) => `<li><label class="pair"><input type="checkbox" data-action="sf-tick" data-id="${c.id}" ${f.ids.includes(c.id) ? "checked" : ""}>
        <span class="avatar">${avatarSvg({ name: nameOf(c), hue: c.giftId * 23 })}</span>
        <span><strong>${esc(nameOf(c))}</strong><br><span class="muted small">${esc(c.message.replaceAll("{name}", firstName(c)).slice(0, 70))}…</span></span>
        <a class="small" href="${href("/cards/c" + c.id + "/edit")}">Edit</a></label></li>`,
      )
      .join("")}</ul>
    <div class="actionbar"><a class="btn btn-primary btn-lg ${f.ids.length ? "" : "is-disabled"}" ${f.ids.length ? "" : `aria-disabled="true"`} href="${href("/cards/send/how")}">Next: how to send ${f.ids.length} →</a></div>
  </div>`
}

function sentAlready() {
  return `<div class="single">${flowHead(4)}<div class="done-state"><h2>That batch has gone out</h2>
    <p>Going back can't un-send it.</p><a class="btn" href="${href("/cards/send/done")}">See what was sent</a> <a class="btn btn-primary" href="${href("/cards")}">Back to cards</a></div></div>`
}

function sendStep2() {
  if (store.sendFlow && store.sendFlow.sent) return sentAlready()
  const f = flow()
  const cards = store.cards.filter((c) => f.ids.includes(c.id))
  return `<div class="single">${flowHead(2)}
    <header class="single-head"><h1>How should each one go?</h1><p class="muted">We picked the best way we have for each guest. Change any you like.</p></header>
    <ul class="send-list">${cards
      .map((c) => {
        const ch = f.channel[c.id] || defaultChannel(c)
        return `<li><span class="avatar">${avatarSvg({ name: nameOf(c), hue: c.giftId * 23 })}</span><strong>${esc(nameOf(c))}</strong>
          <span class="channels-inline" role="radiogroup" aria-label="How to send ${esc(nameOf(c))}'s card">${channelOptions(c, ch, "flow")}</span></li>`
      })
      .join("")}</ul>
    <div class="actionbar"><a class="btn btn-lg" href="${href("/cards/send")}" data-up>← Back</a><a class="btn btn-primary btn-lg" href="${href("/cards/send/check")}">Next: check →</a></div>
  </div>`
}

function sendStep3() {
  if (store.sendFlow && store.sendFlow.sent) return sentAlready()
  const f = flow()
  const cards = store.cards.filter((c) => f.ids.includes(c.id))
  /** @type {Record<string, number>} */
  const by = { email: 0, sms: 0, link: 0 }
  for (const c of cards) by[f.channel[c.id] || defaultChannel(c)]++
  return `<div class="single">${flowHead(3)}
    <header class="single-head"><h1>Ready to send ${cards.length} cards</h1>
      <p class="summary">${by.email ? `<span>${by.email} by email</span>` : ""}${by.sms ? `<span>${by.sms} by text</span>` : ""}${by.link ? `<span>${by.link} as links you'll copy</span>` : ""}</p></header>
    <div class="check-grid">${cards
      .map((c) => `<figure class="check-card">${cardPreview(c)}<figcaption><strong>${esc(nameOf(c))}</strong> · ${esc(f.channel[c.id] || defaultChannel(c))}</figcaption></figure>`)
      .join("")}</div>
    <div class="actionbar"><a class="btn btn-lg" href="${href("/cards/send/how")}" data-up>← Back</a><button class="btn btn-primary btn-lg" data-action="sf-send">Send ${cards.length} cards</button></div>
  </div>`
}

function sendStep4() {
  const f = store.sendFlow
  if (!f || !f.sent) return { redirect: "/cards/send" }
  return `<div class="single">${flowHead(4)}
    <div class="done-state"><div class="done-icon">${icon("replies")}</div><h2>${f.results.length} cards on their way</h2>
      <p>Opens and replies will show up in <a href="${href("/replies")}">Replies</a>.</p></div>
    <ul class="send-list">${f.results
      .map((/** @type {any} */ r) => {
        const c = store.cards.find((x) => x.id === r.id)
        return `<li><span class="avatar">${avatarSvg({ name: c ? nameOf(c) : "?", hue: c ? c.giftId * 23 : 0 })}</span><strong>${esc(c ? nameOf(c) : "?")}</strong>
          <span class="muted">${r.via === "link" ? "Link ready" : "Sent by " + (r.via === "sms" ? "text" : "email")}</span>
          ${r.via === "link" ? `<button class="btn btn-sm" data-action="tc-copy">Copy link</button>` : icon("check")}</li>`
      })
      .join("")}</ul>
    <div class="actionbar"><a class="btn btn-primary btn-lg" href="${href("/cards")}">Done</a></div>
  </div>`
}

actions["sf-tick"] = (el) => {
  const f = flow()
  const id = Number(el.dataset.id)
  f.ids = f.ids.includes(id) ? f.ids.filter((/** @type {number} */ x) => x !== id) : [...f.ids, id]
  hooks.rerender()
}
actions["sf-send"] = () => {
  const f = flow()
  withSession(() => {
    // read channel radios as of now
    document.querySelectorAll('input[type="radio"][name^="ch-flow-"]:checked').forEach((r) => {
      const inp = /** @type {HTMLInputElement} */ (r)
      f.channel[Number(inp.dataset.card)] = inp.value
    })
    const cards = store.cards.filter((c) => f.ids.includes(c.id))
    f.results = cards.map((c) => {
      c.status = "sent"
      c.via = f.channel[c.id] || defaultChannel(c)
      return { id: c.id, via: c.via }
    })
    f.sent = true
    // replace, not push: the confirmation takes the Check step's place, so
    // Back from "Sent" can never land on a live Send button.
    hooks.navigate("/cards/send/done", { replace: true })
  })
}
document.addEventListener("change", (e) => {
  const t = /** @type {HTMLInputElement} */ (e.target)
  if (t.type === "radio" && t.name.startsWith("ch-flow-") && store.sendFlow) {
    store.sendFlow.channel[Number(t.dataset.card)] = t.value
  }
})

// ------------------------------------------------------------------ replies

/** @param {any} ctx */
function repliesView(ctx) {
  const id = ctx.params.card ? Number(ctx.params.card.slice(1)) : null
  const withReply = store.cards.filter((c) => c.reply).sort((a, b) => a.reply.ago - b.reply.ago)
  if (id === null && wide() && withReply.length) return { redirect: "/replies/c" + withReply[0].id }
  const c = id !== null ? withReply.find((x) => x.id === id) : null
  const list = `<header class="pane-head"><h1>Thank-yous</h1>${thanksSeg("replies")}</header>
    <ul class="rows">${withReply
      .map(
        (x) => `<li><a class="row ${x.reply.seen ? "" : "is-unread"}" href="${href("/replies/c" + x.id)}" data-select ${x === c ? 'aria-current="true"' : ""}>
        <span class="avatar">${avatarSvg({ name: nameOf(x), hue: x.giftId * 23 })}</span>
        <span class="row-main"><span class="row-top"><strong>${esc(nameOf(x))}</strong><span class="row-time">${ago(x.reply.ago)}</span></span>
        <span class="row-sub">${REPLY_GLYPH[x.reply.emoji]} ${esc(x.reply.text)}</span></span></a></li>`,
      )
      .join("") || `<li class="list-empty">No replies yet.</li>`}</ul>`
  const detail = c
    ? `${mBack("/replies", "Replies")}<article class="detail"><header class="detail-head"><span class="eyebrow">${esc(nameOf(c))} replied ${ago(c.reply.ago)}</span></header>
      <p class="reply-glyph" aria-hidden="true">${REPLY_GLYPH[c.reply.emoji]}</p><blockquote class="msg-big">${esc(c.reply.text)}</blockquote>
      <p><a href="${href("/cards/c" + c.id)}">See the card you sent →</a></p></article>`
    : `<div class="detail-empty">Pick a reply.</div>`
  return split({ list, detail, selected: !!c, label: "Replies" })
}

/** @param {any} ctx */
function markSeen(ctx) {
  const id = ctx.params.card ? Number(ctx.params.card.slice(1)) : null
  const c = id !== null ? store.cards.find((x) => x.id === id) : null
  if (c && c.reply && !c.reply.seen) {
    c.reply.seen = true
    window.setTimeout(() => hooks.rerender(), 600)
  }
}

// ------------------------------------------------------------------- routes

const tb = { label: "Thank-yous" }

/** @type {any[]} */
export const thanksRoutes = [
  { pattern: "/gifts", section: "gifts", sel: "gift", title: () => "Gifts", crumbs: () => [tb, { label: "Gifts" }], render: giftsView },
  { pattern: "/gifts/new", section: "gifts", title: () => "Log a gift", parent: () => "/gifts", render: giftNewDialog },
  {
    pattern: "/gifts/:gift", section: "gifts", sel: "gift",
    title: (/** @type {any} */ c) => gift(Number(c.params.gift.slice(1)))?.description || "Gift",
    crumbs: (/** @type {any} */ c) => [tb, { label: "Gifts", to: "/gifts" }, { label: gift(Number(c.params.gift.slice(1)))?.description || "?" }],
    render: giftsView,
  },
  { pattern: "/cards", section: "cards", sel: "card", title: () => "Cards", crumbs: () => [tb, { label: "Cards" }], render: cardsView, keys: cardKeys },
  { pattern: "/cards/new", section: "cards", title: () => "New card", crumbs: () => [tb, { label: "Gifts", to: "/gifts" }, { label: "New card" }], render: composerView, mount: composerMount },
  { pattern: "/cards/send", section: "cards", title: () => "Send cards · Choose", crumbs: () => [tb, { label: "Cards", to: "/cards" }, { label: "Send · 1 Choose" }], render: sendStep1 },
  { pattern: "/cards/send/how", section: "cards", title: () => "Send cards · How", crumbs: () => [tb, { label: "Cards", to: "/cards" }, { label: "Send · 2 How" }], render: sendStep2 },
  { pattern: "/cards/send/check", section: "cards", title: () => "Send cards · Check", crumbs: () => [tb, { label: "Cards", to: "/cards" }, { label: "Send · 3 Check" }], render: sendStep3 },
  { pattern: "/cards/send/done", section: "cards", title: () => "Cards sent", crumbs: () => [tb, { label: "Cards", to: "/cards" }, { label: "Sent" }], render: sendStep4 },
  {
    pattern: "/cards/:card", section: "cards", sel: "card",
    title: (/** @type {any} */ c) => "Card for " + nameOf(store.cards.find((x) => x.id === Number(c.params.card.slice(1))) || { guestId: 0 }),
    crumbs: (/** @type {any} */ c) => [tb, { label: "Cards", to: "/cards" }, { label: nameOf(store.cards.find((x) => x.id === Number(c.params.card.slice(1))) || { guestId: 0 }) }],
    render: cardsView, keys: cardKeys,
  },
  {
    pattern: "/cards/:card/edit", section: "cards",
    title: () => "Edit card",
    crumbs: (/** @type {any} */ c) => {
      const card = store.cards.find((x) => x.id === Number(c.params.card.slice(1)))
      return [tb, { label: "Cards", to: "/cards" }, { label: card ? nameOf(card) : "?", to: "/cards/" + c.params.card }, { label: "Edit" }]
    },
    render: composerView, mount: composerMount,
  },
  { pattern: "/cards/:card/send", section: "cards", title: () => "Send card", parent: (/** @type {any} */ c) => "/cards/" + c.params.card, render: sendOneDialog },
  { pattern: "/replies", section: "replies", sel: "card", title: () => "Replies", crumbs: () => [tb, { label: "Replies" }], render: repliesView },
  {
    pattern: "/replies/:card", section: "replies", sel: "card", title: () => "Reply",
    crumbs: (/** @type {any} */ c) => [tb, { label: "Replies", to: "/replies" }, { label: nameOf(store.cards.find((x) => x.id === Number(c.params.card.slice(1))) || { guestId: 0 }) }],
    render: repliesView, mount: markSeen,
  },
]
