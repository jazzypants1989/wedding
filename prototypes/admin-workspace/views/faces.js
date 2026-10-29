/** @file Name faces — a four-step walk (Groups → Quick questions → Same
 *  moment → Leftovers) instead of seven stacked sections, with People and
 *  History as reference tabs beside it.
 *
 *  Groups is three panes: the queue of groups | the faces in the selected
 *  group | who it is. THE URL NAMES A FACE, NOT A GROUP:
 *  /faces/groups/f1207 means "the group that face 1207 is in, with 1207 on
 *  the stage". Groups are recomputed on every load, so an index ("group 3")
 *  points somewhere different tomorrow; a face id never does. A face that has
 *  since been named resolves to a "this is now Rosa" card, never a 404. */

import { href, esc, actions, hooks, mBack, kbd, toast, withSession, wide } from "../ui.js"
import { store, person, groupOfFace, groupsLeft, askLeft, propsLeft, leftoversLeft, ago } from "../data.js"
import { faceSvg, avatarSvg, photoSvg, icon } from "../art.js"

/** Faces the admin left out of a group before naming it, by group key. */
/** @type {Map<string, Set<number>>} */
const excluded = new Map()
/** @param {string} key */
function excl(key) {
  let s = excluded.get(key)
  if (!s) {
    s = new Set()
    excluded.set(key, s)
  }
  return s
}

/** The faces a group-confirm would name. */
function nameable(/** @type {any} */ g) {
  const ex = excl(g.key)
  return g.faces.filter((/** @type {any} */ f) => !f.setAside && !ex.has(f.id))
}

// ------------------------------------------------------------------ chrome

/** @param {string} on */
function facesHeader(on) {
  const steps = [
    { k: "groups", label: "Groups", n: groupsLeft().length, to: "/faces/groups" },
    { k: "ask", label: "Quick questions", n: askLeft().length, to: "/faces/ask" },
    { k: "same-moment", label: "Same moment", n: propsLeft().length, to: "/faces/same-moment" },
    { k: "leftovers", label: "Leftovers", n: leftoversLeft().length, to: "/faces/leftovers" },
  ]
  return `<header class="faces-head">
    <ol class="flow" aria-label="Naming faces, step by step">
      ${steps
        .map(
          (s, i) => `<li><a href="${href(s.to)}" class="${s.n === 0 ? "is-done" : ""}" ${on === s.k ? 'aria-current="step"' : ""}>
          <span class="flow-n" aria-hidden="true">${s.n === 0 ? icon("check") : i + 1}</span>
          <span class="flow-label">${s.label}</span>${s.n ? `<span class="count">${s.n}</span>` : ""}</a></li>`,
        )
        .join("")}
    </ol>
    <nav class="faces-ref" aria-label="Reference">
      <a href="${href("/faces/people")}" ${on === "people" ? 'aria-current="page"' : ""}>People</a>
      <a href="${href("/faces/history")}" ${on === "history" ? 'aria-current="page"' : ""}>History</a>
    </nav>
  </header>`
}

/** People / History for phones, where the header has no room for them. */
function refLinks() {
  return `<nav class="phone-only" aria-label="Reference"><a href="${href("/faces/people")}">People</a><a href="${href("/faces/history")}">History</a></nav>`
}

/** The next step's call to action, shown when a step runs dry. @param {string} after */
function nextStep(after) {
  const order = [
    ["groups", "/faces/groups", "Name the groups", () => groupsLeft().length],
    ["ask", "/faces/ask", "Answer quick questions", () => askLeft().length],
    ["same-moment", "/faces/same-moment", "Confirm same-moment matches", () => propsLeft().length],
    ["leftovers", "/faces/leftovers", "Check the leftovers", () => leftoversLeft().length],
  ]
  const i = order.findIndex((o) => o[0] === after)
  const next = order.slice(i + 1).find((o) => /** @type {() => number} */ (o[3])() > 0)
  if (!next) {
    return `<div class="done-state"><div class="done-icon">${icon("check")}</div><h2>Everyone has a name</h2>
      <p>That's every face the camera found. New uploads will add new groups here.</p>
      <a class="btn btn-primary btn-lg" href="${href("/cards")}">Next: thank-you cards →</a></div>`
  }
  const n = /** @type {() => number} */ (next[3])()
  return `<div class="done-state"><div class="done-icon">${icon("check")}</div><h2>Step done</h2>
    <a class="btn btn-primary btn-lg" href="${href(/** @type {string} */ (next[1]))}">Next: ${esc(next[2])} (${n}) →</a></div>`
}

// ------------------------------------------------------------- the picker

/**
 * "Who is this?" — shared by Groups and Quick questions.
 * @param {{ suggestions: Array<{ personId: number, note: string }>, count: number, kind: string, id: string }} o
 */
