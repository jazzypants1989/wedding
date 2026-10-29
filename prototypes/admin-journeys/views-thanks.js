/** @file "Thank everyone" — gifts → write → send (batch) → replies. */

import { html, raw, plural } from "./html.js"
import { db, save, guestById, cardFor, unwritten, drafts, sentCards, unreadReplies, photosOfGuest } from "./data.js"
import { sceneSvg, monogram } from "./art.js"
import { L, toast, withSession, withStepNav } from "./shell.js"

/** @typedef {import("./shell.js").Screen} Screen
 *  @typedef {{ nav: (to: string, o?: { replace?: boolean }) => void, up: (to: string) => void, refresh: () => void,
 *    closeDialog: () => void, setGuard: (g: import("./router.js").Guard | null) => void }} Ctx */

const EMOJI = /** @type {Record<string, string>} */ ({ heart: "❤️", laugh: "😂", tear: "🥲", party: "🎉" })

/** @param {any} card */
function statusOf(card) {
  if (!card) return { label: "Not written", cls: "todo" }
  if (card.reply) return { label: "Replied", cls: "replied" }
  if (card.status === "viewed") return { label: "Opened", cls: "sent" }
  if (card.status === "sent") return { label: "Sent", cls: "sent" }
  return { label: "Draft", cls: "draft" }
}

/** @param {any} gift @param {number} n */
function seed(gift, n) {
  const g = guestById(gift.guestId)
  const first = g.name.split(" ")[0] === "The" ? g.name : g.name.split(" ")[0]
  const lines = [
    `Dear ${first}, thank you so much for ${gift.what}. It meant the world to have you there with us, and every time we use it we'll think of you.`,
    `${first} — we're still smiling about the day, and ${gift.what} made it even better. Thank you for celebrating with us.`,
    `Dear ${first}, how lucky are we? Thank you for ${gift.what}, and for dancing with us until the very end.`,
  ]
  return lines[n % lines.length]
}

// ---------------- Step 1: gifts ----------------

/** @returns {Screen} */
export function giftsScreen() {
  const body = html`<div class="toolbar"><a class="btn primary" href="${L("/thanks/gifts/new")}">+ Log a gift</a>
      <span class="fine">Export to a spreadsheet from the Everything page.</span></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th scope="col">From</th><th scope="col">Gift</th><th scope="col" class="hide-sm">Received</th><th scope="col">Card</th></tr></thead>
      <tbody>${db.gifts.map((/** @type {any} */ gift) => {
        const g = guestById(gift.guestId)
        const st = statusOf(cardFor(gift.guestId))
        return html`<tr><td>${raw(monogram(g.name, (g.id * 37) % 360))} ${g.name}</td><td>${gift.what}</td>
          <td class="hide-sm">${gift.at}</td><td><span class="pill ${st.cls}">${st.label}</span></td></tr>`
      })}</tbody></table></div>`
  return withStepNav(
    { journey: "thanks", step: "gifts", title: "Log the gifts", body, status: `${plural(db.gifts.length, "gift")} logged` },
    db.gifts.length > 0,
  )
}

/** @param {Ctx} ctx @returns {Screen} */
export function giftDialog(ctx) {
  const s = giftsScreen()
  const without = db.guests.filter((/** @type {any} */ g) => !db.gifts.some((/** @type {any} */ x) => x.guestId === g.id))
  s.dialog = {
    title: "Log a gift",
    body: html`<div class="form">
      <label for="gf-guest">From</label>
      <select id="gf-guest">${without.map((/** @type {any} */ g) => html`<option value="${g.id}">${g.name}</option>`)}</select>
      <label for="gf-what">What was it?</label>
      <input id="gf-what" placeholder="e.g. the salad bowls" autocomplete="off">
      <p class="fine">Write it how you'd say it in a sentence — "thank you for <em>the salad bowls</em>".</p>
      <div class="dlg-foot"><button type="button" class="btn secondary" data-act="dlg-close">Cancel</button>
        <button type="button" class="btn primary" data-act="gf-save">Save gift</button></div></div>`,
    acts: {
      "gf-save": () => {
        const gid = Number(/** @type {HTMLSelectElement} */ (document.getElementById("gf-guest")).value)
        const what = /** @type {HTMLInputElement} */ (document.getElementById("gf-what")).value.trim()
        if (!what) return toast("Say what the gift was.")
        withSession("Thank everyone · Log a gift", () => {
          db.gifts.push({ id: Math.max(...db.gifts.map((/** @type {any} */ x) => x.id)) + 1, guestId: gid, what, at: "Today" })
          save()
          toast("Gift saved.")
          ctx.closeDialog()
        })
      },
    },
  }
  return s
}

