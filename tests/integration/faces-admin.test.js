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
  createTestPerson,
  adminLogin,
  adminFetch,
  BASE_URL,
} from "../helpers.js"
import { descriptorToBlob } from "../../db/media-faces.js"
// The ledger, loaded into THIS process against the same database file the
// server is using — see _faces-admin-port.js for how that path is arranged, and
// why it has to happen there rather than here. Only its read/replay side and
// `revokeBatch` are used; every mutation below still goes through the HTTP API,
// which is the point of asserting any of it.
import { init as initDb, close as closeDb } from "../../db/connection.js"
import { replayFace, resolveIdentity, revokeBatch } from "../../db/face-assignments.js"

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
  // Ledger first: face_assignments references media_faces ON DELETE CASCADE,
  // so it would go anyway — but batches would not, and a batch surviving into
  // the next test is a revoked/unrevoked flag nobody set.
  db.prepare(`DELETE FROM face_assignments`).run()
  db.prepare(`DELETE FROM face_assignment_batches`).run()
  db.prepare(`DELETE FROM media_faces`).run()
  db.prepare(`DELETE FROM face_identities`).run()
  db.prepare(`DELETE FROM media`).run()
  db.prepare(`DELETE FROM people`).run()
  db.prepare(`DELETE FROM guests`).run()
}

/** `width`/`height` default to NULL, which is the real shape of a row imported
 *  before dimensions were recorded — and the case the per-photograph view has to
 *  degrade for, since a box is in ORIGINAL source pixels and without them there
 *  is no scale to place it against.
 *  @param {{ width?: number, height?: number }} [opts] @returns {number} */
function seedMedia(opts = {}) {
  const fileKey = crypto.randomBytes(16).toString("hex")
  const r = db
    .prepare(
      `INSERT INTO media (file_key, kind, section, status, width, height)
       VALUES (?, 'image', 'guest', 'approved', ?, ?)`,
    )
    .run(fileKey, opts.width ?? null, opts.height ?? null)
  return Number(r.lastInsertRowid)
}

const MODEL_VERSION = "v-test"

/**
 * @param {number} mediaId
 * @param {number[]} vector
 * @param {{ box?: { x: number, y: number, w: number, h: number }, modelVersion?: string, route?: string | null }} [opts]
 * @returns {number}
 */
function seedFace(mediaId, vector, opts = {}) {
  const blob = descriptorToBlob(Float32Array.from(vector))
  const box = opts.box ?? { x: 10, y: 20, w: 50, h: 50 }
  const modelVersion = opts.modelVersion ?? MODEL_VERSION
  // `route` defaults to undefined -> NULL, which is the state every row written
  // before the add_face_routing migration is in. Most tests below leave it that
  // way on purpose: ungraded must keep working, or the Faces tab breaks on
  // exactly the rows that exist today.
  const route = opts.route ?? null
  const r = db
    .prepare(
      `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, descriptor, model_version, source,
                                route_state, route_profile)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cli', ?, ?)`,
    )
    .run(mediaId, box.x, box.y, box.w, box.h, blob, modelVersion, route, route === null ? null : "route-test")
  return Number(r.lastInsertRowid)
}

/** A person in the photographed cast — what faces are actually assigned to.
 *  Off-roster by default (no guests row), which is the case the people table
 *  exists for.
 *  @param {Record<string, unknown>} [overrides] @returns {number} */
function seedPerson(overrides = {}) {
  return createTestPerson(db, overrides).id
}

/** Attach a face to a person through an identity of a given provenance. Raw SQL
 *  rather than the db/ helpers because those would open a second connection to
 *  the server's database from the test process.
 *  @param {number} faceId @param {number} personId
 *  @param {'confirmed' | 'propagated'} provenance @returns {number} */
function seedIdentityFor(faceId, personId, provenance) {
  const r = db
    .prepare(`INSERT INTO face_identities (person_id, provenance) VALUES (?, ?)`)
    .run(personId, provenance)
  const identityId = Number(r.lastInsertRowid)
  db.prepare(`UPDATE media_faces SET face_identity_id = ? WHERE id = ?`).run(identityId, faceId)
  return identityId
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
  initDb()
  if (hasAdmin) {
    const a = await adminLogin(process.env.TEST_ADMIN_PASSWORD)
    admin = { cookieHeader: a.cookieHeader, csrfToken: a.csrfToken }
  }
})

