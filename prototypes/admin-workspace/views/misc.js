/** @file The rest of the tree. Guests absorbs RSVPs (an RSVP is a fact about a
 *  guest, so it's a column + filter + a block in the guest's detail, not a
 *  tab). Requests absorbs Blocklist (the blocklist only exists to filter
 *  requests). Accounts moves out from under Moderation. Site content carries
 *  the second navigation guard. These are lighter-weight than the three core
 *  flows, but every one is a real route with Back behaving. */

import { href, esc, actions, guard, split, mBack, toast, wide, seg } from "../ui.js"
import { store, guest } from "../data.js"
import { avatarSvg, photoSvg } from "../art.js"

// ------------------------------------------------------------------ guests

/** @param {any} ctx */
function guestsView(ctx) {
  const q = ctx.query
  const f = q.get("rsvp") || "all"
  const items = store.guests.filter((g, i) => f === "all" || (f === "awaiting" ? i % 7 === 3 : f === "yes" ? g.rsvp === "yes" && i % 7 !== 3 : g.rsvp === "no"))
  const id = ctx.params.guest ? Number(ctx.params.guest.slice(1)) : null
  const qs = q.toString() ? "?" + q : ""
  if (id === null && wide() && items.length) return { redirect: "/guests/g" + items[0].id + qs }
  const g = id !== null ? guest(id) : null
  const chips = [["all", "Everyone"], ["yes", "Coming"], ["no", "Can't come"], ["awaiting", "Awaiting reply"]]
    .map(([k, l]) => `<a class="chip" data-replace href="${href("/guests" + (k === "all" ? "" : "?rsvp=" + k))}" ${f === k ? 'aria-current="true"' : ""}>${l}</a>`)
    .join("")
  const list = `<header class="pane-head"><h1>Guests &amp; RSVPs</h1>
      <div class="pane-tools"><span class="muted small">${store.guests.length} parties · 31 people coming</span>
      <a class="btn btn-sm" href="${href("/guests/new")}">+ Add</a><a class="btn btn-sm" href="${href("/guests/import")}">Import CSV</a></div>
      <div class="chips" role="group" aria-label="RSVP">${chips}</div></header>
    <ul class="rows">${items
      .map(
        (x) => `<li><a class="row" href="${href("/guests/g" + x.id + qs)}" data-select ${x === g ? 'aria-current="true"' : ""}>
        <span class="avatar">${avatarSvg({ name: x.name, hue: x.id * 29 })}</span>
        <span class="row-main"><span class="row-top"><strong>${esc(x.name)}</strong><span class="row-time">${x.party}</span></span>
        <span class="row-sub">${x.rsvp === "yes" ? "Coming" : "Can't come"}${x.email ? " · " + esc(x.email) : ""}</span></span></a></li>`,
      )
      .join("")}</ul>`
  const detail = g
    ? `${mBack("/guests" + qs, "Guests")}<article class="detail">
      <header class="person-head"><span class="avatar avatar-xl">${avatarSvg({ name: g.name, hue: g.id * 29 })}</span><div><h1>${esc(g.name)}</h1><p class="muted">Party of ${g.party}</p></div></header>
      <dl class="facts"><div><dt>RSVP</dt><dd>${g.rsvp === "yes" ? "Coming" : "Can't come"} · replied Mar 2</dd></div>
        <div><dt>Email</dt><dd>${esc(g.email || "—")}</dd></div><div><dt>Phone</dt><dd>${esc(g.phone || "—")}</dd></div>
        <div><dt>Invite code</dt><dd><code>RSVP-${g.id}X</code></dd></div></dl>
      <div class="btn-row"><a class="btn btn-sm" href="${href("/guests/g" + g.id + "/edit")}">Edit</a><button class="btn btn-sm">Resend invite</button><button class="btn btn-sm">Delete…</button></div>
    </article>`
    : `<div class="detail-empty">Pick a guest.</div>`
  return split({ list, detail, selected: !!g, label: "Guests" })
}

/** @param {string} title @param {string} body */
function simpleDialog(title, body) {
  return `<header class="dlg-head"><h2 id="dlg-title">${esc(title)}</h2><button class="dlg-x" data-close aria-label="Close">×</button></header>
    <div class="form">${body}</div>
    <footer class="dlg-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-close>Save</button></footer>`
}

// --------------------------------------------------------------- accounts

