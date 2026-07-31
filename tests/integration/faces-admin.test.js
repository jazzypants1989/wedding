/**
 * @file Integration tests for admin face-assignment
 * (docs/post-wedding/SPEC-vision-lab.md §10/§15): every route requires admin
 * auth, the on-demand grouping/matching over synthetic descriptors, the
 * assign/unassign/not-a-face mutations, and — the load-bearing privacy check —
 * that a descriptor never appears in any response body.
 */
// MUST be first: sets TEST_SERVER_PORT before ../helpers.js reads it.
import "./_faces-admin-port.js"

/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import crypto from "node:crypto"
import {
  startServer,
  stopServer,
  getTestDb,
  createTestGuest,
  adminLogin,
  adminFetch,
  BASE_URL,
} from "../helpers.js"
import { descriptorToBlob } from "../../db/media-faces.js"

/** @type {DatabaseSync} */
let db

const hasAdmin = !!process.env.TEST_ADMIN_PASSWORD

/** @param {Response} res */
async function json(res) {
  return /** @type {any} */ (await res.json().catch(() => ({})))
}

/** @type {{ cookieHeader: string, csrfToken: string } | null} */
let admin = null

/** Admin action fetch (no-op skips are guarded by hasAdmin at call sites). */
/** @param {string} path @param {RequestInit} [options] */
function asAdmin(path, options = {}) {
  return adminFetch(path, /** @type {any} */ (options), /** @type {any} */ (admin))
}

/** This test file owns its own isolated DB (a fresh temp file per test-file
 *  process — see helpers.js's TEST_DB_PATH), so a blanket wipe between tests
 *  is safe and simpler than filtering by a marker. */
function resetFaceTestData() {
  db.prepare(`DELETE FROM media_faces`).run()
  db.prepare(`DELETE FROM face_identities`).run()
  db.prepare(`DELETE FROM media`).run()
  db.prepare(`DELETE FROM guests`).run()
}

/** @returns {number} */
function seedMedia() {
  const fileKey = crypto.randomBytes(16).toString("hex")
  const r = db
    .prepare(`INSERT INTO media (file_key, kind, section, status) VALUES (?, 'image', 'guest', 'approved')`)
    .run(fileKey)
  return Number(r.lastInsertRowid)
}

const MODEL_VERSION = "v-test"

/**
 * @param {number} mediaId
 * @param {number[]} vector
 * @param {{ box?: { x: number, y: number, w: number, h: number }, modelVersion?: string }} [opts]
 * @returns {number}
 */
function seedFace(mediaId, vector, opts = {}) {
  const blob = descriptorToBlob(Float32Array.from(vector))
  const box = opts.box ?? { x: 10, y: 20, w: 50, h: 50 }
  const modelVersion = opts.modelVersion ?? MODEL_VERSION
  const r = db
    .prepare(
      `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, descriptor, model_version, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cli')`,
    )
    .run(mediaId, box.x, box.y, box.w, box.h, blob, modelVersion)
  return Number(r.lastInsertRowid)
}

/** @param {Record<string, unknown>} [overrides] @returns {number} */
function seedGuest(overrides = {}) {
  const guest = createTestGuest(db, overrides)
  return Number(guest.id)
}

// Two tight clusters, well separated: cluster A hugs the x-axis, cluster B the
// y-axis. Cosine distance within a cluster is near 0; across clusters it's
// near 1 — comfortably above both group.cutoff (0.45) and assign.sameBandCutoff
// (0.64), so grouping and the `unlocks` band never confuse the two people.
const CLUSTER_A1 = [1, 0.02, 0, 0]
const CLUSTER_A2 = [1, -0.02, 0.01, 0]
const CLUSTER_B1 = [0.02, 1, 0, 0]
const CLUSTER_B2 = [-0.01, 1, 0.02, 0]

/** No response from this API may ever carry a descriptor. */
/** @param {unknown} body */
function assertNoDescriptor(body) {
  const text = JSON.stringify(body).toLowerCase()
  assert.ok(!text.includes("descriptor"), "response body must never mention a descriptor")
}

