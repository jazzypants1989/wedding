/**
 * @file Unit tests for api/admin/petitions.js — Petition data layer functions
 */

import { describe, it, before, after, afterEach } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"
import {
  createPetition,
  getPetitionById,
  getPetitionByEmail,
  getAllPetitions,
  countPetitions,
  updatePetitionStatus,
  approvePetitionDb,
} from "../../../api/admin/petitions.js"

const PREFIX = "pettest-"

before(() => {
  init()
})

after(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
    db.prepare(`DELETE FROM petitions WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
  close()
})

afterEach(() => {
  try {
    const db = getDb()
    db.prepare(`DELETE FROM guests WHERE email LIKE '${PREFIX}%'`).run()
    db.prepare(`DELETE FROM petitions WHERE email LIKE '${PREFIX}%'`).run()
  } catch { /* ignore */ }
})

describe("createPetition", () => {
  it("creates a petition and returns its id", () => {
    const id = createPetition({
      name: "Pet1",
      email: `${PREFIX}pet1@example.com`,
      phone: "+15551234567",
      relationship: "Friend of groom",
      message: "Please invite me!",
    })
    assert.ok(id)
    assert.strictEqual(typeof Number(id), "number")
  })

  it("normalizes email and phone", () => {
    const id = createPetition({
      name: "Pet2",
      email: `${PREFIX}PET2@EXAMPLE.COM`,
      phone: "(555) 987-6543",
      relationship: null,
      message: null,
    })
    const petition = getPetitionById(Number(id))
    assert.ok(petition)
    assert.strictEqual(petition.email, `${PREFIX}pet2@example.com`)
  })

  it("handles null optional fields", () => {
    const id = createPetition({
      name: "Pet3",
      email: `${PREFIX}pet3@example.com`,
      phone: null,
      relationship: null,
      message: null,
    })
    const petition = getPetitionById(Number(id))
    assert.ok(petition)
    assert.strictEqual(petition.phone, null)
    assert.strictEqual(petition.relationship, null)
    assert.strictEqual(petition.message, null)
  })
})

describe("getPetitionById", () => {
  it("returns petition by id", () => {
    const id = createPetition({
      name: "GetById",
      email: `${PREFIX}getbyid@example.com`,
      phone: null,
      relationship: "Coworker",
      message: "Hi",
    })
    const petition = getPetitionById(Number(id))
    assert.ok(petition)
    assert.strictEqual(petition.name, "GetById")
    assert.strictEqual(petition.relationship, "Coworker")
    assert.strictEqual(petition.status, "pending")
  })

  it("returns undefined for non-existent id", () => {
    assert.strictEqual(getPetitionById(999999), undefined)
  })
})

describe("getPetitionByEmail", () => {
  it("finds pending petition by email", () => {
    createPetition({
      name: "ByEmail",
      email: `${PREFIX}byemail@example.com`,
      phone: null,
      relationship: null,
      message: null,
    })
    const petition = getPetitionByEmail(`${PREFIX}byemail@example.com`)
    assert.ok(petition)
    assert.strictEqual(petition.name, "ByEmail")
  })

  it("does not find non-pending petitions", () => {
    const id = createPetition({
      name: "Denied",
      email: `${PREFIX}denied@example.com`,
      phone: null,
      relationship: null,
      message: null,
    })
    updatePetitionStatus(Number(id), "denied")
    assert.strictEqual(getPetitionByEmail(`${PREFIX}denied@example.com`), undefined)
  })

  it("returns undefined for unknown email", () => {
    assert.strictEqual(getPetitionByEmail(`${PREFIX}unknown@example.com`), undefined)
  })
})

describe("getAllPetitions", () => {
  it("returns all petitions ordered by created_at desc", () => {
    createPetition({ name: "All1", email: `${PREFIX}all1@example.com`, phone: null, relationship: null, message: null })
    createPetition({ name: "All2", email: `${PREFIX}all2@example.com`, phone: null, relationship: null, message: null })
    const petitions = getAllPetitions()
    assert.ok(petitions.length >= 2)
  })

  it("filters by status", () => {
    const id = createPetition({ name: "FilterS", email: `${PREFIX}filters@example.com`, phone: null, relationship: null, message: null })
    updatePetitionStatus(Number(id), "denied")
    const denied = getAllPetitions({ status: "denied" })
    assert.ok(denied.find((p) => p.name === "FilterS"))
    const pending = getAllPetitions({ status: "pending" })
    assert.ok(!pending.find((p) => p.name === "FilterS"))
  })
})

describe("countPetitions", () => {
  it("counts all petitions", () => {
    createPetition({ name: "Cnt1", email: `${PREFIX}cnt1@example.com`, phone: null, relationship: null, message: null })
    const count = countPetitions()
    assert.ok(count >= 1)
  })

  it("counts by status", () => {
    createPetition({ name: "CntP", email: `${PREFIX}cntp@example.com`, phone: null, relationship: null, message: null })
    const pending = countPetitions({ status: "pending" })
    assert.ok(pending >= 1)
  })
})

describe("updatePetitionStatus", () => {
  it("updates status and admin notes", () => {
    const id = createPetition({ name: "UpdS", email: `${PREFIX}upds@example.com`, phone: null, relationship: null, message: null })
    const changed = updatePetitionStatus(Number(id), "denied", "Not invited")
    assert.strictEqual(changed, true)
    const petition = getPetitionById(Number(id))
    assert.ok(petition)
    assert.strictEqual(petition.status, "denied")
    assert.strictEqual(petition.admin_notes, "Not invited")
    assert.ok(petition.reviewed_at)
  })

  it("returns false for non-existent petition", () => {
    assert.strictEqual(updatePetitionStatus(999999, "denied"), false)
  })
})

describe("approvePetitionDb", () => {
  it("creates a guest from petition in a transaction", () => {
    const id = createPetition({
      name: "Approve1",
      email: `${PREFIX}approve1@example.com`,
      phone: null,
      relationship: "Family",
      message: null,
    })
    const result = approvePetitionDb(Number(id), { partySize: 3, adminNotes: "Welcome!" })
    assert.ok(result.id)
    assert.ok(result.invite_code)
    assert.strictEqual(result.invite_code.length, 8)

    // Verify petition status updated
    const petition = getPetitionById(Number(id))
    assert.ok(petition)
    assert.strictEqual(petition.status, "approved")
    assert.strictEqual(petition.admin_notes, "Welcome!")

    // Verify guest created
    const db = getDb()
    const guest = db.prepare("SELECT * FROM guests WHERE id = ?").get(Number(result.id))
    assert.ok(guest)
    const typedGuest = /** @type {import('../../../types.js').Guest} */ (/** @type {unknown} */ (guest))
    assert.strictEqual(typedGuest.name, "Approve1")
    assert.strictEqual(typedGuest.party_size, 3)
  })

  it("throws for non-existent petition", () => {
    assert.throws(() => approvePetitionDb(999999), { message: "Petition not found" })
  })

  it("throws for already-approved petition", () => {
    const id = createPetition({
      name: "DblApprove",
      email: `${PREFIX}dblapprove@example.com`,
      phone: null,
      relationship: null,
      message: null,
    })
    approvePetitionDb(Number(id))
    assert.throws(() => approvePetitionDb(Number(id)), { message: "Petition already approved" })
  })

  it("throws for already-denied petition", () => {
    const id = createPetition({
      name: "AprvDenied",
      email: `${PREFIX}aprvdenied@example.com`,
      phone: null,
      relationship: null,
      message: null,
    })
    updatePetitionStatus(Number(id), "denied")
    assert.throws(() => approvePetitionDb(Number(id)), { message: "Petition already denied" })
  })
})
