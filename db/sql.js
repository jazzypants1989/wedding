/** @file SQL tagged template literal system for type-safe, cached queries */
/** @import * as Types from './types.js' */
/** @import {SQLInputValue, StatementSync} from 'node:sqlite' */

/** @type {((sql: string) => StatementSync) | null} */
let _getStmt = null

/** @type {Types.bindExecutor} */
export function bindExecutor(getStmtFn) {
  _getStmt = getStmtFn
}

export class SqlFragment {
  /**
   * @param {string} text
   * @param {SQLInputValue[]} params
   */
  constructor(text, params) {
    this.text = text
    this.params = params
  }

  /**
   * @template T
   * @returns {T | undefined}
   */
  get() {
    if (!_getStmt)
      throw new Error(
        "SQL executor not bound — call bindExecutor() during init",
      )
    return /** @type {T | undefined} */ (
      _getStmt(this.text).get(...this.params)
    )
  }

  /**
   * @template T
   * @returns {T[]}
   */
  all() {
    if (!_getStmt)
      throw new Error(
        "SQL executor not bound — call bindExecutor() during init",
      )
    return /** @type {T[]} */ (_getStmt(this.text).all(...this.params))
  }

  run() {
    if (!_getStmt)
      throw new Error(
        "SQL executor not bound — call bindExecutor() during init",
      )
    return _getStmt(this.text).run(...this.params)
  }
}

/** @type {Types.sqlFn} */
export function sql(strings, ...values) {
  let text = strings[0]
  /** @type {SQLInputValue[]} */
  const params = []

  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    if (val instanceof SqlFragment) {
      text += val.text
      params.push(...val.params)
    } else {
      text += "?"
      params.push(/** @type {SQLInputValue} */ (val))
    }
    text += strings[i + 1]
  }

  return new SqlFragment(text, params)
}

sql.empty = Object.freeze(new SqlFragment("", []))

/** @type {Types.sqlRawFn} */
sql.raw = function raw(text) {
  return new SqlFragment(text, [])
}

/** @type {Types.sqlJoinFn} */
sql.join = function join(fragments, separator = ", ") {
  if (fragments.length === 0) return sql.empty
  let text = ""
  /** @type {SQLInputValue[]} */
  const params = []
  for (let i = 0; i < fragments.length; i++) {
    if (i > 0) text += separator
    text += fragments[i].text
    params.push(...fragments[i].params)
  }
  return new SqlFragment(text, params)
}

/** @type {Types.sqlListFn} */
sql.list = function list(values) {
  if (values.length === 0)
    throw new Error("sql.list() requires at least one value")
  const placeholders = values.map(() => "?").join(", ")
  return new SqlFragment("(" + placeholders + ")", [...values])
}

/** @type {Types.sqlIfFn} */
sql.if = function sqlIf(condition, then, otherwise) {
  return condition ? then : otherwise || sql.empty
}

/** @type {Types.sqlAndFn} */
sql.and = function and(fragments) {
  const nonEmpty = fragments.filter((f) => f.text !== "")
  return sql.join(nonEmpty, " AND ")
}

/** @type {Types.sqlOrFn} */
sql.or = function or(fragments) {
  const nonEmpty = fragments.filter((f) => f.text !== "")
  return sql.join(nonEmpty, " OR ")
}

/** @type {Types.sqlValuesFn} */
sql.values = function values(rows) {
  if (rows.length === 0)
    throw new Error("sql.values() requires at least one row")
  const rowFragments = rows.map((row) => sql.list(row))
  return sql.join(rowFragments, ", ")
}

/** @type {Types.sqlSetFn} */
sql.set = function set(obj) {
  /** @type {SqlFragment[]} */
  const sets = []
  const keys = Object.keys(obj)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = obj[key]
    if (value === undefined) continue
    sets.push(
      new SqlFragment('"' + key.replaceAll('"', '""') + '" = ?', [value]),
    )
  }
  if (sets.length === 0)
    throw new Error("sql.set() requires at least one non-undefined value")
  return sql.join(sets, ", ")
}

/** @type {Types.sqlIdentifierFn} */
sql.identifier = function identifier(name) {
  return new SqlFragment('"' + name.replaceAll('"', '""') + '"', [])
}