// ---------------- Step 2: write ----------------

/** @param {Ctx} ctx @param {any} gift */
function startCard(ctx, gift, replace = false) {
  withSession("Thank everyone · Write the cards", () => {
    const id = Math.max(...db.cards.map((/** @type {any} */ c) => c.id)) + 1
    const g = guestById(gift.guestId)
    db.cards.push({ id, guestId: gift.guestId, status: "draft", channel: g.email ? "email" : g.phone ? "sms" : "link", message: seed(gift, id), photos: photosOfGuest(gift.guestId).slice(0, 1), fresh: true })
    save()
    ctx.nav("/thanks/write/c" + id, { replace })
  })
}

/** @param {Ctx} ctx @returns {Screen} */
export function writeScreen(ctx) {
  const todo = unwritten()
  const ds = drafts()
  const body = html`
    ${todo.length
      ? html`<div class="callout"><button type="button" class="btn primary big" data-act="write" data-gift="${todo[0].id}">
          Start with ${guestById(todo[0].guestId).name} →</button></div>`
      : ""}
    <h2 class="section-h">Still to write <span class="count">${todo.length}</span></h2>
    ${todo.length
      ? html`<ul class="worklist">${todo.map((/** @type {any} */ gift) => {
          const g = guestById(gift.guestId)
          const ph = photosOfGuest(g.id).length
          return html`<li>${raw(monogram(g.name, (g.id * 37) % 360))}<div><strong>${g.name}</strong>
            <span class="fine">${gift.what}${ph ? ` · in ${plural(ph, "photo")}` : ""}</span></div>
            <button type="button" class="btn secondary sm" data-act="write" data-gift="${gift.id}">Write card</button></li>`
        })}</ul>`
      : html`<p class="fine">Every gift has a card. Lovely.</p>`}
    <h2 class="section-h">Drafts <span class="count">${ds.length}</span></h2>
    <ul class="worklist">${ds.map((/** @type {any} */ c) => {
      const g = guestById(c.guestId)
      return html`<li>${raw(monogram(g.name, (g.id * 37) % 360))}<div><strong>${g.name}</strong>
        <span class="fine">${c.message.slice(0, 70)}…</span></div>
        <a class="btn ghost sm" href="${L("/thanks/write/c" + c.id)}">Edit</a></li>`
    })}</ul>`
  return withStepNav(
    {
      journey: "thanks",
      step: "write",
      title: "Write the cards",
      body,
      status: todo.length ? `${todo.length} to write · ${ds.length} drafts` : `${ds.length} drafts ready`,
      acts: {
        write: (el) => {
          const gift = db.gifts.find((/** @type {any} */ x) => x.id === Number(el.dataset.gift))
          if (gift) startCard(ctx, gift)
        },
      },
    },
    todo.length === 0,
  )
}

/** The composer's working copy lives here, not in the DOM, so a re-render, a
 *  vetoed navigation or a re-login never loses a word. */
/** @type {{ id: number, message: string, photos: number[], theme: string, dirty: boolean, rerolls: number } | null} */
let draft = null

