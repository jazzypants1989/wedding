/**
 * @file One property, asserted structurally: **db/face-assignments.js is the
 * only thing in this repository that writes `media_faces.face_identity_id`.**
 *
 * That column is a PROJECTION of the append-only assignment ledger. If anything
 * else sets it, the column and the ledger drift — and they drift silently,
 * because every reader trusts the column and nobody replays the events to check.
 * The failure would surface much later as "undoing that bulk pass did nothing",
 * which is precisely the bug the ledger was built to make impossible.
 *
 * Two functions used to be the hole: `setFaceIdentity` and `repointFaces` in
 * db/media-faces.js. They are deleted rather than renamed or marked internal —
 * an unused export is an invitation — and this test is what keeps them deleted.
 *
 * A source scan is a legitimate way to assert this and the repo already does
 * the same kind of thing (tests/unit/vision-purity.test.js, which greps
 * public/vision/ for `node:` imports). Nothing else can express "no future
 * module writes this column": a runtime test can only observe the writers that
 * happen to run.
 *
 * ## WHAT THIS SCAN CANNOT SEE
 *
 * Stated up front, because a structural test's worth is exactly the gap between
 * what it claims and what it checks, and this one is easy to over-read.
 *
 * 1. **`ON DELETE SET NULL` is a genuine second writer, and no source scan can
 *    catch it.** `media_faces.face_identity_id` carries
 *    `REFERENCES face_identities(id) ON DELETE SET NULL` (db/schema.js), so
 *    hard-deleting an identity row nulls the column on every face pointing at
 *    it, with no statement anywhere naming either. The ledger is untouched, so
 *    the column and a replay then disagree. That is a real hole in the claim
 *    this file's title makes, it is not fixable here, and pretending otherwise
 *    would be worse than saying so: what keeps it shut is that nothing
 *    hard-deletes an identity — `softDeleteIdentity` and `mergeIdentityInto`
 *    are the only paths, and both are updates. The schema comment at that
 *    foreign key carries the same warning.
 * 2. **`tests/` is scanned but not forbidden.** A test may legitimately seed a
 *    PRE-LEDGER row — a column value with no events behind it — because that
 *    state exists in any database written before the ledger landed and the
 *    merge back-fill has to be exercised against it. So test writes are
 *    permitted, by FILE, in `TEST_FIXTURE_FILES` below: the point is that a new
 *    one is a deliberate addition to a list rather than invisible.
 * 3. **A write assembled at runtime out of strings this scan never sees** — a
 *    column name read from a config file, SQL built by concatenation across
 *    functions — is beyond any lexical check. The scan does refuse a write
 *    whose column name is dynamic AT THE CALL SITE (`sql.raw`, `sql.identifier`,
 *    `sql.set` inside a `media_faces` write), which is the reachable half.
 *
 * NO REGEX, per CLAUDE.md — the normalisation below is `split`/`join`/
 * `toLowerCase`/`indexOf` and the statement windows are found with `indexOf`.
 */

import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..")

/** The one file allowed to write the column, relative to the repo root. */
const LEDGER = "db/face-assignments.js"

/** This file, repo-relative. It is inside its own scan now that `tests/` is
 *  scanned, and it necessarily quotes the things it forbids. */
const SELF = "tests/unit/db/face-identity-single-writer.test.js"

/**
 * The one exception, and it is a real one rather than an escape hatch.
 *
 * `db/schema.js`'s `add_people` migration consolidates duplicate live
 * identities onto the lowest id so a partial unique index can be created. It
 * cannot go through the ledger: a migration replays against databases written
 * long before `face_assignments` existed, it runs while the schema is
 * mid-change, and appending an "event" for a row-shuffle nobody decided would
 * be a lie in a table whose entire value is that every row is a decision
 * somebody made.
 *
 * Listed by file rather than waved through by convention, so that a SECOND
 * direct write appearing in schema.js is still a conversation — the count
 * below is asserted, not just the file name.
 */
const MIGRATION_EXCEPTIONS = new Map([["db/schema.js", 1]])

/**
 * Test files allowed to write the column directly, and why they are allowed by
 * FILE rather than by count.
 *
 * A test fixture seeding `face_identity_id` with no events behind it is
 * reproducing a real database state — a row written before the ledger existed —
 * and the merge back-fill, the projection's receipt logic and the export's
 * "column is the state" rule all have to be exercised against it. Forbidding
 * the write would forbid testing the case.
 *
 * Not count-pinned, unlike the migration exception above, and the difference is
 * deliberate: a fixture is not a writer. Nothing in production reads what a
 * test seeds, so a second seed in an already-listed file changes no property of
 * the system, while a second write in db/schema.js changes what ships. What the
 * list buys is that a NEW file seeding the column has to say so out loud.
 */
