/** @file The decisions behind the culling page, with no I/O and no imports.
 *
 *  Grouping, burst detection, the suggested pick, the person-coverage warning and
 *  the selection file all live here, for two reasons:
 *
 *  1. They are what the tests test. Nothing here needs a photograph.
 *  2. cull.html has to run the same coverage and selection code the tests cover.
 *     That page is opened over file://, where a browser refuses to load an ES
 *     module, so `classicScript()` in cull-data.js strips the `export` keywords
 *     from this very file and writes the result beside the page. That transform is
 *     why this module may not `import` anything at runtime, and why everything it
 *     exports is a top-level `export function` or `export const`. A test enforces
 *     both.
 *
 *  Suggestions are only suggestions. Nothing in this file ever decides for the
 *  owner: an absent decision means "undecided", and only the owner's keystroke on
 *  the page creates a `hide`.
 *
 *  No regex: string work here is `split`, `slice`, `indexOf` and `charCodeAt`.
 */
/** @import * as Types from './types.js' */

/**
 * The defaults table. Each value can be overridden on cull-data.js's command line.
 *
 * None of these is a measurement. To tune one, derive it locally and keep it off
 * disk: the distance scale comes from Vision's feature-print distances between
 * consecutive frames of your own photographs, and the eye and quality cutoffs from
 * the distribution of those readings on faces you have judged yourself.
 * @type {Types.CullDefaults}
 */
export const CULL_DEFAULTS = Object.freeze({
  /** Two frames this close in capture time are the same burst, if they look alike. */
  burstGapMs: 3000,
  /** Feature-print distance a burst tolerates. A loose bound: it only splits out
   *  a frame that plainly shows something else, like a second camera. */
  burstDistance: 0.6,
  /** Beyond burstGapMs, how far apart two frames may be and still be one moment. */
  similarWindowMs: 120000,
  /** Feature-print distance that makes two frames the same picture, taken again. */
  similarDistance: 0.25,
  /** How many of a group's latest frames a new frame is compared against. */
  compareLast: 3,

  /** Eye openness below this reads as closed. See `eyeOpenness` in the Swift. */
  eyeClosedBelow: 0.16,
  /** Landmarks on a face narrower than this are too coarse to judge an eye by. */
  minEyeFacePx: 60,
  /** Radians. A face turned further than this hides the eye being measured. */
  maxEyeYaw: 0.8,
  /** Mean face quality below this earns the `low-face-quality` flag. */
  lowFaceQuality: 0.3,

  /** Weights of the pick score. A missing component counts as the neutral 0.5. */
  weightAesthetics: 0.5,
  weightFaceQuality: 0.3,
  weightEyes: 0.2,
  /** Taken off the score of anything Vision calls a utility shot (a screenshot,
   *  a receipt), so that it is not suggested over a real frame. */
  utilityPenalty: 0.2,

  /** A person's labelled face and a scored face overlap by at least this to match. */
  faceMatchIou: 0.3,
  /** A face rated below this is not a "good" photo of that person. */
  goodFaceQuality: 0.3,
  /** Fewer good photos than this reads as "few" in the coverage warning. */
  minGoodPhotos: 3,
})

// --- Capture time ------------------------------------------------------------

/**
 * EXIF's "YYYY:MM:DD HH:MM:SS" plus its optional sub-second digits, as epoch ms.
 *
 * Read as UTC, not as local time. EXIF carries no zone, and only differences
 * between two of these are ever used, so the one thing this choice must guarantee
 * is that a daylight-saving jump on the machine running this cannot invent or
 * erase a gap. Sub-seconds matter: a burst is several frames inside one second.
 * @type {Types.parseCaptureTime}
 */
export function parseCaptureTime(captured, subsec) {
  if (typeof captured !== "string") return null
  const text = captured.trim()
  const space = text.indexOf(" ")
  if (space === -1) return null
  const date = text.slice(0, space).split(":")
  const time = text.slice(space + 1).split(":")
  if (date.length !== 3 || time.length !== 3) return null

  /** @type {number[]} */
  const parts = []
  for (const piece of [...date, ...time]) {
    const n = Number(piece)
    if (piece.length === 0 || !Number.isInteger(n) || n < 0) return null
    parts.push(n)
  }
  const [year, month, day, hour, minute, second] = parts
  // "0000:00:00 00:00:00" is what a camera with no clock writes.
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hour > 23 || minute > 59 || second > 60) return null

  let ms = 0
  if (typeof subsec === "string" && subsec.length > 0) {
    // "5" means 500ms and "123456" means 123.456ms: these are decimal digits.
    const fraction = Number("0." + subsec.trim())
    if (Number.isFinite(fraction)) ms = Math.floor(fraction * 1000)
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, ms)
}

