/**
 * @file Integration tests for API endpoints
 */
/** @import { TestGuest, TestBlocklistEntry, TestPetition, AdminAuth, ApiData, HealthResponse, RSVPGetResponse, RSVPPostResponse, ErrorResponse, PetitionResponse, LookupBlockedResponse, StatsResponse, GuestListResponse, GuestResponse, RSVPListResponse, InvitableIdsResponse, ConfigResponse, PetitionListResponse, BlocklistResponse, BlocklistCreateResponse, ImportResponse, ManualSmsGuestsResponse, ManualSmsMarkSentResponse, ManualSmsBatchResponse } from '../helpers.js' */
/** @import { DatabaseSync } from 'node:sqlite' */

import { describe, it, before, after, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import {
  startServer,
  stopServer,
  getTestDb,
  createTestGuest,
  deleteTestGuest,
  createTestPetition,
  deleteTestPetition,
  addToBlocklist,
  removeFromBlocklist,
  adminLogin,
  adminFetch,
  cleanupTestData,
  BASE_URL,
} from "../helpers.js"
import { CONTENT } from "../../content.js"

/** @type {DatabaseSync} */
let db

// Small delay to avoid rate limiting between tests
const rateLimitDelay = () => new Promise((r) => setTimeout(r, 100))

describe("API Integration Tests", async () => {
  before(async () => {
    db = getTestDb()
    cleanupTestData(db)
    await startServer()
  })

  after(async () => {
    cleanupTestData(db)
    db.close()
    await stopServer()
  })

  // ==================== Health Check ====================

  describe("Health Check", () => {
    it("GET /api/health returns 200 with status ok", async () => {
      const res = await fetch(`${BASE_URL}/api/health`)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<HealthResponse>} */ (await res.json())
      assert.strictEqual(data.status, "ok")
      assert.ok(data.timestamp)
    })
  })

  // ==================== Public Config ====================

  describe("Public Config", () => {
    it("GET /api/config returns mode + coupleDisplay from content.js", async () => {
      const res = await fetch(`${BASE_URL}/api/config`)
      assert.strictEqual(res.status, 200)

      const data = /** @type {{ mode: string; coupleDisplay: string; features: object; contactEmail: string }} */ (
        await res.json()
      )
      assert.ok(data.mode === "pre" || data.mode === "post", "mode is a timeline mode")
      assert.strictEqual(data.coupleDisplay, CONTENT.couple.display)
      assert.ok(data.features, "features present")
      assert.strictEqual(typeof data.contactEmail, "string")
    })
  })

  // ==================== RSVP Endpoints ====================

  describe("RSVP Endpoints", () => {
    /** @type {TestGuest} */
    let testGuest

    beforeEach(async () => {
      await rateLimitDelay()
      testGuest = createTestGuest(db)
    })

    afterEach(() => {
      if (testGuest) {
        deleteTestGuest(db, testGuest.invite_code)
      }
    })

    it("GET /api/rsvp/:code returns guest data for valid code", async () => {
      const res = await fetch(`${BASE_URL}/api/rsvp/${testGuest.invite_code}`)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<RSVPGetResponse>} */ (await res.json())
      assert.strictEqual(data.guest.name, testGuest.name)
      assert.strictEqual(data.guest.party_size, testGuest.party_size)
      assert.strictEqual(data.rsvp, null)
    })

    it("GET /api/rsvp/:code returns 400 for invalid code format", async () => {
      const res = await fetch(`${BASE_URL}/api/rsvp/invalid!`)
      assert.strictEqual(res.status, 400)

      const data = /** @type {ApiData<ErrorResponse>} */ (await res.json())
      assert.ok(data.error.includes("Invalid invite code"))
    })

    it("GET /api/rsvp/:code returns 404 for non-existent code", async () => {
      const res = await fetch(`${BASE_URL}/api/rsvp/ZZZZZZZZ`)
      assert.strictEqual(res.status, 404)
    })

    it("POST /api/rsvp/:code creates RSVP when attending", async () => {
      const res = await fetch(`${BASE_URL}/api/rsvp/${testGuest.invite_code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attending: true,
          actual_party_size: 2,
          dietary_restrictions: "Vegetarian",
          message: "So excited!",
        }),
      })

      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<RSVPPostResponse>} */ (await res.json())
      assert.strictEqual(data.success, true)
    })

    it("POST /api/rsvp/:code creates RSVP when not attending", async () => {
      const res = await fetch(`${BASE_URL}/api/rsvp/${testGuest.invite_code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attending: false,
          message: "Sorry, cannot make it",
        }),
      })

      assert.strictEqual(res.status, 200)
    })

    it("POST /api/rsvp/:code rejects party size exceeding limit", async () => {
      const res = await fetch(`${BASE_URL}/api/rsvp/${testGuest.invite_code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attending: true,
          actual_party_size: 10, // Guest only allowed 2
        }),
      })

      assert.strictEqual(res.status, 400)
      const data = /** @type {ApiData<ErrorResponse>} */ (await res.json())
      assert.ok(data.error.includes("cannot exceed"))
    })

    it("POST /api/rsvp/:code requires attending field", async () => {
      const res = await fetch(`${BASE_URL}/api/rsvp/${testGuest.invite_code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual_party_size: 2 }),
      })

      assert.strictEqual(res.status, 400)
      const data = /** @type {ApiData<ErrorResponse>} */ (await res.json())
      assert.ok(data.error.includes("attending"))
    })

    it("POST /api/rsvp/:code can update existing RSVP", async () => {
      // Create initial RSVP directly in DB to avoid rate limit
      db.prepare(
        `
        INSERT INTO rsvps (guest_id, attending, actual_party_size)
        VALUES (?, 1, 1)
      `
      ).run(testGuest.id)

      await rateLimitDelay()

      // Update via API
      const res = await fetch(`${BASE_URL}/api/rsvp/${testGuest.invite_code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attending: true, actual_party_size: 2 }),
      })

      assert.strictEqual(res.status, 200)

      // Verify update in DB
      const rsvp = db
        .prepare("SELECT actual_party_size FROM rsvps WHERE guest_id = ?")
        .get(testGuest.id)
      assert.ok(rsvp)
      assert.strictEqual(rsvp.actual_party_size, 2)
    })

    it("POST /api/rsvp/:code stores and returns additional_info", async () => {
      const postRes = await fetch(
        `${BASE_URL}/api/rsvp/${testGuest.invite_code}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attending: true,
            actual_party_size: 1,
            additional_info: "Wheelchair access needed",
          }),
        }
      )
      assert.strictEqual(postRes.status, 200)

      await rateLimitDelay()

      const getRes = await fetch(`${BASE_URL}/api/rsvp/${testGuest.invite_code}`)
      assert.strictEqual(getRes.status, 200)
      const data = /** @type {ApiData<RSVPGetResponse>} */ (await getRes.json())
      assert.ok(data.rsvp)
      assert.strictEqual(data.rsvp.additional_info, "Wheelchair access needed")
    })
  })

  // ==================== Guest Lookup ====================

  describe("Guest Lookup", () => {
    /** @type {TestGuest} */
    let testGuest

    before(async () => {
      await rateLimitDelay()
      testGuest = createTestGuest(db, {
        name: "Lookup Test Guest",
        email: "lookup-test@example.com",
        status: "invited",
      })
    })

    after(() => {
      deleteTestGuest(db, testGuest.invite_code)
    })

    it("POST /api/lookup accepts request without name when name lookup disabled", async () => {
      await rateLimitDelay()
      const res = await fetch(`${BASE_URL}/api/lookup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "10.0.0.1",
        },
        body: JSON.stringify({ email: "test@example.com" }),
      })

      assert.strictEqual(res.status, 200)
    })

    it("POST /api/lookup requires email or phone", async () => {
      await rateLimitDelay()
      const res = await fetch(`${BASE_URL}/api/lookup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "10.0.0.1",
        },
        body: JSON.stringify({ name: "Test Person" }),
      })

      assert.strictEqual(res.status, 400)
    })

    it("POST /api/lookup accepts valid request", async () => {
      await rateLimitDelay()
      const res = await fetch(`${BASE_URL}/api/lookup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "10.0.0.1",
        },
        body: JSON.stringify({
          name: testGuest.name,
          email: testGuest.email,
        }),
      })

      // Should succeed (200) - either found guest or returned appropriate response
      assert.strictEqual(res.status, 200)
    })

    it("POST /api/lookup surfaces a prior petition's status (server truth)", async () => {
      await rateLimitDelay()
      const email = `denied-lookup-${Date.now()}@example.com`
      createTestPetition(db, { email, status: "denied" })
      const res = await fetch(`${BASE_URL}/api/lookup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "10.0.0.9",
        },
        body: JSON.stringify({ email }),
      })

      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<{ found: boolean, petitionStatus?: string | null }>} */ (
        await res.json()
      )
      // No guest match, but the lookup relays the denied petition so the client
      // can clear its stale "still under review" note and let them re-file.
      assert.strictEqual(data.found, false)
      assert.strictEqual(data.petitionStatus, "denied")
    })
  })

  // ==================== Petition Endpoint ====================
  // Uses different X-Forwarded-For IP to isolate from Lookup rate limits

  describe("Petition Endpoint", () => {
    /** @type {TestBlocklistEntry | null} */
    let blockedEntry = null
    const PETITION_IP = "10.0.0.2" // Different IP than Lookup tests

    afterEach(() => {
      if (blockedEntry) {
        removeFromBlocklist(db, blockedEntry.id)
        blockedEntry = null
      }
      db.prepare(
        `DELETE FROM petitions WHERE email LIKE 'petition-test-%'`
      ).run()
    })

    it("POST /api/petition creates a petition with valid data", async () => {
      const email = `petition-test-${Date.now()}@example.com`

      const res = await fetch(`${BASE_URL}/api/petition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": PETITION_IP,
        },
        body: JSON.stringify({
          name: "New Person",
          email,
          relationship: "Coworker",
          message: "Would love to attend!",
        }),
      })

      assert.strictEqual(res.status, 201) // 201 Created
      const data = /** @type {ApiData<PetitionResponse>} */ (await res.json())
      assert.ok(data.success)

      // Verify in DB
      const petition = db
        .prepare("SELECT * FROM petitions WHERE email = ?")
        .get(email)
      assert.ok(petition)
      assert.strictEqual(petition.status, "pending")
    })

    it("POST /api/petition requires name and email", async () => {
      const res = await fetch(`${BASE_URL}/api/petition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": PETITION_IP,
        },
        body: JSON.stringify({ message: "Please invite me!" }),
      })

      assert.strictEqual(res.status, 400)
    })

    it("POST /api/petition returns identical not-found response for blocked email", async () => {
      const blockedEmail = `blocked-${Date.now()}@example.com`
      blockedEntry = addToBlocklist(db, { email: blockedEmail })

      const res = await fetch(`${BASE_URL}/api/petition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": PETITION_IP,
        },
        body: JSON.stringify({
          name: "Blocked Person",
          email: blockedEmail,
          relationship: "Unknown",
        }),
      })

      // Blocked users get identical 200 response to prevent info leakage
      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<LookupBlockedResponse>} */ (await res.json())
      assert.strictEqual(data.found, false)
      assert.strictEqual(data.canPetition, true)
    })

    it("POST /api/petition rejects duplicate pending petition", async () => {
      const email = `petition-test-dup-${Date.now()}@example.com`

      // Create first petition directly in DB
      db.prepare(
        `
        INSERT INTO petitions (name, email, relationship, status)
        VALUES (?, ?, ?, 'pending')
      `
      ).run("Person", email, "Friend")

      const res = await fetch(`${BASE_URL}/api/petition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "10.0.0.3",
        }, // Different IP for fresh rate limit bucket
        body: JSON.stringify({ name: "Person", email, relationship: "Friend" }),
      })

      assert.strictEqual(res.status, 409)
    })
  })

  // ==================== Admin Endpoints ====================
  // These tests require TEST_ADMIN_PASSWORD to be set

  describe("Admin Endpoints", () => {
    /** @type {AdminAuth} */
    let auth
    /** @type {TestGuest} */
    let testGuest
    let adminConfigured = false

    before(async () => {
      // Check if admin is configured
      const checkRes = await fetch(`${BASE_URL}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "test" }),
      })

      // 503 means admin not configured, 401 means configured but wrong password
      if (checkRes.status === 401) {
        adminConfigured = true
        // Try to login with test password
        const password = process.env.TEST_ADMIN_PASSWORD
        if (password) {
          try {
            auth = await adminLogin(password)
          } catch (e) {
            console.log("Admin login failed - check TEST_ADMIN_PASSWORD")
          }
        }
      }

      if (!auth) {
        console.log(
          "Skipping authenticated admin tests (set TEST_ADMIN_PASSWORD)"
        )
      }
    })

    beforeEach(async () => {
      if (auth) {
        await rateLimitDelay()
        testGuest = createTestGuest(db)
      }
    })

    afterEach(() => {
      if (testGuest) {
        deleteTestGuest(db, testGuest.invite_code)
      }
    })

    it("Admin endpoints return 401 without session cookie", async () => {
      const res = await fetch(`${BASE_URL}/api/admin/stats`)
      assert.strictEqual(res.status, 401)
    })

    it("GET /api/admin/stats returns statistics", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/stats", {}, auth)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<StatsResponse>} */ (await res.json())
      assert.ok(data.stats, "Response should have stats object")
      assert.ok(typeof data.stats.total_guests === "number")
      assert.ok(typeof data.stats.responded === "number")
      assert.ok(typeof data.stats.attending_yes === "number")
    })

    it("GET /api/admin/guests returns guest list with pagination", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch(
        "/api/admin/guests?page=1&limit=10",
        {},
        auth
      )
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<GuestListResponse>} */ (await res.json())
      assert.ok(Array.isArray(data.guests))
      assert.ok(typeof data.pagination.total === "number")
      assert.ok(data.guests.length <= 10)
    })

    it("POST /api/admin/guests creates a guest", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const newGuest = {
        name: "API Created Guest",
        email: `test-api-${Date.now()}@example.com`,
        party_size: 3,
      }

      const res = await adminFetch(
        "/api/admin/guests",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newGuest),
        },
        auth
      )

      assert.strictEqual(res.status, 201)

      const data = /** @type {ApiData<GuestResponse>} */ (await res.json())
      assert.strictEqual(data.guest.name, newGuest.name)
      assert.ok(data.guest.invite_code)
      assert.strictEqual(data.guest.invite_code.length, 8)

      // Cleanup
      deleteTestGuest(db, data.guest.invite_code)
    })

    it("PUT /api/admin/guests/:id updates a guest", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch(
        `/api/admin/guests/${testGuest.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated Name", party_size: 5 }),
        },
        auth
      )

      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<GuestResponse>} */ (await res.json())
      assert.strictEqual(data.guest.name, "Updated Name")
      assert.strictEqual(data.guest.party_size, 5)
    })

    it("DELETE /api/admin/guests/:id soft-deletes a guest", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch(
        `/api/admin/guests/${testGuest.id}`,
        {
          method: "DELETE",
        },
        auth
      )

      assert.strictEqual(res.status, 200)

      // Verify soft delete in DB
      const guest = db
        .prepare("SELECT deleted_at FROM guests WHERE id = ?")
        .get(testGuest.id)
      assert.ok(guest)
      assert.ok(guest.deleted_at)
    })

    it("POST /api/admin/guests/:id/restore restores a deleted guest", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      // Soft delete first
      db.prepare("UPDATE guests SET deleted_at = datetime() WHERE id = ?").run(
        testGuest.id
      )

      const res = await adminFetch(
        `/api/admin/guests/${testGuest.id}/restore`,
        {
          method: "POST",
        },
        auth
      )

      assert.strictEqual(res.status, 200)

      // Verify restored
      const restoredGuest = db
        .prepare("SELECT deleted_at FROM guests WHERE id = ?")
        .get(testGuest.id)
      assert.ok(restoredGuest)
      assert.strictEqual(restoredGuest.deleted_at, null)
    })

    it("GET /api/admin/rsvps returns RSVP list", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/rsvps", {}, auth)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<RSVPListResponse>} */ (await res.json())
      assert.ok(Array.isArray(data.rsvps))
    })

    it("GET /api/admin/guests/export returns CSV", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/guests/export", {}, auth)
      assert.strictEqual(res.status, 200)
      const contentType = res.headers.get("content-type")
      assert.ok(contentType && contentType.includes("text/csv"))
    })

    it("GET /api/admin/guests/invitable-ids returns the not-yet-responded audience", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      // A fresh guest defaults to 'pending', so it must appear in the invitable set.
      const res = await adminFetch("/api/admin/guests/invitable-ids", {}, auth)
      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<InvitableIdsResponse>} */ (
        await res.json()
      )
      assert.ok(Array.isArray(data.guestIds))
      assert.ok(data.guestIds.includes(Number(testGuest.id)))
      assert.ok(typeof data.pending === "number")
      assert.ok(typeof data.invited === "number")

      // Filtering to already-responded means nothing is invitable from here.
      const respondedRes = await adminFetch(
        "/api/admin/guests/invitable-ids?status=responded",
        {},
        auth
      )
      assert.strictEqual(respondedRes.status, 200)
      const respondedData = /** @type {ApiData<InvitableIdsResponse>} */ (
        await respondedRes.json()
      )
      assert.ok(!respondedData.guestIds.includes(Number(testGuest.id)))
    })

    it("GET /api/admin/rsvps/export returns CSV", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/rsvps/export", {}, auth)
      assert.strictEqual(res.status, 200)
      const rsvpContentType = res.headers.get("content-type")
      assert.ok(rsvpContentType && rsvpContentType.includes("text/csv"))
    })

    it("GET /api/admin/invite/config returns service configuration", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/invite/config", {}, auth)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<ConfigResponse>} */ (await res.json())
      assert.ok(typeof data.sms === "object")
      assert.ok(typeof data.email === "object")
    })

    it("GET /api/admin/petitions returns petition list", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/petitions", {}, auth)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<PetitionListResponse>} */ (await res.json())
      assert.ok(Array.isArray(data.petitions))
    })

    it("GET /api/admin/petitions/counts returns counts only", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/petitions/counts", {}, auth)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<{ pending: number, approved: number, denied: number, petitions?: unknown }>} */ (
        await res.json()
      )
      assert.strictEqual(typeof data.pending, "number")
      assert.strictEqual(typeof data.approved, "number")
      assert.strictEqual(typeof data.denied, "number")
      // Counts-only: it must NOT ship the full list the badge poll used to fetch.
      assert.strictEqual(data.petitions, undefined)
    })

    it("GET /api/admin/blocklist returns blocklist", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch("/api/admin/blocklist", {}, auth)
      assert.strictEqual(res.status, 200)

      const data = /** @type {ApiData<BlocklistResponse>} */ (await res.json())
      assert.ok(Array.isArray(data.blocklist))
    })

    it("POST /api/admin/blocklist adds entry", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch(
        "/api/admin/blocklist",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `block-test-${Date.now()}@example.com`,
            reason: "Test block",
          }),
        },
        auth
      )

      assert.strictEqual(res.status, 201)

      const data = /** @type {ApiData<BlocklistCreateResponse>} */ (await res.json())
      assert.ok(data.id)

      // Cleanup
      removeFromBlocklist(db, data.id)
    })

    it("DELETE /api/admin/blocklist/:id removes entry", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      // Add entry directly
      const entry = addToBlocklist(db, {
        email: `block-del-${Date.now()}@example.com`,
      })

      const res = await adminFetch(
        `/api/admin/blocklist/${entry.id}`,
        {
          method: "DELETE",
        },
        auth
      )

      assert.strictEqual(res.status, 200)
    })
  })

  // ==================== Petition Admin Actions ====================

  describe("Petition Admin Actions", () => {
    /** @type {AdminAuth} */
    let auth
    /** @type {TestPetition} */
    let testPetition

    before(async () => {
      const password = process.env.TEST_ADMIN_PASSWORD
      if (password) {
        try {
          auth = await adminLogin(password)
        } catch (e) {
          // Skip
        }
      }
    })

    beforeEach(async () => {
      if (auth) {
        await rateLimitDelay()
        testPetition = createTestPetition(db)
      }
    })

    afterEach(() => {
      if (testPetition) {
        deleteTestPetition(db, testPetition.id)
      }
      // Clean up any guests created from approvals
      db.prepare(`DELETE FROM guests WHERE email LIKE 'petition-%'`).run()
    })

    it("POST /api/admin/petitions/:id/deny denies a petition", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch(
        `/api/admin/petitions/${testPetition.id}/deny`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        auth
      )

      assert.strictEqual(res.status, 200)

      // Verify status changed
      const row = db
        .prepare("SELECT status FROM petitions WHERE id = ?")
        .get(testPetition.id)
      assert.ok(row)
      assert.strictEqual(row.status, "denied")
    })

    it("POST /api/admin/petitions/:id/approve creates guest and updates petition", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch(
        `/api/admin/petitions/${testPetition.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            party_size: 2,
            admin_notes: "Approved by test",
          }),
        },
        auth
      )

      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<PetitionResponse>} */ (await res.json())
      assert.strictEqual(data.success, true)
      assert.ok(data.guest, "Should return created guest")
      assert.strictEqual(data.guest.name, testPetition.name)
      assert.strictEqual(data.guest.party_size, 2)
      assert.ok(data.guest.invite_code, "Should have invite code")

      // Verify petition status changed
      const approvedRow = db
        .prepare("SELECT status FROM petitions WHERE id = ?")
        .get(testPetition.id)
      assert.ok(approvedRow)
      assert.strictEqual(approvedRow.status, "approved")
    })

    it("POST /api/admin/petitions/:id/approve rejects already approved petition", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      // Approve once
      await adminFetch(
        `/api/admin/petitions/${testPetition.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ party_size: 1 }),
        },
        auth
      )

      // Try to approve again
      const res = await adminFetch(
        `/api/admin/petitions/${testPetition.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ party_size: 1 }),
        },
        auth
      )

      assert.strictEqual(res.status, 400)
      const data = /** @type {ApiData<ErrorResponse>} */ (await res.json())
      assert.ok(data.error.includes("already"))
    })

    it("POST /api/admin/petitions/:id/deny with add_to_blocklist creates blocklist entry", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const res = await adminFetch(
        `/api/admin/petitions/${testPetition.id}/deny`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ add_to_blocklist: true }),
        },
        auth
      )

      assert.strictEqual(res.status, 200)

      // Verify blocklist entry
      const blocked = db
        .prepare("SELECT * FROM blocklist WHERE email = ?")
        .get(testPetition.email)
      assert.ok(blocked, "Should create blocklist entry")

      // Cleanup
      db.prepare("DELETE FROM blocklist WHERE email = ?").run(
        testPetition.email
      )
    })
  })

  // ==================== Rate Limiting ====================

  describe("Rate Limiting", () => {
    it("should allow requests under limit", async () => {
      // Use unique IP to avoid interference
      const testIp = "10.99.0.1"

      // Make 3 requests (lookup limit is 3/min for unique IPs)
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${BASE_URL}/api/lookup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": testIp,
          },
          body: JSON.stringify({
            name: "Test User",
            email: `test${i}@example.com`,
          }),
        })
        assert.notStrictEqual(
          res.status,
          429,
          `Request ${i + 1} should not be rate limited`
        )
      }
    })

    it("should block requests over limit with 429", async () => {
      const testIp = "10.99.0.2"

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        await fetch(`${BASE_URL}/api/lookup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": testIp,
          },
          body: JSON.stringify({
            name: "Test User",
            email: `test${i}@example.com`,
          }),
        })
      }

      // 4th request should be blocked
      const res = await fetch(`${BASE_URL}/api/lookup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": testIp,
        },
        body: JSON.stringify({
          name: "Test User",
          email: "test4@example.com",
        }),
      })

      assert.strictEqual(res.status, 429)
      const data = /** @type {ApiData<ErrorResponse>} */ (await res.json())
      assert.ok(data.error.includes("Too many requests"))
    })

    it("should include Retry-After header on 429", async () => {
      const testIp = "10.99.0.3"

      // Exhaust the limit
      for (let i = 0; i < 4; i++) {
        await fetch(`${BASE_URL}/api/lookup`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": testIp,
          },
          body: JSON.stringify({
            name: "Test",
            email: `test${i}@example.com`,
          }),
        })
      }

      const res = await fetch(`${BASE_URL}/api/lookup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": testIp,
        },
        body: JSON.stringify({
          name: "Test",
          email: "test5@example.com",
        }),
      })

      assert.strictEqual(res.status, 429)
      const retryAfter = res.headers.get("Retry-After")
      assert.ok(retryAfter, "Should have Retry-After header")
      assert.ok(parseInt(retryAfter, 10) > 0)
    })
  })

  // ==================== CSV Import ====================

  describe("CSV Import", () => {
    /** @type {AdminAuth} */
    let auth

    before(async () => {
      const password = process.env.TEST_ADMIN_PASSWORD
      if (password) {
        try {
          auth = await adminLogin(password)
        } catch {
          // Skip
        }
      }
    })

    afterEach(() => {
      // Clean up test imports
      db.prepare("DELETE FROM guests WHERE email LIKE 'csvtest-%'").run()
    })

    it("POST /api/admin/guests/import parses valid CSV", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const csv = `name,email,phone,party_size
John Doe,csvtest-john@example.com,5551234567,2
Jane Smith,csvtest-jane@example.com,,1`

      const res = await adminFetch(
        "/api/admin/guests/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        },
        auth
      )

      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<ImportResponse>} */ (await res.json())
      assert.strictEqual(data.added, 2)
      assert.strictEqual(data.skipped.length, 0)
      assert.strictEqual(data.errors.length, 0)
    })

    it("POST /api/admin/guests/import handles duplicate emails", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      // Create first guest
      const csv1 = `name,email,party_size
First Guest,csvtest-dup@example.com,1`
      await adminFetch(
        "/api/admin/guests/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: csv1 }),
        },
        auth
      )

      // Try to import duplicate
      const csv2 = `name,email,party_size
Duplicate Guest,csvtest-dup@example.com,2`
      const res = await adminFetch(
        "/api/admin/guests/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: csv2 }),
        },
        auth
      )

      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<ImportResponse>} */ (await res.json())
      assert.strictEqual(data.added, 0)
      assert.strictEqual(data.skipped.length, 1)
      assert.ok(data.skipped[0].reason.includes("exists"))
    })

    it("POST /api/admin/guests/import validates party_size", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const csv = `name,email,party_size
Invalid Party,csvtest-invalid@example.com,999`

      const res = await adminFetch(
        "/api/admin/guests/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        },
        auth
      )

      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<ImportResponse>} */ (await res.json())
      assert.strictEqual(data.added, 0)
      assert.strictEqual(data.errors.length, 1)
      assert.ok(
        data.errors[0].error.includes("party") ||
          data.errors[0].error.includes("Party")
      )
    })

    it("POST /api/admin/guests/import handles quoted fields with commas", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const csv = `name,email,notes,party_size
"Smith, John",csvtest-quoted@example.com,"Notes with, comma",1`

      const res = await adminFetch(
        "/api/admin/guests/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        },
        auth
      )

      assert.strictEqual(res.status, 200)
      const data = /** @type {ApiData<ImportResponse>} */ (await res.json())
      assert.strictEqual(data.added, 1)

      // Verify name parsed correctly
      const guest = db
        .prepare(
          "SELECT name, notes FROM guests WHERE email = 'csvtest-quoted@example.com'"
        )
        .get()
      assert.ok(guest)
      assert.strictEqual(guest.name, "Smith, John")
      assert.strictEqual(guest.notes, "Notes with, comma")
    })

    it("POST /api/admin/guests/import requires name column", async (t) => {
      if (!auth) return t.skip("TEST_ADMIN_PASSWORD not set")

      const csv = `email,party_size
csvtest-noname@example.com,1`

      const res = await adminFetch(
        "/api/admin/guests/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        },
        auth
      )

      assert.strictEqual(res.status, 400)
      const data = /** @type {ApiData<ErrorResponse>} */ (await res.json())
      assert.ok(data.error.includes("name"))
    })
  })

  // ==================== Static File Serving ====================

  describe("Static File Serving", () => {
    it("GET / returns index.html", async () => {
      const res = await fetch(`${BASE_URL}/`)
      assert.strictEqual(res.status, 200)
      const htmlType = res.headers.get("content-type")
      assert.ok(htmlType && htmlType.includes("text/html"))
    })

    it("GET /rsvp returns RSVP page", async () => {
      const res = await fetch(`${BASE_URL}/rsvp`)
      assert.strictEqual(res.status, 200)
      const rsvpType = res.headers.get("content-type")
      assert.ok(rsvpType && rsvpType.includes("text/html"))
    })

    it("GET /nonexistent returns 404", async () => {
      const res = await fetch(`${BASE_URL}/nonexistent.html`)
      assert.strictEqual(res.status, 404)
    })

    it("Serves CSS files with correct content-type", async () => {
      const res = await fetch(`${BASE_URL}/styles/tokens.css`)
      assert.strictEqual(res.status, 200)
      const cssType = res.headers.get("content-type")
      assert.ok(cssType && cssType.includes("text/css"))
    })

    it("Serves JS files with correct content-type", async () => {
      const res = await fetch(`${BASE_URL}/pages/main.js`)
      assert.strictEqual(res.status, 200)
      const jsType = res.headers.get("content-type")
      assert.ok(jsType && jsType.includes("javascript"))
    })

    it("serves the admin shell for any extensionless /admin/* route, with its headers", async () => {
      const shell = await fetch(`${BASE_URL}/admin`)
      const shellHtml = await shell.text()
      for (const route of ["/admin/faces", "/admin/faces/groups/f123", "/admin/inbox/"]) {
        const res = await fetch(`${BASE_URL}${route}`)
        assert.strictEqual(res.status, 200, route)
        assert.ok(res.headers.get("content-type")?.includes("text/html"), route)
        assert.ok(res.headers.get("content-security-policy"), `${route} keeps the CSP`)
        assert.strictEqual(res.headers.get("x-frame-options"), "DENY", `${route} stays unframeable`)
        assert.strictEqual(await res.text(), shellHtml, `${route} is the same shell as /admin`)
      }
    })

    it("does not widen the fallback: assets under /admin/ and look-alike paths still 404", async () => {
      for (const route of ["/admin/missing.js", "/administrator", "/admin-x/faces"]) {
        const res = await fetch(`${BASE_URL}${route}`)
        assert.strictEqual(res.status, 404, route)
      }
    })
  })

  // ==================== Manual SMS ====================

  describe("Manual SMS API", () => {
    /** @type {Awaited<ReturnType<typeof adminLogin>> | null} */
    let smsAuth = null

    /** @type {string[]} */
    const createdCodes = []

    /** @param {TestGuest} guest */
    function trackGuest(guest) {
      createdCodes.push(guest.invite_code)
      return guest
    }

    before(async () => {
      const password = process.env.TEST_ADMIN_PASSWORD
      if (password) {
        try {
          smsAuth = await adminLogin(password)
        } catch {
          console.log("Admin login failed - check TEST_ADMIN_PASSWORD")
        }
      }

      if (!smsAuth) {
        console.log(
          "Skipping authenticated manual SMS tests (set TEST_ADMIN_PASSWORD)",
        )
      }
    })

    after(() => {
      for (const code of createdCodes) {
        try {
          deleteTestGuest(db, code)
        } catch {
          // ignore cleanup errors
        }
      }
    })

    afterEach(async () => {
      await rateLimitDelay()
    })

    // ==================== GET /api/admin/manual-sms/guests ====================

    describe("GET /api/admin/manual-sms/guests", () => {
      it("returns 401 without auth", async () => {
        const res = await fetch(
          `${BASE_URL}/api/admin/manual-sms/guests`,
        )
        assert.strictEqual(res.status, 401)
      })

      it("returns eligible guests with phone numbers", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = trackGuest(
          createTestGuest(db, {
            phone: "+15551234567",
            status: "pending",
          }),
        )

        const res = await adminFetch(
          "/api/admin/manual-sms/guests",
          {},
          smsAuth,
        )
        assert.strictEqual(res.status, 200)

        const data = /** @type {ApiData<ManualSmsGuestsResponse>} */ (await res.json())
        assert.ok(Array.isArray(data.guests), "should have guests array")
        assert.ok(data.defaultTemplate, "should have defaultTemplate")
        assert.ok(data.wedding, "should have wedding info")
        assert.ok(data.wedding.date, "wedding should have date")
        assert.ok(data.wedding.location, "wedding should have location")

        const found = data.guests.find(
          (g) => g.invite_code === guest.invite_code,
        )
        assert.ok(found, "eligible guest with phone should be included")
      })

      it("excludes guests without phone", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = trackGuest(
          createTestGuest(db, { phone: null, status: "pending" }),
        )

        const res = await adminFetch(
          "/api/admin/manual-sms/guests",
          {},
          smsAuth,
        )
        const data = /** @type {ApiData<ManualSmsGuestsResponse>} */ (await res.json())

        const found = data.guests.find(
          (g) => g.invite_code === guest.invite_code,
        )
        assert.strictEqual(
          found,
          undefined,
          "guest without phone should not be included",
        )
      })

      it("excludes responded guests", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = trackGuest(
          createTestGuest(db, {
            phone: "+15551234568",
            status: "responded",
          }),
        )

        const res = await adminFetch(
          "/api/admin/manual-sms/guests",
          {},
          smsAuth,
        )
        const data = /** @type {ApiData<ManualSmsGuestsResponse>} */ (await res.json())

        const found = data.guests.find(
          (g) => g.invite_code === guest.invite_code,
        )
        assert.strictEqual(
          found,
          undefined,
          "responded guest should not be included",
        )
      })

      it("excludes deleted guests", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = trackGuest(
          createTestGuest(db, {
            phone: "+15551234569",
            status: "pending",
          }),
        )
        // Soft-delete the guest
        db.prepare(
          "UPDATE guests SET deleted_at = datetime('now') WHERE invite_code = ?",
        ).run(guest.invite_code)

        const res = await adminFetch(
          "/api/admin/manual-sms/guests",
          {},
          smsAuth,
        )
        const data = /** @type {ApiData<ManualSmsGuestsResponse>} */ (await res.json())

        const found = data.guests.find(
          (g) => g.invite_code === guest.invite_code,
        )
        assert.strictEqual(
          found,
          undefined,
          "deleted guest should not be included",
        )
      })
    })

    // ==================== POST /api/admin/manual-sms/mark-sent ====================

    describe("POST /api/admin/manual-sms/mark-sent", () => {
      it("returns 401 without auth", async () => {
        const res = await fetch(
          `${BASE_URL}/api/admin/manual-sms/mark-sent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestId: 1 }),
          },
        )
        assert.strictEqual(res.status, 401)
      })

      it("returns 403 without CSRF token", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const res = await fetch(
          `${BASE_URL}/api/admin/manual-sms/mark-sent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: smsAuth.cookieHeader,
            },
            body: JSON.stringify({ guestId: 1 }),
          },
        )
        assert.strictEqual(res.status, 403)
      })

      it("marks a guest as invited and returns success", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = trackGuest(
          createTestGuest(db, {
            phone: "+15559999001",
            status: "pending",
          }),
        )

        const res = await adminFetch(
          "/api/admin/manual-sms/mark-sent",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guestId: Number(guest.id),
              messagePreview: "Test message",
            }),
          },
          smsAuth,
        )
        assert.strictEqual(res.status, 200)

        const data = /** @type {ApiData<ManualSmsMarkSentResponse>} */ (await res.json())
        assert.strictEqual(data.success, true)
        assert.strictEqual(data.guest.id, Number(guest.id))
        assert.strictEqual(data.guest.status, "invited")

        // Verify communication was logged in DB
        const comm = db
          .prepare(
            "SELECT * FROM communications WHERE guest_id = ? ORDER BY id DESC LIMIT 1",
          )
          .get(Number(guest.id))
        assert.ok(comm, "communication should be logged")
        assert.strictEqual(comm.type, "sms")
        assert.strictEqual(comm.status, "sent")
      })

      it("returns 400 for non-existent guest", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const res = await adminFetch(
          "/api/admin/manual-sms/mark-sent",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestId: 999999 }),
          },
          smsAuth,
        )
        assert.strictEqual(res.status, 400)
      })

      it("returns 400 for guest without phone", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest = trackGuest(
          createTestGuest(db, { phone: null, status: "pending" }),
        )

        const res = await adminFetch(
          "/api/admin/manual-sms/mark-sent",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestId: Number(guest.id) }),
          },
          smsAuth,
        )
        assert.strictEqual(res.status, 400)

        const data = /** @type {ApiData<ErrorResponse>} */ (await res.json())
        assert.ok(
          data.error.includes("phone"),
          "error should mention phone: " + data.error,
        )
      })

      it("returns 400 for invalid guestId", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const res = await adminFetch(
          "/api/admin/manual-sms/mark-sent",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestId: "not-a-number" }),
          },
          smsAuth,
        )
        assert.strictEqual(res.status, 400)
      })
    })

    // ==================== POST /api/admin/manual-sms/mark-sent-batch ====================

    describe("POST /api/admin/manual-sms/mark-sent-batch", () => {
      it("returns 401 without auth", async () => {
        const res = await fetch(
          `${BASE_URL}/api/admin/manual-sms/mark-sent-batch`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestIds: [1] }),
          },
        )
        assert.strictEqual(res.status, 401)
      })

      it("marks multiple guests as invited", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const guest1 = trackGuest(
          createTestGuest(db, {
            phone: "+15559999011",
            status: "pending",
          }),
        )
        const guest2 = trackGuest(
          createTestGuest(db, {
            phone: "+15559999012",
            status: "pending",
          }),
        )

        const res = await adminFetch(
          "/api/admin/manual-sms/mark-sent-batch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guestIds: [Number(guest1.id), Number(guest2.id)],
            }),
          },
          smsAuth,
        )
        assert.strictEqual(res.status, 200)

        const data = /** @type {ApiData<ManualSmsBatchResponse>} */ (await res.json())
        assert.strictEqual(data.success, true)
        assert.strictEqual(data.summary.sent, 2)
        assert.strictEqual(data.summary.failed, 0)
        assert.strictEqual(data.results.sent.length, 2)
      })

      it("reports partial failures", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const validGuest = trackGuest(
          createTestGuest(db, {
            phone: "+15559999013",
            status: "pending",
          }),
        )
        const noPhoneGuest = trackGuest(
          createTestGuest(db, { phone: null, status: "pending" }),
        )

        const res = await adminFetch(
          "/api/admin/manual-sms/mark-sent-batch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guestIds: [Number(validGuest.id), Number(noPhoneGuest.id)],
            }),
          },
          smsAuth,
        )
        assert.strictEqual(res.status, 200)

        const data = /** @type {ApiData<ManualSmsBatchResponse>} */ (await res.json())
        assert.strictEqual(data.success, true)
        assert.strictEqual(data.summary.sent, 1)
        assert.strictEqual(data.summary.failed, 1)
        assert.strictEqual(data.results.sent.length, 1)
        assert.strictEqual(data.results.failed.length, 1)
        assert.ok(
          data.results.failed[0].error.includes("phone"),
          "failed entry should mention phone",
        )
      })

      it("returns 400 for invalid guestIds", async (t) => {
        if (!smsAuth) return t.skip("TEST_ADMIN_PASSWORD not set")

        const res = await adminFetch(
          "/api/admin/manual-sms/mark-sent-batch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guestIds: "not-an-array" }),
          },
          smsAuth,
        )
        assert.strictEqual(res.status, 400)
      })
    })
  })
})
