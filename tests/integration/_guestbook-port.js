// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// guestbook integration file its own server port. node --test runs test files
// concurrently, and api.test.js binds 3001 / accounts.test.js binds 3002 —
// without this the servers would collide. Imported FIRST by guestbook.test.js so
// the port is set before ../helpers.js reads TEST_SERVER_PORT at import time.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3003"
