// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// face-assignment integration file its own server port. node --test runs test
// files concurrently — api 3001, accounts 3002, guestbook 3003, media 3004,
// social 3005, moderation 3006, site-content 3007, effect-config 3008,
// thank-you 3009, import-media 3010 — so this one binds 3011. Imported FIRST by
// faces-admin.test.js so the port is set before ../helpers.js reads the env.
import os from "node:os"
import path from "node:path"

process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3011"

// ...and, uniquely among the integration files, the DATABASE PATH too.
//
// faces-admin.test.js loads db/face-assignments.js into the TEST process, so
// that it can replay a face's ledger and revoke a batch — the projection logic
// is 60 lines of JS and re-implementing it in the test to check the test would
// be checking a copy. db/connection.js snapshots `DATABASE_PATH` at
// module-evaluation time, and ../helpers.js transitively evaluates it, so the
// variable has to be set BEFORE that import: here, and nowhere later.
//
// helpers.js's TEST_DB_PATH honours an already-set value, so the server child
// process and this one agree on which file they are both using.
process.env.DATABASE_PATH =
  process.env.DATABASE_PATH ||
  path.join(os.tmpdir(), `wedding-test-faces-${process.pid}-${Date.now()}.db`)