// --- Feature prints ----------------------------------------------------------

/**
 * Euclidean distance, which is what `VNFeaturePrintObservation.computeDistance`
 * reports for the same data. Null when either print is missing or the two came
 * from different model revisions, because no distance is not the same as far.
 * @type {Types.featureDistance}
 */
export function featureDistance(a, b) {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    sum += d * d
  }
  return Math.sqrt(sum)
}

// --- Bursts ------------------------------------------------------------------

/**
 * @param {number | null | undefined} t
 * @returns {number}
 */
function timeKey(t) {
  return typeof t === "number" ? t : Infinity
}

/**
 * Stable, and independent of the input order, so that a re-run groups identically.
 * @param {Types.CullPhotoInput} a
 * @param {Types.CullPhotoInput} b
 * @returns {number}
 */
function byTimeThenName(a, b) {
  const at = timeKey(a.t)
  const bt = timeKey(b.t)
  if (at !== bt) return at < bt ? -1 : 1
  return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0
}

/**
 * The bursts inside ONE folder, as lists of the photos' `id`s in capture order.
 *
 * A frame joins an open group when any one of these holds:
 *   - it is within `burstGapMs` of the group's last frame and does not plainly show
 *     something else (distance within `burstDistance`, or no prints to compare);
 *   - it is within `similarWindowMs` and looks like a retake (distance within
 *     `similarDistance`);
 *   - it has no usable capture time, and looks like a retake of the previous group.
 *
 * Groups stay open for the whole window rather than only the latest, so two cameras
 * firing at once in one folder interleave into two groups instead of into a chain
 * of one-frame groups. The distance is to the nearest of the group's last few
 * frames, because a burst drifts: its tenth frame need not resemble its first.
 *
 * With no prints at all this degrades to time gaps alone, and with no times either
 * to every photo on its own. Missing data never merges anything.
 * @type {Types.groupFolder}
 */
export function groupFolder(photos, defaults = CULL_DEFAULTS) {
  const sorted = photos.slice().sort(byTimeThenName)

  /** @type {Array<{ members: Types.CullPhotoInput[], lastT: number | null }>} */
  const groups = []
  /** @type {typeof groups} */
  let open = []

  for (const photo of sorted) {
    const t = photo.t
    if (t !== null) {
      open = open.filter((g) => g.lastT !== null && t - g.lastT <= defaults.similarWindowMs)
    } else {
      // No clock, so nothing says how far back to look. The sort puts these in
      // filename order, so only the group right before this one is a candidate.
      open = groups.length > 0 ? [groups[groups.length - 1]] : []
    }

    /** @type {(typeof groups)[number] | null} */
    let best = null
    let bestDistance = Infinity
    // Newest first: on a tie, which the no-prints case always is, the frame stays
    // with the burst it most recently belonged to.
    for (let i = open.length - 1; i >= 0; i--) {
      const group = open[i]

      /** @type {number | null} */
      let distance = null
      const recent = group.members.slice(-defaults.compareLast)
      for (const other of recent) {
        const d = featureDistance(photo.print, other.print)
        if (d !== null && (distance === null || d < distance)) distance = d
      }

      let joins = false
      if (t !== null && group.lastT !== null) {
        const gap = t - group.lastT
        if (gap <= defaults.burstGapMs) {
          joins = distance === null || distance <= defaults.burstDistance
        } else {
          joins = distance !== null && distance <= defaults.similarDistance
        }
      } else {
        joins = distance !== null && distance <= defaults.similarDistance
      }

      const rank = distance ?? 0
      if (joins && rank < bestDistance) {
        best = group
        bestDistance = rank
      }
    }

    if (best) {
      best.members.push(photo)
      if (t !== null) best.lastT = t
    } else {
      const fresh = { members: [photo], lastT: t }
      groups.push(fresh)
      open.push(fresh)
    }
  }

  return groups.map((g) => g.members.map((m) => m.id))
}

// --- Scoring one photograph --------------------------------------------------

