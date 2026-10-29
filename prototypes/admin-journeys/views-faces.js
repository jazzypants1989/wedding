/** @file "Name the faces" — five steps, each its own route. Every face here is a
 *  generated silhouette (art.js); nothing is a photograph. */

import { html, raw, plural } from "./html.js"
import {
  db,
  save,
  personById,
  guestById,
  liveFaces,
  openGroups,
  groupByFace,
  faceHue,
  suggestionFor,
  openAsk,
  waitingAsk,
  openSameMoment,
  knownPeople,
  facesOf,
  hueOfFace,
  faceTotals,
} from "./data.js"
import { faceImg, faceSvg, sceneSvg, monogram } from "./art.js"
import { L, toast, withSession, withStepNav } from "./shell.js"

/** @typedef {import("./shell.js").Screen} Screen
 *  @typedef {{ nav: (to: string, o?: { replace?: boolean }) => void, up: (to: string) => void,
 *    refresh: () => void, closeDialog: () => void }} Ctx */

/** Per-group UI state, keyed by group index (internal) — the URL only ever
 *  carries the anchor face id. */
/** @type {Map<number, Set<number>>} */
const excluded = new Map()
/** @type {Map<number, number>} */
const selected = new Map()
/** @type {Map<number, string>} */
const nameDraft = new Map()

/** @param {number} gi */
function excl(gi) {
  let s = excluded.get(gi)
  if (!s) excluded.set(gi, (s = new Set()))
  return s
}

function peopleDatalist() {
  return html`<datalist id="people-list">${db.people.map((/** @type {any} */ p) => html`<option value="${p.name}"></option>`)}</datalist>`
}

/** Resolve a typed name to a person, creating one if it's new. @param {string} name */
function personForName(name) {
  const clean = name.trim()
  if (!clean) return null
  const lower = clean.toLowerCase()
  const found = db.people.find((/** @type {any} */ p) => p.name.toLowerCase() === lower)
  if (found) return found
  const p = { id: Math.max(...db.people.map((/** @type {any} */ x) => x.id)) + 1, name: clean, hue: 200, guestId: null }
  db.people.push(p)
  return p
}

/** @param {number[]} faceIds @param {number} personId @param {string} kind */
function assign(faceIds, personId, kind) {
  for (const f of faceIds) db.assigned[f] = personId
  const batch = { id: db.batches.length + 1, kind, personId, faces: faceIds, at: "just now", revoked: false }
  db.batches.unshift(batch)
  save()
  return batch
}

/** @param {any} batch */
function undoBatch(batch) {
  for (const f of batch.faces) delete db.assigned[f]
  batch.revoked = true
  save()
}

// ---------------- Step 1: people ----------------

/** @returns {Screen} */
export function peopleScreen() {
  const rosterOnly = db.guests.filter(
    (/** @type {any} */ g) => !db.people.some((/** @type {any} */ p) => p.guestId === g.id),
  )
  const body = html`
    <div class="toolbar">
      <a class="btn primary" href="${L("/faces/people/new")}">+ Add someone</a>
      <button type="button" class="btn secondary" data-act="import-roster">Add the other ${rosterOnly.length} guests</button>
    </div>
    <ul class="people-grid">
      ${db.people.map((/** @type {any} */ p) => {
        const g = p.guestId ? guestById(p.guestId) : null
        const n = facesOf(p.id).length
        return html`<li class="person">
          ${raw(monogram(p.name, p.hue))}
          <div><strong>${p.name}</strong>
            <span class="fine">${g ? `On the guest list` : "Not on the guest list"}${n ? ` · ${plural(n, "face")} named` : ""}</span></div>
        </li>`
      })}
    </ul>`
  return withStepNav(
    {
      journey: "faces",
      step: "people",
      title: "Who's in the photos?",
      body,
      status: `${plural(db.people.length, "person", "people")} on the list`,
      acts: {
        "import-roster": () =>
          withSession("Name the faces · Who's in the photos?", () => {
            for (const g of rosterOnly) {
              db.people.push({ id: Math.max(...db.people.map((/** @type {any} */ x) => x.id)) + 1, name: g.name, hue: (g.id * 37) % 360, guestId: g.id })
            }
            save()
            toast(`Added ${plural(rosterOnly.length, "guest")} to the list.`)
            refreshHook()
          }),
      },
    },
    true,
  )
}