function pickerMarkup(o) {
  const top = o.suggestions[0]
  const p = top ? person(top.personId) : null
  const others = o.suggestions.slice(top && o.kind === "group" ? 1 : 0)
  const facesWord = o.count === 1 ? "face" : `${o.count} faces`
  const primary = p && o.kind === "group"
    ? `<div class="suggest">
        <span class="avatar avatar-lg">${avatarSvg(p)}</span>
        <div><span class="eyebrow">Looks like</span><h2>${esc(p.name)}</h2><span class="muted">${esc(top.note)}</span></div>
      </div>
      <button class="btn btn-primary btn-lg btn-block" data-action="fx-assign" data-kind="${o.kind}" data-id="${o.id}" data-person="${p.id}" data-autofocus>
        Yes, name ${facesWord} ${esc(p.name.split(" ")[0])} ${kbd("Enter")}</button>`
    : o.kind === "group"
      ? `<div class="suggest suggest-none"><h2>Who is this?</h2><span class="muted">No confident match yet — the first time you name someone, they start getting suggested.</span></div>`
      : `<h2 class="picker-q">Who is this?</h2>`
  const cand = others.length
    ? `<ol class="cands">${others
        .map((s, i) => {
          const cp = person(s.personId)
          if (!cp) return ""
          return `<li><button class="cand" data-action="fx-assign" data-kind="${o.kind}" data-id="${o.id}" data-person="${cp.id}">
            ${kbd(String(i + 1))}<span class="avatar">${avatarSvg(cp)}</span><span><strong>${esc(cp.name)}</strong><br><span class="muted">${esc(s.note)}</span></span></button></li>`
        })
        .join("")}</ol>`
    : ""
  return `<div class="picker">
    ${primary}
    ${cand ? `<p class="picker-label">${o.kind === "group" ? "Or one of these" : "Best guesses"}</p>${cand}` : ""}
    <div class="someone">
      <label class="picker-label" for="who">Someone else ${kbd("/")}</label>
      <input id="who" type="search" autocomplete="off" placeholder="Type a name…" data-kind="${o.kind}" data-id="${o.id}">
      <ul class="who-list" id="who-list"></ul>
    </div>
    <div class="picker-minor">
      <button class="btn btn-sm btn-ghost" data-action="fx-notface" data-kind="${o.kind}" data-id="${o.id}">Not a face</button>
      <button class="btn btn-sm btn-ghost" data-action="fx-skip" data-kind="${o.kind}" data-id="${o.id}">Skip for now ${kbd("s")}</button>
    </div>
    <p class="fine muted">Nothing here is final. Every naming can be undone from <a href="${href("/faces/history")}">History</a>.</p>
  </div>`
}

/** Live-filter the "someone else" list. Wired in mount(). */
function wireWho() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("who"))
  const list = document.getElementById("who-list")
  if (!input || !list) return
  const draw = () => {
    const q = input.value.trim().toLowerCase()
    if (!q) {
      list.innerHTML = ""
      return
    }
    const hits = store.people.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6)
    const exact = store.people.some((p) => p.name.toLowerCase() === q)
    list.innerHTML =
      hits
        .map(
          (p) => `<li><button class="who" data-action="fx-assign" data-kind="${input.dataset.kind}" data-id="${input.dataset.id}" data-person="${p.id}">
          <span class="avatar">${avatarSvg(p)}</span>${esc(p.name)}<span class="muted">${p.faces} faces</span></button></li>`,
        )
        .join("") +
      (exact
        ? ""
        : `<li><button class="who who-new" data-action="fx-new" data-kind="${input.dataset.kind}" data-id="${input.dataset.id}" data-name="${esc(input.value.trim())}">+ New person “${esc(input.value.trim())}”</button></li>`)
  }
  input.addEventListener("input", draw)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const first = /** @type {HTMLElement | null} */ (list.querySelector("button"))
      if (first) first.click()
      e.preventDefault()
    }
  })
}

// ------------------------------------------------------------------ groups

/** @param {any} g */
function groupRow(g, /** @type {number | null} */ currentFace) {
  const on = currentFace !== null && g.faces.some((/** @type {any} */ f) => f.id === currentFace)
  const s = g.suggestion ? person(g.suggestion.personId) : null
  const live = g.faces.filter((/** @type {any} */ f) => !f.setAside)
  return `<li><a class="row grow" href="${href("/faces/groups/f" + g.faces[0].id)}" data-select ${on ? 'aria-current="true"' : ""}>
    <span class="chips4">${live.slice(0, 4).map((/** @type {any} */ f) => `<span class="chip-face">${faceSvg(f)}</span>`).join("")}</span>
    <span class="row-main"><span class="row-top"><strong>${s ? esc(s.name) + "?" : "Who is this?"}</strong></span>
      <span class="row-sub">${g.faces.length} faces${g.faces.length - live.length ? ` · ${g.faces.length - live.length} unclear` : ""}</span></span>
  </a></li>`
}

