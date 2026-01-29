/** @file Database connection management */
/** @import * as Types from './types.js' */
/** @import {SQLInputValue} from 'node:sqlite' */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { createTables, runMigrations } from "./schema.js"
import { bindExecutor } from "./sql.js"

const __dirname = import.meta.dirname
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "wedding.db")

/** @type {DatabaseSync | null} */
let db = null

/** @type {Map<string, import('node:sqlite').StatementSync>} */
// Unbounded cache — acceptable because all SQL strings are static templates.
// Max entries ≈ number of distinct sql`` call sites × conditional variants.
const stmtCache = new Map()

/** @type {Types.init} */
export function init() {
  if (db) return db

  db = new DatabaseSync(DB_PATH)

  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA temp_store = MEMORY")
  db.exec("PRAGMA cache_size = -64000")

  createTables(db)
  runMigrations(db)
  bindExecutor(getStmt)

  return db
}

/** @type {Types.getDb} */
export function getDb() {
  if (!db) throw new Error("Database not initialized. Call init() first.")
  return db
}

/** @type {Types.close} */
export function close() {
  stmtCache.clear()
  if (db) {
    db.close()
    db = null
  }
}

/**
 * @param {string} sql
 * @returns {import('node:sqlite').StatementSync}
 */
export function getStmt(sql) {
  let stmt = stmtCache.get(sql)
  if (!stmt) {
    stmt = getDb().prepare(sql)
    stmtCache.set(sql, stmt)
  }
  return stmt
}