/** @param {Ctx} ctx @returns {Screen} */
export function addPersonDialog(ctx) {
  const s = peopleScreen()
  s.dialog = {
    title: "Add someone",
    body: html`<div class="form">
      <label for="np-name">Their name</label>
      <input id="np-name" autocomplete="off" placeholder="e.g. Little Theo">
      <label for="np-guest">On the guest list as… <span class="fine">(optional)</span></label>
      <select id="np-guest"><option value="">Not on the guest list</option>
        ${db.guests.map((/** @type {any} */ g) => html`<option value="${g.id}">${g.name}</option>`)}</select>
      <p class="fine">Kids, partners, the photographer — anyone who might be in a photo.</p>
      <div class="dlg-foot"><button type="button" class="btn secondary" data-act="dlg-close">Cancel</button>
        <button type="button" class="btn primary" data-act="np-save">Add to the list</button></div>
    </div>`,
    mount: (root) => {
      const i = root.querySelector("#np-name")
      if (i instanceof HTMLElement) i.focus()
    },
    acts: {
      "np-save": () => {
        const name = /** @type {HTMLInputElement} */ (document.getElementById("np-name")).value.trim()
        const gid = /** @type {HTMLSelectElement} */ (document.getElementById("np-guest")).value
        if (!name) return
        withSession("Name the faces · Add someone", () => {
          const p = personForName(name)
          if (p && gid) p.guestId = Number(gid)
          save()
          toast(`${name} added.`)
          ctx.closeDialog()
        })
      },
    },
  }
  return s
}

// ---------------- Step 2: groups ----------------

/** @returns {Screen} */
export function groupsScreen() {
  const groups = openGroups()
  const first = groups[0]
  const body = groups.length
    ? html`
      <div class="callout">
        <a class="btn primary big" href="${L("/faces/groups/f" + first.anchor)}">Start with the biggest group · ${plural(first.live.length, "face")} →</a>
        <p class="fine">Groups are our best guess. Now and then one person is split in two, or two look-alikes share a group — you'll spot those as you go.</p>
      </div>
      <ol class="group-list">
        ${groups.map((x, n) => {
          const sug = suggestionFor(x.g)
          return html`<li><a class="group-row" href="${L("/faces/groups/f" + x.anchor)}">
            <span class="gn">${n + 1}</span>
            <span class="chips">${x.live.slice(0, 5).map((/** @type {any} */ f) => raw(faceImg(faceHue(x.g, f), f.id, "chip")))}</span>
            <span class="gm"><strong>${plural(x.live.length, "face")}</strong>
              ${sug ? html`<span class="sug">Looks like ${sug.name}?</span>` : html`<span class="fine">Not named yet</span>`}</span>
            <span class="go">Name →</span>
          </a></li>`
        })}
      </ol>`
    : html`<div class="empty-done"><div class="big-check sm" aria-hidden="true">✓</div>
        <h2>All the big groups are named</h2>
        <p>What's left are the faces we're less sure about. Next, you'll answer those one at a time.</p></div>`
  return withStepNav(
    {
      journey: "faces",
      step: "groups",
      title: "Name the big groups",
      body,
      status: groups.length ? `${plural(groups.length, "group")} left` : "Step finished",
    },
    groups.length === 0,
  )
}

