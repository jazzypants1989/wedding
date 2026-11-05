/** @file Unit tests: the culling tool's decisions and its data join.
 *
 *  Synthetic data only. No photograph, no real label and no real name is involved:
 *  "images" are the magic-byte stubs from tests/media-fixtures.js, and scores are
 *  rows this file writes. The Swift scorer has its own end-to-end test on generated
 *  images in vision-cull-swift.test.js.
 */
/** @import * as Types from '../../scripts/vision/types.js' */

import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, describe, test } from "node:test"
import vm from "node:vm"

import { hashFile } from "../../scripts/lib/import-manifest.js"
import {
  buildPageData,
  classicScript,
  decodeFeaturePrint,
  loadPeopleInput,
  parseCullArgs,
  readScores,
  runCullData,
} from "../../scripts/vision/cull-data.js"
import * as logic from "../../scripts/vision/cull-logic.js"
import { computeDatasetId } from "../../scripts/vision/dataset-id.js"
import { makeJpeg, makeMp4, makePng } from "../media-fixtures.js"

const {
  CULL_CURSOR_KEY,
  CULL_DEFAULTS,
  CULL_LEGACY_PREFIX,
  CULL_STORE_KEY,
  acceptGroup,
  assessPhoto,
  buildGroups,
  buildPeople,
  buildSelection,
  coverageCounts,
  coverageShortfalls,
  coverageWarnings,
  decisionsFromLog,
  dedupeByHash,
  faceEyesClosed,
  faceIsGood,
  featureDistance,
  groupFolder,
  groupReviewed,
  importLegacyDecisions,
  isFinallyVisible,
  isSha256Hex,
  isStillPossible,
  liveClipPaths,
  mergeDecisionLogs,
  parseCaptureTime,
  parseDecisionLog,
  parseLegacyDecisions,
  parseSelection,
  pickOnly,
  restoreSelection,
  serializeDecisionLog,
  suggestPick,
  summarize,
} = logic

const SECOND = 1000

/** A print near `angle` on a circle, so distances are easy to reason about. */
/** @param {number} angle @returns {number[]} */
function print(angle) {
  return [Math.cos(angle), Math.sin(angle)]
}

/**
 * @param {number} id
 * @param {Partial<Types.CullPhotoInput>} [overrides]
 * @returns {Types.CullPhotoInput}
 */
function photo(id, overrides = {}) {
  return {
    id,
    rel: `folder/${String(id).padStart(4, "0")}.jpg`,
    folder: "folder",
    t: id * 3600 * SECOND,
    aesthetics: 0,
    utility: false,
    faces: [],
    print: null,
    ...overrides,
  }
}

/**
 * @param {string} seed
 * @returns {string}
 */
function sha(seed) {
  return crypto.createHash("sha256").update(seed).digest("hex")
}

/**
 * @param {string} seed
 * @param {"image" | "video"} [kind]
 * @returns {Types.CullDecidable}
 */
function decidable(seed, kind = "image") {
  return { sha: sha(seed), kind }
}

describe("parseCaptureTime", () => {
  test("reads EXIF's colon-separated date", () => {
    assert.equal(parseCaptureTime("2025:06:14 17:02:11"), Date.UTC(2025, 5, 14, 17, 2, 11))
  })

  test("sub-second digits are decimal digits, not a count of milliseconds", () => {
    const base = Date.UTC(2025, 5, 14, 17, 2, 11)
    assert.equal(parseCaptureTime("2025:06:14 17:02:11", "5"), base + 500)
    assert.equal(parseCaptureTime("2025:06:14 17:02:11", "120"), base + 120)
    assert.equal(parseCaptureTime("2025:06:14 17:02:11", "123456"), base + 123)
  })

  test("a camera with no clock, and malformed text, have no time", () => {
    for (const bad of [
      "0000:00:00 00:00:00",
      "    :  :     :  :  ",
      "2025-06-14",
      "2025:13:01 00:00:00",
      "2025:06:14 25:00:00",
      "",
      null,
      undefined,
    ]) {
      assert.equal(parseCaptureTime(bad), null, String(bad))
    }
  })

  test("a daylight-saving jump cannot appear in a gap", () => {
    // Clocks went forward in the US at 02:00 on this date. Read as local time, these
    // two would be either an hour or no time apart depending on the machine's zone.
    const a = parseCaptureTime("2025:03:09 01:59:59")
    const b = parseCaptureTime("2025:03:09 03:00:00")
    assert.equal(/** @type {number} */ (b) - /** @type {number} */ (a), 3601 * SECOND)
  })
})

describe("featureDistance", () => {
  test("is Euclidean", () => {
    assert.equal(featureDistance([0, 0], [3, 4]), 5)
    assert.equal(featureDistance([1, 2], [1, 2]), 0)
  })

  test("no comparison is null, never zero or far", () => {
    assert.equal(featureDistance(null, [1]), null)
    assert.equal(featureDistance([1], undefined), null)
    assert.equal(featureDistance([1, 2], [1]), null)
    assert.equal(featureDistance([], []), null)
  })
})

describe("groupFolder: bursts", () => {
  test("frames inside the gap are one burst, and a longer gap starts another", () => {
    const groups = groupFolder([
      photo(1, { t: 0 }),
      photo(2, { t: 1 * SECOND }),
      photo(3, { t: 2 * SECOND }),
      photo(4, { t: 30 * SECOND }),
    ])
    assert.deepEqual(groups, [[1, 2, 3], [4]])
  })

  test("the gap is measured between neighbours, so a burst can outlast it", () => {
    const groups = groupFolder(
      [0, 2, 4, 6, 8, 10].map((s, i) => photo(i, { t: s * SECOND })),
      { ...CULL_DEFAULTS, burstGapMs: 3 * SECOND },
    )
    assert.equal(groups.length, 1)
  })

  test("the input order does not matter", () => {
    const list = [photo(1, { t: 0 }), photo(2, { t: SECOND }), photo(3, { t: 90 * SECOND })]
    assert.deepEqual(groupFolder(list), groupFolder(list.slice().reverse()))
  })

  test("a frame that plainly shows something else splits out of the burst", () => {
    const groups = groupFolder([
      photo(1, { t: 0, print: print(0) }),
      photo(2, { t: SECOND, print: print(0.01) }),
      photo(3, { t: 2 * SECOND, print: print(2.5) }),
    ])
    assert.deepEqual(groups, [[1, 2], [3]])
  })

  test("a retake outside the burst gap joins, inside the window only", () => {
    const groups = groupFolder([
      photo(1, { t: 0, print: print(0) }),
      photo(2, { t: 60 * SECOND, print: print(0.01) }),
      photo(3, { t: 600 * SECOND, print: print(0.02) }),
    ])
    assert.deepEqual(groups, [[1, 2], [3]])
  })

  test("a different picture outside the burst gap stays apart", () => {
    const groups = groupFolder([
      photo(1, { t: 0, print: print(0) }),
      photo(2, { t: 60 * SECOND, print: print(1.5) }),
    ])
    assert.deepEqual(groups, [[1], [2]])
  })

  test("a burst may drift: each frame compares with the latest, not the first", () => {
    // Each step is small, but the two ends are far further apart than the tolerance.
    const list = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      photo(i, { t: i * 20 * SECOND, print: print(i * 0.2) }),
    )
    assert.ok(
      /** @type {number} */ (featureDistance(print(0), print(7 * 0.2))) >
        CULL_DEFAULTS.similarDistance,
    )
    assert.deepEqual(groupFolder(list), [[0, 1, 2, 3, 4, 5, 6, 7]])
  })

  test("two cameras firing at once in one folder separate instead of chaining", () => {
    const list = [
      photo(1, { t: 0, print: print(0) }),
      photo(2, { t: 500, print: print(2) }),
      photo(3, { t: SECOND, print: print(0.01) }),
      photo(4, { t: 1500, print: print(2.01) }),
    ]
    assert.deepEqual(groupFolder(list), [
      [1, 3],
      [2, 4],
    ])
  })

  test("with no prints it degrades to time alone", () => {
    const groups = groupFolder([
      photo(1, { t: 0 }),
      photo(2, { t: SECOND }),
      photo(3, { t: 60 * SECOND }),
    ])
    assert.deepEqual(groups, [[1, 2], [3]])
  })

  test("with no time and no print, nothing merges", () => {
    const groups = groupFolder([photo(1, { t: null }), photo(2, { t: null }), photo(3, { t: null })])
    assert.deepEqual(groups, [[1], [2], [3]])
  })

  test("with no time, consecutive look-alikes merge and sort by filename", () => {
    const groups = groupFolder([
      photo(3, { t: null, print: print(2) }),
      photo(2, { t: null, print: print(0.01) }),
      photo(1, { t: null, print: print(0) }),
    ])
    assert.deepEqual(groups, [[1, 2], [3]])
  })

  test("timed frames come first, and an untimed frame never lands in a timed burst by gap", () => {
    const groups = groupFolder([photo(1, { t: null }), photo(2, { t: 0 })])
    assert.deepEqual(groups, [[2], [1]])
  })
})

