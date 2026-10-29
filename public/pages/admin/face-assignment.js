/** @file Faces tab — assisted face tagging against the photographed CAST
 *  (docs/post-wedding/SPEC-vision-lab.md §6.5, SESSION-2-vision.md §4b). A
 *  list, never a wizard: unnamed Groups, an Ask queue ordered by what
 *  confirming would unlock, Same moment (must-link propagations), a minimal
 *  Identified summary, and People. Every confirm is an immediate POST; there is
 *  no batch "finish" step and no keyboard-trapping modal, so the page is
 *  abandonable at any point.
 *
 *  GROUPS IS TWO VIEWS, not one, and that is the load-bearing change from the
 *  first version. It used to be a grid of cards, each rendering every face its
 *  group held, at full length — so the page grew without bound in the group
 *  count AND in the size of every group, and only a few people were on screen
 *  at once however far you scrolled. A 96px thumbnail is not something anyone
 *  can be sure about anyway. Both are the same complaint: the screen was built
 *  to show the WHOLE problem, and the work is one person at a time. So:
 *
 *   - **The overview list** — one row per group, a few chips, the size and the
 *     suggested name, at a FIXED row height whatever the group's size. It is
 *     the non-linear way in and the progress display, and it names nobody.
 *   - **The review view** — one group, the selected face large off the
 *     `display` variant, and a filmstrip of every face in the group beside it.
 *     Naming happens here.
 *
 *  THE FILMSTRIP IS WHY THE REVIEW VIEW EXISTS. It carries the group's
 *  `set_aside` members too, dimmed and labelled, so it is the answer to "Open
 *  photo opens ONE arbitrary photograph out of the many a group spans, with no
 *  way to reach the others": every photograph the group touches is one click
 *  away, and the odd one out is excluded before the rest are named.
 *
 *  WHAT IS NOT HERE ANY MORE is the per-group "this may be two people" banner.
 *  It was not selective enough to be worth a banner — a warning has to be, or
 *  it reads as noise and trains the eye past it. A search for a statistic that
 *  would earn one came back empty; `weldRisk` in api/admin/faces.js records
 *  what was tried and how to re-run it, so nobody re-derives it from scratch.
 *  The information survives in the two places where being wrong is free: ONE
 *  standing sentence at the top of the list, and the "most varied first" sort
 *  order. Nothing per card, nothing repeated.
 *
 *  PEOPLE, NOT GUESTS. Faces are assigned to a `people` row, not to a `guests`
 *  row. A guest is an INVITATION — one per party, with a unique invite code —
 *  and much of the cast is not on that list at all: partners recorded under
 *  someone else's row, children, the photographer, vendors. A person carries an
 *  optional `guestId` link back to the roster, which is what the second
 *  datalist in index.html is for. Assigning by name is not an API shape: the
 *  name input resolves to a personId here and the request carries the id.
 *
 *  CONTRACT NOTE: there is no crop endpoint. Faces are shown by loading the
 *  photo's existing `/media/:fileKey/thumb` variant and cropping to the face's
 *  box client-side (see renderFaceChip + positionFaceChipImage). That needs
 *  the ORIGINAL photo's pixel width/height alongside each box, because the box
 *  is in original-pixel coordinates and the thumb is an unknown scale of it.
 *  This was originally written as an ASSUMPTION about the server, and the
 *  assumption was wrong — the payloads carried faceId/mediaId/box only, so
 *  every chip in this tab silently rendered an uncropped thumbnail. The server
 *  now sends `fileKey` + `width`/`height` on every chip entry (`chipOf` in
 *  api/admin/faces.js, pinned by an integration test). The graceful
 *  degradation is still there — a missing dimension bails out of
 *  positionFaceChipImage rather than breaking the row — but it is now the
 *  fallback it was meant to be rather than the normal case.
 *
 *  THE PER-PHOTOGRAPH VIEW (bottom of this file) closes what used to be a hole
 *  in the above. Quality routing withholds low-grade faces from Groups and the
 *  Ask queue, and bulk assign REFUSES them by design — so `set_aside` was a
 *  state the UI could put a face into and never get it out of. The sections
 *  above are all lists of FACES; `#faces-photo-modal` is the one view of a
 *  PHOTOGRAPH, showing every face in it whatever its routing state, each
 *  nameable one at a time through POST /api/admin/faces/assign-one (the
 *  deliberate single-face exemption). `personId: null` on that route is its own
 *  undo, which is where "clear this name" comes from too.
 *
 *  It is a `<dialog>` declared in index.html rather than markup rendered into
 *  #faces-body, because #faces-body is replaced wholesale on every render and
 *  initModals() sweeps the document once at startup. That also means it
 *  inherits NONE of the delegation below — see initFaceAssignment.
 *
 *  THE SET-ASIDE LIST closes what was still missing from THAT. Every way into
 *  the dialog was an "Open photo" button rendered beside a face — in a group's
 *  card or an ask row — and both of those lists filter `set_aside` out. So a
 *  photograph whose faces are ALL set aside, or all already named, appeared in
 *  neither, nothing rendered a button for it, and its faces stayed unreachable
 *  however carefully assign-one had been exempted. The header's "N set aside"
 *  count is now a button that lists those PHOTOGRAPHS (GET
 *  /api/admin/faces/set-aside), each opening the same dialog through the same
 *  `.faces-open-photo` delegation. No second modal and no second assignment
 *  path: the only new thing is a way to arrive.
 *
 *  RECENT BULK PASSES (last section, collapsed) is the undo. Every bulk
 *  mutation here posts back a `batchId` and, until this section existed,
 *  nothing on the page ever used one — so the ledger's central promise (revoke
 *  a pass, keep the corrections made after it) was reachable only from a test.
 *  It is a short newest-first list with a Revoke button, not a history browser:
 *  the case it serves is "that group was two people and I just named thirty
 *  faces", which is minutes old. The button is NOT styled destructive, and the
 *  copy says twice that nothing is deleted and that later hand corrections
 *  survive — an admin who thinks revoking is destructive will not use it, and
 *  will redo work that was never lost. */
/** @import * as Types from "./types.js" */

import {
  api,
  showError,
  showSuccess,
  showLoading,
  showLoadError,
  openModal,
} from "./utils.js"
import {
  html,
  getElement,
  getButtonElement,
  getErrorMessage,
} from "../utils.js"
import { openConfirm } from "./confirm.js"

/** Fallback CSS-pixel size for a face chip, used only when the element has not
 *  been laid out yet. Every chip's real size is read from its own container
 *  (positionFaceChipImage), because there are now three of them: the list
 *  chips, the filmstrip, and the review view's large stage. */
const CHIP_SIZE = 96

/** How many chips one overview row previews. Four fits beside the count and the
 *  suggested name at a comfortable height, and — the actual point — the row is
 *  that height whether the group holds four faces or forty. */
const OVERVIEW_PREVIEW_CHIPS = 4

/** The review view's large image crops to the face's box widened by this much
 *  about its centre. It buys two things with one number: a face with some hair
 *  and shoulder around it is far easier to place than one cropped to the jaw,
 *  AND a wider crop is proportionally more SOURCE pixels rendered into the same
 *  square, so the upscale from the `display` variant falls by the same factor.
 *  Context and sharpness are the same knob here, which is the reason this view
 *  does not need `original` (which is served `Content-Disposition: attachment`
 *  and must never appear in an `<img>`). */
const REVIEW_STAGE_PAD = 1.6

/** @type {Types.FacesOverviewResponse | null} */
let overview = null
/** @type {Types.FacesQueueResponse | null} */
let queueData = null
/** @type {Types.FacePropagationsResponse | null} */
let propagationData = null

/** The set-aside PHOTOGRAPH list, and whether the header count has been used to
 *  open it. Loaded lazily — an admin who never has a set-aside face never pays
 *  for the query — and kept across a reload, so naming a face in the dialog
 *  (which reloads the whole tab on close) does not collapse the list underneath
 *  the person working through it.
 *  @type {Types.FacesSetAsideResponse | null} */
let setAsideData = null
let setAsideOpen = false
/** Non-fatal: the panel shows this and offers a retry, and every other section
 *  renders regardless. @type {string | null} */
let setAsideError = null

/** Photographs per page of the set-aside list. Small on purpose — this is a
 *  "work through them" list, not a browse, and the rest of the tab is below it. */
const SET_ASIDE_PAGE = 20

/** The batch history behind the undo affordance, and whether its panel is open.
 *  Lazily fetched on first open and refetched with every reload while open —
 *  a revocation changes a row's own state, and a stale row would offer to undo
 *  something already undone. Non-fatal on failure, like the set-aside list.
 *  @type {Types.FacesBatchesResponse | null} */
let batchesData = null
let batchesOpen = false
/** @type {string | null} */
let batchesError = null

/** People cache for the name-input autocomplete and the People section (a
 *  per-module cache, not shared admin state). A person is who a face belongs
 *  to; the guest roster is only the optional link on a person. */
/** @type {Types.PersonEntry[]} */
let peopleData = []
let peopleLoaded = false

/** Guest roster cache, used ONLY to link a person to an invitation in the
 *  People section (mirrors thank-you.js's ensureGuestsLoaded — a per-module
 *  cache, not shared admin state). Faces are never named against this list;
 *  they are named against `peopleData`. */
/** @type {{ id: number, name: string }[]} */
let guestOptions = []
let guestsLoaded = false

/**
 * Fold a name to its comparison key. MIRRORS `nameKey` in db/people.js, which
 * is the authority — the server refuses a duplicate create on the same rule, so
 * if these two disagree the UI offers to create someone the server then
 * rejects. NFC first because a combining accent and a precomposed one look
 * identical and compare unequal; `toLowerCase` after because it is
 * Unicode-aware where SQLite's COLLATE NOCASE folds ASCII only. No regex —
 * both are string methods.
 * @param {string} name
 */
function nameKey(name) {
  return name.normalize("NFC").toLowerCase()
}

/**
 * A match margin, for display.
 *
 * `null` is a real value here, not a defensive guard: matchFace reports
 * `Infinity` when a face has exactly ONE prototype to compare against ("no
 * second-best" — an unopposed match), and `JSON.stringify(Infinity)` is `null`.
 * So the moment the first person is named — including through the
 * per-photograph view — every suggestion and every ask candidate arrives with a
 * null margin, and calling `.toFixed` on it threw, taking the whole tab's render
 * down with it. That is exactly the state a first-time admin is in.
 * @param {number | null | undefined} margin
 */
function formatMargin(margin) {
  if (typeof margin !== "number" || !Number.isFinite(margin)) return "unopposed"
  return margin.toFixed(2)
}

/** Faces excluded ("reject from this action") per group, keyed by
 *  `String(group.key)`. Client-only until "Not a face" or a reload — and
 *  DROPPED on every reload, because a group key is a position in a list the
 *  server recomputes from scratch each time. Holding an exclusion across a
 *  reload does not preserve a judgement, it re-points it at whatever cluster
 *  landed at that index. */
const excludedByGroup = /** @type {Map<string, Set<number>>} */ (new Map())

/** Which group the review view is showing, by `group.key`; null is the overview
 *  list. @type {string | null} */
let reviewGroupKey = null
/** The face shown large in the review view. @type {number | null} */
let reviewFaceId = null
/** What the admin has typed into the review view's name field. Kept across the
 *  re-renders that selecting or excluding a face causes — without it, checking
 *  one more face silently threw away a half-typed name. Null means untouched,
 *  so the field falls back to the group's suggestion. @type {string | null} */
let reviewNameDraft = null

/** Overview ordering. `size` is the server's own (clearest first — groups that
 *  are mostly accept-routed faces — then largest, so the most progress per
 *  confirm and the hard leftovers last); `varied` sorts by the weld score, which is a weak
 *  signal spent where being wrong is free — see the file header.
 *  @type {"size" | "varied"} */
let groupOrder = "size"

/** Ask-queue faces dismissed via "None of these" this session — a visual-only
 *  dim, since the contract has no "reviewed, no match" endpoint to record it. */
const dismissedAsk = /** @type {Set<number>} */ (new Set())

/** Face ids with a mutation in flight — guards double-submit from a fast
 *  double-click or a held-down keyboard shortcut. */
const pending = /** @type {Set<number>} */ (new Set())

/** The same guard for the People section, keyed by person id. Separate set:
 *  face ids and person ids are different keyspaces and would collide. */
const pendingPeople = /** @type {Set<number>} */ (new Set())

// ---- load + top-level render ----------------------------------------------

/** @type {Types.loadFaceAssignment} */
export async function loadFaceAssignment() {
  const body = getElement("faces-body")
  showLoading(body)
  try {
    const [ov, q, p] = await Promise.all([
      api("/api/admin/faces/overview"),
      api("/api/admin/faces/queue"),
      api("/api/admin/faces/propagations"),
      refreshPeople(),
      ensureGuestsLoaded(),
    ])
    overview = /** @type {Types.FacesOverviewResponse} */ (ov)
    // ⚠ Before anything renders, and for the same reason twice. A group key is
    // an INDEX into a list the server rebuilds from live rows on every request,
    // so the group at key "7" after a reload is generally not the group at key
    // "7" before it. An exclusion carried across that boundary would silently
    // apply to a different person's faces, and a review view left open on that
    // key would show a different group under an unchanged heading. Both are
    // dropped; the one caller that wants to come back — reloadAnchoredOnFace —
    // re-derives the key from a FACE that survived, which is stable.
    excludedByGroup.clear()
    reviewGroupKey = null
    reviewFaceId = null
    reviewNameDraft = null
    queueData = /** @type {Types.FacesQueueResponse} */ (q)
    propagationData = /** @type {Types.FacePropagationsResponse} */ (p)
    // Only when the panel is open, and only then — the set-aside list is the
    // one section an admin may never need, so it stays unfetched until asked
    // for. Once open it is refetched with everything else: naming a face there
    // changes `unnamedSetAside`, and a stale row would claim work already done.
    if (setAsideOpen) await refreshSetAside()
    // Same rule, same reason: only when open, and then every time — a revoked
    // batch that still renders a Revoke button is an offer to undo something
    // already undone.
    if (batchesOpen) await refreshBatches()
    renderCounts()
    renderBody()
  } catch (err) {
    console.error("Failed to load face assignment data:", err)
    showLoadError(body, 1, "Couldn't load face data.", () => void loadFaceAssignment())
  }
}