/**
 * Whether a face's eyes read as closed. Null when the face cannot be judged: too
 * small for its landmarks to mean anything, turned away, or no contour at all. A
 * null never counts against a photo, because it is an absence of evidence.
 * @type {Types.faceEyesClosed}
 */
export function faceEyesClosed(face, defaults = CULL_DEFAULTS) {
  if (typeof face.px === "number" && face.px < defaults.minEyeFacePx) return null
  if (typeof face.yaw === "number" && Math.abs(face.yaw) > defaults.maxEyeYaw) return null
  /** @type {number[]} */
  const eyes = []
  if (typeof face.leftEye === "number") eyes.push(face.leftEye)
  if (typeof face.rightEye === "number") eyes.push(face.rightEye)
  if (eyes.length === 0) return null
  const mean = eyes.reduce((sum, eye) => sum + eye, 0) / eyes.length
  return mean < defaults.eyeClosedBelow
}

/**
 * The combined pick score and the flags a person sees on the page.
 *
 * Faces are weighted by width. In a real frame the couple is large and a guest in
 * the background is small, and a sharp couple with a soft background is the better
 * photo. A flag is information for the owner; none of them ever hides anything.
 * @type {Types.assessPhoto}
 */
export function assessPhoto(photo, defaults = CULL_DEFAULTS) {
  const faces = photo.faces ?? []
  /** @type {Types.CullFlag[]} */
  const flags = []

  let qualitySum = 0
  let qualityWeight = 0
  let eyesOpenWeight = 0
  let eyesJudgedWeight = 0
  let eyesClosed = 0
  for (const face of faces) {
    const weight = face.w > 0 ? face.w : 0
    if (typeof face.quality === "number") {
      qualitySum += face.quality * weight
      qualityWeight += weight
    }
    const closed = faceEyesClosed(face, defaults)
    if (closed !== null) {
      eyesJudgedWeight += weight
      if (closed) eyesClosed++
      else eyesOpenWeight += weight
    }
  }

  const quality = qualityWeight > 0 ? qualitySum / qualityWeight : null
  const eyes = eyesJudgedWeight > 0 ? eyesOpenWeight / eyesJudgedWeight : null
  const aesthetics = typeof photo.aesthetics === "number" ? (photo.aesthetics + 1) / 2 : null

  /** @type {number | null} */
  let score = null
  if (aesthetics !== null || quality !== null || eyes !== null) {
    score =
      defaults.weightAesthetics * (aesthetics ?? 0.5) +
      defaults.weightFaceQuality * (quality ?? 0.5) +
      defaults.weightEyes * (eyes ?? 0.5)
    if (photo.utility) score -= defaults.utilityPenalty
  } else {
    flags.push("no-scores")
  }

  if (eyesClosed > 0) flags.push("eyes-closed")
  if (quality !== null && quality < defaults.lowFaceQuality) flags.push("low-face-quality")
  if (photo.utility) flags.push("utility")

  return { score, faces: faces.length, quality, eyesClosed, flags }
}

/**
 * The one frame to suggest from a group. Deterministic: on a tied or absent score
 * the earliest frame wins, so a re-run suggests the same photo.
 * @type {Types.suggestPick}
 */
export function suggestPick(members, assess) {
  let pick = members[0]
  /** @type {number | null} */
  let bestScore = null
  let scoredCount = 0
  for (const id of members) {
    const score = assess(id).score
    if (score === null) continue
    scoredCount++
    if (bestScore === null || score > bestScore) {
      bestScore = score
      pick = id
    }
  }

  if (members.length === 1) return { pick, reason: "The only frame of this moment." }
  if (scoredCount === 0) {
    return { pick, reason: "No scores in this group, so simply the first frame." }
  }

  const details = assess(pick)
  const parts = [`Highest combined score of ${members.length} frames`]
  if (details.faces > 0) {
    parts.push(details.eyesClosed === 0 ? "no closed eyes detected" : "but it has closed eyes too")
  }
  return { pick, reason: parts.join("; ") + "." }
}

/**
 * Every folder's groups in one list: folders in code-unit order, groups in capture
 * order within each, each carrying its suggested pick. Ids are the photos' `id`s.
 * @type {Types.buildGroups}
 */