/** @param {any} ctx */
function accountsView(ctx) {
  const id = ctx.params.account ? Number(ctx.params.account.slice(1)) : null
  const accts = store.guests.slice(0, 12)
  if (id === null && wide()) return { redirect: "/accounts/a" + accts[0].id }
  const a = id !== null ? accts.find((x) => x.id === id) : null
  const list = `<header class="pane-head"><h1>Accounts</h1><p class="muted small">Guests who signed in to post. Trusted accounts skip review.</p></header>
    <ul class="rows">${accts
      .map(
        (x, i) => `<li><a class="row" href="${href("/accounts/a" + x.id)}" data-select ${x === a ? 'aria-current="true"' : ""}>
        <span class="avatar">${avatarSvg({ name: x.name, hue: x.id * 29 })}</span><span class="row-main"><span class="row-top"><strong>${esc(x.name)}</strong>${i % 3 ? `<span class="pill st-opened">Trusted</span>` : ""}</span>
        <span class="row-sub">${(i * 3) % 7} posts</span></span></a></li>`,
      )
      .join("")}</ul>`
  const detail = a
    ? `${mBack("/accounts", "Accounts")}<article class="detail"><header class="person-head"><span class="avatar avatar-xl">${avatarSvg({ name: a.name, hue: a.id * 29 })}</span><div><h1>${esc(a.name)}</h1></div></header>
      <div class="btn-row"><button class="btn btn-sm">Trust</button><a class="btn btn-sm" href="${href("/review?author=" + a.id)}">See their posts</a><button class="btn btn-sm">Delete account…</button></div></article>`
    : `<div class="detail-empty">Pick an account.</div>`
  return split({ list, detail, selected: !!a, label: "Accounts" })
}

// --------------------------------------------------------------- requests

/** @param {any} ctx */
function requestsView(ctx) {
  const blocked = ctx.path === "/requests/blocked"
  const tabs = seg([{ label: "Requests", to: "/requests", n: 1, on: !blocked }, { label: "Blocked", to: "/requests/blocked", on: blocked }], "Requests")
  const body = blocked
    ? `<ul class="rows"><li class="row"><span class="row-main"><strong>spam@example.net</strong><span class="row-sub">Blocked Feb 3 · 4 requests stopped</span></span></li></ul>`
    : `<ul class="rows"><li><a class="row" href="${href("/requests/p3")}" data-select ${ctx.params.req ? 'aria-current="true"' : ""}><span class="avatar">${avatarSvg({ name: "Nadia Petrova", hue: 200 })}</span>
       <span class="row-main"><span class="row-top"><strong>Nadia Petrova</strong><span class="row-time">2d ago</span></span><span class="row-sub">“I'm Callum's partner — we were only sent one invite”</span></span></a></li></ul>`
  const detail = ctx.params.req
    ? `${mBack("/requests", "Requests")}<article class="detail"><header class="detail-head"><span class="eyebrow">Invitation request</span></header>
      <h1>Nadia Petrova</h1><blockquote class="msg-big">I'm Callum's partner — we were only sent one invite. Could I be added?</blockquote>
      <p class="muted">Possible match on the guest list: <a href="${href("/guests/g119")}">Callum Reid</a></p></article>
      <div class="actionbar"><button class="btn btn-primary btn-lg" data-action="req-approve">Approve &amp; invite</button><button class="btn btn-lg">Deny</button><button class="btn btn-lg btn-danger-soft">Deny &amp; block</button></div>`
    : `<div class="detail-empty">Pick a request.</div>`
  return split({ list: `<header class="pane-head"><h1>Requests</h1>${tabs}</header>${body}`, detail, selected: !!ctx.params.req, label: "Requests" })
}
actions["req-approve"] = () => toast("Approved — invite sent to Nadia")

// ---------------------------------------------------------------- gallery

/** @param {any} ctx */
function galleryView(ctx) {
  const loved = ctx.path.startsWith("/gallery/loved")
  const tabs = seg([{ label: "Official", to: "/gallery", on: !loved }, { label: "Most loved by guests", to: "/gallery/loved", on: loved }], "Gallery")
  const items = Array.from({ length: 12 }, (_, i) => i)
  return `<div class="single single-wide">
    <header class="single-head"><h1>Gallery</h1>${tabs}
      <p class="muted">${loved ? "Guest photos ranked by reactions. Promote the best into Official." : "The curated set, in order. Use the arrows to reorder."}</p>
      ${loved ? "" : `<a class="btn btn-sm" href="${href("/gallery/upload")}">+ Add official photos</a>`}</header>
    <ul class="photo-grid">${items
      .map(
        (i) => `<li><div class="photo-card">${photoSvg(900 + i + (loved ? 50 : 0))}<span class="small">${loved ? `♥ ${30 - i * 2} · by ${esc(store.guests[i].name)}` : `#${i + 1}`}</span>
        <span class="btn-row">${loved ? `<button class="btn btn-sm" data-action="gal-promote">Add to Official</button>` : `<button class="btn btn-sm" aria-label="Move earlier">←</button><button class="btn btn-sm" aria-label="Move later">→</button>`}</span></div></li>`,
      )
      .join("")}</ul></div>`
}
actions["gal-promote"] = () => toast("Added to Official")

// ----------------------------------------------------------- site content