/** @param {string} anchorParam @param {Ctx} ctx @returns {Screen} */
export function groupReviewScreen(anchorParam, ctx) {
  const anchor = Number(anchorParam.slice(1))
  const found = groupByFace(anchor)
  if (!found) return groupsScreen()
  const groups = openGroups()
  const pos = groups.findIndex((x) => x.i === found.i)
  const g = found.g
  const gi = found.i
  const all = g.faces.filter((/** @type {any} */ f) => !db.assigned[f.id] && !db.notFace[f.id])
  const ex = excl(gi)
  const included = all.filter((/** @type {any} */ f) => !ex.has(f.id) && !f.setAside)
  const selId = selected.get(gi) || all[0].id
  const selIdx = Math.max(0, all.findIndex((/** @type {any} */ f) => f.id === selId))
  const cur = all[selIdx]
  const sug = suggestionFor(g)
  const draft = nameDraft.get(gi) ?? (sug ? sug.name : "")
  const where = `Name the faces · Group ${pos + 1} of ${groups.length}`

  const go = (/** @type {number} */ d) => {
    const t = groups[pos + d]
    if (t) ctx.nav("/faces/groups/f" + t.anchor, { replace: true })
  }
  const pick = (/** @type {number} */ d) => {
    const t = all[selIdx + d]
    if (t) {
      selected.set(gi, t.id)
      ctx.refresh()
    }
  }
  const toggleEx = () => {
    if (ex.has(cur.id)) ex.delete(cur.id)
    else ex.add(cur.id)
    ctx.refresh()
  }
  const confirm = () => {
    const input = /** @type {HTMLInputElement | null} */ (document.getElementById("gr-name"))
    const name = input ? input.value.trim() : ""
    if (!name) {
      if (input) {
        input.focus()
        input.setAttribute("aria-invalid", "true")
      }
      toast("Type a name first — or skip this group.")
      return
    }
    withSession(where, () => {
      const nextG = groups[pos + 1] || groups[pos - 1]
      const p = /** @type {any} */ (personForName(name))
      const ids = included.map((/** @type {any} */ f) => f.id)
      const batch = assign(ids, p.id, "group")
      nameDraft.delete(gi)
      // Left-out faces leave the group and become questions in step 3.
      for (const fid of ex) {
        const f = g.faces.find((/** @type {any} */ x) => x.id === fid)
        if (!f || db.assigned[fid]) continue
        db.ejected[fid] = true
        const guess = db.people.find((/** @type {any} */ x) => x.hue === f.oddHue)
        const t = guess ? guess.id : g.truth
        db.ask.unshift({ id: fid, mediaId: f.mediaId, truth: t, candidates: [t, g.truth].filter((v, i, a) => a.indexOf(v) === i), margin: 0.03, unlocks: 1, fromGroup: true })
      }
      ex.clear()
      save()
      toast(`Named ${plural(ids.length, "face")} as ${p.name}.`, () => {
        undoBatch(batch)
        ctx.refresh()
      })
      const still = nextG && groupByFace(nextG.anchor)
      if (still) ctx.nav("/faces/groups/f" + still.anchor, { replace: true })
      else if (openGroups().length) ctx.nav("/faces/groups/f" + openGroups()[0].anchor, { replace: true })
      else ctx.up("/faces/groups") // last one: go back UP to the list, no duplicate entry
    })
  }

  const body = html`
    <div class="review">
      <div class="rv-top">
        <a class="btn ghost sm" href="${L("/faces/groups")}" data-nav="up">← All groups</a>
        <p class="rv-pos"><strong>Group ${pos + 1} of ${groups.length}</strong> · ${plural(all.length, "face")}</p>
        <span class="rv-pn">
          <button type="button" class="btn ghost sm" data-act="prev-g" ${pos <= 0 ? raw("disabled") : ""}>◀ Previous</button>
          <button type="button" class="btn ghost sm" data-act="next-g" ${pos >= groups.length - 1 ? raw("disabled") : ""}>Skip group ▶</button>
        </span>
      </div>
      <div class="rv-grid">
        <div class="rv-stage">
          <img class="stage-face ${ex.has(cur.id) ? "is-ex" : ""}" src="${faceSvg(faceHue(g, cur), cur.id)}" alt="Face ${selIdx + 1} of ${all.length} (placeholder)">
          <p class="rv-facepos">Face ${selIdx + 1} of ${all.length}
            ${cur.setAside ? html`<span class="flag">small or blurry — left out</span>` : ""}
            ${ex.has(cur.id) ? html`<span class="flag">left out</span>` : ""}</p>
          <div class="rv-face-acts">
            <button type="button" class="btn secondary sm" data-act="ex" ${cur.setAside ? raw("disabled") : ""}>${ex.has(cur.id) ? "Put back in" : "Not the same person"} <kbd>x</kbd></button>
            <a class="btn ghost sm" href="${L(`/faces/groups/f${anchor}/photo/m${cur.mediaId}`)}">Open the photo</a>
          </div>
        </div>
        <div class="rv-side">
          <div class="name-panel">
            <label for="gr-name" class="np-q">Who is this?</label>
            ${sug ? html`<p class="sug-line">We think this is <button type="button" class="chip-btn" data-act="use-sug">${sug.name}</button></p>` : ""}
            <input id="gr-name" list="people-list" autocomplete="off" placeholder="Type a name…" value="${draft}">
            ${peopleDatalist()}
            <button type="button" class="btn primary big w" data-act="confirm">Name all ${included.length} faces →</button>
            <p class="fine">${ex.size ? `${plural(ex.size, "face")} left out — ${ex.size === 1 ? "it" : "they"}'ll come back in step 3. ` : ""}${
              all.some((/** @type {any} */ f) => f.setAside) ? "Faded faces are too small or blurry to name here. " : ""
            }Someone new? Just type their name.</p>
          </div>
          <div class="strip" role="group" aria-label="Every face in this group">
            ${all.map(
              (/** @type {any} */ f, /** @type {number} */ i) => html`<button type="button" class="strip-face ${i === selIdx ? "sel" : ""} ${ex.has(f.id) ? "is-ex" : ""} ${f.setAside ? "dim" : ""}"
                data-act="sel" data-face="${f.id}" aria-pressed="${i === selIdx}" aria-label="Face ${i + 1}${ex.has(f.id) ? ", left out" : ""}">
                <img src="${faceSvg(faceHue(g, f), f.id)}" alt="" width="56" height="56"></button>`,
            )}
          </div>
          <p class="fine keys"><kbd>←</kbd><kbd>→</kbd> face · <kbd>x</kbd> leave out · <kbd>Enter</kbd> name · <kbd>[</kbd><kbd>]</kbd> group</p>
        </div>
      </div>
    </div>`
  return withStepNav(
    {
      journey: "faces",
      step: "groups",
      title: `Group ${pos + 1} of ${groups.length}`,
      heading: "Name the big groups",
      compactIntro: true,
      abWork: html`<button type="button" class="btn primary" data-act="confirm">Name all ${included.length} →</button>`,
      body,
      status: `${plural(groups.length, "group")} left`,
      acts: {
        "prev-g": () => go(-1),
        "next-g": () => go(1),
        ex: toggleEx,
        sel: (el) => {
          selected.set(gi, Number(el.dataset.face))
          ctx.refresh()
        },
        "use-sug": () => {
          const i = /** @type {HTMLInputElement} */ (document.getElementById("gr-name"))
          if (sug) i.value = sug.name
          i.focus()
        },
        confirm,
      },
      keys: { ArrowLeft: () => pick(-1), ArrowRight: () => pick(1), x: toggleEx, "[": () => go(-1), "]": () => go(1), Enter: confirm },
      mount: (root) => {
        const i = root.querySelector("#gr-name")
        if (i instanceof HTMLInputElement)
          i.addEventListener("input", () => {
            nameDraft.set(gi, i.value)
            i.removeAttribute("aria-invalid")
          })
      },
    },
    false,
  )
}

/** The photo a face is in, as a dialog route over whatever screen opened it.
 *  @param {Screen} under @param {string} mediaParam @param {number} faceId @returns {Screen} */
export function photoDialog(under, mediaParam, faceId) {
  const mediaId = Number(mediaParam.slice(1))
  const hue = hueOfFace(faceId)
  const figures = [
    { hue: (hue + 140) % 360, x: 0.2, y: 0.46, s: 0.14 },
    { hue, x: 0.5, y: 0.42, s: 0.16 },
    { hue: (hue + 60) % 360, x: 0.78, y: 0.47, s: 0.13 },
  ]
  const who = db.assigned[faceId] ? personById(db.assigned[faceId]).name : "Not named yet"
  under.dialog = {
    title: `Photo #${mediaId}`,
    body: html`<div class="photo-wrap">
        <img class="photo" src="${sceneSvg(mediaId, { figures })}" alt="Placeholder photo with three figures">
        <span class="facebox" style="left:${(0.5 - 0.12) * 100}%;top:${(0.42 - 0.22) * 100}%;width:24%;height:40%"></span>
      </div>
      <ul class="photo-faces">
        <li class="on"><img src="${faceSvg(hue, faceId)}" alt="" width="40" height="40"> This face · <strong>${who}</strong></li>
        <li><img src="${faceSvg(figures[0].hue, faceId + 7)}" alt="" width="40" height="40"> Left · <span class="fine">set aside (small)</span></li>
        <li><img src="${faceSvg(figures[2].hue, faceId + 9)}" alt="" width="40" height="40"> Right · <span class="fine">not named</span></li>
      </ul>
      <p class="fine">Back, Esc, or ✕ closes this and returns you to exactly where you were.</p>`,
  }
  under.title = `Photo #${mediaId}`
  return under
}