/** Load the people list (for the name-autocomplete datalist + People section).
 *  Failing to load it is non-fatal — groups/queue still render, just without
 *  autocomplete until a retry. */
async function refreshPeople() {
  try {
    const data = /** @type {Types.PeopleApiResponse} */ (await api("/api/admin/people"))
    peopleData = data.people
    peopleLoaded = true
    renderPeopleDatalist()
  } catch (err) {
    console.error("Failed to load people for face autocomplete:", err)
  }
}

function renderPeopleDatalist() {
  const dl = document.getElementById("faces-people-roster")
  if (!dl) return
  dl.innerHTML = html`${peopleData.map((p) => html`<option value="${p.displayName}"></option>`)}`
}

/** Load the guest roster ONCE, for the People section's "link an invitation"
 *  control only — same fetch as the thank-you tab's picker. Non-fatal: without
 *  it the link inputs render disabled and everything else still works. */
async function ensureGuestsLoaded() {
  if (guestsLoaded) return
  try {
    const data = /** @type {Types.GuestsApiResponse} */ (
      await api("/api/admin/guests?limit=1000&offset=0")
    )
    guestOptions = data.guests.map((g) => ({ id: g.id, name: g.name }))
    guestsLoaded = true
    renderGuestDatalist()
  } catch (err) {
    console.error("Failed to load guest roster for person-to-invitation linking:", err)
  }
}

function renderGuestDatalist() {
  const dl = document.getElementById("faces-guest-roster")
  if (!dl) return
  dl.innerHTML = html`${guestOptions.map((g) => html`<option value="${g.name}"></option>`)}`
}

/**
 * The header tallies — and one of them is a CONTROL, not a statistic.
 *
 * "N set aside" is a real `<button>` because it is the entry point to the
 * photographs those faces are in. Everything else in this tab is a list of
 * FACES and every one of them filters `set_aside` out, so a photograph whose
 * faces are all set aside (or all already named) appeared in no group's chips
 * and no queue row — nothing rendered an "Open photo" button for it and its
 * faces could not be reached at all, however deliberately `assign-one` had been
 * exempted from the routing check. This count was already the only place on
 * screen that admitted they existed; making it the way in is what closes that.
 *
 * A button rather than a chip with a click handler, so it is keyboard-reachable
 * and announced as expandable for free. Its accessible name is a number and two
 * words — nothing here ever describes a photograph.
 */
function renderCounts() {
  const el = getElement("faces-counts")
  if (!overview) {
    el.innerHTML = ""
    return
  }
  const c = overview.counts
  const r = overview.routeCounts
  el.innerHTML = html`
    <span class="faces-count"><strong>${c.faces}</strong> faces</span>
    <span class="faces-count"><strong>${c.identified}</strong> identified</span>
    <span class="faces-count"><strong>${c.unidentified}</strong> unidentified</span>
    <span class="faces-count"><strong>${c.notAFace}</strong> not a face</span>
    ${r && r.setAside > 0
      ? html`<button type="button"
          class="faces-count faces-count-muted faces-setaside-toggle"
          aria-expanded="${setAsideOpen ? "true" : "false"}"
          aria-controls="faces-setaside-panel"
          title="Too small or too soft to be worth naming from the queue. Still stored, still grouped — open this to list the photographs they are in and name them there."
          ><strong>${r.setAside}</strong> set aside</button
        >`
      : ""}
    ${r && r.ungraded > 0
      ? html`<span class="faces-count faces-count-muted"
          title="Ingested before quality routing existed, so never graded. Shown and assignable exactly as before."
          ><strong>${r.ungraded}</strong> ungraded</span
        >`
      : ""}
  `
}

function renderBody() {
  const body = getElement("faces-body")
  if (!overview || !queueData) return

  if (overview.counts.faces === 0) {
    body.innerHTML = emptyIngestMarkup()
    return
  }

  // Review mode takes the whole tab. Everything else here is a list, and a list
  // stacked under a view whose entire purpose is "look at ONE thing properly"
  // is the wall of thumbnails again by another route. Nothing is lost by their
  // absence: Escape or "All groups" brings them straight back, and every one of
  // them re-derives from state already in hand.
  const reviewing = reviewGroup()
  if (reviewing) {
    body.innerHTML = html`
      <section class="faces-section" aria-labelledby="faces-review-heading">
        ${reviewMarkup(reviewing)}
      </section>
    `
    wireFaceChipImages(body)
    focusReview()
    return
  }

  body.innerHTML = html`
    ${setAsidePanelMarkup()}
    <section class="faces-section" aria-labelledby="faces-groups-heading">
      <h3 id="faces-groups-heading">Groups</h3>
      ${groupsMarkup()}
    </section>
    <section class="faces-section" aria-labelledby="faces-queue-heading">
      <h3 id="faces-queue-heading">Ask queue</h3>
      ${queueMarkup()}
    </section>
    ${propagationsMarkup()}
    <section class="faces-section" aria-labelledby="faces-identified-heading">
      <h3 id="faces-identified-heading">Identified</h3>
      ${identifiedMarkup()}
    </section>
    <section class="faces-section" aria-labelledby="faces-people-heading">
      <h3 id="faces-people-heading">People</h3>
      ${peopleMarkup()}
    </section>
    ${batchesPanelMarkup()}
  `
  wireFaceChipImages(body)
}

function emptyIngestMarkup() {
  return html`
    <div class="faces-empty-state">
      <p>No faces have been ingested yet.</p>
      <p class="text-muted">
        Run the face pipeline against a folder of photos from the command line:
      </p>
      <pre class="faces-cli-hint">node scripts/vision/ingest-faces.js &lt;run-dir&gt;</pre>
    </div>
  `
}

// ---- Set aside: the photographs, not the faces ----------------------------

/**
 * The panel the header's "set aside" count opens.
 *
 * Rendered whenever there is a set-aside face at all, `hidden` while collapsed,
 * rather than added and removed — the toggle's `aria-controls` has to point at
 * an element that exists, and an assistive technology should be able to find the
 * region the button claims to control before it is opened.
 *
 * It sits FIRST in the body on purpose. It is the shortest list on the page and
 * the only one whose contents are otherwise unreachable, so it is the one thing
 * here that would be worst to have to scroll for.
 */
function setAsidePanelMarkup() {
  if (!overview || overview.routeCounts.setAside === 0) return ""
  return html`
    <section class="faces-section" id="faces-setaside-panel"
      aria-labelledby="faces-setaside-heading" ${setAsideOpen ? "" : "hidden"}>
      <h3 id="faces-setaside-heading">Set aside</h3>
      <p class="faces-setaside-note text-muted">
        These faces were held back from the Groups and the Ask queue as too small or too soft to
        name off a list, and a bulk action will not touch them. Open a photograph to see every
        face in it — set aside included — and name them one at a time.
      </p>
      ${setAsideBodyMarkup()}
    </section>
  `
}

function setAsideBodyMarkup() {
  // The error sits ABOVE the list rather than replacing it: a failed "show
  // more" must not throw away the pages that did load, or a transient blip
  // costs the admin their place in the list.
  const problem =
    setAsideError === null
      ? ""
      : html`<p class="faces-setaside-error" role="alert">
          ${setAsideError}
          <button type="button" class="btn btn-secondary btn-sm faces-setaside-retry">
            Try again
          </button>
        </p>`
  const data = setAsideData
  if (!data) return html`${problem}${setAsideError === null ? html`<p class="faces-empty text-muted">Loading…</p>` : ""}`
  if (data.photos.length === 0) {
    // Reachable, and worth saying plainly rather than as "nothing here": the
    // header count is over live FACES while this list is over live
    // PHOTOGRAPHS, so a set-aside face whose photograph has since been deleted
    // is counted above and has no row below. Silence would look like a bug.
    return html`${problem}<p class="faces-empty text-muted">
      No photographs to open — every remaining set-aside face is on a photograph that has since
      been deleted.
    </p>`
  }
  const remaining = data.total - data.photos.length
  return html`
    ${problem}
    <ul class="faces-setaside-list">
      ${data.photos.map(setAsidePhotoRowMarkup)}
    </ul>
    ${remaining > 0
      ? html`<button type="button" class="btn btn-secondary btn-sm faces-setaside-more">
          Show more (${remaining} more ${remaining === 1 ? "photograph" : "photographs"})
        </button>`
      : ""}
  `
}

/**
 * One photograph's row.
 *
 * The accessible name on its button is built from ids and counts alone —
 * "Photograph 41, 3 faces set aside, 2 still to name". Never anything about what
 * the photograph shows or who is in it (CLAUDE.md, "Photographs Are Input To
 * Code, Not To A Reader"), and the thumbnail is `alt=""` for the same reason:
 * it is there to be recognised by the person who took it, not described.
 * @param {Types.FaceSetAsidePhoto} photo
 */
function setAsidePhotoRowMarkup(photo) {
  const set = photo.setAsideFaces
  const left = photo.unnamedSetAside
  const label =
    `Photograph ${photo.mediaId}, ${set} ${set === 1 ? "face" : "faces"} set aside, ` +
    (left === 0 ? "all named" : `${left} still to name`)
  return html`
    <li class="faces-setaside-row ${left === 0 ? "is-done" : ""}" data-media-id="${photo.mediaId}">
      <img class="faces-setaside-thumb" src="/media/${photo.fileKey}/thumb" alt="" loading="lazy" />
      <div class="faces-setaside-main">
        <p class="faces-setaside-summary">
          <strong>${set}</strong> of ${photo.liveFaces}
          ${photo.liveFaces === 1 ? "face" : "faces"} here ${set === 1 ? "was" : "were"} set aside
        </p>
        <p class="faces-setaside-remaining text-muted">
          ${left === 0
            ? "All of them have a name."
            : html`${left} still ${left === 1 ? "has" : "have"} no name.`}
        </p>
      </div>
      ${openPhotoButtonMarkup(photo.mediaId, label)}
    </li>
  `
}

/** Fetch one page. Separate from the render so both the toggle and "show more"
 *  fail the same way. @param {number} offset */
async function fetchSetAsidePage(offset) {
  return /** @type {Types.FacesSetAsideResponse} */ (
    await api(`/api/admin/faces/set-aside?limit=${SET_ASIDE_PAGE}&offset=${offset}`)
  )
}

/** Load the first page, replacing whatever was held. Used by the toggle and by
 *  every reload while the panel is open — naming a face changes
 *  `unnamedSetAside`, and a stale row would claim work that is already done. */
async function refreshSetAside() {
  try {
    setAsideData = await fetchSetAsidePage(0)
    setAsideError = null
  } catch (err) {
    console.error("Failed to load the set-aside photographs:", err)
    setAsideError = "Couldn't load the photographs with set-aside faces."
  }
}

/**
 * Open or close the panel.
 *
 * `aria-expanded` is updated on the button IN PLACE rather than by re-rendering
 * the counts: `renderCounts` replaces the whole `#faces-counts` subtree, which
 * would destroy the very button that was just activated and drop keyboard focus
 * to the document body.
 * @param {HTMLElement} toggle
 */
async function toggleSetAside(toggle) {
  setAsideOpen = !setAsideOpen
  toggle.setAttribute("aria-expanded", setAsideOpen ? "true" : "false")
  renderBody()
  if (!setAsideOpen || setAsideData !== null) return
  await refreshSetAside()
  renderBody()
}

/** Append the next page. Focus is put back on the button afterwards (or on the
 *  last row's "Open photo" when the list is now complete and the button is
 *  gone), because renderBody replaces the element that was clicked. */
async function loadMoreSetAside() {
  const data = setAsideData
  if (!data) return
  try {
    const next = await fetchSetAsidePage(data.photos.length)
    setAsideData = {
      photos: [...data.photos, ...next.photos],
      total: next.total,
      limit: next.limit,
      offset: next.offset,
    }
    setAsideError = null
  } catch (err) {
    console.error("Failed to load more set-aside photographs:", err)
    // `setAsideData` is left alone — the pages already on screen are still
    // good, and "show more" stays available to retry with.
    setAsideError = "Couldn't load any more photographs."
  }
  renderBody()
  const more = document.querySelector(".faces-setaside-more")
  if (more instanceof HTMLElement) {
    more.focus()
    return
  }
  const rows = document.querySelectorAll(".faces-setaside-row .faces-open-photo")
  const last = rows[rows.length - 1]
  if (last instanceof HTMLElement) last.focus()
}

// ---- Groups -----------------------------------------------------------

/**
 * The groups in the order the overview lists them AND the order prev/next walks
 * — one function, so the two can never disagree about what "the next group" is.
 *
 * `size` needs no sort: the server already returns clearest-then-largest, which
 * buys the most identified faces per confirm and keeps the viewpoint-clustered
 * leftovers (profiles, backs of heads) at the end. `varied` spends the
 * weld score (see the file header) as an ordering, which is the only way a weak
 * signal is worth having — a wrong guess costs the admin the sequence they work
 * in and nothing else.
 * @returns {Types.FaceGroup[]}
 */
function orderedGroups() {
  if (!overview) return []
  if (groupOrder !== "varied") return overview.groups
  return [...overview.groups].sort(
    (a, b) => (b.weld?.ratio ?? 0) - (a.weld?.ratio ?? 0) || b.size - a.size,
  )
}

/** @returns {Types.FaceGroup | null} */
function reviewGroup() {
  if (reviewGroupKey === null || !overview) return null
  return overview.groups.find((g) => String(g.key) === reviewGroupKey) ?? null
}

/**
 * Every face in a group, in filmstrip order: the bulk-nameable ones first, then
 * the ones routing held back.
 *
 * The two arrive as two arrays from the server and are deliberately NOT merged
 * anywhere but here, for display. `group.faceIds` — what "Confirm all" posts —
 * is the first list only, and the server refuses a bulk call carrying anything
 * from the second. Showing them together while keeping them apart in every
 * request is the whole trick this view turns.
 * @param {Types.FaceGroup} group
 * @returns {Array<{ entry: Types.FaceChipEntry, setAside: boolean }>}
 */
