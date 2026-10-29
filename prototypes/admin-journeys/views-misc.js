/** @file Gallery journey, the before-the-wedding tools and the site editor.
 *  Lighter than the three core flows — enough to show where everything lives. */

import { html, raw, plural } from "./html.js"
import { db, save, guestById } from "./data.js"
import { sceneSvg, monogram } from "./art.js"
import { L, toast, withSession, withStepNav } from "./shell.js"

/** @typedef {import("./shell.js").Screen} Screen
 *  @typedef {{ nav: (to: string, o?: { replace?: boolean }) => void, refresh: () => void, closeDialog: () => void }} Ctx */

// ---------------- gallery ----------------

/** @param {Ctx} ctx @returns {Screen} */
export function galleryAddScreen(ctx) {
  const body = html`<div class="drop">
      <p class="drop-t">Drop photos or videos here</p><p class="fine">or</p>
      <button type="button" class="btn primary" data-act="add">Choose files…</button>
      <p class="fine">${db.official.length} official photos so far.</p></div>
    <ul class="tiles-sm wide-tiles">${db.official.slice(-6).map(
      (/** @type {any} */ o) => html`<li><img src="${sceneSvg(o.id)}" alt="Placeholder photo: ${o.caption}"></li>`,
    )}</ul>`
  return withStepNav(
    {
      journey: "gallery",
      step: "add",
      title: "Add the official photos",
      body,
      status: `${db.official.length} photos`,
      acts: {
        add: () =>
          withSession("Curate the gallery · Add photos", () => {
            const base = 340 + db.official.length
            for (let i = 0; i < 3; i++) db.official.push({ id: base + i, caption: "" })
            save()
            toast("3 photos added (pretend).")
            ctx.refresh()
          }),
      },
    },
    true,
  )
}

/** @param {Ctx} ctx @returns {Screen} */
export function galleryOrderScreen(ctx) {
  /** @param {number} i @param {number} d */
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= db.official.length) return
    const t = db.official[i]
    db.official[i] = db.official[j]
    db.official[j] = t
    save()
    ctx.refresh()
  }
  const body = html`<ol class="order">${db.official.map(
    (/** @type {any} */ o, /** @type {number} */ i) => html`<li>
      <span class="gn">${i + 1}</span><img src="${sceneSvg(o.id)}" alt="Placeholder photo ${i + 1}">
      <input value="${o.caption}" placeholder="Add a caption" aria-label="Caption for photo ${i + 1}">
      <span class="mv"><button type="button" class="btn ghost sm" data-act="up" data-i="${i}" aria-label="Move earlier" ${i === 0 ? raw("disabled") : ""}>↑</button>
      <button type="button" class="btn ghost sm" data-act="down" data-i="${i}" aria-label="Move later" ${i === db.official.length - 1 ? raw("disabled") : ""}>↓</button></span>
    </li>`,
  )}</ol>`
  return withStepNav(
    {
      journey: "gallery",
      step: "order",
      title: "Put them in order",
      body,
      acts: { up: (el) => move(Number(el.dataset.i), -1), down: (el) => move(Number(el.dataset.i), 1) },
    },
    true,
  )
}

/** @param {Ctx} ctx @returns {Screen} */
export function galleryLovedScreen(ctx) {
  const body = html`<ul class="loved">${db.loved.map(
    (/** @type {any} */ l) => html`<li class="${l.promoted ? "on" : ""}"><img src="${sceneSvg(l.id)}" alt="Placeholder guest photo">
      <div><strong>${l.caption}</strong><span class="fine">by ${l.by} · ♥ ${l.hearts}</span></div>
      <button type="button" class="btn ${l.promoted ? "ghost" : "secondary"} sm" data-act="promote" data-id="${l.id}">${l.promoted ? "Added ✓" : "Add to official"}</button></li>`,
  )}</ul>`
  return withStepNav(
    {
      journey: "gallery",
      step: "loved",
      title: "Bring in guests' favourites",
      body,
      acts: {
        promote: (el) =>
          withSession("Curate the gallery · Guests' favourites", () => {
            const l = db.loved.find((/** @type {any} */ x) => x.id === Number(el.dataset.id))
            l.promoted = !l.promoted
            save()
            ctx.refresh()
          }),
      },
    },
    true,
  )
}