// ---------------- Step 3: ask ----------------

/** @param {Ctx} ctx @param {string | null} faceParam @returns {Screen} */
export function askScreen(ctx, faceParam) {
  const open = openAsk()
  const waiting = waitingAsk()
  const known = knownPeople()
  if (!faceParam || open.length === 0) {
    const body =
      known.length === 0 || (open.length === 0 && waiting.length > 0)
        ? html`<div class="empty-done wait"><h2>Name a group first</h2>
            <p>These questions compare each face with people you've already named — so they appear once at least one group has a name.
            ${waiting.length ? `${plural(waiting.length, "question")} will be ready.` : ""}</p>
            <a class="btn primary" href="${L("/faces/groups")}">← Go to step 2</a></div>`
        : html`<div class="empty-done"><div class="big-check sm" aria-hidden="true">✓</div>
            <h2>All answered</h2><p>Nothing left to ask. Next, check a few near-copies.</p></div>`
    return withStepNav(
      { journey: "faces", step: "ask", title: "Answer the hard ones", body, status: open.length ? "" : waiting.length ? "Waiting on step 2" : "Step finished" },
      open.length === 0 && waiting.length === 0,
    )
  }
  const faceId = Number(faceParam.slice(1))
  let at = open.findIndex((/** @type {any} */ a) => a.id === faceId)
  if (at === -1) at = 0
  const item = open[at]
  const total = open.length
  const where = `Name the faces · Question ${at + 1} of ${total}`
  const cands = item.candidates.map((/** @type {number} */ c) => personById(c))
  const sure = item.margin >= 0.08 ? "fairly sure" : item.margin >= 0.05 ? "leaning" : "close call"
  const advance = () => {
    const rest = openAsk()
    const nxt = rest[at] || rest[0]
    ctx.nav(nxt ? "/faces/ask/f" + nxt.id : "/faces/ask", { replace: true })
  }
  /** @param {any} p */
  const answer = (p) =>
    withSession(where, () => {
      const batch = assign([item.id], p.id, "ask")
      toast(`That's ${p.name}.`, () => {
        undoBatch(batch)
        ctx.refresh()
      })
      advance()
    })
  const skip = () => {
    const nxt = open[at + 1] || open[0]
    if (nxt && nxt.id !== item.id) ctx.nav("/faces/ask/f" + nxt.id, { replace: true })
    else toast("That's the only one left.")
  }
  const notFace = () =>
    withSession(where, () => {
      db.notFace[item.id] = true
      save()
      toast("Marked as not a face.", () => {
        delete db.notFace[item.id]
        save()
        ctx.refresh()
      })
      advance()
    })
  const body = html`<div class="ask">
      <div class="ask-meta">
        <span class="bar"><i style="width:${Math.round((at / total) * 100)}%"></i></span>
        <p><strong>${plural(total, "question")} left</strong> · answering this one names about ${plural(item.unlocks, "more photo")}</p>
      </div>
      <div class="ask-card">
        <img class="stage-face" src="${faceSvg(personById(item.truth).hue, item.id)}" alt="The face in question (placeholder)">
        <div class="ask-q">
          <h2>Is this…</h2>
          <div class="cands">${cands.map(
            (/** @type {any} */ p, /** @type {number} */ i) => html`<button type="button" class="cand" data-act="pick" data-i="${i}">
              <kbd>${i + 1}</kbd>${raw(monogram(p.name, p.hue))}<span>${p.name}</span>
              ${i === 0 ? html`<em class="fine">${sure}</em>` : ""}</button>`,
          )}</div>
          <details class="else"><summary>Someone else…</summary>
            <input id="ask-name" list="people-list" placeholder="Type a name" autocomplete="off">${peopleDatalist()}
            <button type="button" class="btn secondary sm" data-act="else">That's them</button></details>
          <div class="ask-acts">
            <button type="button" class="btn ghost" data-act="skip"><kbd>s</kbd> Not sure — skip</button>
            <a class="btn ghost" href="${L(`/faces/ask/f${item.id}/photo/m${item.mediaId}`)}">Open the photo</a>
            <button type="button" class="btn ghost danger-t" data-act="notface"><kbd>x</kbd> Not a face</button>
          </div>
        </div>
      </div>
    </div>`
  return withStepNav(
    {
      journey: "faces",
      step: "ask",
      title: `Question ${at + 1} of ${total}`,
      body,
      status: `${plural(total, "question")} left`,
      acts: {
        pick: (el) => answer(cands[Number(el.dataset.i)]),
        skip,
        notface: notFace,
        else: () => {
          const v = /** @type {HTMLInputElement} */ (document.getElementById("ask-name")).value
          const p = personForName(v)
          if (p) answer(p)
        },
      },
      keys: {
        "1": () => cands[0] && answer(cands[0]),
        "2": () => cands[1] && answer(cands[1]),
        "3": () => cands[2] && answer(cands[2]),
        s: skip,
        x: notFace,
      },
    },
    false,
  )
}

