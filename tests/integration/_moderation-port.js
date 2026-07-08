// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// Phase 6 moderation integration file its own server port + storage env. node
// --test runs test files concurrently — api 3001, accounts 3002, guestbook 3003,
// media 3004, social 3005 — so this one binds 3006. Imported FIRST by
// moderation.test.js so these are set before ../helpers.js reads the env.
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3006"
// Turn off the free-space guard so uploads in the media-reject test don't 507 on
// a CI machine with little free disk (mirrors _media-port.js).
process.env.MEDIA_MIN_FREE_BYTES = process.env.MEDIA_MIN_FREE_BYTES || "0"