/** @param {number | null} currentFace */
function groupsList(currentFace) {
  const left = groupsLeft()
  const done = store.groups.filter((g) => g.done)
  return `<header class="pane-head pane-head-tight"><h2>${left.length} groups to name</h2>
      <p class="muted small">Biggest first. Each group is faces the computer thinks are one person — check before you confirm.</p>${refLinks()}</header>
    <ul class="rows">${left.map((g) => groupRow(g, currentFace)).join("") || `<li class="list-empty">All groups named.</li>`}</ul>
    ${done.length ? `<h3 class="rows-heading">Named</h3><ul class="rows rows-done">${done
      .map((g) => {
        const p = person(g.done.personId)
        return `<li><a class="row grow" href="${href("/faces/groups/f" + g.faces[0].id)}" data-select ${currentFace !== null && g.faces.some((/** @type {any} */ f) => f.id === currentFace) ? 'aria-current="true"' : ""}>
          <span class="chip-face">${faceSvg(g.faces[0])}</span><span class="row-main"><span class="row-top">${icon("check")} <strong>${esc(p ? p.name : "Not a face")}</strong></span><span class="row-sub">${g.done.count} faces</span></span></a></li>`
      })
      .join("")}</ul>` : ""}`
}

/** @param {any} g @param {any} f */
function stageMarkup(g, f) {
  const left = groupsLeft()
  const idx = left.indexOf(g)
  const ex = excl(g.key)
  const n = nameable(g).length
  const strip = g.faces
    .map((/** @type {any} */ x, i) => {
      const state = x.setAside ? "unclear" : ex.has(x.id) ? "out" : ""
      return `<li><a href="${href("/faces/groups/f" + x.id)}" data-replace class="strip-face ${state ? "is-" + state : ""}" ${x.id === f.id ? 'aria-current="true"' : ""}
        aria-label="Face ${i + 1} of ${g.faces.length}${state === "out" ? ", left out" : state === "unclear" ? ", unclear — name it on its own" : ""}">${faceSvg(x)}
        ${state === "out" ? `<span class="strip-badge">out</span>` : state === "unclear" ? `<span class="strip-badge">unclear</span>` : ""}</a></li>`
    })
    .join("")
  const fi = g.faces.indexOf(f)
  return `${mBack("/faces/groups", "Groups")}
    <div class="stage">
      <header class="stage-head">
        <span class="eyebrow">Group ${idx + 1} of ${left.length} · ${g.faces.length} faces</span>
        <nav class="stepper-mini" aria-label="Groups">
          ${left[idx - 1] ? `<a href="${href("/faces/groups/f" + left[idx - 1].faces[0].id)}" data-select aria-label="Previous group (k)">↑</a>` : `<span aria-hidden="true">↑</span>`}
          ${left[idx + 1] ? `<a href="${href("/faces/groups/f" + left[idx + 1].faces[0].id)}" data-select aria-label="Next group (j)">↓</a>` : `<span aria-hidden="true">↓</span>`}
        </nav>
      </header>
      <figure class="stage-face ${ex.has(f.id) ? "is-out" : ""}">${faceSvg(f, "Face " + (fi + 1))}
        <figcaption>
          <span>Face ${fi + 1} of ${g.faces.length}</span>
          <span class="stage-tools">
            <a href="${href("/faces/photos/m" + f.mediaId)}">Open photo</a>
            ${f.setAside ? `<span class="muted">Unclear — name it from the photo</span>` : `<button class="linklike" data-action="fx-exclude" data-face="${f.id}">${ex.has(f.id) ? "Put back in" : "Not the same person"} ${kbd("e")}</button>`}
          </span>
        </figcaption>
      </figure>
      <ol class="strip" aria-label="Every face in this group">${strip}</ol>
      <p class="muted small strip-help"><span class="kbd-hint">${kbd("←")} ${kbd("→")} step through. </span>Scan for anyone who doesn't belong and leave them out — confirming names <strong>${n}</strong>.</p>
    </div>`
}

/** @param {any} g */
function namedStage(g) {
  const p = g.done.personId ? person(g.done.personId) : null
  return `${mBack("/faces/groups", "Groups")}<div class="done-state">
    <span class="chip-face chip-face-lg">${faceSvg(g.faces[0])}</span>
    <h2>${p ? `Named ${esc(p.name)}` : "Marked not a face"}</h2>
    <p>${g.done.count} faces, ${ago(1)}.</p>
    <p><button class="btn" data-action="fx-undo-group" data-key="${g.key}">Undo</button>
    ${groupsLeft().length ? `<a class="btn btn-primary" href="${href("/faces/groups/f" + groupsLeft()[0].faces[0].id)}" data-select>Next group →</a>` : ""}</p>
  </div>`
}