export function buildGroups(photos, defaults = CULL_DEFAULTS) {
  /** @type {Map<string, Types.CullPhotoInput[]>} */
  const byFolder = new Map()
  /** @type {Map<number, Types.CullPhotoInput>} */
  const byId = new Map()
  for (const photo of photos) {
    byId.set(photo.id, photo)
    const list = byFolder.get(photo.folder)
    if (list) list.push(photo)
    else byFolder.set(photo.folder, [photo])
  }

  /** @type {Map<number, Types.CullAssessment>} */
  const assessments = new Map()
  /** @type {(id: number) => Types.CullAssessment} */
  const assess = (id) => {
    let found = assessments.get(id)
    if (!found) {
      found = assessPhoto(/** @type {Types.CullPhotoInput} */ (byId.get(id)), defaults)
      assessments.set(id, found)
    }
    return found
  }

  /** @type {Types.CullGroup[]} */
  const groups = []
  const folders = Array.from(byFolder.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const folder of folders) {
    const list = /** @type {Types.CullPhotoInput[]} */ (byFolder.get(folder))
    for (const members of groupFolder(list, defaults)) {
      const { pick, reason } = suggestPick(members, assess)
      groups.push({
        folder,
        items: members,
        pick,
        kind: members.length > 1 ? "burst" : "single",
        reason,
      })
    }
  }
  return { groups, assess }
}

/**
 * One entry per distinct file content.
 *
 * The selection file names content, not paths, so two copies of a photograph are
 * one decision whichever way the page presents them. Showing both would invite
 * keeping one and hiding the other, a choice the file format cannot express.
 * @type {Types.dedupeByHash}
 */
export function dedupeByHash(entries) {
  /** @type {Map<string, Types.CullHashedFile & { alsoAt: string[] }>} */
  const bySha = new Map()
  for (const entry of entries) {
    const seen = bySha.get(entry.sha256)
    if (seen) seen.alsoAt.push(entry.relative)
    else bySha.set(entry.sha256, { ...entry, alsoAt: [] })
  }
  return Array.from(bySha.values())
}

/**
 * What a Live Photo's two halves have in common: the folder and the stem, ignoring
 * case, with Photos' edited-export prefix taken off. `IMG_E1234.JPG` is the edit of
 * `IMG_1234`, and its motion half keeps the original name.
 * @param {string} relative
 * @returns {string}
 */
function livePairKey(relative) {
  const lower = relative.toLowerCase()
  const slash = lower.lastIndexOf("/")
  const dot = lower.lastIndexOf(".")
  const stem = dot > slash ? lower.slice(0, dot) : lower
  const folder = stem.slice(0, slash + 1)
  const name = stem.slice(slash + 1)
  const digit = name.charCodeAt(5)
  if (name.startsWith("img_e") && digit >= 48 && digit <= 57) {
    return folder + "img_" + name.slice(5)
  }
  return stem
}

/**
 * Relative paths of videos that look like the motion half of an iPhone Live Photo:
 * the same stem as an image in the same folder (see `livePairKey`).
 *
 * Every path an entry's bytes live at counts, `alsoAt` included. Dedupe keeps one
 * path per content, and a photo copied into a second folder would otherwise lose
 * the clip that sits beside the copy.
 *
 * A hint and nothing more. Every undecided video is hidden whether or not it pairs;
 * the page uses this to label clips and to offer hiding them all in one keypress.
 * @type {Types.liveClipPaths}
 */
export function liveClipPaths(entries) {
  /** @param {Pick<Types.CullHashedFile, "relative"> & { alsoAt?: readonly string[] }} entry */
  const pathsOf = (entry) => [entry.relative, ...(entry.alsoAt ?? [])]
  /** @type {Set<string>} */
  const imageKeys = new Set()
  for (const entry of entries) {
    if (entry.kind !== "image") continue
    for (const relative of pathsOf(entry)) imageKeys.add(livePairKey(relative))
  }
  /** @type {Set<string>} */
  const clips = new Set()
  for (const entry of entries) {
    if (entry.kind !== "video") continue
    if (pathsOf(entry).some((relative) => imageKeys.has(livePairKey(relative)))) {
      clips.add(entry.relative)
    }
  }
  return clips
}

// --- Decisions and the selection file ----------------------------------------

/** @type {Types.isSha256Hex} */
export function isSha256Hex(value) {
  if (typeof value !== "string" || value.length !== 64) return false
  for (let i = 0; i < 64; i++) {
    const c = value.charCodeAt(i)
    const digit = c >= 48 && c <= 57
    const lowerHex = c >= 97 && c <= 102
    if (!digit && !lowerHex) return false
  }
  return true
}