function reviewFaces(group) {
  return [
    ...group.media.map((entry) => ({ entry, setAside: false })),
    ...group.setAsideMedia.map((entry) => ({ entry, setAside: true })),
  ]
}

/** @param {Types.FaceGroup} group */
function excludedIn(group) {
  return excludedByGroup.get(String(group.key)) ?? new Set()
}

/** The face ids a bulk confirm would carry: shown, minus anything excluded.
 *  @param {Types.FaceGroup} group */
function assignableFaceIds(group) {
  const excluded = excludedIn(group)
  return group.faceIds.filter((id) => !excluded.has(id))
}

function groupsMarkup() {
  if (!overview) return ""
  const groups = orderedGroups()
  if (groups.length === 0) {
    return html`<p class="faces-empty text-muted">No unnamed groups right now.</p>`
  }
  return html`
    <!-- The ONE place this tab says that a group is sometimes two people. It
         used to be a banner on every card, which meant it was on screen dozens
         of times and therefore read nowhere. Said once, as standing context,
         next to the thing that actually checks it. -->
    <p class="faces-groups-standing text-muted">
      Each row is one group of faces the matcher thinks are the same person. Open one to look
      through them a face at a time, then name the whole group at once. Occasionally a group is
      two people who look alike — that is what the filmstrip is for, and anyone who does not
      belong can be excluded before you name the rest.
    </p>
    <div class="faces-groups-toolbar">
      <label class="faces-groups-sort">
        Order
        <select class="faces-groups-sort-select" aria-label="Order the groups">
          <option value="size" ${groupOrder === "size" ? "selected" : ""}>Clearest first</option>
          <option value="varied" ${groupOrder === "varied" ? "selected" : ""}>
            Most varied first
          </option>
        </select>
      </label>
      <span class="text-muted faces-groups-total">
        ${groups.length} group${groups.length === 1 ? "" : "s"} still to name
      </span>
    </div>
    <ul class="faces-overview-list">
      ${groups.map((group, index) => overviewRowMarkup(group, index, groups.length))}
    </ul>
  `
}

/** Why a group has no suggested name: nobody named yet, or nobody close enough.
 *  @param {Types.FaceGroup} group */
function noSuggestionText(group) {
  return group.abstained ? "no confident match" : "no suggestion yet"
}

/**
 * One group, compactly.
 *
 * A fixed number of chips and a fixed height, whatever the group holds — that
 * is the fix for "long groups run far off screen", and it is why the row shows
 * `+N more` rather than growing. The whole row is one `<button>` so it is a
 * single keyboard-reachable target with one accessible name; the chips inside
 * are inert `<span>`s, never nested controls.
 *
 * The accessible name is a position, a count and a name someone typed. Nothing
 * here describes a photograph (CLAUDE.md, "Photographs Are Input To Code").
 * @param {Types.FaceGroup} group
 * @param {number} index
 * @param {number} total
 */
function overviewRowMarkup(group, index, total) {
  const preview = group.media.slice(0, OVERVIEW_PREVIEW_CHIPS)
  const more = group.size - preview.length
  const suggestion = group.suggestion
  const label =
    `Review group ${index + 1} of ${total}, ${group.size} face${group.size === 1 ? "" : "s"}` +
    (suggestion ? `, suggested ${suggestion.personName}` : `, ${noSuggestionText(group)}`)
  return html`
    <li>
      <button type="button" class="face-overview-row" data-group-key="${String(group.key)}"
        aria-label="${label}">
        <span class="face-overview-chips">${preview.map(faceChipMarkup)}</span>
        <span class="face-overview-main">
          <span class="face-overview-count">
            <strong>${group.size}</strong> face${group.size === 1 ? "" : "s"}
            ${more > 0 ? html`<span class="face-overview-more">+${more} not shown here</span>` : ""}
          </span>
          <span class="face-overview-suggestion">
            ${suggestion ? html`suggested: ${suggestion.personName}` : noSuggestionText(group)}
          </span>
        </span>
        <span class="face-overview-go" aria-hidden="true">Review →</span>
      </button>
    </li>
  `
}

// ---- the review view: one group, one face at a time ----------------------

/**
 * The focused view. Large face on the left, every face in the group on the
 * right, name field and confirm above, group navigation below.
 *
 * **"Confirm all" and the set-aside trap.** The filmstrip deliberately shows
 * faces the quality gate held back, and the bulk endpoint deliberately refuses
 * them — so the count on the button is `assignableFaceIds(group)`, never the
 * group's size, and the two differ in plain sight rather than by a rejected
 * request. What the view offers instead is "Name only this face", which posts
 * to `assign-one`: the single-face exemption, the one route that will take a
 * set-aside face. Weakening the server check to make one button do both was
 * available and is exactly what the check exists to prevent — a bulk action
 * must not be able to name a face nobody looked at, and the filmstrip showing
 * one is not the same as somebody having decided about it.
 * @param {Types.FaceGroup} group
 */
function reviewMarkup(group) {
  const groups = orderedGroups()
  const position = groups.findIndex((g) => String(g.key) === reviewGroupKey)
  const faces = reviewFaces(group)
  const found = faces.findIndex((f) => f.entry.faceId === reviewFaceId)
  const selectedIndex = found === -1 ? 0 : found
  const current = faces[selectedIndex]
  const excluded = excludedIn(group)
  const assignable = assignableFaceIds(group)
  const suggestion = group.suggestion
  const nameValue = reviewNameDraft ?? (suggestion ? suggestion.personName : "")

  return html`
    <div class="face-review" tabindex="-1" data-group-key="${String(group.key)}">
      <div class="face-review-head">
        <button type="button" class="btn btn-secondary btn-sm face-review-back">
          ← All groups
        </button>
        <h3 id="faces-review-heading" class="face-review-pos">
          Group ${position + 1} of ${groups.length}
          <span class="text-muted">· ${group.size} face${group.size === 1 ? "" : "s"}</span>
        </h3>
        <div class="face-review-name">
          <input type="text" class="face-review-name-input" list="faces-people-roster"
            placeholder="${group.abstained ? "No confident match. Who is this?" : "Who is this?"}"
            value="${nameValue}" autocomplete="off"
            aria-label="Person name for this group" maxlength="200" />
          <button type="button" class="btn btn-primary btn-sm face-review-confirm"
            ${assignable.length === 0 ? "disabled" : ""}>
            Confirm all ${assignable.length}
          </button>
          <span class="face-review-input-error" role="alert" hidden></span>
          <button type="button" class="btn btn-secondary btn-sm face-review-create-person"
            hidden></button>
        </div>
      </div>

      <div class="face-review-main">
        <div class="face-review-stage">
          ${current ? faceChipImgMarkup(current.entry, REVIEW_STAGE_PAD) : ""}
        </div>
        <div class="face-review-side">
          <p class="face-review-facepos">
            <strong>Face ${selectedIndex + 1} of ${faces.length}</strong>
            ${current && current.setAside
              ? html`<span class="face-review-flag">set aside</span>`
              : ""}
            ${current && excluded.has(current.entry.faceId)
              ? html`<span class="face-review-flag">excluded</span>`
              : ""}
          </p>
          <div class="face-review-strip" role="group" aria-label="Every face in this group">
            ${faces.map((face, i) =>
              stripChipMarkup(face, i, faces.length, {
                selected: i === selectedIndex,
                excluded: excluded.has(face.entry.faceId),
              }),
            )}
          </div>
          ${reviewFaceActionsMarkup(group, current, excluded)}
        </div>
      </div>

      <div class="face-review-nav">
        <button type="button" class="btn btn-secondary btn-sm face-review-prev"
          ${position <= 0 ? "disabled" : ""}>◀ Previous group</button>
        <button type="button" class="btn btn-secondary btn-sm face-review-next"
          ${position >= groups.length - 1 ? "disabled" : ""}>Next group ▶</button>
        <span class="face-review-hint text-muted">
          <kbd>←</kbd><kbd>→</kbd> face · <kbd>[</kbd><kbd>]</kbd> group · <kbd>x</kbd> exclude ·
          <kbd>Esc</kbd> back
        </span>
      </div>
    </div>
  `
}

/** The controls that act on the SELECTED face, plus the one sentence that
 *  explains why "Confirm all" counts fewer faces than the group holds.
 *  @param {Types.FaceGroup} group
 *  @param {{ entry: Types.FaceChipEntry, setAside: boolean } | undefined} current
 *  @param {Set<number>} excluded */
function reviewFaceActionsMarkup(group, current, excluded) {
  if (!current) return ""
  const isExcluded = excluded.has(current.entry.faceId)
  return html`
    ${current.setAside
      ? html`<p class="face-review-note" role="note">
          This one was held back from the queue as too small or too soft to name off a list, so a
          bulk name skips it. “Name only this face” is the way in — it is the one place that can.
        </p>`
      : ""}
    <div class="face-review-face-actions">
      ${current.setAside
        ? ""
        : html`<button type="button" class="btn btn-secondary btn-sm face-review-exclude">
            ${isExcluded ? "↩ Put this one back" : "✕ Exclude this one"}
          </button>`}
      <button type="button" class="btn btn-secondary btn-sm face-review-name-one">
        Name only this face
      </button>
      ${openPhotoButtonMarkup(
        current.entry.mediaId,
        "Open the whole photograph this face is in",
      )}
      ${excluded.size > 0
        ? html`<button type="button" class="btn btn-secondary btn-sm face-review-notaface">
            Not a face (${excluded.size})
          </button>`
        : ""}
    </div>
    ${group.setAside > 0
      ? html`<p class="face-review-setaside text-muted">
          ${group.setAside} of these ${group.setAside === 1 ? "was" : "were"} set aside as too
          small or too soft to name from a list — dimmed above, and skipped by “Confirm all”.
          Select one and use “Name only this face”.
        </p>`
      : ""}
  `
}

/** One filmstrip chip: a real button, so click and keyboard both reach it and
 *  its state is announced. The label says which face and what state, never
 *  anything about the photograph.
 *  @param {{ entry: Types.FaceChipEntry, setAside: boolean }} face
 *  @param {number} index @param {number} total
 *  @param {{ selected: boolean, excluded: boolean }} state */
function stripChipMarkup(face, index, total, state) {
  const classes = ["face-strip-chip"]
  if (state.selected) classes.push("is-selected")
  if (face.setAside) classes.push("is-setaside")
  if (state.excluded) classes.push("is-excluded")
  const label =
    `Face ${index + 1} of ${total}` +
    (face.setAside ? ", set aside from the queue" : "") +
    (state.excluded ? ", excluded from the name" : "")
  return html`<button type="button" class="${classes.join(" ")}"
    data-face-id="${face.entry.faceId}" aria-pressed="${state.selected ? "true" : "false"}"
    aria-label="${label}">
    ${faceChipImgMarkup(face.entry, 1)}
  </button>`
}

// ---- review view: navigation + actions -----------------------------------

/** Focus the review container so the delegated keydown below sees the keys. A
 *  re-render replaces every element in here, so this runs after each one. */
function focusReview() {
  const el = document.querySelector(".face-review")
  if (el instanceof HTMLElement) el.focus()
}

/** Enter the review view on a group, selecting its first face. @param {string} key */
function openReview(key) {
  const group = overview?.groups.find((g) => String(g.key) === key)
  if (!group) return
  reviewGroupKey = key
  reviewNameDraft = null
  const faces = reviewFaces(group)
  reviewFaceId = faces.length > 0 ? faces[0].entry.faceId : null
  renderBody()
}

/** Back to the list, with focus on the row that was open — otherwise the admin
 *  lands at the top of the page and has to find their place again. */
function closeReview() {
  const key = reviewGroupKey
  reviewGroupKey = null
  reviewFaceId = null
  reviewNameDraft = null
  renderBody()
  const row = document.querySelector(`.face-overview-row[data-group-key="${key}"]`)
  if (row instanceof HTMLElement) row.focus()
}

/** @param {number} delta */
function stepGroup(delta) {
  const groups = orderedGroups()
  const position = groups.findIndex((g) => String(g.key) === reviewGroupKey)
  if (position === -1) return
  const next = groups[position + delta]
  if (!next) return
  openReview(String(next.key))
}

/** @param {number} delta */
function stepFace(delta) {
  const group = reviewGroup()
  if (!group) return
  const faces = reviewFaces(group)
  const index = faces.findIndex((f) => f.entry.faceId === reviewFaceId)
  const next = faces[(index === -1 ? 0 : index) + delta]
  if (!next) return
  reviewFaceId = next.entry.faceId
  renderBody()
}

/** @param {number} faceId */
function selectReviewFace(faceId) {
  reviewFaceId = faceId
  renderBody()
}

/** Exclude / re-include the selected face. Only ever called for a face that is
 *  bulk-nameable in the first place: a set-aside one is already outside every
 *  bulk action, so offering to exclude it would be a control with no effect —
 *  and "Not a face" over a set-aside id is refused by the same server check. */
function toggleReviewExclude() {
  const group = reviewGroup()
  if (!group || reviewFaceId === null) return
  if (!group.faceIds.includes(reviewFaceId)) return
  const key = String(group.key)
  let set = excludedByGroup.get(key)
  if (!set) {
    set = new Set()
    excludedByGroup.set(key, set)
  }
  if (set.has(reviewFaceId)) set.delete(reviewFaceId)
  else set.add(reviewFaceId)
  renderBody()
}

/** @returns {HTMLInputElement | null} */
function reviewNameInput() {
  const el = document.querySelector(".face-review-name-input")
  return el instanceof HTMLInputElement ? el : null
}

/** @param {string} msg */
function showReviewError(msg) {
  const el = document.querySelector(".face-review-input-error")
  if (!(el instanceof HTMLElement)) return
  el.textContent = msg
  el.hidden = false
}

function hideReviewError() {
  const el = document.querySelector(".face-review-input-error")
  if (el instanceof HTMLElement) el.hidden = true
  const createBtn = document.querySelector(".face-review-create-person")
  if (createBtn instanceof HTMLButtonElement) createBtn.hidden = true
}

