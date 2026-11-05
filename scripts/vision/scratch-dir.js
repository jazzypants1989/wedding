/** @file Where the culling tools may write, and where a backup may not.
 *
 *  Everything derived from a photograph is scratch, and this repository is public.
 *  "Under a directory named tmp" was the first rule, and `public/tmp/cull` passed it:
 *  a directory the site serves. So the rule is about repositories, not names:
 *
 *  - Inside a repository (this one, or any directory holding a `.git`), scratch goes
 *    under that repository's own top-level `tmp/`, which .gitignore covers.
 *  - Outside every repository, under a directory named `tmp`, as before.
 *
 *  Both the path as given and the path with its symlinks resolved must pass, so a
 *  link from `tmp/` into `public/` is refused like the direct path would be.
 *
 *  cull-scores-macos.swift applies the same rule to its own `--out`.
 *
 *  No regex: path work is `path.relative`, `split` and `startsWith`.
 */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"

/** The repository these scripts belong to. */
export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..")

/** @type {Types.isWithin} */
export function isWithin(child, parent) {
  const relative = path.relative(parent, child)
  if (relative.length === 0) return true
  if (path.isAbsolute(relative)) return false
  return relative !== ".." && !relative.startsWith(".." + path.sep)
}

/**
 * The path with every symlink in its existing part resolved, and the part that does
 * not exist yet appended unchanged. An output directory usually does not exist yet,
 * and `realpathSync` alone would refuse it.
 * @type {Types.resolveExisting}
 */
export function resolveExisting(target) {
  const absolute = path.resolve(target)
  /** @type {string[]} */
  const missing = []
  let at = absolute
  for (;;) {
    try {
      return path.join(fs.realpathSync(at), ...missing.reverse())
    } catch {
      const parent = path.dirname(at)
      if (parent === at) return absolute
      missing.push(path.basename(at))
      at = parent
    }
  }
}

/**
 * The nearest directory at or above `target` holding a `.git` (a directory in a
 * checkout, a file in a worktree), or null. A stat on each ancestor: nothing is
 * listed, and nothing below `target` is looked at.
 * @type {Types.enclosingRepository}
 */
export function enclosingRepository(target) {
  let at = path.resolve(target)
  for (;;) {
    if (fs.existsSync(path.join(at, ".git"))) return at
    const parent = path.dirname(at)
    if (parent === at) return null
    at = parent
  }
}

/**
 * Why `dir` may not hold scratch derived from photographs, or null if it may.
 * @type {Types.scratchDirRefusal}
 */
export function scratchDirRefusal(dir, repoRoot = REPO_ROOT) {
  const lexical = path.resolve(dir)
  const real = resolveExisting(lexical)
  let inRepository = false
  for (const candidate of [lexical, real]) {
    const roots = [repoRoot, resolveExisting(repoRoot)]
    const nearest = enclosingRepository(candidate)
    if (nearest !== null) roots.push(nearest)
    for (const root of roots) {
      if (!isWithin(candidate, root)) continue
      inRepository = true
      if (!isWithin(candidate, path.join(root, "tmp"))) {
        return (
          `${lexical} is inside the repository at ${root} but not under its top-level tmp/` +
          (candidate === real && real !== lexical ? ` (it resolves to ${real})` : "") +
          ". Everything derived from a photograph is scratch, and only that tmp/ is " +
          "ignored by git and served by nothing."
        )
      }
    }
  }
  if (inRepository) return null
  const named = [lexical, real].some((candidate) => candidate.split(path.sep).includes("tmp"))
  if (named) return null
  return (
    `${lexical} is not under a tmp directory. Everything derived from a photograph is ` +
    "scratch: use the repository's tmp/, or a directory named tmp outside it."
  )
}

/**
 * Why `dir` may not receive a backup of human judgement, or null if it may. Labels are
 * names attached to faces, and a selection is the owner's choices; this repository is
 * public, so neither may land anywhere inside it, ignored directories included.
 * @type {Types.backupDestinationRefusal}
 */
export function backupDestinationRefusal(dir, repoRoot = REPO_ROOT) {
  const lexical = path.resolve(dir)
  for (const candidate of [lexical, resolveExisting(lexical)]) {
    if (isWithin(candidate, repoRoot) || isWithin(candidate, resolveExisting(repoRoot))) {
      return (
        `${lexical} is inside this repository, which is public. A backup goes somewhere ` +
        "durable outside it."
      )
    }
  }
  return null
}