/** @param {Ctx} ctx @param {string} cardParam @returns {Screen} */
export function composerScreen(ctx, cardParam) {
  const id = Number(cardParam.slice(1))
  const card = db.cards.find((/** @type {any} */ c) => c.id === id)
  if (!card) return { title: "Card not found", body: html`<p>That card doesn't exist.</p><a class="btn primary" href="${L("/thanks/write")}">Back to the cards</a>` }
  if (!draft || draft.id !== id) {
    draft = { id, message: card.message, photos: [...(card.photos || [])], theme: card.theme || "Gratitude", dirty: false, rerolls: 0 }
  }
  const d = draft
  const g = guestById(card.guestId)
  const gift = db.gifts.find((/** @type {any} */ x) => x.guestId === card.guestId)
  const theirs = photosOfGuest(g.id)
  const pool = [...new Set([...d.photos, ...(theirs.length ? theirs : [300, 303, 304, 307])])]
  const sent = card.status !== "draft"
  const doSave = () => {
    card.message = d.message
    card.photos = [...d.photos]
    card.theme = d.theme
    delete card.fresh
    d.dirty = false
    save()
  }
  const saveAndNext = () =>
    withSession(`Thank everyone · Card for ${g.name}`, () => {
      doSave()
      toast(`Saved the card for ${g.name}.`)
      const next = unwritten()[0]
      if (next) startCard(ctx, next, true)
      else ctx.up("/thanks/write")
    })
  const body = html`<div class="composer">
    <div class="cmp-form">
      <div class="rv-top"><a class="btn ghost sm" href="${L("/thanks/write")}" data-nav="up">← All cards</a>
        <span class="save-state ${d.dirty ? "dirty" : ""}" role="status">${d.dirty ? "Unsaved changes" : card.fresh ? "New draft" : "Saved"}</span></div>
      <p class="to">${raw(monogram(g.name, (g.id * 37) % 360))} <span>To <strong>${g.name}</strong>${gift ? html` · for ${gift.what}` : ""}</span></p>
      <label for="cmp-msg" class="np-q">Your message</label>
      <textarea id="cmp-msg" rows="7" ${sent ? raw("disabled") : ""}>${d.message}</textarea>
      <div class="row-between"><button type="button" class="link-btn" data-act="reroll" ${sent ? raw("disabled") : ""}>↻ Try different wording</button>
        <span class="fine">${d.message.length} / 2000</span></div>
      <fieldset class="photo-pick"><legend class="np-q">Add a photo ${theirs.length ? html`<span class="fine">— ${g.name.split(" ")[0]} is in these</span>` : html`<span class="fine">— name faces to see photos of ${g.name.split(" ")[0]} here</span>`}</legend>
        <div class="tiles-sm">${pool.map(
          (m) => html`<button type="button" class="pick ${d.photos.includes(m) ? "on" : ""}" data-act="photo" data-m="${m}" aria-pressed="${d.photos.includes(m)}">
            <img src="${sceneSvg(m)}" alt="Placeholder photo #${m}"></button>`,
        )}</div></fieldset>
      <label for="cmp-theme" class="np-q">Card style</label>
      <select id="cmp-theme">${["Gratitude", "Garden party", "Starlight", "Confetti"].map(
        (t) => html`<option ${t === d.theme ? raw("selected") : ""}>${t}</option>`,
      )}</select>
    </div>
    <div class="cmp-preview" aria-label="Preview">
      <p class="fine">What ${g.name.split(" ")[0]} will see</p>
      <div class="card-preview theme-${d.theme.split(" ")[0].toLowerCase()}">
        <p class="cp-from">From Jordana &amp; Jesse</p>
        <p class="cp-msg">${d.message}</p>
        <div class="polaroids">${d.photos.map((m, i) => html`<img src="${sceneSvg(m)}" alt="" style="--r:${i % 2 ? 4 : -5}deg">`)}</div>
      </div>
    </div>
  </div>`
  return withStepNav(
    {
      journey: "thanks",
      step: "write",
      title: `Card for ${g.name}`,
      heading: "Write the cards",
      compactIntro: true,
      body,
      wide: true,
      status: d.dirty ? "Unsaved changes" : "",
      prev: { label: "All cards", to: "/thanks/write" },
      next: null,
      abRight: sent
        ? undefined
        : html`<span class="ab-pair"><button type="button" class="btn secondary" data-act="save">Save draft</button>
            <button type="button" class="btn primary big" data-act="save-next">${unwritten().length ? "Save and write the next one" : "Save and finish"} →</button></span>`,
      guard: { what: `the card for ${g.name}`, dirty: () => !!draft && draft.id === id && draft.dirty, save: doSave, discard: () => {
          draft = null
        } },
      acts: {
        reroll: () => {
          d.rerolls += 1
          if (gift) d.message = seed(gift, id + d.rerolls)
          d.dirty = true
          ctx.refresh()
        },
        photo: (el) => {
          const m = Number(el.dataset.m)
          d.photos = d.photos.includes(m) ? d.photos.filter((x) => x !== m) : [...d.photos, m].slice(0, 3)
          d.dirty = true
          ctx.refresh()
        },
        save: () =>
          withSession(`Thank everyone · Card for ${g.name}`, () => {
            doSave()
            toast("Draft saved.")
            ctx.refresh()
          }),
        "save-next": saveAndNext,
      },
      mount: (root) => {
        const ta = root.querySelector("#cmp-msg")
        const st = root.querySelector(".save-state")
        const msg = root.querySelector(".cp-msg")
        if (ta instanceof HTMLTextAreaElement)
          ta.addEventListener("input", () => {
            d.message = ta.value
            d.dirty = true
            if (st) {
              st.textContent = "Unsaved changes"
              st.classList.add("dirty")
            }
            if (msg) msg.textContent = ta.value
          })
        const sel = root.querySelector("#cmp-theme")
        if (sel instanceof HTMLSelectElement)
          sel.addEventListener("change", () => {
            d.theme = sel.value
            d.dirty = true
            ctx.refresh()
          })
      },
    },
    false,
  )
}

