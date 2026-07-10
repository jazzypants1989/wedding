// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// effect-config integration file its own server port so concurrent test files
// don't collide. Imported FIRST by effect-config.test.js so the port is set
// before ../helpers.js reads TEST_SERVER_PORT at import time.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3008"