const TEST_FIXTURE_FILES = new Set([
  "tests/integration/faces-admin.test.js",
  "tests/unit/db/add-people-migration.test.js",
  "tests/unit/db/media-faces.test.js",
  "tests/unit/db/media-faces-routing.test.js",
  "tests/unit/db/vision-provenance-migration.test.js",
  "tests/unit/vision-export-face-work.test.js",
  // This file. Its fixtures below are deliberately-obfuscated writes fed to the
  // scanner as strings, so the scanner finds them in its own source too.
  SELF,
])

/** Directories the scan skips: generated, vendored, or not source. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".claude", "tmp", "data", "coverage"])

/** Extensions that can hold executable SQL. `.mjs`/`.cjs` are included because
 *  "the scan only looked at .js" is not a property anybody would defend out
 *  loud — it is just what the first version happened to do. */
const SOURCE_EXTENSIONS = [".js", ".mjs", ".cjs"]

/** Every source file in the repository worth scanning, repo-relative.
 *  @returns {string[]} */
function sourceFiles() {
  /** @type {string[]} */
  const found = []
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, dir || "."), { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".claude") continue
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(rel)
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        found.push(rel)
      }
    }
  }
  walk("")
  return found
}

/**
 * Drop JS comments, so a sentence ABOUT a write is never mistaken for one.
 *
 * Necessary because the next step collapses newlines: without this, a comment
 * mentioning `UPDATE media_faces` would run straight into whatever SQL followed
 * it and the two would read as one statement.
 *
 * `//` preceded by `:` is left alone — that is a URL scheme, not a comment, and
 * eating the rest of that line could swallow a closing backtick and merge two
 * statement windows into one.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  let out = ""
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === "//" && source[i - 1] !== ":") {
      const nl = source.indexOf("\n", i)
      if (nl === -1) break
      // The newline survives, so line structure (and the collapse below) is
      // unaffected by whether a line happened to end in a comment.
      i = nl
      continue
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2)
      if (end === -1) break
      i = end + 2
      continue
    }
    out += source[i]
    i++
  }
  return out
}

/**
 * Fold a source to the form the matching below assumes: comments gone, one case,
 * one space between everything.
 *
 * This is the half of the hardening that matters most. The first version of this
 * scan matched the literals `"UPDATE media_faces"` and `"INSERT INTO media_faces"`
 * and nothing else, so `UPDATE\n  media_faces`, `UPDATE  media_faces`, lowercase
 * sql and `insert or replace into media_faces` all walked straight past it —
 * none of them exotic, all of them things a formatter or a tired afternoon
 * produces by itself.
 * @param {string} source
 * @returns {string}
 */
function normalizeSource(source) {
  const stripped = stripComments(source).toLowerCase()
  let out = ""
  let space = false
  for (const ch of stripped) {
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      space = true
      continue
    }
    if (space && out.length > 0) out += " "
    space = false
    out += ch
  }
  return out
}

const TABLE = "media_faces"

/**
 * Write verbs, and how far back from the table name one may sit.
 *
 * A verb list plus a lookback rather than a list of exact phrases, because the
 * phrases are open-ended: `INSERT INTO`, `INSERT OR REPLACE INTO`,
 * `REPLACE INTO`, `UPDATE OR IGNORE`, and a quoted or aliased table
 * (`UPDATE "media_faces" AS mf`) are all the same act. The window is generous
 * enough for any conflict clause and short enough that an unrelated earlier
 * verb does not reach.
 */
const WRITE_VERBS = ["update", "insert", "replace"]
const VERB_LOOKBACK = 40

/** The three ways SQL is written into a JS file here. */
const STRING_DELIMITERS = ["`", '"', "'"]

/**
 * Every JS string literal in a source, as text.
 *
 * SQL only ever reaches SQLite through one of these, so a statement window is
 * bounded by the literal that carries it — which the first attempt at this
 * hardening got wrong twice in opposite directions. Ending a window at the next
 * backtick let `db.prepare("UPDATE media_faces ...")` run on into whatever
 * template literal came next in the file (this codebase writes no semicolons,
 * so nothing else stopped it) and report that. Ending it at the next quote of
 * ANY kind cut `UPDATE "media_faces" SET "face_identity_id"` off after the
 * table name and missed a real write.
 *
 * A one-pass reader of string state gets both right, and needs no regex: enter
 * on a delimiter, leave on the SAME delimiter, skip whatever follows a
 * backslash. Quoted SQL identifiers inside a template are then just characters,
 * because a `"` does not close a backtick.
 * @param {string} text normalised source
 * @returns {string[]}
 */