/**
 * Resolve what is typed in the name field to one person, or reveal the explicit
 * create step. Shared by every naming action in this view so all of them refuse
 * an ambiguous name the same way, and none of them ever creates a person as a
 * side effect of typing.
 * @param {"one" | "all"} mode which action asked — carried on the create
 *   button so the explicit-create step resumes the right one afterwards
 * @param {string} verb what the create button will go on to do, for its label
 * @returns {{ name: string, personId: number } | null}
 */
function resolveReviewName(mode, verb) {
  const input = reviewNameInput()
  if (!input) return null
  const name = input.value.trim()
  if (!name) {
    showReviewError("Type a name first.")
    return null
  }
  const resolved = resolvePersonByName(name)
  if (resolved.status === "ambiguous") {
    showReviewError(
      "Multiple people share that name — rename one in the People section, then retry.",
    )
    return null
  }
  if (resolved.status === "none") {
    const createBtn = document.querySelector(".face-review-create-person")
    if (createBtn instanceof HTMLButtonElement) {
      createBtn.textContent = `Create person “${name}” & ${verb}`
      createBtn.dataset.mode = mode
      createBtn.hidden = false
      showReviewError("No person has that name yet. Create them?")
    }
    return null
  }
  return { name, personId: resolved.id }
}

/**
 * Reload the tab and put the review view back where it was, anchored on a face
 * rather than on a group key.
 *
 * Group keys are positions in a list the server recomputes, and naming a face
 * REMOVES it from the pool the clustering runs over — so after any mutation the
 * key that was on screen means something else. Anchoring on a face id that
 * survived the mutation finds whichever group now contains it, which is the
 * same people in front of the admin a moment ago. When nothing survived (the
 * usual case after "Confirm all"), it falls back to the overview list, which is
 * the honest answer: that group is done.
 * @param {number | null} anchorFaceId
 */
async function reloadAnchoredOnFace(anchorFaceId) {
  // Cleared first so the in-flight render inside loadFaceAssignment cannot draw
  // a stale group under a key that no longer means what it did.
  reviewGroupKey = null
  reviewFaceId = null
  reviewNameDraft = null
  await loadFaceAssignment()
  if (anchorFaceId === null || !overview) return
  const group = overview.groups.find((g) =>
    reviewFaces(g).some((f) => f.entry.faceId === anchorFaceId),
  )
  if (!group) return
  reviewGroupKey = String(group.key)
  reviewFaceId = anchorFaceId
  renderBody()
}

/** A face in the current group that will still exist after `faceId` is named or
 *  dismissed — the next one along, else the previous. Null when it was the last.
 *  @param {Types.FaceGroup} group @param {number} faceId */
function anchorAfter(group, faceId) {
  const faces = reviewFaces(group)
  const index = faces.findIndex((f) => f.entry.faceId === faceId)
  if (index === -1) return null
  const next = faces[index + 1] ?? faces[index - 1]
  return next ? next.entry.faceId : null
}

/** POST the bulk assignment and go back to the list. @param {number[]} faceIds
 *  @param {number} personId @param {string} name */
async function assignFacesToPerson(faceIds, personId, name) {
  const res = /** @type {Types.FaceAssignResponse} */ (
    await api("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds, personId }),
    })
  )
  const n = res.changed ?? faceIds.length
  showSuccess(`Assigned ${n} face${n === 1 ? "" : "s"} to ${name}`)
  // No anchor: every face that was on screen as nameable has just been named,
  // so there is nothing left in this group to come back to.
  await reloadAnchoredOnFace(null)
}

/** "Confirm all N" — the bulk path, over the shown, non-excluded faces only. */
async function handleReviewConfirmAll() {
  const group = reviewGroup()
  if (!group) return
  const faceIds = assignableFaceIds(group)
  if (faceIds.length === 0) {
    showReviewError("Every face here is excluded or set aside — nothing left to name in bulk.")
    return
  }
  const resolved = resolveReviewName("all", `name all ${faceIds.length}`)
  if (!resolved) return
  try {
    await assignFacesToPerson(faceIds, resolved.personId, resolved.name)
  } catch (err) {
    showReviewError(getErrorMessage(err))
  }
}

/**
 * "Name only this face" — POST /api/admin/faces/assign-one.
 *
 * The single-face route, and the ONLY one that will take a set-aside face. It
 * is offered for every face rather than only the held-back ones because the
 * distinction is the server's business, not something the admin should have to
 * hold in their head: "name this one" means the same thing whichever face is on
 * screen, and the request is identical.
 */
async function handleReviewNameOne() {
  const group = reviewGroup()
  if (!group || reviewFaceId === null) return
  const faceId = reviewFaceId
  if (pending.has(faceId)) return
  const resolved = resolveReviewName("one", "name this one")
  if (!resolved) return
  pending.add(faceId)
  try {
    await api("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId, personId: resolved.personId }),
    })
    showSuccess(`Named ${resolved.name}`)
    await reloadAnchoredOnFace(anchorAfter(group, faceId))
  } catch (err) {
    showReviewError(getErrorMessage(err))
  } finally {
    pending.delete(faceId)
  }
}

/** The explicit-create step: create the person, then do whatever the action that
 *  revealed it was going to do. @param {HTMLButtonElement} btn */
async function handleReviewCreatePerson(btn) {
  const input = reviewNameInput()
  if (!input) return
  const name = input.value.trim()
  if (!name) return
  const single = btn.dataset.mode === "one"

  btn.disabled = true
  try {
    await api("/api/admin/people", {
      method: "POST",
      body: JSON.stringify({ displayName: name }),
    })
    // Refreshed BEFORE the assignment so the new person resolves by name the
    // same way an existing one does — one code path, not two.
    await refreshPeople()
    btn.hidden = true
    hideReviewError()
    if (single) await handleReviewNameOne()
    else await handleReviewConfirmAll()
  } catch (err) {
    btn.disabled = false
    // A 409 here means someone with this name appeared since the list loaded —
    // the message names them, and a reload refreshes the autocomplete.
    showReviewError(getErrorMessage(err))
  }
}

/** "Not a face (N)" over the excluded set. Excluded ids are always bulk-shown
 *  faces (toggleReviewExclude refuses the rest), so this never carries a
 *  set-aside id into a bulk endpoint that would refuse it. */
async function handleReviewNotAFace() {
  const group = reviewGroup()
  if (!group) return
  const excluded = excludedIn(group)
  if (excluded.size === 0) return
  const faceIds = [...excluded]
  const anchor = reviewFaces(group).find((f) => !excluded.has(f.entry.faceId))
  try {
    await api("/api/admin/faces/not-a-face", {
      method: "POST",
      body: JSON.stringify({ faceIds }),
    })
    showSuccess(`Marked ${faceIds.length} face${faceIds.length === 1 ? "" : "s"} as not a face`)
    await reloadAnchoredOnFace(anchor ? anchor.entry.faceId : null)
  } catch (err) {
    showReviewError(getErrorMessage(err))
  }
}

/** @param {Element} target @returns {boolean} handled */
function handleReviewClick(target) {
  if (target.closest(".face-review-back")) {
    closeReview()
    return true
  }
  if (target.closest(".face-review-prev")) {
    stepGroup(-1)
    return true
  }
  if (target.closest(".face-review-next")) {
    stepGroup(1)
    return true
  }
  const chip = target.closest(".face-strip-chip")
  if (chip instanceof HTMLElement) {
    const faceId = parseInt(chip.dataset.faceId || "", 10)
    if (!Number.isNaN(faceId)) selectReviewFace(faceId)
    return true
  }
  if (target.closest(".face-review-exclude")) {
    toggleReviewExclude()
    return true
  }
  if (target.closest(".face-review-confirm")) {
    void handleReviewConfirmAll()
    return true
  }
  if (target.closest(".face-review-name-one")) {
    void handleReviewNameOne()
    return true
  }
  const createBtn = target.closest(".face-review-create-person")
  if (createBtn instanceof HTMLButtonElement) {
    void handleReviewCreatePerson(createBtn)
    return true
  }
  if (target.closest(".face-review-notaface")) {
    void handleReviewNotAFace()
    return true
  }
  return false
}

/** @param {KeyboardEvent} e @returns {boolean} handled */
function handleReviewKeydown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  const target = e.target
  // While a field has focus the only key this view claims is Enter — every
  // other shortcut here is a letter or a bracket somebody may be typing.
  if (target instanceof HTMLInputElement) {
    if (e.key === "Enter") {
      e.preventDefault()
      void handleReviewConfirmAll()
      return true
    }
    return false
  }
  if (target instanceof HTMLSelectElement) return false

  if (e.key === "ArrowRight") stepFace(1)
  else if (e.key === "ArrowLeft") stepFace(-1)
  else if (e.key === "]") stepGroup(1)
  else if (e.key === "[") stepGroup(-1)
  else if (e.key === "x" || e.key === "X") toggleReviewExclude()
  else if (e.key === "Escape") closeReview()
  else return false
  e.preventDefault()
  return true
}

/**
 * "Open photo" for a card/row that holds face chips. The per-photograph view is
 * the ONLY place a `set_aside` face can be named, so every list section here
 * needs a labelled, keyboard-reachable way into it — a hover affordance or a
 * bare chip click would leave the escape hatch undiscoverable, which is the
 * state this whole view exists to fix.
 * @param {number | null | undefined} mediaId
 * @param {string} label the accessible name — say WHICH photograph, since a
 *   group spans several and the button can only open one.
 */
function openPhotoButtonMarkup(mediaId, label) {
  if (mediaId === null || mediaId === undefined) return ""
  return html`<button type="button" class="btn btn-secondary btn-sm faces-open-photo"
    data-media-id="${mediaId}" aria-label="${label}"
    title="Shows every face in that photograph — including any set aside from the queue">
    Open photo
  </button>`
}

/**
 * Resolve a typed name to exactly one person, via `nameKey` — the same fold the
 * server uses to refuse a duplicate create (no regex, string methods only).
 * @param {string} name
 * @returns {{ status: "ok", id: number } | { status: "ambiguous" } | { status: "none" }}
 */
function resolvePersonByName(name) {
  const key = nameKey(name)
  const matches = peopleData.filter((p) => nameKey(p.displayName) === key)
  if (matches.length === 1) return { status: "ok", id: matches[0].id }
  if (matches.length > 1) return { status: "ambiguous" }
  return { status: "none" }
}

// ---- Ask queue --------------------------------------------------------

/** How many ask rows render at a time. The server already caps its response,
 *  but that cap is in the hundreds and it is a limit on the PAYLOAD, not on
 *  what belongs on a screen — rendering all of them made this section the
 *  tallest thing on the page the moment the groups above stopped being. The
 *  queue is ordered by impact and abandonable at any point, so the rows past
 *  the first screenful are the ones that matter least. */
const ASK_PAGE = 15

/** Grows with "Show more", and deliberately NOT reset by a reload: every
 *  confirm reloads the whole tab, and resetting here would drop the admin back
 *  to the top of the queue after each one. */
let askShown = ASK_PAGE

function queueMarkup() {
  if (!queueData || !overview) return ""
  const items = queueData.items
  if (items.length === 0) {
    const msg =
      overview.counts.identified === 0
        ? "The ask queue fills in once a group above has been named — matching needs at least one confirmed face per person to compare against."
        : "Nothing waiting on you right now."
    return html`<p class="faces-empty text-muted">${msg}</p>`
  }
  const visible = items.slice(0, askShown)
  const remaining = items.length - visible.length
  return html`
    <ul class="faces-ask-list">
      ${visible.map(askRowMarkup)}
    </ul>
    ${remaining > 0
      ? html`<button type="button" class="btn btn-secondary btn-sm faces-ask-more">
          Show ${Math.min(remaining, ASK_PAGE)} more (${remaining} waiting)
        </button>`
      : ""}
    ${queueData.truncated
      ? html`<p class="faces-queue-truncated">
          Showing the highest-impact faces first — more will appear as you go.
        </p>`
      : ""}
  `
}

/** @param {Types.FaceQueueItem} item */
function askRowMarkup(item) {
  const dismissed = dismissedAsk.has(item.faceId)
  return html`
    <li class="face-ask-row ${dismissed ? "is-dismissed" : ""}" data-face-id="${item.faceId}"
      tabindex="0">
      ${renderFaceChip(item, { dimmed: false })}
      <div class="face-ask-main">
        <div class="face-ask-candidates">
          ${item.candidates.map(
            (c, i) => html`
              <button type="button" class="btn btn-secondary btn-sm face-ask-candidate"
                data-index="${i}">
                <kbd>${i + 1}</kbd> ${c.personName} · margin ${formatMargin(c.margin)}
              </button>
            `,
          )}
          ${item.candidates.length === 0
            ? html`<span class="text-muted">No candidates yet</span>`
            : ""}
        </div>
        <div class="face-ask-actions">
          <span class="face-ask-unlocks text-muted"
            title="Confirming this would identify this many photo appearances"
            >unlocks ${item.unlocks}</span
          >
          ${openPhotoButtonMarkup(item.mediaId, "Open the photograph this face is in")}
          <button type="button" class="btn btn-secondary btn-sm face-ask-skip">
            <kbd>s</kbd> Skip
          </button>
          <button type="button" class="btn btn-secondary btn-sm face-ask-none">
            None of these
          </button>
          <button type="button" class="btn btn-danger btn-sm face-ask-notaface">
            <kbd>x</kbd> Not a face
          </button>
        </div>
      </div>
    </li>
  `
}

/** The faceId of the row after `faceId` in the CURRENT (pre-reload) queue
 *  order — captured before a mutation so focus can return to roughly the same
 *  spot once the list is refetched and re-rendered. @param {number} faceId */
function nextAskFaceId(faceId) {
  if (!queueData) return null
  const idx = queueData.items.findIndex((i) => i.faceId === faceId)
  if (idx === -1) return null
  const next = queueData.items[idx + 1]
  return next ? next.faceId : null
}

