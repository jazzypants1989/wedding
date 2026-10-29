/** @file Faces as a series of small, finishable tasks (IA.md §4.2).
 *
 *  Overview is a numbered progression (1 name groups → 2 quick confirms →
 *  3 same moment → 4 set aside), because that IS the dependency order: naming
 *  groups is what makes the Ask queue able to guess. Every group and every ask
 *  item is addressed by a FACE ID it contains (`/faces/groups/f1203`), never
 *  by its position, so links survive re-clustering. */

import {
  state,
  save,
  logDone,
  unnamedGroups,
  openAsk,
  openMoments,
  facesNamed,
  guestById,
} from "./data.js"
import { route, navigate, setQuery, href, returnTo } from "./router.js"
import { faceSvg, photoSvg, avatar } from "./art.js"
import { esc, icon, toast, meter, ring, flowBar, wireFlowExit, act, kbd, rerender, plural } from "./ui.js"

/** Group-local exclusions: view state, like the real tab's excludedByGroup. */
/** @type {Map<number, Set<number>>} */
const excluded = new Map()

function subnav(active) {
  const items = [
    ["overview", "/faces", "Overview"],
    ["groups", "/faces/groups", `Groups <span class="count">${unnamedGroups().length}</span>`],
    ["ask", "/faces/ask", `Quick confirms <span class="count">${openAsk().length}</span>`],
    ["moments", "/faces/moments", `Same moment <span class="count">${openMoments().length}</span>`],
    ["setaside", "/faces/set-aside", "Set aside"],
    ["people", "/faces/people", "People"],
    ["history", "/faces/history", "History"],
  ]
  return `<nav class="subnav" aria-label="Faces">${items
    .map(([k, to, label]) => `<a href="${href(to)}" class="${k === active ? "is-on" : ""}" ${k === active ? 'aria-current="page"' : ""}>${label}</a>`)
    .join("")}</nav>`
}

/** Find the group that currently contains a face — the stable-anchor lookup
 *  (server: GET /api/admin/faces/groups/by-face/:id). */
function groupByFace(faceId) {
  return state.groups.find((g) => g.faces.some((f) => f.id === faceId)) || null
}

function assignable(g) {
  const ex = excluded.get(g.anchor) || new Set()
  return g.faces.filter((f) => !f.setAside && !ex.has(f.id))
}

function personByName(name) {
  const n = name.trim().toLowerCase()
  return state.people.find((p) => p.name.toLowerCase() === n) || null
}

function peopleDatalist() {
  return `<datalist id="people-roster">${state.people.map((p) => `<option value="${esc(p.name)}"></option>`).join("")}</datalist>`
}

// ---- overview ---------------------------------------------------------------

route("/faces", {
  nav: "faces",
  title: () => "Faces",
  render() {
    const named = facesNamed()
    const groups = unnamedGroups()
    const ask = openAsk()
    const moments = openMoments()
    const step = (n, title, why, count, to, cta, done) => `<li class="fstep ${done ? "is-done" : ""}">
      <span class="fstep-n">${done ? icon("check", 18) : n}</span>
      <div class="fstep-main"><h3>${title}</h3><p class="muted">${why}</p></div>
      <div class="fstep-go">${done ? `<span class="muted">Done</span>` : `<a class="btn ${n === 1 ? "btn-primary" : "btn-secondary"}" href="${href(to)}">${cta} ${icon("next", 16)}</a><span class="muted">${count}</span>`}</div>
    </li>`
    return `<div class="page">
      <header class="page-head row">
        <div><p class="eyebrow">Memories</p><h1>Faces</h1>
        <p class="lede">Put a name to everyone in the photos, so guests can find themselves. Work top to bottom — each step makes the next one smarter.</p></div>
        <div class="faces-ring">${ring(named, state.facesTotal, 84)}<span class="muted">${named} of ${state.facesTotal}<br>faces named</span></div>
      </header>
      ${subnav("overview")}
      <ol class="fsteps">
        ${step(1, "Name the groups", "Faces the matcher thinks are one person. Check the strip, name them all at once.", plural(groups.length, "group"), groups.length ? `/faces/groups/f${groups[0].anchor}?set=${Math.min(5, groups.length)}` : "/faces/groups", "Name the next 5", !groups.length)}
        ${step(2, "Quick confirms", "One face, a best guess or two. Press 1 or 2. Gets better with every group you name.", plural(ask.length, "face"), ask.length ? `/faces/ask/f${ask[0].id}` : "/faces/ask", "Start", !ask.length)}
        ${step(3, "Same moment", "Burst shots of someone already named. Accept them in one go.", plural(moments.length, "batch", "batches"), "/faces/moments", "Look over", !moments.length)}
        ${step(4, "Set aside", "Faces too small or soft to name from a list. Open the photo and decide one by one.", plural(state.setAside.length, "photo"), "/faces/set-aside", "Open", !state.setAside.length)}
      </ol>
      <p class="muted small">Named someone wrong? <a href="${href("/faces/history")}">History</a> undoes a whole pass and keeps the corrections you made after it.</p>
    </div>`
  },
})