/** @param {any} ctx */
function groupsView(ctx) {
  const faceParam = ctx.params.face
  const faceId = faceParam ? Number(faceParam.slice(1)) : null
  const left = groupsLeft()
  if (faceId === null) {
    if (wide() && left.length) return { redirect: "/faces/groups/f" + left[0].faces[0].id }
  }
  const g = faceId !== null ? groupOfFace(faceId) : null
  const f = g ? g.faces.find((/** @type {any} */ x) => x.id === faceId) : null
  let stage = ""
  let picker = ""
  if (!g) {
    stage = left.length ? `<div class="detail-empty">${faceId ? "That face isn't in any group any more." : "Pick a group."}</div>` : nextStep("groups")
  } else if (g.done) {
    stage = namedStage(g)
  } else {
    stage = stageMarkup(g, f)
    const sug = g.suggestion
      ? [{ personId: g.suggestion.personId, note: g.suggestion.margin >= 0.15 ? "Strong match" : "Close call — check the faces below" }]
      : []
    const extra = store.people.filter((p) => !sug.some((s) => s.personId === p.id)).slice(g.key.length, g.key.length + 2)
    picker = pickerMarkup({
      suggestions: sug.concat(extra.map((p) => ({ personId: p.id, note: "Similar" }))),
      count: nameable(g).length,
      kind: "group",
      id: g.key,
    })
  }
  return `${facesHeader("groups")}
    <div class="faces3 ${g ? "has-sel" : ""}">
      <section class="pane pane-list" aria-label="Groups" data-keep-scroll="list">${groupsList(faceId)}</section>
      <section class="pane pane-stage" aria-label="Faces in this group">${stage}</section>
      ${picker ? `<section class="pane pane-picker" aria-label="Who is this?">${picker}</section>` : ""}
    </div>`
}

/** @param {any} g */
function nextGroupAfter(g) {
  const all = store.groups
  const i = all.indexOf(g)
  return all.slice(i + 1).find((x) => !x.done) || all.find((x) => !x.done)
}

/** @param {any} g @param {number | null} personId */
function nameGroup(g, personId) {
  withSession(() => {
    const faces = nameable(g)
    const p = personId ? person(personId) : null
    g.done = { personId, count: faces.length }
    if (p) p.faces += faces.length
    const batch = { id: store.nextId++, label: p ? `Named ${faces.length} faces ${p.name}` : `Marked ${faces.length} not a face`, minutesAgo: 0, revoked: false }
    store.batches.unshift(batch)
    const undo = () => {
      g.done = null
      if (p) p.faces -= faces.length
      batch.revoked = true
      hooks.navigate("/faces/groups/f" + g.faces[0].id, { replace: true })
    }
    toast(batch.label, undo)
    const next = nextGroupAfter(g)
    hooks.navigate(next ? "/faces/groups/f" + next.faces[0].id : "/faces/groups", { replace: true })
  })
}

// ------------------------------------------------------------------- ask

/** @param {any} ctx */
function askView(ctx) {
  const faceParam = ctx.params.face
  const id = faceParam ? Number(faceParam.slice(1)) : null
  const left = askLeft()
  if (id === null && wide() && left.length) return { redirect: "/faces/ask/f" + left[0].id }
  const a = id !== null ? store.ask.find((x) => x.id === id) : null
  const rows = left
    .map((x) => {
      const c = person(x.candidates[0].personId)
      return `<li><a class="row grow" href="${href("/faces/ask/f" + x.id)}" data-select ${a === x ? 'aria-current="true"' : ""}>
      <span class="chip-face">${faceSvg(x)}</span>
      <span class="row-main"><span class="row-top"><strong>${c ? esc(c.name) + "?" : "Who?"}</strong></span>
      <span class="row-sub">Answering names ${x.unlocks} more ${x.unlocks === 1 ? "photo" : "photos"}</span></span></a></li>`
    })
    .join("")
  let detail = ""
  let picker = ""
  if (!a) detail = left.length ? `<div class="detail-empty">Pick a face.</div>` : nextStep("ask")
  else if (a.done) {
    const p = a.done.personId ? person(a.done.personId) : null
    detail = `${mBack("/faces/ask", "Questions")}<div class="done-state"><span class="chip-face chip-face-lg">${faceSvg(a)}</span><h2>${p ? "This is " + esc(p.name) : "Not a face"}</h2>
      <button class="btn" data-action="fx-undo-ask" data-id="${a.id}">Undo</button></div>`
  } else {
    const i = left.indexOf(a)
    detail = `${mBack("/faces/ask", "Questions")}<div class="stage">
      <header class="stage-head"><span class="eyebrow">Question ${i + 1} of ${left.length}</span>
        <nav class="stepper-mini" aria-label="Questions">
          ${left[i - 1] ? `<a href="${href("/faces/ask/f" + left[i - 1].id)}" data-select aria-label="Previous (k)">↑</a>` : `<span aria-hidden="true">↑</span>`}
          ${left[i + 1] ? `<a href="${href("/faces/ask/f" + left[i + 1].id)}" data-select aria-label="Next (j)">↓</a>` : `<span aria-hidden="true">↓</span>`}
        </nav></header>
      <figure class="stage-face">${faceSvg(a)}<figcaption><span>Held back because it's ${esc(a.reason)}</span>
        <span class="stage-tools"><a href="${href("/faces/photos/m" + a.mediaId)}">Open photo</a></span></figcaption></figure>
      <p class="muted small">Answering this one names it in ${a.unlocks} ${a.unlocks === 1 ? "photo" : "photos"} — that's why it's near the top.</p>
    </div>`
    picker = pickerMarkup({
      suggestions: a.candidates.map((/** @type {any} */ c, k) => ({ personId: c.personId, note: k === 0 ? "Most likely" : "Possible" })),
      count: 1,
      kind: "ask",
      id: String(a.id),
    })
  }
  return `${facesHeader("ask")}
    <div class="faces3 ${a ? "has-sel" : ""}">
      <section class="pane pane-list" aria-label="Questions" data-keep-scroll="list">
        <header class="pane-head pane-head-tight"><h2>${left.length} quick questions</h2><p class="muted small">Single faces the computer wasn't sure about, most useful first.</p>${refLinks()}</header>
        <ul class="rows">${rows || `<li class="list-empty">No questions left.</li>`}</ul></section>
      <section class="pane pane-stage">${detail}</section>
      ${picker ? `<section class="pane pane-picker" aria-label="Who is this?">${picker}</section>` : ""}
    </div>`
}