/** @param {number | null} faceId */
function focusAskRow(faceId) {
  if (faceId === null) return
  const rows = document.querySelectorAll(".face-ask-row")
  for (const row of rows) {
    if (row instanceof HTMLElement && row.dataset.faceId === String(faceId)) {
      row.focus()
      return
    }
  }
}

/** @param {number} faceId @param {number} delta */
function focusAdjacentAskRow(faceId, delta) {
  const rows = Array.from(document.querySelectorAll(".face-ask-row"))
  const idx = rows.findIndex(
    (r) => r instanceof HTMLElement && r.dataset.faceId === String(faceId),
  )
  if (idx === -1) return
  const next = rows[idx + delta]
  if (next instanceof HTMLElement) next.focus()
}

/** @param {number} faceId @param {number} candidateIndex */
async function confirmAskCandidate(faceId, candidateIndex) {
  const item = queueData?.items.find((i) => i.faceId === faceId)
  if (!item) return
  const candidate = item.candidates[candidateIndex]
  if (!candidate) return
  // personId is null when the prototype's person row vanished between the
  // queue being built and this click — there is nothing to assign to.
  if (candidate.personId === null) return
  if (pending.has(faceId)) return
  pending.add(faceId)
  const nextFocusId = nextAskFaceId(faceId)
  try {
    await api("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [faceId], personId: candidate.personId }),
    })
    showSuccess(`Assigned to ${candidate.personName}`)
    await loadFaceAssignment()
    focusAskRow(nextFocusId)
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    pending.delete(faceId)
  }
}

/** @param {number} faceId */
async function handleAskNotAFace(faceId) {
  if (pending.has(faceId)) return
  pending.add(faceId)
  const nextFocusId = nextAskFaceId(faceId)
  try {
    await api("/api/admin/faces/not-a-face", {
      method: "POST",
      body: JSON.stringify({ faceIds: [faceId] }),
    })
    showSuccess("Marked as not a face")
    await loadFaceAssignment()
    focusAskRow(nextFocusId)
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    pending.delete(faceId)
  }
}

/** @param {HTMLElement} row @param {Element} target */
function handleAskRowClick(row, target) {
  const faceId = parseInt(row.dataset.faceId || "", 10)
  if (Number.isNaN(faceId)) return

  const candidateBtn = target.closest(".face-ask-candidate")
  if (candidateBtn instanceof HTMLElement) {
    const idx = parseInt(candidateBtn.dataset.index || "", 10)
    if (!Number.isNaN(idx)) void confirmAskCandidate(faceId, idx)
    return
  }
  if (target.closest(".face-ask-skip")) {
    focusAdjacentAskRow(faceId, 1)
    return
  }
  if (target.closest(".face-ask-none")) {
    dismissedAsk.add(faceId)
    row.classList.add("is-dismissed")
    focusAdjacentAskRow(faceId, 1)
    return
  }
  if (target.closest(".face-ask-notaface")) {
    void handleAskNotAFace(faceId)
  }
}

// ---- Same-moment (must-link propagation) -------------------------------

/**
 * Proposals to carry a confirmed identity onto the same person in a
 * near-duplicate frame. Hidden entirely when there are none, so it costs
 * nothing on a library with no bursts.
 *
 * Deliberately a SEPARATE section from the ask queue, and deliberately opt-in
 * per row: these are the system's own inferences rather than a human's, and
 * they are the only place in this tab where the evidence is geometric rather
 * than a name someone typed. Rolling them into the queue would hide that
 * distinction behind an identical-looking confirm.
 */
function propagationsMarkup() {
  const items = propagationData ? propagationData.items : []
  if (items.length === 0) return ""
  return html`
    <section class="faces-section" aria-labelledby="faces-propagations-heading">
      <h3 id="faces-propagations-heading">Same moment</h3>
      <p class="text-muted faces-propagation-note">
        These photographs are near-duplicates of one already-named face, and both the box and the
        descriptor agree. Confirming records the name as <em>propagated</em> — it will never be used
        to recognise anyone else.
      </p>
      <ul class="faces-propagation-list">
        ${items.map(propagationRowMarkup)}
      </ul>
      <button type="button" class="btn btn-secondary btn-sm faces-propagate-all">
        Accept all ${items.length}
      </button>
    </section>
  `
}

/** @param {Types.FacePropagation} item */
function propagationRowMarkup(item) {
  return html`
    <li class="face-propagation-row" data-face-id="${item.toFaceId}">
      ${item.from ? renderFaceChip(item.from, { dimmed: true }) : ""}
      ${renderFaceChip(item, { dimmed: false })}
      <div class="face-propagation-main">
        <span class="face-propagation-name">${item.personName || "Unknown person"}</span>
        <span class="text-muted"
          >overlap ${item.iou.toFixed(2)} · distance ${item.distance.toFixed(2)}</span
        >
      </div>
      <div class="face-propagation-actions">
        ${openPhotoButtonMarkup(item.mediaId, "Open the photograph this face is in")}
        <button type="button" class="btn btn-secondary btn-sm face-propagation-accept">
          Yes, same person
        </button>
        <button type="button" class="btn btn-secondary btn-sm face-propagation-dismiss">
          Not now
        </button>
      </div>
    </li>
  `
}

/** @param {number[]} toFaceIds */
async function applyPropagations(toFaceIds) {
  const ids = toFaceIds.filter((id) => !pending.has(id))
  if (ids.length === 0) return
  for (const id of ids) pending.add(id)
  try {
    await api("/api/admin/faces/propagate", {
      method: "POST",
      body: JSON.stringify({ toFaceIds: ids }),
    })
    showSuccess(ids.length === 1 ? "Name carried across" : `Name carried across ${ids.length} faces`)
    await loadFaceAssignment()
  } catch (err) {
    showError(getErrorMessage(err))
  } finally {
    for (const id of ids) pending.delete(id)
  }
}

/** @param {HTMLElement} row @param {Element} target */
function handlePropagationRowClick(row, target) {
  const faceId = parseInt(row.dataset.faceId || "", 10)
  if (Number.isNaN(faceId)) return
  if (target.closest(".face-propagation-accept")) {
    void applyPropagations([faceId])
    return
  }
  if (target.closest(".face-propagation-dismiss")) {
    // Visual-only, like the ask queue's "None of these": there is no
    // "reviewed, declined" state to record, and inventing one would mean a
    // second kind of durable judgement nothing else in the pipeline reads.
    row.remove()
  }
}

// ---- Identified (minimal — see file header re: no per-person breakdown) ---

function identifiedMarkup() {
  if (!overview) return ""
  const n = overview.counts.identified
  if (n === 0) return html`<p class="faces-empty text-muted">No faces identified yet.</p>`
  // The contract has no per-guest breakdown (only an aggregate face count), so
  // this stays a single collapsed line rather than a per-person list — the
  // "expandable later" the spec asks for needs an endpoint that doesn't exist
  // yet.
  return html`<p class="faces-identified-summary">
    ${n} face${n === 1 ? "" : "s"} identified so far.
  </p>`
}

// ---- People (the photographed cast) ---------------------------------------

/**
 * The roster of people faces get assigned to. A person is who a face belongs
 * to; a guest is an INVITATION — one row per party — and much of the cast
 * (partners recorded under someone else's row, children, the photographer,
 * vendors) is not on it at all. `guestId` is the optional link back.
 *
 * A list, like every other section here: no wizard, no modal. Each row does its
 * own rename / link / merge / delete against a single person, and every action
 * is an immediate request.
 *
 * There is no "create" control in this section on purpose. A person is created
 * from a group's name input, where the admin is already looking at the faces
 * they mean — creating one from a bare list is how you end up with two rows for
 * the same human and no way to tell which is which.
 */
function peopleMarkup() {
  if (!peopleLoaded) {
    return html`<p class="faces-empty text-muted">Loading people…</p>`
  }
  if (peopleData.length === 0) {
    return html`<p class="faces-empty text-muted">
      No people yet. Name a group above and the person is created there.
    </p>`
  }
  return html`
    <ul class="faces-people-list">
      ${peopleData.map(personRowMarkup)}
    </ul>
    ${guestsLoaded
      ? ""
      : html`<p class="text-muted faces-people-note">
          Guest roster unavailable — linking a person to an invitation is disabled until the next
          refresh.
        </p>`}
  `
}

/** @param {Types.PersonEntry} person */
function personRowMarkup(person) {
  const others = peopleData.filter((p) => p.id !== person.id)
  // person_id is NOT NULL on face_identities, so a person with live identities
  // cannot be soft-deleted — say why up front rather than letting the button
  // fail with a 409 the admin has to interpret.
  const undeletable = person.identities > 0
  return html`
    <li class="faces-person-row" data-person-id="${person.id}">
      <div class="faces-person-main">
        <input type="text" class="person-name-input" value="${person.displayName}"
          aria-label="Name" data-person-id="${person.id}" maxlength="200" />
        <span class="text-muted faces-person-counts">
          ${person.faces} face${person.faces === 1 ? "" : "s"} ·
          ${person.identities} identit${person.identities === 1 ? "y" : "ies"}
        </span>
      </div>
      <div class="faces-person-link">
        ${person.guestId === null
          ? html`<input type="text" class="person-guest-input" list="faces-guest-roster"
              placeholder="Link an invitation…" aria-label="Link this person to a guest"
              maxlength="200" ${guestsLoaded ? "" : "disabled"} />`
          : html`<span class="faces-person-guest"
                >invitation: ${person.guestName ?? "(deleted guest)"}</span
              >
              <button type="button" class="btn btn-secondary btn-sm person-unlink">
                Unlink
              </button>`}
      </div>
      <div class="faces-person-actions">
        ${others.length > 0
          ? html`<select class="person-merge-select" aria-label="Merge this person into">
                <option value="">Merge into…</option>
                ${others.map((o) => html`<option value="${o.id}">${o.displayName}</option>`)}
              </select>
              <button type="button" class="btn btn-secondary btn-sm person-merge" disabled>
                Merge
              </button>`
          : ""}
        <button type="button" class="btn btn-secondary btn-sm person-delete"
          ${undeletable ? "disabled" : ""}
          title="${undeletable
            ? "Reassign or merge this person's faces before deleting them."
            : "Delete this person"}">
          Delete
        </button>
      </div>
      <span class="faces-person-error" role="alert" hidden></span>
    </li>
  `
}

// ---- Recent bulk passes: the undo -----------------------------------------

/**
 * The undo affordance, and it is small on purpose.
 *
 * Every bulk mutation in this tab — naming a group, clearing one, dismissing
 * one as not-a-face, applying a propagation pass — is recorded as one BATCH,
 * and each of those responses already carried a `batchId` that nothing on this
 * page ever used. So the ledger was revocable and the product was not: the only
 * way to spend a batch id was to import `revokeBatch` into a test process.
 *
 * This is a list of bulk passes with a Revoke button, not a history browser.
 * The case it is for is "that group was two people and I just named all thirty
 * faces" — which is minutes old, so newest-first and a short ceiling is the
 * whole ordering story. It is collapsed by default and fetched only when
 * opened: an admin who never makes a mistake never pays for the query.
 *
 * THE COPY IS THE FEATURE. Revoking does not delete anything and does not
 * clobber later work, and an admin who believes otherwise will not touch it —
 * so both facts are stated in the panel and again in the confirm dialog, and
 * the button is not styled as destructive, because it is not.
 */
function batchesPanelMarkup() {
  return html`
    <section class="faces-section faces-batches" aria-labelledby="faces-batches-heading">
      <h3 id="faces-batches-heading">
        <button type="button" class="faces-batches-toggle"
          aria-expanded="${batchesOpen ? "true" : "false"}" aria-controls="faces-batches-body">
          Recent bulk passes
        </button>
      </h3>
      <div id="faces-batches-body" ${batchesOpen ? "" : "hidden"}>
        <p class="faces-batches-note text-muted">
          Every bulk action here — naming a group, clearing one, dismissing one, applying a
          propagation pass — is one revocable pass. Revoking a pass stops its decisions counting
          and re-derives the faces it touched. Nothing is deleted: the decisions stay on record,
          and any face you have since corrected by hand keeps your correction. Reinstating a pass
          means running it again.
        </p>
        ${batchesBodyMarkup()}
      </div>
    </section>
  `
}

function batchesBodyMarkup() {
  const problem =
    batchesError === null
      ? ""
      : html`<p class="faces-batches-error" role="alert">
          ${batchesError}
          <button type="button" class="btn btn-secondary btn-sm faces-batches-retry">
            Try again
          </button>
        </p>`
  if (!batchesData) {
    return html`${problem}${batchesError === null
      ? html`<p class="faces-empty text-muted">Loading…</p>`
      : ""}`
  }
  if (batchesData.batches.length === 0) {
    return html`${problem}<p class="faces-empty text-muted">
      No bulk passes yet. One is recorded the first time you name a whole group at once.
    </p>`
  }
  return html`${problem}
    <ul class="faces-batches-list">
      ${batchesData.batches.map(batchRowMarkup)}
    </ul>`
}

/** What each `face_assignment_batches.kind` was, in the words of the button
 *  that made it. The raw enum value is a schema detail and says nothing to the
 *  person who clicked "Name everyone in this group".
 *  @param {string} kind */
function batchKindLabel(kind) {
  if (kind === "propagate") return "Same-moment propagation"
  if (kind === "manual") return "Bulk change"
  if (kind === "label-import") return "Imported naming work"
  if (kind === "merge-repair") return "Merge repair"
  return kind
}

/**
 * A ledger timestamp, local and readable.
 *
 * Two formats reach here and only one of them says which zone it is in:
 * `created_at` defaults to SQLite's CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS",
 * UTC, unmarked), while `revoked_at` is written by db/utils.js's `now()` and is
 * a proper ISO string. Parsing the first as-is makes the browser read it as
 * LOCAL time and a pass made an hour ago claims to be from the future, so the
 * unmarked form is completed into UTC before parsing. String methods only.
 * @param {string | null} value
 */
