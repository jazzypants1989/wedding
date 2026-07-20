// Side-effect module (NOT a *.test.js file, so the runner ignores it):
// self-provision an admin credential for the thank-you integration suite so the
// admin API tests always run rather than silently skipping when no
// TEST_ADMIN_PASSWORD is configured.
//
// Imported by thank-you.test.js AFTER _thank-you-db-env.js — which transitively
// imports ../helpers.js and thus runs process.loadEnvFile(".env"). So by the
// time this executes, a real .env-provided TEST_ADMIN_PASSWORD (and its matching
// ADMIN_PASSWORD_HASH) is already in process.env and we leave it untouched.
// Only when nothing is configured do we mint a throwaway password + its scrypt
// hash; startServer() forwards the whole process.env to the spawned server, so
// the child validates logins against the same hash. The test DB is fresh (no
// app_state admin_hash), so core/auth.js#getAdminHash falls back to this env.
import { hashPassword } from "../../core/password-policy.js"

if (!process.env.TEST_ADMIN_PASSWORD) {
  const password = "thank-you-suite-admin-pw"
  process.env.TEST_ADMIN_PASSWORD = password
  process.env.ADMIN_PASSWORD_HASH = hashPassword(password)
}
