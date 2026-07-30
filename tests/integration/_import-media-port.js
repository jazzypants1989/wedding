// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// importer integration file its own server port and storage env. node --test runs
// test files concurrently, so each integration file needs a distinct port.
// Imported FIRST by import-media.test.js so these are set before ../helpers.js
// reads the env (helpers spawns the server with `{ ...process.env }`, so the
// child inherits these too).
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3010"
// A machine with < 5GB free would 507 every upload in CI.
process.env.MEDIA_MIN_FREE_BYTES = process.env.MEDIA_MIN_FREE_BYTES || "0"
// Small enough that one oversized fixture trips the site-wide cap on purpose,
// large enough that every other fixture in this file fits comfortably.
process.env.MEDIA_MAX_TOTAL_BYTES = process.env.MEDIA_MAX_TOTAL_BYTES || "5000000"

// The LOCAL sink writes through this process's own db/connection.js and
// core/media-storage.js, and both read DATABASE_PATH at import time. Point it at
// a directory of its own: media-storage derives the uploads tree from
// dirname(DATABASE_PATH), so sharing os.tmpdir() with the spawned server would
// put both sinks' files in one tree and make the assertions meaningless.
export const LOCAL_DATA_DIR = path.join(os.tmpdir(), `wedding-import-local-${process.pid}`)
fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true })
process.env.DATABASE_PATH = path.join(LOCAL_DATA_DIR, "wedding.db")