// ---------------- before the wedding ----------------

/** @returns {Screen} */
export function guestsScreen() {
  const body = html`<div class="toolbar"><a class="btn primary" href="${L("/guests/new")}">+ Add a guest</a>
      <a class="btn secondary" href="${L("/guests/import")}">Import a spreadsheet</a>
      <button type="button" class="btn ghost" data-act="noop">Export</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col" class="hide-sm">Party</th></tr></thead>
    <tbody>${db.guests.map(
      (/** @type {any} */ g) => html`<tr><td><a href="${L("/guests/g" + g.id)}">${g.name}</a></td>
        <td><span class="pill ${g.status}">${g.status}</span></td><td class="hide-sm">${g.party}</td></tr>`,
    )}</tbody></table></div>`
  return withStepNav({ journey: "invite", step: "guests", title: "Guest list", body, acts: { noop: () => toast("Prototype: export would download a CSV.") } }, true)
}

/** @param {Ctx} ctx @param {string | null} idParam @returns {Screen} */
export function guestDialog(ctx, idParam) {
  const s = guestsScreen()
  const g = idParam ? guestById(Number(idParam.slice(1))) : null
  s.dialog = {
    title: g ? g.name : idParam === null ? "Add a guest" : "Guest",
    body: html`<div class="form"><label for="gd-n">Name</label><input id="gd-n" value="${g ? g.name : ""}">
      <label for="gd-e">Email</label><input id="gd-e" value="${g ? g.email : ""}">
      <label for="gd-p">Party size</label><input id="gd-p" type="number" value="${g ? g.party : 1}" min="1" max="20">
      <div class="dlg-foot"><button type="button" class="btn secondary" data-act="dlg-close">Cancel</button>
      <button type="button" class="btn primary" data-act="gd-save">Save</button></div></div>`,
    acts: { "gd-save": () => (toast("Saved (pretend)."), ctx.closeDialog()) },
  }
  return s
}

/** @returns {Screen} */
export function importDialog() {
  const s = guestsScreen()
  s.dialog = { title: "Import a spreadsheet", body: html`<p>Stub: the existing CSV import flow, as a route so Back closes it.</p>` }
  return s
}

/** @returns {Screen} */
export function invitesScreen() {
  const todo = db.guests.filter((/** @type {any} */ g) => g.status === "pending")
  const body = html`<div class="callout"><button type="button" class="btn primary big" data-act="noop">Send ${plural(todo.length, "invitation")} →</button>
      <a class="btn ghost" href="${L("/invites/manual")}">Text them yourself instead</a></div>
    <ul class="worklist">${todo.map((/** @type {any} */ g) => html`<li>${raw(monogram(g.name, 30))}<div><strong>${g.name}</strong><span class="fine">${g.email || g.phone}</span></div></li>`)}</ul>`
  return withStepNav({ journey: "invite", step: "invites", title: "Invitations", body, acts: { noop: () => toast("Prototype only.") } }, true)
}

/** @returns {Screen} */
export function manualSmsScreen() {
  return withStepNav(
    {
      journey: "invite",
      step: "invites",
      title: "Text them yourself",
      heading: "Text them yourself",
      introOverride: html`<div class="intro small"><h1 tabindex="-1" id="page-h">Text them yourself</h1></div>`,
      body: html`<a class="btn ghost sm" href="${L("/invites")}" data-nav="up">← Invitations</a>
        <p>Stub: the copy-paste SMS workflow (today's Manual SMS modal), now a sub-page of Invitations.</p>`,
    },
    true,
  )
}

/** @returns {Screen} */
export function rsvpsScreen() {
  const yes = db.guests.filter((/** @type {any} */ g) => g.status === "responded" && g.attending)
  const head = yes.reduce((/** @type {number} */ n, /** @type {any} */ g) => n + g.party, 0)
  const body = html`<div class="kpis"><div><strong>${db.guests.length}</strong><span>invitations</span></div>
      <div><strong>${db.guests.filter((/** @type {any} */ g) => g.status === "responded").length}</strong><span>replied</span></div>
      <div><strong>${head}</strong><span>people coming</span></div></div>
    <p class="fine">These four numbers used to sit above every tab. They only matter before the wedding, so they live here now.</p>`
  return withStepNav({ journey: "invite", step: "rsvps", title: "RSVPs", body }, true)
}

