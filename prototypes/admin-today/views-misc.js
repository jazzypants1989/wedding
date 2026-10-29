/** @file Everything that is not a core flow: guests, RSVPs, invitation
 *  requests, accounts, blocklist, gallery, site content, effects, the "All
 *  sections" page and 404. Mostly stubs — enough to show where things live
 *  and that every one of them is a real, Back-able address. */

import { state, save, logDone, pendingPetitions } from "./data.js"
import { route, setQuery, href, returnTo, setGuard } from "./router.js"
import { avatar, photoSvg, scenerySvg } from "./art.js"
import { esc, icon, toast, act, rerender, plural } from "./ui.js"
import { NAV } from "./nav.js"

function subnav(active) {
  const pets = pendingPetitions().length
  const items = [
    ["guests", "/guests", "Guest list"],
    ["rsvps", "/guests/rsvps", "RSVPs"],
    ["requests", "/guests/requests", `Requests ${pets ? `<span class="count">${pets}</span>` : ""}`],
    ["accounts", "/guests/accounts", "Accounts"],
    ["blocklist", "/guests/blocklist", "Blocklist"],
  ]
  return `<nav class="subnav" aria-label="Guests">${items
    .map(([k, to, label]) => `<a href="${href(to)}" class="${k === active ? "is-on" : ""}" ${k === active ? 'aria-current="page"' : ""}>${label}</a>`)
    .join("")}</nav>`
}

route("/guests", {
  nav: "guests",
  title: () => "Guest list",
  render(ctx) {
    const q = (ctx.query.get("q") || "").toLowerCase()
    const list = state.guests.filter((g) => !q || g.name.toLowerCase().includes(q))
    const responded = state.guests.filter((g) => g.status === "responded")
    const heads = responded.filter((g) => g.attending).reduce((n, g) => n + g.party, 0)
    return `<div class="page"><header class="page-head row"><div><p class="eyebrow">Guests</p><h1>Guest list</h1>
      <p class="lede">${state.guests.length} invitations · ${responded.length} replied · ${heads} came.</p></div>
      <div class="row-gap"><a class="btn btn-secondary btn-sm" href="${href("/guests/import")}">Import CSV</a><a class="btn btn-primary btn-sm" href="${href("/guests/new")}">Add guest</a></div></header>
      ${subnav("guests")}
      <input class="search" type="search" placeholder="Search by name…" value="${esc(q)}" aria-label="Search guests" />
      <table class="table"><thead><tr><th>Name</th><th class="hide-phone">Contact</th><th>Status</th><th class="hide-phone">Party</th></tr></thead><tbody>
      ${list.map((g) => `<tr><td><a href="${href(`/guests/${g.id}`)}">${esc(g.name)}</a></td><td class="hide-phone muted">${esc(g.email || g.phone || "—")}</td><td><span class="pill ${g.status === "responded" ? "ok" : g.status === "invited" ? "" : "warn"}">${g.status}</span></td><td class="hide-phone">${g.party}</td></tr>`).join("")}
      </tbody></table></div>`
  },
  mount(el) {
    const s = /** @type {HTMLInputElement} */ (el.querySelector(".search"))
    s.addEventListener("input", () => {
      setQuery({ q: s.value })
      rerender()
      const again = /** @type {HTMLInputElement | null} */ (document.querySelector(".search"))
      again?.focus()
      again?.setSelectionRange(again.value.length, again.value.length)
    })
  },
})

function guestDialog(title, body) {
  return `<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dlg-h">
    <header class="dialog-head"><h2 id="dlg-h">${title}</h2><button type="button" class="dialog-close" aria-label="Close (Esc)">${icon("close")}</button></header>${body}</div>`
}

route("/guests/new", {
  nav: "guests",
  dialog: true,
  parent: () => "/guests",
  title: () => "Add guest",
  render: () =>
    guestDialog(
      "Add guest",
      `<form class="stack"><label>Name <input required /></label><label>Email <input type="email" /></label><label>Phone <input /></label>
      <div class="dialog-actions"><button type="button" class="btn btn-secondary dialog-cancel">Cancel</button><button class="btn btn-primary" type="button" disabled title="Stub">Add</button></div></form>`,
    ),
})

route("/guests/import", {
  nav: "guests",
  dialog: true,
  parent: () => "/guests",
  title: () => "Import CSV",
  render: () => guestDialog("Import guests from CSV", `<p class="muted">Step 1 of 2 — choose a file. Step 2 (/guests/import/preview) shows what will change.</p><div class="dialog-actions"><button type="button" class="btn btn-secondary dialog-cancel">Cancel</button></div>`),
})

route("/guests/invite", {
  nav: "guests",
  title: () => "Send invites",
  render: () => `<div class="page"><nav class="crumbs"><a href="${href("/guests")}">Guests</a> / Send invites</nav><h1>Send invites</h1><p class="lede">Same three-step shape as sending cards: choose → how → check &amp; send. (Stub.)</p></div>`,
})

