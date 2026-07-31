// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// face-assignment integration file its own server port. node --test runs test
// files concurrently — api 3001, accounts 3002, guestbook 3003, media 3004,
// social 3005, moderation 3006, site-content 3007, effect-config 3008,
// thank-you 3009, import-media 3010 — so this one binds 3011. Imported FIRST by
// faces-admin.test.js so the port is set before ../helpers.js reads the env.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3011"