// ---- groups list --------------------------------------------------------------

function orderedGroups(order) {
  const gs = unnamedGroups()
  return order === "small" ? [...gs].reverse() : gs
}

route("/faces/groups", {
  nav: "faces",
  title: () => "Face groups",
  render(ctx) {
    const order = ctx.query.get("order") || "big"
    const gs = orderedGroups(order)
    return `<div class="page">
      <header class="page-head"><p class="eyebrow">Faces · step 1</p><h1>Name the groups</h1>
        <p class="lede">Each row is one group the matcher thinks is the same person. Biggest first names the most faces per click.</p></header>
      ${subnav("groups")}
      <div class="toolbar"><label class="muted">Order
        <select class="order-select"><option value="big" ${order === "big" ? "selected" : ""}>Biggest first</option><option value="small" ${order === "small" ? "selected" : ""}>Smallest first</option></select></label>
        ${gs.length ? `<a class="btn btn-primary" href="${href(`/faces/groups/f${gs[0].anchor}?set=${Math.min(5, gs.length)}`)}">Name the next ${Math.min(5, gs.length)} ${icon("next", 16)}</a>` : ""}
      </div>
      ${
        gs.length
          ? `<ul class="rows">${gs
              .map(
                (g) => `<li><a class="row-link group-row" href="${href(`/faces/groups/f${g.anchor}`)}">
            <span class="chipstrip">${g.faces
              .slice(0, 5)
              .map((f) => faceSvg(g.identity, f.v, { size: 44 }))
              .join("")}</span>
            <span class="row-main"><strong>${g.faces.length} faces</strong>
              <span class="row-text">${g.suggestion ? `Suggested: ${esc(g.suggestion)}` : '<span class="muted">No suggestion yet</span>'}</span></span>
            <span class="row-go">${icon("next")}</span></a></li>`,
              )
              .join("")}</ul>`
          : `<div class="empty">Every group has a name. <a href="${href("/faces/ask")}">On to quick confirms →</a></div>`
      }
    </div>`
  },
  mount(el) {
    el.querySelector(".order-select")?.addEventListener("change", (e) => {
      setQuery({ order: /** @type {HTMLSelectElement} */ (e.target).value })
      rerender()
    })
  },
})

route("/faces/groups/break", {
  nav: "faces",
  flow: true,
  title: () => "Set done",
  render() {
    const sp = state.sprint || { done: 0, faces: 0 }
    // A finished set takes the faces task off Today: Today has to be able to
    // reach zero, and "the rest of the backlog" is not today's job.
    if (!state.setDoneToday && sp.done) {
      state.setDoneToday = true
      logDone("faces", `Finished today's face set (${sp.faces} faces)`)
    }
    const left = unnamedGroups().length
    return `<div class="page flow-page">
      ${flowBar({ label: "Naming groups", exitTo: "/faces" })}
      <div class="celebrate">
        <div class="all-clear-mark">${icon("check", 44)}</div>
        <h1>That's today's set.</h1>
        <p class="lede">${plural(sp.done, "group")} named — <strong>${sp.faces} faces</strong> now have a name. ${left ? `${left} groups to go, whenever you feel like it.` : "That was the last of them!"}</p>
        <p class="faces-ring">${ring(facesNamed(), state.facesTotal, 84)}</p>
        <div class="celebrate-actions">
          <button type="button" class="btn btn-secondary back-today">Back to Today</button>
          ${left ? `<button type="button" class="btn btn-primary keep-going">Keep going — ${Math.min(5, left)} more</button>` : ""}
        </div>
      </div>
    </div>`
  },
  mount(el) {
    wireFlowExit(el)
    el.querySelector(".back-today")?.addEventListener("click", () => {
      state.sprint = null
      save()
      returnTo("/")
    })
    el.querySelector(".keep-going")?.addEventListener("click", () => {
      const gs = unnamedGroups()
      state.sprint = { target: Math.min(5, gs.length), done: 0, faces: 0 }
      save()
      navigate(`/faces/groups/f${gs[0].anchor}`, { replace: true })
    })
  },
})