/** @param {string} tab @returns {Screen} */
export function requestsScreen(tab) {
  const body = html`<div class="seg" role="tablist"><a role="tab" href="${L("/requests")}" data-nav="replace" class="${tab === "pending" ? "on" : ""}" aria-selected="${tab === "pending"}">Requests</a>
      <a role="tab" href="${L("/requests/blocked")}" data-nav="replace" class="${tab === "blocked" ? "on" : ""}" aria-selected="${tab === "blocked"}">Blocked</a></div>
    ${tab === "blocked"
      ? html`<p>Stub: the old Blocklist tab, folded in here — it only exists to stop repeat invitation requests.</p>`
      : html`<p class="fine">No invitation requests waiting.</p>`}`
  return withStepNav({ journey: "invite", step: "requests", title: "Invitation requests", body }, true)
}

// ---------------- site ----------------

/** @type {{ welcomeHeading: string, welcomeIntro: string, dirty: boolean } | null} */
let siteDraft = null

/** @param {Ctx} ctx @param {string} tab @returns {Screen} */
export function siteScreen(ctx, tab) {
  if (!siteDraft) siteDraft = { ...db.site, dirty: false }
  const d = /** @type {{ welcomeHeading: string, welcomeIntro: string, dirty: boolean }} */ (siteDraft)
  const doSave = () => {
    db.site = { welcomeHeading: d.welcomeHeading, welcomeIntro: d.welcomeIntro }
    d.dirty = false
    save()
  }
  const tabs = html`<div class="seg" role="tablist"><a role="tab" href="${L("/site")}" class="${tab === "content" ? "on" : ""}" aria-selected="${tab === "content"}">Words &amp; pictures</a>
    <a role="tab" href="${L("/site/effects")}" class="${tab === "effects" ? "on" : ""}" aria-selected="${tab === "effects"}">Look &amp; effects</a></div>`
  const body =
    tab === "effects"
      ? html`${tabs}<p>Stub: the Effects tab (theme + per-effect settings), now a sibling of the content editor.</p>`
      : html`${tabs}<div class="form wide-form">
          <label for="sc-h">Welcome heading <span class="fine">(after the wedding)</span></label>
          <input id="sc-h" value="${d.welcomeHeading}">
          <label for="sc-i">Welcome text</label>
          <textarea id="sc-i" rows="3">${d.welcomeIntro}</textarea>
          <p class="save-state ${d.dirty ? "dirty" : ""}" role="status">${d.dirty ? "Unsaved changes — try leaving this page, or pressing Back" : "Saved"}</p>
        </div>`
  return {
    tool: tab === "effects" ? "effects" : "site",
    title: tab === "effects" ? "Look & effects" : "Words & pictures",
    heading: "Your site",
    body,
    abRight:
      tab === "content"
        ? html`<button type="button" class="btn primary big" data-act="save">Save changes</button>`
        : undefined,
    guard: { what: "your site's words", dirty: () => !!siteDraft && siteDraft.dirty, save: doSave, discard: () => {
      siteDraft = null
    } },
    acts: {
      save: () =>
        withSession("Your site · Words & pictures", () => {
          doSave()
          toast("Saved. The site is updated.")
          ctx.refresh()
        }),
    },
    mount: (root) => {
      for (const id of ["sc-h", "sc-i"]) {
        const el = root.querySelector("#" + id)
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) continue
        el.addEventListener("input", () => {
          if (id === "sc-h") d.welcomeHeading = el.value
          else d.welcomeIntro = el.value
          d.dirty = true
          const st = root.querySelector(".save-state")
          if (st) {
            st.textContent = "Unsaved changes — try leaving this page, or pressing Back"
            st.classList.add("dirty")
          }
        })
      }
    },
  }
}