let siteDirty = false
function contentView() {
  return `<div class="single">
    <header class="single-head"><h1>Site content</h1>${seg([{ label: "Content", to: "/site/content", on: true }, { label: "Effects", to: "/site/effects", on: false }], "Site")}
      <p class="muted">What guests read on the public site. Changes go live when you save.</p></header>
    <form class="form" id="site-form">
      <label>Headline <input id="sc-head" value="Jordana &amp; Jesse"></label>
      <label>Date line <input value="April 26, 2026 · Portland, OR"></label>
      <label>After-the-wedding note <textarea rows="4">Thank you for celebrating with us. Share your photos in the gallery!</textarea></label>
      <span class="dirty-note" id="sc-dirty" hidden>Unsaved changes</span>
    </form>
    <div class="actionbar"><button class="btn btn-primary btn-lg" data-action="sc-save">Save</button></div>
  </div>`
}
/** @param {any} ctx */
function contentMount(ctx) {
  siteDirty = false
  guard.current = { path: ctx.path, dirty: () => siteDirty, what: "your site content" }
  document.getElementById("site-form")?.addEventListener("input", () => {
    siteDirty = true
    const n = document.getElementById("sc-dirty")
    if (n) n.hidden = false
  })
}
actions["sc-save"] = () => {
  siteDirty = false
  const n = document.getElementById("sc-dirty")
  if (n) n.hidden = true
  toast("Site content saved")
}

function effectsView() {
  return `<div class="single"><header class="single-head"><h1>Effects</h1>${seg([{ label: "Content", to: "/site/content", on: false }, { label: "Effects", to: "/site/effects", on: true }], "Site")}
    <p class="muted">Which animations play on each public page. (Stub — unchanged from today's Effects tab, just given a home under Site.)</p></header></div>`
}

// ------------------------------------------------------------------ routes

const gl = { label: "Guest list" }
/** @type {any[]} */
export const miscRoutes = [
  { pattern: "/guests", section: "guests", sel: "guest", title: () => "Guests & RSVPs", crumbs: () => [gl, { label: "Guests & RSVPs" }], render: guestsView },
  { pattern: "/guests/new", section: "guests", title: () => "Add guest", parent: () => "/guests", render: () => simpleDialog("Add a guest", `<label>Name <input data-autofocus></label><label>Email <input></label><label>Party size <input type="number" value="1"></label>`) },
  { pattern: "/guests/import", section: "guests", title: () => "Import CSV", parent: () => "/guests", render: () => simpleDialog("Import guests", `<p>Choose a CSV with name, email, phone, party size.</p><input type="file" accept=".csv">`) },
  {
    pattern: "/guests/:guest", section: "guests", sel: "guest",
    title: (/** @type {any} */ c) => guest(Number(c.params.guest.slice(1)))?.name || "Guest",
    crumbs: (/** @type {any} */ c) => [gl, { label: "Guests & RSVPs", to: "/guests" }, { label: guest(Number(c.params.guest.slice(1)))?.name || "?" }],
    render: guestsView,
  },
  {
    pattern: "/guests/:guest/edit", section: "guests", title: () => "Edit guest",
    parent: (/** @type {any} */ c) => "/guests/" + c.params.guest,
    render: (/** @type {any} */ c) => {
      const g = guest(Number(c.params.guest.slice(1)))
      return simpleDialog("Edit " + (g ? g.name : "guest"), `<label>Name <input value="${esc(g ? g.name : "")}" data-autofocus></label><label>Email <input value="${esc(g ? g.email : "")}"></label>`)
    },
  },
  { pattern: "/accounts", section: "accounts", sel: "account", title: () => "Accounts", crumbs: () => [gl, { label: "Accounts" }], render: accountsView },
  { pattern: "/accounts/:account", section: "accounts", sel: "account", title: () => "Account", crumbs: () => [gl, { label: "Accounts", to: "/accounts" }, { label: "Account" }], render: accountsView },
  { pattern: "/requests", section: "requests", sel: "req", title: () => "Requests", crumbs: () => [gl, { label: "Requests" }], render: (/** @type {any} */ c) => (wide() ? { redirect: "/requests/p3" } : requestsView(c)) },
  { pattern: "/requests/blocked", section: "requests", title: () => "Blocked", crumbs: () => [gl, { label: "Requests", to: "/requests" }, { label: "Blocked" }], render: requestsView },
  { pattern: "/requests/:req", section: "requests", sel: "req", title: () => "Request", crumbs: () => [gl, { label: "Requests", to: "/requests" }, { label: "Nadia Petrova" }], render: requestsView },
  { pattern: "/gallery", section: "gallery", title: () => "Gallery", crumbs: () => [{ label: "Memories" }, { label: "Gallery" }], render: galleryView },
  { pattern: "/gallery/loved", section: "gallery", title: () => "Most loved", crumbs: () => [{ label: "Memories" }, { label: "Gallery", to: "/gallery" }, { label: "Most loved" }], render: galleryView },
  { pattern: "/gallery/upload", section: "gallery", title: () => "Add photos", parent: () => "/gallery", render: () => simpleDialog("Add official photos", `<input type="file" multiple accept="image/*,video/*" data-autofocus><p class="muted small">Big uploads keep going if you close this.</p>`) },
  { pattern: "/site/content", section: "content", title: () => "Site content", crumbs: () => [{ label: "Site" }, { label: "Content" }], render: contentView, mount: contentMount },
  { pattern: "/site/effects", section: "effects", title: () => "Effects", crumbs: () => [{ label: "Site" }, { label: "Effects" }], render: effectsView },
]

