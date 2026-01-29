/**
 * @file Unit tests for api/guests/data.js — Guest CRUD and query functions
 */

import { describe, it, before, after, afterEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import {
  getGuestByInviteCode,
  getGuestByEmail,
  getGuestByPhone,
  getGuestById,
  getGuestsByIds,
  getAllGuests,
  countGuests,
  createGuest,
  updateGuest,
  softDeleteGuest,
  restoreGuest,
  hardDeleteGuest,
  updateGuestInvitedAt,
} from "../../../api/guests/data.js"

const PREFIX = "gdata-"

before(() => {
  init()
})

after(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM rsvps WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM communications WHERE guest_id IN (SELECT id FROM guests WHERE email LIKE '${PREFIX}%')`).run()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* table may not exist */ }
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

describe("createGuest", () => {
  it("creates a guest and returns id + invite_code", () => {
    const result = createGuest({
      name: "Alice",
      email: `${PREFIX}alice@example.com`,
      phone: "+15551234567",
      party_size: 3,
      notes: "VIP",
    })
    assert.ok(result.id)
    assert.ok(result.invite_code)
    assert.strictEqual(typeof result.invite_code, "string")
    assert.strictEqual(result.invite_code.length, 8)
  })

  it("creates guest with minimal fields", () => {
    const result = createGuest({
      name: "Bob",
      email: `${PREFIX}bob@example.com`,
    })
    assert.ok(result.id)
    assert.ok(result.invite_code)
  })

  it("normalizes email to lowercase", () => {
    const result = createGuest({
      name: "Carol",
      email: `${PREFIX}CAROL@EXAMPLE.COM`,
    })
    const guest = getGuestById(Number(result.id))
    assert.ok(guest)
    assert.strictEqual(guest.email, `${PREFIX}carol@example.com`)
  })

  it("generates unique invite codes", () => {
    const r1 = createGuest({ name: "D1", email: `${PREFIX}d1@example.com` })
    const r2 = createGuest({ name: "D2", email: `${PREFIX}d2@example.com` })
    assert.notStrictEqual(r1.invite_code, r2.invite_code)
  })
})

describe("getGuestByInviteCode", () => {
  it("finds guest by invite code", () => {
    const { invite_code } = createGuest({ name: "Eve", email: `${PREFIX}eve@example.com` })
    const guest = getGuestByInviteCode(invite_code)
    assert.ok(guest)
    assert.strictEqual(guest.name, "Eve")
  })

  it("returns undefined for unknown code", () => {
    assert.strictEqual(getGuestByInviteCode("ZZZZZZZZ"), undefined)
  })

  it("excludes soft-deleted guests", () => {
    const { id, invite_code } = createGuest({ name: "Del", email: `${PREFIX}del@example.com` })
    softDeleteGuest(Number(id))
    assert.strictEqual(getGuestByInviteCode(invite_code), undefined)
  })
})

describe("getGuestByEmail", () => {
  it("finds guest by email", () => {
    createGuest({ name: "Frank", email: `${PREFIX}frank@example.com` })
    const guest = getGuestByEmail(`${PREFIX}frank@example.com`)
    assert.ok(guest)
    assert.strictEqual(guest.name, "Frank")
  })

  it("returns undefined for unknown email", () => {
    assert.strictEqual(getGuestByEmail(`${PREFIX}nobody@example.com`), undefined)
  })

  it("is case-insensitive", () => {
    createGuest({ name: "Grace", email: `${PREFIX}grace@example.com` })
    const guest = getGuestByEmail(`${PREFIX}GRACE@EXAMPLE.COM`)
    assert.ok(guest)
    assert.strictEqual(guest.name, "Grace")
  })
})

describe("getGuestByPhone", () => {
  it("finds guest by normalized phone", () => {
    createGuest({ name: "Hank", email: `${PREFIX}hank@example.com`, phone: "+15559876543" })
    const guest = getGuestByPhone("+15559876543")
    assert.ok(guest)
    assert.strictEqual(guest.name, "Hank")
  })

  it("returns undefined for unknown phone", () => {
    assert.strictEqual(getGuestByPhone("+10000000000"), undefined)
  })
})

describe("getGuestById", () => {
  it("finds guest by id", () => {
    const { id } = createGuest({ name: "Iris", email: `${PREFIX}iris@example.com` })
    const guest = getGuestById(Number(id))
    assert.ok(guest)
    assert.strictEqual(guest.name, "Iris")
  })

  it("returns undefined for non-existent id", () => {
    assert.strictEqual(getGuestById(999999), undefined)
  })

  it("excludes soft-deleted by default", () => {
    const { id } = createGuest({ name: "Jack", email: `${PREFIX}jack@example.com` })
    softDeleteGuest(Number(id))
    assert.strictEqual(getGuestById(Number(id)), undefined)
  })

  it("includes soft-deleted with option", () => {
    const { id } = createGuest({ name: "Kate", email: `${PREFIX}kate@example.com` })
    softDeleteGuest(Number(id))
    const guest = getGuestById(Number(id), { includeDeleted: true })
    assert.ok(guest)
    assert.strictEqual(guest.name, "Kate")
    assert.ok(guest.deleted_at)
  })
})

describe("getGuestsByIds", () => {
  it("returns multiple guests by ids", () => {
    const { id: id1 } = createGuest({ name: "L1", email: `${PREFIX}l1@example.com` })
    const { id: id2 } = createGuest({ name: "L2", email: `${PREFIX}l2@example.com` })
    const guests = getGuestsByIds([Number(id1), Number(id2)])
    assert.strictEqual(guests.length, 2)
  })

  it("returns empty array for empty ids", () => {
    assert.deepStrictEqual(getGuestsByIds([]), [])
  })

  it("excludes soft-deleted by default", () => {
    const { id } = createGuest({ name: "L3", email: `${PREFIX}l3@example.com` })
    softDeleteGuest(Number(id))
    const guests = getGuestsByIds([Number(id)])
    assert.strictEqual(guests.length, 0)
  })
})

describe("getAllGuests", () => {
  it("returns guests with invite_count", () => {
    createGuest({ name: "M1", email: `${PREFIX}m1@example.com` })
    const guests = getAllGuests({ search: PREFIX })
    assert.ok(guests.length >= 1)
    const g = guests[0]
    assert.ok("invite_count" in g)
  })

  it("filters by status", () => {
    const { id } = createGuest({ name: "M2", email: `${PREFIX}m2@example.com` })
    updateGuest(Number(id), { status: "invited" })
    const pending = getAllGuests({ search: PREFIX, status: "pending" })
    const invited = getAllGuests({ search: PREFIX, status: "invited" })
    assert.ok(!pending.find((g) => g.name === "M2"))
    assert.ok(invited.find((g) => g.name === "M2"))
  })

  it("filters by search term", () => {
    createGuest({ name: "UniqueSearchName", email: `${PREFIX}search@example.com` })
    const guests = getAllGuests({ search: "UniqueSearchName" })
    assert.ok(guests.length >= 1)
    assert.ok(guests.find((g) => g.name === "UniqueSearchName"))
  })

  it("respects limit and offset", () => {
    createGuest({ name: "P1", email: `${PREFIX}p1@example.com` })
    createGuest({ name: "P2", email: `${PREFIX}p2@example.com` })
    createGuest({ name: "P3", email: `${PREFIX}p3@example.com` })
    const page1 = getAllGuests({ search: PREFIX, limit: 2, offset: 0 })
    const page2 = getAllGuests({ search: PREFIX, limit: 2, offset: 2 })
    assert.ok(page1.length <= 2)
    assert.ok(page2.length <= 2)
  })

  it("excludes soft-deleted by default", () => {
    const { id } = createGuest({ name: "DelTest", email: `${PREFIX}deltest@example.com` })
    softDeleteGuest(Number(id))
    const guests = getAllGuests({ search: "DelTest" })
    assert.strictEqual(guests.filter((g) => g.name === "DelTest").length, 0)
  })

  it("shows only deleted with onlyDeleted", () => {
    const { id } = createGuest({ name: "OnlyDel", email: `${PREFIX}onlydel@example.com` })
    softDeleteGuest(Number(id))
    const guests = getAllGuests({ search: "OnlyDel", onlyDeleted: true })
    assert.ok(guests.find((g) => g.name === "OnlyDel"))
  })
})

describe("countGuests", () => {
  it("counts guests matching search", () => {
    createGuest({ name: "Count1", email: `${PREFIX}count1@example.com` })
    createGuest({ name: "Count2", email: `${PREFIX}count2@example.com` })
    const count = countGuests({ search: PREFIX })
    assert.ok(count >= 2)
  })

  it("counts by status", () => {
    createGuest({ name: "CS1", email: `${PREFIX}cs1@example.com` })
    const count = countGuests({ search: PREFIX, status: "pending" })
    assert.ok(count >= 1)
  })

  it("excludes soft-deleted by default", () => {
    const { id } = createGuest({ name: "CD1", email: `${PREFIX}cd1@example.com` })
    const before = countGuests({ search: PREFIX })
    softDeleteGuest(Number(id))
    const afterDel = countGuests({ search: PREFIX })
    assert.strictEqual(afterDel, before - 1)
  })
})

describe("updateGuest", () => {
  it("updates name", () => {
    const { id } = createGuest({ name: "Old Name", email: `${PREFIX}upd1@example.com` })
    const changed = updateGuest(Number(id), { name: "New Name" })
    assert.strictEqual(changed, true)
    const guest = getGuestById(Number(id))
    assert.ok(guest)
    assert.strictEqual(guest.name, "New Name")
  })

  it("updates multiple fields", () => {
    const { id } = createGuest({ name: "U2", email: `${PREFIX}u2@example.com`, party_size: 1 })
    updateGuest(Number(id), { party_size: 5, notes: "Updated notes" })
    const guest = getGuestById(Number(id))
    assert.ok(guest)
    assert.strictEqual(guest.party_size, 5)
    assert.strictEqual(guest.notes, "Updated notes")
  })

  it("returns false when no fields provided", () => {
    const { id } = createGuest({ name: "U3", email: `${PREFIX}u3@example.com` })
    const changed = updateGuest(Number(id), {})
    assert.strictEqual(changed, false)
  })

  it("sets updated_at timestamp", () => {
    const { id } = createGuest({ name: "U4", email: `${PREFIX}u4@example.com` })
    const before = getGuestById(Number(id))
    updateGuest(Number(id), { name: "U4 Updated" })
    const afterUpd = getGuestById(Number(id))
    assert.ok(before)
    assert.ok(afterUpd)
    assert.ok(afterUpd.updated_at)
  })
})

describe("softDeleteGuest", () => {
  it("sets deleted_at timestamp", () => {
    const { id } = createGuest({ name: "SD1", email: `${PREFIX}sd1@example.com` })
    const result = softDeleteGuest(Number(id))
    assert.strictEqual(result, true)
    const guest = getGuestById(Number(id), { includeDeleted: true })
    assert.ok(guest)
    assert.ok(guest.deleted_at)
  })

  it("returns false for already-deleted guest", () => {
    const { id } = createGuest({ name: "SD2", email: `${PREFIX}sd2@example.com` })
    softDeleteGuest(Number(id))
    const result = softDeleteGuest(Number(id))
    assert.strictEqual(result, false)
  })

  it("returns false for non-existent guest", () => {
    assert.strictEqual(softDeleteGuest(999999), false)
  })
})

describe("restoreGuest", () => {
  it("clears deleted_at on soft-deleted guest", () => {
    const { id } = createGuest({ name: "R1", email: `${PREFIX}r1@example.com` })
    softDeleteGuest(Number(id))
    const result = restoreGuest(Number(id))
    assert.strictEqual(result, true)
    const guest = getGuestById(Number(id))
    assert.ok(guest)
    assert.strictEqual(guest.deleted_at, null)
  })

  it("returns false for non-deleted guest", () => {
    const { id } = createGuest({ name: "R2", email: `${PREFIX}r2@example.com` })
    assert.strictEqual(restoreGuest(Number(id)), false)
  })
})

describe("hardDeleteGuest", () => {
  it("permanently removes guest", () => {
    const { id } = createGuest({ name: "H1", email: `${PREFIX}h1@example.com` })
    const result = hardDeleteGuest(Number(id))
    assert.strictEqual(result, true)
    assert.strictEqual(getGuestById(Number(id), { includeDeleted: true }), undefined)
  })

  it("returns false for non-existent guest", () => {
    assert.strictEqual(hardDeleteGuest(999999), false)
  })
})

describe("updateGuestInvitedAt", () => {
  it("sets last_invited_at and changes pending to invited", () => {
    const { id } = createGuest({ name: "Inv1", email: `${PREFIX}inv1@example.com` })
    updateGuestInvitedAt(Number(id))
    const guest = getGuestById(Number(id))
    assert.ok(guest)
    assert.ok(guest.last_invited_at)
    assert.strictEqual(guest.status, "invited")
  })

  it("does not change status if already responded", () => {
    const { id } = createGuest({ name: "Inv2", email: `${PREFIX}inv2@example.com` })
    updateGuest(Number(id), { status: "responded" })
    updateGuestInvitedAt(Number(id))
    const guest = getGuestById(Number(id))
    assert.ok(guest)
    assert.strictEqual(guest.status, "responded")
  })
})