after(async () => {
  closeDb()
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
      body: JSON.stringify({ faceIds: [1], personId: 1 }),
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

describe("naming two groups the same person merges them", () => {
  it("both groups end up on ONE confirmed identity, so no separate merge action is needed", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    // Deliberate over-splitting (SPEC §6.4) means one person can appear as two
    // groups. Because assign() finds-or-creates a single confirmed identity per
    // person, naming both with the same person is already the merge.
    const faceA = seedFace(seedMedia(), CLUSTER_A1)
    const faceB = seedFace(seedMedia(), CLUSTER_B1)
    const personId = seedPerson({ display_name: "Split Across Groups" })

    for (const faceId of [faceA, faceB]) {
      const res = await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceId], personId }),
      })
      assert.strictEqual(res.status, 200)
    }

    const identities = /** @type {any[]} */ (
      db.prepare(`SELECT id FROM face_identities WHERE person_id = ? AND deleted_at IS NULL`).all(personId)
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

    const personId = seedPerson({ display_name: "Burst Guest" })
    const assigned = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [sourceFace], personId }),
    })
    assert.strictEqual(assigned.status, 200)

    const listed = await asAdmin("/api/admin/faces/propagations")
    assert.strictEqual(listed.status, 200)
    const body = await json(listed)
    assertNoDescriptor(body)
    assert.strictEqual(body.items.length, 1)
    assert.strictEqual(body.items[0].fromFaceId, sourceFace)
    assert.strictEqual(body.items[0].toFaceId, targetFace)
    assert.strictEqual(body.items[0].personName, "Burst Guest")

    const applied = await asAdmin("/api/admin/faces/propagate", {
      method: "POST",
      body: JSON.stringify({ toFaceIds: [targetFace] }),
    })
    assert.strictEqual(applied.status, 200)
    assert.strictEqual((await json(applied)).changed, 1)

    // The target now carries a PROPAGATED identity for the same person — never
    // the confirmed one, or it would seed a prototype and reinforce itself.
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT fi.provenance AS provenance, fi.person_id AS person_id
             FROM media_faces mf JOIN face_identities fi ON fi.id = mf.face_identity_id
            WHERE mf.id = ?`,
        )
        .get(targetFace)
    )
    assert.strictEqual(row.provenance, "propagated")
    assert.strictEqual(row.person_id, personId)
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

    const personId = seedPerson({ display_name: "Unrelated Frames" })
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [sourceFace], personId }),
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

    const personId = seedPerson({ display_name: "Disagreeing Descriptor" })
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [sourceFace], personId }),
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

    const personA = seedPerson({ display_name: "Person A" })
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
      body: JSON.stringify({ faceIds: [faceA1], personId: personA }),
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
      assert.strictEqual(group.suggestion.personId, personA)
    }

    const queue = await json(await asAdmin("/api/admin/faces/queue"))
    assertNoDescriptor(queue)
    assert.strictEqual(queue.items.length, 3)
    for (const item of queue.items) {
      assert.ok(item.candidates.length >= 1)
      assert.strictEqual(item.candidates[0].personId, personA)
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

    // Assigning the same person again reuses the SAME confirmed identity.
    const again = await json(
      await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceIds: [faceA2], personId: personA }),
      }),
    )
    assert.strictEqual(again.identityId, identityId)
  })
})

describe("assign / unassign / not-a-face mutations", () => {
  it("assigns a batch to a new person, then unassigns", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const personB = seedPerson({ display_name: "Person B" })
    const mediaB1 = seedMedia()
    const mediaB2 = seedMedia()
    const faceB1 = seedFace(mediaB1, CLUSTER_B1)
    const faceB2 = seedFace(mediaB2, CLUSTER_B2)

    const assignRes = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [faceB1, faceB2], personId: personB }),
    })
    assert.strictEqual(assignRes.status, 200)
    const assignBody = await json(assignRes)
    assert.strictEqual(assignBody.changed, 2)

    const perPhoto = await json(await asAdmin(`/api/admin/media/${mediaB1}/faces`))
    assertNoDescriptor(perPhoto)
    assert.strictEqual(perPhoto.faces.length, 1)
    assert.strictEqual(perPhoto.faces[0].faceId, faceB1)
    assert.strictEqual(perPhoto.faces[0].personId, personB)
    assert.strictEqual(perPhoto.faces[0].personName, "Person B")
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
    assert.strictEqual(afterUnassign.faces[0].personId, null)
    assert.strictEqual(afterUnassign.faces[0].personName, null)

    // The other face is untouched.
    const stillAssigned = await json(await asAdmin(`/api/admin/media/${mediaB2}/faces`))
    assert.strictEqual(stillAssigned.faces[0].personId, personB)
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
    const person = seedPerson({ display_name: "Ghost" })
    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [999999], personId: person }),
    })
    assert.strictEqual(res.status, 404)
  })

  it("rejects assign to a missing person", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia()
    const faceId = seedFace(media, CLUSTER_A1)
    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [faceId], personId: 999999 }),
    })
    assert.strictEqual(res.status, 404)
  })

  it("rejects an empty faceIds array", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const person = seedPerson({ display_name: "Empty" })
    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ faceIds: [], personId: person }),
    })
    assert.strictEqual(res.status, 400)
  })
})

// ---------------------------------------------------------------------------
// The per-photograph view. Every OTHER face list in this API is filtered by
// quality routing; this one is not, and must not be — it is what the
// single-face escape hatch is operated from, so a face missing from this
// payload is a face that cannot be named at all.
// ---------------------------------------------------------------------------
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

  it("carries the file key and the ORIGINAL dimensions each box is scaled against", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia({ width: 4000, height: 3000 })
    const faceId = seedFace(media, CLUSTER_A1, { box: { x: 400, y: 300, w: 200, h: 200 } })
    const fileKey = /** @type {any} */ (
      db.prepare(`SELECT file_key FROM media WHERE id = ?`).get(media)
    ).file_key

    const body = await json(await asAdmin(`/api/admin/media/${media}/faces`))
    assert.strictEqual(body.faces.length, 1)
    const face = body.faces[0]
    assert.strictEqual(face.faceId, faceId)
    assert.strictEqual(face.mediaId, media)
    // Without all three the client cannot place a box: the box is in original
    // source pixels, and `x / width` is the only scale-free way to express it.
    assert.strictEqual(face.fileKey, fileKey)
    assert.strictEqual(face.width, 4000)
    assert.strictEqual(face.height, 3000)
    assert.deepStrictEqual(face.box, { x: 400, y: 300, w: 200, h: 200 })
    assert.strictEqual(face.personId, null)
    assert.strictEqual(face.personName, null)
    assert.strictEqual(face.identityId, null)
    assert.strictEqual(face.provenance, null)
  })

  it("returns a set-aside face — this view is the only way to name one", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia({ width: 1200, height: 800 })
    const shown = seedFace(media, CLUSTER_A1, { route: "accept" })
    const asked = seedFace(media, CLUSTER_A2, { route: "ask" })
    const hidden = seedFace(media, CLUSTER_B1, { route: "set_aside" })

    const body = await json(await asAdmin(`/api/admin/media/${media}/faces`))
    /** @type {Map<number, any>} */
    const byId = new Map(body.faces.map((/** @type {any} */ f) => [f.faceId, f]))
    assert.strictEqual(byId.size, 3, "every face in the photograph is shown, whatever its grade")
    assert.strictEqual(byId.get(shown).routeState, "accept")
    assert.strictEqual(byId.get(asked).routeState, "ask")
    assert.strictEqual(byId.get(hidden).routeState, "set_aside")

    // The queue, by contrast, holds the set-aside one back — which is exactly
    // why this payload must not.
    const queue = await json(await asAdmin("/api/admin/faces/queue"))
    assert.ok(
      !queue.items.some((/** @type {any} */ i) => i.faceId === hidden),
      "the ask queue still filters set-aside faces",
    )
  })

  it("treats an ungraded face as shown, not as held back", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    // route_state IS NULL is every row written before quality routing existed.
    // "Not yet graded" is not "withheld", and a query that drops NULL would
    // make the entire pre-routing library invisible in this view.
    const media = seedMedia({ width: 1000, height: 1000 })
    const ungraded = seedFace(media, CLUSTER_A1)
    const hidden = seedFace(media, CLUSTER_B1, { route: "set_aside" })

    const body = await json(await asAdmin(`/api/admin/media/${media}/faces`))
    assert.strictEqual(body.faces.length, 2)
    const first = body.faces.find((/** @type {any} */ f) => f.faceId === ungraded)
    assert.strictEqual(first.routeState, null)
    assert.ok(body.faces.some((/** @type {any} */ f) => f.faceId === hidden))
  })

  it("distinguishes a propagated guess from a confirmed name", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia({ width: 900, height: 600 })
    const confirmedFace = seedFace(media, CLUSTER_A1)
    const propagatedFace = seedFace(media, CLUSTER_A2)
    const person = seedPerson({ display_name: "Two Ways In" })
    const confirmedId = seedIdentityFor(confirmedFace, person, "confirmed")
    const propagatedId = seedIdentityFor(propagatedFace, person, "propagated")

    const body = await json(await asAdmin(`/api/admin/media/${media}/faces`))
    /** @type {Map<number, any>} */
    const byId = new Map(body.faces.map((/** @type {any} */ f) => [f.faceId, f]))

    // Both read as "Two Ways In". Without provenance the view would present a
    // machine's inference and a human's decision as the same settled fact.
    assert.strictEqual(byId.get(confirmedFace).personName, "Two Ways In")
    assert.strictEqual(byId.get(propagatedFace).personName, "Two Ways In")
    assert.strictEqual(byId.get(confirmedFace).provenance, "confirmed")
    assert.strictEqual(byId.get(propagatedFace).provenance, "propagated")
    assert.strictEqual(byId.get(confirmedFace).identityId, confirmedId)
    assert.strictEqual(byId.get(propagatedFace).identityId, propagatedId)
    assert.strictEqual(byId.get(confirmedFace).personId, person)
  })

  it("reports null dimensions rather than inventing a scale", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    // The client degrades to a list when these are missing. A box placed on a
    // guessed scale looks authoritative while pointing at the wrong person.
    const media = seedMedia()
    seedFace(media, CLUSTER_A1, { route: "set_aside" })
    const body = await json(await asAdmin(`/api/admin/media/${media}/faces`))
    assert.strictEqual(body.faces[0].width, null)
    assert.strictEqual(body.faces[0].height, null)
    assert.ok(body.faces[0].fileKey, "the file key survives — the photo still renders")
    assert.strictEqual(body.faces[0].routeState, "set_aside")
  })

  it("still never leaks a descriptor", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const media = seedMedia({ width: 800, height: 600 })
    seedFace(media, CLUSTER_A1, { route: "set_aside" })
    assertNoDescriptor(await json(await asAdmin(`/api/admin/media/${media}/faces`)))
  })

  it("401s with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/media/1/faces`)
    assert.strictEqual(res.status, 401)
  })
})

