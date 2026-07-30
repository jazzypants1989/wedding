#!/usr/bin/env node
// PreToolUse guard: photographs are input to code, not to a reader.
//
// Enforces the rule in CLAUDE.md ("Photographs Are Input To Code, Not To A
// Reader") mechanically, because a rule that lives only in a document is a rule
// that holds only until something skims past it. Two things are blocked:
//
//   1. Opening a photograph or video with a file-reading tool. Reading an image
//      loads it into an assistant's context, which is the thing that must not
//      happen. Blocked outside this repo entirely, and inside tmp/ as well —
//      copying a photo into scratch and reading it there is the same act with an
//      extra step.
//   2. Shell commands that reach for a photo library: ~/Pictures, a macOS
//      .photoslibrary bundle, or a Spotlight query for images. The pipeline is
//      always handed an explicit path; it never goes looking.
//
// PNG is deliberately not treated as a photograph, so screenshots, diagrams and
// generated charts still work. Nothing here restricts *code* from processing
// pixels — the batch pipeline reads whatever path it is given. It restricts a
// reader from looking at them.
//
// Contract: hook JSON on stdin. Exit 0 allows, exit 2 blocks and feeds stderr
// back as the reason. Anything unexpected exits 0 — a guard that wedges the
// session on a malformed payload would just get deleted.
//
// Wired up in .claude/settings.json. No regex, no dependencies, per CLAUDE.md.

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve, sep } from "node:path"

/** Extensions treated as photographic or video source material. */
const PHOTO_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".jpe",
  ".heic",
  ".heif",
  ".avif",
  ".tif",
  ".tiff",
  ".dng",
  ".cr2",
  ".cr3",
  ".nef",
  ".arw",
  ".raf",
  ".orf",
  ".rw2",
  ".mov",
  ".mp4",
  ".m4v",
  ".avi",
  ".mts",
  ".3gp",
]

/** Tools whose input names a file to be read into context. */
const FILE_TOOLS = ["Read", "Edit", "Write", "NotebookEdit", "NotebookRead"]

/** Shell fragments that always mean "going looking for a photo library". */
const OFF_LIMITS_FRAGMENTS = [
  ".photoslibrary",
  "photos library",
  "photo booth library",
  "/pictures",
  "public.image",
  "public.movie",
]

/**
 * Locations that are fine to touch in general, but not to go trawling through
 * for images. Blocked only when the command also names a photo extension, so
 * `mv ~/Downloads/thing.zip .` still works and
 * `find ~/Downloads -iname '*.jpg'` does not.
 */
const OFF_LIMITS_WHEN_TRAWLING = [
  "/downloads",
  "/desktop",
  "/documents",
  "/icloud",
  "/photos",
  "/volumes",
]

const REPO_ROOT = resolve(import.meta.dirname, "..", "..")

/**
 * @param {string} value
 * @param {string[]} needles
 * @returns {boolean}
 */
function containsAny(value, needles) {
  for (const needle of needles) {
    if (value.includes(needle)) return true
  }
  return false
}

/**
 * @param {string} value
 * @param {string[]} suffixes
 * @returns {boolean}
 */
function endsWithAny(value, suffixes) {
  for (const suffix of suffixes) {
    if (value.endsWith(suffix)) return true
  }
  return false
}

/**
 * Resolve to an absolute path, expanding a leading `~` the way a shell would.
 * Without this, `~/x.jpg` resolves under the repo and reads as in-tree.
 *
 * @param {string} rawPath
 * @returns {string}
 */
function toAbsolute(rawPath) {
  if (rawPath === "~") return homedir()
  if (rawPath.startsWith("~/")) return resolve(homedir(), rawPath.slice(2))
  return resolve(rawPath)
}

/**
 * @param {string} absolutePath
 * @returns {boolean}
 */
function isInsideRepo(absolutePath) {
  return absolutePath === REPO_ROOT || absolutePath.startsWith(REPO_ROOT + sep)
}

/**
 * @param {string} absolutePath
 * @returns {boolean}
 */
function isInsideScratch(absolutePath) {
  return absolutePath.startsWith(resolve(REPO_ROOT, "tmp") + sep)
}

/**
 * Returns the reason to block, or null to allow.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} toolInput
 * @returns {string | null}
 */
function reasonToBlock(toolName, toolInput) {
  if (FILE_TOOLS.includes(toolName)) {
    const raw = toolInput.file_path ?? toolInput.notebook_path
    if (typeof raw !== "string" || raw.length === 0) return null

    const absolute = toAbsolute(raw)
    if (!endsWithAny(absolute.toLowerCase(), PHOTO_EXTENSIONS)) return null

    if (!isInsideRepo(absolute)) {
      return (
        `Blocked: ${toolName} on a photograph or video outside this repository.\n` +
        "Photographs are input to code, not to a reader — opening one loads it " +
        "into context, which this project does not do. See CLAUDE.md " +
        '("Photographs Are Input To Code, Not To A Reader") and ' +
        "docs/post-wedding/SPEC-vision-lab.md §15.\n" +
        "Pass the path to a pipeline that processes pixels instead, or ask the " +
        "owner if you genuinely need a human to look at something."
      )
    }

    if (isInsideScratch(absolute)) {
      return (
        `Blocked: ${toolName} on a photograph or video under tmp/.\n` +
        "Scratch is where derived data lives; reading a photograph out of it is " +
        "the same act as reading it from source, with an extra copy step. " +
        "See CLAUDE.md and docs/post-wedding/SPEC-vision-lab.md §15."
      )
    }

    return null
  }

  if (toolName === "Bash") {
    const command = toolInput.command
    if (typeof command !== "string") return null
    const lower = command.toLowerCase()

    const namesPhotoFile = containsAny(lower, PHOTO_EXTENSIONS)
    const trawling =
      namesPhotoFile && containsAny(lower, OFF_LIMITS_WHEN_TRAWLING)

    if (containsAny(lower, OFF_LIMITS_FRAGMENTS) || trawling) {
      return (
        "Blocked: this command goes looking for photographs.\n" +
        "Nothing in this project searches for images — a photo library, " +
        "~/Pictures, and image sweeps of ~/Downloads or ~/Desktop are all off " +
        "limits. The directory to process is always supplied explicitly as an " +
        "argument by the owner, on this invocation, and only what it contains " +
        'gets read. See CLAUDE.md ("Photographs Are Input To Code, Not To A ' +
        'Reader") and docs/post-wedding/SPEC-vision-lab.md §15.'
      )
    }
  }

  return null
}

function main() {
  /** @type {unknown} */
  let payload
  try {
    payload = JSON.parse(readFileSync(0, "utf8"))
  } catch {
    return 0
  }

  if (typeof payload !== "object" || payload === null) return 0

  const record = /** @type {Record<string, unknown>} */ (payload)
  const toolName = typeof record.tool_name === "string" ? record.tool_name : ""
  const toolInput =
    typeof record.tool_input === "object" && record.tool_input !== null
      ? /** @type {Record<string, unknown>} */ (record.tool_input)
      : {}

  const reason = reasonToBlock(toolName, toolInput)
  if (reason === null) return 0

  process.stderr.write(reason + "\n")
  return 2
}

process.exit(main())
