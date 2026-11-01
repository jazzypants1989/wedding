/**
 * @file The `add_honeymoon_section` migration: widening the media section
 * CHECK triggers to admit 'honeymoon'.
 *
 * The migration only drops and recreates the two section triggers — it must
 * never rebuild `media`, because `media_faces` cascades from it (TRAPS.md).
 * So the pinned fixture holds a row in every pre-existing section AND a face
 * row hanging off one of them, and asserts all of it is still there, unchanged,
 * after migrating. A rebuild would show up as a lost face row.
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { DatabaseSync } from "node:sqlite"

import { createTables, runMigrations } from "../../../db/schema.js"

const OLD_SECTIONS = ["official", "guest", "content"]

function freshDb() {
  const db = new DatabaseSync(":memory:")
  db.exec("PRAGMA foreign_keys = ON")
  createTables(db)
  runMigrations(db)
  return db
}

/** @param {DatabaseSync} db @param {string} section @param {string} fileKey */
function insertMedia(db, section, fileKey) {
  return Number(
    db
      .prepare(
        "INSERT INTO media (file_key, kind, section, status) VALUES (?, 'image', ?, 'approved')",
      )
      .run(fileKey, section).lastInsertRowid,
  )
}

/** @param {DatabaseSync} db @param {number} mediaId */
function insertFace(db, mediaId) {
  return Number(
    db
      .prepare(
        `INSERT INTO media_faces (media_id, bbox_x, bbox_y, bbox_w, bbox_h, model_version, source)
         VALUES (?, 1, 2, 3, 4, 'test-model', 'cli')`,
      )
      .run(mediaId).lastInsertRowid,
  )
}

/** Put a migrated database back to the state just before add_honeymoon_section:
 *  the three-value triggers, and no ledger row. @param {DatabaseSync} db */
function pinPreHoneymoon(db) {
  const list = OLD_SECTIONS.map((s) => `'${s}'`).join(", ")
  db.exec(`
    DROP TRIGGER check_media_section_insert;
    DROP TRIGGER check_media_section_update;
    CREATE TRIGGER check_media_section_insert BEFORE INSERT ON media
    FOR EACH ROW WHEN NEW.section NOT IN (${list})
    BEGIN SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, or content'); END;
    CREATE TRIGGER check_media_section_update BEFORE UPDATE ON media
    FOR EACH ROW WHEN NEW.section NOT IN (${list})
    BEGIN SELECT RAISE(ABORT, 'Invalid media section. Must be: official, guest, or content'); END;
    DELETE FROM migrations WHERE name = 'add_honeymoon_section';
  `)
}

describe("add_honeymoon_section migration over an existing database", () => {
  it("keeps every old-section row (and its faces) and then admits honeymoon", () => {
    const db = freshDb()
    pinPreHoneymoon(db)

    /** @type {Record<string, number>} */
    const ids = {}
    for (const section of OLD_SECTIONS) ids[section] = insertMedia(db, section, `key-${section}`)
    const faceId = insertFace(db, ids.official)
    // The old trigger is really in place: honeymoon is refused before migrating.
    assert.throws(() => insertMedia(db, "honeymoon", "key-early"), /Invalid media section/)

    runMigrations(db)

    const rows = /** @type {Array<{ id: number, file_key: string, section: string }>} */ (
      db.prepare("SELECT id, file_key, section FROM media ORDER BY id").all()
    )
    assert.deepStrictEqual(
      rows.map((r) => ({ id: r.id, file_key: r.file_key, section: r.section })),
      OLD_SECTIONS.map((s) => ({ id: ids[s], file_key: `key-${s}`, section: s })),
      "every pre-existing row survives with its id and section",
    )
    const face = /** @type {{ media_id: number } | undefined} */ (
      db.prepare("SELECT media_id FROM media_faces WHERE id = ?").get(faceId)
    )
    assert.strictEqual(face?.media_id, ids.official, "media_faces was not cascaded away")

    // Widened: honeymoon inserts, and an existing row can move into it.
    const honeymoonId = insertMedia(db, "honeymoon", "key-honeymoon")
    assert.ok(honeymoonId > 0)
    db.prepare("UPDATE media SET section = 'honeymoon' WHERE id = ?").run(ids.official)
    // Still a CHECK: anything outside the list is refused both ways.
    assert.throws(() => insertMedia(db, "bogus", "key-bogus"), /Invalid media section/)
    assert.throws(
      () => db.prepare("UPDATE media SET section = 'bogus' WHERE id = ?").run(ids.guest),
      /Invalid media section/,
    )
    assert.ok(db.prepare("SELECT 1 FROM migrations WHERE name = 'add_honeymoon_section'").get())

    // Re-running is a no-op (the ledger row guards it).
    assert.doesNotThrow(() => runMigrations(db))
    db.close()
  })

  it("a fresh database accepts honeymoon and still refuses an unknown section", () => {
    const db = freshDb()
    assert.ok(insertMedia(db, "honeymoon", "fresh-honeymoon") > 0)
    assert.throws(() => insertMedia(db, "nope", "fresh-nope"), /Invalid media section/)
    db.close()
  })
})