// ---------------------------------------------------------------------------
// People — the photographed CAST (D10). `guests` rows are INVITATIONS, one per
// party with a unique invite code, and much of the cast is not on that list at
// all: partners recorded under someone else's row, children, the photographer,
// vendors. Before the people table there was nowhere to put them, which blocked
// naming outright — naming being the entire product.
// ---------------------------------------------------------------------------

/** @param {Record<string, unknown>} body */
function postPerson(body) {
  return asAdmin("/api/admin/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** @param {number} id @param {Record<string, unknown>} body */
function patchPerson(id, body) {
  return asAdmin(`/api/admin/people/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** @param {number} fromPersonId @param {number} intoPersonId */
function mergePeople(fromPersonId, intoPersonId) {
  return asAdmin("/api/admin/people/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromPersonId, intoPersonId }),
  })
}

/** Assign one face to a person, creating the confirmed identity as a side
 *  effect — the same path the admin UI takes.
 *  @param {number} faceId @param {number} personId */
async function assignFace(faceId, personId) {
  const res = await asAdmin("/api/admin/faces/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ faceIds: [faceId], personId }),
  })
  assert.strictEqual(res.status, 200)
  return (await json(res)).identityId
}

describe("admin auth is required on every people route", () => {
  it("401s GET /api/admin/people with no session", async () => {
    assert.strictEqual((await fetch(`${BASE_URL}/api/admin/people`)).status, 401)
  })

  it("401s POST /api/admin/people with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Nobody" }),
    })
    assert.strictEqual(res.status, 401)
  })

  it("401s POST /api/admin/people/merge with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/people/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPersonId: 1, intoPersonId: 2 }),
    })
    assert.strictEqual(res.status, 401)
  })

  it("401s DELETE /api/admin/people/:id with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/people/1`, { method: "DELETE" })
    assert.strictEqual(res.status, 401)
  })
})

describe("people: on and off the roster", () => {
  it("creates a person with NO roster link — the case the table exists for", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const res = await postPerson({ displayName: "The Photographer" })
    assert.strictEqual(res.status, 201)
    const body = await json(res)
    assert.strictEqual(body.person.displayName, "The Photographer")
    assert.strictEqual(body.person.guestId, null)

    const listed = await json(await asAdmin("/api/admin/people"))
    const person = listed.people.find((/** @type {any} */ p) => p.id === body.person.id)
    // Null, not absent and not an empty string: every consumer of the list has
    // to handle an off-roster person, so the shape says so plainly.
    assert.strictEqual(person.guestId, null)
    assert.strictEqual(person.guestName, null)
    assert.strictEqual(person.identities, 0)
    assert.strictEqual(person.faces, 0)
  })

  it("creates a person linked to a guest, and surfaces the guest's name", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const guestId = Number(createTestGuest(db, { name: "Invited Ada" }).id)
    const created = await json(await postPerson({ displayName: "Ada", guestId }))
    assert.strictEqual(created.person.guestId, guestId)

    const listed = await json(await asAdmin("/api/admin/people"))
    const person = listed.people.find((/** @type {any} */ p) => p.id === created.person.id)
    // The person's own display name and the invitation's name are separate
    // strings on purpose — an invitation is addressed to a party.
    assert.strictEqual(person.displayName, "Ada")
    assert.strictEqual(person.guestName, "Invited Ada")
  })

  it("404s a link to a guest that does not exist", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    assert.strictEqual((await postPerson({ displayName: "Ghost", guestId: 999999 })).status, 404)
  })

  it("requires a display name", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    assert.strictEqual((await postPerson({})).status, 400)
    assert.strictEqual((await postPerson({ displayName: "   " })).status, 400)
  })

  it("takes created_by from the session and IGNORES anything the client sends", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const created = await json(await postPerson({ displayName: "Actor", createdBy: "not-me" }))
    const row = /** @type {any} */ (
      db.prepare(`SELECT created_by FROM people WHERE id = ?`).get(created.person.id)
    )
    assert.notStrictEqual(row.created_by, "not-me", "actor fields are never client-supplied")
  })

  it("records the 8-char actorId prefix, the same value the audit log records", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    // What a handler gets as `session.token` is the sessions ROW's token column
    // — the SHA-256 of the cookie value (db/sessions.js `hashToken`), not the
    // bearer token. The durable columns used to keep all 64 chars of it while
    // the audit log kept 8, so one admin action had two different actor
    // spellings. core/utils.js's actorId is the single definition now.
    const created = await json(await postPerson({ displayName: "Prefix Only" }))
    const row = /** @type {any} */ (
      db.prepare(`SELECT created_by FROM people WHERE id = ?`).get(created.person.id)
    )

    const cookieToken = /** @type {{ cookieHeader: string }} */ (admin).cookieHeader
      .split("session=")[1]
      .split(";")[0]
    const sessionKey = crypto.createHash("sha256").update(cookieToken).digest("hex")

    assert.strictEqual(row.created_by.length, 8, "8 chars, matching the audit log")
    assert.strictEqual(row.created_by, sessionKey.slice(0, 8))
    assert.notStrictEqual(row.created_by, sessionKey, "not the whole session key")
  })
})