describe("faceEyesClosed", () => {
  const face = { x: 0, y: 0, w: 0.2, h: 0.2, px: 400 }

  test("reads the mean of both eyes against the cutoff", () => {
    assert.equal(faceEyesClosed({ ...face, leftEye: 0.05, rightEye: 0.06 }), true)
    assert.equal(faceEyesClosed({ ...face, leftEye: 0.4, rightEye: 0.35 }), false)
  })

  test("one eye is enough to read", () => {
    assert.equal(faceEyesClosed({ ...face, rightEye: 0.02 }), true)
  })

  test("no contour, a tiny face or a turned head cannot be judged", () => {
    assert.equal(faceEyesClosed(face), null)
    assert.equal(faceEyesClosed({ ...face, px: 20, leftEye: 0.01 }), null)
    assert.equal(faceEyesClosed({ ...face, yaw: 1.5, leftEye: 0.01 }), null)
  })
})

describe("assessPhoto and suggestPick", () => {
  const openFace = { x: 0, y: 0, w: 0.3, h: 0.3, px: 600, quality: 0.8, leftEye: 0.4, rightEye: 0.4 }
  const closedFace = { ...openFace, leftEye: 0.02, rightEye: 0.02 }

  test("higher aesthetics scores higher", () => {
    const a = assessPhoto(photo(1, { aesthetics: 0.5 }))
    const b = assessPhoto(photo(2, { aesthetics: -0.5 }))
    assert.ok(/** @type {number} */ (a.score) > /** @type {number} */ (b.score))
  })

  test("closed eyes cost a frame, and are flagged", () => {
    const open = assessPhoto(photo(1, { faces: [openFace] }))
    const closed = assessPhoto(photo(2, { faces: [closedFace] }))
    assert.ok(/** @type {number} */ (open.score) > /** @type {number} */ (closed.score))
    assert.equal(closed.eyesClosed, 1)
    assert.ok(closed.flags.includes("eyes-closed"))
    assert.ok(!open.flags.includes("eyes-closed"))
  })

  test("a large sharp face outweighs a small soft one in the background", () => {
    const large = { ...openFace, w: 0.4, quality: 0.9 }
    const small = { ...openFace, w: 0.04, quality: 0.1 }
    const assessed = assessPhoto(photo(1, { faces: [large, small] }))
    assert.ok(/** @type {number} */ (assessed.quality) > 0.8)
  })

  test("a soft main face is flagged", () => {
    const soft = { ...openFace, quality: 0.05 }
    assert.ok(assessPhoto(photo(1, { faces: [soft] })).flags.includes("low-face-quality"))
  })

  test("a utility shot loses to a real frame of the same score", () => {
    const real = assessPhoto(photo(1, { aesthetics: 0.2 }))
    const utility = assessPhoto(photo(2, { aesthetics: 0.2, utility: true }))
    assert.ok(/** @type {number} */ (real.score) > /** @type {number} */ (utility.score))
    assert.ok(utility.flags.includes("utility"))
  })

  test("with nothing to score, the score is null rather than a fake number", () => {
    const assessed = assessPhoto(photo(1, { aesthetics: null, faces: null }))
    assert.equal(assessed.score, null)
    assert.deepEqual(assessed.flags, ["no-scores"])
  })

  test("the best frame is suggested", () => {
    const photos = [photo(1, { aesthetics: 0.1 }), photo(2, { aesthetics: 0.9 }), photo(3)]
    const byId = new Map(photos.map((p) => [p.id, assessPhoto(p)]))
    const { pick, reason } = suggestPick([1, 2, 3], (id) => /** @type {Types.CullAssessment} */ (byId.get(id)))
    assert.equal(pick, 2)
    assert.ok(reason.length > 0)
  })

  test("a tie goes to the earliest frame, so a re-run suggests the same one", () => {
    const photos = [photo(1), photo(2)]
    const byId = new Map(photos.map((p) => [p.id, assessPhoto(p)]))
    assert.equal(suggestPick([1, 2], (id) => /** @type {Types.CullAssessment} */ (byId.get(id))).pick, 1)
  })

  test("with no scores anywhere, the first frame is suggested and says so", () => {
    const photos = [photo(1, { aesthetics: null, faces: null }), photo(2, { aesthetics: null, faces: null })]
    const byId = new Map(photos.map((p) => [p.id, assessPhoto(p)]))
    const { pick, reason } = suggestPick([1, 2], (id) => /** @type {Types.CullAssessment} */ (byId.get(id)))
    assert.equal(pick, 1)
    assert.ok(reason.includes("No scores"))
  })

  test("unscored frames in a scored group do not beat scored ones", () => {
    const photos = [photo(1, { aesthetics: null, faces: null }), photo(2, { aesthetics: -0.9 })]
    const byId = new Map(photos.map((p) => [p.id, assessPhoto(p)]))
    assert.equal(suggestPick([1, 2], (id) => /** @type {Types.CullAssessment} */ (byId.get(id))).pick, 2)
  })
})

describe("buildGroups", () => {
  const photos = [
    photo(1, { folder: "b", t: 0, aesthetics: 0.1 }),
    photo(2, { folder: "b", t: SECOND, aesthetics: 0.8 }),
    photo(3, { folder: "a", t: 500, aesthetics: 0 }),
    photo(4, { folder: "b", t: 3600 * SECOND }),
  ]

  test("a burst never crosses a folder, and folders come in order", () => {
    const { groups } = buildGroups(photos)
    assert.deepEqual(
      groups.map((g) => [g.folder, g.items]),
      [
        ["a", [3]],
        ["b", [1, 2]],
        ["b", [4]],
      ],
    )
  })

  test("every photo lands in exactly one group, and nothing is dropped", () => {
    const { groups } = buildGroups(photos)
    const seen = groups.flatMap((g) => g.items).sort()
    assert.deepEqual(seen, [1, 2, 3, 4])
  })

  test("each group's pick is one of its own frames", () => {
    const { groups } = buildGroups(photos)
    for (const group of groups) assert.ok(group.items.includes(group.pick))
    assert.equal(groups[1].pick, 2)
    assert.equal(groups[1].kind, "burst")
    assert.equal(groups[0].kind, "single")
  })
})

describe("dedupeByHash", () => {
  test("one entry per content, remembering where the copies are", () => {
    /** @param {string} relative @param {string} seed @returns {Types.CullHashedFile} */
    const file = (relative, seed) => ({
      absolute: "/x/" + relative,
      relative,
      sha256: sha(seed),
      kind: "image",
      size: 1,
    })
    const out = dedupeByHash([file("a.jpg", "1"), file("b.jpg", "2"), file("copy-of-a.jpg", "1")])
    assert.equal(out.length, 2)
    assert.equal(out[0].relative, "a.jpg")
    assert.deepEqual(out[0].alsoAt, ["copy-of-a.jpg"])
    assert.deepEqual(out[1].alsoAt, [])
  })
})