/** @param {any} a @param {number | null} personId */
function answerAsk(a, personId) {
  withSession(() => {
    a.done = { personId }
    const p = personId ? person(personId) : null
    toast(p ? `That's ${p.name}` : "Marked not a face", () => {
      a.done = null
      hooks.navigate("/faces/ask/f" + a.id, { replace: true })
    })
    const left = askLeft()
    const next = left.find((x) => x.id > a.id) || left[0]
    hooks.navigate(next ? "/faces/ask/f" + next.id : "/faces/ask", { replace: true })
  })
}

// ------------------------------------------------------------ same moment

function sameMomentView() {
  const left = propsLeft()
  if (!left.length) return facesHeader("same-moment") + `<div class="single">${nextStep("same-moment")}</div>`
  const checked = left.filter((p) => p.checked).length
  return `${facesHeader("same-moment")}
    <div class="single">
      <header class="single-head"><h1>Same moment, same person?</h1>
        <p class="muted">These faces are in near-identical shots taken a second apart from a face you already named. Untick any that look wrong, then confirm them together.</p></header>
      <ul class="pairs">${left
        .map((p) => {
          const who = person(p.personId)
          return `<li><label class="pair">
            <input type="checkbox" data-action="fx-prop-tick" data-id="${p.toFaceId}" ${p.checked ? "checked" : ""}>
            <span class="chip-face">${faceSvg({ hue: p.hue, seed: p.seed - 100 })}</span><span aria-hidden="true">→</span>
            <span class="chip-face">${faceSvg(p)}</span>
            <span><strong>${esc(who ? who.name : "?")}</strong><br><span class="muted small">named → same moment</span></span>
            <a href="${href("/faces/photos/m" + (390 + (p.toFaceId % 10)))}" class="small">Open photo</a>
          </label></li>`
        })
        .join("")}</ul>
      <div class="actionbar"><button class="btn btn-primary btn-lg" data-action="fx-prop-apply" ${checked ? "" : "disabled"}>Confirm ${checked}</button></div>
    </div>`
}

// --------------------------------------------------------------- leftovers

function leftoversView() {
  const all = store.leftovers
  const left = leftoversLeft()
  return `${facesHeader("leftovers")}
    <div class="single">
      <header class="single-head"><h1>Leftovers</h1>
        <p class="muted">Photos with faces too small, blurry or side-on to group. Open one to name its faces one at a time — or leave them unnamed; that's fine.</p></header>
      ${left.length ? "" : nextStep("leftovers")}
      <ul class="photo-grid">${all
        .map(
          (l) => `<li><a class="photo-card ${l.unnamed ? "" : "is-done"}" href="${href("/faces/photos/m" + l.mediaId)}">
          ${photoSvg(l.seed, { boxes: l.faces })}
          <span>${esc(l.caption)}</span><span class="muted small">${l.unnamed ? `${l.unnamed} of ${l.faces} unnamed` : "All named"}</span></a></li>`,
        )
        .join("")}</ul>
    </div>`
}

