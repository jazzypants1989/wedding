/**
 * @file Unit tests for database connection and query helpers
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { init, close, getDb } from "../../../db/connection.js"

describe("db/connection", () => {
  before(() => {
    init()
  })

  after(() => {
    // Clean up any test data
    try {
      getDb().prepare("DELETE FROM guests WHERE email LIKE 'conntest-%'").run()
    } catch {
      // table may not exist
    }
    close()
  })

  describe("init", () => {
    it("returns the database instance", () => {
      // init() was called in before(), calling again should return same instance
      const db = init()
      assert.ok(db)
    })

    it("is idempotent — second call returns same instance", () => {
      const db1 = init()
      const db2 = init()
      assert.strictEqual(db1, db2)
    })
  })

  describe("getDb", () => {
    it("returns the initialized database", () => {
      const db = getDb()
      assert.ok(db)
    })
  })

})