// ---------------- Step 3: send (batch) ----------------

/** @type {Map<number, { on: boolean, channel: string }>} */
const pick = new Map()

/** @param {any} c */
function choice(c) {
  let p = pick.get(c.id)
  if (!p) {
    // Default to a channel that can actually reach them.
    const g = guestById(c.guestId)
    let channel = c.channel
    if (channel === "email" && !g.email) channel = g.phone ? "sms" : "link"
    if (channel === "sms" && !g.phone) channel = g.email ? "email" : "link"
    pick.set(c.id, (p = { on: true, channel }))
  }
  return p
}

const CHANNELS = /** @type {Record<string, string>} */ ({ email: "Email", sms: "Text message", link: "A link I'll share", manual: "I'll hand it over" })

/** @param {any} c */
function contact(c, ch = choice(c).channel) {
  const g = guestById(c.guestId)
  if (ch === "email") return g.email || "no email on file"
  if (ch === "sms") return g.phone || "no phone on file"
  if (ch === "link") return "you'll get a link to copy"
  return "you'll mark it given"
}

/** @param {Ctx} ctx @returns {Screen} */
export function sendScreen(ctx) {
  const ds = drafts()
  const chosen = ds.filter((/** @type {any} */ c) => choice(c).on)
  const body = ds.length
    ? html`<ul class="sendlist">${ds.map((/** @type {any} */ c) => {
        const g = guestById(c.guestId)
        const p = choice(c)
        return html`<li class="${p.on ? "" : "off"}">
          <label class="ck"><input type="checkbox" data-act="toggle" data-id="${c.id}" ${p.on ? raw("checked") : ""}>
            <span class="sr-only">Include ${g.name}</span></label>
          ${raw(monogram(g.name, (g.id * 37) % 360))}
          <div class="sl-m"><strong>${g.name}</strong><span class="fine">${c.message.slice(0, 60)}… <a href="${L("/thanks/write/c" + c.id)}">edit</a></span></div>
          <label class="sl-ch"><span class="sr-only">Send ${g.name}'s card by</span>
            <select data-id="${c.id}" class="ch-sel">${Object.entries(CHANNELS).map(
              ([k, v]) => html`<option value="${k}" ${k === p.channel ? raw("selected") : ""}>${v}</option>`,
            )}</select><span class="fine ${contact(c).startsWith("no ") ? "warn" : ""}">${contact(c)}</span></label>
        </li>`
      })}</ul>
      <div class="callout end"><a class="btn primary big ${chosen.length ? "" : "disabled"}" href="${L("/thanks/send/preview?ids=" + chosen.map((/** @type {any} */ c) => c.id).join(","))}"
        aria-disabled="${chosen.length === 0}">Check ${plural(chosen.length, "card")} before sending →</a>
        <p class="fine">Nothing is sent until the next screen.</p></div>`
    : html`<div class="empty-done"><div class="big-check sm" aria-hidden="true">✓</div><h2>Nothing waiting to send</h2>
        <p>${unwritten().length ? html`${plural(unwritten().length, "guest")} still need a card. <a href="${L("/thanks/write")}">Write them</a>.` : "Every card is on its way."}</p></div>`
  return withStepNav(
    {
      journey: "thanks",
      step: "send",
      title: "Send them",
      body,
      status: ds.length ? `${chosen.length} of ${ds.length} chosen` : "Step finished",
      abWork: chosen.length ? html`<a class="btn primary" href="${L("/thanks/send/preview?ids=" + chosen.map((/** @type {any} */ c) => c.id).join(","))}">Check ${chosen.length} →</a>` : undefined,
      acts: {
        toggle: (el) => {
          const c = ds.find((/** @type {any} */ x) => x.id === Number(el.dataset.id))
          if (c) choice(c).on = !choice(c).on
          ctx.refresh()
        },
      },
      mount: (root) => {
        for (const sel of root.querySelectorAll(".ch-sel")) {
          if (!(sel instanceof HTMLSelectElement)) continue
          sel.addEventListener("change", () => {
            const c = ds.find((/** @type {any} */ x) => x.id === Number(sel.dataset.id))
            if (c) choice(c).channel = sel.value
            ctx.refresh()
          })
        }
      },
    },
    ds.length === 0,
  )
}