before(async () => {
  await startServer()
  db = getTestDb()
  if (hasAdmin) {
    const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    admin = { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
  }
})

after(async () => {
  await stopServer()
})

beforeEach(() => {
  resetFaceTestData()
})

describe("admin auth is required on every route", () => {
  it("401s GET /api/admin/faces/overview with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/overview`)
    assert.strictEqual(res.status, 401)
  })

  it("401s GET /api/admin/faces/queue with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/queue`)
    assert.strictEqual(res.status, 401)
  })

  it("401s POST /api/admin/faces/assign with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [1], guestId: 1 }),
    })
    assert.strictEqual(res.status, 401)
  })

  it("401s POST /api/admin/faces/unassign with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/unassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [1] }),
    })
    assert.strictEqual(res.status, 401)
  })

  it("401s POST /api/admin/faces/not-a-face with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/not-a-face`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [1] }),
    })
    assert.strictEqual(res.status, 401)
  })

  it("401s GET /api/admin/media/:id/faces with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/media/1/faces`)
    assert.strictEqual(res.status, 401)
  })

  it("401s GET /api/admin/faces/propagations with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/propagations`)
    assert.strictEqual(res.status, 401)
  })

  it("401s POST /api/admin/faces/propagate with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/propagate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toFaceIds: [1] }),
    })
    assert.strictEqual(res.status, 401)
  })
})

describe("face chips carry what a client-side crop needs", () => {
  it("overview and queue rows ride fileKey + original dimensions alongside the box", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const mediaId = seedMedia()
    db.prepare(`UPDATE media SET width = 4000, height = 3000 WHERE id = ?`).run(mediaId)
    const faceId = seedFace(mediaId, CLUSTER_A1)

    const ov = await json(await asAdmin("/api/admin/faces/overview"))
    const chip = ov.groups[0].media[0]
    assert.strictEqual(chip.faceId, faceId)
    assert.ok(chip.fileKey, "a chip without a fileKey renders no image at all")
    // Boxes are in ORIGINAL pixels; without these the crop cannot be scaled to
    // the thumb variant and the UI silently shows the whole photograph.
    assert.strictEqual(chip.width, 4000)
    assert.strictEqual(chip.height, 3000)
    assertNoDescriptor(ov)
  })
})

describe("naming two groups the same guest merges them", () => {
  it("both groups end up on ONE confirmed identity, so no separate merge action is needed", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    // Deliberate over-splitting (SPEC §6.4) means one person can appear as two
    // groups. Because assign() finds-or-creates a single confirmed identity per
    // guest, naming both with the same guest is already the merge.
    const faceA = seedFace(seedMedia(), CLUSTER_A1)
    const faceB = seedFace(seedMedia(), CLUSTER_B1)
    const guestId = seedGuest({ name: "Split Across Groups" })

    for (const faceId of [faceA, faceB]) {
      const res = await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceId], guestId }),
      })
      assert.strictEqual(res.status, 200)
    }

    const identities = /** @type {any[]} */ (
      db.prepare(`SELECT id FROM face_identities WHERE guest_id = ? AND deleted_at IS NULL`).all(guestId)
    )
    assert.strictEqual(identities.length, 1, "a second naming must reuse the first identity, not create another")

    const faces = /** @type {any[]} */ (
      db.prepare(`SELECT DISTINCT face_identity_id AS id FROM media_faces WHERE id IN (?, ?)`).all(faceA, faceB)
    )
    assert.strictEqual(faces.length, 1, "both faces point at the same identity")
    assert.strictEqual(faces[0].id, identities[0].id)
  })
})