describe("liveClipPaths", () => {
  /** @param {string} relative @param {"image" | "video"} kind */
  const entry = (relative, kind) => ({ relative, kind })

  test("a video named like a photo beside it, in any case", () => {
    const clips = liveClipPaths([
      entry("a/IMG_1.HEIC", "image"),
      entry("a/img_1.mov", "video"),
      entry("a/IMG_2.mov", "video"),
    ])
    assert.deepEqual(Array.from(clips), ["a/img_1.mov"])
  })

  test("the same name in another folder is not a pair", () => {
    assert.equal(liveClipPaths([entry("a/IMG_1.jpg", "image"), entry("b/IMG_1.mov", "video")]).size, 0)
  })

  test("a dot in a folder name is not an extension", () => {
    assert.equal(liveClipPaths([entry("a.b/one", "image"), entry("a.mov", "video")]).size, 0)
  })

  test("a photo's copy in another folder still pairs with the clip beside the copy", () => {
    // Dedupe keeps one path per content. The clip sits beside the copy it did not keep.
    /** @param {string} relative @param {string} seed @param {"image" | "video"} kind */
    const hashed = (relative, seed, kind) => ({
      absolute: "/x/" + relative,
      relative,
      sha256: sha(seed),
      kind,
      size: 1,
    })
    const files = dedupeByHash([
      hashed("a/IMG_1.HEIC", "1", "image"),
      hashed("b/IMG_1.HEIC", "1", "image"),
      hashed("b/IMG_1.MOV", "2", "video"),
    ])
    assert.deepEqual(files[0].alsoAt, ["b/IMG_1.HEIC"])
    assert.deepEqual(Array.from(liveClipPaths(files)), ["b/IMG_1.MOV"])
  })

  test("a clip's own copy elsewhere pairs too", () => {
    const clips = liveClipPaths([
      { relative: "b/IMG_2.HEIC", kind: "image" },
      { relative: "a/IMG_2.mov", kind: "video", alsoAt: ["b/IMG_2.mov"] },
    ])
    assert.deepEqual(Array.from(clips), ["a/IMG_2.mov"])
  })

  test("an edited export, IMG_E30, pairs with the clip that kept the original name", () => {
    assert.deepEqual(
      Array.from(liveClipPaths([entry("c/IMG_E30.jpg", "image"), entry("c/IMG_30.mp4", "video")])),
      ["c/IMG_30.mp4"],
    )
    assert.deepEqual(
      Array.from(liveClipPaths([entry("c/img_e7.heic", "image"), entry("c/IMG_E7.MOV", "video")])),
      ["c/IMG_E7.MOV"],
    )
  })

  test("only IMG_E followed by a digit is the edited prefix", () => {
    const event = [entry("IMG_EVENT.jpg", "image"), entry("IMG_VENT.mov", "video")]
    assert.equal(liveClipPaths(event).size, 0)
    assert.equal(liveClipPaths([entry("IMG_E.jpg", "image"), entry("IMG_.mov", "video")]).size, 0)
  })

  test("pairing is a hint only: a paired clip and any other video are both hidden undecided", () => {
    const clip = { ...decidable("clip", "video"), liveClip: true }
    const other = decidable("real", "video")
    for (const video of [clip, other]) {
      assert.equal(isFinallyVisible(video, undefined), false)
      assert.equal(isFinallyVisible(video, "keep"), true)
      assert.equal(isFinallyVisible(video, "hide"), false)
    }
  })

  test("an undecided video counts as an undecided video, not as hidden by the owner", () => {
    const clip = { ...decidable("clip", "video"), liveClip: true }
    assert.deepEqual(summarize([clip, decidable("real", "video")], {}), {
      visiblePhotos: 0,
      visibleVideos: 0,
      hidden: 0,
      undecided: 0,
      undecidedVideos: 2,
    })
  })
})

describe("isSha256Hex", () => {
  test("accepts lowercase hex of exactly 64 characters, and nothing else", () => {
    assert.equal(isSha256Hex(sha("x")), true)
    assert.equal(isSha256Hex(sha("x").toUpperCase()), false)
    assert.equal(isSha256Hex(sha("x").slice(1)), false)
    assert.equal(isSha256Hex("g".repeat(64)), false)
    assert.equal(isSha256Hex(7), false)
  })
})

describe("decisions", () => {
  const a = decidable("a")
  const b = decidable("b")
  const c = decidable("c")
  const members = [a, b, c]

  test("a photo is public only by the owner's say-so", () => {
    assert.equal(isFinallyVisible(a, undefined), false)
    assert.equal(isFinallyVisible(a, "keep"), true)
    assert.equal(isFinallyVisible(a, "hide"), false)
  })

  test("a video is public only by the owner's say-so, exactly like a photo", () => {
    const video = decidable("v", "video")
    assert.equal(isFinallyVisible(video, undefined), false)
    assert.equal(isFinallyVisible(video, "keep"), true)
    assert.equal(isFinallyVisible(video, "hide"), false)
  })

  test("undecided is still possible, and only an explicit hide rules a photo out", () => {
    assert.equal(isStillPossible(undefined), true)
    assert.equal(isStillPossible("keep"), true)
    assert.equal(isStillPossible("hide"), false)
  })

  test("building groups decides nothing: every frame starts undecided", () => {
    // The structural form of "nothing is auto-rejected". Suggestions live on the group,
    // and the only way into `decisions` is acceptGroup, pickOnly or a keypress.
    const { groups } = buildGroups([photo(1, { t: 0 }), photo(2, { t: SECOND })])
    assert.equal(groups[0].items.length, 2)
    assert.equal(Object.hasOwn(groups[0], "decisions"), false)
    assert.equal(groupReviewed([a, b], {}), false)
  })

  test("accepting keeps the suggestion and passes over the rest", () => {
    assert.deepEqual(acceptGroup(members, b.sha, {}), [
      { sha: a.sha, to: "hide" },
      { sha: b.sha, to: "keep" },
      { sha: c.sha, to: "hide" },
    ])
  })

  test("accepting yields to anything the owner already kept", () => {
    assert.deepEqual(acceptGroup(members, b.sha, { [a.sha]: "keep" }), [
      { sha: b.sha, to: "hide" },
      { sha: c.sha, to: "hide" },
    ])
  })

  test("accepting never overwrites an explicit decision", () => {
    const changes = acceptGroup(members, b.sha, { [b.sha]: "hide" })
    assert.deepEqual(changes, [
      { sha: a.sha, to: "hide" },
      { sha: c.sha, to: "hide" },
    ])
  })

  test("accepting a fully decided group changes nothing", () => {
    const decided = /** @type {Types.CullDecisions} */ ({ [a.sha]: "keep", [b.sha]: "hide", [c.sha]: "hide" })
    assert.deepEqual(acceptGroup(members, b.sha, decided), [])
  })

  test("picking overrides the suggestion and leaves other keeps alone", () => {
    assert.deepEqual(pickOnly(members, c.sha, { [a.sha]: "keep" }), [
      { sha: b.sha, to: "hide" },
      { sha: c.sha, to: "keep" },
    ])
  })

  test("picking can bring back a frame that was hidden", () => {
    assert.deepEqual(pickOnly([a], a.sha, { [a.sha]: "hide" }), [{ sha: a.sha, to: "keep" }])
  })

  test("a group is reviewed when every frame has a decision", () => {
    assert.equal(groupReviewed(members, { [a.sha]: "keep", [b.sha]: "hide" }), false)
    assert.equal(groupReviewed(members, { [a.sha]: "keep", [b.sha]: "hide", [c.sha]: "hide" }), true)
  })

  test("summarize counts each item once", () => {
    const video = decidable("v", "video")
    const hiddenVideo = decidable("w", "video")
    const keptVideo = decidable("k", "video")
    assert.deepEqual(
      summarize([a, b, c, video, hiddenVideo, keptVideo], {
        [a.sha]: "keep",
        [b.sha]: "hide",
        [hiddenVideo.sha]: "hide",
        [keptVideo.sha]: "keep",
      }),
      { visiblePhotos: 1, visibleVideos: 1, hidden: 2, undecided: 1, undecidedVideos: 1 },
    )
  })
})

