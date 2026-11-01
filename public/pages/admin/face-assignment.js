/** @file Name faces — the Workspace design (prototypes/admin-workspace/views/
 *  faces.js, IA §5 B, §8). A four-step walk instead of seven stacked sections:
 *
 *    ① Groups → ② Quick questions → ③ Same moment → ④ Leftovers
 *
 *  with People and History as reference tabs beside the stepper. Every step,
 *  and the photograph dialog, is a route (routes.js), so Back undoes
 *  navigation, a reload lands on the same screen, and nothing is more than one
 *  click away.
 *
 *  THE URL NAMES A FACE, NOT A GROUP. `/admin/faces/groups/f1240` is "the group
 *  face 1240 is in, with 1240 on the stage". Groups are recomputed from live
 *  rows on every request, so a position ("group 3") means something different
 *  after any naming; a face id does not. A face that has since been named
 *  resolves to a "Named Rosa" card (with Undo when it was named here), a
 *  dismissed one says so, and one that is gone says that — never a different
 *  group. `reloadAnchoredOnFace` and `anchorAfter` are the two helpers that
 *  keep that promise after a mutation.
 *
 *  THE STEPS, against the server's lists:
 *   - Groups = clusters of two or more faces (the overview, clearest first).
 *     The middle pane is the old review view: one face large off the `display`
 *     variant, and a filmstrip of EVERY face in the group, set-aside members
 *     dimmed and labelled "unclear". A bulk confirm names exactly the shown,
 *     not-left-out faces (`group.faceIds` minus exclusions) and never a
 *     set-aside one — the server refuses those, and the count on the button is
 *     the honest number for that reason.
 *   - Quick questions = the groups of one: faces nothing else looked like. The
 *     ask queue supplies their candidates and `unlocks` (it ranks every
 *     unidentified face, so it would duplicate Groups if listed whole).
 *   - Same moment = must-link propagations, ticked, confirmed as one pass.
 *   - Leftovers = photographs holding set-aside faces (GET faces/set-aside).
 *     Routing withholds those from every list of FACES and bulk assign refuses
 *     them by design; the per-photograph dialog names them one at a time
 *     through POST faces/assign-one, the deliberate single-face exemption.
 *
 *  PEOPLE, NOT GUESTS. Faces are named against a `people` row; a guest is an
 *  INVITATION and much of the cast is not on that list. A person carries an
 *  optional `guestId` link. Assigning by name is not an API shape: the picker
 *  resolves to a personId, and a new person is only ever created by an explicit
 *  "+ New person" — a same-name create asks first (the server refuses one
 *  without `confirmDuplicate`).
 *
 *  UNDO. Every bulk write returns a `batchId`; the Undo toast (and `z`) revokes
 *  that pass, and History lists every pass with "Undo this". Revoking deletes
 *  nothing and a later hand correction survives it — the copy says so, because
 *  an admin who thinks undo is destructive will not use it.
 *
 *  NO CROP ENDPOINT. A face is shown by loading its photo's `display` (or
 *  `thumb`, chip-variant.js) variant and cropping to the box client-side; the
 *  box is in ORIGINAL pixels, so every chip entry carries the original
 *  width/height. A missing dimension degrades to an uncropped image.
 *
 *  Photographs are input to code (CLAUDE.md): every accessible name here is
 *  built from ids, counts and names an admin typed. Nothing describes a
 *  photograph or who is in it, and every <img> is alt="". */
/** @import * as Types from "./types.js" */

import { api, showError, showSuccess, showUndo, showLoading, showLoadError } from "./utils.js"
import { html, getElement, getErrorMessage } from "../utils.js"
import { openConfirm } from "./confirm.js"
import { chipVariant } from "./chip-variant.js"
import { guestChoices, resolveGuestChoice, suggestGuests } from "./guest-match.js"
import { icon } from "./icons.js"
import { registerPanel, navigate, setCrumbs, setNavBadge, currentPlace } from "./router.js"

/** The stage crops to the box widened by this much about its centre: hair and
 *  shoulders make a face far easier to place, and a wider crop is more SOURCE
 *  pixels in the same square, so the upscale from `display` falls with it. */
const STAGE_PAD = 1.6

/** Chip sizes in CSS px, mirrored from admin-faces.css. Used only to choose a
 *  variant, so drift costs a sharper-or-blurrier chip, never a broken one. */
const CHIP_PX = Object.freeze({ mini: 26, row: 40, strip: 64, grid: 72 })

/** Fallback size when a chip's container has not been laid out yet. */
const CHIP_FALLBACK = 40

/** Set-aside photographs per request; the list is fetched whole (it is the
 *  Leftovers grid and its count), a page at a time. */
const SET_ASIDE_PAGE = 100

/** How many people the "someone else" type-ahead lists. */
const WHO_MAX = 6

const WIDE = "(min-width: 900px)"
const NAMED_KEY = "admin-faces-named"
const ORDER_KEY = "admin-faces-order"

/** Why routing held a face back, in the words a person would use. Keys are
 *  public/vision/gate.js's checks; anything new falls back to "unclear". */
const REASONS = /** @type {Record<string, string>} */ ({
  score: "the camera wasn't sure it's a face",
  boxPx: "small",
  border: "at the edge of the photo",
  eyeRatioLow: "turned to the side",
  eyeRatioHigh: "turned to the side",
  residual: "at an odd angle",
  alignScale: "hard to line up",
  outside: "partly out of the photo",
  sharpness: "blurry",
})

// ------------------------------------------------------------------- state

/** @type {Types.FacesOverviewResponse | null} */
let overview = null
/** @type {Types.FacesQueueResponse | null} */
let queueData = null
/** @type {Types.FacePropagationsResponse | null} */
let propagationData = null
/** Every photograph holding a set-aside face (the Leftovers grid). */
/** @type {Types.FaceSetAsidePhoto[]} */
let setAsidePhotos = []
/** @type {Types.FacesBatchesResponse | null} */
let batchesData = null
/** @type {string | null} */
let batchesError = null
/** @type {Types.PersonEntry[]} */
let peopleData = []
/** Guest roster, only for linking a person to an invitation. Each carries a
 *  type-ahead label that tells namesakes apart. */
/** @type {Types.GuestChoice[]} */
let guestOptions = []
let guestsLoaded = false
/** A person's faces for the People page, by person id. */
/** @type {Map<number, { faces: Types.FaceChipEntry[], total: number }>} */
const personFaces = new Map()

let loaded = false
/** Set by every write: the next arrival refetches before drawing. */
let stale = true
/** @type {Promise<void> | null} */
let inflight = null

/** @type {Types.FacesPlace} */
let place = { view: "root", face: null, person: null, media: null, photoFace: null }

/** Faces left out of a group before naming it: face id → the group key it was
 *  left out of. Keyed by face, checked against the key, so a regroup that moves
 *  a left-out face into a different group never carries the judgement along. */
const excluded = /** @type {Map<number, number>} */ (new Map())

/** @type {"size" | "varied"} */
let groupOrder = readSession(ORDER_KEY) === "varied" ? "varied" : "size"

/** Decisions made this session (FacesNamedEntry). */
/** @type {Types.FacesNamedEntry[]} */
let named = readNamed()

/** Faces / people with a write in flight — a held-down key fires once. */
const pending = /** @type {Set<number>} */ (new Set())
const pendingPeople = /** @type {Set<number>} */ (new Set())

/** Same-moment rows the admin unticked. */
const unticked = /** @type {Set<number>} */ (new Set())

/** The "someone else" text, kept across re-renders of the same item. */
let whoText = ""
/** Which item `whoText` belongs to ("group:182"). */
let whoFor = ""

/** The People page's open editor. */
/** @type {{ id: number, mode: "rename" | "merge" | "link" } | null} */
let personEdit = null

// ---------------------------------------------------------------- session

/** @param {string} key */
function readSession(key) {
  try {
    return sessionStorage.getItem(key) ?? ""
  } catch {
    return ""
  }
}

/** @param {string} key @param {string} value */
function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Private mode: it lasts as long as the page.
  }
}