/**
 * What the selection file will say for this item, if exported now.
 *
 * Public only because the owner said so, photo or video alike. Nothing reaches the
 * site without a keypress: an undecided item, of either kind, imports hidden. The
 * page counts undecided videos in its header so that none is left by oversight.
 * `item` is unused, and stays in the signature so that a rule which does depend on
 * the item has one place to go.
 * @type {Types.isFinallyVisible}
 */
export function isFinallyVisible(item, decision) {
  return decision === "keep"
}

/**
 * Whether the owner has ruled this item out. An undecided photo might still be
 * kept, so a coverage warning at the moment of a rejection counts it as available.
 * @type {Types.isStillPossible}
 */
export function isStillPossible(decision) {
  return decision !== "hide"
}

/** @type {Types.groupReviewed} */
export function groupReviewed(members, decisions) {
  for (const member of members) {
    if (!Object.hasOwn(decisions, member.sha)) return false
  }
  return true
}

/**
 * What accepting a group changes. If the owner has already kept something the
 * suggestion yields to it; explicit decisions are never overwritten either way, so
 * the only new `hide`s are on frames the owner has just chosen to pass over.
 * @type {Types.acceptGroup}
 */
export function acceptGroup(members, pickSha, decisions) {
  const alreadyKept = members.some((m) => decisions[m.sha] === "keep")
  /** @type {Types.CullChange[]} */
  const changes = []
  for (const member of members) {
    if (Object.hasOwn(decisions, member.sha)) continue
    changes.push({
      sha: member.sha,
      to: !alreadyKept && member.sha === pickSha ? "keep" : "hide",
    })
  }
  return changes
}

/**
 * The owner overriding the suggestion: keep this frame, pass over the undecided
 * rest. Anything already kept stays kept, since a second keeper from one burst is a
 * legitimate choice.
 * @type {Types.pickOnly}
 */
export function pickOnly(members, sha, decisions) {
  /** @type {Types.CullChange[]} */
  const changes = []
  for (const member of members) {
    if (member.sha === sha) {
      if (decisions[member.sha] !== "keep") changes.push({ sha: member.sha, to: "keep" })
    } else if (!Object.hasOwn(decisions, member.sha)) {
      changes.push({ sha: member.sha, to: "hide" })
    }
  }
  return changes
}

/**
 * The selection file. Exactly this shape, agreed with the importer, and sorted so
 * that the same decisions always produce the same bytes. It carries hashes and
 * nothing else: no path, no name, no person.
 *
 * A malformed hash throws rather than being dropped. A photo that silently fell out
 * of `visible` would finish its import hidden with nothing to say why.
 * @type {Types.buildSelection}
 */
export function buildSelection(items, decisions) {
  /** @type {Set<string>} */
  const visible = new Set()
  for (const item of items) {
    if (!isSha256Hex(item.sha)) {
      throw new Error(`Not a lowercase sha256: ${JSON.stringify(item.sha)}`)
    }
    if (isFinallyVisible(item, decisions[item.sha])) visible.add(item.sha)
  }
  return { version: 1, visible: Array.from(visible).sort() }
}

/** @type {Types.parseSelection} */
export function parseSelection(text) {
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { valid: false, error: "Not valid JSON." }
  }
  if (parsed === null || typeof parsed !== "object") {
    return { valid: false, error: "Not a selection file." }
  }
  const { version, visible } = /** @type {{ version?: unknown, visible?: unknown }} */ (parsed)
  if (version !== 1) return { valid: false, error: `Unsupported version ${String(version)}.` }
  if (!Array.isArray(visible)) return { valid: false, error: "No `visible` list." }
  for (const sha of visible) {
    if (!isSha256Hex(sha)) return { valid: false, error: "`visible` holds a malformed hash." }
  }
  return { valid: true, value: { version: 1, visible: visible.slice() } }
}

/**
 * Decisions recovered from a selection file, for a different browser or a cleared
 * localStorage. The page's state afterwards is exactly what the file means to the
 * importer: every listed item kept, every other item here hidden.
 *
 * That replaces whatever was decided before, which the page asks about first. It
 * also turns "not listed" into an explicit hide, so a group the owner had rejected
 * comes back reviewed rather than undecided, and Enter cannot quietly keep its
 * suggested frame. An item the owner never reached comes back hidden too, which is
 * how the file would have imported it anyway.
 * @type {Types.restoreSelection}
 */
