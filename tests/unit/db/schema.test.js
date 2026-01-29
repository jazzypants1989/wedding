/**
 * @file Unit tests for database schema creation and triggers
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"
import { createTables, runMigrations } from "../../../db/schema.js"

/**
 * @param {DatabaseSync} db
 * @param {string} tableName
 * @returns {boolean}
 */
function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName)
  return row !== undefined
}

/**
 * @param {DatabaseSync} db
 * @param {string} indexName
 * @returns {boolean}
 */
function indexExists(db, indexName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName)
  return row !== undefined
}

/**
 * @param {DatabaseSync} db
 * @param {string} triggerName
 * @returns {boolean}
 */
function triggerExists(db, triggerName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(triggerName)
  return row !== undefined
}

describe("db/schema", () => {
  /** @type {DatabaseSync} */
  let db

  before(() => {
    db = new DatabaseSync(":memory:")
    db.exec("PRAGMA foreign_keys = ON")
    createTables(db)
    runMigrations(db)
  })

  after(() => {
    db.close()
  })

  describe("createTables", () => {
    it("creates the migrations table", () => {
      assert.ok(tableExists(db, "migrations"))
    })

    it("creates the guests table", () => {
      assert.ok(tableExists(db, "guests"))
    })

    it("creates the rsvps table", () => {
      assert.ok(tableExists(db, "rsvps"))
    })

    it("creates the communications table", () => {
      assert.ok(tableExists(db, "communications"))
    })

    it("creates the sessions table", () => {
      assert.ok(tableExists(db, "sessions"))
    })

    it("creates the blocklist table", () => {
      assert.ok(tableExists(db, "blocklist"))
    })

    it("creates the petitions table", () => {
      assert.ok(tableExists(db, "petitions"))
    })

    it("creates the rate_limits table", () => {
      assert.ok(tableExists(db, "rate_limits"))
    })

    it("is idempotent — calling twice does not error", () => {
      assert.doesNotThrow(() => {
        createTables(db)
      })
    })
  })

  describe("indexes", () => {
    it("creates guests indexes", () => {
      assert.ok(indexExists(db, "idx_guests_email"))
      assert.ok(indexExists(db, "idx_guests_phone"))
      assert.ok(indexExists(db, "idx_guests_invite_code"))
      assert.ok(indexExists(db, "idx_guests_status"))
      assert.ok(indexExists(db, "idx_guests_deleted_at"))
    })

    it("creates communications indexes", () => {
      assert.ok(indexExists(db, "idx_communications_guest_id"))
      assert.ok(indexExists(db, "idx_communications_status"))
      assert.ok(indexExists(db, "idx_communications_guest_status"))
    })

    it("creates sessions index", () => {
      assert.ok(indexExists(db, "idx_sessions_expires_at"))
    })

    it("creates blocklist indexes", () => {
      assert.ok(indexExists(db, "idx_blocklist_email"))
      assert.ok(indexExists(db, "idx_blocklist_phone"))
    })

    it("creates petitions indexes", () => {
      assert.ok(indexExists(db, "idx_petitions_status"))
      assert.ok(indexExists(db, "idx_petitions_email"))
    })

    it("creates rate_limits index", () => {
      assert.ok(indexExists(db, "idx_rate_limits_reset"))
    })
  })

  describe("triggers", () => {
    it("creates guest status triggers", () => {
      assert.ok(triggerExists(db, "check_guest_status_insert"))
      assert.ok(triggerExists(db, "check_guest_status_update"))
    })

    it("creates guest party_size triggers", () => {
      assert.ok(triggerExists(db, "check_guest_party_size_insert"))
      assert.ok(triggerExists(db, "check_guest_party_size_update"))
    })

    it("creates petition status triggers", () => {
      assert.ok(triggerExists(db, "check_petition_status_insert"))
      assert.ok(triggerExists(db, "check_petition_status_update"))
    })

    it("rejects invalid guest status on insert", () => {
      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO guests (name, invite_code, status) VALUES (?, ?, ?)"
          ).run("Trigger Test", "TRIG0001", "bogus")
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("Invalid guest status")
        }
      )
    })

    it("allows valid guest status values on insert", () => {
      for (const status of ["pending", "invited", "responded"]) {
        const code = "TRG" + status.slice(0, 5).toUpperCase()
        assert.doesNotThrow(() => {
          db.prepare(
            "INSERT INTO guests (name, invite_code, status) VALUES (?, ?, ?)"
          ).run("Status " + status, code, status)
        })
      }
    })

    it("rejects invalid guest status on update", () => {
      db.prepare(
        "INSERT INTO guests (name, invite_code, status) VALUES (?, ?, ?)"
      ).run("Update Test", "TRGUPD01", "pending")

      assert.throws(
        () => {
          db.prepare(
            "UPDATE guests SET status = ? WHERE invite_code = ?"
          ).run("invalid", "TRGUPD01")
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("Invalid guest status")
        }
      )
    })

    it("rejects party_size below 1 on insert", () => {
      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO guests (name, invite_code, party_size) VALUES (?, ?, ?)"
          ).run("Party Test", "TRGPTY01", 0)
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("party_size must be between 1 and 20")
        }
      )
    })

    it("rejects party_size above 20 on insert", () => {
      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO guests (name, invite_code, party_size) VALUES (?, ?, ?)"
          ).run("Party Test", "TRGPTY02", 21)
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("party_size must be between 1 and 20")
        }
      )
    })

    it("allows party_size between 1 and 20", () => {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO guests (name, invite_code, party_size) VALUES (?, ?, ?)"
        ).run("Party OK Min", "TRGPTY03", 1)
      })
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO guests (name, invite_code, party_size) VALUES (?, ?, ?)"
        ).run("Party OK Max", "TRGPTY04", 20)
      })
    })

    it("rejects party_size below 1 on update", () => {
      db.prepare(
        "INSERT INTO guests (name, invite_code, party_size) VALUES (?, ?, ?)"
      ).run("Party Update", "TRGPTY05", 5)

      assert.throws(
        () => {
          db.prepare(
            "UPDATE guests SET party_size = ? WHERE invite_code = ?"
          ).run(0, "TRGPTY05")
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("party_size must be between 1 and 20")
        }
      )
    })

    it("rejects invalid petition status on insert", () => {
      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO petitions (name, email, status) VALUES (?, ?, ?)"
          ).run("Pet Test", "pet@test.com", "bogus")
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("Invalid petition status")
        }
      )
    })

    it("allows valid petition status values on insert", () => {
      for (const status of ["pending", "approved", "denied"]) {
        assert.doesNotThrow(() => {
          db.prepare(
            "INSERT INTO petitions (name, email, status) VALUES (?, ?, ?)"
          ).run("Pet " + status, status + "@test.com", status)
        })
      }
    })

    it("rejects invalid petition status on update", () => {
      db.prepare(
        "INSERT INTO petitions (name, email, status) VALUES (?, ?, ?)"
      ).run("Pet Update", "petupd@test.com", "pending")

      assert.throws(
        () => {
          db.prepare(
            "UPDATE petitions SET status = ? WHERE email = ?"
          ).run("invalid", "petupd@test.com")
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("Invalid petition status")
        }
      )
    })
  })

  describe("table constraints", () => {
    it("enforces unique invite_code on guests", () => {
      db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Unique A", "UNIQ0001")

      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
          ).run("Unique B", "UNIQ0001")
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("UNIQUE constraint")
        }
      )
    })

    it("enforces unique guest_id on rsvps", () => {
      const result = db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("RSVP Unique", "RSVPUNQ1")

      db.prepare(
        "INSERT INTO rsvps (guest_id, attending) VALUES (?, ?)"
      ).run(result.lastInsertRowid, 1)

      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO rsvps (guest_id, attending) VALUES (?, ?)"
          ).run(result.lastInsertRowid, 0)
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("UNIQUE constraint")
        }
      )
    })

    it("enforces rsvps foreign key to guests", () => {
      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO rsvps (guest_id, attending) VALUES (?, ?)"
          ).run(999999, 1)
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("FOREIGN KEY constraint")
        }
      )
    })

    it("cascades guest deletion to rsvps", () => {
      const result = db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Cascade Test", "CASCDE01")

      db.prepare(
        "INSERT INTO rsvps (guest_id, attending) VALUES (?, ?)"
      ).run(result.lastInsertRowid, 1)

      db.prepare("DELETE FROM guests WHERE id = ?").run(result.lastInsertRowid)

      const rsvp = db.prepare(
        "SELECT * FROM rsvps WHERE guest_id = ?"
      ).get(result.lastInsertRowid)
      assert.strictEqual(rsvp, undefined, "RSVP should be cascade-deleted")
    })

    it("cascades guest deletion to communications", () => {
      const result = db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Comm Cascade", "COMMCS01")

      db.prepare(
        "INSERT INTO communications (guest_id, type, status) VALUES (?, ?, ?)"
      ).run(result.lastInsertRowid, "email", "sent")

      db.prepare("DELETE FROM guests WHERE id = ?").run(result.lastInsertRowid)

      const comm = db.prepare(
        "SELECT * FROM communications WHERE guest_id = ?"
      ).get(result.lastInsertRowid)
      assert.strictEqual(comm, undefined, "communication should be cascade-deleted")
    })

    it("enforces blocklist CHECK constraint — at least one of name/email/phone", () => {
      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO blocklist (reason) VALUES (?)"
          ).run("No identifiers")
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("CHECK constraint")
        }
      )
    })

    it("allows blocklist entry with only name", () => {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO blocklist (name, reason) VALUES (?, ?)"
        ).run("Only Name", "test")
      })
    })

    it("allows blocklist entry with only email", () => {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO blocklist (email, reason) VALUES (?, ?)"
        ).run("only@email.com", "test")
      })
    })

    it("allows blocklist entry with only phone", () => {
      assert.doesNotThrow(() => {
        db.prepare(
          "INSERT INTO blocklist (phone, reason) VALUES (?, ?)"
        ).run("+15551234567", "test")
      })
    })

    it("enforces attending CHECK constraint on rsvps", () => {
      const result = db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Attending Check", "ATCHK001")

      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO rsvps (guest_id, attending) VALUES (?, ?)"
          ).run(result.lastInsertRowid, 2)
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("CHECK constraint")
        }
      )
    })

    it("enforces rate_limits composite primary key", () => {
      db.prepare(
        "INSERT INTO rate_limits (key, limiter, count, reset_at) VALUES (?, ?, ?, ?)"
      ).run("127.0.0.1", "api", 1, Date.now() + 60000)

      assert.throws(
        () => {
          db.prepare(
            "INSERT INTO rate_limits (key, limiter, count, reset_at) VALUES (?, ?, ?, ?)"
          ).run("127.0.0.1", "api", 1, Date.now() + 60000)
        },
        (/** @type {Error} */ err) => {
          return err.message.includes("UNIQUE constraint")
        }
      )
    })
  })

  describe("default values", () => {
    it("defaults guest status to pending", () => {
      db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Default Status", "DFLT0001")

      const guest = /** @type {{ status: string }} */ (
        db.prepare("SELECT status FROM guests WHERE invite_code = ?").get("DFLT0001")
      )
      assert.strictEqual(guest.status, "pending")
    })

    it("defaults guest party_size to 1", () => {
      db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Default Party", "DFLT0002")

      const guest = /** @type {{ party_size: number }} */ (
        db.prepare("SELECT party_size FROM guests WHERE invite_code = ?").get("DFLT0002")
      )
      assert.strictEqual(guest.party_size, 1)
    })

    it("defaults guest deleted_at to null", () => {
      db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Default Deleted", "DFLT0003")

      const guest = /** @type {{ deleted_at: string | null }} */ (
        db.prepare("SELECT deleted_at FROM guests WHERE invite_code = ?").get("DFLT0003")
      )
      assert.strictEqual(guest.deleted_at, null)
    })

    it("defaults petition status to pending", () => {
      db.prepare(
        "INSERT INTO petitions (name, email) VALUES (?, ?)"
      ).run("Default Pet", "dflt@test.com")

      const petition = /** @type {{ status: string }} */ (
        db.prepare("SELECT status FROM petitions WHERE email = ?").get("dflt@test.com")
      )
      assert.strictEqual(petition.status, "pending")
    })

    it("sets created_at timestamps automatically", () => {
      db.prepare(
        "INSERT INTO guests (name, invite_code) VALUES (?, ?)"
      ).run("Timestamp Test", "TMST0001")

      const guest = /** @type {{ created_at: string }} */ (
        db.prepare("SELECT created_at FROM guests WHERE invite_code = ?").get("TMST0001")
      )
      assert.ok(guest.created_at, "created_at should be set")
      assert.ok(!isNaN(new Date(guest.created_at).getTime()), "created_at should be valid date")
    })
  })

  describe("runMigrations", () => {
    it("does not throw on fresh database", () => {
      assert.doesNotThrow(() => {
        runMigrations(db)
      })
    })

    it("is idempotent — calling twice does not error", () => {
      assert.doesNotThrow(() => {
        runMigrations(db)
        runMigrations(db)
      })
    })
  })
})