describe("people: duplicate names are legal, but never accidental", () => {
  it("refuses a same-name create unless the duplicate is confirmed", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const first = await json(await postPerson({ displayName: "Sam Taylor" }))

    // An autocomplete cannot tell "the person I mean" from "a different person
    // with the same name". Silently creating the second fragments an identity
    // and its prototypes, so the server names the existing candidate instead.
    const refused = await postPerson({ displayName: "Sam Taylor" })
    assert.strictEqual(refused.status, 409)
    assert.ok((await json(refused)).error.includes(String(first.person.id)))

    const confirmed = await postPerson({ displayName: "Sam Taylor", confirmDuplicate: true })
    assert.strictEqual(confirmed.status, 201)
    assert.notStrictEqual((await json(confirmed)).person.id, first.person.id)
  })

  it("matches duplicates case- and accent-fold-insensitively, not by byte equality", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    await postPerson({ displayName: "José" })
    // Same name, upper-cased: SQLite's COLLATE NOCASE folds ASCII only and
    // would call these two different people. The server folds in JS instead,
    // matching what the admin UI does when it resolves a typed name.
    assert.strictEqual((await postPerson({ displayName: "JOSÉ" })).status, 409)
    // Same name again, this time with a COMBINING acute instead of the
    // precomposed character — visually identical, different bytes.
    assert.strictEqual((await postPerson({ displayName: "José" })).status, 409)
  })
})

describe("people: rename, link, unlink", () => {
  it("renames a person", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const person = seedPerson({ display_name: "Typo" })
    const res = await patchPerson(person, { displayName: "Fixed" })
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await json(res)).person.displayName, "Fixed")
  })

  it("links, then unlinks, a roster guest", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const person = seedPerson({ display_name: "Late Link" })
    const guestId = Number(createTestGuest(db, { name: "Roster Row" }).id)

    assert.strictEqual((await json(await patchPerson(person, { guestId }))).person.guestId, guestId)
    // Explicit null unlinks; an ABSENT guestId leaves the link alone. Without
    // that distinction there is no way to say "remove the link" at all.
    assert.strictEqual((await json(await patchPerson(person, { guestId: null }))).person.guestId, null)
  })

  it("leaves the link untouched when guestId is absent from the patch", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const guestId = Number(createTestGuest(db, { name: "Sticky" }).id)
    const person = seedPerson({ display_name: "Keeps Link", guest_id: guestId })

    const res = await patchPerson(person, { displayName: "Renamed Only" })
    assert.strictEqual((await json(res)).person.guestId, guestId)
  })

  it("400s an empty patch and 404s a missing person", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const person = seedPerson({ display_name: "Untouched" })
    assert.strictEqual((await patchPerson(person, {})).status, 400)
    assert.strictEqual((await patchPerson(999999, { displayName: "Nobody" })).status, 404)
  })
})

describe("people: merge", () => {
  it("folds the source's faces onto the target's identity of the same provenance", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const faceA = seedFace(seedMedia(), CLUSTER_A1)
    const faceB = seedFace(seedMedia(), CLUSTER_B1)
    const duplicate = seedPerson({ display_name: "Sam T." })
    const keeper = seedPerson({ display_name: "Sam Taylor" })
    await assignFace(faceA, duplicate)
    const keeperIdentity = await assignFace(faceB, keeper)

    const res = await mergePeople(duplicate, keeper)
    assert.strictEqual(res.status, 200)
    const body = await json(res)
    assert.strictEqual(body.movedFaces, 1)
    assert.strictEqual(body.movedIdentities, 0)

    // Both faces now hang off the keeper's ONE confirmed identity —
    // idx_face_identities_person allows no second live row per provenance.
    for (const faceId of [faceA, faceB]) {
      const row = /** @type {any} */ (
        db.prepare(`SELECT face_identity_id FROM media_faces WHERE id = ?`).get(faceId)
      )
      assert.strictEqual(row.face_identity_id, keeperIdentity)
    }
    assert.ok(
      /** @type {any} */ (
        db.prepare(`SELECT deleted_at FROM people WHERE id = ?`).get(duplicate)
      ).deleted_at,
      "the source person is retired, not hard-deleted",
    )
  })

  it("moves the identity itself when the target has none of that provenance", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const faceA = seedFace(seedMedia(), CLUSTER_A1)
    const duplicate = seedPerson({ display_name: "Only Copy" })
    const keeper = seedPerson({ display_name: "Real Person" })
    const identityId = await assignFace(faceA, duplicate)

    const body = await json(await mergePeople(duplicate, keeper))
    assert.strictEqual(body.movedFaces, 0)
    assert.strictEqual(body.movedIdentities, 1)

    const row = /** @type {any} */ (
      db.prepare(`SELECT person_id FROM face_identities WHERE id = ?`).get(identityId)
    )
    assert.strictEqual(row.person_id, keeper)
  })

  it("carries the roster link across when the target has none", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const guestId = Number(createTestGuest(db, { name: "Linked Invitation" }).id)
    const linked = seedPerson({ display_name: "Dup With Link", guest_id: guestId })
    const keeper = seedPerson({ display_name: "Keeper" })

    const body = await json(await mergePeople(linked, keeper))
    assert.strictEqual(body.carriedGuestLink, true)

    const row = /** @type {any} */ (
      db.prepare(`SELECT guest_id FROM people WHERE id = ?`).get(keeper)
    )
    assert.strictEqual(row.guest_id, guestId, "a merge must not silently discard the roster link")
  })

  it("NEVER overwrites a roster link the target already has", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const sourceGuest = Number(createTestGuest(db, { name: "Source Invitation" }).id)
    const targetGuest = Number(createTestGuest(db, { name: "Target Invitation" }).id)
    const source = seedPerson({ display_name: "Source", guest_id: sourceGuest })
    const target = seedPerson({ display_name: "Target", guest_id: targetGuest })

    const body = await json(await mergePeople(source, target))
    assert.strictEqual(body.carriedGuestLink, false)

    // Overwriting would silently reassign which invitation a person is, which
    // is a different claim from "these two rows are the same human".
    const row = /** @type {any} */ (
      db.prepare(`SELECT guest_id FROM people WHERE id = ?`).get(target)
    )
    assert.strictEqual(row.guest_id, targetGuest)
  })

  it("refuses merging a person into themselves, and 404s an unknown side", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const person = seedPerson({ display_name: "Alone" })
    assert.strictEqual((await mergePeople(person, person)).status, 400)
    assert.strictEqual((await mergePeople(person, 999999)).status, 404)
    assert.strictEqual((await mergePeople(999999, person)).status, 404)
  })
})

