/** @file Loads the repository's .env for a CLI, before anything reads process.env.
 *
 *  Imported FIRST by scripts/import-media.js, for the same reason server.js
 *  imports core/env.js first: types.js computes MEDIA_STORAGE (and every other
 *  env-backed limit) once, at import time. Without this a local import checks
 *  storage against the defaults while the server enforces the owner's
 *  MEDIA_MAX_TOTAL_BYTES and MEDIA_MIN_FREE_BYTES.
 *
 *  Same file and same semantics as core/env.js: process.loadEnvFile never
 *  overrides a variable that is already set, so the shell still wins. What it
 *  leaves out is core/env.js's server warnings (ADMIN_PASSWORD_HASH, BASE_URL,
 *  TRUSTED_PROXIES), which mean nothing to an import. */
/** @import * as Types from './types.js' */

import path from "node:path"

/** @type {Types.loadDotEnv} */
export function loadDotEnv(envPath) {
  try {
    process.loadEnvFile(envPath)
    return true
  } catch (err) {
    // No .env is normal (CI, a fresh clone, a container with real env vars).
    // Anything else is worth a line: the run would use the default limits.
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") {
      process.stderr.write(
        `! Couldn't load ${envPath}: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
    return false
  }
}

loadDotEnv(path.join(import.meta.dirname, "..", "..", ".env"))
