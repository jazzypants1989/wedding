// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// site-content integration file its own server port. node --test runs test files
// concurrently, and other integration files bind 3001-3006 — without this the
// servers would collide. Imported FIRST by site-content.test.js so the port is
// set before ../helpers.js reads TEST_SERVER_PORT at import time.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3007"