/** @returns {Types.FacesNamedEntry[]} */
function readNamed() {
  try {
    const parsed = JSON.parse(readSession(NAMED_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveNamed() {
  // A short memory: this is "what I just did", not a history (History is).
  named = named.slice(0, 60)
  writeSession(NAMED_KEY, JSON.stringify(named))
}

/** The live session entry a face belongs to, if any. @param {number} faceId */
function namedEntryFor(faceId) {
  const hit = named.find((e) => !e.revoked && (e.anchor === faceId || e.faceIds.includes(faceId)))
  return hit ?? null
}

// ------------------------------------------------------------------- utils

const isWide = () => window.matchMedia(WIDE).matches

/**
 * Fold a name to its comparison key. MIRRORS `nameKey` in db/people.js, the
 * authority — the server refuses a same-name create on the same rule. NFC
 * first (a combining accent and a precomposed one look the same), then a
 * Unicode-aware lower-case. String methods only.
 * @param {string} name
 */
function nameKey(name) {
  return name.normalize("NFC").trim().toLowerCase()
}

/** "f1240" → 1240 (a bare number works too); anything else → null.
 *  @param {string | undefined | null} value @param {string} prefix */
function parseId(value, prefix) {
  if (!value) return null
  const digits = value.startsWith(prefix) ? value.slice(prefix.length) : value
  if (digits === "" || [...digits].some((c) => c < "0" || c > "9")) return null
  const n = Number(digits)
  return n > 0 ? n : null
}

/** @param {number} n @param {string} one @param {string} many */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

/** The first word of a name, for the big button ("name 12 faces Rosa").
 *  @param {string} name */
function firstName(name) {
  const word = name.trim().split(" ")[0]
  return word || name
}

/** @param {number} faceId */
const groupHref = (faceId) => `/admin/faces/groups/f${faceId}`
/** @param {number} faceId */
const askHref = (faceId) => `/admin/faces/ask/f${faceId}`
/** @param {number} personId */
const personHref = (personId) => `/admin/faces/people/p${personId}`

/** The path of the screen under a photograph dialog, which is where the
 *  dialog's own path starts. */
function screenPath() {
  if (place.view === "groups" && place.face !== null) return groupHref(place.face)
  if (place.view === "ask" && place.face !== null) return askHref(place.face)
  if (place.view === "people" && place.person !== null) return personHref(place.person)
  if (place.view === "same-moment") return "/admin/faces/same-moment"
  return "/admin/faces/leftovers"
}

/** A photograph dialog over the current screen.
 *  @param {number | null} mediaId @param {number | null} [faceId] select this face */
function photoHref(mediaId, faceId = null) {
  if (mediaId === null) return ""
  const base = `${screenPath()}/photos/m${mediaId}`
  // The stage face is already the dialog's selection; only say it otherwise.
  return faceId !== null && faceId !== place.face ? `${base}?face=f${faceId}` : base
}

/** A person's initials on a hue, like the prototype's avatar. Inline SVG
 *  presentation attributes are not inline styles, so the CSP allows them.
 *  @param {{ id: number, name: string }} p */
function avatar(p, size = "") {
  const parts = p.name.split(" ").filter((w) => w.length > 0 && w !== "&")
  const first = parts[0] ? [...parts[0]][0] : "?"
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] : ""
  const hue = (p.id * 47) % 360
  return html`<span class="avatar ${size}"
    ><svg class="art" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="hsl(${hue} 40% 55%)" />
      <text x="20" y="25" text-anchor="middle" font-size="14" fill="#fff">${first}${last}</text>
    </svg></span
  >`
}

/** POST a JSON body to an admin endpoint. @param {string} path @param {unknown} body */
function post(path, body) {
  return api(path, { method: "POST", body: JSON.stringify(body) })
}

/** @param {number} personId */
function personById(personId) {
  return peopleData.find((p) => p.id === personId) ?? null
}

/** A ledger timestamp, local and readable. `created_at` is SQLite's unmarked
 *  UTC ("YYYY-MM-DD HH:MM:SS"); `revoked_at` is ISO. The unmarked form is
 *  completed into UTC first, or a pass made an hour ago claims to be from the
 *  future. @param {string | null} value */
function ledgerTime(value) {
  if (!value) return ""
  const iso = value.includes("T") ? value : value.split(" ").join("T") + "Z"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  const mins = Math.round((Date.now() - date.getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// -------------------------------------------------------------- the steps

/** Groups of two or more, in list order — the order j/k and "next" walk. `size`
 *  is the server's (clearest, then largest); `varied` spends the weld score as
 *  an ordering, the only use a signal that weak is fit for. */
function groupsLeft() {
  if (!overview) return []
  const groups = overview.groups.filter((g) => g.size >= 2)
  if (groupOrder !== "varied") return groups
  return [...groups].sort((a, b) => (b.weld?.ratio ?? 0) - (a.weld?.ratio ?? 0) || b.size - a.size)
}

/** The Quick questions: groups of one, most-unlocking first.
 *  @returns {Types.FacesAskItem[]} */
function askLeft() {
  if (!overview) return []
  const queue = queueData ? queueData.items : []
  const rank = new Map(queue.map((item, i) => [item.faceId, i]))
  const byFace = new Map(queue.map((item) => [item.faceId, item]))
  /** @type {Types.FacesAskItem[]} */
  const items = []
  for (const g of overview.groups) {
    if (g.size !== 1 || g.media.length !== 1) continue
    const entry = g.media[0]
    const q = byFace.get(entry.faceId)
    items.push({
      faceId: entry.faceId,
      entry,
      candidates: q
        ? q.candidates
        : g.candidates.map((c) => ({ personId: c.personId, personName: c.personName })),
      unlocks: q ? q.unlocks : null,
      routeState: q ? q.routeState : null,
      routeReason: q ? q.routeReason : null,
    })
  }
  const last = Number.MAX_SAFE_INTEGER
  return items.sort((a, b) => (rank.get(a.faceId) ?? last) - (rank.get(b.faceId) ?? last))
}

function propsLeft() {
  return propagationData ? propagationData.items : []
}

function leftoversLeft() {
  return setAsidePhotos.filter((p) => p.unnamedSetAside > 0)
}

/** Every face in a group, filmstrip order: the bulk-nameable ones, then the
 *  ones routing held back. Merged here for DISPLAY only — `faceIds` (what a
 *  bulk confirm posts) is the first list alone.
 *  @param {Types.FaceGroup} g
 *  @returns {Array<{ entry: Types.FaceChipEntry, setAside: boolean }>} */
function membersOf(g) {
  return [
    ...g.media.map((entry) => ({ entry, setAside: false })),
    ...g.setAsideMedia.map((entry) => ({ entry, setAside: true })),
  ]
}

/** @param {number} faceId */
function groupOfFace(faceId) {
  if (!overview) return null
  return (
    overview.groups.find(
      (g) => g.faceIds.includes(faceId) || g.setAsideMedia.some((m) => m.faceId === faceId),
    ) ?? null
  )
}

/** @param {Types.FaceGroup} g @param {number} faceId */
function isExcluded(g, faceId) {
  return excluded.get(faceId) === g.key
}

/** What a confirm on this group names: shown, minus the left-out.
 *  @param {Types.FaceGroup} g */
function nameableIds(g) {
  return g.faceIds.filter((id) => !isExcluded(g, id))
}

/** @param {Types.FaceGroup} g */
function leftOutIds(g) {
  return g.faceIds.filter((id) => isExcluded(g, id))
}

/** A face in this group that will still exist after `faceId` is named or
 *  dismissed — the next one along, else the previous. Null when it was the last.
 *  @param {Types.FaceGroup} g @param {number} faceId */
function anchorAfter(g, faceId) {
  const faces = membersOf(g)
  const i = faces.findIndex((f) => f.entry.faceId === faceId)
  if (i === -1) return null
  const next = faces[i + 1] ?? faces[i - 1]
  return next ? next.entry.faceId : null
}

/** The step a screen belongs to, the first one with work, and its path. */
const STEPS = /** @type {const} */ ([
  ["groups", "Groups", "/admin/faces/groups", "Name the groups"],
  ["ask", "Quick questions", "/admin/faces/ask", "Answer quick questions"],
  ["same-moment", "Same moment", "/admin/faces/same-moment", "Confirm same-moment matches"],
  ["leftovers", "Leftovers", "/admin/faces/leftovers", "Check the leftovers"],
])

/** @param {string} key */
function stepCount(key) {
  if (key === "groups") return groupsLeft().length
  if (key === "ask") return askLeft().length
  if (key === "same-moment") return propsLeft().length
  return leftoversLeft().length
}

function firstUnfinished() {
  const step = STEPS.find((s) => stepCount(s[0]) > 0)
  return step ? step[2] : "/admin/faces/leftovers"
}

// ------------------------------------------------------------------- data

/** @type {Types.loadFaceAssignment} */
export async function loadFaceAssignment() {
  stale = true
  await ensureLoaded()
  render()
}

/** Reload requests made, and the newest one a finished fetch has covered. */
let requested = 0
let fetched = 0

/** Fetch everything the steps count — one fetch at a time, and never handing
 *  a caller data older than its call: a fetch already in flight when an undo
 *  lands started before it, so the caller waits for the next one. */
async function ensureLoaded() {
  const want = ++requested
  while (fetched < want) {
    if (!inflight) {
      const covers = requested
      inflight = fetchAll()
        .then(() => {
          fetched = covers
        })
        .finally(() => {
          inflight = null
        })
    }
    await inflight
  }
}

async function fetchAll() {
  const anchorQ = place.face !== null ? `?face=${place.face}` : ""
  const [ov, q, p] = await Promise.all([
    api(`/api/admin/faces/overview${anchorQ}`),
    api("/api/admin/faces/queue"),
    api("/api/admin/faces/propagations"),
    refreshPeople(),
    refreshSetAside(),
    ensureGuestsLoaded(),
  ])
  overview = /** @type {Types.FacesOverviewResponse} */ (ov)
  queueData = /** @type {Types.FacesQueueResponse} */ (q)
  propagationData = /** @type {Types.FacePropagationsResponse} */ (p)
  // A left-out face that is no longer in the group it was left out of has
  // been named, regrouped or dismissed: the judgement no longer applies.
  for (const [faceId, key] of excluded) {
    const g = groupOfFace(faceId)
    if (!g || g.key !== key) excluded.delete(faceId)
  }
  for (const id of unticked) {
    if (!propsLeft().some((x) => x.toFaceId === id)) unticked.delete(id)
  }
  personFaces.clear()
  loaded = true
  stale = false
  setNavBadge("faces", groupsLeft().length + askLeft().length)
}

/** The people list (the picker and People). Non-fatal. */
async function refreshPeople() {
  try {
    const data = /** @type {Types.PeopleApiResponse} */ (await api("/api/admin/people"))
    peopleData = data.people
  } catch (err) {
    console.error("Failed to load people:", err)
  }
}

/** Every set-aside photograph, a page at a time. Non-fatal: Leftovers says so. */
async function refreshSetAside() {
  /** @type {Types.FaceSetAsidePhoto[]} */
  const all = []
  try {
    for (;;) {
      const page = /** @type {Types.FacesSetAsideResponse} */ (
        await api(`/api/admin/faces/set-aside?limit=${SET_ASIDE_PAGE}&offset=${all.length}`)
      )
      all.push(...page.photos)
      if (page.photos.length === 0 || all.length >= page.total) break
    }
    setAsidePhotos = all
  } catch (err) {
    console.error("Failed to load the set-aside photographs:", err)
  }
}

/** The guest roster, once, for "Link to a guest". Non-fatal. */
async function ensureGuestsLoaded() {
  if (guestsLoaded) return
  try {
    const data = /** @type {Types.GuestsApiResponse} */ (
      await api("/api/admin/guests?limit=1000&offset=0")
    )
    guestOptions = guestChoices(
      data.guests.map((g) => ({
        id: g.id,
        name: g.name,
        email: g.email,
        phone: g.phone,
        inviteCode: g.invite_code,
      })),
    )
    guestsLoaded = true
    const dl = document.getElementById("faces-guest-roster")
    const options = guestOptions.map((g) => html`<option value="${g.label}"></option>`)
    if (dl) dl.innerHTML = html`${options}`
  } catch (err) {
    console.error("Failed to load the guest roster:", err)
  }
}

async function refreshBatches() {
  try {
    batchesData = /** @type {Types.FacesBatchesResponse} */ (await api("/api/admin/faces/batches"))
    batchesError = null
  } catch (err) {
    console.error("Failed to load the history:", err)
    batchesError = "Couldn't load the history."
  }
}

/** @param {number} personId */
async function loadPersonFaces(personId) {
  if (personFaces.has(personId)) return
  try {
    const data = /** @type {Types.PeopleApiResponse} */ (
      await api(`/api/admin/people?faces=${personId}`)
    )
    if (data.personFaces) {
      personFaces.set(personId, { faces: data.personFaces.faces, total: data.personFaces.total })
    }
  } catch (err) {
    console.error("Failed to load that person's faces:", err)
  }
  if (place.view === "people" && place.person === personId && isShowing()) render()
}

/** Whether the Name-faces panel is the one on screen. */
function isShowing() {
  return currentPlace()?.route.tab === "faces"
}

/**
 * Reload, then put the screen back where it was, anchored on a FACE rather than
 * on a group: naming removes faces from the pool the clustering runs over, so
 * a group's membership moves under any mutation, and the face id that survived
 * it finds whichever group now holds those same people. When nothing survived,
 * the step's list is the honest answer: that group is done.
 * @param {number | null} anchorFaceId
 */
async function reloadAnchoredOnFace(anchorFaceId) {
  stale = true
  await ensureLoaded()
  if (!isShowing()) return
  const view = place.view === "ask" ? "ask" : "groups"
  let target = `/admin/faces/${view}`
  if (anchorFaceId !== null) {
    target = view === "ask" ? askHref(anchorFaceId) : groupHref(anchorFaceId)
  }
  if (target === location.pathname) render()
  else void navigate(target, { replace: true })
}

/** After a write: refetch in the background and redraw what is showing. The
 *  screen has already moved on (advance-after-act) from local state. */
function refreshSoon() {
  stale = true
  void ensureLoaded()
    .then(() => {
      if (isShowing()) render()
    })
    .catch((err) => console.error("Failed to refresh faces:", err))
}

// ------------------------------------------------------------------ chips

/**
 * One face, cropped from its photo's variant to the face's box. The `<img>` is
 * shared by every size here (row chip, filmstrip, stage, dialog); only the
 * container differs, and positionFaceChipImage measures it.
 * @param {Types.FaceChipEntry} entry @param {number} pad @param {number} cssPx
 */
function faceImg(entry, pad, cssPx) {
  const box = entry.box ?? { x: 0, y: 0, w: 0, h: 0 }
  const variant = chipVariant(entry, pad, cssPx, window.devicePixelRatio || 1)
  return html`<img class="face-chip-img" src="/media/${entry.fileKey ?? ""}/${variant}" alt=""
    data-fallback="/media/${entry.fileKey ?? ""}/thumb"
    data-orig-w="${entry.width ?? ""}" data-orig-h="${entry.height ?? ""}"
    data-box-x="${box.x}" data-box-y="${box.y}" data-box-w="${box.w}" data-box-h="${box.h}"
    data-pad="${pad}" loading="lazy" />`
}

/** @param {Types.FaceChipEntry} entry @param {string} [cls] @param {number} [px] */
function chip(entry, cls = "", px = CHIP_PX.row) {
  return html`<span class="chip-face ${cls}">${faceImg(entry, 1, px)}</span>`
}

/** Position every chip under `root` once its image has a natural size.
 *  @param {ParentNode} root */
function wireChips(root) {
  root.querySelectorAll(".photo-thumb img").forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return
    img.addEventListener("error", () => (img.hidden = true), { once: true })
  })
  root.querySelectorAll(".face-chip-img").forEach((img) => {
    if (!(img instanceof HTMLImageElement) || img.dataset.wired) return
    img.dataset.wired = "1"
    // Not `once`: the fallback swaps `src`, and the replacement's natural size
    // differs, so positioning has to run again.
    img.addEventListener("load", () => positionChip(img))
    img.addEventListener("error", () => {
      const fallback = img.dataset.fallback
      // Once to the smaller copy; if that fails too, an empty chip beats a
      // broken-image icon.
      if (fallback && !img.src.endsWith(fallback)) img.src = fallback
      else img.hidden = true
    })
    if (img.complete && img.naturalWidth) positionChip(img)
    else if (img.complete && img.src.endsWith(img.dataset.fallback ?? "")) img.hidden = true
  })
}

/**
 * Scale and offset the image so the face's box (widened by `data-pad`) covers
 * its container. `naturalWidth / origWidth` is the one scale between the box's
 * coordinates and the loaded variant's. Missing geometry bails, leaving the
 * plain `object-fit: cover` image — degraded, not broken.
 * @param {HTMLImageElement} img
 */
function positionChip(img) {
  const origW = Number(img.dataset.origW)
  const origH = Number(img.dataset.origH)
  const boxX = Number(img.dataset.boxX)
  const boxY = Number(img.dataset.boxY)
  const boxW = Number(img.dataset.boxW)
  const boxH = Number(img.dataset.boxH)
  if (!origW || !origH || !boxW || !boxH || !img.naturalWidth || !img.naturalHeight) return
  const parent = img.parentElement
  const frameW = parent && parent.clientWidth > 0 ? parent.clientWidth : CHIP_FALLBACK
  const frameH = parent && parent.clientHeight > 0 ? parent.clientHeight : CHIP_FALLBACK
  const toNatural = img.naturalWidth / origW
  const pad = Number(img.dataset.pad) > 0 ? Number(img.dataset.pad) : 1
  const natW = boxW * toNatural * pad
  const natH = boxH * toNatural * pad
  const natX = boxX * toNatural - (natW - boxW * toNatural) / 2
  const natY = boxY * toNatural - (natH - boxH * toNatural) / 2
  const scale = Math.max(frameW / natW, frameH / natH)
  img.style.width = `${img.naturalWidth * scale}px`
  img.style.height = `${img.naturalHeight * scale}px`
  img.style.left = `${-(natX * scale) + (frameW - natW * scale) / 2}px`
  img.style.top = `${-(natY * scale) + (frameH - natH * scale) / 2}px`
}

// ----------------------------------------------------------------- chrome

/** The stepper, with People and History to its right. @param {string} on */
function facesHead(on) {
  const steps = STEPS.map((s, i) => {
    const n = stepCount(s[0])
    const here = on === s[0]
    return html`<li>
      <a href="${s[2]}" class="${n === 0 ? "is-done" : ""}"
        aria-current="${here ? "step" : "false"}">
        <span class="flow-n" aria-hidden="true">${n === 0 ? icon("check") : i + 1}</span>
        <span class="flow-label">${s[1]}</span>${n > 0
          ? html`<span class="count">${n}</span>`
          : html`<span class="sr-only">, done</span>`}
      </a>
    </li>`
  })
  return html`<header class="faces-head">
    <ol class="flow" aria-label="Naming faces, step by step">
      ${steps}
    </ol>
    <nav class="faces-ref" aria-label="Reference">
      <a href="/admin/faces/people" aria-current="${on === "people" ? "page" : "false"}"
        >People</a
      >
      <a href="/admin/faces/history" aria-current="${on === "history" ? "page" : "false"}"
        >History</a
      >
    </nav>
  </header>`
}

/** People / History for phones, where the stepper has no room for them. */
function refLinks() {
  return html`<nav class="phone-only faces-ref-phone" aria-label="Reference">
    <a href="/admin/faces/people">People</a><a href="/admin/faces/history">History</a>
  </nav>`
}

/** The phone's "‹ List" chevron. @param {string} to @param {string} label */
function mBack(to, label) {
  return html`<a class="m-back" href="${to}" data-up>${icon("back")}${label}</a>`
}

/** What a step shows once it has run dry: the next step's call to action, or
 *  "everyone has a name". @param {string} after */
function nextStep(after) {
  const i = STEPS.findIndex((s) => s[0] === after)
  const next = STEPS.slice(i + 1).find((s) => stepCount(s[0]) > 0)
  if (!next) {
    return html`<div class="done-state">
      <div class="done-icon">${icon("check")}</div>
      <h2>Everyone has a name</h2>
      <p>That's every face the camera found. New photos will add new groups here.</p>
      <a class="btn btn-primary btn-lg" href="/admin/thank-yous/cards">Next: thank-you cards →</a>
    </div>`
  }
  return html`<div class="done-state">
    <div class="done-icon">${icon("check")}</div>
    <h2>Step done</h2>
    <a class="btn btn-primary btn-lg" href="${next[2]}" data-autofocus
      >Next: ${next[3]} (${stepCount(next[0])}) →</a
    >
  </div>`
}

// ----------------------------------------------------------------- picker

/** Alternatives for a group: its nearest people, minus the suggestion.
 *  @param {Types.FaceGroup} g */
function groupPicker(g) {
  const sug = g.suggestion
  const alternatives = g.candidates
    .filter((c) => !sug || c.personId !== sug.personId)
    .slice(0, 3)
    .map((c) => ({ personId: c.personId, personName: c.personName, note: "Similar" }))
  const people = peopleData.length
  /** @type {Types.FacesPickerSpec} */
  const spec = {
    kind: "group",
    id: g.key,
    count: nameableIds(g).length,
    suggestion: sug
      ? {
          personId: sug.personId,
          personName: sug.personName,
          // Null margin = an unopposed match: only one person to compare with.
          note:
            sug.margin === null
              ? "The only person named so far — check the faces"
              : "Strong match",
        }
      : null,
    alternatives,
    emptyNote:
      people === 0
        ? "No one's been named yet. The first time you name someone, they start getting suggested."
        : "No confident match. Pick one of these, or type a name.",
  }
  return spec
}

/** @param {Types.FacesAskItem} item @returns {Types.FacesPickerSpec} */
function askPicker(item) {
  /** @type {Types.FacesPickerSpec["alternatives"]} */
  const alternatives = []
  for (const c of item.candidates) {
    if (c.personId === null || c.personName === null) continue
    alternatives.push({
      personId: c.personId,
      personName: c.personName,
      note: alternatives.length === 0 ? "Most likely" : "Possible",
    })
  }
  return {
    kind: "ask",
    id: item.faceId,
    count: 1,
    suggestion: null,
    alternatives: alternatives.slice(0, 3),
    emptyNote:
      peopleData.length === 0
        ? "No one's been named yet, so there's nobody to suggest. Type a name."
        : "Type a name.",
  }
}

/** "Who is this?" — shared by Groups and Quick questions.
 *  @param {Types.FacesPickerSpec} o */
function pickerMarkup(o) {
  const s = o.suggestion
  const faces = o.count === 1 ? "this face" : `${o.count} faces`
  const primary = s
    ? html`<div class="suggest">
          ${avatar({ id: s.personId, name: s.personName }, "avatar-lg")}
          <div>
            <span class="eyebrow">Looks like</span>
            <h2>${s.personName}</h2>
            <span class="muted">${s.note}</span>
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-lg btn-block" data-act="assign"
          data-kind="${o.kind}" data-id="${o.id}" data-person="${s.personId}"
          data-name="${s.personName}" data-autofocus ${o.count === 0 ? "disabled" : ""}>
          ${o.count === 0
            ? "Every face is left out"
            : html`Yes, name ${faces} ${firstName(s.personName)} <kbd>Enter</kbd>`}
        </button>`
    : o.kind === "group"
      ? html`<div class="suggest suggest-none">
          <h2>Who is this?</h2>
          <span class="muted">${o.emptyNote}</span>
        </div>`
      : html`<h2 class="picker-q">Who is this?</h2>`
  const cands = o.alternatives.length
    ? html`<p class="picker-label">
          ${o.kind === "group" ? (s ? "Or one of these" : "Closest people") : "Best guesses"}
        </p>
        <ol class="cands">
          ${o.alternatives.map(
            (c, i) => html`<li>
              <button type="button" class="cand" data-act="assign" data-kind="${o.kind}"
                data-id="${o.id}" data-person="${c.personId}" data-name="${c.personName}"
                ${o.count === 0 ? "disabled" : ""}>
                <kbd>${i + 1}</kbd>${avatar({ id: c.personId, name: c.personName })}<span
                  ><strong>${c.personName}</strong><br /><span class="muted">${c.note}</span></span
                >
              </button>
            </li>`,
          )}
        </ol>`
    : o.kind === "ask"
      ? html`<p class="muted small">${o.emptyNote}</p>`
      : ""
  const key = `${o.kind}:${o.id}`
  const text = whoFor === key ? whoText : ""
  return html`<div class="picker">
    ${primary} ${cands}
    <div class="someone">
      <label class="picker-label" for="faces-who">Someone else <kbd>/</kbd></label>
      <input id="faces-who" type="search" autocomplete="off" placeholder="Type a name…"
        maxlength="200" data-who="${key}" value="${text}" aria-controls="faces-who-list" />
      <ul class="who-list" id="faces-who-list">
        ${whoListMarkup(text, o.kind, o.id)}
      </ul>
    </div>
    <p class="status-note is-error picker-error" role="alert" hidden></p>
    <div class="picker-minor">
      <button type="button" class="btn btn-sm btn-ghost" data-act="not-a-face" data-kind="${o.kind}"
        data-id="${o.id}" ${o.count === 0 ? "disabled" : ""}>
        Not a face
      </button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="skip" data-kind="${o.kind}"
        data-id="${o.id}">
        Skip for now <kbd>s</kbd>
      </button>
    </div>
    <p class="fine muted">
      Nothing here is final. Every naming can be undone from
      <a href="/admin/faces/history">History</a>.
    </p>
  </div>`
}

/**
 * The type-ahead's list: people whose name contains the text, then a way to
 * create one. Creating is always an explicit choice — and when someone with
 * exactly that name exists, the offer says "also called", and asks first.
 * @param {string} text @param {string} kind @param {number} id
 */
function whoListMarkup(text, kind, id) {
  const q = nameKey(text)
  if (!q) return ""
  const hits = peopleData.filter((p) => nameKey(p.displayName).includes(q)).slice(0, WHO_MAX)
  const exact = peopleData.some((p) => nameKey(p.displayName) === q)
  const typed = text.trim()
  return html`${hits.map(
    (p) => html`<li>
      <button type="button" class="who" data-act="assign" data-kind="${kind}" data-id="${id}"
        data-person="${p.id}" data-name="${p.displayName}">
        ${avatar({ id: p.id, name: p.displayName })}${p.displayName}<span class="muted"
          >${plural(p.faces, "face", "faces")}</span
        >
      </button>
    </li>`,
  )}
  <li>
    <button type="button" class="who who-new" data-act="${exact ? "new-dup" : "new"}"
      data-kind="${kind}" data-id="${id}" data-name="${typed}">
      ${exact
        ? html`+ Another person also called “${typed}”`
        : html`+ New person “${typed}”`}
    </button>
  </li>`
}

/** @param {string} msg */
function showPickerError(msg) {
  const el = document.querySelector("#tab-faces .picker-error")
  if (!(el instanceof HTMLElement)) {
    showError(msg)
    return
  }
  el.textContent = msg
  el.hidden = false
}

// ----------------------------------------------------------------- groups

/** @param {Types.FaceGroup} g @param {boolean} on */
function groupRow(g, on) {
  const s = g.suggestion
  const shown = g.media.slice(0, 4)
  const unclear = g.setAside
  return html`<li>
    <a class="row grow" href="${groupHref(g.key)}" data-select
      aria-current="${on ? "true" : "false"}">
      <span class="chips4">${shown.map((m) => chip(m, "", CHIP_PX.mini))}</span>
      <span class="row-main">
        <span class="row-top"><strong>${s ? `${s.personName}?` : "Who is this?"}</strong></span>
        <span class="row-sub"
          >${plural(g.size, "face", "faces")}${unclear ? ` · ${unclear} unclear` : ""}</span
        >
      </span>
    </a>
  </li>`
}

/** @param {number | null} faceId */
function groupsList(faceId) {
  const left = groupsLeft()
  const current = faceId !== null ? groupOfFace(faceId) : null
  const done = named.filter((e) => e.kind === "group" && !e.revoked)
  const doneOn = faceId !== null ? namedEntryFor(faceId) : null
  return html`<header class="pane-head pane-head-tight">
      <h2>${left.length ? `${plural(left.length, "group", "groups")} to name` : "All named"}</h2>
      <p class="muted small">
        ${groupOrder === "varied" && left.length > 1 ? "Most varied first." : "Clearest first."}
        Each group is faces the computer thinks are one person — check before you confirm.
      </p>
      ${left.length > 1
        ? html`<div class="chips" role="group" aria-label="Order">
            <button type="button" class="chip" data-act="order" data-order="size"
              aria-current="${groupOrder === "size" ? "true" : "false"}">
              Clearest first
            </button>
            <button type="button" class="chip" data-act="order" data-order="varied"
              aria-current="${groupOrder === "varied" ? "true" : "false"}">
              Most varied first
            </button>
          </div>`
        : ""}
      ${refLinks()}
    </header>
    <ul class="rows">
      ${left.length
        ? left.map((g) => groupRow(g, current === g))
        : html`<li class="list-empty">All groups named.</li>`}
    </ul>
    ${done.length
      ? html`<h3 class="rows-heading">Named</h3>
          <ul class="rows rows-done">
            ${done.map(
              (e) => html`<li>
                <a class="row grow" href="${groupHref(e.anchor)}" data-select
                  aria-current="${doneOn === e ? "true" : "false"}">
                  ${chip(e.chip)}
                  <span class="row-main">
                    <span class="row-top"
                      >${icon("check")}<strong>${e.personName ?? "Not a face"}</strong></span
                    >
                    <span class="row-sub">${plural(e.count, "face", "faces")}</span>
                  </span>
                </a>
              </li>`,
            )}
          </ul>`
      : ""}
    <footer class="pane-foot">
      <kbd>j</kbd> <kbd>k</kbd> groups · <kbd>←</kbd> <kbd>→</kbd> faces
    </footer>`
}

/** The middle pane: one group, one face large, every face in a strip.
 *  @param {Types.FaceGroup} g @param {number} faceId */
function groupStage(g, faceId) {
  const left = groupsLeft()
  const idx = left.indexOf(g)
  const faces = membersOf(g)
  const found = faces.findIndex((f) => f.entry.faceId === faceId)
  const fi = found === -1 ? 0 : found
  const f = faces[fi]
  const out = isExcluded(g, f.entry.faceId)
  const n = nameableIds(g).length
  const outIds = leftOutIds(g)
  const prev = left[idx - 1]
  const next = left[idx + 1]
  const strip = faces.map((x, i) => {
    const state = x.setAside ? "unclear" : isExcluded(g, x.entry.faceId) ? "out" : ""
    const label =
      `Face ${i + 1} of ${faces.length}` +
      (state === "out" ? ", left out" : "") +
      (state === "unclear" ? ", unclear — name it from the photo" : "")
    return html`<li>
      <a href="${groupHref(x.entry.faceId)}" data-replace
        class="strip-face ${state ? `is-${state}` : ""}"
        aria-current="${x.entry.faceId === f.entry.faceId ? "true" : "false"}" aria-label="${label}"
        >${chip(x.entry, "", CHIP_PX.strip)}${state
          ? html`<span class="strip-badge">${state}</span>`
          : ""}</a
      >
    </li>`
  })
  return html`${mBack("/admin/faces/groups", "Groups")}
    <div class="stage">
      <header class="stage-head">
        <span class="eyebrow"
          >Group ${idx + 1} of ${left.length} · ${plural(g.size, "face", "faces")}</span
        >
        <nav class="stepper-mini" aria-label="Groups">
          ${prev
            ? html`<a href="${groupHref(prev.key)}" data-select aria-label="Previous group (k)"
                >↑</a
              >`
            : html`<span aria-hidden="true">↑</span>`}
          ${next
            ? html`<a href="${groupHref(next.key)}" data-select aria-label="Next group (j)">↓</a>`
            : html`<span aria-hidden="true">↓</span>`}
        </nav>
      </header>
      <figure class="stage-face ${out ? "is-out" : ""}">
        <span class="chip-face chip-stage">${faceImg(f.entry, STAGE_PAD, Infinity)}</span>
        <figcaption>
          <span>Face ${fi + 1} of ${faces.length}</span>
          <span class="stage-tools">
            ${f.setAside
              ? html`<span class="muted"
                  >Unclear —
                  <a href="${photoHref(f.entry.mediaId, f.entry.faceId)}"
                    >name it from the photo</a
                  ></span
                >`
              : html`<a href="${photoHref(f.entry.mediaId, f.entry.faceId)}">Open photo</a>
                  <button type="button" class="linklike" data-act="exclude"
                    data-face="${f.entry.faceId}">
                    ${out ? "Put back in" : "Not the same person"} <kbd>e</kbd>
                  </button>`}
          </span>
        </figcaption>
      </figure>
      <ol class="strip" aria-label="Every face in this group">
        ${strip}
      </ol>
      <p class="muted small strip-help">
        <span class="kbd-hint"><kbd>←</kbd> <kbd>→</kbd> step through. </span>Scan for anyone
        who doesn't belong and leave them out — confirming names <strong>${n}</strong>.
      </p>
      ${outIds.length
        ? html`<p class="strip-out small">
            ${plural(outIds.length, "face", "faces")} left out.
            <button type="button" class="linklike" data-act="out-not-a-face">
              ${outIds.length === 1 ? "It isn't a face" : "They aren't faces"}
            </button>
            ·
            <button type="button" class="linklike" data-act="out-reset">Put them all back</button>
          </p>`
        : ""}
    </div>`
}

/** A face that is no longer in any group, said plainly (IA §8).
 *  @param {number} faceId */
function resolvedStage(faceId) {
  const entry = namedEntryFor(faceId)
  const back = mBack("/admin/faces/groups", "Groups")
  const nextG = groupsLeft()[0]
  const nextBtn = nextG
    ? html`<a class="btn btn-primary" href="${groupHref(nextG.key)}" data-select data-autofocus
        >Next group →</a
      >`
    : ""
  if (entry) {
    return html`${back}
      <div class="done-state">
        ${chip(entry.chip, "chip-face-lg", 96)}
        <h2>${entry.personName ? `Named ${entry.personName}` : "Marked not a face"}</h2>
        <p>${plural(entry.count, "face", "faces")}, this session.</p>
        <p class="btn-row">
          <button type="button" class="btn" data-act="undo-named" data-batch="${entry.batchId}">
            Undo
          </button>
          ${nextBtn}
        </p>
      </div>`
  }
  const a = overview?.anchor && overview.anchor.faceId === faceId ? overview.anchor : null
  if (a && a.state === "named") {
    return html`${back}
      <div class="done-state">
        <div class="done-icon">${icon("check")}</div>
        <h2>Named ${a.personName ?? "someone"}</h2>
        <p>Face ${faceId} already has a name. To take it back, undo the pass in
          <a href="/admin/faces/history">History</a> or change it on the photo.</p>
        <p class="btn-row">
          ${a.mediaId !== null
            ? html`<a class="btn" href="${photoHref(a.mediaId, faceId)}">Open photo</a>`
            : ""}
          ${nextBtn}
        </p>
      </div>`
  }
  if (a && a.state === "not_a_face") {
    return html`${back}
      <div class="done-state">
        <div class="done-icon">${icon("check")}</div>
        <h2>Marked not a face</h2>
        <p>
          Face ${faceId} was dismissed. Undo the pass in
          <a href="/admin/faces/history">History</a> to bring it back.
        </p>
        <p class="btn-row">${nextBtn}</p>
      </div>`
  }
  if (a && a.state === "unnamed" && a.mediaId !== null) {
    return html`${back}
      <div class="done-state">
        <h2>This face was held back</h2>
        <p>It's too small or unclear to group. Name it from its photo.</p>
        <p class="btn-row">
          <a class="btn btn-primary" href="${photoHref(a.mediaId, faceId)}">Open photo</a>
        </p>
      </div>`
  }
  return html`${back}
    <div class="detail-empty">That face isn't in any group any more.</div>`
}

function groupsView() {
  const faceId = place.face
  const g = faceId !== null ? groupOfFace(faceId) : null
  const live = g && g.size >= 2 ? g : null
  let stage
  let picker = ""
  if (live && faceId !== null) {
    stage = groupStage(live, faceId)
    picker = pickerMarkup(groupPicker(live))
  } else if (faceId !== null) {
    stage = resolvedStage(faceId)
  } else {
    stage = groupsLeft().length
      ? html`<div class="detail-empty">Pick a group.</div>`
      : nextStep("groups")
  }
  return html`${facesHead("groups")}
    <div class="faces3 ${faceId !== null ? "has-sel" : ""}">
      <section class="pane pane-list" aria-label="Groups">${groupsList(faceId)}</section>
      <section class="pane pane-stage" aria-label="Faces in this group">${stage}</section>
      ${picker
        ? html`<section class="pane pane-picker" aria-label="Who is this?">${picker}</section>`
        : ""}
    </div>`
}

// -------------------------------------------------------------------- ask

/** @param {Types.FacesAskItem} item */
function askReason(item) {
  if (item.routeState === "ask" && item.routeReason) {
    return `Held back because it's ${REASONS[item.routeReason] ?? "unclear"}`
  }
  return "No other face looked like this one"
}

function askView() {
  const left = askLeft()
  const id = place.face
  const item = id !== null ? (left.find((x) => x.faceId === id) ?? null) : null
  const rows = left.map((x) => {
    const c = x.candidates.find((k) => k.personName !== null)
    return html`<li>
      <a class="row grow" href="${askHref(x.faceId)}" data-select
        aria-current="${x === item ? "true" : "false"}">
        ${chip(x.entry)}
        <span class="row-main">
          <span class="row-top"
            ><strong>${c && c.personName ? `${c.personName}?` : "Who is this?"}</strong></span
          >
          <span class="row-sub"
            >${x.unlocks !== null && x.unlocks > 1
              ? `Answering names ${x.unlocks - 1} more ${x.unlocks - 1 === 1 ? "photo" : "photos"}`
              : askReason(x)}</span
          >
        </span>
      </a>
    </li>`
  })
  let detail
  let picker = ""
  if (item) {
    const i = left.indexOf(item)
    const prev = left[i - 1]
    const next = left[i + 1]
    detail = html`${mBack("/admin/faces/ask", "Questions")}
      <div class="stage">
        <header class="stage-head">
          <span class="eyebrow">Question ${i + 1} of ${left.length}</span>
          <nav class="stepper-mini" aria-label="Questions">
            ${prev
              ? html`<a href="${askHref(prev.faceId)}" data-select aria-label="Previous (k)"
                  >↑</a
                >`
              : html`<span aria-hidden="true">↑</span>`}
            ${next
              ? html`<a href="${askHref(next.faceId)}" data-select aria-label="Next (j)">↓</a>`
              : html`<span aria-hidden="true">↓</span>`}
          </nav>
        </header>
        <figure class="stage-face">
          <span class="chip-face chip-stage">${faceImg(item.entry, STAGE_PAD, Infinity)}</span>
          <figcaption>
            <span>${askReason(item)}</span>
            <span class="stage-tools"
              ><a href="${photoHref(item.entry.mediaId, item.faceId)}"
                >Open photo <kbd>o</kbd></a
              ></span
            >
          </figcaption>
        </figure>
        ${item.unlocks !== null && item.unlocks > 1
          ? html`<p class="muted small">
              Answering this one names it in ${item.unlocks} photos — that's why it's near the
              top.
            </p>`
          : ""}
      </div>`
    picker = pickerMarkup(askPicker(item))
  } else if (id !== null) {
    detail = askResolved(id)
  } else {
    detail = left.length ? html`<div class="detail-empty">Pick a face.</div>` : nextStep("ask")
  }
  return html`${facesHead("ask")}
    <div class="faces3 ${id !== null ? "has-sel" : ""}">
      <section class="pane pane-list" aria-label="Questions">
        <header class="pane-head pane-head-tight">
          <h2>${plural(left.length, "quick question", "quick questions")}</h2>
          <p class="muted small">Single faces nothing else looked like, most useful first.</p>
          ${refLinks()}
        </header>
        <ul class="rows">
          ${rows.length ? rows : html`<li class="list-empty">No questions left.</li>`}
        </ul>
        <footer class="pane-foot">
          <kbd>j</kbd> <kbd>k</kbd> move · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> pick
        </footer>
      </section>
      <section class="pane pane-stage" aria-label="The face">${detail}</section>
      ${picker
        ? html`<section class="pane pane-picker" aria-label="Who is this?">${picker}</section>`
        : ""}
    </div>`
}

/** @param {number} faceId */
function askResolved(faceId) {
  const entry = namedEntryFor(faceId)
  const back = mBack("/admin/faces/ask", "Questions")
  if (entry) {
    const nextQ = askLeft()[0]
    return html`${back}
      <div class="done-state">
        ${chip(entry.chip, "chip-face-lg", 96)}
        <h2>${entry.personName ? `This is ${entry.personName}` : "Not a face"}</h2>
        <p class="btn-row">
          <button type="button" class="btn" data-act="undo-named" data-batch="${entry.batchId}">
            Undo
          </button>
          ${nextQ
            ? html`<a class="btn btn-primary" href="${askHref(nextQ.faceId)}" data-select
                >Next question →</a
              >`
            : ""}
        </p>
      </div>`
  }
  // A face in a bigger group now (someone was named, it regrouped).
  const g = groupOfFace(faceId)
  if (g && g.size >= 2) {
    return html`${back}
      <div class="done-state">
        <h2>This face is in a group now</h2>
        <p class="btn-row">
          <a class="btn btn-primary" href="${groupHref(faceId)}">Open its group →</a>
        </p>
      </div>`
  }
  return resolvedStage(faceId)
}

// ------------------------------------------------------------ same moment

function sameMomentView() {
  const left = propsLeft()
  if (!left.length) {
    return html`${facesHead("same-moment")}
      <div class="single">${refLinks()}${nextStep("same-moment")}</div>`
  }
  const checked = left.filter((p) => !unticked.has(p.toFaceId)).length
  return html`${facesHead("same-moment")}
    <div class="single">
      <header class="single-head">
        <h1>Same moment, same person?</h1>
        <p class="muted">
          These faces are in near-identical shots taken a second apart from a face you already
          named. Untick any that look wrong, then confirm them together.
        </p>
        ${refLinks()}
      </header>
      <ul class="pairs">
        ${left.map(
          (p) => html`<li>
            <label class="pair"
              title="${`Box overlap ${p.iou.toFixed(2)} · ` +
              `descriptor distance ${p.distance.toFixed(2)}`}">
              <input type="checkbox" data-act="tick" data-face="${p.toFaceId}"
                ${unticked.has(p.toFaceId) ? "" : "checked"} />
              ${p.from ? chip(p.from) : html`<span class="chip-face"></span>`}
              <span aria-hidden="true">→</span>
              ${chip(p)}
              <span
                ><strong>${p.personName ?? "Unknown person"}</strong><br /><span class="muted small"
                  >named → same moment</span
                ></span
              >
              <a href="${photoHref(p.mediaId, p.toFaceId)}" class="small">Open photo</a>
            </label>
          </li>`,
        )}
      </ul>
      <div class="actionbar">
        <button type="button" class="btn btn-primary btn-lg" data-act="propagate"
          ${checked ? "" : "disabled"}>
          Confirm ${checked}
        </button>
        <span class="muted small actionbar-note">
          Carried-across names are never used to recognise anyone else.
        </span>
      </div>
    </div>`
}

// -------------------------------------------------------------- leftovers

/** Ids and counts only — never what the photograph shows.
 *  @param {Types.FaceSetAsidePhoto} p */
function leftoverLabel(p) {
  const left = p.unnamedSetAside
  const state = left ? `${left} of ${p.setAsideFaces} unclear faces unnamed` : "all named"
  return `Photo ${p.mediaId}, ${state}`
}

function leftoversView() {
  const left = leftoversLeft()
  return html`${facesHead("leftovers")}
    <div class="single">
      <header class="single-head">
        <h1>Leftovers</h1>
        <p class="muted">
          Photos with faces too small, blurry or side-on to group. Open one to name its faces one at
          a time — or leave them unnamed; that's fine.
        </p>
        ${refLinks()}
      </header>
      ${left.length ? "" : nextStep("leftovers")}
      ${setAsidePhotos.length
        ? html`<ul class="photo-grid">
            ${setAsidePhotos.map(
              (p) => html`<li>
                <a class="photo-card ${p.unnamedSetAside ? "" : "is-done"}"
                  href="/admin/faces/leftovers/photos/m${p.mediaId}"
                  aria-label="${leftoverLabel(p)}">
                  <span class="photo-thumb"
                    ><img src="/media/${p.fileKey}/thumb" alt="" loading="lazy"
                  /></span>
                  <span>Photo ${p.mediaId}</span>
                  <span class="muted small"
                    >${p.unnamedSetAside
                      ? `${p.unnamedSetAside} of ${p.setAsideFaces} unnamed`
                      : "All named"}</span
                  >
                </a>
              </li>`,
            )}
          </ul>`
        : ""}
    </div>`
}

// ----------------------------------------------------------------- people

/** @param {Types.PersonEntry} x */
function guestLine(x) {
  if (x.guestId === null) {
    const likely = guestsLoaded ? suggestGuests(x.displayName, guestOptions, 1) : []
    return likely.length ? `Not linked · maybe ${likely[0].label}?` : "Not a guest"
  }
  return x.guestName ? `On the guest list · ${x.guestName}` : "On the guest list"
}

function peopleView() {
  const p = place.person !== null ? personById(place.person) : null
  const c = overview?.counts
  const r = overview?.routeCounts
  const stats = c
    ? [
        `${c.identified} of ${c.faces} faces named`,
        c.notAFace ? `${c.notAFace} not a face` : "",
        r && r.setAside ? `${r.setAside} unclear` : "",
        r && r.ungraded ? `${r.ungraded} ungraded` : "",
      ]
        .filter((x) => x)
        .join(" · ")
    : ""
  const list = html`<header class="pane-head pane-head-tight">
      <h2>${plural(peopleData.length, "person", "people")}</h2>
      <p class="muted small">
        Everyone who's been named in a photo. A person can be linked to a guest, but doesn't have
        to be.
      </p>
      ${stats ? html`<p class="small faces-stats">${stats}</p>` : ""}
      ${refLinks()}
    </header>
    <ul class="rows">
      ${peopleData.length
        ? peopleData.map(
            (x) => html`<li>
              <a class="row" href="${personHref(x.id)}" data-select
                aria-current="${x === p ? "true" : "false"}">
                ${avatar({ id: x.id, name: x.displayName })}
                <span class="row-main">
                  <span class="row-top"
                    ><strong>${x.displayName}</strong><span class="row-time">${x.faces}</span></span
                  >
                  <span class="row-sub">${guestLine(x)}</span>
                </span>
              </a>
            </li>`,
          )
        : html`<li class="list-empty">No one yet. Name a group and the person is made there.</li>`}
    </ul>
    <footer class="pane-foot"><kbd>j</kbd> <kbd>k</kbd> move</footer>`
  const detail = p
    ? personDetail(p)
    : html`<div class="detail-empty">
        ${place.person !== null ? "That person is gone — merged or retired." : "Pick a person."}
      </div>`
  return html`${facesHead("people")}
    <div class="split ${place.person !== null ? "has-sel" : ""}">
      <section class="pane pane-list" aria-label="People">${list}</section>
      <section class="pane pane-detail" aria-label="Selected person">${detail}</section>
    </div>`
}

/**
 * Under the buttons: for an unlinked person, the guests their (often informal)
 * name most likely is, one click each; for a linked one whose name differs
 * from the invitation's, the invitation's name, one click. Never automatic: an
 * invitation is often a whole party ("Michael & Dana Rossi"), which is not a
 * name for one face.
 * @param {Types.PersonEntry} p @param {string | null} edit
 */
function linkHelp(p, edit) {
  if (!guestsLoaded) return ""
  if (p.guestId === null) {
    if (edit === "link") return ""
    const likely = suggestGuests(p.displayName, guestOptions)
    if (likely.length === 0) return ""
    return html`<p class="small person-suggest">
      <span class="muted">On the guest list as…</span>
      ${likely.map(
        (g) => html`<button type="button" class="btn btn-sm" data-act="link-guest"
          data-guest="${g.id}">${g.label}</button>`,
      )}
    </p>`
  }
  if (p.guestName && nameKey(p.guestName) !== nameKey(p.displayName)) {
    return html`<p class="small person-suggest">
      <button type="button" class="btn btn-sm btn-ghost" data-act="use-guest-name">
        Rename to “${p.guestName}”
      </button>
    </p>`
  }
  return ""
}

/** @param {Types.PersonEntry} p */
function personDetail(p) {
  const others = peopleData.filter((o) => o.id !== p.id)
  const edit = personEdit && personEdit.id === p.id ? personEdit.mode : null
  const pf = personFaces.get(p.id)
  const retireBlocked = p.identities > 0
  /** @type {string} */
  let editor = ""
  if (edit === "rename") {
    editor = html`<form class="faces-inline" data-form="rename" data-person="${p.id}">
      <label class="sr-only" for="faces-rename">Name</label>
      <input id="faces-rename" name="name" value="${p.displayName}" maxlength="200"
        autocomplete="off" required />
      <button type="submit" class="btn btn-sm btn-primary">Save</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="edit-cancel">Cancel</button>
    </form>`
  } else if (edit === "merge") {
    editor = html`<form class="faces-inline" data-form="merge" data-person="${p.id}">
      <label class="sr-only" for="faces-merge">Merge into</label>
      <select id="faces-merge" name="into" required>
        <option value="">Merge ${p.displayName} into…</option>
        ${others.map((o) => html`<option value="${o.id}">${o.displayName}</option>`)}
      </select>
      <button type="submit" class="btn btn-sm btn-danger-soft">Merge</button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="edit-cancel">Cancel</button>
    </form>`
  } else if (edit === "link") {
    editor = html`<form class="faces-inline" data-form="link" data-person="${p.id}">
      <label class="sr-only" for="faces-link">Guest's name</label>
      <input id="faces-link" name="guest" list="faces-guest-roster" placeholder="Guest's name…"
        maxlength="200" autocomplete="off" required ${guestsLoaded ? "" : "disabled"} />
      <button type="submit" class="btn btn-sm btn-primary" ${guestsLoaded ? "" : "disabled"}>
        Link
      </button>
      <button type="button" class="btn btn-sm btn-ghost" data-act="edit-cancel">Cancel</button>
    </form>`
  }
  return html`${mBack("/admin/faces/people", "People")}
    <article class="detail">
      <header class="person-head">
        ${avatar({ id: p.id, name: p.displayName }, "avatar-xl")}
        <div>
          <h1>${p.displayName}</h1>
          <p class="muted">
            ${plural(p.faces, "face", "faces")} ·
            ${p.guestId !== null
              ? `Linked to ${p.guestName ? `${p.guestName}'s invitation` : "a deleted guest"}`
              : "Not linked to a guest"}
          </p>
        </div>
      </header>
      <div class="btn-row">
        <button type="button" class="btn btn-sm" data-act="edit" data-mode="rename"
          aria-pressed="${edit === "rename" ? "true" : "false"}">Rename</button>
        ${others.length
          ? html`<button type="button" class="btn btn-sm" data-act="edit" data-mode="merge"
              aria-pressed="${edit === "merge" ? "true" : "false"}">Merge into…</button>`
          : ""}
        ${p.guestId !== null
          ? html`<button type="button" class="btn btn-sm" data-act="unlink">Unlink guest</button>`
          : html`<button type="button" class="btn btn-sm" data-act="edit" data-mode="link"
              aria-pressed="${edit === "link" ? "true" : "false"}"
              ${guestsLoaded ? "" : "disabled"}>
              Link to a guest
            </button>`}
        <button type="button" class="btn btn-sm btn-ghost" data-act="retire"
          ${retireBlocked ? "disabled" : ""}>
          Retire
        </button>
      </div>
      ${editor}
      ${linkHelp(p, edit)}
      <p class="status-note is-error person-error" role="alert" hidden></p>
      ${retireBlocked
        ? html`<p class="fine muted">
            Only someone with no named faces can be retired. To fold a duplicate into the right
            person, use Merge.
          </p>`
        : ""}
      ${pf
        ? html`<ul class="face-grid" aria-label="${`${p.displayName}'s faces`}">
              ${pf.faces.map(
                (f) => html`<li>
                  <a href="${personHref(p.id)}/photos/m${f.mediaId}?face=f${f.faceId}"
                    aria-label="${`Face ${f.faceId} — open its photo`}"
                    >${chip(f, "", CHIP_PX.grid)}</a
                  >
                </li>`,
              )}
            </ul>
            ${pf.total > pf.faces.length
              ? html`<p class="muted small">
                  Showing the newest ${pf.faces.length} of ${pf.total}.
                </p>`
              : ""}`
        : p.faces
          ? html`<p class="muted small">Loading faces…</p>`
          : ""}
    </article>`
}

// ---------------------------------------------------------------- history

/** What a pass did, in the words of the button that made it.
 *  @param {Types.FaceBatchEntry} b */
function batchLabel(b) {
  const mine = named.find((e) => e.batchId === b.batchId)
  if (mine) {
    return mine.personName
      ? `Named ${plural(mine.count, "face", "faces")} ${mine.personName}`
      : `Marked ${mine.count} not a face`
  }
  const note = b.note ?? ""
  const faces = plural(b.faces, "face", "faces")
  if (b.kind === "propagate") return `Same moment: ${faces}`
  if (b.kind === "label-import") return `Imported naming work: ${faces}`
  if (b.kind === "merge-repair") return `Merge repair: ${faces}`
  if (note.startsWith("bulk assign")) return `Named ${faces}`
  if (note.startsWith("bulk not-a-face")) return `Marked ${b.faces} not a face`
  if (note.startsWith("bulk unassign")) return `Cleared ${faces}`
  return `Bulk change: ${faces}`
}

function historyView() {
  const list = batchesData ? batchesData.batches : []
  return html`${facesHead("history")}
    <div class="single">
      <header class="single-head">
        <h1>History</h1>
        <p class="muted">
          Each confirm is one entry. Undoing one takes back exactly what it named — nothing is
          deleted, and any fixes you made afterwards stay.
        </p>
        ${refLinks()}
      </header>
      ${batchesError
        ? html`<p class="status-note is-error" role="alert">
            ${batchesError}
            <button type="button" class="btn btn-sm" data-act="history-retry">Try again</button>
          </p>`
        : ""}
      ${batchesData && list.length === 0
        ? html`<p class="list-empty">
            Nothing yet. Every time you name a group, it's listed here.
          </p>`
        : ""}
      <ul class="history">
        ${list.map((b) => {
          const revoked = b.revokedAt !== null
          return html`<li class="${revoked ? "is-revoked" : ""}">
            <span
              ><strong>${batchLabel(b)}</strong><br /><span class="muted small"
                >${ledgerTime(b.createdAt)}${revoked
                  ? ` · undone ${ledgerTime(b.revokedAt)}`
                  : ""}<code class="batch-id" title="Pass id, for the command line"
                  >${b.batchId}</code
                ></span
              ></span
            >
            ${revoked
              ? html`<span class="muted">Undone</span>`
              : html`<button type="button" class="btn btn-sm" data-act="revoke"
                  data-batch="${b.batchId}">
                  Undo this
                </button>`}
          </li>`
        })}
      </ul>
    </div>`
}

// ---------------------------------------------------------------- render

function emptyIngest() {
  return html`<div class="single">
    <div class="done-state">
      <h2>No faces yet</h2>
      <p class="muted">Run the face pipeline over a folder of photos from the command line:</p>
      <pre class="faces-cli-hint">node scripts/vision/ingest-faces.js &lt;run-dir&gt;</pre>
    </div>
  </div>`
}

/** Draw the current place. Keeps the list's scroll and brings the selected row
 *  into view, so j/k never loses your place in a long list. */
function render() {
  const root = getElement("faces-body")
  if (!overview) return
  const listBefore = root.querySelector(".pane-list")
  const listScroll = listBefore ? listBefore.scrollTop : 0
  const sameView = root.dataset.view === place.view
  /** @type {string} */
  let markup
  if (overview.counts.faces === 0 && place.view !== "history" && place.view !== "people") {
    markup = html`${facesHead(place.view)}${emptyIngest()}`
  } else if (place.view === "ask") markup = askView()
  else if (place.view === "same-moment") markup = sameMomentView()
  else if (place.view === "leftovers") markup = leftoversView()
  else if (place.view === "people") markup = peopleView()
  else if (place.view === "history") markup = historyView()
  else markup = groupsView()
  root.innerHTML = markup
  root.dataset.view = place.view
  wireChips(root)
  const list = root.querySelector(".pane-list")
  if (list && sameView) list.scrollTop = listScroll
  const sel = root.querySelector('.pane-list .row[aria-current="true"]')
  if (sel instanceof HTMLElement) sel.scrollIntoView({ block: "nearest" })
  // Keyboard flow on wide screens: the next decision is one keypress away.
  // Phones don't move focus — it would scroll the column.
  const auto = root.querySelector("[data-autofocus]")
  if (auto instanceof HTMLElement && isWide() && !auto.hasAttribute("disabled")) {
    auto.focus({ preventScroll: true })
  }
  setFacesCrumbs()
}

function setFacesCrumbs() {
  const p = place
  if (p.view === "groups" && p.face !== null) {
    const g = groupOfFace(p.face)
    const entry = namedEntryFor(p.face)
    const a = overview?.anchor && overview.anchor.faceId === p.face ? overview.anchor : null
    let who = ""
    if (g && g.size >= 2) who = g.suggestion ? `${g.suggestion.personName}?` : "Who is this?"
    else if (entry) who = entry.personName ?? "Not a face"
    else if (a && a.state === "named") who = a.personName ?? "Named"
    else if (a && a.state === "not_a_face") who = "Not a face"
    setCrumbs([
      { label: "Groups", href: "/admin/faces/groups" },
      { label: who ? `${who} · face ${p.face}` : `Face ${p.face}` },
    ])
  } else if (p.view === "ask" && p.face !== null) {
    setCrumbs([{ label: "Quick questions", href: "/admin/faces/ask" }, { label: `Face ${p.face}` }])
  } else if (p.view === "people" && p.person !== null) {
    const who = personById(p.person)
    setCrumbs([
      { label: "People", href: "/admin/faces/people" },
      { label: who ? who.displayName : "Person" },
    ])
  } else if (p.view !== "root") {
    const titles = /** @type {Record<string, string>} */ ({
      groups: "Groups",
      ask: "Quick questions",
      "same-moment": "Same moment",
      leftovers: "Leftovers",
      people: "People",
      history: "History",
    })
    setCrumbs([{ label: titles[p.view] ?? "Name faces" }])
  }
}

// --------------------------------------------------------------- actions

/** Name a group (or mark it not a face), then go straight to the next one.
 *  @param {Types.FaceGroup} g @param {number | null} personId @param {string} name */
async function nameGroup(g, personId, name) {
  const faceIds = nameableIds(g)
  if (faceIds.length === 0 || pending.has(g.key)) return
  pending.add(g.key)
  try {
    const res = /** @type {Types.FaceAssignResponse | Types.FaceBatchWriteResponse} */ (
      personId === null
        ? await post("/api/admin/faces/not-a-face", { faceIds })
        : await post("/api/admin/faces/assign", { faceIds, personId })
    )
    const left = groupsLeft()
    const i = left.indexOf(g)
    const next = left[i + 1] ?? left.find((x) => x !== g) ?? null
    /** @type {Types.FacesNamedEntry} */
    const entry = {
      kind: "group",
      anchor: g.key,
      faceIds,
      personId,
      personName: personId === null ? null : name,
      count: faceIds.length,
      batchId: res.batchId,
      chip: g.media.find((m) => faceIds.includes(m.faceId)) ?? g.media[0],
      revoked: false,
    }
    named.unshift(entry)
    saveNamed()
    // Local first, so the screen moves now; the refetch below corrects it.
    if (overview) {
      overview.groups = overview.groups.filter((x) => x !== g)
      if (personId !== null) overview.counts.identified += faceIds.length
      else overview.counts.notAFace += faceIds.length
      overview.counts.unidentified -= faceIds.length
    }
    for (const id of g.faceIds) excluded.delete(id)
    whoText = ""
    showUndo(
      personId === null
        ? `Marked ${plural(faceIds.length, "face", "faces")} not a face`
        : `Named ${plural(faceIds.length, "face", "faces")} ${name}`,
      () => void undoEntry(entry),
    )
    void navigate(next ? groupHref(next.key) : "/admin/faces/groups", { replace: true })
    refreshSoon()
  } catch (err) {
    showPickerError(getErrorMessage(err))
  } finally {
    pending.delete(g.key)
  }
}

/** Answer a quick question, then the next. Ask faces are bulk-nameable, so
 *  this is the bulk route with one face — and so one undoable pass.
 *  @param {Types.FacesAskItem} item @param {number | null} personId @param {string} name */
async function answerAsk(item, personId, name) {
  if (pending.has(item.faceId)) return
  pending.add(item.faceId)
  try {
    const faceIds = [item.faceId]
    const res = /** @type {Types.FaceBatchWriteResponse} */ (
      personId === null
        ? await post("/api/admin/faces/not-a-face", { faceIds })
        : await post("/api/admin/faces/assign", { faceIds, personId })
    )
    const left = askLeft()
    const i = left.indexOf(left.find((x) => x.faceId === item.faceId) ?? item)
    const next = left[i + 1] ?? left.find((x) => x.faceId !== item.faceId) ?? null
    /** @type {Types.FacesNamedEntry} */
    const entry = {
      kind: "ask",
      anchor: item.faceId,
      faceIds: [item.faceId],
      personId,
      personName: personId === null ? null : name,
      count: 1,
      batchId: res.batchId,
      chip: item.entry,
      revoked: false,
    }
    named.unshift(entry)
    saveNamed()
    if (overview) overview.groups = overview.groups.filter((g) => !g.faceIds.includes(item.faceId))
    whoText = ""
    const said = personId === null ? "Marked not a face" : `That's ${name}`
    showUndo(said, () => void undoEntry(entry))
    void navigate(next ? askHref(next.faceId) : "/admin/faces/ask", { replace: true })
    refreshSoon()
  } catch (err) {
    showPickerError(getErrorMessage(err))
  } finally {
    pending.delete(item.faceId)
  }
}

/** Revoke a pass made here, and go back to the face it was shown by.
 *  @param {Types.FacesNamedEntry} entry */
async function undoEntry(entry) {
  try {
    await post("/api/admin/faces/revoke", { batchId: entry.batchId })
    entry.revoked = true
    saveNamed()
    showSuccess(entry.kind === "group" ? "Undone — the group is back in the queue" : "Undone")
    if (isShowing() && (place.view === "groups" || place.view === "ask")) {
      await reloadAnchoredOnFace(entry.anchor)
    } else {
      stale = true
      if (isShowing()) refreshSoon()
    }
  } catch (err) {
    showError(getErrorMessage(err))
  }
}

/** Create a person — only ever from an explicit "+ New person". Returns their
 *  id, or null when the admin backed out of a same-name create.
 *  @param {string} name @param {boolean} duplicate the admin chose "another person also called" */
async function createPerson(name, duplicate) {
  const created = /** @type {Types.PersonCreateResponse} */ (
    await post(
      "/api/admin/people",
      duplicate ? { displayName: name, confirmDuplicate: true } : { displayName: name },
    )
  )
  await refreshPeople()
  return created.person.id
}

/** "+ Another person also called X": the same-name create, asked first.
 *  @param {string} name @param {(id: number) => void} then */
function confirmDuplicate(name, then) {
  const existing = peopleData.find((p) => nameKey(p.displayName) === nameKey(name))
  const theirs = existing ? existing.displayName : name
  openConfirm({
    title: `There's already someone called ${theirs}`,
    desc:
      `Make a second, separate person with the same name? Only do this if it really is someone ` +
      `else. To name these faces as the ${theirs} you already have, pick them from the list ` +
      `instead.`,
    confirmLabel: `Make another ${theirs}`,
    danger: false,
    run: async () => {
      then(await createPerson(name, true))
    },
  })
}

/** Dispatch a pick from a picker: an existing person, a new one, or "not a face".
 *  @param {string} kind @param {number} id @param {number | null} personId @param {string} name */
function pick(kind, id, personId, name) {
  if (kind === "group") {
    const g = overview?.groups.find((x) => x.key === id)
    if (g) void nameGroup(g, personId, name)
  } else if (kind === "ask") {
    const item = askLeft().find((x) => x.faceId === id)
    if (item) void answerAsk(item, personId, name)
  }
}

/** @param {string} kind @param {number} id */
function skip(kind, id) {
  if (kind === "group") {
    const left = groupsLeft()
    const i = left.findIndex((g) => g.key === id)
    const next = left[i + 1] ?? left[0]
    if (next && next.key !== id) void navigate(groupHref(next.key), { replace: true })
  } else {
    const left = askLeft()
    const i = left.findIndex((x) => x.faceId === id)
    const next = left[i + 1] ?? left[0]
    if (next && next.faceId !== id) void navigate(askHref(next.faceId), { replace: true })
  }
}

/** Leave the on-stage face out of the confirm, or put it back. @param {number} faceId */
function toggleExclude(faceId) {
  const g = groupOfFace(faceId)
  // Only a bulk-nameable face: a set-aside one is already outside every bulk
  // action, so leaving it out would be a control with no effect.
  if (!g || !g.faceIds.includes(faceId)) return
  if (isExcluded(g, faceId)) excluded.delete(faceId)
  else excluded.set(faceId, g.key)
  render()
}

/** The left-out faces of the current group are not faces. One pass, undoable. */
async function leftOutNotAFace() {
  const g = place.face !== null ? groupOfFace(place.face) : null
  if (!g) return
  const faceIds = leftOutIds(g)
  if (faceIds.length === 0) return
  const anchor = membersOf(g).find((f) => !faceIds.includes(f.entry.faceId))
  try {
    const res = /** @type {Types.FaceBatchWriteResponse} */ (
      await post("/api/admin/faces/not-a-face", { faceIds })
    )
    for (const id of faceIds) excluded.delete(id)
    /** @type {Types.FacesNamedEntry} */
    const entry = {
      kind: "group",
      anchor: faceIds[0],
      faceIds,
      personId: null,
      personName: null,
      count: faceIds.length,
      batchId: res.batchId,
      chip: g.media.find((m) => m.faceId === faceIds[0]) ?? g.media[0],
      revoked: false,
    }
    named.unshift(entry)
    saveNamed()
    const said = `Marked ${plural(faceIds.length, "face", "faces")} not a face`
    showUndo(said, () => void undoEntry(entry))
    await reloadAnchoredOnFace(anchor ? anchor.entry.faceId : null)
  } catch (err) {
    showPickerError(getErrorMessage(err))
  }
}

async function applyPropagations() {
  const ids = propsLeft()
    .map((p) => p.toFaceId)
    .filter((id) => !unticked.has(id) && !pending.has(id))
  if (ids.length === 0) return
  for (const id of ids) pending.add(id)
  try {
    const res = /** @type {Types.FaceBatchWriteResponse} */ (
      await post("/api/admin/faces/propagate", { toFaceIds: ids })
    )
    showUndo(`Same moment: named ${plural(res.changed, "face", "faces")}`, () => {
      void (async () => {
        try {
          await post("/api/admin/faces/revoke", { batchId: res.batchId })
          showSuccess("Undone")
          refreshSoon()
        } catch (err) {
          showError(getErrorMessage(err))
        }
      })()
    })
    stale = true
    await ensureLoaded()
    if (isShowing()) render()
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    for (const id of ids) pending.delete(id)
  }
}

/**
 * Undo a pass from History. Asked first, NOT in danger styling: it destroys
 * nothing, but it can't itself be undone (a revocation is permanent; running
 * the pass again reinstates it), and the property most likely to be
 * misunderstood — later hand corrections survive — is said out loud.
 * @param {string} batchId
 */
function revokeFromHistory(batchId) {
  const b = batchesData?.batches.find((x) => x.batchId === batchId)
  if (!b) return
  openConfirm({
    title: `Undo “${batchLabel(b)}”?`,
    desc:
      `Those ${plural(b.faces, "face", "faces")} go back to how they were before it. Nothing is ` +
      `deleted, and any of them you've fixed by hand since keep your fix. To redo it, name ` +
      `them again.`,
    confirmLabel: "Undo it",
    danger: false,
    run: async () => {
      const result = /** @type {Types.FaceRevokeResponse} */ (
        await api("/api/admin/faces/revoke", { method: "POST", body: JSON.stringify({ batchId }) })
      )
      const mine = named.find((e) => e.batchId === batchId)
      if (mine) {
        mine.revoked = true
        saveNamed()
      }
      showSuccess(
        result.alreadyRevoked ? "That was already undone." : "Undone. Later corrections were kept.",
      )
      stale = true
      await Promise.all([ensureLoaded(), refreshBatches()])
      if (isShowing()) render()
    },
  })
}

// ----------------------------------------------------------- people writes

/** @param {number} personId @param {string} msg */
function showPersonError(personId, msg) {
  const el = document.querySelector("#tab-faces .person-error")
  if (!(el instanceof HTMLElement) || place.person !== personId) {
    showError(msg)
    return
  }
  el.textContent = msg
  el.hidden = false
}

/**
 * Run a people write, then refetch: a rename or merge changes every
 * suggestion and count, so nothing is patched locally.
 * @param {number} personId @param {() => Promise<void>} write
 */
async function personWrite(personId, write) {
  if (pendingPeople.has(personId)) return
  pendingPeople.add(personId)
  try {
    await write()
    personEdit = null
    stale = true
    await ensureLoaded()
    if (isShowing()) render()
  } catch (err) {
    showPersonError(personId, getErrorMessage(err))
  } finally {
    pendingPeople.delete(personId)
  }
}

/** @param {number} personId @param {Record<string, unknown>} patch */
function patchPerson(personId, patch) {
  return api(`/api/admin/people/${personId}`, { method: "PATCH", body: JSON.stringify(patch) })
}

/** @param {number} personId @param {string} name */
function renamePerson(personId, name) {
  const p = personById(personId)
  const next = name.trim()
  if (!p) return
  if (!next) {
    showPersonError(personId, "A person needs a name.")
    return
  }
  if (next === p.displayName) {
    personEdit = null
    render()
    return
  }
  const before = p.displayName
  void personWrite(personId, async () => {
    await patchPerson(personId, { displayName: next })
    showUndo(`Renamed to ${next}`, () => {
      void personWrite(personId, async () => {
        await patchPerson(personId, { displayName: before })
        showSuccess(`Back to ${before}`)
      })
    })
  })
}

/** @param {number} personId @param {string} typed */
function linkGuest(personId, typed) {
  const found = resolveGuestChoice(typed, guestOptions)
  if (found.kind === "none") {
    showPersonError(personId, "No guest by that name — pick one from the list.")
    return
  }
  if (found.kind === "ambiguous") {
    showPersonError(
      personId,
      "More than one guest has that name — pick the one with the right email or phone from the list.",
    )
    return
  }
  linkGuestId(personId, found.guest)
}

/** @param {number} personId @param {{ id: number, name: string }} guest */
function linkGuestId(personId, guest) {
  void personWrite(personId, async () => {
    await patchPerson(personId, { guestId: guest.id })
    showUndo(`Linked to ${guest.name}'s invitation`, () => {
      void personWrite(personId, async () => {
        await patchPerson(personId, { guestId: null })
        showSuccess("Unlinked")
      })
    })
  })
}

/** @param {number} personId */
function unlinkGuest(personId) {
  const p = personById(personId)
  if (!p || p.guestId === null) return
  const was = p.guestId
  void personWrite(personId, async () => {
    await patchPerson(personId, { guestId: null })
    showUndo("Unlinked from the guest list", () => {
      void personWrite(personId, async () => {
        await patchPerson(personId, { guestId: was })
        showSuccess("Linked again")
      })
    })
  })
}

/** Merge is the one people action that can't be taken back from here (the
 *  source is retired and its identities re-pointed), so it asks — in danger
 *  styling, because it is. @param {number} personId @param {number} intoId */
function mergePerson(personId, intoId) {
  const from = personById(personId)
  const into = personById(intoId)
  if (!from || !into) return
  openConfirm({
    title: `Merge ${from.displayName} into ${into.displayName}?`,
    desc:
      `${from.displayName}'s ${plural(from.faces, "face", "faces")} become ` +
      `${into.displayName}'s, and ` +
      `${from.displayName} is retired. This can't be undone from here.`,
    confirmLabel: "Merge",
    danger: true,
    run: async () => {
      const res = /** @type {Types.PersonMergeResponse} */ (
        await api("/api/admin/people/merge", {
          method: "POST",
          body: JSON.stringify({ fromPersonId: personId, intoPersonId: intoId }),
        })
      )
      showSuccess(
        `Merged into ${into.displayName}` +
          (res.carriedGuestLink ? " — the guest link came too" : ""),
      )
      personEdit = null
      stale = true
      await ensureLoaded()
      void navigate(personHref(intoId), { replace: true })
    },
  })
}

/** @param {number} personId */
function retirePerson(personId) {
  const p = personById(personId)
  if (!p) return
  openConfirm({
    title: `Retire ${p.displayName}?`,
    desc:
      `${p.displayName} has no named faces, so nothing else changes. ` +
      `They leave the people list.`,
    confirmLabel: "Retire",
    danger: true,
    run: async () => {
      await api(`/api/admin/people/${personId}`, { method: "DELETE" })
      showSuccess(`Retired ${p.displayName}`)
      stale = true
      await ensureLoaded()
      void navigate("/admin/faces/people", { replace: true })
    },
  })
}

// ------------------------------------------------------- photograph dialog

/** The faces of the photograph on screen, `mf.id` order (what "face 3" counts). */
/** @type {Types.MediaFaceEntry[]} */
let photoFaces = []
/** @type {number | null} */
let photoMediaId = null
/** @type {number | null} */
let photoSelected = null
/** Any write in the dialog: the screen behind it refetches when it closes. */
let photoDirty = false
/** The open row's type-ahead text. */
let photoWho = ""

function photoBody() {
  return getElement("faces-photo-body")
}

/** Open (or re-point) the dialog on one photograph. The router has already
 *  opened the <dialog>; this fills it. @param {number} mediaId @param {number | null} faceId */
async function openPhoto(mediaId, faceId) {
  const same = photoMediaId === mediaId
  photoMediaId = mediaId
  if (faceId !== null) photoSelected = faceId
  if (!same) {
    photoFaces = []
    photoWho = ""
    getElement("faces-photo-title").textContent = `Photo ${mediaId}`
    setPhotoStatus("")
    showLoading(photoBody())
  }
  await refreshPhotoFaces()
}

async function refreshPhotoFaces() {
  const mediaId = photoMediaId
  if (mediaId === null) return
  try {
    const data = /** @type {Types.MediaFacesResponse} */ (
      await api(`/api/admin/media/${mediaId}/faces`)
    )
    if (photoMediaId !== mediaId) return
    photoFaces = data.faces
    if (!photoFaces.some((f) => f.faceId === photoSelected)) {
      const firstUnnamed = photoFaces.find((f) => f.personId === null)
      photoSelected = firstUnnamed ? firstUnnamed.faceId : null
    }
    renderPhoto()
  } catch (err) {
    console.error("Failed to load the photograph's faces:", err)
    const retry = () => void refreshPhotoFaces()
    showLoadError(photoBody(), 1, "Couldn't load this photo's faces.", retry)
  }
}

/** A face box's percentages of the ORIGINAL frame, clamped inside it.
 *  @param {Types.MediaFaceEntry} face */
function boxPercent(face) {
  const w = photoFaces[0]?.width ?? 0
  const h = photoFaces[0]?.height ?? 0
  const box = face.box
  if (!w || !h || !box) return { left: 0, top: 0, width: 0, height: 0 }
  /** @param {number} v @param {number} max */
  const clamp = (v, max) => (!Number.isFinite(v) || v < 0 ? 0 : v > max ? max : v)
  const left = clamp((box.x / w) * 100, 100)
  const top = clamp((box.y / h) * 100, 100)
  return {
    left,
    top,
    width: clamp((box.w / w) * 100, 100 - left),
    height: clamp((box.h / h) * 100, 100 - top),
  }
}

/** Says which face and what state — never what the photograph shows.
 *  @param {Types.MediaFaceEntry} face @param {number} i */
function photoFaceLabel(face, i) {
  const parts = [`Face ${i + 1} of ${photoFaces.length}`]
  parts.push(face.personName ? `named ${face.personName}` : "not named yet")
  if (face.provenance === "propagated") parts.push("carried across, not confirmed")
  if (face.routeState === "set_aside") parts.push("unclear")
  return parts.join(", ")
}

function renderPhoto() {
  const body = photoBody()
  if (photoFaces.length === 0) {
    body.innerHTML = html`<p class="muted">No faces are recorded in this photo.</p>`
    return
  }
  const first = photoFaces[0]
  const canBox = !!(first.width && first.height)
  const rows = photoFaces.map((f, i) => {
    const on = f.faceId === photoSelected
    const unclear = f.routeState === "set_aside" ? html`<span class="tag">unclear</span>` : ""
    const carried =
      f.provenance === "propagated" ? html`<span class="tag">carried across</span>` : ""
    const tags = html`${unclear}${carried}`
    const nameCell =
      f.personId !== null && !on
        ? html`<span class="pf-name"><strong>${f.personName ?? "Named"}</strong>${tags}</span>
            <span class="pf-tools">
              ${f.provenance === "propagated"
                ? html`<button type="button" class="linklike" data-pact="confirm"
                    data-face="${f.faceId}"
                    data-person="${f.personId}" data-name="${f.personName ?? ""}">Confirm</button>`
                : ""}
              <button type="button" class="linklike" data-pact="select" data-face="${f.faceId}">
                Change
              </button>
              <button type="button" class="linklike" data-pact="clear" data-face="${f.faceId}">
                Clear
              </button>
            </span>`
        : on
          ? html`<span class="someone pf-who">
              <label class="sr-only" for="faces-pf-who">Who is face ${i + 1}?</label>
              <input id="faces-pf-who" type="search" autocomplete="off" maxlength="200"
                placeholder="${f.personName
                  ? `${f.personName} — or type another name…`
                  : "Who is this?"}"
                value="${photoWho}" data-face="${f.faceId}" aria-controls="faces-pf-list" />
              ${tags}
              <ul class="who-list" id="faces-pf-list">${photoWhoList(photoWho, f.faceId)}</ul>
            </span>`
          : html`<button type="button" class="pf-pick" data-pact="select" data-face="${f.faceId}"
              >Who is this?${tags}</button
            >`
    return html`<li class="pf-row ${on ? "is-on" : ""}" data-face="${f.faceId}">
      <span class="pf-n">${i + 1}</span>
      ${chip(f)}
      ${nameCell}
    </li>`
  })
  body.innerHTML = html`<div class="pf">
      <figure class="pf-photo">
        <img class="pf-img" src="/media/${first.fileKey ?? ""}/display" alt=""
          data-fallback="/media/${first.fileKey ?? ""}/thumb" />
        ${canBox
          ? html`<div class="pf-boxes" role="group" aria-label="Faces in this photo">
              ${photoFaces.map((f, i) => {
                const pct = boxPercent(f)
                const cls = [
                  f.faceId === photoSelected ? "is-on" : "",
                  f.routeState === "set_aside" ? "is-unclear" : "",
                  f.personId !== null ? "is-named" : "",
                ].join(" ")
                return html`<button type="button" class="pf-box ${cls}"
                  data-pact="select" data-face="${f.faceId}" aria-label="${photoFaceLabel(f, i)}"
                  aria-pressed="${f.faceId === photoSelected ? "true" : "false"}"
                  data-left="${pct.left}" data-top="${pct.top}"
                  data-width="${pct.width}" data-height="${pct.height}"
                  ><span aria-hidden="true">${i + 1}</span></button
                >`
              })}
            </div>`
          : ""}
      </figure>
      <ol class="pf-list">
        ${rows}
      </ol>
    </div>
    ${canBox
      ? ""
      : html`<p class="muted small">
          This photo's size wasn't recorded, so its faces can't be placed on it. Every one is listed
          and can still be named.
        </p>`}`
  // The frame takes the photo's own shape before the image arrives, so the
  // boxes (percentages of it) sit right and nothing jumps when it loads.
  const frame = body.querySelector(".pf-photo")
  if (frame instanceof HTMLElement && canBox) {
    frame.style.aspectRatio = `${first.width} / ${first.height}`
  }
  body.querySelectorAll(".pf-box").forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    el.style.left = `${el.dataset.left}%`
    el.style.top = `${el.dataset.top}%`
    el.style.width = `${el.dataset.width}%`
    el.style.height = `${el.dataset.height}%`
  })
  const img = body.querySelector(".pf-img")
  if (img instanceof HTMLImageElement) {
    img.addEventListener("error", () => {
      const fallback = img.dataset.fallback
      if (fallback && !img.src.endsWith(fallback)) img.src = fallback
      else img.hidden = true
    })
  }
  wireChips(body)
  const input = document.getElementById("faces-pf-who")
  if (input instanceof HTMLInputElement && isWide()) input.focus({ preventScroll: true })
}

/** @param {string} text @param {number} faceId */
function photoWhoList(text, faceId) {
  const q = nameKey(text)
  if (!q) return ""
  const hits = peopleData.filter((p) => nameKey(p.displayName).includes(q)).slice(0, WHO_MAX)
  const exact = peopleData.some((p) => nameKey(p.displayName) === q)
  const typed = text.trim()
  return html`${hits.map(
    (p) => html`<li>
      <button type="button" class="who" data-pact="assign" data-face="${faceId}"
        data-person="${p.id}"
        data-name="${p.displayName}">
        ${avatar({ id: p.id, name: p.displayName })}${p.displayName}<span class="muted"
          >${plural(p.faces, "face", "faces")}</span
        >
      </button>
    </li>`,
  )}
  <li>
    <button type="button" class="who who-new" data-pact="${exact ? "new-dup" : "new"}"
      data-face="${faceId}"
      data-name="${typed}">
      ${exact
        ? html`+ Another person also called “${typed}”`
        : html`+ New person “${typed}”`}
    </button>
  </li>`
}

/** The dialog's footer line: what just happened, with its undo.
 *  @param {string} msg @param {(() => void) | null} [undo] */
function setPhotoStatus(msg, undo = null) {
  const el = getElement("faces-photo-status")
  if (!msg) {
    el.textContent = "Back button closes this."
    return
  }
  el.innerHTML = html`<span>${msg}</span>${undo
    ? html` <button type="button" class="linklike" data-pact="undo">Undo</button>`
    : ""}`
  photoUndo = undo
}
/** @type {(() => void) | null} */
let photoUndo = null

/**
 * Name (or clear) one face — POST faces/assign-one, the single-face route and
 * the only one that takes a set-aside face. `personId: null` clears, so the
 * same route is the undo.
 * @param {number} faceId @param {number | null} personId @param {string} name
 */
async function assignOneFace(faceId, personId, name) {
  if (pending.has(faceId)) return
  const face = photoFaces.find((f) => f.faceId === faceId)
  if (!face) return
  const before = face.personId
  const beforeName = face.personName ?? ""
  pending.add(faceId)
  try {
    await post("/api/admin/faces/assign-one", { faceId, personId })
    photoDirty = true
    photoWho = ""
    const n = photoFaces.indexOf(face) + 1
    setPhotoStatus(personId === null ? `Face ${n}: name cleared` : `Face ${n} is ${name}`, () => {
      void assignOneFace(faceId, before, beforeName).then(() => setPhotoStatus("Undone"))
    })
    // On to the next face still without a name, so a photo is named in a row.
    const after = photoFaces.slice(photoFaces.indexOf(face) + 1).find((f) => f.personId === null)
    photoSelected = personId === null ? faceId : after ? after.faceId : null
    await refreshPhotoFaces()
  } catch (err) {
    setPhotoStatus(getErrorMessage(err))
  } finally {
    pending.delete(faceId)
  }
}

/** @param {MouseEvent} e */
function onPhotoClick(e) {
  const t = e.target
  if (!(t instanceof Element)) return
  const el = t.closest("[data-pact]")
  if (!(el instanceof HTMLElement)) return
  const act = el.dataset.pact
  const faceId = Number(el.dataset.face)
  if (act === "undo") {
    const fn = photoUndo
    photoUndo = null
    if (fn) fn()
  } else if (act === "select") {
    photoSelected = faceId
    photoWho = ""
    renderPhoto()
  } else if (act === "clear") {
    void assignOneFace(faceId, null, "")
  } else if (act === "assign" || act === "confirm") {
    void assignOneFace(faceId, Number(el.dataset.person), el.dataset.name ?? "")
  } else if (act === "new" || act === "new-dup") {
    const name = el.dataset.name ?? ""
    if (!name) return
    const go = (/** @type {number} */ id) => void assignOneFace(faceId, id, name)
    if (act === "new-dup") confirmDuplicate(name, go)
    else {
      void createPerson(name, false)
        .then(go)
        .catch((err) => setPhotoStatus(getErrorMessage(err)))
    }
  }
}

/** @param {KeyboardEvent} e */
function onPhotoKeydown(e) {
  const t = e.target
  if (!(t instanceof HTMLInputElement) || t.id !== "faces-pf-who") return
  if (e.key === "Enter") {
    e.preventDefault()
    const first = document.querySelector("#faces-pf-list button")
    if (first instanceof HTMLElement) first.click()
  } else if (e.key === "ArrowDown") {
    e.preventDefault()
    const first = document.querySelector("#faces-pf-list button")
    if (first instanceof HTMLElement) first.focus()
  }
}

/** @param {Event} e */
function onPhotoInput(e) {
  const t = e.target
  if (!(t instanceof HTMLInputElement) || t.id !== "faces-pf-who") return
  photoWho = t.value
  const list = document.getElementById("faces-pf-list")
  if (list) list.innerHTML = photoWhoList(photoWho, Number(t.dataset.face))
}

function onPhotoClose() {
  photoMediaId = null
  photoFaces = []
  photoSelected = null
  photoWho = ""
  photoUndo = null
  // The screen behind is stale if anything was named; the router's up() is
  // about to mount it, and that mount refetches.
  if (photoDirty) stale = true
  photoDirty = false
}

// ------------------------------------------------------------ delegation

/** @param {MouseEvent} e */
function onClick(e) {
  const t = e.target
  if (!(t instanceof Element)) return
  const el = t.closest("[data-act]")
  if (!(el instanceof HTMLElement) || el.hasAttribute("disabled")) return
  const act = el.dataset.act
  const kind = el.dataset.kind ?? ""
  const id = Number(el.dataset.id)
  if (act === "assign") {
    pick(kind, id, Number(el.dataset.person), el.dataset.name ?? "")
  } else if (act === "new" || act === "new-dup") {
    const name = el.dataset.name ?? ""
    if (!name) return
    const go = (/** @type {number} */ personId) => pick(kind, id, personId, name)
    if (act === "new-dup") confirmDuplicate(name, go)
    else {
      void createPerson(name, false)
        .then(go)
        .catch((err) => showPickerError(getErrorMessage(err)))
    }
  } else if (act === "not-a-face") {
    pick(kind, id, null, "")
  } else if (act === "skip") {
    skip(kind, id)
  } else if (act === "exclude") {
    toggleExclude(Number(el.dataset.face))
  } else if (act === "out-not-a-face") {
    void leftOutNotAFace()
  } else if (act === "out-reset") {
    const g = place.face !== null ? groupOfFace(place.face) : null
    if (g) for (const fid of leftOutIds(g)) excluded.delete(fid)
    render()
  } else if (act === "order") {
    groupOrder = el.dataset.order === "varied" ? "varied" : "size"
    writeSession(ORDER_KEY, groupOrder)
    const first = groupsLeft()[0]
    if (place.face !== null || !first || !isWide()) render()
    else void navigate(groupHref(first.key), { replace: true })
  } else if (act === "undo-named") {
    const entry = named.find((x) => x.batchId === el.dataset.batch && !x.revoked)
    if (entry) void undoEntry(entry)
  } else if (act === "tick") {
    const fid = Number(el.dataset.face)
    if (el instanceof HTMLInputElement && el.checked) unticked.delete(fid)
    else unticked.add(fid)
    render()
  } else if (act === "propagate") {
    void applyPropagations()
  } else if (act === "revoke") {
    revokeFromHistory(el.dataset.batch ?? "")
  } else if (act === "history-retry") {
    void refreshBatches().then(() => render())
  } else if (act === "edit") {
    const mode = el.dataset.mode
    if (place.person === null) return
    if (mode === "rename" || mode === "merge" || mode === "link") {
      personEdit = personEdit && personEdit.mode === mode ? null : { id: place.person, mode }
      render()
      const field = document.querySelector(
        "#tab-faces .faces-inline input, #tab-faces .faces-inline select",
      )
      if (field instanceof HTMLElement) field.focus()
    }
  } else if (act === "edit-cancel") {
    personEdit = null
    render()
  } else if (act === "unlink") {
    if (place.person !== null) unlinkGuest(place.person)
  } else if (act === "link-guest") {
    const guest = guestOptions.find((g) => g.id === Number(el.dataset.guest))
    if (place.person !== null && guest) linkGuestId(place.person, guest)
  } else if (act === "use-guest-name") {
    const p = place.person !== null ? personById(place.person) : null
    if (p && p.guestName) renamePerson(p.id, p.guestName)
  } else if (act === "retire") {
    if (place.person !== null) retirePerson(place.person)
  }
}

/** @param {SubmitEvent} e */
function onSubmit(e) {
  const form = e.target
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return
  e.preventDefault()
  const personId = Number(form.dataset.person)
  const data = new FormData(form)
  if (form.dataset.form === "rename") renamePerson(personId, String(data.get("name") ?? ""))
  else if (form.dataset.form === "link") linkGuest(personId, String(data.get("guest") ?? ""))
  else if (form.dataset.form === "merge") {
    const into = Number(data.get("into"))
    if (into) mergePerson(personId, into)
  }
}

/** @param {Event} e */
function onInput(e) {
  const t = e.target
  if (!(t instanceof HTMLInputElement) || t.id !== "faces-who") return
  whoText = t.value
  whoFor = t.dataset.who ?? ""
  const [kind, id] = whoFor.split(":")
  const list = document.getElementById("faces-who-list")
  if (list) list.innerHTML = whoListMarkup(whoText, kind, Number(id))
  const err = document.querySelector("#tab-faces .picker-error")
  if (err instanceof HTMLElement) err.hidden = true
}

/** Enter in "someone else" takes the first match; ↓ walks the list.
 *  @param {KeyboardEvent} e */
function onKeydownInside(e) {
  const t = e.target
  if (t instanceof HTMLInputElement && t.id === "faces-who") {
    if (e.key === "Enter") {
      e.preventDefault()
      const first = document.querySelector("#faces-who-list button")
      if (first instanceof HTMLElement) first.click()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      const first = document.querySelector("#faces-who-list button")
      if (first instanceof HTMLElement) first.focus()
    }
    return
  }
  const arrow = e.key === "ArrowDown" || e.key === "ArrowUp"
  if (t instanceof HTMLElement && t.closest(".who-list") && arrow) {
    e.preventDefault()
    const li = t.closest("li")
    const to = e.key === "ArrowDown" ? li?.nextElementSibling : li?.previousElementSibling
    const btn = to?.querySelector("button")
    if (btn instanceof HTMLElement) btn.focus()
    else if (e.key === "ArrowUp") document.getElementById("faces-who")?.focus()
  }
}

// ------------------------------------------------------------------ keys

/** @param {KeyboardEvent} e @returns {boolean} */
function onKeys(e) {
  const v = place.view
  if (v === "people") {
    if (e.key !== "j" && e.key !== "k") return false
    const i = peopleData.findIndex((p) => p.id === place.person)
    const to =
      e.key === "j" ? (peopleData[i + 1] ?? (i < 0 ? peopleData[0] : null)) : peopleData[i - 1]
    if (to) void navigate(personHref(to.id), { replace: place.person !== null })
    return true
  }
  if (v !== "groups" && v !== "ask") return false
  if (e.key === "/") {
    document.getElementById("faces-who")?.focus()
    return true
  }
  const ids = v === "groups" ? groupsLeft().map((g) => g.key) : askLeft().map((x) => x.faceId)
  const current = v === "groups" ? (place.face !== null ? groupOfFace(place.face) : null) : null
  const at =
    v === "groups"
      ? current
        ? ids.indexOf(current.key)
        : -1
      : place.face !== null
        ? ids.indexOf(place.face)
        : -1
  const href = v === "groups" ? groupHref : askHref
  if (e.key === "j" || e.key === "]") {
    const to = ids[at + 1] ?? (at < 0 ? ids[0] : undefined)
    if (to !== undefined) void navigate(href(to), { replace: place.face !== null })
    return true
  }
  if (e.key === "k" || e.key === "[") {
    const to = at > 0 ? ids[at - 1] : undefined
    if (to !== undefined) void navigate(href(to), { replace: true })
    return true
  }
  if (at < 0 || place.face === null) return false
  if (v === "groups" && current && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    const faces = membersOf(current)
    const fi = faces.findIndex((f) => f.entry.faceId === place.face)
    const nf = faces[fi + (e.key === "ArrowRight" ? 1 : -1)]
    if (nf) void navigate(groupHref(nf.entry.faceId), { replace: true })
    return true
  }
  if (v === "groups" && e.key === "e") {
    toggleExclude(place.face)
    return true
  }
  if (e.key === "s") {
    skip(v === "groups" ? "group" : "ask", v === "groups" && current ? current.key : place.face)
    return true
  }
  if (e.key === "o") {
    const a = document.querySelector('#tab-faces .stage-tools a[href*="/photos/"]')
    if (a instanceof HTMLElement) a.click()
    return true
  }
  if (e.key === "x") {
    const b = document.querySelector('#tab-faces [data-act="not-a-face"]')
    if (b instanceof HTMLElement) b.click()
    return true
  }
  if (e.key === "Enter") {
    const b =
      v === "groups"
        ? document.querySelector('#tab-faces .pane-picker .btn-primary[data-act="assign"]')
        : document.querySelector("#tab-faces .cands .cand")
    // A focused control's own Enter wins (a candidate, a link) — unless it
    // is the very button Enter would press.
    const active = document.activeElement
    const onControl =
      active instanceof HTMLElement && !!active.closest("#tab-faces a, #tab-faces button")
    if (onControl && active !== b) {
      return false
    }
    if (!(b instanceof HTMLButtonElement) || b.disabled) return false
    b.click()
    return true
  }
  if (e.key === "1" || e.key === "2" || e.key === "3") {
    const b = document.querySelectorAll("#tab-faces .cands .cand")[Number(e.key) - 1]
    if (b instanceof HTMLButtonElement && !b.disabled) b.click()
    return true
  }
  return false
}

// ----------------------------------------------------------------- mount

/** @param {string} path a route pattern ("faces/groups/:face/photos/:media") */
function viewOf(path) {
  const seg = path.split("/")[1] ?? ""
  if (seg === "groups" || seg === "ask" || seg === "same-moment" || seg === "leftovers") return seg
  if (seg === "people" || seg === "history") return seg
  if (seg === "photos") return "leftovers"
  return "root"
}

/** Does this arrival name a face the data in hand can't place? Then the
 *  overview is fetched with `?face=` to say what became of it. */
function needsAnchor() {
  const id = place.face
  if (id === null || (place.view !== "groups" && place.view !== "ask")) return false
  if (groupOfFace(id) || namedEntryFor(id)) return false
  return !(overview?.anchor && overview.anchor.faceId === id)
}

/** Whether this arrival is about to be replaced by a redirect (so drawing it
 *  first would only flash). */
function willRedirect() {
  if (place.view === "root") return true
  if (!isWide()) return false
  if (place.view === "people") return place.person === null
  return (place.view === "groups" || place.view === "ask") && place.face === null
}

/** @type {Types.AdminPanel["mount"]} */
async function mount(params, query, ctx) {
  const view = /** @type {Types.FacesView} */ (viewOf(ctx.route.path))
  if (view !== place.view || parseId(params.person, "p") !== place.person) personEdit = null
  place = {
    view,
    face: parseId(params.face, "f"),
    person: parseId(params.person, "p"),
    media: parseId(params.media, "m"),
    photoFace: parseId(query.get("face"), "f"),
  }
  const dialog = !!ctx.route.dialog
  // The dialog's contents load alongside the screen under it.
  if (dialog && place.media !== null) void openPhoto(place.media, place.photoFace ?? place.face)
  if (!dialog && photoDirty) {
    stale = true
    photoDirty = false
  }
  const body = getElement("faces-body")
  if (!loaded) showLoading(body)
  else if (!ctx.samePanel && !willRedirect() && !needsAnchor()) {
    // Back from another section: draw what's in hand now, refresh under it.
    render()
  }
  try {
    if (!ctx.samePanel || stale || !loaded || needsAnchor()) {
      stale = true
      await ensureLoaded()
    }
    if (view === "history" && (!ctx.samePanel || !batchesData)) await refreshBatches()
  } catch (err) {
    console.error("Failed to load faces:", err)
    showLoadError(body, 1, "Couldn't load the faces.", () => void loadFaceAssignment())
    return
  }
  // Moved on while that loaded: the newer arrival draws.
  if (currentPlace()?.path !== ctx.path) return

  // Redirects are replaces, so they never leave a dead entry (IA §4).
  if (view === "root") {
    void navigate(firstUnfinished(), { replace: true })
    return
  }
  if (isWide() && !dialog) {
    if (view === "groups" && place.face === null && groupsLeft().length) {
      void navigate(groupHref(groupsLeft()[0].key), { replace: true })
      return
    }
    if (view === "ask" && place.face === null && askLeft().length) {
      void navigate(askHref(askLeft()[0].faceId), { replace: true })
      return
    }
    if (view === "people" && place.person === null && peopleData.length) {
      void navigate(personHref(peopleData[0].id), { replace: true })
      return
    }
  }
  // A new item starts a fresh "someone else"; stepping through one group's
  // faces keeps a half-typed name (the key is the group's, not the face's).
  const g = view === "groups" && place.face !== null ? groupOfFace(place.face) : null
  const key = view === "ask" ? `ask:${place.face}` : g ? `group:${g.key}` : ""
  if (key !== whoFor) {
    whoText = ""
    whoFor = key
  }
  render()
  if (view === "people" && place.person !== null) void loadPersonFaces(place.person)
}

/** @type {Types.initFaceAssignment} */
export function initFaceAssignment() {
  const tab = getElement("tab-faces")
  tab.addEventListener("click", onClick)
  tab.addEventListener("input", onInput)
  tab.addEventListener("keydown", onKeydownInside)
  tab.addEventListener("submit", onSubmit)

  // The photograph dialog is a top-level <dialog>: none of the above reaches it.
  const dialog = getElement("faces-photo-modal")
  dialog.addEventListener("click", onPhotoClick)
  dialog.addEventListener("keydown", onPhotoKeydown)
  dialog.addEventListener("input", onPhotoInput)
  dialog.addEventListener("close", onPhotoClose)

  // Chips crop to their container's size, which changes with the layout.
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let resizeTimer
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      const imgs = document.querySelectorAll(
        "#tab-faces .face-chip-img, #faces-photo-modal .face-chip-img",
      )
      imgs.forEach((img) => {
        if (img instanceof HTMLImageElement && img.complete) positionChip(img)
      })
    }, 150)
  })

  registerPanel("faces", {
    mount,
    keys: (e) => onKeys(e),
    help: {
      title: "Name faces",
      keys: [
        ["Enter", "Yes — name them as suggested"],
        ["1 2 3", "Pick one of the alternatives"],
        ["/", "Someone else: type a name"],
        ["e", "Not the same person (leave this face out)"],
        ["← →", "Step through the faces in a group"],
        ["j k", "Next / previous group or question"],
        ["s", "Skip for now"],
        ["o", "Open the photo"],
        ["x", "Not a face"],
      ],
    },
  })
}