function stringLiterals(text) {
  /** @type {string[]} */
  const literals = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (!STRING_DELIMITERS.includes(ch)) {
      i++
      continue
    }
    const opener = ch
    let body = ""
    i++
    while (i < text.length && text[i] !== opener) {
      if (text[i] === "\\") i++
      else body += text[i]
      i++
    }
    i++
    literals.push(body)
  }
  return literals
}

/**
 * Every statement in one source that WRITES `media_faces`, as normalised text —
 * from the table name to the end of the statement it sits in.
 *
 * Statement-level rather than file-level, and it has to be: db/media-faces.js
 * both mentions `face_identity_id` (in SELECTs, which are fine) and runs
 * `UPDATE media_faces` (for `deleted_at` and the route columns, also fine).
 * Only the two together in one statement is a write.
 *
 * Within a literal, `;` still ends a statement — db/schema.js's `db.exec` blocks
 * hold a dozen of them in one template, and they are separate statements.
 * @param {string} source
 * @returns {string[]}
 */
function mediaFaceWrites(source) {
  /** @type {string[]} */
  const statements = []
  for (const literal of stringLiterals(normalizeSource(source))) {
    let from = 0
    for (;;) {
      const at = literal.indexOf(TABLE, from)
      if (at === -1) break
      from = at + TABLE.length

      const before = literal.slice(Math.max(0, at - VERB_LOOKBACK), at)
      if (!WRITE_VERBS.some((verb) => before.includes(verb))) continue

      const semicolon = literal.indexOf(";", at)
      statements.push(literal.slice(at, semicolon === -1 ? literal.length : semicolon))
    }
  }
  return statements
}

/** A dynamic column name inside a `media_faces` write. The column being
 *  computed is precisely what makes such a statement unreviewable by a lexical
 *  scan, so the scan refuses it outright rather than reading past it. */
const DYNAMIC_COLUMN_MARKERS = ["sql.raw(", "sql.identifier(", "sql.set("]

/** Whether one write statement touches `face_identity_id` — by name, or by a
 *  name this scan cannot resolve.
 *  @param {string} statement */
function writesFaceIdentity(statement) {
  if (statement.includes("face_identity_id")) return true
  return DYNAMIC_COLUMN_MARKERS.some((marker) => statement.includes(marker))
}

test("the scan has files to scan", () => {
  // Guards against this whole file passing vacuously if the layout moves.
  const files = sourceFiles()
  assert.ok(files.length > 50, `expected a repository's worth of sources, found ${files.length}`)
  assert.ok(files.includes(LEDGER), `${LEDGER} must be in the scan`)
  assert.ok(files.includes("db/media-faces.js"))
  assert.ok(files.includes("api/admin/faces.js"))
  // tests/ is scanned now — the fixtures in it are allowed by name, not hidden.
  assert.ok(files.includes("tests/unit/db/face-identity-single-writer.test.js"))
})