/** The per-photograph dialog — a route, so Back closes it. @param {any} ctx */
function photoDialog(ctx) {
  const mediaId = Number(ctx.params.media.slice(1))
  const l = store.leftovers.find((x) => x.mediaId === mediaId)
  const faces = l ? l.faces : 2
  const seed = l ? l.seed : mediaId
  const named = l ? l.faces - l.unnamed : 0
  const rows = []
  for (let i = 0; i < faces; i++) {
    const isNamed = i < named
    rows.push(`<li class="pf-row"><span class="pf-n">${i + 1}</span>
      <span class="chip-face">${faceSvg({ hue: (seed * 13 + i * 40) % 360, seed: seed + i })}</span>
      ${isNamed ? `<span><strong>${esc(store.people[(seed + i) % store.people.length].name)}</strong></span>` : `<select aria-label="Who is face ${i + 1}?" data-pf="${i}"><option value="">Who is this?</option>${store.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>`}
    </li>`)
  }
  return `<header class="dlg-head"><h2 id="dlg-title">${esc(l ? l.caption : "Photo " + mediaId)}</h2><button class="dlg-x" data-close aria-label="Close">×</button></header>
    <div class="pf">
      <figure class="pf-photo">${photoSvg(seed, { boxes: faces })}</figure>
      <ol class="pf-list">${rows.join("")}</ol>
    </div>
    <footer class="dlg-actions"><span class="muted small">Back button closes this.</span>
      <button class="btn" data-close>Close</button>
      ${l && l.unnamed ? `<button class="btn btn-primary" data-action="fx-photo-save" data-media="${mediaId}">Save names</button>` : ""}
    </footer>`
}

// ------------------------------------------------------------ people/history

/** @param {any} ctx */
function peopleView(ctx) {
  const id = ctx.params.person ? Number(ctx.params.person.slice(1)) : null
  if (id === null && wide()) return { redirect: "/faces/people/p" + store.people[0].id }
  const p = id !== null ? person(id) : null
  const list = `<header class="pane-head pane-head-tight"><h2>${store.people.length} people</h2><p class="muted small">Everyone who's been named in a photo. A person can be linked to a guest, but doesn't have to be.</p></header>
    <ul class="rows">${store.people
      .map(
        (x) => `<li><a class="row" href="${href("/faces/people/p" + x.id)}" data-select ${x === p ? 'aria-current="true"' : ""}>
        <span class="avatar">${avatarSvg(x)}</span><span class="row-main"><span class="row-top"><strong>${esc(x.name)}</strong><span class="row-time">${x.faces}</span></span>
        <span class="row-sub">${x.guestId ? "On the guest list" : "Not a guest"}</span></span></a></li>`,
      )
      .join("")}</ul>`
  const detail = p
    ? `${mBack("/faces/people", "People")}<article class="detail">
      <header class="person-head"><span class="avatar avatar-xl">${avatarSvg(p)}</span><div><h1>${esc(p.name)}</h1>
      <p class="muted">${p.faces} faces · ${p.guestId ? "Linked to guest #" + p.guestId : "Not linked to a guest"}</p></div></header>
      <div class="btn-row"><button class="btn btn-sm">Rename</button><button class="btn btn-sm">Merge into…</button><button class="btn btn-sm">${p.guestId ? "Unlink guest" : "Link to a guest"}</button></div>
      <ul class="face-grid">${Array.from({ length: Math.min(p.faces, 18) }, (_, i) => `<li><span class="chip-face">${faceSvg({ hue: p.hue, seed: p.id * 50 + i })}</span></li>`).join("")}</ul>
    </article>`
    : `<div class="detail-empty">Pick a person.</div>`
  return facesHeader("people") + `<div class="split ${p ? "has-sel" : ""}"><section class="pane pane-list" data-keep-scroll="list">${list}</section><section class="pane pane-detail">${detail}</section></div>`
}

function historyView() {
  return `${facesHeader("history")}
    <div class="single">
      <header class="single-head"><h1>History</h1><p class="muted">Each confirm is one entry. Undoing one takes back exactly what it named — nothing is deleted, and any fixes you made afterwards stay.</p></header>
      <ul class="history">${store.batches
        .map(
          (b) => `<li class="${b.revoked ? "is-revoked" : ""}"><span><strong>${esc(b.label)}</strong><br><span class="muted small">${b.minutesAgo ? ago(b.minutesAgo) : "just now"}</span></span>
          ${b.revoked ? `<span class="muted">Undone</span>` : `<button class="btn btn-sm" data-action="fx-revoke" data-id="${b.id}">Undo this</button>`}</li>`,
        )
        .join("")}</ul>
    </div>`
}

// ----------------------------------------------------------------- actions

actions["fx-assign"] = (el) => {
  const kind = el.dataset.kind
  const pid = Number(el.dataset.person)
  if (kind === "group") {
    const g = store.groups.find((x) => x.key === el.dataset.id)
    if (g) nameGroup(g, pid)
  } else {
    const a = store.ask.find((x) => x.id === Number(el.dataset.id))
    if (a) answerAsk(a, pid)
  }
}
actions["fx-new"] = (el) => {
  const name = el.dataset.name || ""
  if (!name) return
  const p = { id: store.nextId++, name, hue: (store.nextId * 37) % 360, guestId: null, faces: 0 }
  store.people.push(p)
  el.dataset.person = String(p.id)
  actions["fx-assign"](el, new Event("click"))
}
actions["fx-notface"] = (el) => {
  if (el.dataset.kind === "group") {
    const g = store.groups.find((x) => x.key === el.dataset.id)
    if (g) nameGroup(g, null)
  } else {
    const a = store.ask.find((x) => x.id === Number(el.dataset.id))
    if (a) answerAsk(a, null)
  }
}
actions["fx-skip"] = (el) => {
  if (el.dataset.kind === "group") {
    const g = store.groups.find((x) => x.key === el.dataset.id)
    const next = g ? nextGroupAfter(g) : null
    if (next) hooks.navigate("/faces/groups/f" + next.faces[0].id, { replace: true })
  } else {
    const left = askLeft()
    const id = Number(el.dataset.id)
    const next = left.find((x) => x.id > id) || left[0]
    if (next) hooks.navigate("/faces/ask/f" + next.id, { replace: true })
  }
}
actions["fx-exclude"] = (el) => {
  const id = Number(el.dataset.face)
  const g = groupOfFace(id)
  if (!g) return
  const s = excl(g.key)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  hooks.rerender()
}
actions["fx-undo-group"] = (el) => {
  const g = store.groups.find((x) => x.key === el.dataset.key)
  if (!g || !g.done) return
  const p = g.done.personId ? person(g.done.personId) : null
  if (p) p.faces -= g.done.count
  g.done = null
  toast("Undone — group is back in the queue")
  hooks.rerender()
}
actions["fx-undo-ask"] = (el) => {
  const a = store.ask.find((x) => x.id === Number(el.dataset.id))
  if (a) a.done = null
  hooks.rerender()
}
actions["fx-prop-tick"] = (el) => {
  const p = store.propagations.find((x) => x.toFaceId === Number(el.dataset.id))
  if (p) p.checked = !p.checked
  hooks.rerender()
}
actions["fx-prop-apply"] = () => {
  withSession(() => {
    const items = propsLeft().filter((p) => p.checked)
    for (const p of items) p.applied = true
    const batch = { id: store.nextId++, label: `Same moment: ${items.length} faces`, minutesAgo: 0, revoked: false }
    store.batches.unshift(batch)
    toast(batch.label, () => {
      for (const p of items) p.applied = false
      batch.revoked = true
    })
    hooks.rerender()
  })
}
actions["fx-photo-save"] = (el) => {
  withSession(() => {
    const l = store.leftovers.find((x) => x.mediaId === Number(el.dataset.media))
    const picks = Array.from(document.querySelectorAll("select[data-pf]")).filter((s) => /** @type {HTMLSelectElement} */ (s).value).length
    if (l) l.unnamed = Math.max(0, l.unnamed - picks)
    toast(picks ? `Named ${picks} ${picks === 1 ? "face" : "faces"}` : "Nothing to save")
    hooks.up("/faces/leftovers")
  })
}
actions["fx-revoke"] = (el) => {
  const b = store.batches.find((x) => x.id === Number(el.dataset.id))
  if (!b) return
  withSession(() => {
    b.revoked = true
    const g = store.groups.find((x) => x.done && b.label.endsWith(person(x.done.personId || 0)?.name || "~"))
    if (g) g.done = null
    toast("Undone. Later corrections were kept.")
    hooks.rerender()
  })
}

// ------------------------------------------------------------------ keys

/** @param {KeyboardEvent} e @param {any} ctx */
function groupKeys(e, ctx) {
  const id = ctx.params.face ? Number(ctx.params.face.slice(1)) : null
  const g = id !== null ? groupOfFace(id) : null
  const left = groupsLeft()
  if (e.key === "/") {
    document.getElementById("who")?.focus()
    return true
  }
  if (e.key === "j" || e.key === "k") {
    const i = g ? left.indexOf(g) : -1
    const to = e.key === "j" ? left[i + 1] || (i < 0 ? left[0] : null) : left[i - 1]
    if (to) hooks.navigate("/faces/groups/f" + to.faces[0].id, { replace: !!g })
    return true
  }
  if (!g || g.done) return false
  const fi = g.faces.findIndex((/** @type {any} */ f) => f.id === id)
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const nf = g.faces[fi + (e.key === "ArrowRight" ? 1 : -1)]
    if (nf) hooks.navigate("/faces/groups/f" + nf.id, { replace: true })
    return true
  }
  if (e.key === "e") {
    const b = /** @type {HTMLElement | null} */ (document.querySelector('[data-action="fx-exclude"]'))
    if (b) b.click()
    return true
  }
  if (e.key === "s") {
    const b = /** @type {HTMLElement | null} */ (document.querySelector('[data-action="fx-skip"]'))
    if (b) b.click()
    return true
  }
  if (e.key === "Enter" && g.suggestion) {
    nameGroup(g, g.suggestion.personId)
    return true
  }
  const n = Number(e.key)
  if (n >= 1 && n <= 3) {
    const b = /** @type {HTMLElement | null} */ (document.querySelectorAll(".cands .cand")[n - 1])
    if (b) b.click()
    return true
  }
  return false
}