describe("the selection file", () => {
  const kept = decidable("kept")
  const hidden = decidable("hidden")
  const undecided = decidable("undecided")
  const video = decidable("video", "video")
  const dropped = decidable("dropped-video", "video")
  const undecidedVideo = decidable("undecided-video", "video")
  const items = [kept, hidden, undecided, video, dropped, undecidedVideo]
  /** @type {Types.CullDecisions} */
  const decisions = {
    [kept.sha]: "keep",
    [hidden.sha]: "hide",
    [video.sha]: "keep",
    [dropped.sha]: "hide",
  }

  test("is exactly the agreed shape", () => {
    const selection = buildSelection(items, decisions)
    assert.deepEqual(Object.keys(selection), ["version", "visible"])
    assert.equal(selection.version, 1)
  })

  test("lists kept photos and kept videos, and nothing else", () => {
    const { visible } = buildSelection(items, decisions)
    assert.deepEqual(visible, [kept.sha, video.sha].sort())
  })

  test("with nothing decided it lists nothing: no photo and no video goes public by default", () => {
    assert.deepEqual(buildSelection(items, {}).visible, [])
  })

  test("is sorted and free of duplicates, so that equal decisions give equal bytes", () => {
    const one = buildSelection(items, decisions)
    const two = buildSelection(items.slice().reverse(), decisions)
    assert.equal(JSON.stringify(one), JSON.stringify(two))
    assert.deepEqual(buildSelection([kept, kept], decisions).visible, [kept.sha])
  })

  test("carries no path, no name and no person", () => {
    const named = [{ ...kept, rel: "Aunt Rosa/IMG.jpg", name: "Aunt Rosa" }]
    const text = JSON.stringify(buildSelection(named, decisions))
    assert.ok(!text.includes("Rosa"))
    assert.ok(!text.includes("IMG"))
  })

  test("a malformed hash is an error, not a photo quietly dropped", () => {
    assert.throws(() => buildSelection([{ sha: "ABC", kind: "image" }], {}))
  })

  test("parseSelection accepts its own output", () => {
    const text = JSON.stringify(buildSelection(items, decisions))
    const parsed = parseSelection(text)
    assert.ok(parsed.valid)
    assert.deepEqual(parsed.value, buildSelection(items, decisions))
  })

  test("parseSelection refuses anything else", () => {
    for (const bad of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ version: 2, visible: [] }),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ version: 1, visible: ["nope"] }),
    ]) {
      assert.equal(parseSelection(bad).valid, false, bad)
    }
  })

  test("restoring sets exactly what the file means: listed kept, everything else hidden", () => {
    const restored = restoreSelection(items, buildSelection(items, decisions))
    /** @param {Types.CullChange[]} list */
    const sorted = (list) => list.slice().sort((x, y) => (x.sha < y.sha ? -1 : 1))
    assert.deepEqual(
      sorted(restored.changes),
      sorted([
        { sha: kept.sha, to: "keep" },
        { sha: hidden.sha, to: "hide" },
        { sha: undecided.sha, to: "hide" },
        { sha: video.sha, to: "keep" },
        { sha: dropped.sha, to: "hide" },
        { sha: undecidedVideo.sha, to: "hide" },
      ]),
    )
    assert.equal(restored.unknown, 0)
  })

  test("restoring then exporting gives back the same file", () => {
    const file = buildSelection(items, decisions)
    /** @type {Types.CullDecisions} */
    const after = {}
    for (const change of restoreSelection(items, file).changes) after[change.sha] = change.to
    assert.deepEqual(buildSelection(items, after), file)
  })

  test("restoring overrides an earlier keep the file does not list", () => {
    // In a fresh browser a rejected group would otherwise come back undecided, and
    // Enter would keep its suggested frame. Restored, the whole group is reviewed.
    const burst = [decidable("f1"), decidable("f2"), decidable("f3")]
    /** @type {Types.CullDecisions} */
    const restored = {}
    for (const change of restoreSelection(burst, { version: 1, visible: [] }).changes) {
      restored[change.sha] = change.to
    }
    assert.equal(groupReviewed(burst, restored), true)
    assert.deepEqual(acceptGroup(burst, burst[0].sha, restored), [])
    assert.deepEqual(
      restoreSelection([kept], { version: 1, visible: [] }).changes,
      [{ sha: kept.sha, to: "hide" }],
    )
  })

  test("restoring names each item once, however many times it appears", () => {
    assert.equal(restoreSelection([kept, kept], { version: 1, visible: [] }).changes.length, 1)
  })

  test("restoring counts hashes that match nothing here", () => {
    const restored = restoreSelection(items, { version: 1, visible: [sha("elsewhere")] })
    assert.equal(restored.unknown, 1)
  })
})

