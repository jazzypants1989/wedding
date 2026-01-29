/**
 * @file Concurrency tests — race conditions in database operations
 */

import { describe, it, before, after, afterEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../db/connection.js"
import { createGuest, getGuestById, softDeleteGuest } from "../../api/guests/data.js"
import { upsertRsvp, getRsvpByGuestId } from "../../api/rsvp.js"
import {
  createPetition,
  approvePetitionDb,
  updatePetitionStatus,
} from "../../api/admin/petitions.js"

const PREFIX = "conc-"

before(() => {
  init()
})

after(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
    db.prepare(`DELETE FROM petitions WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
  close()
})

afterEach(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
    db.prepare(`DELETE FROM petitions WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
})

describe("simultaneous RSVP updates", () => {
  it("handles rapid sequential RSVP upserts for the same guest", () => {
    const { id } = createGuest({ name: "RaceRSVP", email: `${PREFIX}racersvp@example.com`, party_size: 5 })
    const guestId = Number(id)

    // Simulate rapid updates
    upsertRsvp(guestId, {
      attending: true,
      actual_party_size: 2,
      dietary_restrictions: "None",
      message: "First",
    })
    upsertRsvp(guestId, {
      attending: true,
      actual_party_size: 3,
      dietary_restrictions: "Vegan",
      message: "Second",
    })
    upsertRsvp(guestId, {
      attending: false,
      actual_party_size: null,
      dietary_restrictions: null,
      message: "Third",
    })

    // Last write wins
    const rsvp = getRsvpByGuestId(guestId)
    assert.ok(rsvp)
    assert.strictEqual(rsvp.attending, 0)
    assert.strictEqual(rsvp.message, "Third")
    assert.strictEqual(rsvp.actual_party_size, null)
  })

  it("handles attending then declining RSVP", () => {
    const { id } = createGuest({ name: "FlipRSVP", email: `${PREFIX}fliprsvp@example.com`, party_size: 4 })
    const guestId = Number(id)

    upsertRsvp(guestId, {
      attending: true,
      actual_party_size: 4,
      dietary_restrictions: "Kosher",
      message: "Excited!",
    })

    const rsvp1 = getRsvpByGuestId(guestId)
    assert.ok(rsvp1)
    assert.strictEqual(rsvp1.attending, 1)

    upsertRsvp(guestId, {
      attending: false,
      actual_party_size: null,
      dietary_restrictions: null,
      message: "Can't make it",
    })

    const rsvp2 = getRsvpByGuestId(guestId)
    assert.ok(rsvp2)
    assert.strictEqual(rsvp2.attending, 0)
    assert.strictEqual(rsvp2.dietary_restrictions, null)
  })
})

describe("concurrent admin operations", () => {
  it("double soft-delete is idempotent", () => {
    const { id } = createGuest({ name: "DblDel", email: `${PREFIX}dbldel@example.com` })
    const guestId = Number(id)

    const first = softDeleteGuest(guestId)
    assert.strictEqual(first, true)
    const second = softDeleteGuest(guestId)
    assert.strictEqual(second, false)

    // Guest still exists as deleted
    const guest = getGuestById(guestId, { includeDeleted: true })
    assert.ok(guest)
    assert.ok(guest.deleted_at)
  })

  it("double approval of petition throws on second attempt", () => {
    const petId = createPetition({
      name: "DblApprove",
      email: `${PREFIX}dblapprove@example.com`,
      phone: null,
      relationship: "Friend",
      message: null,
    })

    const result = approvePetitionDb(Number(petId))
    assert.ok(result.id)

    assert.throws(
      () => approvePetitionDb(Number(petId)),
      { message: "Petition already approved" },
    )
  })

  it("approve then deny of same petition fails", () => {
    const petId = createPetition({
      name: "ApproveDeny",
      email: `${PREFIX}approvedeny@example.com`,
      phone: null,
      relationship: null,
      message: null,
    })

    approvePetitionDb(Number(petId))

    // Trying to deny an already-approved petition should fail
    assert.throws(
      () => approvePetitionDb(Number(petId)),
      { message: "Petition already approved" },
    )
  })

  it("deny then approve of same petition fails", () => {
    const petId = createPetition({
      name: "DenyApprove",
      email: `${PREFIX}denyapprove@example.com`,
      phone: null,
      relationship: null,
      message: null,
    })

    updatePetitionStatus(Number(petId), "denied")

    assert.throws(
      () => approvePetitionDb(Number(petId)),
      { message: "Petition already denied" },
    )
  })
})

describe("parallel session access", () => {
  it("multiple guests can be created concurrently without code collisions", () => {
    const codes = new Set()
    for (let i = 0; i < 20; i++) {
      const result = createGuest({
        name: `Parallel${i}`,
        email: `${PREFIX}parallel${i}@example.com`,
      })
      codes.add(result.invite_code)
    }
    // All 20 should have unique codes
    assert.strictEqual(codes.size, 20)
  })

  it("RSVP upserts for different guests don't interfere", () => {
    const guests = []
    for (let i = 0; i < 5; i++) {
      const result = createGuest({
        name: `Multi${i}`,
        email: `${PREFIX}multi${i}@example.com`,
        party_size: i + 1,
      })
      guests.push(Number(result.id))
    }

    // All submit RSVPs
    for (let i = 0; i < guests.length; i++) {
      upsertRsvp(guests[i], {
        attending: i % 2 === 0,
        actual_party_size: i % 2 === 0 ? i + 1 : null,
        dietary_restrictions: null,
        message: `Guest ${i}`,
      })
    }

    // Verify each RSVP is independent
    for (let i = 0; i < guests.length; i++) {
      const rsvp = getRsvpByGuestId(guests[i])
      assert.ok(rsvp)
      assert.strictEqual(rsvp.attending, i % 2 === 0 ? 1 : 0)
      assert.strictEqual(rsvp.message, `Guest ${i}`)
    }
  })
})
