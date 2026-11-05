/**
 * @file Black-and-white twins at the database layer: the add_media_twins
 * triggers, pairing and unpairing, the candidate query the scan reads, and the
 * rule that a twin is never an item of its own — not in a feed, a count, a
 * comment target, the curated set, or the Faces queues.
 */

import { describe, it, before, beforeEach, after } from "node:test"
import assert from "node:assert"

import { init, close, getDb } from "../../../db/connection.js"
import {
  countApprovedGuestMedia,
  countPendingMedia,
  getCuratedMediaForAdmin,
  getCuratedMediaIds,
  getGuestContributors,
  getMediaFeed,
  getMediaFeedRowById,
  listGuestMediaByReactions,
  moveCuratedMedia,
} from "../../../db/media.js"
import {
  countMediaWithoutCaptureTime,
  fillMediaCapturedAt,
  getLiveTwinOf,
  pairTwin,
  releaseTwinsOfRemoved,
  twinCandidateRows,
  twinPickOptions,
  unpairTwin,
} from "../../../db/media-twins.js"
import {
  countSetAsideMedia,
  descriptorToBlob,
  facesForPropagation,
  insertFace,
  setAsideMedia,
  unidentifiedFacesWithDescriptors,
} from "../../../db/media-faces.js"
import { getModerationQueue } from "../../../db/moderation.js"
import { isTargetVisible } from "../../../db/targets.js"

/** An `assert.throws` matcher built from string methods (no regex in this repo).
 *  @param {string} needle */
function messageIncludes(needle) {
  /** @param {unknown} err @returns {boolean} */
  return (err) => err instanceof Error && err.message.includes(needle)
}

const SHOT = "2026-04-26 17:03:12"
let keySeq = 0

/**
 * @param {{ section?: string, status?: string, kind?: string, capturedAt?: string | null,
 *   width?: number, height?: number, accountId?: number | null }} [opts]
 * @returns {number}
 */
function makeMedia(opts = {}) {
  keySeq++
  return Number(
    getDb()
      .prepare(
        `INSERT INTO media (file_key, account_id, kind, section, status, width, height,
           captured_at, original_ext)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'jpg')`,
      )
      .run(
        `twinkey${String(keySeq).padStart(25, "0")}`,
        opts.accountId ?? null,
        opts.kind ?? "image",
        opts.section ?? "official",
        opts.status ?? "approved",
        opts.width ?? 1600,
        opts.height ?? 1067,
        opts.capturedAt === undefined ? SHOT : opts.capturedAt,
      ).lastInsertRowid,
  )
}

/** @param {string} name @returns {number} */
function makeAccount(name) {
  return Number(
    getDb()
      .prepare(`INSERT INTO accounts (name, name_normalized, trusted) VALUES (?, ?, 1)`)
      .run(name, name.toLowerCase()).lastInsertRowid,
  )
}

/** @param {number} id @returns {import("../../../types.js").Media} */
function rowOf(id) {
  return /** @type {import("../../../types.js").Media} */ (
    /** @type {unknown} */ (getDb().prepare("SELECT * FROM media WHERE id = ?").get(id))
  )
}

/** @param {number} id @param {number | null} twinOf */
function setTwinOf(id, twinOf) {
  getDb().prepare("UPDATE media SET twin_of = ? WHERE id = ?").run(twinOf, id)
}

function clearData() {
  const db = getDb()
  db.prepare("DELETE FROM media_faces").run()
  db.prepare("DELETE FROM face_identities").run()
  db.prepare("DELETE FROM people").run()
  db.prepare("UPDATE media SET twin_of = NULL").run()
  db.prepare("DELETE FROM media").run()
  db.prepare("DELETE FROM accounts").run()
}