// ---------------- Step 4: same moment ----------------

/** @param {Ctx} ctx @returns {Screen} */
export function sameMomentScreen(ctx) {
  const items = openSameMoment()
  const where = "Name the faces · Same moment"
  /** @param {any[]} list */
  const accept = (list) =>
    withSession(where, () => {
      for (const s of list) db.assigned[s.id] = db.assigned[s.fromFaceId]
      db.batches.unshift({ id: db.batches.length + 1, kind: "same moment", personId: null, faces: list.map((s) => s.id), at: "just now", revoked: false })
      save()
      toast(`Accepted ${plural(list.length, "photo")}.`)
      ctx.refresh()
    })
  const body = items.length
    ? html`<div class="callout"><button type="button" class="btn primary big" data-act="all">Yes to all ${items.length} →</button>
        <p class="fine">Each pair was taken moments apart and the faces sit in the same spot. Names added this way are never used to recognise anyone else.</p></div>
      <ul class="pairs">${items.map((/** @type {any} */ s) => {
        const p = personById(db.assigned[s.fromFaceId])
        const hue = hueOfFace(s.id)
        return html`<li class="pair">
          <img src="${faceSvg(hue, s.fromFaceId)}" alt="" width="64" height="64"><span class="arrow" aria-hidden="true">→</span>
          <img src="${faceSvg(hue, s.id)}" alt="" width="64" height="64">
          <div class="pm"><strong>${p.name}</strong><span class="fine">photo #${s.mediaId}, a second later</span></div>
          <div class="pa"><button type="button" class="btn secondary sm" data-act="one" data-id="${s.id}">Yes, same person</button>
            <button type="button" class="btn ghost sm" data-act="later" data-id="${s.id}">Not now</button></div>
        </li>`
      })}</ul>`
    : html`<div class="empty-done"><div class="big-check sm" aria-hidden="true">✓</div><h2>Nothing to check</h2>
        <p>${Object.keys(db.assigned).length ? "Every near-copy is taken care of." : "These appear after you've named some groups."}</p></div>`
  return withStepNav(
    {
      journey: "faces",
      step: "moment",
      title: "Same moment, same person",
      body,
      status: items.length ? `${plural(items.length, "pair")} to check` : "Step finished",
      acts: {
        all: () => accept(items),
        one: (el) => accept(items.filter((/** @type {any} */ s) => s.id === Number(el.dataset.id))),
        later: (el) => {
          const li = el.closest("li")
          if (li) li.remove()
        },
      },
    },
    items.length === 0,
  )
}