// ---- the group review --------------------------------------------------------

function groupView(ctx) {
  const anchor = Number(ctx.params.anchor)
  const g = groupByFace(anchor)
  if (!g) {
    return `<div class="page flow-page">${flowBar({ label: "Naming groups", exitTo: "/faces/groups" })}
      <div class="empty">That face isn't in any group any more. <a href="${href("/faces/groups")}">See the groups</a></div></div>`
  }
  if (g.named) {
    const nxt = unnamedGroups()[0]
    return `<div class="page flow-page">${flowBar({ label: "Naming groups", exitTo: "/faces/groups" })}
      <div class="notice big"><p>The link pointed at face ${anchor}. Its group was already named <strong>${esc(g.named.name)}</strong> (${g.named.count} faces) — links follow the face, so this is never the wrong group.</p>
      ${nxt ? `<a class="btn btn-primary" href="${href(`/faces/groups/f${nxt.anchor}`)}" data-replace="true">Go to the next unnamed group ${icon("next", 16)}</a>` : ""}</div></div>`
  }
  const gs = unnamedGroups()
  const pos = gs.indexOf(g) + 1
  const faces = [...g.faces.filter((f) => !f.setAside), ...g.faces.filter((f) => f.setAside)]
  const selId = Number(ctx.query.get("face")) || faces[0].id
  const sel = faces.find((f) => f.id === selId) || faces[0]
  const selIdx = faces.indexOf(sel)
  const ex = excluded.get(g.anchor) || new Set()
  const n = assignable(g).length
  const setAsideCount = g.faces.filter((f) => f.setAside).length
  const sp = state.sprint
  const extra = sp ? `<span class="sprint"><span class="sprint-long">Today's set: </span>${sp.done + 1} of ${sp.target}</span>` : `<span class="muted">${gs.length} left</span>`
  return `<div class="page flow-page face-review">
    ${flowBar({ label: "Naming groups", pos, total: gs.length, exitTo: "/faces/groups", extra })}
    <div class="fr-grid">
      <div class="fr-stage">
        <div class="fr-big ${sel.setAside ? "is-setaside" : ""} ${ex.has(sel.id) ? "is-excluded" : ""}">${faceSvg(g.identity, sel.v, { size: 320 })}
          ${sel.setAside ? '<span class="flag">set aside</span>' : ""}${ex.has(sel.id) ? '<span class="flag bad">excluded</span>' : ""}</div>
        <div class="fr-facebar">
          <button type="button" class="btn btn-ghost fr-prev" aria-label="Previous face">${icon("back")}</button>
          <span>Face <strong>${selIdx + 1}</strong> of ${faces.length}</span>
          <button type="button" class="btn btn-ghost fr-next" aria-label="Next face">${icon("next")}</button>
        </div>
        <div class="fr-faceactions">
          ${sel.setAside ? "" : `<button type="button" class="btn btn-secondary btn-sm fr-exclude">${ex.has(sel.id) ? "↩ Put back" : "✕ Not this person"} ${kbd("X")}</button>`}
          <a class="btn btn-secondary btn-sm" href="${href(`/faces/photo/m${sel.mediaId}?face=${sel.id}`)}">Open the photo ${kbd("O")}</a>
        </div>
      </div>
      <div class="fr-side">
        <p class="fr-q">Who is this?</p>
        <form class="fr-name" autocomplete="off">
          <input class="fr-input" list="people-roster" value="${esc(g.suggestion || "")}" placeholder="Type a name…" aria-label="Person name for this group" />
          <button type="submit" class="btn btn-primary btn-big fr-confirm" ${n ? "" : "disabled"}>Name all ${n} ${kbd("⏎")}</button>
          <p class="fr-create" hidden></p>
        </form>
        ${g.suggestion ? `<p class="muted small">Suggested because these look like faces already named ${esc(g.suggestion)}.</p>` : ""}
        <div class="fr-strip" role="group" aria-label="Every face in this group">
          ${faces
            .map(
              (f, i) => `<button type="button" class="fr-chip ${f.id === sel.id ? "is-sel" : ""} ${f.setAside ? "is-setaside" : ""} ${ex.has(f.id) ? "is-excluded" : ""}" data-face="${f.id}" aria-label="Face ${i + 1} of ${faces.length}${f.setAside ? ", set aside" : ""}${ex.has(f.id) ? ", excluded" : ""}" aria-pressed="${f.id === sel.id}">${faceSvg(g.identity, f.v, { size: 56, dim: f.setAside })}</button>`,
            )
            .join("")}
        </div>
        <p class="muted small">Scan the strip for anyone who doesn't belong — click them and press ${kbd("X")}.
          ${setAsideCount ? `${plural(setAsideCount, "face")} dimmed at the end ${setAsideCount === 1 ? "is" : "are"} too small to name in bulk; open the photo to name ${setAsideCount === 1 ? "it" : "them"}.` : ""}</p>
        <div class="fr-groupnav">
          <button type="button" class="btn btn-ghost fr-gprev" ${pos <= 1 ? "disabled" : ""}>${icon("back", 16)} Previous group ${kbd("[")}</button>
          <button type="button" class="btn btn-ghost fr-gnext" ${pos >= gs.length ? "disabled" : ""}>Skip group ${kbd("]")} ${icon("next", 16)}</button>
        </div>
      </div>
    </div>
    ${peopleDatalist()}
  </div>`
}