/** @param {KeyboardEvent} e @param {any} ctx */
function askKeys(e, ctx) {
  const id = ctx.params.face ? Number(ctx.params.face.slice(1)) : null
  const left = askLeft()
  const a = id !== null ? store.ask.find((x) => x.id === id) : null
  if (e.key === "/") {
    document.getElementById("who")?.focus()
    return true
  }
  if (e.key === "j" || e.key === "k") {
    const i = a ? left.indexOf(a) : -1
    const to = e.key === "j" ? left[i + 1] || (i < 0 ? left[0] : null) : left[i - 1]
    if (to) hooks.navigate("/faces/ask/f" + to.id, { replace: !!a })
    return true
  }
  if (!a || a.done) return false
  if (e.key === "s") {
    const b = /** @type {HTMLElement | null} */ (document.querySelector('[data-action="fx-skip"]'))
    if (b) b.click()
    return true
  }
  const n = Number(e.key)
  if ((n >= 1 && n <= 3) || e.key === "Enter") {
    const b = /** @type {HTMLElement | null} */ (document.querySelectorAll(".cands .cand")[e.key === "Enter" ? 0 : n - 1])
    if (b) b.click()
    return true
  }
  return false
}

// ------------------------------------------------------------------ routes

const crumbBase = [{ label: "Memories" }, { label: "Name faces", to: "/faces" }]