route("/guests/rsvps", {
  nav: "rsvps",
  title: () => "RSVPs",
  render: () => `<div class="page"><header class="page-head"><p class="eyebrow">Guests</p><h1>RSVPs</h1></header>${subnav("rsvps")}
    <table class="table"><thead><tr><th>Guest</th><th>Coming</th><th>Party</th></tr></thead><tbody>${state.guests
      .filter((g) => g.status === "responded")
      .map((g) => `<tr><td>${esc(g.name)}</td><td>${g.attending ? "Yes" : "No"}</td><td>${g.party}</td></tr>`)
      .join("")}</tbody></table></div>`,
})

route("/guests/requests", {
  nav: "requests",
  title: () => "Invitation requests",
  render: () => `<div class="page"><header class="page-head"><p class="eyebrow">Guests</p><h1>Invitation requests</h1><p class="lede">People who asked for an invite (or, now, access to the photos).</p></header>${subnav("requests")}
    <ul class="rows">${state.petitions.map((p) => `<li><a class="row-link" href="${href(`/guests/requests/${p.id}`)}">${avatar(p.name, 40)}<span class="row-main"><strong>${esc(p.name)}</strong> <span class="pill ${p.status === "pending" ? "warn" : "ok"}">${p.status}</span><span class="row-text muted">${esc(p.note)}</span></span><span class="row-go">${icon("next")}</span></a></li>`).join("")}</ul></div>`,
})

route("/guests/requests/:pid", {
  nav: "requests",
  dialog: true,
  parent: () => "/guests/requests",
  title: () => "Invitation request",
  render(ctx) {
    const p = state.petitions.find((x) => x.id === ctx.params.pid)
    if (!p) return guestDialog("Not found", "")
    return guestDialog(
      `Request from ${esc(p.name)}`,
      `<blockquote>${esc(p.note)}</blockquote><p class="muted">${p.ago} ago</p>
      ${p.status === "pending" ? `<div class="dialog-actions"><button type="button" class="btn btn-secondary deny">Decline</button><button type="button" class="btn btn-primary approve">Approve &amp; add to guests</button></div>` : `<p>Already ${p.status}.</p>`}`,
    )
  },
  mount(el, ctx) {
    const p = state.petitions.find((x) => x.id === ctx.params.pid)
    if (!p) return
    const decide = (status) =>
      act(() => {
        p.status = status
        save()
        logDone("requests", `${status === "approved" ? "Approved" : "Declined"} ${esc(p.name)}'s request`)
        toast(`${status === "approved" ? "Approved" : "Declined"} ${esc(p.name)}.`, {
          undo: () => {
            p.status = "pending"
            state.done.shift()
            save()
            rerender()
          },
        })
        returnTo("/")
      })
    el.querySelector(".approve")?.addEventListener("click", () => decide("approved"))
    el.querySelector(".deny")?.addEventListener("click", () => decide("denied"))
  },
})

route("/guests/g:gid", {
  nav: "guests",
  dialog: true,
  parent: () => "/guests",
  title: () => "Guest",
  render(ctx) {
    const g = state.guests.find((x) => x.id === "g" + ctx.params.gid)
    if (!g) return guestDialog("Not found", "")
    return guestDialog(esc(g.name), `<p>${esc(g.email || "no email")} · ${esc(g.phone || "no phone")}</p><p>Status: ${g.status} · party of ${g.party}</p>
      <p class="muted small">Their story (gifts, cards, posts, photos they're in) would live here.</p>
      <div class="dialog-actions"><a class="btn btn-secondary" href="${href(`/thanks/cards/new?guest=${g.id}`)}">Write a card</a><button type="button" class="btn btn-secondary dialog-cancel">Close</button></div>`)
  },
})

route("/guests/accounts", {
  nav: "accounts",
  title: () => "Accounts",
  render: () => `<div class="page"><header class="page-head"><p class="eyebrow">Guests</p><h1>Guest accounts</h1><p class="lede">Trusted guests post straight to the site. Approving a post trusts its author.</p></header>${subnav("accounts")}
    <ul class="rows">${state.accounts.map((a) => `<li class="row-static">${avatar(a.name, 36)}<span class="row-main"><strong>${esc(a.name)}</strong><span class="row-text muted">${plural(a.posts, "post")} · <a href="${href(`/review?account=${a.id}&status=approved`)}">see posts</a></span></span><span class="pill ${a.trusted ? "ok" : ""}">${a.trusted ? "Trusted" : "Not trusted"}</span></li>`).join("")}</ul></div>`,
})

route("/guests/blocklist", {
  nav: "blocklist",
  title: () => "Blocklist",
  render: () => `<div class="page"><header class="page-head"><p class="eyebrow">Guests</p><h1>Blocklist</h1><p class="lede">Emails and numbers that can't send invitation requests.</p></header>${subnav("blocklist")}
    <ul class="rows">${state.blocklist.map((b) => `<li class="row-static"><span class="row-main">${esc(b.value)}</span><button class="btn btn-ghost btn-sm" type="button">Remove</button></li>`).join("")}</ul></div>`,
})