function selectFace(ctx, id) {
  setQuery({ face: id })
  rerender()
}

function stepFace(ctx, d) {
  const g = groupByFace(Number(ctx.params.anchor))
  if (!g) return
  const faces = [...g.faces.filter((f) => !f.setAside), ...g.faces.filter((f) => f.setAside)]
  const cur = Number(ctx.query.get("face")) || faces[0].id
  const i = faces.findIndex((f) => f.id === cur)
  const next = faces[Math.max(0, Math.min(faces.length - 1, i + d))]
  selectFace(ctx, next.id)
}

function stepGroup(ctx, d) {
  const g = groupByFace(Number(ctx.params.anchor))
  const gs = unnamedGroups()
  const i = g ? gs.indexOf(g) : -1
  const next = gs[i + d]
  if (next) navigate(`/faces/groups/f${next.anchor}`, { replace: true })
}

function toggleExclude(ctx) {
  const g = groupByFace(Number(ctx.params.anchor))
  if (!g) return
  const faces = [...g.faces.filter((f) => !f.setAside), ...g.faces.filter((f) => f.setAside)]
  const cur = Number(ctx.query.get("face")) || faces[0].id
  const f = faces.find((x) => x.id === cur)
  if (!f || f.setAside) return
  let set = excluded.get(g.anchor)
  if (!set) excluded.set(g.anchor, (set = new Set()))
  if (set.has(f.id)) set.delete(f.id)
  else set.add(f.id)
  // Move on to the next face — excluding is usually followed by checking the next.
  stepFace(ctx, 1)
}

function confirmGroup(ctx, nameRaw, create = false) {
  const g = groupByFace(Number(ctx.params.anchor))
  if (!g) return
  const name = nameRaw.trim()
  const box = document.querySelector(".fr-create")
  if (!name) {
    /** @type {HTMLInputElement | null} */ (document.querySelector(".fr-input"))?.focus()
    return
  }
  let person = personByName(name)
  if (!person && !create) {
    if (box instanceof HTMLElement) {
      box.hidden = false
      box.innerHTML = `No one called “${esc(name)}” yet. <button type="button" class="btn btn-secondary btn-sm fr-create-btn">Add ${esc(name)} as a new person</button>`
      box.querySelector(".fr-create-btn")?.addEventListener("click", () => confirmGroup(ctx, name, true))
    }
    return
  }
  act(() => {
    if (!person) {
      person = { id: `p${state.people.length + 10}`, name, guestId: null }
      state.people.push(person)
    }
    const count = assignable(g).length
    g.named = { personId: person.id, name: person.name, count }
    if (state.sprint) {
      state.sprint.done += 1
      state.sprint.faces += count
    }
    state.batches.unshift({ id: `b${40 + state.batches.length}`, kind: "Named a group", detail: `${count} faces → ${person.name}`, ago: "just now", revoked: false })
    save()
    logDone("faces", `Named ${count} faces ${esc(person.name)}`)
    const gs = unnamedGroups()
    const after = gs.find((x) => state.groups.indexOf(x) > state.groups.indexOf(g)) || gs[0]
    let to = "/faces/groups/done"
    if (state.sprint && state.sprint.done >= state.sprint.target) to = "/faces/groups/break"
    else if (after) to = `/faces/groups/f${after.anchor}`
    navigate(to, { replace: true })
    toast(`Named ${count} faces <strong>${esc(person.name)}</strong>.`, {
      undo: () => {
        g.named = null
        if (state.sprint) {
          state.sprint.done -= 1
          state.sprint.faces -= count
        }
        state.batches.shift()
        state.done.shift()
        save()
        navigate(`/faces/groups/f${g.anchor}`, { replace: true })
      },
    })
  })
}