describe("saved decisions: the log two tabs merge", () => {
  const x = sha("x")
  const y = sha("y")
  const z = sha("z")

  test("the later decision wins, whichever side it is on", () => {
    const merged = mergeDecisionLogs(
      { [x]: { d: "keep", at: 10 }, [y]: { d: "hide", at: 30 } },
      { [x]: { d: "hide", at: 20 }, [y]: { d: "keep", at: 25 }, [z]: { d: "keep", at: 5 } },
    )
    assert.deepEqual(merged.log, {
      [x]: { d: "hide", at: 20 },
      [y]: { d: "hide", at: 30 },
      [z]: { d: "keep", at: 5 },
    })
    assert.deepEqual(merged.changed.sort(), [x, z].sort())
  })

  test("a stale copy merged in changes nothing", () => {
    /** @type {Types.CullDecisionLog} */
    const fresh = { [x]: { d: "keep", at: 50 } }
    /** @type {Types.CullDecisionLog} */
    const stale = { [x]: { d: "hide", at: 40 } }
    assert.deepEqual(mergeDecisionLogs(fresh, stale), { log: fresh, changed: [] })
  })

  test("a return to undecided is a decision too, so an older keep cannot revive it", () => {
    const merged = mergeDecisionLogs({ [x]: { d: null, at: 60 } }, { [x]: { d: "keep", at: 50 } })
    assert.deepEqual(merged.log[x], { d: null, at: 60 })
    assert.deepEqual(decisionsFromLog(merged.log), {})
  })

  test("a tie goes to whichever leaves the item less public", () => {
    /** @param {Types.CullDecision | null} a @param {Types.CullDecision | null} b */
    const tie = (a, b) => mergeDecisionLogs({ [x]: { d: a, at: 7 } }, { [x]: { d: b, at: 7 } }).log[x].d
    assert.equal(tie("keep", "hide"), "hide")
    assert.equal(tie("hide", "keep"), "hide")
    assert.equal(tie("keep", null), null)
    assert.equal(tie(null, "hide"), "hide")
  })

  test("merging is order-independent, so two tabs converge on one state", () => {
    /** @type {Types.CullDecisionLog} */
    const one = { [x]: { d: "keep", at: 3 }, [y]: { d: "hide", at: 9 } }
    /** @type {Types.CullDecisionLog} */
    const two = { [x]: { d: "hide", at: 3 }, [y]: { d: null, at: 8 }, [z]: { d: "keep", at: 1 } }
    assert.deepEqual(mergeDecisionLogs(one, two).log, mergeDecisionLogs(two, one).log)
  })

  test("the stored form round-trips, and an absent store is empty", () => {
    /** @type {Types.CullDecisionLog} */
    const log = { [x]: { d: "keep", at: 1 }, [y]: { d: null, at: 2 }, [z]: { d: "hide", at: 0 } }
    const parsed = parseDecisionLog(serializeDecisionLog(log))
    assert.ok(parsed.valid)
    assert.deepEqual(parsed.value, log)
    assert.deepEqual(parseDecisionLog(null), { valid: true, value: {} })
  })

  test("a malformed store is an error, never a partial log", () => {
    for (const bad of [
      "{",
      "null",
      JSON.stringify({ version: 1, decisions: {} }),
      JSON.stringify({ version: 2, log: [] }),
      JSON.stringify({ version: 2, log: { nothex: ["keep", 1] } }),
      JSON.stringify({ version: 2, log: { [x]: ["maybe", 1] } }),
      JSON.stringify({ version: 2, log: { [x]: ["keep", -1] } }),
      JSON.stringify({ version: 2, log: { [x]: ["keep"] } }),
    ]) {
      assert.equal(parseDecisionLog(bad).valid, false, bad)
    }
  })

  test("the first version's store is read, and anything odd in it left out", () => {
    const decisions = { [x]: "keep", [y]: "hide", nope: "keep", [z]: 3 }
    const text = JSON.stringify({ decisions, cursor: x, frame: 2 })
    assert.deepEqual(parseLegacyDecisions(text), { [x]: "keep", [y]: "hide" })
    assert.equal(parseLegacyDecisions("not json"), null)
    assert.equal(parseLegacyDecisions(JSON.stringify({ cursor: x })), null)
  })

  test("first-version decisions fill gaps, stamped oldest, and never beat a newer one", () => {
    /** @type {Types.CullDecisionLog} */
    const log = { [x]: { d: "hide", at: 100 }, [y]: { d: null, at: 100 } }
    const brought = importLegacyDecisions(log, [{ [x]: "keep", [y]: "keep", [z]: "keep" }])
    assert.deepEqual(brought.log, {
      [x]: { d: "hide", at: 100 },
      [y]: { d: null, at: 100 },
      [z]: { d: "keep", at: 0 },
    })
    assert.equal(brought.imported, 1)
    assert.equal(brought.conflicts, 0)
  })

  test("importing the same old store twice brings nothing the second time", () => {
    const once = importLegacyDecisions({}, [{ [x]: "keep" }])
    assert.equal(once.imported, 1)
    assert.equal(importLegacyDecisions(once.log, [{ [x]: "keep" }]).imported, 0)
  })

  test("two old stores that disagree are a counted conflict, resolved to hidden", () => {
    const brought = importLegacyDecisions({}, [
      { [x]: "keep", [y]: "keep" },
      { [x]: "hide", [y]: "keep" },
    ])
    assert.deepEqual(brought.log[x], { d: "hide", at: 0 })
    assert.deepEqual(brought.log[y], { d: "keep", at: 0 })
    assert.equal(brought.conflicts, 1)
    const reversed = importLegacyDecisions({}, [{ [x]: "hide" }, { [x]: "keep" }])
    assert.equal(reversed.log[x].d, "hide")
  })

  test("an old store that disagrees with an old decision already brought in is a conflict", () => {
    // Two tabs of the previous version, saving one after the other as each reloads.
    const first = importLegacyDecisions({}, [{ [x]: "keep" }])
    const second = importLegacyDecisions(first.log, [{ [x]: "hide" }])
    assert.equal(second.conflicts, 1)
    assert.deepEqual(second.log[x], { d: "hide", at: 0 })
    // Against a decision made on the new page, an old one is simply older: no conflict.
    const newer = importLegacyDecisions({ [x]: { d: "keep", at: 5 } }, [{ [x]: "hide" }])
    assert.equal(newer.conflicts, 0)
    assert.deepEqual(newer.log[x], { d: "keep", at: 5 })
  })

  test("the storage keys hold no path: one store serves every directory", () => {
    assert.equal(CULL_STORE_KEY.includes("/"), false)
    assert.equal(CULL_CURSOR_KEY.includes("/"), false)
    assert.ok(CULL_LEGACY_PREFIX.startsWith("cull:v1"))
  })
})

describe("faceIsGood", () => {
  const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }

  test("an unrated face counts as good: no evidence against the photo", () => {
    assert.equal(faceIsGood(box, null), true)
    assert.equal(faceIsGood(box, []), true)
  })

  test("a scored face elsewhere in the frame is not this person's", () => {
    const elsewhere = { x: 0.7, y: 0.7, w: 0.2, h: 0.2, quality: 0.01 }
    assert.equal(faceIsGood(box, [elsewhere]), true)
  })

  test("the overlapping face decides", () => {
    assert.equal(faceIsGood(box, [{ ...box, quality: 0.9, px: 400, leftEye: 0.4 }]), true)
    assert.equal(faceIsGood(box, [{ ...box, quality: 0.01, px: 400, leftEye: 0.4 }]), false)
    assert.equal(faceIsGood(box, [{ ...box, quality: 0.9, px: 400, leftEye: 0.01 }]), false)
  })
})

describe("buildPeople", () => {
  const photos = [
    { id: 0, sha256: sha("p0"), width: 100, height: 100 },
    { id: 1, sha256: sha("p1"), width: 200, height: 100 },
    { id: 2, sha256: sha("outside"), width: 100, height: 100 },
  ]
  const box = { x: 20, y: 20, w: 20, h: 20 }
  /** @param {number} id @param {number} photoId */
  const face = (id, photoId) => ({ id, photoId, box })
  /** @param {string} s @returns {number | null} */
  const itemForSha = (s) => (s === sha("p0") ? 10 : s === sha("p1") ? 11 : null)
  const base = {
    notAFace: "x",
    photos,
    itemForSha,
    scoredFaces: () => null,
    names: null,
  }

  test("joins label to person and face to photo to item, by content hash", () => {
    const people = buildPeople({
      ...base,
      labels: { 1: "p1", 2: "p1", 3: "p2" },
      faces: [face(1, 0), face(2, 1), face(3, 1)],
    })
    assert.deepEqual(
      people.map((p) => [p.key, p.name, p.photos]),
      [
        [
          "p1",
          null,
          [
            [10, 1],
            [11, 1],
          ],
        ],
        ["p2", null, [[11, 1]]],
      ],
    )
  })

  test("not-a-face and unlabelled faces are nobody", () => {
    const people = buildPeople({
      ...base,
      labels: { 1: "x" },
      faces: [face(1, 0), face(2, 0)],
    })
    assert.deepEqual(people, [])
  })

  test("a photo outside this directory joins to nothing", () => {
    const people = buildPeople({ ...base, labels: { 1: "p1" }, faces: [face(1, 2)] })
    assert.deepEqual(people, [])
  })

  test("twice in one photo is one photo, good if either face is", () => {
    const people = buildPeople({
      ...base,
      labels: { 1: "p1", 2: "p1" },
      faces: [
        { id: 1, photoId: 0, box: { x: 20, y: 20, w: 20, h: 20 } },
        { id: 2, photoId: 0, box: { x: 60, y: 60, w: 20, h: 20 } },
      ],
      scoredFaces: () => [{ x: 0.2, y: 0.2, w: 0.2, h: 0.2, quality: 0.01 }],
    })
    assert.deepEqual(people[0].photos, [[10, 1]])
  })

  test("boxes are compared in normalised frames, not in each file's pixels", () => {
    // Photo 1 is 200 wide, so its box is x 0.1-0.2 and matches the soft scored face.
    const people = buildPeople({
      ...base,
      labels: { 1: "p1" },
      faces: [face(1, 1)],
      scoredFaces: () => [{ x: 0.1, y: 0.2, w: 0.1, h: 0.2, quality: 0.01 }],
    })
    assert.deepEqual(people[0].photos, [[11, 0]])
  })

  test("names come only from the identities map, and sort the list", () => {
    const people = buildPeople({
      ...base,
      labels: { 1: "p1", 2: "p2" },
      faces: [face(1, 0), face(2, 0)],
      names: new Map([
        ["p1", "Zed"],
        ["p2", "Abe"],
      ]),
    })
    assert.deepEqual(
      people.map((p) => p.name),
      ["Abe", "Zed"],
    )
  })
})