function ledgerTime(value) {
  if (!value) return ""
  const iso = value.includes("T") ? value : value.split(" ").join("T") + "Z"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * One pass.
 *
 * `faces` rather than `events` is what the row leads with: an admin thinks in
 * faces, and the two differ only when a pass touched one face twice. The batch
 * id is shown small and in full because it is what the CLI's `revoke --batch`
 * takes, and this list is the only place outside a database client to read it.
 * @param {Types.FaceBatchEntry} batch
 */
function batchRowMarkup(batch) {
  const revoked = batch.revokedAt !== null
  return html`
    <li class="faces-batch-row ${revoked ? "is-revoked" : ""}" data-batch-id="${batch.batchId}">
      <div class="faces-batch-main">
        <p class="faces-batch-summary">
          <strong>${batchKindLabel(batch.kind)}</strong> ·
          ${batch.faces} face${batch.faces === 1 ? "" : "s"} ·
          ${ledgerTime(batch.createdAt)}
        </p>
        ${batch.note ? html`<p class="faces-batch-note text-muted">${batch.note}</p>` : ""}
        <p class="faces-batch-id text-muted">
          ${batch.batchId}
          ${revoked
            ? html` · revoked ${ledgerTime(batch.revokedAt)} by ${batch.revokedBy ?? "unattributed"}`
            : ""}
        </p>
      </div>
      ${revoked
        ? html`<span class="faces-batch-state text-muted">Revoked</span>`
        : html`<button type="button" class="btn btn-secondary btn-sm faces-batch-revoke">
            Revoke
          </button>`}
    </li>
  `
}

/** Load the list, replacing whatever was held. Non-fatal like the set-aside
 *  panel: the rest of the tab renders regardless and the panel offers a retry. */
async function refreshBatches() {
  try {
    batchesData = /** @type {Types.FacesBatchesResponse} */ (
      await api("/api/admin/faces/batches")
    )
    batchesError = null
  } catch (err) {
    console.error("Failed to load the batch history:", err)
    batchesError = "Couldn't load the recent bulk passes."
  }
}

/** Open or close the panel, lazily loading on first open. Focus is put back on
 *  the toggle because renderBody replaces the element that was clicked. */
async function toggleBatches() {
  batchesOpen = !batchesOpen
  renderBody()
  if (batchesOpen && batchesData === null) {
    await refreshBatches()
    renderBody()
  }
  focusBatchesToggle()
}

function focusBatchesToggle() {
  const toggle = document.querySelector(".faces-batches-toggle")
  if (toggle instanceof HTMLElement) toggle.focus()
}

/**
 * Confirm, then revoke.
 *
 * The confirm dialog is the shared destructive-action one, deliberately NOT in
 * its danger styling: this action destroys nothing, and dressing it in red
 * would teach the admin to avoid the one control that gets them out of a bad
 * bulk pass. What the copy has to carry instead is the property most likely to
 * be misunderstood — a later hand correction survives the revocation — because
 * an admin who assumes otherwise will re-do work that was never lost.
 * @param {string} batchId
 */
function handleRevokeBatch(batchId) {
  const batch = batchesData?.batches.find((b) => b.batchId === batchId)
  if (!batch) return
  const faces = `${batch.faces} face${batch.faces === 1 ? "" : "s"}`
  openConfirm({
    title: `Revoke this ${batchKindLabel(batch.kind).toLowerCase()}?`,
    desc:
      `The decisions this pass made about ${faces} stop counting, and those faces go back to ` +
      `whatever they were before it. Nothing is deleted — the decisions stay on record — and ` +
      `any of those faces you have corrected by hand since the pass keeps your correction. ` +
      `Reinstating the pass means running it again.`,
    confirmLabel: "Revoke pass",
    danger: false,
    run: async () => {
      const result = /** @type {Types.FaceRevokeResponse} */ (
        await api("/api/admin/faces/revoke", {
          method: "POST",
          body: JSON.stringify({ batchId }),
        })
      )
      showSuccess(
        result.alreadyRevoked
          ? "That pass was already revoked — the faces it touched were re-derived again."
          : `Pass revoked. ${result.reprojected} face${result.reprojected === 1 ? "" : "s"} re-derived.`,
      )
      // The whole tab, not just this list: revoking changes which faces are
      // identified, so the groups, the queue and the counts above are all
      // stale. The panel is open, so the reload refetches this list too — with
      // the revoked row now showing who revoked it and when.
      await loadFaceAssignment()
    },
  })
}

/** @param {number} personId */
function findPersonRow(personId) {
  const row = getElement("faces-body").querySelector(
    `.faces-person-row[data-person-id="${personId}"]`,
  )
  return row instanceof HTMLElement ? row : null
}

/** @param {number} personId @param {string} msg */
function showPersonError(personId, msg) {
  const err = findPersonRow(personId)?.querySelector(".faces-person-error")
  if (!(err instanceof HTMLElement)) return
  err.textContent = msg
  err.hidden = false
}

/** @param {number} personId */
function hidePersonError(personId) {
  const err = findPersonRow(personId)?.querySelector(".faces-person-error")
  if (err instanceof HTMLElement) err.hidden = true
}

/**
 * Run a people mutation, then reload the whole tab. A reload rather than a
 * local patch because every one of these changes the group suggestions and the
 * identified counts too — a merge especially.
 * @param {number} personId
 * @param {() => Promise<string>} mutate resolves to the success message
 */
async function runPersonAction(personId, mutate) {
  if (pendingPeople.has(personId)) return
  pendingPeople.add(personId)
  hidePersonError(personId)
  try {
    showSuccess(await mutate())
    await loadFaceAssignment()
  } catch (err) {
    showPersonError(personId, getErrorMessage(err))
  } finally {
    pendingPeople.delete(personId)
  }
}

/** @param {HTMLInputElement} input */
function handlePersonRename(input) {
  const personId = Number(input.dataset.personId)
  const person = peopleData.find((p) => p.id === personId)
  if (!person) return
  const name = input.value.trim()
  if (!name) {
    showPersonError(personId, "A person needs a name.")
    return
  }
  if (name === person.displayName) return

  void runPersonAction(personId, async () => {
    await api(`/api/admin/people/${personId}`, {
      method: "PATCH",
      body: JSON.stringify({ displayName: name }),
    })
    return `Renamed to ${name}`
  })
}

/** Link a person to a roster guest, resolved from the typed name exactly the
 *  way a group's name input resolves a person. @param {HTMLInputElement} input */
function handlePersonLinkGuest(input) {
  const row = input.closest(".faces-person-row")
  if (!(row instanceof HTMLElement)) return
  const personId = Number(row.dataset.personId)
  const name = input.value.trim()
  if (!name) return

  const key = nameKey(name)
  const matches = guestOptions.filter((g) => nameKey(g.name) === key)
  if (matches.length === 0) {
    showPersonError(personId, "No invitation by that name — pick one from the list.")
    return
  }
  if (matches.length > 1) {
    showPersonError(personId, "More than one invitation has that name; link it in the Guests tab.")
    return
  }

  void runPersonAction(personId, async () => {
    await api(`/api/admin/people/${personId}`, {
      method: "PATCH",
      body: JSON.stringify({ guestId: matches[0].id }),
    })
    return `Linked to ${name}'s invitation`
  })
}

/** @param {number} personId */
function handlePersonUnlink(personId) {
  void runPersonAction(personId, async () => {
    await api(`/api/admin/people/${personId}`, {
      method: "PATCH",
      body: JSON.stringify({ guestId: null }),
    })
    return "Invitation unlinked"
  })
}

/** @param {number} personId @param {HTMLElement} row */
function handlePersonMerge(personId, row) {
  const select = row.querySelector(".person-merge-select")
  if (!(select instanceof HTMLSelectElement) || !select.value) return
  const intoId = Number(select.value)
  const from = peopleData.find((p) => p.id === personId)
  const into = peopleData.find((p) => p.id === intoId)
  if (!from || !into) return

  // Merging is not reversible from this UI — the source person is soft-deleted
  // and their identities re-pointed — so it is the one action here that asks.
  if (
    !window.confirm(
      `Merge “${from.displayName}” (${from.faces} face${from.faces === 1 ? "" : "s"}) ` +
        `into “${into.displayName}”? This cannot be undone from here.`,
    )
  ) {
    return
  }

  void runPersonAction(personId, async () => {
    const res = /** @type {Types.PersonMergeResponse} */ (
      await api("/api/admin/people/merge", {
        method: "POST",
        body: JSON.stringify({ fromPersonId: personId, intoPersonId: intoId }),
      })
    )
    const moved = res.movedFaces + res.movedIdentities
    return (
      `Merged into ${into.displayName} (${moved} row${moved === 1 ? "" : "s"} re-pointed)` +
      (res.carriedGuestLink ? ", invitation link carried over" : "")
    )
  })
}

/** @param {number} personId */
function handlePersonDelete(personId) {
  const person = peopleData.find((p) => p.id === personId)
  if (!person) return
  if (!window.confirm(`Delete “${person.displayName}”?`)) return

  void runPersonAction(personId, async () => {
    await api(`/api/admin/people/${personId}`, { method: "DELETE" })
    return `Deleted ${person.displayName}`
  })
}

/** @param {HTMLElement} row @param {Element} target */
function handlePersonRowClick(row, target) {
  const personId = Number(row.dataset.personId)
  if (Number.isNaN(personId)) return

  if (target.closest(".person-unlink")) {
    handlePersonUnlink(personId)
    return
  }
  if (target.closest(".person-merge")) {
    handlePersonMerge(personId, row)
    return
  }
  if (target.closest(".person-delete")) {
    handlePersonDelete(personId)
  }
}

// ---- face chip (shared render path for Groups + Ask queue) ----------------

/**
 * One face, cropped down from the media's `display` variant to just the face's
 * box. The box is in the ORIGINAL photo's pixel coordinates, so the crop is
 * computed client-side once the image has loaded and its natural size is known
 * (see positionFaceChipImage) — there is no dedicated crop endpoint, and there
 * cannot be one: re-encoding a crop server-side would need an image library on
 * the request path, which this project does not have and will not take.
 *
 * **Why `display` and not `thumb`.** A chip is a magnified sliver of whatever
 * copy it loads, so the copy's resolution is the ONLY thing that decides how
 * sharp a face looks. `thumb` is 400px on the long edge and a chip is 96px, so
 * any face occupying less than a quarter of the frame arrives already smaller
 * than the chip and is upscaled to fill it — and a face is usually a small
 * fraction of a frame. That upscale is what made chips read as a camera or
 * detector problem rather than as a choice made here. `display` is 1600px on
 * the long edge, which moves the same faces to roughly chip size.
 *
 * (The arithmetic above is a property of the two variant sizes and the chip,
 * not of anyone's photographs. What fraction of a frame a face actually
 * occupies here is a measurement of identifiable people — derive it locally if
 * you need it, and leave it there. CLAUDE.md's fourth photograph rule.)
 *
 * The cost is real but small and admin-only: a bigger file per photograph,
 * fetched lazily, and shared by every face in the same photograph because the
 * browser caches by URL. `original` is not an option — it is served with
 * `Content-Disposition: attachment` (core/media-serve.js) precisely so it is
 * never rendered inline, and the review view's `REVIEW_STAGE_PAD` is what buys
 * back the resolution that would otherwise argue for it.
 *
 * THE `<img>` IS SHARED by all three sizes this tab draws — the list chips, the
 * review filmstrip and the review stage. Only the container differs, and
 * positionFaceChipImage reads its size off the container rather than a
 * constant, so a fourth size needs CSS and nothing else.
 * @param {Types.FaceChipEntry} entry
 * @param {number} pad crop the box widened by this factor about its centre
 */
function faceChipImgMarkup(entry, pad) {
  // Both can be absent if the media row vanished between the queries that
  // built this payload. Same degradation as a missing width/height: the chip
  // renders without a crop rather than the row disappearing.
  const box = entry.box ?? { x: 0, y: 0, w: 0, h: 0 }
  // A `display` variant is not guaranteed — an image the browser could not
  // decode at upload time is stored original-only — so fall back to `thumb`
  // once, exactly as the per-photograph view does. Blurry beats blank.
  return html`<img class="face-chip-img" src="/media/${entry.fileKey ?? ""}/display" alt=""
    data-fallback="/media/${entry.fileKey ?? ""}/thumb"
    data-orig-w="${entry.width ?? ""}" data-orig-h="${entry.height ?? ""}"
    data-box-x="${box.x}" data-box-y="${box.y}" data-box-w="${box.w}" data-box-h="${box.h}"
    data-pad="${pad}" loading="lazy" />`
}

/** A plain, non-interactive chip — the overview list's preview. A `<span>`
 *  because the whole row is one `<button>` and a control may not nest inside
 *  one. @param {Types.FaceChipEntry} entry */
function faceChipMarkup(entry) {
  return html`<span class="face-chip">${faceChipImgMarkup(entry, 1)}</span>`
}

/** @param {Types.FaceChipEntry} entry @param {{ dimmed: boolean }} opts */
function renderFaceChip(entry, opts) {
  return html`<div class="face-chip ${opts.dimmed ? "is-dimmed" : ""}"
    data-face-id="${entry.faceId}">${faceChipImgMarkup(entry, 1)}</div>`
}

/** Wire every `.face-chip-img` under `container` to position itself once its
 *  natural size is known (immediately, if already cached/loaded).
 *  @param {ParentNode} container */
function wireFaceChipImages(container) {
  const imgs = container.querySelectorAll(".face-chip-img")
  imgs.forEach((img) => {
    if (!(img instanceof HTMLImageElement)) return
    // `load` is NOT `once` here, because the fallback below swaps `src` and the
    // replacement's natural size is different — positioning has to run again or
    // the chip keeps the first image's geometry and shows the wrong sliver.
    img.addEventListener("load", () => positionFaceChipImage(img))
    img.addEventListener(
      "error",
      () => {
        const fallback = img.dataset.fallback
        if (fallback && img.src !== fallback) img.src = fallback
      },
      { once: true },
    )
    if (img.complete && img.naturalWidth) positionFaceChipImage(img)
  })
}

/**
 * Position + scale the image so the face's box fills its container.
 *
 * `data-orig-w/h` are the ORIGINAL photo's pixel dimensions, which the server
 * sends alongside every box; the loaded `display` variant is smaller but
 * proportional, so `naturalWidth / origWidth` is the one uniform scale factor
 * between the box's coordinate space and the rendered image's. If the original
 * dimensions are missing, this bails and the element just shows the plain
 * uncropped image (via `.face-chip-img`'s CSS `object-fit: cover`) — degraded,
 * not broken.
 *
 * The target size comes from the PARENT rather than a constant, because this
 * tab now draws the same `<img>` at three sizes (list chip, filmstrip chip,
 * review stage) and a shared constant would have had to become three. `data-pad`
 * widens the crop about the box's centre — see REVIEW_STAGE_PAD.
 * @param {HTMLImageElement} img
 */
function positionFaceChipImage(img) {
  const origW = Number(img.dataset.origW)
  const origH = Number(img.dataset.origH)
  const boxX = Number(img.dataset.boxX)
  const boxY = Number(img.dataset.boxY)
  const boxW = Number(img.dataset.boxW)
  const boxH = Number(img.dataset.boxH)
  if (!origW || !origH || !boxW || !boxH || !img.naturalWidth || !img.naturalHeight) return

  const parent = img.parentElement
  // Falls back to the old fixed size only when the container has not been laid
  // out — an unlaid-out parent reports 0, and dividing by it yields Infinity.
  const frameW = parent && parent.clientWidth > 0 ? parent.clientWidth : CHIP_SIZE
  const frameH = parent && parent.clientHeight > 0 ? parent.clientHeight : CHIP_SIZE

  const toNatural = img.naturalWidth / origW
  const pad = Number(img.dataset.pad) > 0 ? Number(img.dataset.pad) : 1
  const natBoxW = boxW * toNatural * pad
  const natBoxH = boxH * toNatural * pad
  // Widened about the centre, so the face stays in the middle of the crop.
  const natBoxX = boxX * toNatural - (natBoxW - boxW * toNatural) / 2
  const natBoxY = boxY * toNatural - (natBoxH - boxH * toNatural) / 2

  // Scale so the box's LARGER dimension fills the frame (like object-fit:
  // cover, but keyed to the box rather than the whole image), then center the
  // box within the frame on the other axis.
  const scale = Math.max(frameW / natBoxW, frameH / natBoxH)
  const dispW = img.naturalWidth * scale
  const dispH = img.naturalHeight * scale
  const offsetX = -(natBoxX * scale) + (frameW - natBoxW * scale) / 2
  const offsetY = -(natBoxY * scale) + (frameH - natBoxH * scale) / 2

  img.style.width = `${dispW}px`
  img.style.height = `${dispH}px`
  img.style.left = `${offsetX}px`
  img.style.top = `${offsetY}px`
}

// ---- per-photograph view (#faces-photo-modal) -----------------------------

/**
 * The faces of the photograph currently on screen, in the order the server
 * returned them (`mf.id` ascending) — which is what "face 3 of 7" counts, so
 * the number an admin reads out loud is stable between refreshes.
 * @type {Types.MediaFaceEntry[]}
 */
let photoFaces = []
/** @type {number | null} */
let photoMediaId = null
/** @type {number | null} */
let photoSelectedFaceId = null
/** Set by any successful assign/clear in the dialog. The Faces tab behind it is
 *  then stale — counts, groups and the queue all move — but reloading it while
 *  the dialog is open would rip out the very element focus returns to on close,
 *  so the reload is deferred to the `close` event. */
let photoDirty = false

/** @returns {HTMLDialogElement | null} */
function photoDialog() {
  const el = document.getElementById("faces-photo-modal")
  return el instanceof HTMLDialogElement ? el : null
}

/** @returns {Types.MediaFaceEntry | undefined} */
function selectedPhotoFace() {
  return photoFaces.find((f) => f.faceId === photoSelectedFaceId)
}

/** @returns {HTMLInputElement | null} */
function photoNameInput() {
  const el = document.getElementById("faces-photo-name")
  return el instanceof HTMLInputElement ? el : null
}

/** @param {string} msg */
function showPhotoError(msg) {
  const el = document.getElementById("faces-photo-error")
  if (!(el instanceof HTMLElement)) return
  el.textContent = msg
  el.hidden = false
}

function hidePhotoError() {
  const el = document.getElementById("faces-photo-error")
  if (el instanceof HTMLElement) el.hidden = true
}

/** The per-face error, next to the name input — a bad name is about THIS face,
 *  not about the photograph. Falls back to the dialog-level alert when no face
 *  is selected, so a message is never swallowed. @param {string} msg */
function showPhotoInputError(msg) {
  const el = document.querySelector(".faces-photo-input-error")
  if (!(el instanceof HTMLElement)) {
    showPhotoError(msg)
    return
  }
  el.textContent = msg
  el.hidden = false
}

function hidePhotoInputError() {
  const el = document.querySelector(".faces-photo-input-error")
  if (el instanceof HTMLElement) el.hidden = true
  const createBtn = document.querySelector(".faces-photo-create-person")
  if (createBtn instanceof HTMLButtonElement) createBtn.hidden = true
  hidePhotoError()
}

/**
 * Open the per-photograph view. The one path to a `set_aside` face.
 * @param {number} mediaId
 * @param {HTMLElement} [trigger] focus returns here on close
 */
async function openFacesPhoto(mediaId, trigger) {
  const dialog = photoDialog()
  if (!dialog) return
  photoMediaId = mediaId
  photoFaces = []
  photoSelectedFaceId = null
  photoDirty = false
  hidePhotoError()
  showLoading(getElement("faces-photo-body"))
  openModal(dialog, trigger)
  await refreshPhotoFaces()
}

/** Refetch and re-render. Always a refetch rather than a local patch: naming a
 *  face can promote a propagated identity to a confirmed one, which changes
 *  rows other than the one that was clicked. */
async function refreshPhotoFaces() {
  if (photoMediaId === null) return
  const body = getElement("faces-photo-body")
  try {
    const data = /** @type {Types.MediaFacesResponse} */ (
      await api(`/api/admin/media/${photoMediaId}/faces`)
    )
    photoFaces = data.faces
    if (!photoFaces.some((f) => f.faceId === photoSelectedFaceId)) photoSelectedFaceId = null
    renderPhotoBody()
  } catch (err) {
    console.error("Failed to load faces for photograph:", err)
    showLoadError(body, 1, "Couldn't load this photograph's faces.", () =>
      void refreshPhotoFaces(),
    )
  }
}

/** How many of the faces on screen the queue held back. Said out loud, because
 *  "why is that one outlined differently" is the first question the view asks. */
function photoSetAsideCount() {
  return photoFaces.filter((f) => f.routeState === "set_aside").length
}

function renderPhotoBody() {
  const body = getElement("faces-photo-body")
  if (photoFaces.length === 0) {
    body.innerHTML = html`<p class="faces-empty text-muted">
      No faces are recorded in this photograph.
    </p>`
    return
  }

  // Every row came from one media row, so they all carry the same file key and
  // the same original dimensions — face 0 speaks for the photograph.
  const first = photoFaces[0]
  const fileKey = first.fileKey ?? ""
  // `media.width`/`height` are nullable, and a box is in ORIGINAL source pixels,
  // so without them there is no scale to express the box against. Degrade to a
  // list — a box drawn on a guessed scale is worse than no box, because it looks
  // authoritative while pointing at the wrong person.
  const canBox = !!(first.width && first.height)

  body.innerHTML = html`
    <div class="faces-photo-stage">
      <img class="faces-photo-img" src="/media/${fileKey}/display" alt=""
        data-fallback="/media/${fileKey}/thumb" />
      ${canBox
        ? html`<div class="faces-photo-boxes" role="group"
            aria-label="Faces in this photograph">
            ${photoFaces.map(photoBoxMarkup)}
          </div>`
        : ""}
    </div>
    ${canBox
      ? ""
      : html`<p class="faces-photo-note" role="note">
            This photograph's stored dimensions are missing, so the faces can't be placed on it.
            They are all listed below and every one of them can still be named.
          </p>
          <ul class="faces-photo-list">
            ${photoFaces.map(photoListRowMarkup)}
          </ul>`}
    <div class="faces-photo-detail">${photoDetailMarkup()}</div>
  `
  if (canBox) positionPhotoBoxes(body)
  wirePhotoImageFallback(body)
}

/**
 * An accessible name for one face box.
 *
 * It says WHICH face and WHAT STATE, and nothing else — never anything about
 * what the photograph shows or who the person appears to be (CLAUDE.md,
 * "Photographs Are Input To Code, Not To A Reader"). A name in here is only ever
 * one an admin typed; nothing describes a face.
 * @param {Types.MediaFaceEntry} face
 * @param {number} index
 */
function photoFaceLabel(face, index) {
  const parts = [`Face ${index + 1} of ${photoFaces.length}`]
  parts.push(face.personName ? `named ${face.personName}` : "not named yet")
  if (face.provenance === "propagated") parts.push("carried across, not confirmed")
  if (face.routeState === "set_aside") parts.push("set aside from the queue")
  return parts.join(", ")
}

/** @param {Types.MediaFaceEntry} face */
function photoFaceClasses(face) {
  const classes = []
  if (face.faceId === photoSelectedFaceId) classes.push("is-selected")
  if (face.routeState === "set_aside") classes.push("is-setaside")
  if (face.personId !== null) classes.push("is-named")
  if (face.provenance === "propagated") classes.push("is-propagated")
  return classes.join(" ")
}

/**
 * One face box. Its geometry is carried as data-* percentages and applied by
 * positionPhotoBoxes rather than written as a `style` attribute — the admin CSP
 * is `style-src 'self' '<hash>'` with no 'unsafe-inline', so an inline style
 * attribute would be dropped and every box would stack in the corner. Setting
 * `.style` through the CSSOM is not covered by that restriction.
 *
 * Percentages, not pixels: the box is in ORIGINAL source pixels and the image is
 * rendered at whatever width the dialog gives it, so `x / media.width` is the
 * one ratio that survives every scale — no reflow hook, no load-order dance.
 * @param {Types.MediaFaceEntry} face
 * @param {number} index
 */
function photoBoxMarkup(face, index) {
  const pct = boxPercent(face)
  const selected = face.faceId === photoSelectedFaceId
  return html`<button type="button" class="faces-photo-box ${photoFaceClasses(face)}"
    data-face-id="${face.faceId}" aria-pressed="${selected ? "true" : "false"}"
    aria-label="${photoFaceLabel(face, index)}"
    data-left="${pct.left}" data-top="${pct.top}"
    data-width="${pct.width}" data-height="${pct.height}">
    <span class="faces-photo-box-num" aria-hidden="true">${index + 1}</span>
  </button>`
}

/** The unboxed fallback row — same selection, same naming, no geometry.
 *  @param {Types.MediaFaceEntry} face @param {number} index */
function photoListRowMarkup(face, index) {
  const selected = face.faceId === photoSelectedFaceId
  return html`<li>
    <button type="button" class="btn btn-secondary btn-sm faces-photo-box ${photoFaceClasses(face)}"
      data-face-id="${face.faceId}" aria-pressed="${selected ? "true" : "false"}">
      ${photoFaceLabel(face, index)}
    </button>
  </li>`
}

/** @param {number} value @param {number} max */
function clampPct(value, max) {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  return value > max ? max : value
}

/**
 * A face's box as percentages of the ORIGINAL photograph's dimensions, clamped
 * into the frame. A detector box can hang off an edge (a face at the margin),
 * and an overlay that spills outside its stage would be clipped or would widen
 * the dialog, so the visible rectangle is trimmed rather than allowed to escape.
 * @param {Types.MediaFaceEntry} face
 */
function boxPercent(face) {
  const w = photoFaces[0]?.width ?? 0
  const h = photoFaces[0]?.height ?? 0
  const box = face.box
  if (!w || !h || !box) return { left: 0, top: 0, width: 0, height: 0 }
  const left = clampPct((box.x / w) * 100, 100)
  const top = clampPct((box.y / h) * 100, 100)
  return {
    left,
    top,
    width: clampPct((box.w / w) * 100, 100 - left),
    height: clampPct((box.h / h) * 100, 100 - top),
  }
}

/** @param {ParentNode} container */
function positionPhotoBoxes(container) {
  container.querySelectorAll(".faces-photo-box").forEach((el) => {
    if (!(el instanceof HTMLElement)) return
    const { left, top, width, height } = el.dataset
    if (left === undefined || top === undefined) return
    el.style.left = `${left}%`
    el.style.top = `${top}%`
    el.style.width = `${width}%`
    el.style.height = `${height}%`
  })
}

/** A `display` variant is not guaranteed: an image the browser couldn't decode
 *  at upload time is stored original-only, and `original` is served as an
 *  attachment so it must not be used here. Fall back to `thumb` once — a small
 *  image still places every box correctly, because the boxes are percentages.
 *  @param {ParentNode} container */
function wirePhotoImageFallback(container) {
  const img = container.querySelector(".faces-photo-img")
  if (!(img instanceof HTMLImageElement)) return
  img.addEventListener(
    "error",
    () => {
      const fallback = img.dataset.fallback
      if (fallback) img.src = fallback
    },
    { once: true },
  )
}

function photoDetailMarkup() {
  const index = photoFaces.findIndex((f) => f.faceId === photoSelectedFaceId)
  if (index === -1) {
    const setAside = photoSetAsideCount()
    return html`<p class="faces-photo-hint text-muted">
      Choose a face to name it.
      ${setAside > 0
        ? html`${setAside} of them ${setAside === 1 ? "was" : "were"} set aside as too small or too
            soft for the Ask queue — ${setAside === 1 ? "it is" : "they are"} marked with a dashed
            outline, and this is where ${setAside === 1 ? "it" : "they"} can be named.`
        : ""}
    </p>`
  }

  const face = photoFaces[index]
  return html`
    <div class="faces-photo-face" data-face-id="${face.faceId}">
      <h4 class="faces-photo-face-title">Face ${index + 1} of ${photoFaces.length}</h4>
      ${face.routeState === "set_aside"
        ? html`<p class="faces-photo-note" role="note">
            Held back from the Ask queue as too small or too soft to name off a list. Naming it
            here is the way in — this is the only place that can.
          </p>`
        : ""}
      ${face.provenance === "propagated"
        ? html`<p class="faces-photo-note" role="note">
            This name was carried across from a near-duplicate frame, not confirmed by anyone.
            Entering it again here records it as confirmed.
          </p>`
        : ""}
      <div class="faces-photo-controls">
        <input type="text" id="faces-photo-name" class="faces-photo-name-input"
          list="faces-people-roster" placeholder="Who is this?" autocomplete="off"
          value="${face.personName ?? ""}" aria-label="Person name for this face" maxlength="200" />
        <button type="button" class="btn btn-primary btn-sm faces-photo-save">Name this face</button>
        ${face.identityId !== null
          ? html`<button type="button" class="btn btn-secondary btn-sm faces-photo-clear">
              Clear name
            </button>`
          : ""}
      </div>
      <span class="faces-photo-input-error" role="alert" hidden></span>
      <!-- Same explicit-create step as a group's name input: a person is never
           created as a side effect of typing an unrecognised name. -->
      <button type="button" class="btn btn-secondary btn-sm faces-photo-create-person" hidden></button>
    </div>
  `
}

/** @param {number} faceId */
function selectPhotoFace(faceId) {
  photoSelectedFaceId = faceId
  renderPhotoBody()
  photoNameInput()?.focus()
}

/**
 * The single-face escape hatch. `personId: null` clears — the same route, which
 * is why "Clear name" needs nothing else.
 * @param {number} faceId
 * @param {number | null} personId
 * @param {string} name for the confirmation message only
 */
async function assignOnePhotoFace(faceId, personId, name) {
  if (pending.has(faceId)) return
  pending.add(faceId)
  hidePhotoError()
  try {
    await api("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId, personId }),
    })
    showSuccess(personId === null ? "Name cleared" : `Named ${name}`)
    photoDirty = true
    await refreshPhotoFaces()
    photoNameInput()?.focus()
  } catch (err) {
    showPhotoInputError(getErrorMessage(err))
  } finally {
    pending.delete(faceId)
  }
}