route("/faces/groups/done", {
  nav: "faces",
  flow: true,
  title: () => "All groups named",
  render() {
    return `<div class="page flow-page">${flowBar({ label: "Naming groups", exitTo: "/faces" })}
      <div class="celebrate"><div class="all-clear-mark">${icon("check", 44)}</div>
      <h1>Every group has a name.</h1>
      <p class="lede">Quick confirms just got smarter: ${plural(openAsk().length, "face")} with a good guess are waiting.</p>
      <div class="celebrate-actions"><a class="btn btn-primary" href="${href("/faces/ask")}" data-replace="true">Do quick confirms ${icon("next", 16)}</a>
      <button type="button" class="btn btn-secondary back-today">Back to Today</button></div></div></div>`
  },
  mount(el) {
    wireFlowExit(el)
    el.querySelector(".back-today")?.addEventListener("click", () => {
      state.sprint = null
      save()
      returnTo("/")
    })
  },
})

route("/faces/groups/f:anchor", {
  nav: "faces",
  flow: true,
  title: () => "Naming groups",
  render(ctx) {
    const set = Number(ctx.query.get("set"))
    if (set && (!state.sprint || state.sprint.target !== set || state.sprint.done >= set)) {
      state.sprint = { target: set, done: 0, faces: 0 }
      save()
    }
    return groupView(ctx)
  },
  mount(el, ctx) {
    // ?set= is consumed once; keep it out of reloads and shared links.
    if (ctx.query.get("set")) setQuery({ set: null })
    wireFlowExit(el)
    const input = /** @type {HTMLInputElement | null} */ (el.querySelector(".fr-input"))
    if (input && !input.value) input.focus()
    el.querySelector(".fr-name")?.addEventListener("submit", (e) => {
      e.preventDefault()
      confirmGroup(ctx, input?.value || "")
    })
    el.querySelectorAll(".fr-chip").forEach((c) =>
      c.addEventListener("click", () => selectFace(ctx, Number(/** @type {HTMLElement} */ (c).dataset.face))),
    )
    el.querySelector(".fr-prev")?.addEventListener("click", () => stepFace(ctx, -1))
    el.querySelector(".fr-next")?.addEventListener("click", () => stepFace(ctx, 1))
    el.querySelector(".fr-gprev")?.addEventListener("click", () => stepGroup(ctx, -1))
    el.querySelector(".fr-gnext")?.addEventListener("click", () => stepGroup(ctx, 1))
    el.querySelector(".fr-exclude")?.addEventListener("click", () => toggleExclude(ctx))
  },
  keys(e, ctx) {
    if (e.key === "Enter") {
      confirmGroup(ctx, /** @type {HTMLInputElement | null} */ (document.querySelector(".fr-input"))?.value || "")
    } else if (e.key === "ArrowRight") stepFace(ctx, 1)
    else if (e.key === "ArrowLeft") stepFace(ctx, -1)
    else if (e.key === "]") stepGroup(ctx, 1)
    else if (e.key === "[") stepGroup(ctx, -1)
    else if (e.key === "x") toggleExclude(ctx)
    else if (e.key === "e") /** @type {HTMLInputElement | null} */ (document.querySelector(".fr-input"))?.select()
    else if (e.key === "o") /** @type {HTMLAnchorElement | null} */ (document.querySelector('a[href*="/faces/photo/"]'))?.click()
    else return false
    return true
  },
})

// ---- the photo dialog (a route: Back closes it) -----------------------------