describe("people: delete", () => {
  it("refuses while live identities point at the person, and says why", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const faceId = seedFace(seedMedia(), CLUSTER_A1)
    const person = seedPerson({ display_name: "Still Named" })
    await assignFace(faceId, person)

    // face_identities.person_id is NOT NULL, so deleting here would leave the
    // identity pointing at a tombstone. The refusal has to be legible in the
    // UI, not an opaque constraint error.
    const res = await asAdmin(`/api/admin/people/${person}`, { method: "DELETE" })
    assert.strictEqual(res.status, 409)
    assert.ok((await json(res)).error.includes("Still Named"))
    assert.ok(
      !(/** @type {any} */ (db.prepare(`SELECT deleted_at FROM people WHERE id = ?`).get(person))
        .deleted_at),
    )
  })

  it("soft-deletes a person with no live identities, and drops them from the list", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const person = seedPerson({ display_name: "Never Used" })
    assert.strictEqual((await asAdmin(`/api/admin/people/${person}`, { method: "DELETE" })).status, 200)

    const row = /** @type {any} */ (
      db.prepare(`SELECT deleted_at FROM people WHERE id = ?`).get(person)
    )
    assert.ok(row.deleted_at, "soft-deleted, not hard-deleted")

    const listed = await json(await asAdmin("/api/admin/people"))
    assert.ok(!listed.people.some((/** @type {any} */ p) => p.id === person))
  })

  it("404s deleting a person who does not exist", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    assert.strictEqual((await asAdmin("/api/admin/people/999999", { method: "DELETE" })).status, 404)
  })
})