export function restoreSelection(items, selection) {
  const listed = new Set(selection.visible)
  /** @type {Types.CullChange[]} */
  const changes = []
  /** @type {Set<string>} */
  const known = new Set()
  for (const item of items) {
    if (known.has(item.sha)) continue
    known.add(item.sha)
    changes.push({ sha: item.sha, to: listed.has(item.sha) ? "keep" : "hide" })
  }
  let unknown = 0
  for (const sha of listed) if (!known.has(sha)) unknown++
  return { changes, unknown }
}

/**
 * `undecided` counts photos and `undecidedVideos` counts videos, so the page can
 * prompt for each where it is decided. Both finish hidden.
 * @type {Types.summarize}
 */
export function summarize(items, decisions) {
  const summary = {
    visiblePhotos: 0,
    visibleVideos: 0,
    hidden: 0,
    undecided: 0,
    undecidedVideos: 0,
  }
  for (const item of items) {
    const decision = decisions[item.sha]
    if (isFinallyVisible(item, decision)) {
      if (item.kind === "video") summary.visibleVideos++
      else summary.visiblePhotos++
    } else if (decision === "hide") {
      summary.hidden++
    } else if (item.kind === "video") {
      summary.undecidedVideos++
    } else {
      summary.undecided++
    }
  }
  return summary
}

// --- Saved decisions -----------------------------------------------------------

/** localStorage key for every decision this browser holds, keyed by content hash. */
export const CULL_STORE_KEY = "cull:v2"
/** Where the last place the owner stood is kept. Content-keyed too. */
export const CULL_CURSOR_KEY = "cull:v2:cursor"
/** The first version's keys: `cull:v1:` plus a digest of the photo directory's path. */
export const CULL_LEGACY_PREFIX = "cull:v1:"

/**
 * When two entries for one item were stamped at the same moment, the one that
 * leaves it less public wins. Ties are rare, and this is the safe way to break one.
 * @param {Types.CullStampedDecision} entry
 * @returns {number}
 */
function tieRank(entry) {
  return entry.d === "hide" ? 2 : entry.d === null ? 1 : 0
}

/**
 * Two logs merged item by item, the later stamp winning. A `null` decision is a
 * stamped return to undecided, so an undo in one tab is not reverted by an older
 * keep in another. `changed` lists the hashes whose entry differs from `base`'s.
 *
 * This, and not "whoever saved last", is what makes two open tabs safe: a tab that
 * has been sitting stale can only add what is newer than what it finds.
 * @type {Types.mergeDecisionLogs}
 */
export function mergeDecisionLogs(base, incoming) {
  /** @type {Types.CullDecisionLog} */
  const log = { ...base }
  /** @type {string[]} */
  const changed = []
  for (const sha of Object.keys(incoming)) {
    const theirs = incoming[sha]
    const ours = log[sha]
    const wins =
      ours === undefined ||
      theirs.at > ours.at ||
      (theirs.at === ours.at && tieRank(theirs) > tieRank(ours))
    if (wins && (ours === undefined || ours.d !== theirs.d || ours.at !== theirs.at)) {
      log[sha] = theirs
      changed.push(sha)
    }
  }
  return { log, changed }
}

/** @type {Types.decisionsFromLog} */
export function decisionsFromLog(log) {
  /** @type {Types.CullDecisions} */
  const decisions = {}
  for (const sha of Object.keys(log)) {
    const d = log[sha].d
    if (d !== null) decisions[sha] = d
  }
  return decisions
}

/**
 * The stored form: `{ version: 2, log: { sha: [decision or null, stamp] } }`. Tuples
 * rather than objects, because a library of thousands of photographs is thousands of
 * entries in a store of a few megabytes.
 * @type {Types.serializeDecisionLog}
 */
export function serializeDecisionLog(log) {
  /** @type {Record<string, [Types.CullDecision | null, number]>} */
  const out = {}
  for (const sha of Object.keys(log).sort()) out[sha] = [log[sha].d, log[sha].at]
  return JSON.stringify({ version: 2, log: out })
}

/**
 * The inverse of `serializeDecisionLog`. An absent store is an empty log. Anything
 * malformed is an error rather than a partial log, because the page then keeps a copy
 * of the unreadable text instead of writing over it.
 * @type {Types.parseDecisionLog}
 */