/** Enter or "Name this face": resolve the typed name to exactly one person and
 *  assign, or reveal the explicit create step. Mirrors handleGroupNameEnter. */
async function handlePhotoSave() {
  const face = selectedPhotoFace()
  const input = photoNameInput()
  if (!face || !input) return
  const name = input.value.trim()
  if (!name) {
    showPhotoInputError(
      face.identityId === null
        ? "Type a name first."
        : "Type a name, or use “Clear name” to remove the one it has.",
    )
    return
  }

  const resolved = resolvePersonByName(name)
  if (resolved.status === "ambiguous") {
    showPhotoInputError(
      "Multiple people share that name — rename one in the People section, then retry.",
    )
    return
  }
  if (resolved.status === "none") {
    const createBtn = document.querySelector(".faces-photo-create-person")
    if (createBtn instanceof HTMLButtonElement) {
      createBtn.textContent = `Create person “${name}” & name this face`
      createBtn.hidden = false
      showPhotoInputError("No person has that name yet. Create them?")
    }
    return
  }

  await assignOnePhotoFace(face.faceId, resolved.id, name)
}

/** @param {HTMLButtonElement} btn */
async function handlePhotoCreatePerson(btn) {
  const face = selectedPhotoFace()
  const input = photoNameInput()
  if (!face || !input) return
  const name = input.value.trim()
  if (!name) return

  btn.disabled = true
  try {
    const created = /** @type {Types.PersonCreateResponse} */ (
      await api("/api/admin/people", {
        method: "POST",
        body: JSON.stringify({ displayName: name }),
      })
    )
    // Before assigning, so the new person is resolvable (and in the datalist)
    // for the next face in this same photograph without closing the dialog.
    await refreshPeople()
    await assignOnePhotoFace(face.faceId, created.person.id, name)
  } catch (err) {
    btn.disabled = false
    showPhotoInputError(getErrorMessage(err))
  }
}