describe("the coverage warning", () => {
  /** @type {Types.CullPerson[]} */
  const people = [
    {
      key: "p1",
      name: "Fictional One",
      photos: [
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 0],
      ],
    },
    { key: "p2", name: "Fictional Two", photos: [[5, 1]] },
    { key: "p3", name: null, photos: [[6, 0]] },
  ]
  const minGood = 3
  const everything = () => true
  /** @param {number[]} gone @returns {(item: number) => boolean} */
  const except = (gone) => (item) => !gone.includes(item)

  test("counts visible and good photos separately", () => {
    assert.deepEqual(coverageCounts(people, except([3, 4]))[0], {
      key: "p1",
      name: "Fictional One",
      visible: 2,
      good: 2,
      total: 4,
    })
  })

  test("warns when a rejection takes someone below the minimum", () => {
    const warnings = coverageWarnings(people, everything, except([1]), minGood)
    assert.deepEqual(
      warnings.map((w) => [w.key, w.good, w.visible, w.level]),
      [["p1", 2, 3, "few"]],
    )
  })

  test("says when the last visible photo goes", () => {
    const warnings = coverageWarnings(people, everything, except([5]), minGood)
    assert.equal(warnings[0].key, "p2")
    assert.equal(warnings[0].level, "none")
  })

  test("says when the visible photos left are not good ones", () => {
    const warnings = coverageWarnings(people, everything, except([1, 2, 3]), minGood)
    assert.deepEqual(
      warnings.map((w) => [w.key, w.good, w.visible, w.level]),
      [["p1", 0, 1, "no-good"]],
    )
  })

  test("is silent when the person still has enough", () => {
    assert.deepEqual(coverageWarnings(people, everything, except([1]), 2), [])
  })

  test("is silent about photos the person is not in, however short they are", () => {
    assert.deepEqual(coverageWarnings(people, except([]), except([99]), minGood), [])
  })

  test("is silent when the photo lost was not a good one", () => {
    assert.deepEqual(coverageWarnings(people, everything, except([4]), minGood), [])
  })

  test("is silent when a change brings a photo back", () => {
    assert.deepEqual(coverageWarnings(people, except([1]), everything, minGood), [])
  })

  test("a bulk rejection reports everyone it cost", () => {
    const warnings = coverageWarnings(people, everything, except([1, 5]), minGood)
    assert.deepEqual(
      warnings.map((w) => w.key),
      ["p1", "p2"],
    )
  })

  test("the shortfall list before an export is everyone short, worst first", () => {
    const short = coverageShortfalls(people, everything, minGood)
    assert.deepEqual(
      short.map((w) => w.key),
      ["p3", "p2"],
    )
    assert.equal(short[0].level, "no-good")
    assert.deepEqual(coverageShortfalls(people, everything, 0), [])
  })

  test("no labels means no warnings, not an error", () => {
    assert.deepEqual(coverageWarnings([], everything, except([1]), minGood), [])
    assert.deepEqual(coverageShortfalls([], everything, minGood), [])
  })
})

describe("parseCullArgs", () => {
  test("the photo directory is required, and exactly one", () => {
    assert.equal(parseCullArgs([]).valid, false)
    assert.equal(parseCullArgs(["a", "b"]).valid, false)
  })

  test("defaults write under tmp/cull", () => {
    const parsed = parseCullArgs(["photos"])
    assert.ok(parsed.valid)
    assert.equal(parsed.value.outDir, path.resolve("tmp/cull"))
    assert.equal(parsed.value.labels, null)
    assert.equal(parsed.value.defaults.minGoodPhotos, CULL_DEFAULTS.minGoodPhotos)
  })

  test("everything derived stays under a tmp directory", () => {
    const parsed = parseCullArgs(["photos", "--out", "docs/cull"])
    assert.equal(parsed.valid, false)
    if (!parsed.valid) assert.ok(parsed.error.includes("tmp"))
  })

  test("identities alone mean nothing without labels", () => {
    assert.equal(parseCullArgs(["photos", "--identities", "i.json"]).valid, false)
    assert.equal(parseCullArgs(["photos", "--run", "r"]).valid, false)
  })

  test("--run defaults to the directory holding the labels", () => {
    const parsed = parseCullArgs(["photos", "--labels", "some/run/labels.json"])
    assert.ok(parsed.valid)
    assert.equal(parsed.value.run, path.resolve("some/run"))
  })

  test("numeric flags are scaled into the defaults and validated", () => {
    const parsed = parseCullArgs(["photos", "--burst-gap", "5", "--min-good=2", "--similar-distance", "0.1"])
    assert.ok(parsed.valid)
    assert.equal(parsed.value.defaults.burstGapMs, 5000)
    assert.equal(parsed.value.defaults.minGoodPhotos, 2)
    assert.equal(parsed.value.defaults.similarDistance, 0.1)
    assert.equal(parseCullArgs(["photos", "--burst-gap", "soon"]).valid, false)
    assert.equal(parseCullArgs(["photos", "--min-good", "1.5"]).valid, false)
  })

  test("an unknown flag is refused rather than ignored", () => {
    assert.equal(parseCullArgs(["photos", "--search-home"]).valid, false)
  })
})

describe("decodeFeaturePrint", () => {
  test("reads little-endian float32 and float64", () => {
    const f32 = Buffer.alloc(8)
    f32.writeFloatLE(0.5, 0)
    f32.writeFloatLE(-0.25, 4)
    assert.deepEqual(
      decodeFeaturePrint({ type: "float32", count: 2, b64: f32.toString("base64") }),
      [0.5, -0.25],
    )
    const f64 = Buffer.alloc(8)
    f64.writeDoubleLE(0.1, 0)
    assert.deepEqual(decodeFeaturePrint({ type: "float64", count: 1, b64: f64.toString("base64") }), [0.1])
  })

  test("a truncated or absent print is null, never a short vector", () => {
    assert.equal(decodeFeaturePrint({ type: "float32", count: 3, b64: "AAAAAA==" }), null)
    assert.equal(decodeFeaturePrint(undefined), null)
  })
})

describe("classicScript", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "../../scripts/vision/cull-logic.js"),
    "utf8",
  )

  test("the logic module stays loadable: no imports, only plain exports", () => {
    assert.doesNotThrow(() => classicScript(source, Object.keys(logic)))
  })

  test("the page runs the same code the tests run", () => {
    const script = classicScript(source, Object.keys(logic))
    const sandbox = /** @type {{ window: { CullLogic?: typeof logic } }} */ ({ window: {} })
    vm.runInNewContext(script, sandbox)
    const page = /** @type {typeof logic} */ (sandbox.window.CullLogic)
    assert.deepEqual(Object.keys(page).sort(), Object.keys(logic).sort())

    const items = [decidable("a"), decidable("b"), decidable("v", "video")]
    /** @type {Types.CullDecisions} */
    const decisions = { [sha("a")]: "keep" }
    assert.equal(
      JSON.stringify(page.buildSelection(items, decisions)),
      JSON.stringify(buildSelection(items, decisions)),
    )
    const photos = [photo(1, { t: 0 }), photo(2, { t: SECOND }), photo(3, { t: 90 * SECOND })]
    assert.equal(JSON.stringify(page.groupFolder(photos)), JSON.stringify(groupFolder(photos)))
  })

  test("refuses source the transform cannot handle", () => {
    assert.throws(() => classicScript('import x from "y"\n', []))
    assert.throws(() => classicScript("export { x }\n", []))
    assert.throws(() => classicScript("export default 1\n", []))
  })
})