describe("must-link propagation across near-duplicate frames", () => {
  /** Two media rows sharing one frame root — a burst, as the CLI would record it. */
  function seedBurst() {
    const a = seedMedia()
    const b = seedMedia()
    db.prepare(`UPDATE media SET frame_root_sha256 = 'frame-1' WHERE id IN (?, ?)`).run(a, b)
    return { a, b }
  }

  it("proposes carrying a confirmed identity onto the same box in the next frame, and applying it never seeds a prototype", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const { a, b } = seedBurst()
    const box = { x: 10, y: 10, w: 100, h: 100 }
    const sourceFace = seedFace(a, CLUSTER_A1, { box })
    const targetFace = seedFace(b, CLUSTER_A2, { box: { x: 12, y: 12, w: 100, h: 100 } })

    const guestId = seedGuest({ name: "Burst Guest" })
    const assigned = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [sourceFace], guestId }),
    })
    assert.strictEqual(assigned.status, 200)

    const listed = await asAdmin("/api/admin/faces/propagations")
    assert.strictEqual(listed.status, 200)
    const body = await json(listed)
    assertNoDescriptor(body)
    assert.strictEqual(body.items.length, 1)
    assert.strictEqual(body.items[0].fromFaceId, sourceFace)
    assert.strictEqual(body.items[0].toFaceId, targetFace)
    assert.strictEqual(body.items[0].guestName, "Burst Guest")

    const applied = await asAdmin("/api/admin/faces/propagate", {
      method: "POST",
      body: JSON.stringify({ toFaceIds: [targetFace] }),
    })
    assert.strictEqual(applied.status, 200)
    assert.strictEqual((await json(applied)).changed, 1)

    // The target now carries a PROPAGATED identity for the same guest — never
    // the confirmed one, or it would seed a prototype and reinforce itself.
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT fi.provenance AS provenance, fi.guest_id AS guest_id
             FROM media_faces mf JOIN face_identities fi ON fi.id = mf.face_identity_id
            WHERE mf.id = ?`,
        )
        .get(targetFace)
    )
    assert.strictEqual(row.provenance, "propagated")
    assert.strictEqual(row.guest_id, guestId)
  })

  it("proposes nothing when the two photos are not in one frame class", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const a = seedMedia()
    const b = seedMedia()
    db.prepare(`UPDATE media SET frame_root_sha256 = 'frame-a' WHERE id = ?`).run(a)
    db.prepare(`UPDATE media SET frame_root_sha256 = 'frame-b' WHERE id = ?`).run(b)
    const box = { x: 10, y: 10, w: 100, h: 100 }
    const sourceFace = seedFace(a, CLUSTER_A1, { box })
    seedFace(b, CLUSTER_A2, { box })

    const guestId = seedGuest({ name: "Unrelated Frames" })
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [sourceFace], guestId }),
    })

    const listed = await asAdmin("/api/admin/faces/propagations")
    assert.deepStrictEqual((await json(listed)).items, [])
  })

  it("refuses to propagate onto a face that is not a current proposal", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const { a, b } = seedBurst()
    const box = { x: 10, y: 10, w: 100, h: 100 }
    const sourceFace = seedFace(a, CLUSTER_A1, { box })
    // Descriptors disagree, so rule 3 suppresses: geometry alone is not enough.
    const targetFace = seedFace(b, CLUSTER_B1, { box })

    const guestId = seedGuest({ name: "Disagreeing Descriptor" })
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [sourceFace], guestId }),
    })

    const listed = await asAdmin("/api/admin/faces/propagations")
    assert.deepStrictEqual((await json(listed)).items, [])

    const applied = await asAdmin("/api/admin/faces/propagate", {
      method: "POST",
      body: JSON.stringify({ toFaceIds: [targetFace] }),
    })
    assert.strictEqual(applied.status, 400)
  })
})

describe("overview + queue: on-demand grouping and matching", () => {
  it("groups two tight clusters, largest-first, with no suggestion before anyone is confirmed", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const mediaA1 = seedMedia()
    const mediaA2 = seedMedia()
    const mediaB1 = seedMedia()
    const mediaB2 = seedMedia()
    const faceA1 = seedFace(mediaA1, CLUSTER_A1)
    const faceA2 = seedFace(mediaA2, CLUSTER_A2)
    const faceB1 = seedFace(mediaB1, CLUSTER_B1)
    const faceB2 = seedFace(mediaB2, CLUSTER_B2)

    const res = await asAdmin("/api/admin/faces/overview")
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assertNoDescriptor(body)

    assert.strictEqual(body.counts.faces, 4)
    assert.strictEqual(body.counts.unidentified, 4)
    assert.strictEqual(body.counts.identified, 0)
    assert.strictEqual(body.counts.notAFace, 0)

    assert.strictEqual(body.groups.length, 2, "two clusters -> two groups")
    for (const group of body.groups) {
      assert.strictEqual(group.suggestion, null, "no identity confirmed yet -> no suggestion")
      assert.strictEqual(group.media.length, group.faceIds.length)
    }
    const sizes = body.groups.map((/** @type {any} */ g) => g.faceIds.length).sort()
    assert.deepStrictEqual(sizes, [2, 2])

    const groupA = body.groups.find((/** @type {any} */ g) => g.faceIds.includes(faceA1))
    assert.ok(groupA, "cluster A's group is present")
    assert.deepStrictEqual([...groupA.faceIds].sort((a, b) => a - b), [faceA1, faceA2].sort((a, b) => a - b))
    const mediaIdsInA = groupA.media.map((/** @type {any} */ m) => m.mediaId).sort()
    assert.deepStrictEqual(mediaIdsInA, [mediaA1, mediaA2].sort())

    const groupB = body.groups.find((/** @type {any} */ g) => g.faceIds.includes(faceB1))
    assert.ok(groupB)
    assert.ok(groupB.faceIds.includes(faceB2))

    // The queue has nobody to ask about yet — zero confirmed identities means
    // zero prototypes in this model_version bucket.
    const q = await asAdmin("/api/admin/faces/queue")
    const qBody = await json(q)
    assertNoDescriptor(qBody)
    assert.strictEqual(qBody.items.length, 0)
    assert.strictEqual(qBody.truncated, false)
  })

  it("after one face is confirmed, every group gets a prototype suggestion and the queue ranks by unlocks", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const guestA = seedGuest({ name: "Guest A" })
    const mediaA1 = seedMedia()
    const mediaA2 = seedMedia()
    const mediaB1 = seedMedia()
    const mediaB2 = seedMedia()
    const faceA1 = seedFace(mediaA1, CLUSTER_A1)
    const faceA2 = seedFace(mediaA2, CLUSTER_A2)
    const faceB1 = seedFace(mediaB1, CLUSTER_B1)
    const faceB2 = seedFace(mediaB2, CLUSTER_B2)

    const assignRes = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [faceA1], guestId: guestA }),
    })
    assert.strictEqual(assignRes.status, 200)
    const assignBody = await json(assignRes)
    assertNoDescriptor(assignBody)
    assert.strictEqual(assignBody.success, true)
    assert.strictEqual(assignBody.changed, 1)
    const identityId = assignBody.identityId
    assert.ok(identityId)

    const overview = await json(await asAdmin("/api/admin/faces/overview"))
    assertNoDescriptor(overview)
    assert.strictEqual(overview.counts.identified, 1)
    assert.strictEqual(overview.counts.unidentified, 3)
    // faceA1 left its group; the remaining groups are {faceA2} and {faceB1,faceB2}.
    assert.strictEqual(overview.groups.length, 2)
    for (const group of overview.groups) {
      assert.ok(group.suggestion, "a confirmed identity exists, so every group gets a suggestion")
      assert.strictEqual(group.suggestion.guestId, guestA)
    }

    const queue = await json(await asAdmin("/api/admin/faces/queue"))
    assertNoDescriptor(queue)
    assert.strictEqual(queue.items.length, 3)
    for (const item of queue.items) {
      assert.ok(item.candidates.length >= 1)
      assert.strictEqual(item.candidates[0].guestId, guestA)
    }
    // Sorted by unlocks, descending.
    for (let i = 1; i < queue.items.length; i++) {
      assert.ok(queue.items[i - 1].unlocks >= queue.items[i].unlocks)
    }
    const byFaceId = new Map(queue.items.map((/** @type {any} */ it) => [it.faceId, it]))
    // faceA2 is alone in its band (its only clustermate, faceA1, is now
    // identified and excluded from the unidentified pool) -> unlocks 1.
    assert.strictEqual(byFaceId.get(faceA2).unlocks, 1)
    // faceB1/faceB2 are still a pair -> unlocks 2 each, and rank above faceA2.
    assert.strictEqual(byFaceId.get(faceB1).unlocks, 2)
    assert.strictEqual(byFaceId.get(faceB2).unlocks, 2)
    assert.ok(byFaceId.get(faceB1).unlocks > byFaceId.get(faceA2).unlocks)

    // Assigning the same guest again reuses the SAME confirmed identity.
    const again = await json(
      await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceIds: [faceA2], guestId: guestA }),
      }),
    )
    assert.strictEqual(again.identityId, identityId)
  })
})

describe("assign / unassign / not-a-face mutations", () => {
  it("assigns a batch to a new guest, then unassigns", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const guestB = seedGuest({ name: "Guest B" })
    const mediaB1 = seedMedia()
    const mediaB2 = seedMedia()
    const faceB1 = seedFace(mediaB1, CLUSTER_B1)
    const faceB2 = seedFace(mediaB2, CLUSTER_B2)

    const assignRes = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [faceB1, faceB2], guestId: guestB }),
    })
    assert.strictEqual(assignRes.status, 200)
    const assignBody = await json(assignRes)
    assert.strictEqual(assignBody.changed, 2)

    const perPhoto = await json(await asAdmin(`/api/admin/media/${mediaB1}/faces`))
    assertNoDescriptor(perPhoto)
    assert.strictEqual(perPhoto.faces.length, 1)
    assert.strictEqual(perPhoto.faces[0].faceId, faceB1)
    assert.strictEqual(perPhoto.faces[0].guestId, guestB)
    assert.strictEqual(perPhoto.faces[0].guestName, "Guest B")
    assert.deepStrictEqual(perPhoto.faces[0].box, { x: 10, y: 20, w: 50, h: 50 })

    const unassignRes = await asAdmin("/api/admin/faces/unassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [faceB1] }),
    })
    assert.strictEqual(unassignRes.status, 200)
    const unassignBody = await json(unassignRes)
    assert.strictEqual(unassignBody.changed, 1)

    const afterUnassign = await json(await asAdmin(`/api/admin/media/${mediaB1}/faces`))
    assert.strictEqual(afterUnassign.faces[0].guestId, null)
    assert.strictEqual(afterUnassign.faces[0].guestName, null)

    // The other face is untouched.
    const stillAssigned = await json(await asAdmin(`/api/admin/media/${mediaB2}/faces`))
    assert.strictEqual(stillAssigned.faces[0].guestId, guestB)
  })

  it("not-a-face soft-deletes the row and it drops out of counts/overview", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const media = seedMedia()
    const faceId = seedFace(media, CLUSTER_A1)

    const before = await json(await asAdmin("/api/admin/faces/overview"))
    assert.strictEqual(before.counts.faces, 1)
    assert.strictEqual(before.counts.notAFace, 0)

    const res = await asAdmin("/api/admin/faces/not-a-face", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [faceId] }),
    })
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.strictEqual(body.changed, 1)

    const after = await json(await asAdmin("/api/admin/faces/overview"))
    assert.strictEqual(after.counts.faces, 0)
    assert.strictEqual(after.counts.unidentified, 0)
    assert.strictEqual(after.counts.notAFace, 1)
    assert.strictEqual(after.groups.length, 0)

    const row = /** @type {any} */ (
      db.prepare(`SELECT deleted_at FROM media_faces WHERE id = ?`).get(faceId)
    )
    assert.ok(row.deleted_at, "soft-deleted, not hard-deleted")
  })

  it("rejects a batch referencing a missing face id", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const guest = seedGuest({ name: "Ghost" })
    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [999999], guestId: guest }),
    })
    assert.strictEqual(res.status, 404)
  })

  it("rejects assign to a missing guest", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia()
    const faceId = seedFace(media, CLUSTER_A1)
    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [faceId], guestId: 999999 }),
    })
    assert.strictEqual(res.status, 404)
  })

  it("rejects an empty faceIds array", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const guest = seedGuest({ name: "Empty" })
    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [], guestId: guest }),
    })
    assert.strictEqual(res.status, 400)
  })
})

describe("GET /api/admin/media/:id/faces", () => {
  it("404s for a missing or deleted media row", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const res = await asAdmin("/api/admin/media/999999/faces")
    assert.strictEqual(res.status, 404)
  })

  it("returns an empty list for a photo with no faces", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia()
    const body = await json(await asAdmin(`/api/admin/media/${media}/faces`))
    assert.deepStrictEqual(body.faces, [])
  })
})