/** @param {any} ctx */
function groupCrumb(ctx) {
  const id = ctx.params.face ? Number(ctx.params.face.slice(1)) : null
  const g = id !== null ? groupOfFace(id) : null
  const c = [...crumbBase, { label: "Groups", to: "/faces/groups" }]
  if (g) {
    const s = g.done && g.done.personId ? person(g.done.personId) : g.suggestion ? person(g.suggestion.personId) : null
    c.push({ label: (s ? s.name + (g.done ? "" : "?") : "Unknown") + " · face " + id })
  }
  return c
}

function firstUnfinished() {
  if (groupsLeft().length) return "/faces/groups"
  if (askLeft().length) return "/faces/ask"
  if (propsLeft().length) return "/faces/same-moment"
  return "/faces/leftovers"
}

/** @type {any[]} */
export const facesRoutes = [
  { pattern: "/faces", section: "faces", title: () => "Name faces", render: () => ({ redirect: firstUnfinished() }) },
  { pattern: "/faces/groups", section: "faces", sel: "face", title: () => "Groups · Name faces", crumbs: groupCrumb, render: groupsView, mount: wireWho, keys: groupKeys },
  {
    pattern: "/faces/groups/:face",
    section: "faces",
    sel: "face",
    title: (/** @type {any} */ ctx) => `Face ${ctx.params.face.slice(1)} · Groups`,
    crumbs: groupCrumb,
    render: groupsView,
    mount: wireWho,
    keys: groupKeys,
  },
  { pattern: "/faces/ask", section: "faces", sel: "face", title: () => "Quick questions", crumbs: () => [...crumbBase, { label: "Quick questions" }], render: askView, mount: wireWho, keys: askKeys },
  {
    pattern: "/faces/ask/:face",
    section: "faces",
    sel: "face",
    title: () => "Quick question",
    crumbs: (/** @type {any} */ ctx) => [...crumbBase, { label: "Quick questions", to: "/faces/ask" }, { label: "Face " + ctx.params.face.slice(1) }],
    render: askView,
    mount: wireWho,
    keys: askKeys,
  },
  { pattern: "/faces/same-moment", section: "faces", title: () => "Same moment", crumbs: () => [...crumbBase, { label: "Same moment" }], render: sameMomentView },
  { pattern: "/faces/leftovers", section: "faces", title: () => "Leftovers", crumbs: () => [...crumbBase, { label: "Leftovers" }], render: leftoversView },
  {
    pattern: "/faces/photos/:media",
    section: "faces",
    title: () => "Photo",
    parent: (/** @type {any} */ ctx) => (ctx.prev && ctx.prev.startsWith("/faces") && !ctx.prev.startsWith("/faces/photos") ? ctx.prev : "/faces/leftovers"),
    render: photoDialog,
  },
  { pattern: "/faces/people", section: "faces", sel: "person", title: () => "People", crumbs: () => [...crumbBase, { label: "People" }], render: peopleView },
  {
    pattern: "/faces/people/:person",
    section: "faces",
    sel: "person",
    title: (/** @type {any} */ ctx) => person(Number(ctx.params.person.slice(1)))?.name || "Person",
    crumbs: (/** @type {any} */ ctx) => [...crumbBase, { label: "People", to: "/faces/people" }, { label: person(Number(ctx.params.person.slice(1)))?.name || "?" }],
    render: peopleView,
  },
  { pattern: "/faces/history", section: "faces", title: () => "History", crumbs: () => [...crumbBase, { label: "History" }], render: historyView },
]
