// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// merged-Guests accounts integration file its own server port. node --test runs
// test files concurrently and 3001–3011 are taken (see the other _*-port.js
// files), so this one binds 3012. Imported FIRST by
// admin-guests-accounts.test.js so it is set before ../helpers.js reads the env.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3012"