describe("cull.html", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "../../scripts/vision/cull.html"), "utf8")

  test("cannot reach the network, and says so to the browser", () => {
    assert.ok(page.includes("Content-Security-Policy"))
    assert.ok(page.includes("default-src 'none'"))
    assert.ok(page.includes("connect-src 'none'"))
    for (const banned of ["http://", "https://", "fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "import("]) {
      assert.ok(!page.includes(banned), banned)
    }
  })

  test("uses no regex", () => {
    for (const banned of ["RegExp", ".match(", ".matchAll(", ".test(", ".replace(/", ".split(/"]) {
      assert.ok(!page.includes(banned), banned)
    }
  })

  test("leaves the deciding, and the merging, to the shared logic", () => {
    for (const name of [
      "buildSelection",
      "coverageWarnings",
      "acceptGroup",
      "restoreSelection",
      "mergeDecisionLogs",
      "importLegacyDecisions",
      "CULL_STORE_KEY",
    ]) {
      assert.ok(page.includes("L." + name), name)
    }
  })

  test("hears other tabs, and keys storage by nothing but the shared constants", () => {
    assert.ok(page.includes('addEventListener("storage"'))
    assert.ok(!page.includes('"cull:v1:" +'), "no store keyed by the directory's path")
  })

  test("never builds markup from data", () => {
    assert.ok(!page.includes("innerHTML"))
    assert.ok(!page.includes("insertAdjacentHTML"))
    assert.ok(!page.includes("document.write"))
  })
})

describe("readScores", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cull-scores-"))
  after(() => fs.rmSync(root, { recursive: true, force: true }))

  test("the latest row and meta win, and a truncated line is counted", () => {
    const file = path.join(root, "scores.jsonl")
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ kind: "meta", version: 1, root: "/old", os: "x", apis: {} }),
        JSON.stringify({ kind: "image", rel: "a.jpg", aesthetics: 0.1 }),
        JSON.stringify({ kind: "meta", version: 1, root: "/new", os: "x", apis: {} }),
        JSON.stringify({ kind: "image", rel: "a.jpg", aesthetics: 0.9 }),
        '{"kind":"image","rel":"b.j',
      ].join("\n"),
    )
    const scores = readScores(file)
    assert.equal(scores.present, true)
    assert.equal(scores.skipped, 1)
    assert.equal(scores.meta?.root, "/new")
    assert.equal(scores.rows.get("a.jpg")?.aesthetics, 0.9)
    assert.equal(scores.rows.size, 1)
  })

  test("a missing file is absent, not an error", () => {
    const scores = readScores(path.join(root, "nope.jsonl"))
    assert.equal(scores.present, false)
    assert.equal(scores.rows.size, 0)
  })

  test("rows join across Unicode normal forms", () => {
    const file = path.join(root, "nfd.jsonl")
    fs.writeFileSync(file, JSON.stringify({ kind: "image", rel: "café.jpg" }) + "\n")
    assert.ok(readScores(file).rows.has("café.jpg"))
  })
})

describe("buildPageData", () => {
  /** @param {string} relative @param {"image" | "video"} [kind] */
  const file = (relative, kind = "image") => ({
    absolute: "/photos/" + relative,
    relative,
    sha256: sha(relative),
    kind,
    size: 5,
    alsoAt: /** @type {string[]} */ ([]),
  })

  test("a file with no scores is listed anyway", () => {
    const data = buildPageData({
      files: [file("a/one.jpg")],
      rows: new Map(),
      meta: null,
      rootId: "r",
      defaults: CULL_DEFAULTS,
      toUrl: (absolute) => "file://" + absolute,
      people: () => null,
    })
    assert.equal(data.items.length, 1)
    assert.equal(data.groups.length, 1)
    assert.equal(data.items[0].thumb, null)
    assert.deepEqual(data.items[0].flags, ["no-scores"])
    assert.equal(data.people, null)
  })

  test("videos are listed apart, ungrouped and unscored", () => {
    const data = buildPageData({
      files: [file("clip.mov", "video"), file("one.jpg")],
      rows: new Map([["clip.mov", { kind: "video", rel: "clip.mov", size: 5, mtimeMs: 0, thumb: "thumbs/1.jpg" }]]),
      meta: null,
      rootId: "r",
      defaults: CULL_DEFAULTS,
      toUrl: (absolute) => "file://" + absolute,
      people: () => null,
    })
    assert.deepEqual(data.videos, [0])
    assert.deepEqual(data.groups.flatMap((g) => g.items), [1])
    assert.equal(data.items[0].score, null)
    assert.equal(data.items[0].thumb, "thumbs/1.jpg")
    assert.deepEqual(data.items[0].flags, [])
  })

  test("a copy that was the only one scored still supplies the scores", () => {
    const entry = { ...file("a.jpg"), alsoAt: ["copy/a.jpg"] }
    const data = buildPageData({
      files: [entry],
      rows: new Map([["copy/a.jpg", { kind: "image", rel: "copy/a.jpg", size: 5, mtimeMs: 0, aesthetics: 0.5 }]]),
      meta: null,
      rootId: "r",
      defaults: CULL_DEFAULTS,
      toUrl: (absolute) => "file://" + absolute,
      people: () => null,
    })
    assert.equal(data.items[0].aesthetics, 0.5)
  })

  test("the top level is its own folder", () => {
    const data = buildPageData({
      files: [file("one.jpg"), file("sub/two.jpg")],
      rows: new Map(),
      meta: null,
      rootId: "r",
      defaults: CULL_DEFAULTS,
      toUrl: (absolute) => "file://" + absolute,
      people: () => null,
    })
    assert.deepEqual(
      data.groups.map((g) => g.folder),
      ["", "sub"],
    )
  })
})