export function parseDecisionLog(text) {
  if (text === null) return { valid: true, value: {} }
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { valid: false, error: "Not valid JSON." }
  }
  if (parsed === null || typeof parsed !== "object") {
    return { valid: false, error: "Not a decision store." }
  }
  const { version, log } = /** @type {{ version?: unknown, log?: unknown }} */ (parsed)
  if (version !== 2 || log === null || typeof log !== "object" || Array.isArray(log)) {
    return { valid: false, error: "Not a version 2 decision store." }
  }
  /** @type {Types.CullDecisionLog} */
  const value = {}
  for (const [sha, entry] of Object.entries(log)) {
    if (!isSha256Hex(sha) || !Array.isArray(entry) || entry.length !== 2) {
      return { valid: false, error: "A malformed entry." }
    }
    const [d, at] = entry
    if ((d !== "keep" && d !== "hide" && d !== null) || typeof at !== "number" || !(at >= 0)) {
      return { valid: false, error: "A malformed entry." }
    }
    value[sha] = { d, at }
  }
  return { valid: true, value }
}

/**
 * The decisions in one first-version store, `{ decisions: { sha: "keep" | "hide" } }`.
 * Null when the text is not one. Entries that are not a decision on a hash are left
 * out: that store only ever wrote well-formed ones.
 * @type {Types.parseLegacyDecisions}
 */
export function parseLegacyDecisions(text) {
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== "object") return null
  const { decisions } = /** @type {{ decisions?: unknown }} */ (parsed)
  if (decisions === null || typeof decisions !== "object" || Array.isArray(decisions)) return null
  /** @type {Types.CullDecisions} */
  const out = {}
  for (const [sha, d] of Object.entries(decisions)) {
    if (isSha256Hex(sha) && (d === "keep" || d === "hide")) out[sha] = d
  }
  return out
}

/**
 * First-version decisions brought into a log, never at the expense of a decision
 * already in it. They are stamped 0, the oldest possible, because they carry no time:
 * anything decided on the new page is newer, and wins.
 *
 * The old stores were one per photo directory path, and each old tab wrote its whole
 * view into one. A photograph decided both ways, across two stores or against an
 * old decision already brought in, is a `conflict`: resolved towards hidden like any
 * other tie, and counted, so the page can say so instead of choosing silently.
 * @type {Types.importLegacyDecisions}
 */
export function importLegacyDecisions(log, stores) {
  /** @type {Types.CullDecisionLog} */
  const legacy = {}
  /** @type {Set<string>} */
  const conflicts = new Set()
  for (const store of stores) {
    for (const sha of Object.keys(store)) {
      const d = store[sha]
      const seen = legacy[sha]
      const earlier = log[sha]
      if (seen && seen.d !== d) conflicts.add(sha)
      if (earlier && earlier.at === 0 && earlier.d !== d) conflicts.add(sha)
      if (!seen || d === "hide") legacy[sha] = { d, at: 0 }
    }
  }
  const merged = mergeDecisionLogs(log, legacy)
  return { log: merged.log, imported: merged.changed.length, conflicts: conflicts.size }
}

// --- People ------------------------------------------------------------------

/**
 * @param {{ x: number, y: number, w: number, h: number }} a
 * @param {{ x: number, y: number, w: number, h: number }} b
 * @returns {number}
 */
function iou(a, b) {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  if (right <= left || bottom <= top) return 0
  const shared = (right - left) * (bottom - top)
  const union = a.w * a.h + b.w * b.h - shared
  return union > 0 ? shared / union : 0
}

/**
 * Whether one labelled face makes this photo a good photo of that person.
 *
 * Unrated counts as good. "Few good photos" is a claim about this person's photos,
 * and a detector that did not fire on them is no evidence against any of them.
 * @type {Types.faceIsGood}
 */
export function faceIsGood(box, scoredFaces, defaults = CULL_DEFAULTS) {
  /** @type {Types.CullFaceScore | null} */
  let match = null
  let bestOverlap = 0
  for (const face of scoredFaces ?? []) {
    const overlap = iou(box, face)
    if (overlap >= defaults.faceMatchIou && overlap > bestOverlap) {
      bestOverlap = overlap
      match = face
    }
  }
  if (!match) return true
  if (typeof match.quality === "number" && match.quality < defaults.goodFaceQuality) return false
  return faceEyesClosed(match, defaults) !== true
}