/** @param {URLSearchParams} q */
function idsFrom(q) {
  return (q.get("ids") || "")
    .split(",")
    .filter(Boolean)
    .map(Number)
}

/** @param {Ctx} ctx @param {URLSearchParams} q @returns {Screen} */
export function sendPreviewScreen(ctx, q) {
  const cards = idsFrom(q)
    .map((id) => db.cards.find((/** @type {any} */ c) => c.id === id))
    .filter((/** @type {any} */ c) => c && c.status === "draft")
  if (!cards.length) return sendScreen(ctx)
  const send = () =>
    withSession(`Thank everyone · Sending ${plural(cards.length, "card")}`, () => {
      for (const c of cards) {
        c.channel = choice(c).channel
        c.status = "sent"
        pick.delete(c.id)
      }
      save()
      // REPLACE: Back from the result must not land on "Send" again.
      ctx.nav("/thanks/send/sent?ids=" + cards.map((/** @type {any} */ c) => c.id).join(","), { replace: true })
    })
  const body = html`<div class="rv-top"><a class="btn ghost sm" href="${L("/thanks/send")}" data-nav="up">← Change who gets one</a>
      <p class="rv-pos"><strong>Last look</strong> · this is exactly what goes out</p></div>
    <ul class="previews">${cards.map((/** @type {any} */ c) => {
      const g = guestById(c.guestId)
      const ch = choice(c).channel
      return html`<li class="pv">
        <div class="pv-h">${raw(monogram(g.name, (g.id * 37) % 360))}<strong>${g.name}</strong>
          <span class="pill">${CHANNELS[ch]}</span><span class="fine">${contact(c, ch)}</span></div>
        ${ch === "sms" ? html`<p class="sms">Jordana &amp; Jesse sent you a thank-you card 💌 wedding.example/thanks?card=…</p>` : ""}
        ${ch === "email" ? html`<p class="fine">Subject: A little thank-you from Jordana &amp; Jesse</p>` : ""}
        <div class="card-preview mini"><p class="cp-msg">${c.message}</p>
          <div class="polaroids">${(c.photos || []).map((/** @type {number} */ m, /** @type {number} */ i) => html`<img src="${sceneSvg(m)}" alt="" style="--r:${i % 2 ? 4 : -5}deg">`)}</div></div>
      </li>`
    })}</ul>`
  return {
    journey: "thanks",
    step: "send",
    title: "Check before sending",
    heading: "Send them",
    compactIntro: true,
    body,
    status: plural(cards.length, "card"),
    prev: { label: "Change who gets one", to: "/thanks/send" },
    next: null,
    acts: { send },
    abRight: html`<button type="button" class="btn primary big" data-act="send">Send ${plural(cards.length, "card")} now</button>`,
  }
}

