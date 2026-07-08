// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// social (comments + reactions) integration file its own server port. node --test
// runs test files concurrently — api.test.js binds 3001, accounts 3002, guestbook
// 3003, media 3004 — so this one binds 3005. Imported FIRST by social.test.js so
// the port is set before ../helpers.js reads TEST_SERVER_PORT at import time.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3005"
