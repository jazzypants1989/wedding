/** @file Copy the derived artifacts that do not regenerate.
 *
 *  Everything else under a run directory is recomputable in minutes — crops,
 *  descriptors, reports. `labels.json` is not: it records human judgement, made
 *  one face at a time, and SPEC §15's "all deletable at any time" is false for
 *  it. It also cannot be committed — it is names attached to faces and this
 *  repository is public — and label.html's own UI warns that localStorage is
 *  not a backup. Until this script existed there was no recovery path at all.
 *
 *  So: copy labels.json (and identities.json and timing.json, which record the
 *  run configuration the labels only make sense against) to a destination the
 *  OWNER chooses. The destination is an argument — rule 1 of SPEC §15 applies
 *  in both directions: nothing searches for photographs, and nothing decides on
 *  its own where a list of names ends up. Every copy is verified byte-for-byte
 *  after writing, because a backup that was never re-read is a hope.
 *
 *  `--selection` adds the culling page's selection file, which also records human
 *  judgement. It holds content hashes only, and its path is an argument because it
 *  doesn't live in a run directory.
 *
 *  Prints file names, byte counts and the datasetId. Never a label, never a
 *  name, never a count of anything about the people in the photographs.
 *
 *  No regex. Only node built-ins.
 */

import fs from "node:fs"
import path from "node:path"

const USAGE = `
Usage: node scripts/vision/labels-backup.js <run-dir> --to <destination> [--selection <file>]

  Copy <run-dir>/labels.json (plus identities.json and timing.json when
  present) into a timestamped directory under <destination>, then verify each
  copy byte-for-byte. <destination> is required and is never guessed.

  --to PATH     Where the backup directory is created. Required.
  --selection PATH  Also copy the culling selection file, as selection.json.
  --help
`

/** Exit codes, matching scripts/vision/session1.js. */
const EXIT = { CLEAN: 0, ABORTED: 2 }

/** The file that justifies the script, plus the two that give it context. */
const REQUIRED = "labels.json"
const OPTIONAL = ["identities.json", "timing.json"]

/**
 * @param {readonly string[]} argv
 * @returns {{ valid: true, dir: string, to: string, selection: string | null } | { valid: false, error: string }}
 */
export function parseArgs(argv) {
  /** @type {string[]} */
  const positional = []
  /** @type {string | null} */
  let to = null
  /** @type {string | null} */
  let selection = null

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (raw === "--help") return { valid: false, error: USAGE }
    if (raw === "--to" || raw.startsWith("--to=")) {
      const eq = raw.indexOf("=")
      let value = eq === -1 ? null : raw.slice(eq + 1)
      if (value === null) {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith("--")) return { valid: false, error: "--to needs a value" }
        value = next
        i++
      }
      if (value.length === 0) return { valid: false, error: "--to needs a value" }
      to = value
      continue
    }
    if (raw === "--selection" || raw.startsWith("--selection=")) {
      const eq = raw.indexOf("=")
      const value = eq === -1 ? argv[++i] : raw.slice(eq + 1)
      if (!value || value.startsWith("--")) return { valid: false, error: "--selection needs a value" }
      selection = path.resolve(value)
      continue
    }
    if (raw.startsWith("--")) return { valid: false, error: `Unknown option ${raw}` }
    positional.push(raw)
  }

  if (positional.length !== 1) {
    return { valid: false, error: "Expected exactly one run directory.\n" + USAGE }
  }
  if (to === null) {
    return {
      valid: false,
      error: "--to is required: the destination for a file of names is always the owner's explicit choice.\n" + USAGE,
    }
  }
  return { valid: true, dir: path.resolve(positional[0]), to: path.resolve(to), selection }
}

/**
 * A filesystem-safe timestamp: 2026-07-30T21-14-03Z form, seconds precision.
 * @param {Date} now @returns {string}
 */
export function stamp(now) {
  const iso = now.toISOString()
  const seconds = iso.slice(0, 19) + "Z"
  return seconds.replaceAll(":", "-")
}

/**
 * @param {string} dir run directory
 * @param {string} to destination root
 * @param {Date} now
 * @param {(line: string) => void} log
 * @param {string | null} [selection] the culling selection file, when one was named
 * @returns {number} exit code
 */
export function backup(dir, to, now, log, selection = null) {
  const source = path.join(dir, REQUIRED)
  if (!fs.existsSync(source)) {
    log(`No ${REQUIRED} under ${dir} — nothing to back up.`)
    return EXIT.ABORTED
  }
  if (selection !== null && !fs.existsSync(selection)) {
    log(`No selection file at ${selection}. Nothing was backed up.`)
    return EXIT.ABORTED
  }

  const dest = path.join(to, `labels-backup-${stamp(now)}`)
  fs.mkdirSync(dest, { recursive: true })

  /** @type {[name: string, from: string][]} */
  const files = [REQUIRED, ...OPTIONAL.filter((name) => fs.existsSync(path.join(dir, name)))].map(
    (name) => [name, path.join(dir, name)],
  )
  if (selection !== null) files.push(["selection.json", selection])
  for (const [name, from] of files) {
    const target = path.join(dest, name)
    fs.copyFileSync(from, target)
    // Re-read both sides. A backup verified only by its existence is a hope,
    // and this one is the single unregenerable artifact of the project.
    const a = fs.readFileSync(from)
    const b = fs.readFileSync(target)
    if (a.length !== b.length || !a.equals(b)) {
      log(`VERIFY FAILED: ${name} differs from its copy. The backup at ${dest} is not trustworthy.`)
      return EXIT.ABORTED
    }
    log(`  ${name}  ${a.length} bytes  verified`)
  }

  // Surface the datasetId so the owner can tell at a glance which run a backup
  // belongs to. It is a hash of geometry, not a fact about anybody.
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dest, REQUIRED), "utf8"))
    const id = typeof parsed.datasetId === "string" ? parsed.datasetId : "(none — pre-datasetId labelling)"
    log(`  datasetId: ${id}`)
  } catch {
    log(`  warning: the copied ${REQUIRED} did not parse as JSON — it was copied verbatim anyway.`)
  }

  log(`Backed up to ${dest}`)
  return EXIT.CLEAN
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
if (invokedDirectly) {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.valid) {
    console.error(parsed.error)
    process.exit(EXIT.ABORTED)
  }
  process.exit(backup(parsed.dir, parsed.to, new Date(), console.log, parsed.selection))
}