// ---- gallery -------------------------------------------------------------------

function gallerySub(active) {
  return `<nav class="subnav" aria-label="Gallery"><a href="${href("/gallery")}" class="${active === "official" ? "is-on" : ""}">Official</a><a href="${href("/gallery/loved")}" class="${active === "loved" ? "is-on" : ""}">Most loved ♥</a></nav>`
}

route("/gallery", {
  nav: "gallery",
  title: () => "Gallery",
  render: () => `<div class="page"><header class="page-head row"><div><p class="eyebrow">Memories</p><h1>Official gallery</h1><p class="lede">The photographer's pick, in the order guests see it. Drag to reorder.</p></div><a class="btn btn-primary btn-sm" href="${href("/gallery/upload")}">Add photos</a></header>${gallerySub("official")}
    <ul class="photo-grid">${state.official.map((m) => `<li>${scenerySvg((m * 37) % 360)}<span>#${m}</span></li>`).join("")}</ul></div>`,
})

route("/gallery/loved", {
  nav: "gallery",
  title: () => "Most loved",
  render: () => `<div class="page"><header class="page-head"><p class="eyebrow">Memories</p><h1>Most loved</h1><p class="lede">Guest photos ranked by reactions. Feature a favourite in the official gallery.</p></header>${gallerySub("loved")}
    <ul class="photo-grid">${state.loved.map((l) => `<li>${scenerySvg((l.mediaId * 37) % 360)}<span>♥ ${l.hearts} · ${esc(l.author)}</span><button class="btn btn-secondary btn-sm" type="button">Feature</button></li>`).join("")}</ul></div>`,
})

route("/gallery/upload", {
  nav: "gallery",
  dialog: true,
  parent: () => "/gallery",
  title: () => "Add photos",
  render: () => guestDialog("Add official photos", `<p class="muted">Drop files here. (Stub.)</p><div class="dialog-actions"><button type="button" class="btn btn-secondary dialog-cancel">Close</button></div>`),
})

// ---- site -----------------------------------------------------------------------

route("/site/content", {
  nav: "content",
  title: () => "Site content",
  render: () => `<div class="page"><header class="page-head row"><div><p class="eyebrow">Site</p><h1>Site content</h1><p class="lede">The words on the home page. Edit, then save — leaving with unsaved edits asks first.</p></div>
    <div class="row-gap"><span class="dirty-note muted" hidden>Unsaved changes</span><button class="btn btn-primary save-site" type="button">Save</button></div></header>
    <form class="stack"><label>Headline <input class="sc-h" value="${esc(state.siteContent.headline)}" /></label>
    <label>Message <textarea class="sc-b" rows="5">${esc(state.siteContent.body)}</textarea></label></form></div>`,
  mount(el) {
    const h = /** @type {HTMLInputElement} */ (el.querySelector(".sc-h"))
    const b = /** @type {HTMLTextAreaElement} */ (el.querySelector(".sc-b"))
    const note = /** @type {HTMLElement} */ (el.querySelector(".dirty-note"))
    const isDirty = () => h.value !== state.siteContent.headline || b.value !== state.siteContent.body
    const doSave = () =>
      act(() => {
        state.siteContent = { headline: h.value, body: b.value }
        save()
        note.hidden = true
        toast("Site content saved.")
      })
    setGuard({ message: "Your site content has unsaved edits.", isDirty, save: doSave })
    for (const x of [h, b]) x.addEventListener("input", () => (note.hidden = !isDirty()))
    el.querySelector(".save-site")?.addEventListener("click", doSave)
  },
})

route("/site/effects", {
  nav: "effects",
  title: () => "Effects",
  render: () => `<div class="page"><header class="page-head"><p class="eyebrow">Site</p><h1>Effects</h1><p class="lede">Ambient effects on each public page. (Stub.)</p></header></div>`,
})

// ---- all sections + 404 ------------------------------------------------------------

route("/more", {
  nav: "more",
  title: () => "All sections",
  render: () => `<div class="page"><header class="page-head"><h1>Everything</h1><p class="lede">Every part of the admin, in one place. Also: press ${"<kbd>/</kbd>"} anywhere and type.</p></header>
    ${NAV()
      .map((grp) => `<section class="more-group">${grp.label ? `<h2 class="section-h">${grp.label}</h2>` : ""}<ul class="more-list">${grp.items.map((it) => `<li><a href="${href(it.to)}">${icon(it.icon, 20)} <span>${it.label}</span>${it.badge ? `<span class="count">${it.badge}</span>` : ""}</a></li>`).join("")}</ul></section>`)
      .join("")}</div>`,
})

route("/404", {
  nav: "",
  title: () => "Not found",
  render: () => `<div class="page"><div class="empty">There's nothing at this address. <a href="${href("/")}">Go to Today</a></div></div>`,
})