/** @param {URLSearchParams} q @returns {Screen} */
export function sentScreen(q) {
  const cards = idsFrom(q)
    .map((id) => db.cards.find((/** @type {any} */ c) => c.id === id))
    .filter(Boolean)
  const links = cards.filter((/** @type {any} */ c) => c.channel === "link")
  const body = html`<section class="done-hero complete inline">
      <div class="burst" aria-hidden="true">${Array.from({ length: 14 }, (_, i) => html`<i style="--i:${i}"></i>`)}</div>
      <div class="big-check" aria-hidden="true">✓</div>
      <h2>${plural(cards.length, "card is", "cards are")} on the way</h2>
      <p class="lede">${sentCards().length} of ${db.gifts.length} guests thanked so far. You'll see it here when someone opens theirs.</p>
    </section>
    ${links.length
      ? html`<h2 class="section-h">Links to share yourself</h2><ul class="worklist">${links.map((/** @type {any} */ c) => {
          const g = guestById(c.guestId)
          return html`<li>${raw(monogram(g.name, (g.id * 37) % 360))}<div><strong>${g.name}</strong><span class="fine">wedding.example/thanks?card=${c.id}x7f</span></div>
            <button type="button" class="btn secondary sm" data-act="copy">Copy link</button></li>`
        })}</ul>`
      : ""}`
  return withStepNav(
    {
      journey: "thanks",
      step: "send",
      title: "Sent",
      heading: "Send them",
      body,
      status: "",
      prev: { label: "Send more", to: "/thanks/send" },
      acts: { copy: () => toast("Link copied.") },
    },
    true,
  )
}

// ---------------- Step 4: replies ----------------

/** @returns {Screen} */
export function repliesScreen() {
  const withReply = db.cards
    .filter((/** @type {any} */ c) => c.reply)
    .sort((/** @type {any} */ a, /** @type {any} */ b) => Number(a.reply.read) - Number(b.reply.read))
  const opened = db.cards.filter((/** @type {any} */ c) => c.status === "viewed" && !c.reply)
  const body = html`<ul class="replies">${withReply.map((/** @type {any} */ c) => {
      const g = guestById(c.guestId)
      return html`<li class="${c.reply.read ? "" : "unread"}"><a class="reply" href="${L("/thanks/replies/c" + c.id)}">
        <span class="emoji" aria-hidden="true">${EMOJI[c.reply.emoji]}</span>
        <div><strong>${g.name}</strong> ${c.reply.read ? "" : html`<span class="pill replied">new</span>`}
          <p>${c.reply.text}</p></div></a></li>`
    })}</ul>
    ${opened.length ? html`<p class="fine">Opened but no reply yet: ${opened.map((/** @type {any} */ c) => guestById(c.guestId).name).join(", ")}</p>` : ""}`
  return withStepNav(
    { journey: "thanks", step: "replies", title: "Read their replies", body, status: `${unreadReplies().length} new` },
    unreadReplies().length === 0,
  )
}

/** @param {string} cardParam @returns {Screen} */
export function replyDialog(cardParam) {
  const c = db.cards.find((/** @type {any} */ x) => x.id === Number(cardParam.slice(1)))
  if (!c || !c.reply) return repliesScreen()
  const g = guestById(c.guestId)
  const wasUnread = !c.reply.read
  c.reply.read = true
  save()
  const s = repliesScreen()
  s.dialog = {
    title: `${g.name} replied`,
    body: html`<p class="big-emoji" aria-hidden="true">${EMOJI[c.reply.emoji]}</p>
      <blockquote class="reply-q">${c.reply.text}</blockquote>
      <p class="fine">In reply to: "${c.message}"</p>
      ${wasUnread ? html`<p class="fine">Marked as read.</p>` : ""}`,
  }
  return s
}

export { drafts }