function handlePhotoClear() {
  const face = selectedPhotoFace()
  if (!face) return
  void assignOnePhotoFace(face.faceId, null, "")
}

/** @param {MouseEvent} e */
function handlePhotoDialogClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  const box = target.closest(".faces-photo-box")
  if (box instanceof HTMLElement) {
    const faceId = parseInt(box.dataset.faceId || "", 10)
    if (!Number.isNaN(faceId)) selectPhotoFace(faceId)
    return
  }
  if (target.closest(".faces-photo-save")) {
    void handlePhotoSave()
    return
  }
  if (target.closest(".faces-photo-clear")) {
    handlePhotoClear()
    return
  }
  const createBtn = target.closest(".faces-photo-create-person")
  if (createBtn instanceof HTMLButtonElement) void handlePhotoCreatePerson(createBtn)
}

/** @param {KeyboardEvent} e */
function handlePhotoDialogKeydown(e) {
  const target = e.target
  if (target instanceof HTMLInputElement && target.classList.contains("faces-photo-name-input")) {
    if (e.key === "Enter") {
      e.preventDefault()
      void handlePhotoSave()
    }
  }
}

/** @param {Event} e */
function handlePhotoDialogInput(e) {
  const target = e.target
  if (target instanceof HTMLInputElement && target.classList.contains("faces-photo-name-input")) {
    hidePhotoInputError()
  }
}

/** Deferred reload: naming a face here changes the groups, the ask queue and
 *  every count behind the dialog, but doing it while the dialog is open would
 *  destroy the trigger element that closeModal focuses on the way out. */
function handlePhotoDialogClose() {
  photoMediaId = null
  photoFaces = []
  photoSelectedFaceId = null
  if (photoDirty) {
    photoDirty = false
    void loadFaceAssignment()
  }
}

// ---- event delegation -------------------------------------------------

/** @param {MouseEvent} e */
function handleFacesBodyClick(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  // FIRST, before the row branches below: an "Open photo" button sits inside an
  // ask row and a propagation row, and both of those branches return early.
  const openPhoto = target.closest(".faces-open-photo")
  if (openPhoto instanceof HTMLElement) {
    const mediaId = parseInt(openPhoto.dataset.mediaId || "", 10)
    if (!Number.isNaN(mediaId)) void openFacesPhoto(mediaId, openPhoto)
    return
  }

  if (target.closest(".faces-setaside-more")) {
    void loadMoreSetAside()
    return
  }
  const retry = target.closest(".faces-setaside-retry")
  if (retry instanceof HTMLElement) {
    void (async () => {
      await refreshSetAside()
      renderBody()
    })()
    return
  }

  if (target.closest(".faces-batches-toggle")) {
    void toggleBatches()
    return
  }
  if (target.closest(".faces-batches-retry")) {
    void (async () => {
      await refreshBatches()
      renderBody()
    })()
    return
  }
  if (target.closest(".faces-batch-revoke")) {
    const row = target.closest(".faces-batch-row")
    const batchId = row instanceof HTMLElement ? row.dataset.batchId : undefined
    if (batchId) handleRevokeBatch(batchId)
    return
  }

  if (target.closest(".faces-ask-more")) {
    askShown += ASK_PAGE
    renderBody()
    // renderBody replaced the button that was clicked; focus its replacement,
    // or the last row when the list is now complete and the button is gone.
    const more = document.querySelector(".faces-ask-more")
    if (more instanceof HTMLElement) more.focus()
    else {
      const rows = document.querySelectorAll(".face-ask-row")
      const last = rows[rows.length - 1]
      if (last instanceof HTMLElement) last.focus()
    }
    return
  }
  const askRow = target.closest(".face-ask-row")
  if (askRow instanceof HTMLElement) {
    handleAskRowClick(askRow, target)
    return
  }
  const propagationRow = target.closest(".face-propagation-row")
  if (propagationRow instanceof HTMLElement) {
    handlePropagationRowClick(propagationRow, target)
    return
  }
  if (target.closest(".faces-propagate-all")) {
    const items = propagationData ? propagationData.items : []
    void applyPropagations(items.map((i) => i.toFaceId))
    return
  }
  const personRow = target.closest(".faces-person-row")
  if (personRow instanceof HTMLElement) {
    handlePersonRowClick(personRow, target)
    return
  }
  // Every control of the review view, in one branch — and the overview row that
  // opens it. Last, because the review view replaces the body wholesale, so
  // none of the branches above can be on screen at the same time as these.
  const overviewRow = target.closest(".face-overview-row")
  if (overviewRow instanceof HTMLElement) {
    const key = overviewRow.dataset.groupKey
    if (key !== undefined) openReview(key)
    return
  }
  handleReviewClick(target)
}

/** Keyboard: in the review view — arrows walk the filmstrip, brackets walk the
 *  groups, x excludes, Esc goes back and Enter in the name field confirms;
 *  within an ask-queue row — arrows navigate, 1/2/3 pick a candidate, s skips,
 *  x marks not-a-face. Mirrors moderation.js's keydown pattern, just scoped to
 *  the tab body instead of a `<dialog>`.
 *  @param {KeyboardEvent} e */
function handleFacesBodyKeydown(e) {
  const target = e.target
  if (!(target instanceof Element)) return

  // FIRST: the review view owns the whole body while it is up, so nothing below
  // can be on screen to compete for a key.
  if (reviewGroupKey !== null) {
    if (handleReviewKeydown(e)) return
  }

  if (target instanceof HTMLInputElement && target.classList.contains("person-name-input")) {
    if (e.key === "Enter") {
      e.preventDefault()
      handlePersonRename(target)
    }
    return
  }

  if (target instanceof HTMLInputElement && target.classList.contains("person-guest-input")) {
    if (e.key === "Enter") {
      e.preventDefault()
      handlePersonLinkGuest(target)
    }
    return
  }

  const askRow = target.closest(".face-ask-row")
  if (askRow instanceof HTMLElement) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const faceId = parseInt(askRow.dataset.faceId || "", 10)
    if (Number.isNaN(faceId)) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      focusAdjacentAskRow(faceId, 1)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      focusAdjacentAskRow(faceId, -1)
    } else if (e.key === "1" || e.key === "2" || e.key === "3") {
      void confirmAskCandidate(faceId, Number(e.key) - 1)
    } else if (e.key === "s" || e.key === "S") {
      focusAdjacentAskRow(faceId, 1)
    } else if (e.key === "o" || e.key === "O") {
      const item = queueData?.items.find((i) => i.faceId === faceId)
      if (item && item.mediaId !== null) void openFacesPhoto(item.mediaId, askRow)
    } else if (e.key === "x" || e.key === "X") {
      void handleAskNotAFace(faceId)
    }
  }
}

/** @param {Event} e */
function handleFacesBodyInput(e) {
  const target = e.target
  // The typed name is held in module state, not read off the DOM at submit
  // time: selecting or excluding a face re-renders the whole review view, and
  // without this a half-typed name vanished the moment the admin checked one
  // more face — which is the exact thing this view exists to encourage.
  if (target instanceof HTMLInputElement && target.classList.contains("face-review-name-input")) {
    reviewNameDraft = target.value
    hideReviewError()
    return
  }
  // The overview's ordering. `input` covers a <select> change in every browser
  // this admin runs in, and it is the event already delegated here.
  if (target instanceof HTMLSelectElement && target.classList.contains("faces-groups-sort-select")) {
    groupOrder = target.value === "varied" ? "varied" : "size"
    renderBody()
    const select = document.querySelector(".faces-groups-sort-select")
    if (select instanceof HTMLElement) select.focus()
    return
  }
  // Merge is destructive and not undoable from here, so its button stays
  // disabled until a target is actually chosen — no merging into the
  // placeholder option by reflex.
  if (target instanceof HTMLSelectElement && target.classList.contains("person-merge-select")) {
    const btn = target.closest(".faces-person-actions")?.querySelector(".person-merge")
    if (btn instanceof HTMLButtonElement) btn.disabled = target.value === ""
    return
  }
  if (!(target instanceof Element)) return
  const row = target.closest(".faces-person-row")
  if (row instanceof HTMLElement) hidePersonError(Number(row.dataset.personId))
}

/** Renaming commits on blur as well as Enter, so a typed name is not silently
 *  discarded by clicking elsewhere. No-ops when the value is unchanged.
 *  @param {FocusEvent} e */
function handleFacesBodyFocusOut(e) {
  const target = e.target
  if (target instanceof HTMLInputElement && target.classList.contains("person-name-input")) {
    handlePersonRename(target)
  }
}

// ---- init -----------------------------------------------------------------

/** @type {Types.initFaceAssignment} */
export function initFaceAssignment() {
  getButtonElement("faces-refresh-btn").addEventListener("click", () =>
    void loadFaceAssignment(),
  )
  // The counts row lives OUTSIDE #faces-body (index.html), so it inherits none
  // of the delegation below — same reason the photo dialog needs its own
  // listeners. It is one button, so one delegated click is the whole wiring;
  // Enter and Space come free from it being a real <button>.
  getElement("faces-counts").addEventListener("click", (e) => {
    const target = e.target
    if (!(target instanceof Element)) return
    const toggle = target.closest(".faces-setaside-toggle")
    if (toggle instanceof HTMLElement) void toggleSetAside(toggle)
  })

  const body = getElement("faces-body")
  body.addEventListener("click", handleFacesBodyClick)
  body.addEventListener("keydown", handleFacesBodyKeydown)
  body.addEventListener("input", handleFacesBodyInput)
  // focusout, not blur: blur does not bubble, so it cannot be delegated here.
  body.addEventListener("focusout", handleFacesBodyFocusOut)

  // The per-photograph dialog is declared in index.html, OUTSIDE #faces-body, so
  // none of the delegation above reaches it — it needs its own listeners. Only
  // `data-close-modal`, backdrop dismissal and focus restore come for free, from
  // initModals()'s one-time sweep of every <dialog> in the document.
  const dialog = photoDialog()
  if (dialog) {
    dialog.addEventListener("click", handlePhotoDialogClick)
    dialog.addEventListener("keydown", handlePhotoDialogKeydown)
    dialog.addEventListener("input", handlePhotoDialogInput)
    dialog.addEventListener("close", handlePhotoDialogClose)
  }
}
