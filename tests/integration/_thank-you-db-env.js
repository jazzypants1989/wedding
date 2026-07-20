// Side-effect module (NOT a *.test.js file, so the runner ignores it): points
// db/connection.js's DB_PATH constant (computed once at import time from
// process.env.DATABASE_PATH) at the SAME SQLite file the spawned test server
// uses (helpers.js's TEST_DB_PATH), so this test file can seed thank-you cards
// directly via db/thank-you-cards.js / db/gifts.js functions instead of raw SQL
// (the admin API doesn't exist yet — Phase 3 is public-API-only).
//
// Must be imported by thank-you.test.js BEFORE any db/*.js module (including
// transitively, e.g. db/thank-you-cards.js -> db/utils.js -> db/connection.js) —
// ES module imports are hoisted, so this has to live in its own file rather than
// a plain statement between two `import`s in the test file itself.
import { TEST_DB_PATH } from "../helpers.js"

process.env.DATABASE_PATH = TEST_DB_PATH
