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
 * NO REGEX, per CLAUDE.md — the statement windows below are found with
 * `indexOf` and sliced at the template literal's closing backtick.
 */

import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..")

/** The one file allowed to write the column, relative to the repo root. */
const LEDGER = "db/face-assignments.js"

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
 * Directories the scan skips.
 *
 * `tests` is skipped deliberately and it is worth saying why: a test may
 * legitimately seed a PRE-LEDGER row — a column value with no events behind it
 * — because that state exists in any database written before the ledger landed
 * and the merge back-fill has to be exercised against it. Forbidding the write
 * in test fixtures would forbid testing the case.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  "tmp",
  "data",
  "tests",
  "coverage",
])

/** Every .js file in the repository worth scanning, repo-relative.
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
      } else if (entry.name.endsWith(".js")) {
        found.push(rel)
      }
    }
  }
  walk("")
  return found
}

/**
 * Every `UPDATE media_faces` / `INSERT INTO media_faces` statement in one
 * source, as text — from the keyword to the closing backtick of the sql``
 * template it sits in.
 *
 * Statement-level rather than file-level, and it has to be: db/media-faces.js
 * both mentions `face_identity_id` (in SELECTs, which are fine) and runs
 * `UPDATE media_faces` (for `deleted_at` and the route columns, also fine).
 * Only the two together in one statement is a write.
 * @param {string} source
 * @returns {string[]}
 */
function mediaFaceWrites(source) {
  /** @type {string[]} */
  const statements = []
  for (const keyword of ["UPDATE media_faces", "INSERT INTO media_faces"]) {
    let from = 0
    for (;;) {
      const start = source.indexOf(keyword, from)
      if (start === -1) break
      const end = source.indexOf("`", start)
      statements.push(source.slice(start, end === -1 ? source.length : end))
      from = start + keyword.length
    }
  }
  return statements
}

test("the scan has files to scan", () => {
  // Guards against this whole file passing vacuously if the layout moves.
  const files = sourceFiles()
  assert.ok(files.length > 50, `expected a repository's worth of sources, found ${files.length}`)
  assert.ok(files.includes(LEDGER), `${LEDGER} must be in the scan`)
  assert.ok(files.includes("db/media-faces.js"))
  assert.ok(files.includes("api/admin/faces.js"))
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
      if (!statement.includes("face_identity_id")) continue
      if (MIGRATION_EXCEPTIONS.has(file)) {
        excepted.set(file, (excepted.get(file) ?? 0) + 1)
        continue
      }
      offenders.push(`${file}: ${statement.split("\n")[0].trim()}`)
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    "face_identity_id is a projection of the assignment ledger. Append an event with " +
      "db/face-assignments.js's recordAssignment (which projects in the same call) rather " +
      "than setting the column:\n" +
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

test("the ledger does write it — the scan is looking for the right thing", () => {
  // Without this, deleting projectFace's UPDATE would make the test above pass.
  const source = fs.readFileSync(path.join(REPO_ROOT, LEDGER), "utf8")
  const writes = mediaFaceWrites(source).filter((s) => s.includes("face_identity_id"))
  assert.strictEqual(writes.length, 1, "exactly one writer, and it is projectFace's UPDATE")
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