route("/faces/photo/m:id", {
  nav: "faces",
  dialog: true,
  parent: () => "/faces/set-aside",
  title: () => "Faces in this photo",
  render(ctx) {
    const mediaId = Number(ctx.params.id)
    const count = 3 + (mediaId % 3)
    const { svg, boxes } = photoSvg(mediaId, count)
    const sel = Number(ctx.query.get("box") || "0")
    return `<div class="dialog-card dialog-lg" role="dialog" aria-modal="true" aria-labelledby="dlg-h">
      <header class="dialog-head"><h2 id="dlg-h">Faces in this photo</h2>
        <button type="button" class="dialog-close" aria-label="Close (Esc)">${icon("close")}</button></header>
      <div class="photo-wrap">${svg}${boxes
        .map(
          (b, i) => `<button type="button" class="photo-box ${i === sel ? "is-sel" : ""}" data-box="${i}" style="left:${b.x}%;top:${(b.y / 75) * 100}%;width:${b.w}%;height:${(b.h / 75) * 100}%" aria-label="Face ${i + 1}"><span>${i + 1}</span></button>`,
        )
        .join("")}</div>
      <form class="photo-name" autocomplete="off">
        <label>Face ${sel + 1} of ${boxes.length} is</label>
        <input class="photo-input" list="people-roster" placeholder="Type a name, or leave blank" />
        <button class="btn btn-primary" type="submit">Save</button>
        <button class="btn btn-ghost photo-notface" type="button">Not a face</button>
      </form>
      <p class="muted small">This is the one place a set-aside face can be named — one at a time, on purpose.</p>
      ${peopleDatalist()}
    </div>`
  },
  mount(el, ctx) {
    el.querySelectorAll(".photo-box").forEach((b) =>
      b.addEventListener("click", () => {
        setQuery({ box: /** @type {HTMLElement} */ (b).dataset.box })
        rerender()
      }),
    )
    el.querySelector(".photo-name")?.addEventListener("submit", (e) => {
      e.preventDefault()
      const v = /** @type {HTMLInputElement} */ (el.querySelector(".photo-input")).value.trim()
      act(() => {
        if (v) logDone("faces", `Named one face ${esc(v)}`)
        toast(v ? `Saved — that face is ${esc(v)}.` : "Saved.")
      })
    })
  },
})

// ---- quick confirms (the Ask queue, one at a time) ---------------------------

route("/faces/ask", {
  nav: "faces",
  title: () => "Quick confirms",
  render() {
    const ask = openAsk()
    return `<div class="page">
      <header class="page-head row"><div><p class="eyebrow">Faces · step 2</p><h1>Quick confirms</h1>
      <p class="lede">One face, the matcher's best guesses. Ordered by how many other photos each answer unlocks.</p></div>
      ${ask.length ? `<a class="btn btn-primary" href="${href(`/faces/ask/f${ask[0].id}`)}">Start (${ask.length}) ${icon("next", 16)}</a>` : ""}</header>
      ${subnav("ask")}
      ${
        ask.length
          ? `<ul class="rows">${ask
              .map(
                (a) => `<li><a class="row-link" href="${href(`/faces/ask/f${a.id}`)}"><span class="row-thumb">${faceSvg(a.identity, a.id, { size: 44 })}</span>
            <span class="row-main"><strong>${esc(a.candidates[0].name)}?</strong><span class="row-text muted">or ${esc(a.candidates[1].name)} · unlocks ${a.unlocks}</span></span><span class="row-go">${icon("next")}</span></a></li>`,
              )
              .join("")}</ul>`
          : `<div class="empty">Nothing to confirm right now. ${icon("check", 16)}</div>`
      }
    </div>`
  },
})

function answerAsk(a, personIdx) {
  act(() => {
    const c = personIdx === null ? null : a.candidates[personIdx]
    a.done = c ? { personId: c.personId } : { personId: null }
    save()
    if (c) logDone("faces", `Confirmed a face is ${esc(c.name)}`)
    const rest = openAsk()
    const next = rest.find((x) => state.ask.indexOf(x) > state.ask.indexOf(a)) || rest[0]
    navigate(next ? `/faces/ask/f${next.id}` : "/faces/ask", { replace: true })
    toast(c ? `That's ${esc(c.name)} — ${a.unlocks > 1 ? `${a.unlocks - 1} more photos matched too` : "saved"}.` : "Skipped for now.", {
      undo: () => {
        a.done = null
        if (c) state.done.shift()
        save()
        navigate(`/faces/ask/f${a.id}`, { replace: true })
      },
    })
  })
}