/**
 * People and the photos they appear in, joined by content hash: face id → label →
 * person key, and face id → photo id → sha256 → the page's item. A photo labelled in
 * the run but absent from this directory joins to nothing and is dropped.
 *
 * `name` comes only from the identities file, and is null without one. Names are
 * for the local page: this is the only function that handles one, and nothing
 * downstream of it writes anywhere but the page's own data file.
 * @type {Types.buildPeople}
 */
export function buildPeople(input, defaults = CULL_DEFAULTS) {
  const photosById = new Map(input.photos.map((photo) => [photo.id, photo]))

  /** @type {Map<string, Map<number, boolean>>} */
  const byPerson = new Map()
  for (const face of input.faces) {
    const key = input.labels[String(face.id)]
    // "x" is label.html's not-a-face sentinel; a skipped face has no key at all.
    if (typeof key !== "string" || key === input.notAFace) continue
    const photo = photosById.get(face.photoId)
    if (!photo || photo.width <= 0 || photo.height <= 0) continue
    const item = input.itemForSha(photo.sha256)
    if (item === null) continue

    const box = {
      x: face.box.x / photo.width,
      y: face.box.y / photo.height,
      w: face.box.w / photo.width,
      h: face.box.h / photo.height,
    }
    const good = faceIsGood(box, input.scoredFaces(item), defaults)

    let appearances = byPerson.get(key)
    if (!appearances) {
      appearances = new Map()
      byPerson.set(key, appearances)
    }
    // A person labelled twice in one photo is one photo, and a good one if either is.
    appearances.set(item, good || appearances.get(item) === true)
  }

  /** @type {Types.CullPerson[]} */
  const people = []
  for (const [key, appearances] of byPerson) {
    /** @type {Array<[number, 0 | 1]>} */
    const photos = []
    for (const [item, good] of appearances) photos.push([item, good ? 1 : 0])
    photos.sort((a, b) => a[0] - b[0])
    people.push({ key, name: input.names?.get(key) ?? null, photos })
  }
  people.sort((a, b) => {
    const left = a.name ?? a.key
    const right = b.name ?? b.key
    return left < right ? -1 : left > right ? 1 : 0
  })
  return people
}

/**
 * How many of each person's photos are visible under `isVisible`, and how many of
 * those are good.
 * @type {Types.coverageCounts}
 */
export function coverageCounts(people, isVisible) {
  return people.map((person) => {
    let visible = 0
    let good = 0
    for (const [item, isGood] of person.photos) {
      if (!isVisible(item)) continue
      visible++
      if (isGood === 1) good++
    }
    return { key: person.key, name: person.name, visible, good, total: person.photos.length }
  })
}

/**
 * Who a change has just cost. A person is warned about only when THIS change lowered
 * their good-photo count and left it below `minGood`. Without the first condition,
 * someone with few photos to begin with would raise a warning at every keystroke in
 * the whole set, and it would stop being read long before it mattered.
 * @type {Types.coverageWarnings}
 */
export function coverageWarnings(people, before, after, minGood) {
  const previous = coverageCounts(people, before)
  const current = coverageCounts(people, after)
  /** @type {Types.CullCoverageWarning[]} */
  const warnings = []
  for (let i = 0; i < people.length; i++) {
    if (current[i].good < previous[i].good && current[i].good < minGood) {
      warnings.push({ ...current[i], level: warningLevel(current[i]) })
    }
  }
  return warnings
}

/**
 * Everyone below `minGood` under `isVisible`, worst first. Shown before an export,
 * where the question is the state of the whole set and not the last keystroke.
 * @type {Types.coverageShortfalls}
 */
export function coverageShortfalls(people, isVisible, minGood) {
  /** @type {Types.CullCoverageWarning[]} */
  const out = []
  for (const counts of coverageCounts(people, isVisible)) {
    if (counts.good < minGood) out.push({ ...counts, level: warningLevel(counts) })
  }
  return out.sort((a, b) => a.good - b.good || a.visible - b.visible)
}

/**
 * @param {Types.CullCoverageCounts} counts
 * @returns {Types.CullCoverageWarning["level"]}
 */
function warningLevel(counts) {
  if (counts.visible === 0) return "none"
  return counts.good === 0 ? "no-good" : "few"
}