test("only db/face-assignments.js writes media_faces.face_identity_id", () => {
  /** @type {string[]} */
  const offenders = []
  /** @type {Map<string, number>} */
  const excepted = new Map()

  for (const file of sourceFiles()) {
    if (file === LEDGER) continue
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
    for (const statement of mediaFaceWrites(source)) {
      if (!writesFaceIdentity(statement)) continue
      if (MIGRATION_EXCEPTIONS.has(file)) {
        excepted.set(file, (excepted.get(file) ?? 0) + 1)
        continue
      }
      if (TEST_FIXTURE_FILES.has(file)) continue
      offenders.push(`${file}: ${statement.slice(0, 120)}`)
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    "face_identity_id is a projection of the assignment ledger. Append an event with " +
      "db/face-assignments.js's recordAssignment (which projects in the same call) rather " +
      "than setting the column. A test seeding a pre-ledger row is legitimate — add the file " +
      "to TEST_FIXTURE_FILES:\n" +
      offenders.join("\n"),
  )

  // The exceptions are pinned, not merely permitted: a new direct write added
  // to an excepted file is still a failure.
  for (const [file, allowed] of MIGRATION_EXCEPTIONS) {
    assert.strictEqual(
      excepted.get(file) ?? 0,
      allowed,
      `${file} is allowed exactly ${allowed} historical migration write(s) — no more, and no fewer`,
    )
  }
})

test("every listed test-fixture file still seeds the column — the list is not stale", () => {
  // A file that stops writing it should leave the list, or the list slowly
  // becomes a set of permissions nobody can justify.
  for (const file of TEST_FIXTURE_FILES) {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
    assert.ok(
      mediaFaceWrites(source).some(writesFaceIdentity),
      `${file} is listed in TEST_FIXTURE_FILES but no longer writes face_identity_id — drop it`,
    )
  }
})

test("the ledger does write it — the scan is looking for the right thing", () => {
  // Without this, deleting projectFace's UPDATE would make the test above pass.
  const source = fs.readFileSync(path.join(REPO_ROOT, LEDGER), "utf8")
  const writes = mediaFaceWrites(source).filter(writesFaceIdentity)
  assert.strictEqual(writes.length, 1, "exactly one writer, and it is projectFace's UPDATE")
})

test("the hardened scan catches writes the literal match walked past", () => {
  // Every one of these is a real write of the projected column, and every one
  // of them was invisible to the first version of this scan. They are strings
  // rather than files because the point is the SCANNER's behaviour — and this
  // file is in TEST_FIXTURE_FILES precisely because they are here.
  const evasions = [
    // A formatter breaking the line.
    "sql`UPDATE\n  media_faces\n  SET face_identity_id = ${id}\n  WHERE id = ${faceId}`",
    // Two spaces.
    "sql`UPDATE  media_faces SET face_identity_id = ${id}`",
    // Lower case, which is how half the SQL in the world is written.
    "sql`update media_faces set face_identity_id = ${id}`",
    // Upsert vocabulary the old keyword list did not know.
    "sql`INSERT OR REPLACE INTO media_faces (id, face_identity_id) VALUES (${a}, ${b})`",
    "sql`REPLACE INTO media_faces (id, face_identity_id) VALUES (${a}, ${b})`",
    "sql`UPDATE OR IGNORE media_faces SET face_identity_id = ${id}`",
    // A quoted identifier — same statement, four more characters.
    'sql`UPDATE "media_faces" SET "face_identity_id" = ${id}`',
    // An aliased table.
    "sql`UPDATE media_faces AS mf SET mf.face_identity_id = ${id}`",
    // The column hidden behind a quoted literal, so a window that stopped at
    // the first quote would never reach it.
    "sql`UPDATE media_faces SET route_reason = 'why', face_identity_id = ${id}`",
    // A dynamic column name: unreadable to any lexical scan, so refused as a
    // class rather than read past.
    "sql`UPDATE media_faces SET ${sql.raw(column)} = ${id} WHERE id = ${faceId}`",
    "sql`UPDATE media_faces SET ${sql.set(patch)} WHERE id = ${faceId}`",
    // Not a sql`` template at all.
    'db.prepare("UPDATE media_faces SET face_identity_id = ?").run(id)',
  ]

  for (const source of evasions) {
    const writes = mediaFaceWrites(source).filter(writesFaceIdentity)
    assert.strictEqual(writes.length, 1, `not caught: ${source}`)
  }
})

test("and does not cry wolf over reads or over other columns", () => {
  // A scan that flags everything is a scan somebody turns off.
  const innocent = [
    "sql`SELECT face_identity_id FROM media_faces WHERE id = ${faceId}`",
    "sql`SELECT f.face_identity_id, m.file_key FROM media_faces f JOIN media m ON m.id = f.media_id`",
    "sql`UPDATE media_faces SET deleted_at = ${when} WHERE id = ${faceId}`",
    "sql`UPDATE media_faces SET route_state = ${state}, route_reason = ${why} WHERE id = ${id}`",
    "sql`INSERT INTO media_faces (media_id, bbox_x) VALUES (${a}, ${b})`",
    // Prose about the column, in both comment styles, is not a write.
    "// nothing may UPDATE media_faces SET face_identity_id — use the ledger\nconst x = 1",
    "/* UPDATE media_faces SET face_identity_id = 1 */\nsql`SELECT 1`",
    // A URL is not a comment: the line after it must survive intact.
    "// see https://example.com/x\nsql`UPDATE media_faces SET deleted_at = ${w}`",
  ]

  for (const source of innocent) {
    assert.deepStrictEqual(
      mediaFaceWrites(source).filter(writesFaceIdentity),
      [],
      `false alarm on: ${source}`,
    )
  }
})

test("the two functions that used to bypass the ledger are gone, not just unused", async () => {
  const mediaFaces = await import("../../../db/media-faces.js")
  assert.strictEqual(
    /** @type {Record<string, unknown>} */ (mediaFaces).setFaceIdentity,
    undefined,
    "setFaceIdentity wrote the column directly — deleted, so nothing can reach for it",
  )
  assert.strictEqual(
    /** @type {Record<string, unknown>} */ (mediaFaces).repointFaces,
    undefined,
    "repointFaces rewrote every face of an identity — merge is a redirect now",
  )

  // And no module re-exports them under the old names from anywhere else.
  for (const file of sourceFiles()) {
    // This file names both functions, in the assertions above and in the
    // message below. Scanning tests brought it into its own scan's range; a
    // structural check that fails on its own source proves nothing.
    if (file === SELF) continue
    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
    assert.ok(
      !source.includes("export function setFaceIdentity"),
      `${file} re-introduces setFaceIdentity`,
    )
    assert.ok(
      !source.includes("export function repointFaces"),
      `${file} re-introduces repointFaces`,
    )
  }
})