route("/faces/ask/f:id", {
  nav: "faces",
  flow: true,
  title: () => "Quick confirms",
  render(ctx) {
    const a = state.ask.find((x) => x.id === Number(ctx.params.id))
    if (!a) return `<div class="page"><div class="empty">Not in the queue any more. <a href="${href("/faces/ask")}">Back</a></div></div>`
    const open = openAsk()
    const pos = open.indexOf(a) + 1
    return `<div class="page flow-page">
      ${flowBar({ label: "Quick confirms", pos: pos || undefined, total: pos ? open.length : undefined, exitTo: "/faces/ask" })}
      <div class="ask-card">
        <div class="fr-big">${faceSvg(a.identity, a.id, { size: 280 })}</div>
        <div class="ask-side">
          <p class="fr-q">Is this…</p>
          ${a.candidates
            .map(
              (c, i) => `<button type="button" class="btn ${i === 0 ? "btn-primary" : "btn-secondary"} btn-big ask-pick" data-i="${i}">${kbd(String(i + 1))} ${esc(c.name)}
              <span class="conf">${meter(Math.round(c.margin * 100), 40)}</span></button>`,
            )
            .join("")}
          <div class="ask-more">
            <button type="button" class="btn btn-ghost ask-none">Someone else ${kbd("N")}</button>
            <button type="button" class="btn btn-ghost ask-skip">Skip ${kbd("S")}</button>
            <a class="btn btn-ghost" href="${href(`/faces/photo/m${a.mediaId}`)}">Photo ${kbd("O")}</a>
          </div>
          <p class="muted small">Answering unlocks ${plural(a.unlocks, "photo")}.</p>
        </div>
      </div>
    </div>`
  },
  mount(el, ctx) {
    wireFlowExit(el)
    const a = state.ask.find((x) => x.id === Number(ctx.params.id))
    if (!a) return
    el.querySelectorAll(".ask-pick").forEach((b) =>
      b.addEventListener("click", () => answerAsk(a, Number(/** @type {HTMLElement} */ (b).dataset.i))),
    )
    el.querySelector(".ask-skip")?.addEventListener("click", () => answerAsk(a, null))
    el.querySelector(".ask-none")?.addEventListener("click", () => answerAsk(a, null))
  },
  keys(e, ctx) {
    const a = state.ask.find((x) => x.id === Number(ctx.params.id))
    if (!a) return false
    if (e.key === "1" || e.key === "2") answerAsk(a, Number(e.key) - 1)
    else if (e.key === "s" || e.key === "n") answerAsk(a, null)
    else if (e.key === "o") /** @type {HTMLAnchorElement | null} */ (document.querySelector('a[href*="/faces/photo/"]'))?.click()
    else return false
    return true
  },
})

// ---- same moment, set aside, people, history --------------------------------

route("/faces/moments", {
  nav: "faces",
  title: () => "Same moment",
  render() {
    const ms = openMoments()
    return `<div class="page"><header class="page-head row"><div><p class="eyebrow">Faces · step 3</p><h1>Same moment</h1>
      <p class="lede">Burst shots: the same person, seconds apart, next to a face you've already named.</p></div>
      ${ms.length ? `<button type="button" class="btn btn-primary accept-all">Accept all ${ms.reduce((n, m) => n + m.count, 0)}</button>` : ""}</header>
      ${subnav("moments")}
      ${ms.length ? `<ul class="rows">${ms.map((m) => `<li class="row-static">${avatar(m.name, 40)}<span class="row-main"><strong>${esc(m.name)}</strong><span class="row-text muted">${m.count} more shots from the same moment</span></span><button type="button" class="btn btn-secondary btn-sm accept-one" data-id="${m.id}">Accept</button></li>`).join("")}</ul>` : `<div class="empty">Nothing here right now.</div>`}
    </div>`
  },
  mount(el) {
    const accept = (list) =>
      act(() => {
        for (const m of list) m.done = true
        save()
        logDone("faces", `Accepted ${list.reduce((n, m) => n + m.count, 0)} same-moment faces`)
        toast(`Accepted ${plural(list.length, "batch", "batches")}.`, {
          undo: () => {
            for (const m of list) m.done = false
            state.done.shift()
            save()
            rerender()
          },
        })
        rerender()
      })
    el.querySelector(".accept-all")?.addEventListener("click", () => accept(openMoments()))
    el.querySelectorAll(".accept-one").forEach((b) =>
      b.addEventListener("click", () => accept(state.moments.filter((m) => m.id === /** @type {HTMLElement} */ (b).dataset.id))),
    )
  },
})

route("/faces/set-aside", {
  nav: "faces",
  title: () => "Set aside",
  render() {
    return `<div class="page"><header class="page-head"><p class="eyebrow">Faces · step 4</p><h1>Set aside</h1>
      <p class="lede">Photos whose faces were too small or soft to name from a list. Open one to decide face by face.</p></header>
      ${subnav("setaside")}
      <ul class="photo-grid">${state.setAside.map((p) => `<li><a href="${href(`/faces/photo/m${p.mediaId}`)}">${photoSvg(p.mediaId, 0).svg}<span>${plural(p.faces, "face")} set aside</span></a></li>`).join("")}</ul>
    </div>`
  },
})

