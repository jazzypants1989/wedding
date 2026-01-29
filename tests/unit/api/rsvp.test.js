/**
 * @file Unit tests for api/rsvp.js — RSVP data layer functions
 */

import { describe, it, before, after, afterEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import { getRsvpByGuestId, upsertRsvp, getAllRsvps, getStats } from "../../../api/rsvp.js"
import { createGuest, updateGuest } from "../../../api/guests/data.js"

const PREFIX = "rsvptest-"

before(() => {
  init()
})

after(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
  close()
})

afterEach(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
})

describe("getRsvpByGuestId", () => {
  it("returns undefined when no RSVP exists", () => {
    const { id } = createGuest({ name: "NoRSVP", email: `${PREFIX}norsvp@example.com` })
    assert.strictEqual(getRsvpByGuestId(Number(id)), undefined)
  })

  it("returns RSVP after upsert", () => {
    const { id } = createGuest({ name: "HasRSVP", email: `${PREFIX}hasrsvp@example.com` })
    upsertRsvp(Number(id), {
      attending: true,
      actual_party_size: 2,
      dietary_restrictions: "Vegetarian",
      message: "Can't wait!",
    })
    const rsvp = getRsvpByGuestId(Number(id))
    assert.ok(rsvp)
    assert.strictEqual(rsvp.attending, 1)
    assert.strictEqual(rsvp.actual_party_size, 2)
    assert.strictEqual(rsvp.dietary_restrictions, "Vegetarian")
    assert.strictEqual(rsvp.message, "Can't wait!")
  })
})

describe("upsertRsvp", () => {
  it("creates an RSVP for attending guest", () => {
    const { id } = createGuest({ name: "Attend", email: `${PREFIX}attend@example.com`, party_size: 4 })
    upsertRsvp(Number(id), {
      attending: true,
      actual_party_size: 3,
      dietary_restrictions: null,
      message: null,
    })
    const rsvp = getRsvpByGuestId(Number(id))
    assert.ok(rsvp)
    assert.strictEqual(rsvp.attending, 1)
    assert.strictEqual(rsvp.actual_party_size, 3)
    assert.ok(rsvp.submitted_at)
  })

  it("creates an RSVP for declining guest", () => {
    const { id } = createGuest({ name: "Decline", email: `${PREFIX}decline@example.com` })
    upsertRsvp(Number(id), {
      attending: false,
      actual_party_size: null,
      dietary_restrictions: null,
      message: "Sorry!",
    })
    const rsvp = getRsvpByGuestId(Number(id))
    assert.ok(rsvp)
    assert.strictEqual(rsvp.attending, 0)
    assert.strictEqual(rsvp.actual_party_size, null)
    assert.strictEqual(rsvp.message, "Sorry!")
  })

  it("updates existing RSVP (upsert)", () => {
    const { id } = createGuest({ name: "Upsert", email: `${PREFIX}upsert@example.com`, party_size: 5 })
    upsertRsvp(Number(id), {
      attending: true,
      actual_party_size: 2,
      dietary_restrictions: null,
      message: null,
    })
    upsertRsvp(Number(id), {
      attending: true,
      actual_party_size: 4,
      dietary_restrictions: "Gluten free",
      message: "Changed my mind",
    })
    const rsvp = getRsvpByGuestId(Number(id))
    assert.ok(rsvp)
    assert.strictEqual(rsvp.actual_party_size, 4)
    assert.strictEqual(rsvp.dietary_restrictions, "Gluten free")
    assert.strictEqual(rsvp.message, "Changed my mind")
    assert.ok(rsvp.updated_at)
  })

  it("sets guest status to responded", () => {
    const { id } = createGuest({ name: "Status", email: `${PREFIX}status@example.com` })
    upsertRsvp(Number(id), {
      attending: true,
      actual_party_size: 1,
      dietary_restrictions: null,
      message: null,
    })
    const guest = getDb().prepare("SELECT status FROM guests WHERE id = ?").get(Number(id))
    assert.ok(guest)
    assert.strictEqual(/** @type {import('../../../types.js').Guest} */ (/** @type {unknown} */ (guest)).status, "responded")
  })
})

describe("getAllRsvps", () => {
  it("returns RSVPs joined with guest data", () => {
    const { id } = createGuest({ name: "AllRSVP", email: `${PREFIX}allrsvp@example.com`, party_size: 2 })
    upsertRsvp(Number(id), {
      attending: true,
      actual_party_size: 2,
      dietary_restrictions: null,
      message: null,
    })
    const rsvps = getAllRsvps()
    const found = rsvps.find((r) => r.name === "AllRSVP")
    assert.ok(found)
    assert.strictEqual(found.max_party_size, 2)
    assert.ok("email" in found)
  })

  it("excludes soft-deleted guests by default", () => {
    const { id } = createGuest({ name: "DelRSVP", email: `${PREFIX}delrsvp@example.com` })
    upsertRsvp(Number(id), {
      attending: true,
      actual_party_size: 1,
      dietary_restrictions: null,
      message: null,
    })
    const db = getDb()
    db.prepare("UPDATE guests SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), Number(id))

    const rsvps = getAllRsvps()
    assert.ok(!rsvps.find((r) => r.name === "DelRSVP"))
  })

  it("includes soft-deleted guests when requested", () => {
    const { id } = createGuest({ name: "IncDel", email: `${PREFIX}incdel@example.com` })
    upsertRsvp(Number(id), {
      attending: false,
      actual_party_size: null,
      dietary_restrictions: null,
      message: null,
    })
    const db = getDb()
    db.prepare("UPDATE guests SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), Number(id))

    const rsvps = getAllRsvps({ includeDeleted: true })
    assert.ok(rsvps.find((r) => r.name === "IncDel"))
  })
})

describe("getStats", () => {
  it("returns stats object with expected fields", () => {
    const stats = getStats()
    assert.ok(stats)
    assert.ok("total_guests" in stats)
    assert.ok("pending" in stats)
    assert.ok("invited" in stats)
    assert.ok("responded" in stats)
    assert.ok("attending_yes" in stats)
    assert.ok("attending_no" in stats)
    assert.ok("total_headcount" in stats)
    assert.ok("deleted_guests" in stats)
  })

  it("counts attending guests correctly", () => {
    const { id: id1 } = createGuest({ name: "S1", email: `${PREFIX}s1@example.com`, party_size: 3 })
    const { id: id2 } = createGuest({ name: "S2", email: `${PREFIX}s2@example.com`, party_size: 2 })

    const before = getStats()

    upsertRsvp(Number(id1), {
      attending: true,
      actual_party_size: 3,
      dietary_restrictions: null,
      message: null,
    })
    upsertRsvp(Number(id2), {
      attending: false,
      actual_party_size: null,
      dietary_restrictions: null,
      message: null,
    })

    const after = getStats()
    assert.strictEqual(after.attending_yes - before.attending_yes, 1)
    assert.strictEqual(after.attending_no - before.attending_no, 1)
    assert.strictEqual(after.total_headcount - before.total_headcount, 3)
  })
})
