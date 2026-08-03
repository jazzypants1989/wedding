/**
 * @file Unit tests for audit logging
 */

import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { log, actorId, cleanOldLogs, AUDIT_ACTIONS } from "../../../core/utils.js"

// AUDIT_LOG_DIR is set by test-env.js — utils.js reads it at module load time
const LOG_DIR = process.env.AUDIT_LOG_DIR || ""

describe("core/log", () => {
  before(() => {
    assert.ok(LOG_DIR, "AUDIT_LOG_DIR must be set for log tests")
    // Ensure clean state
    try {
      fs.rmSync(LOG_DIR, { recursive: true, force: true })
    } catch {
      // may not exist
    }
  })

  after(() => {
    try {
      fs.rmSync(LOG_DIR, { recursive: true, force: true })
    } catch {
      // may not exist
    }
  })

  beforeEach(() => {
    // Clean directory between tests
    try {
      const files = fs.readdirSync(LOG_DIR)
      for (const file of files) {
        fs.unlinkSync(path.join(LOG_DIR, file))
      }
    } catch {
      // directory may not exist yet
    }
  })

  describe("AUDIT_ACTIONS", () => {
    it("is a frozen object", () => {
      assert.ok(Object.isFrozen(AUDIT_ACTIONS))
    })

    it("contains expected action keys", () => {
      const expectedKeys = [
        "LOGIN",
        "LOGIN_FAILED",
        "LOGOUT",
        "GUEST_CREATE",
        "GUEST_UPDATE",
        "GUEST_DELETE",
        "GUEST_RESTORE",
        "GUEST_IMPORT",
        "GUEST_EXPORT",
        "PETITION_APPROVE",
        "PETITION_DENY",
        "PETITION_CREATE",
        "BLOCKLIST_ADD",
        "BLOCKLIST_REMOVE",
        "INVITE_SEND",
        "INVITE_SEND_FAILED",
        "MANUAL_SMS_MARK",
        "RSVP_SUBMIT",
        "CSRF_FAILURE",
      ]

      for (const key of expectedKeys) {
        assert.ok(key in AUDIT_ACTIONS, `Missing action: ${key}`)
      }
    })

    it("has matching key-value pairs", () => {
      for (const [key, value] of Object.entries(AUDIT_ACTIONS)) {
        assert.strictEqual(
          key,
          value,
          `Key "${key}" should equal value "${value}"`,
        )
      }
    })
  })

  describe("log", () => {
    it("creates the log directory if it does not exist", async () => {
      try {
        fs.rmSync(LOG_DIR, { recursive: true, force: true })
      } catch {
        // may not exist
      }

      log({ action: "TEST_ACTION" })

      // Wait for async appendFile to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      assert.ok(fs.existsSync(LOG_DIR), "Log directory should be created")
    })

    it("writes a JSONL entry to the log file", async () => {
      log({
        action: "LOGIN",
        adminId: "abcdefghijklmnop",
        ip: "127.0.0.1",
        resourceType: "session",
        resourceId: 42,
        details: { method: "password" },
      })

      // Wait for async appendFile to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      const today = new Date().toISOString().split("T")[0]
      const logFile = path.join(LOG_DIR, today + ".jsonl")
      assert.ok(fs.existsSync(logFile), "Log file should exist")

      const content = fs.readFileSync(logFile, "utf-8").trim()
      const entry = JSON.parse(content)

      assert.strictEqual(entry.action, "LOGIN")
      assert.strictEqual(entry.adminId, "abcdefgh") // truncated to first 8 chars
      assert.strictEqual(entry.ip, "127.0.0.1")
      assert.strictEqual(entry.resourceType, "session")
      assert.strictEqual(entry.resourceId, 42)
      assert.deepStrictEqual(entry.details, { method: "password" })
      assert.ok(entry.timestamp, "Should have a timestamp")
    })

    it("truncates adminId to 8 characters", async () => {
      log({ action: "TEST", adminId: "0123456789abcdef" })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const today = new Date().toISOString().split("T")[0]
      const logFile = path.join(LOG_DIR, today + ".jsonl")
      const content = fs.readFileSync(logFile, "utf-8").trim()
      const entry = JSON.parse(content)

      assert.strictEqual(entry.adminId, "01234567")
    })

    it("actorId is the ONE definition of how much of a session id is recorded", () => {
      // Durable columns (people.created_by, face_identities.confirmed_by) go
      // through this too, not just the audit log — otherwise "the actor" is a
      // 64-char string in one place and its 8-char prefix in the other. The
      // value is db/sessions.js's SHA-256 hash, not a bearer token.
      assert.strictEqual(actorId("0123456789abcdef"), "01234567")
      assert.strictEqual(actorId(null), null)
      assert.strictEqual(actorId(undefined), null)
      assert.strictEqual(actorId(""), null, "an empty token is no actor, not an empty string")

      // Idempotent under re-application, which is what lets the
      // truncate_durable_actor_tokens migration re-run safely.
      assert.strictEqual(actorId(actorId("0123456789abcdef")), "01234567")
    })

    it("handles missing optional fields as null", async () => {
      log({ action: "LOGOUT" })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const today = new Date().toISOString().split("T")[0]
      const logFile = path.join(LOG_DIR, today + ".jsonl")
      const content = fs.readFileSync(logFile, "utf-8").trim()
      const entry = JSON.parse(content)

      assert.strictEqual(entry.action, "LOGOUT")
      assert.strictEqual(entry.adminId, null)
      assert.strictEqual(entry.ip, null)
      assert.strictEqual(entry.resourceType, null)
      assert.strictEqual(entry.resourceId, null)
      assert.strictEqual(entry.details, null)
    })

    it("appends multiple entries to the same file", async () => {
      log({ action: "FIRST" })

      // Wait for first write to complete before issuing second
      await new Promise((resolve) => setTimeout(resolve, 100))

      log({ action: "SECOND" })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const today = new Date().toISOString().split("T")[0]
      const logFile = path.join(LOG_DIR, today + ".jsonl")
      const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n")

      assert.strictEqual(lines.length, 2)

      const actions = lines.map((line) => JSON.parse(line).action)
      assert.ok(actions.includes("FIRST"), "Should contain FIRST entry")
      assert.ok(actions.includes("SECOND"), "Should contain SECOND entry")
    })
  })

  describe("cleanOldLogs", () => {
    it("removes log files older than 30 days", () => {
      fs.mkdirSync(LOG_DIR, { recursive: true })

      // Create an old log file (40 days ago)
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      const oldFilename = oldDate.toISOString().split("T")[0] + ".jsonl"
      fs.writeFileSync(path.join(LOG_DIR, oldFilename), '{"action":"OLD"}\n')

      // Create a recent log file (5 days ago)
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      const recentFilename = recentDate.toISOString().split("T")[0] + ".jsonl"
      fs.writeFileSync(
        path.join(LOG_DIR, recentFilename),
        '{"action":"RECENT"}\n',
      )

      cleanOldLogs()

      assert.ok(
        !fs.existsSync(path.join(LOG_DIR, oldFilename)),
        "Old file should be deleted",
      )
      assert.ok(
        fs.existsSync(path.join(LOG_DIR, recentFilename)),
        "Recent file should be kept",
      )
    })

    it("ignores non-jsonl files", () => {
      fs.mkdirSync(LOG_DIR, { recursive: true })

      fs.writeFileSync(path.join(LOG_DIR, "notes.txt"), "not a log")

      cleanOldLogs()

      assert.ok(
        fs.existsSync(path.join(LOG_DIR, "notes.txt")),
        "Non-jsonl file should be kept",
      )
    })

    it("creates the log directory if it does not exist", () => {
      try {
        fs.rmSync(LOG_DIR, { recursive: true, force: true })
      } catch {
        // may not exist
      }

      // Should not throw
      cleanOldLogs()

      assert.ok(fs.existsSync(LOG_DIR), "Log directory should be created")
    })

    it("does not remove files at the 30-day boundary", () => {
      fs.mkdirSync(LOG_DIR, { recursive: true })

      // Create a file exactly 29 days ago (should be kept)
      const borderDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
      const borderFilename = borderDate.toISOString().split("T")[0] + ".jsonl"
      fs.writeFileSync(
        path.join(LOG_DIR, borderFilename),
        '{"action":"BORDER"}\n',
      )

      cleanOldLogs()

      assert.ok(
        fs.existsSync(path.join(LOG_DIR, borderFilename)),
        "29-day-old file should be kept",
      )
    })
  })
})