route("/faces/people", {
  nav: "faces",
  title: () => "People",
  render() {
    return `<div class="page"><header class="page-head"><p class="eyebrow">Faces</p><h1>People</h1>
      <p class="lede">Everyone with a name in the photos. A person can be linked to a guest on the list — or not (kids, the photographer, partners on someone else's invite).</p></header>
      ${subnav("people")}
      <ul class="rows">${state.people.map((p) => `<li><a class="row-link" href="${href(`/faces/people/${p.id}`)}">${avatar(p.name, 40)}<span class="row-main"><strong>${esc(p.name)}</strong><span class="row-text muted">${p.guestId ? `Guest: ${esc(guestById(p.guestId)?.name)}` : "Not on the guest list"}</span></span><span class="row-go">${icon("next")}</span></a></li>`).join("")}</ul>
    </div>`
  },
})

route("/faces/people/:pid", {
  nav: "faces",
  title: (ctx) => state.people.find((p) => p.id === ctx.params.pid)?.name || "Person",
  render(ctx) {
    const p = state.people.find((x) => x.id === ctx.params.pid)
    if (!p) return `<div class="page"><div class="empty">No such person.</div></div>`
    const faces = []
    for (let i = 0; i < 12; i++) faces.push(faceSvg(state.people.indexOf(p) + 40, i * 37, { size: 72 }))
    return `<div class="page"><nav class="crumbs"><a href="${href("/faces/people")}">People</a> / ${esc(p.name)}</nav>
      <header class="page-head row"><div class="row-gap">${avatar(p.name, 56)}<div><h1>${esc(p.name)}</h1><p class="muted">${p.guestId ? `Linked to guest ${esc(guestById(p.guestId)?.name)}` : "Not linked to a guest"}</p></div></div>
      <div class="row-gap"><button class="btn btn-secondary btn-sm" type="button">Rename</button><button class="btn btn-secondary btn-sm" type="button">Merge into…</button></div></header>
      <h2 class="section-h">In ${faces.length} photos</h2><div class="face-grid">${faces.join("")}</div></div>`
  },
})

route("/faces/history", {
  nav: "faces",
  title: () => "History",
  render() {
    return `<div class="page"><header class="page-head"><p class="eyebrow">Faces</p><h1>History</h1>
      <p class="lede">Every naming pass, newest first. Revoking one un-names just that pass. Nothing is deleted, and fixes you made afterwards are kept.</p></header>
      ${subnav("history")}
      <ul class="rows">${state.batches.map((b) => `<li class="row-static ${b.revoked ? "is-dim" : ""}"><span class="row-main"><strong>${esc(b.kind)}</strong><span class="row-text muted">${esc(b.detail)} · ${b.ago}${b.revoked ? " · revoked" : ""}</span></span>${b.revoked ? "" : `<a class="btn btn-secondary btn-sm" href="${href(`/faces/history/${b.id}/revoke`)}">Revoke…</a>`}</li>`).join("")}</ul></div>`
  },
})

route("/faces/history/:bid/revoke", {
  nav: "faces",
  dialog: true,
  parent: () => "/faces/history",
  title: () => "Revoke a pass",
  render(ctx) {
    const b = state.batches.find((x) => x.id === ctx.params.bid)
    return `<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dlg-h">
      <header class="dialog-head"><h2 id="dlg-h">Revoke “${esc(b?.detail)}”?</h2><button type="button" class="dialog-close" aria-label="Close (Esc)">${icon("close")}</button></header>
      <p>Those faces go back to unnamed. Nothing is deleted, and any face you corrected by hand since then keeps your correction.</p>
      <div class="dialog-actions"><button type="button" class="btn btn-secondary dialog-cancel">Keep it</button><button type="button" class="btn btn-primary do-revoke">Revoke this pass</button></div></div>`
  },
  mount(el, ctx) {
    el.querySelector(".do-revoke")?.addEventListener("click", () =>
      act(() => {
        const b = state.batches.find((x) => x.id === ctx.params.bid)
        if (b) b.revoked = true
        save()
        toast("Revoked. Those faces are unnamed again.")
        returnTo("/faces/history")
      }),
    )
  },
})
