/** @file Database connection management */
/** @import * as Types from './types.js' */
/** @import {SQLInputValue} from 'node:sqlite' */

import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import { createTables, runMigrations } from "./schema.js"

const __dirname = import.meta.dirname
const DB_PATH = path.join(__dirname, "..", "data", "wedding.db")

/** @type {DatabaseSync | null} */
let db = null

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

  return db
}

/** @type {Types.getDb} */
export function getDb() {
  if (!db) throw new Error("Database not initialized. Call init() first.")
  return db
}

/** @type {Types.close} */
export function close() {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * @template T
 * @param {string} sql
 * @param {SQLInputValue[]} params
 * @returns {T | undefined}
 */
export function queryOne(sql, ...params) {
  return /** @type {T | undefined} */ (
    getDb()
      .prepare(sql)
      .get(...params)
  )
}

/**
 * @template T
 * @param {string} sql
 * @param {SQLInputValue[]} params
 * @returns {T[]}
 */
export function queryAll(sql, ...params) {
  return /** @type {T[]} */ (
    getDb()
      .prepare(sql)
      .all(...params)
  )
}