describe("runCullData, on synthetic files", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cull-run-"))
  const photos = path.join(scratch, "photos")
  // A directory literally named tmp, which is what the output guard asks for.
  const outDir = path.join(scratch, "tmp", "cull")
  after(() => fs.rmSync(scratch, { recursive: true, force: true }))

  const bytes = { one: makeJpeg(200), two: makePng(300), clip: makeMp4(400) }
  fs.mkdirSync(path.join(photos, "reception"), { recursive: true })
  fs.writeFileSync(path.join(photos, "one.jpg"), bytes.one)
  fs.writeFileSync(path.join(photos, "reception", "two.png"), bytes.two)
  fs.writeFileSync(path.join(photos, "reception", "copy of one.jpg"), bytes.one)
  fs.writeFileSync(path.join(photos, "clip.mp4"), bytes.clip)
  fs.writeFileSync(path.join(photos, "notes.txt"), "not media")

  /** @param {Partial<Types.CullDataArgs>} [overrides] @returns {Types.CullDataArgs} */
  const args = (overrides = {}) => ({
    dir: photos,
    outDir,
    labels: null,
    identities: null,
    run: null,
    defaults: CULL_DEFAULTS,
    ...overrides,
  })
  /** @type {string[]} */
  const lines = []
  const deps = { log: (/** @type {string} */ line) => void lines.push(line) }

  test("hashes exactly as the importer does", async () => {
    const { data } = await runCullData(args(), deps)
    for (const [name, buffer] of [
      ["one.jpg", bytes.one],
      ["reception/two.png", bytes.two],
      ["clip.mp4", bytes.clip],
    ]) {
      const item = data.items.find((i) => i.rel === name)
      assert.ok(item, String(name))
      const independent = crypto.createHash("sha256").update(buffer).digest("hex")
      assert.equal(item.sha, independent, "the sha256 of the file's raw bytes")
      assert.equal(item.sha, await hashFile(path.join(photos, String(name))), "hashFile agrees")
      assert.ok(isSha256Hex(item.sha))
    }
  })

  test("identical bytes are one item, and non-media is ignored", async () => {
    const { data, skipped } = await runCullData(args(), deps)
    assert.equal(data.items.length, 3)
    assert.equal(skipped, 1)
    const one = data.items.find((i) => i.rel === "one.jpg")
    assert.deepEqual(one?.alsoAt, ["reception/copy of one.jpg"])
  })

  test("nothing lands in visible with no decision, not even a video", async () => {
    const { data } = await runCullData(args(), deps)
    assert.deepEqual(buildSelection(data.items, {}).visible, [])
    const clip = crypto.createHash("sha256").update(bytes.clip).digest("hex")
    assert.deepEqual(buildSelection(data.items, { [clip]: "keep" }).visible, [clip])
  })

  test("writes the page, the logic and the data, as file:// URLs", async () => {
    const { data, target } = await runCullData(args(), deps)
    assert.equal(target, path.join(outDir, "cull.html"))
    for (const name of ["cull.html", "cull-logic.classic.js", "cull-page-data.js"]) {
      assert.ok(fs.existsSync(path.join(outDir, name)), name)
    }
    for (const item of data.items) assert.ok(item.url.startsWith("file:///"))

    const sandbox = /** @type {{ window: { CULL_DATA?: Types.CullPageData } }} */ ({ window: {} })
    vm.runInNewContext(fs.readFileSync(path.join(outDir, "cull-page-data.js"), "utf8"), sandbox)
    assert.equal(sandbox.window.CULL_DATA?.items.length, data.items.length)
  })

  test("a path with spaces survives into its URL", async () => {
    const spaced = path.join(scratch, "with space")
    fs.mkdirSync(spaced)
    fs.writeFileSync(path.join(spaced, "a # b.jpg"), bytes.one)
    const { data } = await runCullData(args({ dir: spaced }), deps)
    assert.ok(data.items[0].url.includes("with%20space"))
    assert.ok(data.items[0].url.includes("a%20%23%20b.jpg"))
  })

  test("an empty directory is an error rather than an empty page", async () => {
    const empty = path.join(scratch, "empty")
    fs.mkdirSync(empty)
    await assert.rejects(runCullData(args({ dir: empty }), deps))
  })

  test("scores join by path, and an unavailable API is reported", async () => {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(
      path.join(outDir, "scores.jsonl"),
      [
        JSON.stringify({
          kind: "meta",
          version: 1,
          root: fs.realpathSync(photos),
          os: "test",
          apis: { aesthetics: { available: false, note: "requires macOS 15" } },
        }),
        JSON.stringify({
          kind: "image",
          rel: "one.jpg",
          size: 200,
          mtimeMs: 0,
          aesthetics: 0.25,
          faces: [],
          thumb: "thumbs/000001.jpg",
          captured: "2025:06:14 17:02:11",
        }),
      ].join("\n") + "\n",
    )
    lines.length = 0
    const { data } = await runCullData(args(), deps)
    const one = data.items.find((i) => i.rel === "one.jpg")
    assert.equal(one?.aesthetics, 0.25)
    assert.equal(one?.thumb, "thumbs/000001.jpg")
    assert.equal(data.apis.aesthetics.available, false)
    assert.ok(lines.some((line) => line.includes("aesthetics") && line.includes("macOS 15")))
    fs.rmSync(path.join(outDir, "scores.jsonl"))
  })

  describe("with a labels file", () => {
    const run = path.join(scratch, "run")
    fs.mkdirSync(run)
    const oneSha = crypto.createHash("sha256").update(bytes.one).digest("hex")
    const twoSha = crypto.createHash("sha256").update(bytes.two).digest("hex")
    const faces = [
      { id: 0, photoId: 0, box: { x: 10, y: 10, w: 20, h: 20 } },
      { id: 1, photoId: 1, box: { x: 10, y: 10, w: 20, h: 20 } },
    ]
    const datasetId = computeDatasetId(/** @type {Types.Session1FaceRecord[]} */ (/** @type {unknown} */ (faces)))
    fs.writeFileSync(
      path.join(run, "faces.jsonl"),
      faces.map((face) => JSON.stringify(face)).join("\n") + "\n",
    )
    fs.writeFileSync(
      path.join(run, "photos.jsonl"),
      [
        { id: 0, sha256: oneSha, width: 100, height: 100 },
        { id: 1, sha256: twoSha, width: 100, height: 100 },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    )
    const labelsFile = path.join(run, "labels.json")
    fs.writeFileSync(labelsFile, JSON.stringify({ version: 2, datasetId, labels: { 0: "p7", 1: "x" }, pool: {} }))
    const identitiesFile = path.join(run, "identities.json")
    fs.writeFileSync(
      identitiesFile,
      JSON.stringify({
        version: 1,
        datasetId,
        identities: { p7: { guestId: null, name: "Fictional Guest" } },
      }),
    )

    test("works with opaque keys when there is no identities file", async () => {
      const { data } = await runCullData(args({ labels: labelsFile, run }), deps)
      assert.deepEqual(data.people?.map((p) => [p.key, p.name]), [["p7", null]])
      const text = fs.readFileSync(path.join(outDir, "cull-page-data.js"), "utf8")
      assert.ok(!text.includes("Fictional Guest"))
    })

    test("names reach the page's data, and only the page's data", async () => {
      lines.length = 0
      const { data } = await runCullData(args({ labels: labelsFile, identities: identitiesFile, run }), deps)
      assert.equal(data.people?.[0].name, "Fictional Guest")
      assert.ok(fs.readFileSync(path.join(outDir, "cull-page-data.js"), "utf8").includes("Fictional Guest"))
      assert.ok(!lines.join("\n").includes("Fictional Guest"), "never printed")
      assert.ok(!fs.readFileSync(path.join(outDir, "cull.html"), "utf8").includes("Fictional Guest"))
      assert.ok(!fs.readFileSync(path.join(outDir, "cull-logic.classic.js"), "utf8").includes("Fictional Guest"))
      assert.ok(!JSON.stringify(buildSelection(data.items, {})).includes("Fictional Guest"))
    })

    test("a labels file from another run is refused, not joined", () => {
      const wrong = path.join(run, "wrong.json")
      fs.writeFileSync(wrong, JSON.stringify({ version: 2, datasetId: "0".repeat(16), labels: {}, pool: {} }))
      assert.throws(
        () => loadPeopleInput({ labels: wrong, identities: null, run }),
        (err) => err instanceof Error && err.message.includes("different run"),
      )
    })

    test("an identities file from another export is refused", () => {
      const wrong = path.join(run, "wrong-identities.json")
      fs.writeFileSync(wrong, JSON.stringify({ version: 1, datasetId: "f".repeat(16), identities: {} }))
      assert.throws(
        () => loadPeopleInput({ labels: labelsFile, identities: wrong, run }),
        (err) => err instanceof Error && err.message.includes("does not belong"),
      )
    })

    test("a labels file with no run beside it says which file is missing", () => {
      const elsewhere = path.join(scratch, "elsewhere")
      fs.mkdirSync(elsewhere)
      assert.throws(
        () => loadPeopleInput({ labels: labelsFile, identities: null, run: elsewhere }),
        (err) => err instanceof Error && err.message.includes("faces.jsonl: not found"),
      )
    })

    test("a malformed labels file is an error that quotes nothing from it", () => {
      const broken = path.join(run, "broken.json")
      fs.writeFileSync(broken, '{"labels": {"1": "Fictional Guest"')
      assert.throws(
        () => loadPeopleInput({ labels: broken, identities: null, run }),
        (err) => err instanceof Error && !err.message.includes("Fictional"),
      )
    })

    test("no labels file means no people, and the page still builds", () => {
      assert.equal(loadPeopleInput({ labels: null, identities: null, run: null }), null)
    })
  })
})
