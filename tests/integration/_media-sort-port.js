// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// Gallery → Sort integration file its own server port. node --test runs test
// files concurrently and 3001–3012 are taken by the others, so this one binds
// 3013. Imported FIRST by media-sort.test.js so the port is set before
// ../helpers.js reads the env.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3013"
