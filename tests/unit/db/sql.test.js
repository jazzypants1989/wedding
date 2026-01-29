/**
 * @file Unit tests for SQL tagged template literal system
 * Tests SqlFragment, sql(), and all sql.* namespace utilities
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import { init, close } from "../../../db/connection.js"
import { sql, SqlFragment } from "../../../db/sql.js"

describe("db/sql", () => {
  before(() => {
    init()
  })

  after(() => {
    close()
  })

  // ─── SqlFragment construction ───

  describe("SqlFragment", () => {
    it("stores text and params", () => {
      const f = new SqlFragment("SELECT ?", [42])
      assert.strictEqual(f.text, "SELECT ?")
      assert.deepStrictEqual(f.params, [42])
    })

    it("get() executes and returns a single row", () => {
      const result = sql`SELECT 1 + 1 as value`.get()
      assert.ok(result)
      assert.strictEqual(/** @type {{ value: number }} */ (/** @type {unknown} */ (result)).value, 2)
    })

    it("get() returns undefined when no rows match", () => {
      const result = sql`SELECT * FROM guests WHERE email = ${"nonexistent-sqltest@nope.com"}`.get()
      assert.strictEqual(result, undefined)
    })

    it("all() returns an array of rows", () => {
      const rows = sql`SELECT 1 as n UNION ALL SELECT 2 UNION ALL SELECT 3`.all()
      assert.strictEqual(rows.length, 3)
      assert.deepStrictEqual(rows.map(/** @param {*} r */ r => r.n), [1, 2, 3])
    })

    it("all() returns empty array when no rows match", () => {
      const rows = sql`SELECT * FROM guests WHERE email = ${"nonexistent-sqltest@nope.com"}`.all()
      assert.deepStrictEqual(rows, [])
    })

    it("run() returns changes info", () => {
      const result = sql`SELECT 1`.run()
      assert.ok("changes" in result)
    })
  })

  // ─── sql tagged template ───

  describe("sql tagged template", () => {
    it("builds fragment with no interpolations", () => {
      const f = sql`SELECT 1`
      assert.strictEqual(f.text, "SELECT 1")
      assert.deepStrictEqual(f.params, [])
    })

    it("parameterizes scalar values as ?", () => {
      const f = sql`SELECT * FROM guests WHERE id = ${42}`
      assert.strictEqual(f.text, "SELECT * FROM guests WHERE id = ?")
      assert.deepStrictEqual(f.params, [42])
    })

    it("parameterizes multiple scalar values", () => {
      const f = sql`SELECT * FROM t WHERE a = ${1} AND b = ${"hello"} AND c = ${null}`
      assert.strictEqual(f.text, "SELECT * FROM t WHERE a = ? AND b = ? AND c = ?")
      assert.deepStrictEqual(f.params, [1, "hello", null])
    })

    it("inlines SqlFragment values (text + params)", () => {
      const inner = sql`AND status = ${"active"}`
      const outer = sql`SELECT * FROM t WHERE 1=1 ${inner}`
      assert.strictEqual(outer.text, "SELECT * FROM t WHERE 1=1 AND status = ?")
      assert.deepStrictEqual(outer.params, ["active"])
    })

    it("handles mixed scalars and fragments in correct order", () => {
      const frag = sql`b = ${2}`
      const f = sql`SELECT * FROM t WHERE a = ${1} AND ${frag} AND c = ${3}`
      assert.strictEqual(f.text, "SELECT * FROM t WHERE a = ? AND b = ? AND c = ?")
      assert.deepStrictEqual(f.params, [1, 2, 3])
    })

    it("composes deeply nested fragments", () => {
      const inner = sql`x = ${10}`
      const middle = sql`(${inner} OR y = ${20})`
      const outer = sql`SELECT * FROM t WHERE ${middle}`
      assert.strictEqual(outer.text, "SELECT * FROM t WHERE (x = ? OR y = ?)")
      assert.deepStrictEqual(outer.params, [10, 20])
    })

    it("handles empty fragment interpolation", () => {
      const f = sql`SELECT * FROM t WHERE 1=1 ${sql.empty} ORDER BY id`
      assert.strictEqual(f.text, "SELECT * FROM t WHERE 1=1  ORDER BY id")
      assert.deepStrictEqual(f.params, [])
    })
  })

  // ─── sql.empty ───

  describe("sql.empty", () => {
    it("has empty text and no params", () => {
      assert.strictEqual(sql.empty.text, "")
      assert.deepStrictEqual(sql.empty.params, [])
    })

    it("is frozen (immutable)", () => {
      assert.ok(Object.isFrozen(sql.empty))
    })

    it("is the same reference from sql.join with empty array", () => {
      assert.strictEqual(sql.join([]), sql.empty)
    })
  })

  // ─── sql.raw() ───

  describe("sql.raw", () => {
    it("creates fragment with raw text and no params", () => {
      const f = sql.raw("ORDER BY name ASC")
      assert.strictEqual(f.text, "ORDER BY name ASC")
      assert.deepStrictEqual(f.params, [])
    })

    it("can be interpolated into a tagged template", () => {
      const order = sql.raw("ORDER BY id DESC")
      const f = sql`SELECT * FROM t ${order}`
      assert.strictEqual(f.text, "SELECT * FROM t ORDER BY id DESC")
      assert.deepStrictEqual(f.params, [])
    })
  })

  // ─── sql.join() ───

  describe("sql.join", () => {
    it("returns sql.empty for empty array", () => {
      assert.strictEqual(sql.join([]), sql.empty)
    })

    it("returns the single fragment for array of one", () => {
      const f = sql.join([sql`a = ${1}`])
      assert.strictEqual(f.text, "a = ?")
      assert.deepStrictEqual(f.params, [1])
    })

    it("joins multiple fragments with default comma separator", () => {
      const f = sql.join([sql`a = ${1}`, sql`b = ${2}`, sql`c = ${3}`])
      assert.strictEqual(f.text, "a = ?, b = ?, c = ?")
      assert.deepStrictEqual(f.params, [1, 2, 3])
    })

    it("joins with custom separator", () => {
      const f = sql.join([sql`a = ${1}`, sql`b = ${2}`], " AND ")
      assert.strictEqual(f.text, "a = ? AND b = ?")
      assert.deepStrictEqual(f.params, [1, 2])
    })

    it("preserves parameter order across fragments", () => {
      const f = sql.join([sql`x = ${10}`, sql`y = ${20}`, sql`z = ${30}`], " OR ")
      assert.deepStrictEqual(f.params, [10, 20, 30])
    })
  })

  // ─── sql.list() ───

  describe("sql.list", () => {
    it("builds parenthesized placeholders for single value", () => {
      const f = sql.list([42])
      assert.strictEqual(f.text, "(?)")
      assert.deepStrictEqual(f.params, [42])
    })

    it("builds parenthesized placeholders for multiple values", () => {
      const f = sql.list([1, 2, 3])
      assert.strictEqual(f.text, "(?, ?, ?)")
      assert.deepStrictEqual(f.params, [1, 2, 3])
    })

    it("works in an IN clause", () => {
      const f = sql`SELECT * FROM t WHERE id IN ${sql.list([10, 20, 30])}`
      assert.strictEqual(f.text, "SELECT * FROM t WHERE id IN (?, ?, ?)")
      assert.deepStrictEqual(f.params, [10, 20, 30])
    })

    it("throws on empty array", () => {
      assert.throws(() => sql.list([]), { message: "sql.list() requires at least one value" })
    })
  })

  // ─── sql.if() ───

  describe("sql.if", () => {
    it("returns then fragment when condition is truthy", () => {
      const f = sql.if(true, sql`AND active = ${1}`)
      assert.strictEqual(f.text, "AND active = ?")
      assert.deepStrictEqual(f.params, [1])
    })

    it("returns sql.empty when condition is falsy and no otherwise", () => {
      const f = sql.if(false, sql`AND active = ${1}`)
      assert.strictEqual(f, sql.empty)
    })

    it("returns sql.empty when condition is null", () => {
      const f = sql.if(null, sql`AND active = ${1}`)
      assert.strictEqual(f, sql.empty)
    })

    it("returns sql.empty when condition is undefined", () => {
      const f = sql.if(undefined, sql`AND active = ${1}`)
      assert.strictEqual(f, sql.empty)
    })

    it("returns sql.empty when condition is empty string", () => {
      const f = sql.if("", sql`AND active = ${1}`)
      assert.strictEqual(f, sql.empty)
    })

    it("returns then for truthy non-boolean values", () => {
      const then = sql`AND x = ${1}`
      assert.strictEqual(sql.if(1, then), then)
      assert.strictEqual(sql.if("yes", then), then)
      assert.strictEqual(sql.if({}, then), then)
    })

    it("returns otherwise fragment when condition is falsy", () => {
      const otherwise = sql`ORDER BY name ASC`
      const f = sql.if(false, sql`ORDER BY name DESC`, otherwise)
      assert.strictEqual(f, otherwise)
    })

    it("composes with tagged template", () => {
      const status = "active"
      const f = sql`SELECT * FROM t WHERE 1=1 ${sql.if(status, sql`AND status = ${status}`)}`
      assert.strictEqual(f.text, "SELECT * FROM t WHERE 1=1 AND status = ?")
      assert.deepStrictEqual(f.params, ["active"])
    })

    it("composes with tagged template when falsy", () => {
      const status = ""
      const f = sql`SELECT * FROM t WHERE 1=1 ${sql.if(status, sql`AND status = ${status}`)}`
      assert.strictEqual(f.text, "SELECT * FROM t WHERE 1=1 ")
      assert.deepStrictEqual(f.params, [])
    })
  })

  // ─── sql.and() ───

  describe("sql.and", () => {
    it("joins fragments with AND", () => {
      const f = sql.and([sql`a = ${1}`, sql`b = ${2}`])
      assert.strictEqual(f.text, "a = ? AND b = ?")
      assert.deepStrictEqual(f.params, [1, 2])
    })

    it("filters out empty fragments", () => {
      const f = sql.and([sql`a = ${1}`, sql.empty, sql`b = ${2}`, sql.empty])
      assert.strictEqual(f.text, "a = ? AND b = ?")
      assert.deepStrictEqual(f.params, [1, 2])
    })

    it("returns sql.empty when all fragments are empty", () => {
      const f = sql.and([sql.empty, sql.empty])
      assert.strictEqual(f, sql.empty)
    })

    it("returns sql.empty for empty array", () => {
      const f = sql.and([])
      assert.strictEqual(f, sql.empty)
    })

    it("returns single fragment unchanged when only one is non-empty", () => {
      const f = sql.and([sql.empty, sql`x = ${99}`, sql.empty])
      assert.strictEqual(f.text, "x = ?")
      assert.deepStrictEqual(f.params, [99])
    })

    it("composes with sql.if for conditional filters", () => {
      const status = "active"
      const search = ""
      const f = sql.and([
        sql.if(status, sql`status = ${status}`),
        sql.if(search, sql`name LIKE ${search}`),
      ])
      assert.strictEqual(f.text, "status = ?")
      assert.deepStrictEqual(f.params, ["active"])
    })
  })

  // ─── sql.or() ───

  describe("sql.or", () => {
    it("joins fragments with OR", () => {
      const f = sql.or([sql`a = ${1}`, sql`b = ${2}`])
      assert.strictEqual(f.text, "a = ? OR b = ?")
      assert.deepStrictEqual(f.params, [1, 2])
    })

    it("filters out empty fragments", () => {
      const f = sql.or([sql.empty, sql`a = ${1}`, sql.empty, sql`b = ${2}`])
      assert.strictEqual(f.text, "a = ? OR b = ?")
      assert.deepStrictEqual(f.params, [1, 2])
    })

    it("returns sql.empty when all fragments are empty", () => {
      const f = sql.or([sql.empty])
      assert.strictEqual(f, sql.empty)
    })

    it("returns sql.empty for empty array", () => {
      const f = sql.or([])
      assert.strictEqual(f, sql.empty)
    })
  })

  // ─── sql.values() ───

  describe("sql.values", () => {
    it("builds single-row VALUES clause", () => {
      const f = sql.values([["Alice", "alice@test.com"]])
      assert.strictEqual(f.text, "(?, ?)")
      assert.deepStrictEqual(f.params, ["Alice", "alice@test.com"])
    })

    it("builds multi-row VALUES clause", () => {
      const f = sql.values([
        ["Alice", "alice@test.com"],
        ["Bob", "bob@test.com"],
      ])
      assert.strictEqual(f.text, "(?, ?), (?, ?)")
      assert.deepStrictEqual(f.params, ["Alice", "alice@test.com", "Bob", "bob@test.com"])
    })

    it("builds three-row VALUES clause", () => {
      const f = sql.values([[1], [2], [3]])
      assert.strictEqual(f.text, "(?), (?), (?)")
      assert.deepStrictEqual(f.params, [1, 2, 3])
    })

    it("works in a full INSERT statement", () => {
      const f = sql`INSERT INTO t (a, b) VALUES ${sql.values([[1, "x"], [2, "y"]])}`
      assert.strictEqual(f.text, "INSERT INTO t (a, b) VALUES (?, ?), (?, ?)")
      assert.deepStrictEqual(f.params, [1, "x", 2, "y"])
    })

    it("throws on empty rows array", () => {
      assert.throws(() => sql.values([]), { message: "sql.values() requires at least one row" })
    })
  })

  // ─── sql.set() ───

  describe("sql.set", () => {
    it("builds SET clause from object", () => {
      const f = sql.set({ name: "Alice", email: "a@b.com" })
      assert.strictEqual(f.text, '"name" = ?, "email" = ?')
      assert.deepStrictEqual(f.params, ["Alice", "a@b.com"])
    })

    it("skips undefined values", () => {
      const f = sql.set({ name: "Alice", email: undefined, phone: "+1234" })
      assert.strictEqual(f.text, '"name" = ?, "phone" = ?')
      assert.deepStrictEqual(f.params, ["Alice", "+1234"])
    })

    it("includes null values (null is a valid SQL value)", () => {
      const f = sql.set({ name: "Alice", email: null })
      assert.strictEqual(f.text, '"name" = ?, "email" = ?')
      assert.deepStrictEqual(f.params, ["Alice", null])
    })

    it("escapes double quotes in column names", () => {
      const f = sql.set({ 'col"name': "value" })
      assert.strictEqual(f.text, '"col""name" = ?')
      assert.deepStrictEqual(f.params, ["value"])
    })

    it("works in an UPDATE statement", () => {
      const f = sql`UPDATE t SET ${sql.set({ name: "Bob", age: 30 })} WHERE id = ${1}`
      assert.strictEqual(f.text, 'UPDATE t SET "name" = ?, "age" = ? WHERE id = ?')
      assert.deepStrictEqual(f.params, ["Bob", 30, 1])
    })

    it("throws when all values are undefined", () => {
      assert.throws(
        () => sql.set({ a: undefined, b: undefined }),
        { message: "sql.set() requires at least one non-undefined value" },
      )
    })
  })

  // ─── sql.identifier() ───

  describe("sql.identifier", () => {
    it("wraps name in double quotes", () => {
      const f = sql.identifier("column_name")
      assert.strictEqual(f.text, '"column_name"')
      assert.deepStrictEqual(f.params, [])
    })

    it("escapes double quotes within name", () => {
      const f = sql.identifier('has"quote')
      assert.strictEqual(f.text, '"has""quote"')
    })

    it("handles names with spaces", () => {
      const f = sql.identifier("column name")
      assert.strictEqual(f.text, '"column name"')
    })

    it("works interpolated into a query", () => {
      const col = sql.identifier("user_name")
      const f = sql`SELECT ${col} FROM t WHERE id = ${1}`
      assert.strictEqual(f.text, 'SELECT "user_name" FROM t WHERE id = ?')
      assert.deepStrictEqual(f.params, [1])
    })
  })

  // ─── Complex composition patterns ───

  describe("complex composition", () => {
    it("conditional WHERE with multiple filters", () => {
      const status = "active"
      const search = "alice"
      const includeDeleted = false
      const pattern = "%" + search + "%"

      const filters = sql.and([
        sql.if(!includeDeleted, sql`deleted_at IS NULL`),
        sql.if(status, sql`status = ${status}`),
        sql.if(search, sql`name LIKE ${pattern}`),
      ])

      const f = sql`SELECT * FROM t WHERE ${filters} ORDER BY id`
      assert.strictEqual(f.text, "SELECT * FROM t WHERE deleted_at IS NULL AND status = ? AND name LIKE ? ORDER BY id")
      assert.deepStrictEqual(f.params, ["active", "%alice%"])
    })

    it("dynamic UPDATE with sql.set", () => {
      const updates = { name: "Bob", email: undefined, phone: "+1234567890" }
      const f = sql`UPDATE guests SET ${sql.set(updates)} WHERE id = ${42}`
      assert.strictEqual(f.text, 'UPDATE guests SET "name" = ?, "phone" = ? WHERE id = ?')
      assert.deepStrictEqual(f.params, ["Bob", "+1234567890", 42])
    })

    it("batch INSERT with sql.values", () => {
      const rows = [
        ["Alice", "alice@test.com", 2],
        ["Bob", "bob@test.com", 1],
      ]
      const f = sql`INSERT INTO guests (name, email, party_size) VALUES ${sql.values(rows)}`
      assert.strictEqual(f.text, "INSERT INTO guests (name, email, party_size) VALUES (?, ?, ?), (?, ?, ?)")
      assert.deepStrictEqual(f.params, ["Alice", "alice@test.com", 2, "Bob", "bob@test.com", 1])
    })

    it("OR conditions with sql.or", () => {
      const email = "test@test.com"
      const phone = "+1234567890"

      const conditions = sql.or([
        sql.if(email, sql`email = ${email}`),
        sql.if(phone, sql`phone = ${phone}`),
      ])
      const f = sql`SELECT * FROM guests WHERE ${conditions}`
      assert.strictEqual(f.text, "SELECT * FROM guests WHERE email = ? OR phone = ?")
      assert.deepStrictEqual(f.params, ["test@test.com", "+1234567890"])
    })

    it("IN clause combined with conditional filter", () => {
      const ids = [1, 2, 3]
      const includeDeleted = false
      const deleted = sql.if(!includeDeleted, sql`AND deleted_at IS NULL`)
      const f = sql`SELECT * FROM guests WHERE id IN ${sql.list(ids)} ${deleted}`
      assert.strictEqual(f.text, "SELECT * FROM guests WHERE id IN (?, ?, ?) AND deleted_at IS NULL")
      assert.deepStrictEqual(f.params, [1, 2, 3])
    })

    it("identifier used for dynamic column in ORDER BY", () => {
      const sortCol = sql.identifier("created_at")
      const dir = sql.raw("DESC")
      const f = sql`SELECT * FROM t ORDER BY ${sortCol} ${dir}`
      assert.strictEqual(f.text, 'SELECT * FROM t ORDER BY "created_at" DESC')
      assert.deepStrictEqual(f.params, [])
    })
  })
})