// ---------------- Step 5: check ----------------

/** @param {Ctx} ctx @param {string} tab @param {string | null} personParam @returns {Screen} */
export function checkScreen(ctx, tab, personParam) {
  const t = faceTotals()
  const tabs = html`<div class="seg" role="tablist" aria-label="Check the results">
    ${[
      ["people", "People", "/faces/check"],
      ["set-aside", "Set aside", "/faces/check/set-aside"],
      ["history", "History", "/faces/check/history"],
    ].map(
      ([id, label, to]) => html`<a role="tab" href="${L(to)}" data-nav="replace" aria-selected="${tab === id}" class="${tab === id ? "on" : ""}">${label}</a>`,
    )}
  </div>`
  let inner
  if (personParam) {
    const p = personById(Number(personParam.slice(1)))
    const ids = facesOf(p.id)
    inner = html`<div class="rv-top"><a class="btn ghost sm" href="${L("/faces/check")}" data-nav="up">← Everyone</a>
        <p class="rv-pos">${raw(monogram(p.name, p.hue))} <strong>${p.name}</strong> · ${plural(ids.length, "face")}</p></div>
      <p class="fine">Any face that isn't ${p.name}? Remove it and it goes back to be named again.</p>
      <ul class="face-grid">${ids.map(
        (f) => html`<li><img src="${faceSvg(hueOfFace(f), f)}" alt="" width="96" height="96">
          <button type="button" class="btn ghost sm" data-act="unassign" data-face="${f}">Not ${p.name.split(" ")[0]}</button></li>`,
      )}</ul>`
  } else if (tab === "history") {
    inner = db.batches.length
      ? html`<ul class="hist">${db.batches.map(
          (/** @type {any} */ b) => html`<li class="${b.revoked ? "revoked" : ""}"><span><strong>${b.kind}</strong> · ${plural(b.faces.length, "face")}
            ${b.personId ? html` as ${personById(b.personId).name}` : ""} · ${b.at}</span>
            ${b.revoked ? html`<span class="fine">undone</span>` : html`<button type="button" class="btn ghost sm" data-act="revoke" data-id="${b.id}">Undo this</button>`}</li>`,
        )}</ul>`
      : html`<p class="fine">Nothing yet. Every naming you do is listed here and can be undone.</p>`
  } else if (tab === "set-aside") {
    inner = html`<p>23 faces were too small or blurry to put in the queue. They're still here — open a photo to name them by hand.</p>
      <ul class="tiles">${[402, 417, 431, 446].map(
        (m) => html`<li><a class="tile photo-tile" href="${L(`/faces/check/set-aside/photo/m${m}`)}">
          <img src="${sceneSvg(m)}" alt="Placeholder photo #${m}"><span>Photo #${m} · 2 set aside</span></a></li>`,
      )}</ul>`
  } else {
    const named = knownPeople()
    inner = named.length
      ? html`<ul class="people-grid big">${named.map((/** @type {any} */ p) => {
          const ids = facesOf(p.id)
          return html`<li><a class="person card-link" href="${L(`/faces/check/p${p.id}`)}">
            ${raw(monogram(p.name, p.hue))}<div><strong>${p.name}</strong><span class="fine">${plural(ids.length, "face")}</span></div>
            <span class="chips">${ids.slice(0, 4).map((f) => raw(faceImg(hueOfFace(f), f, "chip")))}</span></a></li>`
        })}</ul>`
      : html`<p class="fine">No one named yet.</p>`
  }
  const body = html`<div class="kpis"><div><strong>${t.named}</strong><span>named</span></div>
      <div><strong>${t.left}</strong><span>still to do</span></div><div><strong>${t.notFace}</strong><span>not faces</span></div></div>
    ${personParam ? "" : tabs}${inner}`
  return withStepNav(
    {
      journey: "faces",
      step: "check",
      title: personParam ? "Person" : "Check the results",
      body,
      status: `${t.named} of ${t.total} named`,
      acts: {
        unassign: (el) =>
          withSession("Name the faces · Check the results", () => {
            delete db.assigned[Number(el.dataset.face)]
            save()
            toast("Removed. It'll come back to be named.")
            ctx.refresh()
          }),
        revoke: (el) =>
          withSession("Name the faces · History", () => {
            const b = db.batches.find((/** @type {any} */ x) => x.id === Number(el.dataset.id))
            if (b) undoBatch(b)
            toast("Undone.")
            ctx.refresh()
          }),
      },
    },
    true,
  )
}

/** Set by app.js so a step can re-render itself. */
let refreshHook = () => {}
/** @param {() => void} fn */
export function setRefresh(fn) {
  refreshHook = fn
}

export { liveFaces }
