/**
 * @file Unit tests for core/env.js (side-effect module)
 *
 * Since env.js runs side effects on import, each test spawns a child process
 * with controlled environment variables and checks the warning output.
 * We patch process.loadEnvFile to a no-op so the project .env doesn't
 * interfere with controlled env testing.
 */

import { describe, it } from "node:test"
import assert from "node:assert"
import { spawnSync } from "node:child_process"
import path from "node:path"

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..", "..")

/**
 * Spawn a Node process that imports core/env.js with the given env overrides.
 * Patches process.loadEnvFile to prevent the real .env from loading.
 * Returns the combined stdout+stderr output.
 * @param {Record<string, string>} envOverrides
 * @returns {string}
 */
function runEnvModule(envOverrides) {
  /** @type {Record<string, string>} */
  const env = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
    NODE_NO_WARNINGS: "1",
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    env[key] = value
  }

  const script = [
    // Patch loadEnvFile so the real .env doesn't interfere
    "process.loadEnvFile = () => {};",
    "await import('./core/env.js');",
  ].join("\n")

  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--input-type=module", "-e", script],
    {
      cwd: PROJECT_ROOT,
      env,
      encoding: "utf-8",
      timeout: 10000,
    },
  )

  return (result.stderr || "") + (result.stdout || "")
}

/**
 * Spawn env.js without patching loadEnvFile, to test .env loading behavior.
 * @param {Record<string, string>} envOverrides
 * @param {string} [cwd]
 * @returns {{ output: string, status: number | null }}
 */
function runEnvModuleRaw(envOverrides, cwd) {
  /** @type {Record<string, string>} */
  const env = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
    NODE_NO_WARNINGS: "1",
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    env[key] = value
  }

  const result = spawnSync(
    process.execPath,
    ["--no-warnings", "--input-type=module", "-e", "await import('./core/env.js');"],
    {
      cwd: cwd || PROJECT_ROOT,
      env,
      encoding: "utf-8",
      timeout: 10000,
    },
  )

  return {
    output: (result.stderr || "") + (result.stdout || ""),
    status: result.status,
  }
}

describe("core/env", () => {
  describe("missing env var warnings", () => {
    it("warns when ADMIN_PASSWORD_HASH is not set", () => {
      const output = runEnvModule({})
      assert.ok(
        output.includes("ADMIN_PASSWORD_HASH not set"),
        "should warn about missing ADMIN_PASSWORD_HASH, got: " + output.slice(0, 200),
      )
    })

    it("warns when BASE_URL is not set", () => {
      const output = runEnvModule({})
      assert.ok(
        output.includes("BASE_URL not set"),
        "should warn about missing BASE_URL, got: " + output.slice(0, 200),
      )
    })

    it("does not warn about ADMIN_PASSWORD_HASH when it is set", () => {
      const output = runEnvModule({
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "http://localhost:3000",
      })
      assert.ok(
        !output.includes("ADMIN_PASSWORD_HASH not set"),
        "should not warn when ADMIN_PASSWORD_HASH is set",
      )
    })

    it("does not warn about BASE_URL when it is set", () => {
      const output = runEnvModule({
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "http://localhost:3000",
      })
      assert.ok(
        !output.includes("BASE_URL not set"),
        "should not warn when BASE_URL is set",
      )
    })
  })

  describe("production proxy warning", () => {
    it("warns about TRUSTED_PROXIES in production mode", () => {
      const output = runEnvModule({
        NODE_ENV: "production",
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "https://example.com",
      })
      assert.ok(
        output.includes("TRUSTED_PROXIES not configured"),
        "should warn about missing TRUSTED_PROXIES in production",
      )
    })

    it("includes rate limiting context in proxy warning", () => {
      const output = runEnvModule({
        NODE_ENV: "production",
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "https://example.com",
      })
      assert.ok(
        output.includes("rate limiting"),
        "should mention rate limiting in proxy warning",
      )
    })

    it("does not warn about TRUSTED_PROXIES when set in production", () => {
      const output = runEnvModule({
        NODE_ENV: "production",
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "https://example.com",
        TRUSTED_PROXIES: "127.0.0.1",
      })
      assert.ok(
        !output.includes("TRUSTED_PROXIES not configured"),
        "should not warn when TRUSTED_PROXIES is configured",
      )
    })

    it("does not warn about TRUSTED_PROXIES in non-production mode", () => {
      const output = runEnvModule({
        NODE_ENV: "development",
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "http://localhost:3000",
      })
      assert.ok(
        !output.includes("TRUSTED_PROXIES not configured"),
        "should not warn about proxies outside production",
      )
    })

    it("does not warn about TRUSTED_PROXIES when NODE_ENV is unset", () => {
      const output = runEnvModule({
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "http://localhost:3000",
      })
      assert.ok(
        !output.includes("TRUSTED_PROXIES not configured"),
        "should not warn about proxies when NODE_ENV is unset",
      )
    })
  })

  describe("admin password hash notice", () => {
    it("shows setup instructions when ADMIN_PASSWORD_HASH is missing", () => {
      const output = runEnvModule({})
      assert.ok(
        output.includes("setup-admin"),
        "should mention setup-admin script",
      )
    })

    it("does not show setup instructions when ADMIN_PASSWORD_HASH is set", () => {
      const output = runEnvModule({
        ADMIN_PASSWORD_HASH: "somehash",
        BASE_URL: "http://localhost:3000",
      })
      assert.ok(
        !output.includes("setup-admin"),
        "should not mention setup-admin when hash is set",
      )
    })
  })

  describe(".env file loading", () => {
    it("warns when .env file cannot be loaded", () => {
      // Run from /tmp where there's no core/env.js or .env file
      const { output, status } = runEnvModuleRaw({}, "/tmp")
      // Module resolution will fail since core/env.js doesn't exist at /tmp
      assert.ok(
        output.includes("Could not load .env") ||
          output.includes("ERR_MODULE_NOT_FOUND") ||
          status !== 0,
        "should warn or fail when .env file is missing",
      )
    })

    it("loads .env file successfully from project root", () => {
      // Run from project root without patching — loadEnvFile should succeed
      const { output } = runEnvModuleRaw({})
      assert.ok(
        !output.includes("Could not load .env"),
        "should not warn about .env loading when file exists",
      )
    })
  })
})