describe("quality routing (plan §8)", () => {
  it("hides a set-aside face from the group chips but still clusters on it", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const m1 = seedMedia()
    const m2 = seedMedia()
    const m3 = seedMedia()
    const shownA = seedFace(m1, CLUSTER_A1, { route: "accept" })
    const shownB = seedFace(m2, CLUSTER_A2, { route: "ask" })
    const hidden = seedFace(m3, CLUSTER_A1, { route: "set_aside" })

    const body = await json(await asAdmin("/api/admin/faces/overview"))
    const group = body.groups.find((/** @type {any} */ g) => g.faceIds.includes(shownA))
    assert.ok(group, "the accept face is in a group")

    // The display filter: the hidden face is not offered.
    assert.deepStrictEqual(group.faceIds.sort((/** @type {number} */ a, /** @type {number} */ b) => a - b), [shownA, shownB].sort((a, b) => a - b))
    assert.ok(!group.media.some((/** @type {any} */ m) => m.faceId === hidden))

    // ...but the clustering still saw it. `size` is the full cluster, and
    // `setAside` says how many are missing from the chips — the alternative is
    // a UI that silently disagrees with itself about how big a group is.
    assert.strictEqual(group.size, 3)
    assert.strictEqual(group.setAside, 1)
  })

  it("reports weld risk against the grouping cutoff", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const tight = [seedMedia(), seedMedia()].map((m, i) =>
      seedFace(m, i === 0 ? CLUSTER_A1 : CLUSTER_A2),
    )
    const body = await json(await asAdmin("/api/admin/faces/overview"))
    const group = body.groups.find((/** @type {any} */ g) => g.faceIds.includes(tight[0]))

    assert.ok(group.weld, "a group of two or more carries a weld measurement")
    assert.ok(group.weld.diameter >= 0)
    // These two are near-identical, so the widest internal pair is far inside
    // the cutoff: nothing to warn about.
    assert.ok(group.weld.ratio < 1, "a genuinely tight group is not flagged")
  })

  it("counts ungraded faces as their own bucket, not as an omission", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    seedFace(seedMedia(), CLUSTER_A1, { route: "accept" })
    seedFace(seedMedia(), CLUSTER_A2, { route: "ask" })
    seedFace(seedMedia(), CLUSTER_B1, { route: "set_aside" })
    seedFace(seedMedia(), CLUSTER_B2) // ungraded

    const body = await json(await asAdmin("/api/admin/faces/overview"))
    assert.deepStrictEqual(body.routeCounts, { accept: 1, ask: 1, setAside: 1, ungraded: 1 })
  })

  it("keeps an ungraded face fully usable — that is not the same as rejected", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const face = seedFace(seedMedia(), CLUSTER_A1) // route_state IS NULL
    const person = seedPerson({ display_name: "Ungraded Is Fine" })

    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [face], personId: person }),
    })
    assert.strictEqual(res.status, 200, "every row that exists today is ungraded; bulk must work on them")
  })

  it("refuses a bulk assign that reaches a face the queue never showed", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const ok = seedFace(seedMedia(), CLUSTER_A1, { route: "ask" })
    const hidden = seedFace(seedMedia(), CLUSTER_A2, { route: "set_aside" })
    const person = seedPerson({ display_name: "Should Not Get These" })

    const res = await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [ok, hidden], personId: person }),
    })
    assert.strictEqual(res.status, 400)
    assert.ok((await json(res)).error.includes("set aside"))

    // ATOMIC: the whole batch is refused, so the assignable face in it is
    // untouched too. A partial apply would leave the admin with no way to know
    // which half landed.
    const row = /** @type {any} */ (
      db.prepare(`SELECT face_identity_id FROM media_faces WHERE id = ?`).get(ok)
    )
    assert.strictEqual(row.face_identity_id, null)
  })

  it("refuses bulk unassign and not-a-face on a set-aside face too", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const hidden = seedFace(seedMedia(), CLUSTER_A1, { route: "set_aside" })

    for (const path of ["/api/admin/faces/unassign", "/api/admin/faces/not-a-face"]) {
      const res = await asAdmin(path, {
        method: "POST",
        body: JSON.stringify({ faceIds: [hidden] }),
      })
      assert.strictEqual(res.status, 400, `${path} must refuse a face the admin was not shown`)
    }

    const row = /** @type {any} */ (
      db.prepare(`SELECT deleted_at FROM media_faces WHERE id = ?`).get(hidden)
    )
    assert.strictEqual(row.deleted_at, null, "not-a-face must not have soft-deleted it")
  })

  it("names a set-aside face through the single-face escape hatch", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    // The whole point: set_aside filters attention, it is not a one-way door.
    // An admin looking at the photograph can see who this is.
    const hidden = seedFace(seedMedia(), CLUSTER_A1, { route: "set_aside" })
    const person = seedPerson({ display_name: "Recognisable Anyway" })

    const res = await asAdmin("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId: hidden, personId: person }),
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual((await json(res)).changed, 1)

    const row = /** @type {any} */ (
      db.prepare(`SELECT face_identity_id FROM media_faces WHERE id = ?`).get(hidden)
    )
    assert.ok(row.face_identity_id, "the face is now named")
  })

  it("the escape hatch clears an assignment too, so it is its own undo", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const face = seedFace(seedMedia(), CLUSTER_A1, { route: "set_aside" })
    const person = seedPerson({ display_name: "Assigned Then Cleared" })
    await asAdmin("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId: face, personId: person }),
    })

    const res = await asAdmin("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId: face, personId: null }),
    })
    assert.strictEqual(res.status, 200)
    const row = /** @type {any} */ (
      db.prepare(`SELECT face_identity_id FROM media_faces WHERE id = ?`).get(face)
    )
    assert.strictEqual(row.face_identity_id, null)
  })

  it("the escape hatch takes exactly one face, never a list", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const a = seedFace(seedMedia(), CLUSTER_A1, { route: "set_aside" })
    const b = seedFace(seedMedia(), CLUSTER_A2, { route: "set_aside" })
    const person = seedPerson({ display_name: "Not Via A List" })

    // An array where a single id belongs is refused rather than coerced —
    // otherwise the exemption quietly becomes a bulk path with no routing check.
    const res = await asAdmin("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId: [a, b], personId: person }),
    })
    assert.strictEqual(res.status, 400)

    for (const id of [a, b]) {
      const row = /** @type {any} */ (
        db.prepare(`SELECT face_identity_id FROM media_faces WHERE id = ?`).get(id)
      )
      assert.strictEqual(row.face_identity_id, null)
    }
  })

  it("404s the escape hatch on a face that does not exist", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    const person = seedPerson({ display_name: "Nobody" })
    const res = await asAdmin("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId: 999999, personId: person }),
    })
    assert.strictEqual(res.status, 404)
  })

  it("401s the escape hatch with no session", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/faces/assign-one`, {
      method: "POST",
      body: JSON.stringify({ faceId: 1, personId: 1 }),
    })
    assert.strictEqual(res.status, 401)
  })

  it("still never leaks a descriptor, routing payloads included", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")
    seedFace(seedMedia(), CLUSTER_A1, { route: "accept" })
    seedFace(seedMedia(), CLUSTER_A2, { route: "set_aside" })
    assertNoDescriptor(await json(await asAdmin("/api/admin/faces/overview")))
    assertNoDescriptor(await json(await asAdmin("/api/admin/faces/queue")))
  })

  it("refuses an invalid route_state at the database, not just in code", async () => {
    // The trigger is the enforcement; public/vision/route.js's vocabulary is
    // only a promise until something refuses a row that breaks it.
    const media = seedMedia()
    assert.throws(() =>
      db
        .prepare(
          `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source, route_state)
           VALUES (?, 0, 0, 10, 10, 'v', 'cli', 'maybe')`,
        )
        .run(media),
    )
  })
})

// ---------------------------------------------------------------------------
// The assignment ledger (Phase 5, plan §9b).
//
// `media_faces.face_identity_id` is now a PROJECTION of an append-only event
// log, not a value anybody sets. What is asserted below is that every write
// path through the HTTP API produces the events it should, that the column
// agrees with replaying them, and — the promise the whole thing was built for —
// that revoking a bulk pass leaves a later human correction where the human
// left it.
// ---------------------------------------------------------------------------

/** Every ledger event for one face, oldest first.
 *  @param {number} faceId @returns {any[]} */
function eventsFor(faceId) {
  return /** @type {any[]} */ (
    db.prepare(`SELECT * FROM face_assignments WHERE face_id = ? ORDER BY id`).all(faceId)
  )
}

/** @param {string} batchId @returns {any} */
function batchRow(batchId) {
  return /** @type {any} */ (
    db.prepare(`SELECT * FROM face_assignment_batches WHERE batch_id = ?`).get(batchId)
  )
}

/**
 * The actor string the server derives for the logged-in admin: the first 8
 * characters of the sessions row's token, which is the sha256 of the cookie
 * value (db/sessions.js `hashToken`). Recomputed here from the cookie rather
 * than read back out of a row, so the assertion is against an independently
 * derived value and not against whatever the server happened to store.
 */
function adminActor() {
  const cookieToken = /** @type {{ cookieHeader: string }} */ (admin).cookieHeader
    .split("session=")[1]
    .split(";")[0]
  return crypto.createHash("sha256").update(cookieToken).digest("hex").slice(0, 8)
}

/** @param {number} faceId @returns {number | null} */
function columnIdentity(faceId) {
  return /** @type {any} */ (
    db.prepare(`SELECT face_identity_id FROM media_faces WHERE id = ?`).get(faceId)
  ).face_identity_id
}

/** @param {number} faceId @returns {number} */
function mediaOfFace(faceId) {
  return /** @type {any} */ (
    db.prepare(`SELECT media_id FROM media_faces WHERE id = ?`).get(faceId)
  ).media_id
}

/** The column and the ledger must never disagree — that is the invariant the
 *  "append and project are one call" rule exists to keep.
 *  @param {number} faceId */
function assertColumnMatchesReplay(faceId) {
  assert.strictEqual(
    columnIdentity(faceId),
    replayFace(faceId).identityId,
    "media_faces.face_identity_id must equal what replaying the ledger says",
  )
}

describe("the assignment ledger: every write path appends", () => {
  it("bulk assign writes exactly one assign event per face, in one revocable manual batch", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const personId = seedPerson({ display_name: "Ledger Assign" })
    const faceA = seedFace(seedMedia(), CLUSTER_A1)
    const faceB = seedFace(seedMedia(), CLUSTER_A2)

    const body = await json(
      await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceA, faceB], personId }),
      }),
    )

    for (const faceId of [faceA, faceB]) {
      const events = eventsFor(faceId)
      assert.strictEqual(events.length, 1, "exactly one event, never a clear-then-assign pair")
      assert.strictEqual(events[0].op, "assign")
      assert.strictEqual(events[0].identity_id, body.identityId)
      assert.strictEqual(events[0].actor, adminActor(), "the actor is derived from the session")
      assert.strictEqual(events[0].batch_id, body.batchId)
      assert.strictEqual(columnIdentity(faceId), body.identityId)
      assertColumnMatchesReplay(faceId)
    }

    const batch = batchRow(body.batchId)
    assert.strictEqual(batch.kind, "manual")
    assert.strictEqual(batch.actor, adminActor())
    assert.strictEqual(batch.revoked_at, null)
  })

  it("bulk unassign appends a clear rather than overwriting the assign", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const personId = seedPerson({ display_name: "Ledger Clear" })
    const faceId = seedFace(seedMedia(), CLUSTER_A1)
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [faceId], personId }),
    })

    const body = await json(
      await asAdmin("/api/admin/faces/unassign", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceId] }),
      }),
    )

    const events = eventsFor(faceId)
    assert.strictEqual(events.length, 2, "the assign stays on record; the clear is appended after it")
    assert.strictEqual(events[1].op, "clear")
    assert.strictEqual(events[1].identity_id, null)
    assert.strictEqual(events[1].actor, adminActor())
    assert.strictEqual(batchRow(body.batchId).kind, "manual")
    assert.strictEqual(columnIdentity(faceId), null)
    assertColumnMatchesReplay(faceId)
  })

  it("bulk not-a-face writes a not_a_face, and the soft delete is its projection", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const faceId = seedFace(seedMedia(), CLUSTER_A1)
    const body = await json(
      await asAdmin("/api/admin/faces/not-a-face", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceId] }),
      }),
    )

    const events = eventsFor(faceId)
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].op, "not_a_face")
    assert.strictEqual(events[0].identity_id, null)
    assert.strictEqual(events[0].batch_id, body.batchId)

    const row = /** @type {any} */ (
      db.prepare(`SELECT deleted_at FROM media_faces WHERE id = ?`).get(faceId)
    )
    assert.ok(row.deleted_at, "the soft delete came from projecting the event")
    assert.strictEqual(replayFace(faceId).notAFace, true)
  })

  it("the single-face escape hatch appends UNBATCHED events, assign and clear alike", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const personId = seedPerson({ display_name: "Ledger One" })
    const faceId = seedFace(seedMedia(), CLUSTER_A1, { route: "set_aside" })

    const assigned = await json(
      await asAdmin("/api/admin/faces/assign-one", {
        method: "POST",
        body: JSON.stringify({ faceId, personId }),
      }),
    )
    assert.strictEqual(eventsFor(faceId).length, 1)
    assert.strictEqual(eventsFor(faceId)[0].op, "assign")
    assert.strictEqual(eventsFor(faceId)[0].batch_id, null, "one face is one decision, not a batch")
    assert.strictEqual(columnIdentity(faceId), assigned.identityId)

    await asAdmin("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId, personId: null }),
    })
    const events = eventsFor(faceId)
    assert.strictEqual(events.length, 2)
    assert.strictEqual(events[1].op, "clear")
    assert.strictEqual(events[1].batch_id, null)
    assert.strictEqual(events[1].actor, adminActor())
    assertColumnMatchesReplay(faceId)
  })

  it("takes the actor from the session and IGNORES anything the client sends", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const personId = seedPerson({ display_name: "Not The Actor" })
    const faceId = seedFace(seedMedia(), CLUSTER_A1)
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      // Both spellings a client might try. Neither is read.
      body: JSON.stringify({ faceIds: [faceId], personId, actor: "somebody-else", batchId: "mine" }),
    })

    const event = eventsFor(faceId)[0]
    assert.strictEqual(event.actor, adminActor())
    assert.notStrictEqual(event.actor, "somebody-else")
    assert.notStrictEqual(event.batch_id, "mine", "the batch id is a primary key the server owns")
  })
})

describe("the assignment ledger: revoking a propagate pass (plan §9b)", () => {
  /** Two media rows in one frame class, a confirmed face and an undecided face
   *  on nearly the same box — the shape must-link.js proposes on. */
  function seedPropagatable() {
    const a = seedMedia()
    const b = seedMedia()
    db.prepare(`UPDATE media SET frame_root_sha256 = 'frame-ledger' WHERE id IN (?, ?)`).run(a, b)
    const source = seedFace(a, CLUSTER_A1, { box: { x: 10, y: 10, w: 100, h: 100 } })
    const target = seedFace(b, CLUSTER_A2, { box: { x: 12, y: 12, w: 100, h: 100 } })
    return { source, target }
  }

  it("writes one propagate batch of assign events and returns its id", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const { source, target } = seedPropagatable()
    const personId = seedPerson({ display_name: "Propagated" })
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [source], personId }),
    })

    const body = await json(
      await asAdmin("/api/admin/faces/propagate", {
        method: "POST",
        body: JSON.stringify({ toFaceIds: [target] }),
      }),
    )
    assert.strictEqual(body.changed, 1)
    assert.ok(body.batchId, "the pass returns the name of the batch it wrote")
    assert.strictEqual(batchRow(body.batchId).kind, "propagate")
    assert.strictEqual(batchRow(body.batchId).actor, adminActor())

    const events = eventsFor(target)
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].op, "assign")
    assert.strictEqual(events[0].batch_id, body.batchId)
    assertColumnMatchesReplay(target)
  })

  it("REVOKING THE PASS LEAVES A LATER MANUAL CORRECTION STANDING", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    // The face the pass named is corrected by hand afterwards. Revoking the
    // pass must leave that correction exactly where the human left it — which
    // is only possible because revocation FILTERS history rather than writing a
    // compensating event over it.
    const { source, target } = seedPropagatable()
    const untouched = seedFace(seedMedia(), CLUSTER_A2)

    const rightPerson = seedPerson({ display_name: "Right Person" })
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [source], personId: rightPerson }),
    })

    const pass = await json(
      await asAdmin("/api/admin/faces/propagate", {
        method: "POST",
        body: JSON.stringify({ toFaceIds: [target] }),
      }),
    )
    const propagatedIdentity = columnIdentity(target)
    assert.ok(propagatedIdentity, "the pass named the target")

    const correctedPerson = seedPerson({ display_name: "Actually This Person" })
    await asAdmin("/api/admin/faces/assign-one", {
      method: "POST",
      body: JSON.stringify({ faceId: target, personId: correctedPerson }),
    })
    const correctedIdentity = columnIdentity(target)
    assert.notStrictEqual(correctedIdentity, propagatedIdentity)

    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [untouched], personId: correctedPerson }),
    })
    const untouchedIdentity = columnIdentity(untouched)

    const revoked = revokeBatch(pass.batchId, "test-revoker")
    assert.strictEqual(revoked, 1, "only the faces the batch touched are re-projected")

    assert.strictEqual(
      columnIdentity(target),
      correctedIdentity,
      "the human correction outranks the revoked pass and SURVIVES it",
    )
    assert.strictEqual(columnIdentity(untouched), untouchedIdentity, "an unrelated face is untouched")
    assertColumnMatchesReplay(target)

    // The batch is flagged, not deleted: its events are still on record.
    assert.ok(batchRow(pass.batchId).revoked_at)
    assert.strictEqual(batchRow(pass.batchId).revoked_by, "test-revoker")
    assert.strictEqual(eventsFor(target).length, 2, "revocation removes no rows")
  })

  it("restores the prior state on a face nobody corrected", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const { source, target } = seedPropagatable()
    const personId = seedPerson({ display_name: "Only Propagated" })
    await asAdmin("/api/admin/faces/assign", {
      method: "POST",
      body: JSON.stringify({ faceIds: [source], personId }),
    })
    const pass = await json(
      await asAdmin("/api/admin/faces/propagate", {
        method: "POST",
        body: JSON.stringify({ toFaceIds: [target] }),
      }),
    )
    assert.ok(columnIdentity(target))

    revokeBatch(pass.batchId, "test-revoker")
    assert.strictEqual(columnIdentity(target), null, "back to undecided, which is what it was")
    assertColumnMatchesReplay(target)
  })
})

describe("merge is a redirect on identities, never a rewrite of faces", () => {
  it("a face assigned to A resolves to B after A is merged into B — and replay agrees", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    const personA = seedPerson({ display_name: "Person A" })
    const personB = seedPerson({ display_name: "Person B" })
    const faceA = seedFace(seedMedia(), CLUSTER_A1)
    const faceB = seedFace(seedMedia(), CLUSTER_B1)

    const assignedA = await json(
      await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceA], personId: personA }),
      }),
    )
    const assignedB = await json(
      await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceB], personId: personB }),
      }),
    )

    const merged = await json(await mergePeople(personA, personB))
    assert.strictEqual(merged.movedFaces, 1)
    assert.strictEqual(merged.repairedFaces, 0, "a face with history needs no back-fill")

    // The EVENT still names identity A — that is the whole point. A merge does
    // not make a past decision have been about somebody else.
    const events = eventsFor(faceA)
    assert.strictEqual(events.length, 1, "a merge writes no per-face event")
    assert.strictEqual(events[0].identity_id, assignedA.identityId)

    // The redirect is on the identity row, and the source is retired.
    const sourceIdentity = /** @type {any} */ (
      db
        .prepare(`SELECT merged_into, deleted_at FROM face_identities WHERE id = ?`)
        .get(assignedA.identityId)
    )
    assert.strictEqual(sourceIdentity.merged_into, assignedB.identityId)
    assert.ok(sourceIdentity.deleted_at, "the source identity is retired, not left live")

    // Resolution and replay both land on B, not on a dangling reference.
    assert.strictEqual(resolveIdentity(assignedA.identityId), assignedB.identityId)
    assert.strictEqual(replayFace(faceA).identityId, assignedB.identityId)
    assert.strictEqual(columnIdentity(faceA), assignedB.identityId)

    // And the read path agrees: the face is named, not silently nameless.
    const perPhoto = await json(await asAdmin(`/api/admin/media/${mediaOfFace(faceA)}/faces`))
    assert.strictEqual(perPhoto.faces[0].personId, personB)
    assert.strictEqual(perPhoto.faces[0].personName, "Person B")
  })

  it("back-fills a PRE-LEDGER assignment rather than losing it", async (t) => {
    if (!hasAdmin) return t.skip("no TEST_ADMIN_PASSWORD")

    // A face row assigned before the ledger existed: a column value with no
    // events behind it. Replaying it would say "nobody", so the merge writes
    // the missing history under a `merge-repair` batch instead of clearing it.
    const personA = seedPerson({ display_name: "Legacy A" })
    const personB = seedPerson({ display_name: "Legacy B" })
    const faceLegacy = seedFace(seedMedia(), CLUSTER_A1)
    const faceB = seedFace(seedMedia(), CLUSTER_B1)

    const identityA = Number(
      db
        .prepare(`INSERT INTO face_identities (person_id, provenance) VALUES (?, 'confirmed')`)
        .run(personA).lastInsertRowid,
    )
    db.prepare(`UPDATE media_faces SET face_identity_id = ? WHERE id = ?`).run(identityA, faceLegacy)
    assert.strictEqual(eventsFor(faceLegacy).length, 0, "the premise: no ledger history")

    const assignedB = await json(
      await asAdmin("/api/admin/faces/assign", {
        method: "POST",
        body: JSON.stringify({ faceIds: [faceB], personId: personB }),
      }),
    )

    const merged = await json(await mergePeople(personA, personB))
    assert.strictEqual(merged.repairedFaces, 1)

    const events = eventsFor(faceLegacy)
    assert.strictEqual(events.length, 1)
    assert.strictEqual(events[0].op, "assign")
    assert.strictEqual(events[0].identity_id, assignedB.identityId)
    assert.strictEqual(batchRow(events[0].batch_id).kind, "merge-repair")
    assert.strictEqual(columnIdentity(faceLegacy), assignedB.identityId)
    assertColumnMatchesReplay(faceLegacy)
  })
})
