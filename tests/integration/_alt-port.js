// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// accounts integration file its own server port. node --test runs test files
// concurrently, and api.test.js already binds 3001 — without this the two servers
// would collide on the same port. Imported FIRST by accounts.test.js so the port
// is set before ../helpers.js reads TEST_SERVER_PORT at import time.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3002"
