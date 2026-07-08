// Side-effect module (NOT a *.test.js file, so the runner ignores it): give the
// media integration file its own server port and tuned storage env. node --test
// runs test files concurrently, so each integration file needs a distinct port.
// Imported FIRST by media.test.js so these are set before ../helpers.js reads
// the env (helpers spawns the server with `{ ...process.env }`, so the child
// inherits these too).
process.env.TEST_SERVER_PORT = process.env.TEST_SERVER_PORT || "3004"
// Turn off the free-space guard for CI (a machine with < 5GB free would 507
// every upload) and set a tiny untrusted quota so the quota path is testable.
process.env.MEDIA_MIN_FREE_BYTES = process.env.MEDIA_MIN_FREE_BYTES || "0"
process.env.MEDIA_UNTRUSTED_QUOTA_BYTES =
  process.env.MEDIA_UNTRUSTED_QUOTA_BYTES || "1048576" // 1 MB
