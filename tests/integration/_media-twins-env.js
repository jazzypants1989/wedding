// Side-effect module (NOT a *.test.js file): imported SECOND by
// media-twins.test.js, after the port is set and before any db/*.js module.
// Points db/connection.js at the test server's database, so cards can be seeded
// through db/thank-you-cards.js, and self-provisions an admin credential so the
// suite runs rather than skipping when .env has none (as _thank-you-admin-env.js
// does). process.loadEnvFile never overrides a variable already set, so a real
// .env password is used when there is one.
import { TEST_DB_PATH } from "../helpers.js"
import { hashPassword } from "../../core/password-policy.js"

process.env.DATABASE_PATH = TEST_DB_PATH
if (!process.env.TEST_ADMIN_PASSWORD) {
  const password = "media-twins-suite-admin-pw"
  process.env.TEST_ADMIN_PASSWORD = password
  process.env.ADMIN_PASSWORD_HASH = hashPassword(password)
}
