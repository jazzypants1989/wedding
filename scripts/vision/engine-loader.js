/** @file The one seam where third-party code enters this pipeline — and the
 *  reason it is a *runtime* `import()` of a path given on the command line
 *  rather than a normal import at the top of a file.
 *
 *  `tmp/rig/engine.mjs` wraps a borrowed ONNX inference runtime, installed from
 *  npm into a gitignored directory. CLAUDE.md's dependency rule puts a
 *  library that executes in our process at tier 1 — the tier we write ourselves
 *  — and permits it here only as scaffolding and as an oracle. What makes that
 *  claim checkable rather than aspirational is precisely this file: no module in
 *  the repository names it, so
 *
 *    - the dependency graph says the repo has zero runtime npm dependencies,
 *      because it does;
 *    - `npm test` passes with `tmp/` deleted;
 *    - replacing the borrowed runtime with hand-written kernels is implementing
 *      `VisionEngine` again and changing one path on one command line.
 *
 *  Bundlers and static analysers cannot follow a variable specifier, which is
 *  usually a complaint about dynamic import and is the point of it here.
 *
 *  The shape check is not defensive programming for its own sake. A batch over
 *  thousands of photographs that discovers in hour two that the module exports
 *  `embed` rather than `describe` has wasted the evening the session is
 *  budgeted at.
 */
/** @import * as Types from './types.js' */

import path from "node:path"
import { pathToFileURL } from "node:url"

/** Everything a `VisionEngine` must actually provide. */
const REQUIRED_METHODS = ["detect", "describe", "info"]

/**
 * @param {string} resolved
 * @param {string} problem
 * @returns {Error}
 */
function engineError(resolved, problem) {
  return new Error(
    `Couldn't load the vision engine at ${resolved}: ${problem}\n` +
      "The engine is borrowed scaffolding and is deliberately not part of this repo.\n" +
      "It has to exist at tmp/rig/engine.mjs (see docs/post-wedding/SESSION-1-vision.md §1),\n" +
      "or be pointed at with --engine=<path>.",
  )
}

/** @type {Types.loadEngine} */
export async function loadEngine(specifier, options) {
  // A bare "engine.mjs" would be resolved as a bare specifier (a package name)
  // by the ESM resolver, so every path goes through the filesystem explicitly.
  const resolved = path.resolve(specifier)

  /** @type {Record<string, unknown>} */
  let mod
  try {
    mod = /** @type {Record<string, unknown>} */ (await import(pathToFileURL(resolved).href))
  } catch (err) {
    throw engineError(resolved, err instanceof Error ? err.message : String(err))
  }

  // The factory is reachable several ways because module shapes vary: a named
  // export, a default export, or a default export carrying the named one.
  const fallback = /** @type {Record<string, unknown> | undefined} */ (
    typeof mod.default === "object" && mod.default !== null
      ? /** @type {Record<string, unknown>} */ (mod.default)
      : undefined
  )
  const candidate = mod.createEngine ?? fallback?.createEngine ?? mod.default
  if (typeof candidate !== "function") {
    throw engineError(resolved, "it exports no createEngine() factory (nor a callable default)")
  }
  const factory = /** @type {(o: Types.LoadEngineOptions | undefined) => unknown} */ (candidate)

  /** @type {unknown} */
  let created
  try {
    created = await factory(options)
  } catch (err) {
    throw engineError(resolved, `createEngine() threw — ${err instanceof Error ? err.message : String(err)}`)
  }

  if (typeof created !== "object" || created === null) {
    throw engineError(resolved, `createEngine() returned ${created === null ? "null" : typeof created}`)
  }

  const engine = /** @type {Record<string, unknown>} */ (created)
  const missing = REQUIRED_METHODS.filter((name) => typeof engine[name] !== "function")
  if (missing.length > 0) {
    throw engineError(
      resolved,
      `the engine is missing ${missing.join(", ")} — a VisionEngine needs ` +
        `${REQUIRED_METHODS.join(", ")} (see scripts/vision/types.d.ts)`,
    )
  }

  return /** @type {Types.VisionEngine} */ (/** @type {unknown} */ (engine))
}