describe("black-and-white twins (db)", () => {
  before(() => init())
  beforeEach(() => clearData())
  after(() => {
    clearData()
    close()
  })

  describe("the add_media_twins triggers", () => {
    it("a new row can't be born a twin", () => {
      const primary = makeMedia()
      assert.throws(
        () =>
          getDb()
            .prepare(
              `INSERT INTO media (file_key, kind, section, status, twin_of)
               VALUES ('bornatwin00000000000000000000000', 'image', 'official', 'approved', ?)`,
            )
            .run(primary),
        messageIncludes("cannot be a twin"),
      )
    })

    it("refuses a self-pair, a video, a twin of a twin, and a primary becoming a twin", () => {
      const a = makeMedia()
      const b = makeMedia()
      const c = makeMedia()
      const video = makeMedia({ kind: "video" })
      assert.throws(() => setTwinOf(a, a), messageIncludes("Invalid twin"))
      assert.throws(() => setTwinOf(video, a), messageIncludes("Invalid twin"))
      assert.throws(() => setTwinOf(a, video), messageIncludes("Invalid twin"))
      setTwinOf(b, a)
      assert.throws(() => setTwinOf(c, b), messageIncludes("Invalid twin"), "one level deep")
      assert.throws(() => setTwinOf(a, c), messageIncludes("Invalid twin"), "a primary stays one")
    })

    it("allows one live twin per primary", () => {
      const a = makeMedia()
      const b = makeMedia()
      const c = makeMedia()
      setTwinOf(b, a)
      assert.throws(() => setTwinOf(c, a), messageIncludes("UNIQUE"))
    })

    it("refuses a deleted primary", () => {
      const a = makeMedia()
      const b = makeMedia()
      getDb().prepare("UPDATE media SET deleted_at = '2026-05-01' WHERE id = ?").run(a)
      assert.throws(() => setTwinOf(b, a), messageIncludes("Invalid twin"))
    })
  })

  describe("pairing", () => {
    it("pairTwin, getLiveTwinOf, unpairTwin round-trip, and the twin keeps its status", () => {
      const a = makeMedia()
      const b = makeMedia({ status: "hidden" })
      assert.strictEqual(pairTwin(a, b), true)
      assert.strictEqual(getLiveTwinOf(a)?.id, b)
      assert.strictEqual(unpairTwin(a), 1)
      assert.strictEqual(getLiveTwinOf(a), undefined)
      const row = /** @type {{ status: string, twin_of: number | null }} */ (
        getDb().prepare("SELECT status, twin_of FROM media WHERE id = ?").get(b)
      )
      assert.deepStrictEqual({ ...row }, { status: "hidden", twin_of: null })
    })

    it("pairTwin refuses a rejected or in-flight copy", () => {
      const a = makeMedia()
      assert.strictEqual(pairTwin(a, makeMedia({ status: "rejected" })), false)
      assert.strictEqual(pairTwin(a, makeMedia({ status: "uploading" })), false)
    })

    it("removing the primary releases an approved copy as hidden, never public", () => {
      const a = makeMedia()
      const b = makeMedia({ status: "approved" })
      pairTwin(a, b)
      assert.strictEqual(releaseTwinsOfRemoved(a), 1)
      const row = /** @type {{ status: string, twin_of: number | null }} */ (
        getDb().prepare("SELECT status, twin_of FROM media WHERE id = ?").get(b)
      )
      assert.deepStrictEqual({ ...row }, { status: "hidden", twin_of: null })
    })

    it("moving the primary between curated sections takes the copy along", () => {
      const a = makeMedia()
      const b = makeMedia({ status: "hidden" })
      pairTwin(a, b)
      assert.strictEqual(moveCuratedMedia(a, "honeymoon"), true)
      const row = /** @type {{ section: string }} */ (
        getDb().prepare("SELECT section FROM media WHERE id = ?").get(b)
      )
      assert.strictEqual(row.section, "honeymoon")
    })
  })

  describe("candidates", () => {
    it("groups unpaired images by capture second, size and section", () => {
      const a = makeMedia()
      const b = makeMedia({ status: "hidden" })
      makeMedia({ capturedAt: "2026-04-26 17:03:13" }) // a different second
      makeMedia({ width: 1067, height: 1600 }) // a different shape
      makeMedia({ section: "honeymoon" }) // a different section
      makeMedia({ capturedAt: null }) // no capture time
      makeMedia({ kind: "video" })
      makeMedia({ status: "rejected" })
      const ids = twinCandidateRows(100).map((r) => r.id)
      assert.deepStrictEqual(ids, [a, b])
    })

    it("a pair already made is no longer offered", () => {
      const a = makeMedia()
      const b = makeMedia()
      const c = makeMedia()
      pairTwin(a, b)
      assert.deepStrictEqual(
        twinCandidateRows(100).map((r) => r.id),
        [],
        "c alone can't pair with a primary that already has a copy",
      )
      const options = twinPickOptions(rowOf(c), 10)
      assert.ok(!options.some((r) => r.id === a || r.id === b), "nor by hand")
    })

    it("the by-hand picker puts the metadata match first", () => {
      const a = makeMedia()
      makeMedia({ capturedAt: "2020-01-01 00:00:00" })
      const twin = makeMedia({ status: "hidden" })
      makeMedia({ section: "guest" })
      const options = twinPickOptions(rowOf(a), 10)
      assert.strictEqual(options[0].id, twin)
      assert.ok(options.every((o) => o.section === "official"))
    })

    it("fillMediaCapturedAt only fills a gap", () => {
      const a = makeMedia({ capturedAt: null })
      assert.strictEqual(countMediaWithoutCaptureTime(), 1)
      assert.strictEqual(fillMediaCapturedAt(a, SHOT), true)
      assert.strictEqual(fillMediaCapturedAt(a, "2020-01-01 00:00:00"), false)
      assert.strictEqual(countMediaWithoutCaptureTime(), 0)
    })
  })

  describe("a twin is never an item of its own", () => {
    it("leaves every feed, count and target gate, while its primary stays", () => {
      const account = makeAccount("Twin Guest")
      const primary = makeMedia({ section: "guest", accountId: account })
      const twin = makeMedia({ section: "guest", accountId: account })
      const pendingTwinOwner = makeMedia({
        section: "guest",
        accountId: account,
        status: "pending",
      })
      pairTwin(primary, twin)
      const pendingTwin = makeMedia({ section: "guest", accountId: account, status: "pending" })
      pairTwin(pendingTwinOwner, pendingTwin)

      const feed = getMediaFeed({ callerId: account, section: "guest", limit: 50 })
      assert.ok(feed.some((r) => r.id === primary))
      assert.ok(!feed.some((r) => r.id === twin || r.id === pendingTwin), "feed")
      const carried = feed.find((r) => r.id === primary)?.twin_id
      assert.strictEqual(carried, twin, "the primary carries it")

      assert.strictEqual(getMediaFeedRowById(twin, account), undefined, "deep link")
      assert.strictEqual(isTargetVisible("media", twin, account), false, "comment/reaction target")
      assert.strictEqual(isTargetVisible("media", primary, account), true)
      assert.ok(!listGuestMediaByReactions(50).some((r) => r.id === twin), "most loved")
      assert.strictEqual(getGuestContributors().photos, 1, "contributors count the pair once")
      assert.strictEqual(countApprovedGuestMedia(), 1, "landing count")
      assert.strictEqual(countPendingMedia(), 1, "pending badge counts the pending primary only")
      const queue = getModerationQueue({ status: "pending", limit: 50, offset: 0 })
      assert.ok(!queue.some((r) => r.id === pendingTwin), "review queue")
    })

    it("leaves the curated set reorder names, riding on its primary instead", () => {
      const a = makeMedia()
      const b = makeMedia({ status: "hidden" })
      const c = makeMedia()
      pairTwin(a, b)
      assert.deepStrictEqual(getCuratedMediaIds("official"), [a, c])
      const rows = getCuratedMediaForAdmin("official")
      assert.deepStrictEqual(
        rows.map((r) => r.id),
        [a, c],
      )
      assert.strictEqual(rows[0].twin_id, b)
      assert.strictEqual(rows[1].twin_id, null)
    })

    it("a rejected copy is not offered on its primary", () => {
      const a = makeMedia()
      const b = makeMedia({ status: "hidden" })
      pairTwin(a, b)
      getDb().prepare("UPDATE media SET status = 'rejected' WHERE id = ?").run(b)
      const row = getMediaFeed({ section: "official", limit: 10 }).find((r) => r.id === a)
      assert.strictEqual(row?.twin_id, null)
    })
  })

  describe("Faces leaves a twin's faces out", () => {
    /** @param {number} mediaId @param {string | null} route */
    function face(mediaId, route = null) {
      return insertFace({
        mediaId,
        bbox: { x: 1, y: 2, w: 100, h: 120 },
        landmarks: null,
        signals: null,
        descriptor: descriptorToBlob(Float32Array.from([1, 0, 0, 0])),
        modelVersion: "test-v1",
        source: "cli",
        route: /** @type {any} */ (route ? { state: route, reason: null, profile: "test" } : null),
      })
    }

    it("from the groups, the Ask queue, the leftovers and same-moment propagation", () => {
      const a = makeMedia()
      const b = makeMedia({ status: "hidden" })
      const primaryFace = face(a, "set_aside")
      const twinFace = face(b, "set_aside")
      getDb()
        .prepare("UPDATE media SET frame_root_sha256 = 'frame-one' WHERE id IN (?, ?)")
        .run(a, b)
      const before = unidentifiedFacesWithDescriptors().map((f) => f.id)
      assert.deepStrictEqual(before, [primaryFace.id, twinFace.id], "unpaired: both")
      assert.strictEqual(countSetAsideMedia(), 2)
      assert.strictEqual(facesForPropagation("test-v1").length, 2)

      pairTwin(a, b)
      assert.deepStrictEqual(
        unidentifiedFacesWithDescriptors().map((f) => f.id),
        [primaryFace.id],
        "groups + Ask queue",
      )
      assert.deepStrictEqual(
        setAsideMedia({ limit: 10, offset: 0 }).map((r) => r.media_id),
        [a],
        "leftovers",
      )
      assert.strictEqual(countSetAsideMedia(), 1)
      assert.strictEqual(facesForPropagation("test-v1").length, 0, "no multi-photo frame left")
    })
  })
})
