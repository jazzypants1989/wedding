/** @file Checks the trained weight files in a directory against a pinned table
 *  of SHA-256 digests, and fails loudly when they disagree.
 *
 *  This is the honest seed of tier 2's `fetch-weights.js` (the name `.gitignore`
 *  already reserves): the table below is the fetch list, minus the fetching. A
 *  weights file is the one artifact in this codebase nobody can audit by reading
 *  it, so the digest is the entire audit — see
 *  docs/post-wedding/VISION-MODELS.md for the ledger these numbers come from and
 *  docs/post-wedding/SPEC-vision-lab.md §3 for why nothing here is committed.
 *
 *  Three things it does that a bare `shasum -c` does not:
 *
 *  1. **The check is about bytes, not filenames.** If the canonical name is
 *     absent, every other `.onnx` in the directory whose byte count matches is
 *     hashed, and a content match reports `ok` naming the file that carried it.
 *     Hand-downloaded copies routinely arrive under a shortened name.
 *  2. **git-lfs pointer files are named as such.** `raw.githubusercontent.com`
 *     serves a ~130-byte text stub for these models instead of the model, and
 *     that stub does not announce itself — it is a plausible-looking `.onnx`
 *     that every loader rejects for a different, misleading reason. Its own
 *     `oid sha256:` line is the digest of the real file, so it also
 *     independently corroborates the table below.
 *  3. **Missing is distinguished from wrong**, and says how to fix each. Hash
 *     pinning protects integrity but not availability, so the missing message
 *     carries the manual-placement escape hatch SPEC §3 requires: drop a file
 *     with the expected name at the expected path and re-run, and the hash
 *     validates it regardless of where it came from.
 *
 *  Usage: node scripts/vision/verify-weights.js [dir]
 *  Exit 0 only when every pinned entry verifies.
 *
 *  No regex, per the project rule — the pointer parse is split/indexOf work. */
/** @import * as Types from './types.js' */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { hashFile } from "../lib/import-manifest.js"

/**
 * The LFS media host, pinned to a commit rather than a branch so the URL is
 * immutable. `<ref>` is opencv_zoo HEAD at the 2026-07-29 verification pass.
 */
const LFS_MEDIA_BASE =
  "https://media.githubusercontent.com/media/opencv/opencv_zoo/" +
  "47534e27c9851bb1128ccc0102f1145e27f23f98/models"

/** First line of a git-lfs pointer file. The whole detection rests on it. */
const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1"

/**
 * Pointers are 120–200 bytes in practice. The bound exists so that sniffing a
 * directory never reads a 38 MB model into memory looking for a text header.
 */
const LFS_POINTER_MAX_BYTES = 1024

/** Terminal width used for wrapping detail lines. Matches inspect-onnx.js. */
const RULE_WIDTH = 78

/**
 * Every digest here was read out of the actual file, not out of a model card.
 * Re-verify with the checklist at the end of VISION-MODELS.md.
 *
 * @type {readonly Types.PinnedWeight[]}
 */
export const PINNED_WEIGHTS = [
  {
    name: "face_detection_yunet_2026may.onnx",
    bytes: 229738,
    sha256: "ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0",
    licence: "MIT",
    role: "detector",
    url: `${LFS_MEDIA_BASE}/face_detection_yunet/face_detection_yunet_2026may.onnx`,
  },
  {
    name: "face_recognition_sface_2021dec.onnx",
    bytes: 38696353,
    sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    licence: "Apache-2.0",
    role: "embedder (fp32 — the one a stock runtime can actually run)",
    url: `${LFS_MEDIA_BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
  },
  {
    name: "face_recognition_sface_2021dec_int8bq.onnx",
    bytes: 10667852,
    sha256: "fb143eea07838aa532d1c95df5f69899974ea0140e1fba05e94204be13ed74ee",
    licence: "Apache-2.0",
    role: "embedder (block-quantised; weights read offline only)",
    url:
      `${LFS_MEDIA_BASE}/face_recognition_sface/` +
      "face_recognition_sface_2021dec_int8bq.onnx",
  },
  {
    name: "glintr100.onnx",
    bytes: 260694151,
    sha256: "a7933ea5330113b01c9b60351d8f4c33003f145d8470ac5f0e52ee2effe25c60",
    licence: "Apache-2.0",
    role: "embedder (AuraFace-v1, 512-d — the challenger; optional)",
    // Not the opencv_zoo LFS host: this one comes from its own publisher, and
    // the embedder file ALONE. The repo it lives in also bundles
    // InsightFace-derived detectors and attribute models its Apache grant does
    // not cover — see VISION-MODELS.md.
    //
    // `/main/` is a branch, so unlike the three above this URL is mutable. The
    // digest is the audit either way — a moved branch fails the hash rather
    // than passing quietly — but if this model is ever adopted, re-pin the URL
    // to a revision sha before Phase 9 depends on it.
    url: "https://huggingface.co/fal/AuraFace-v1/resolve/main/glintr100.onnx",
    optional: true,
  },
]

/**
 * What a git-lfs pointer file says about the object it stands in for.
 *
 * Local typedef: `PinnedWeight` and `WeightCheck` are the declared contract in
 * scripts/vision/types.d.ts, but the pointer shape is internal to this file.
 *
 * @typedef {object} LfsPointer
 * @property {string} oid Hex sha256 from the `oid sha256:` line; "" when absent.
 * @property {number} size Byte count from the `size` line; -1 when absent.
 */

/**
 * Parse the body of a git-lfs pointer file. Returns null for anything that is
 * not one, which is the sniff as well as the parse.
 *
 * The format is a sorted list of `key value` lines:
 *
 *     version https://git-lfs.github.com/spec/v1
 *     oid sha256:0ba9fbfa…
 *     size 38696353
 *
 * @param {string} text
 * @returns {LfsPointer | null}
 */
export function parseLfsPointer(text) {
  if (!text.startsWith(LFS_POINTER_PREFIX)) return null
  let oid = ""
  let size = -1
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (line.startsWith("oid ")) {
      const value = line.slice(4).trim()
      const colon = value.indexOf(":")
      // Only sha256 oids are meaningful here; any other algorithm leaves oid "".
      if (colon !== -1 && value.slice(0, colon) === "sha256") {
        oid = value.slice(colon + 1).trim().toLowerCase()
      }
    } else if (line.startsWith("size ")) {
      const parsed = Number(line.slice(5).trim())
      if (Number.isInteger(parsed) && parsed >= 0) size = parsed
    }
  }
  return { oid, size }
}

/**
 * Read a file as a pointer, if it is small enough to plausibly be one.
 *
 * @param {string} filePath
 * @returns {LfsPointer | null}
 */
export function readLfsPointer(filePath) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size > LFS_POINTER_MAX_BYTES) return null
  let text
  try {
    text = fs.readFileSync(filePath, "utf8")
  } catch {
    return null
  }
  return parseLfsPointer(text)
}

/**
 * Every `.onnx` in the directory with its byte count, so the fallback can
 * size-filter before hashing. A missing or unreadable directory is not an error
 * here — it produces `missing` for every entry, with the fetch URL attached.
 *
 * @param {string} dir
 * @returns {{ name: string, size: number }[]}
 */
function listOnnxFiles(dir) {
  /** @type {{ name: string, size: number }[]} */
  const found = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.toLowerCase().endsWith(".onnx")) continue
    try {
      found.push({ name: entry.name, size: fs.statSync(path.join(dir, entry.name)).size })
    } catch {
      // Raced away between readdir and stat. Treated as absent.
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name))
  return found
}

/**
 * @param {number} n
 * @returns {string}
 */
function bytes(n) {
  return n.toLocaleString()
}

/**
 * Ledger-style abbreviation: `ebafce4e…22f0f0`.
 *
 * @param {string} digest
 * @returns {string}
 */
function shortDigest(digest) {
  return `${digest.slice(0, 8)}…${digest.slice(-6)}`
}

/**
 * @param {Types.PinnedWeight} pinned
 * @param {string} foundName
 * @param {LfsPointer} pointer
 * @returns {Types.WeightCheck}
 */
function pointerCheck(pinned, foundName, pointer) {
  let verdict
  if (!pointer.oid) {
    verdict = "carries no readable oid sha256 line"
  } else if (pointer.oid === pinned.sha256) {
    verdict = "CORROBORATES the pinned digest, so the table is right and only the download is wrong"
  } else {
    verdict = `is ${pointer.oid}, which does NOT match the pinned ${pinned.sha256} — re-check the pinned ref as well`
  }
  const described = pointer.size >= 0 ? `a ${bytes(pointer.size)}-byte object` : "an object"
  return {
    name: pinned.name,
    status: "lfs-pointer",
    detail:
      `NOT A MODEL: ${foundName} is a git-lfs pointer file — a few lines of text describing ${described}. ` +
      `raw.githubusercontent.com serves these instead of the weights; the real bytes are at ${pinned.url} . ` +
      `The pointer's own oid sha256 ${verdict}.`,
  }
}

/**
 * @param {string} dir
 * @param {Types.PinnedWeight} pinned
 * @param {{ name: string, size: number }[]} candidates
 * @returns {Promise<Types.WeightCheck>}
 */
async function checkOne(dir, pinned, candidates) {
  const exact = candidates.find((candidate) => candidate.name === pinned.name)
  if (exact) {
    const filePath = path.join(dir, pinned.name)
    const pointer = readLfsPointer(filePath)
    if (pointer) return pointerCheck(pinned, pinned.name, pointer)
    const digest = await hashFile(filePath)
    if (digest === pinned.sha256) {
      return {
        name: pinned.name,
        status: "ok",
        detail: `${bytes(exact.size)} bytes · sha256 ${shortDigest(digest)}`,
      }
    }
    return {
      name: pinned.name,
      status: "mismatch",
      detail:
        `WRONG BYTES under the right name. expected ${pinned.sha256} (${bytes(pinned.bytes)} bytes), ` +
        `found ${digest} (${bytes(exact.size)} bytes). ` +
        `Delete it and re-fetch from ${pinned.url} .`,
    }
  }

  // Content first: the canonical name is absent, so ask whether any other file
  // here IS this model. Size-filter before hashing — there is no reason to read
  // 38 MB to learn that a 229 KB file is not the embedder.
  for (const candidate of candidates) {
    if (candidate.size !== pinned.bytes) continue
    const digest = await hashFile(path.join(dir, candidate.name))
    if (digest !== pinned.sha256) continue
    return {
      name: pinned.name,
      status: "ok",
      detail:
        `carried by ${candidate.name} — the bytes match, the filename does not. ` +
        `${bytes(candidate.size)} bytes · sha256 ${shortDigest(digest)}`,
    }
  }

  // Still nothing. A pointer file under any name is the likeliest reason, and
  // its oid says which model it was standing in for.
  for (const candidate of candidates) {
    if (candidate.size > LFS_POINTER_MAX_BYTES) continue
    const pointer = readLfsPointer(path.join(dir, candidate.name))
    if (pointer && pointer.oid === pinned.sha256) return pointerCheck(pinned, candidate.name, pointer)
  }

  if (pinned.optional) {
    return {
      name: pinned.name,
      status: "absent-optional",
      detail:
        `not in ${dir}, and not required — this one is pinned so that a machine which DOES ` +
        `carry it checks the right bytes, not so that every machine has to. ` +
        `Fetch ${pinned.url} (${bytes(pinned.bytes)} bytes) if you need it.`,
    }
  }

  return {
    name: pinned.name,
    status: "missing",
    detail:
      `not in ${dir} — no file there has these bytes under any name. ` +
      `Fetch ${pinned.url} (${bytes(pinned.bytes)} bytes). ` +
      `Manual placement also works: drop a file named ${pinned.name} in that directory and re-run — ` +
      `the hash check validates it regardless of where it came from.`,
  }
}

/**
 * The table is a parameter so the classification can be tested against
 * fixture-sized entries instead of against 49 MB of real weights, and so tier
 * 2's fetch-weights.js can verify a subset without a second implementation.
 *
 * @param {string} dir
 * @param {readonly Types.PinnedWeight[]} table
 * @returns {Promise<Types.WeightCheck[]>}
 */
export async function verifyAgainst(dir, table) {
  const candidates = listOnnxFiles(dir)
  /** @type {Types.WeightCheck[]} */
  const checks = []
  for (const pinned of table) {
    checks.push(await checkOne(dir, pinned, candidates))
  }
  return checks
}

/** @type {Types.verifyWeights} */
export async function verifyWeights(dir) {
  return verifyAgainst(dir, PINNED_WEIGHTS)
}

// --- CLI ---------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "..", "..")

/**
 * Preference order: the fetched home per SPEC §3, then the hand-downloaded
 * scratch copies session 1 worked from.
 */
const DEFAULT_DIRS = ["public/vision/weights", "tmp/weights"]

/**
 * @param {string[]} argv
 * @returns {{ dir: string, why: string }}
 */
function resolveDir(argv) {
  const given = argv.find((arg) => !arg.startsWith("-"))
  if (given) return { dir: path.resolve(given), why: "given on the command line" }
  for (const relative of DEFAULT_DIRS) {
    const absolute = path.join(REPO_ROOT, relative)
    if (fs.existsSync(absolute)) {
      return { dir: absolute, why: `default — first of ${DEFAULT_DIRS.join(", ")} that exists` }
    }
  }
  return {
    dir: path.join(REPO_ROOT, DEFAULT_DIRS[0]),
    why: `default — neither ${DEFAULT_DIRS.join(" nor ")} exists`,
  }
}

/**
 * Greedy wrap on spaces, so a long detail stays inside the rule. No regex.
 *
 * @param {string} text
 * @param {number} width
 * @param {string} indent
 * @returns {string[]}
 */
function wrap(text, width, indent) {
  /** @type {string[]} */
  const lines = []
  let line = ""
  for (const word of text.split(" ")) {
    if (!line) line = word
    else if (indent.length + line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      lines.push(indent + line)
      line = word
    }
  }
  if (line) lines.push(indent + line)
  return lines
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const { dir, why } = resolveDir(process.argv.slice(2))
  const checks = await verifyWeights(dir)

  /** @type {Map<string, Types.PinnedWeight>} */
  const byName = new Map(PINNED_WEIGHTS.map((pinned) => [pinned.name, pinned]))
  const nameWidth = Math.max(...PINNED_WEIGHTS.map((pinned) => pinned.name.length))
  const licenceWidth = Math.max(...PINNED_WEIGHTS.map((pinned) => pinned.licence.length))

  console.log(`\n${"=".repeat(RULE_WIDTH)}`)
  console.log(`weights   ${dir}`)
  console.log(`source    ${why}`)
  console.log(`pinned    ${PINNED_WEIGHTS.length} files — ledger: docs/post-wedding/VISION-MODELS.md`)
  console.log("")

  // An optional file that is simply not here is neither a pass nor a failure —
  // nothing was verified and nothing was found wrong, and marking it either way
  // would misreport one of the two.
  const passed = (/** @type {Types.WeightCheck} */ check) => check.status === "ok"
  const failed = (/** @type {Types.WeightCheck} */ check) =>
    check.status !== "ok" && check.status !== "absent-optional"

  for (const check of checks) {
    const pinned = byName.get(check.name)
    const mark = check.status === "ok" ? "✓" : check.status === "absent-optional" ? "–" : "✗"
    const licence = pinned ? pinned.licence : ""
    const role = pinned ? pinned.role : ""
    console.log(
      `  ${mark} ${check.status.padEnd(11)} ${check.name.padEnd(nameWidth)}  ` +
        `${licence.padEnd(licenceWidth)}  ${role}`,
    )
    for (const line of wrap(check.detail, RULE_WIDTH, "      ")) console.log(line)
  }

  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const check of checks) counts.set(check.status, (counts.get(check.status) ?? 0) + 1)
  const ok = checks.filter(passed).length
  const bad = checks.filter(failed).length
  const required = checks.length - (counts.get("absent-optional") ?? 0)

  console.log("")
  if (bad === 0) {
    const aside = required === checks.length ? "" : ` (${checks.length - required} optional, not present)`
    console.log(`${ok}/${required} verified against the pinned digests${aside}.`)
  } else {
    const failures = [...counts.entries()]
      .filter(([status]) => status !== "ok" && status !== "absent-optional")
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([status, n]) => `${n} ${status}`)
      .join(", ")
    console.log(`${ok}/${required} verified — ${failures}. See the detail lines above.`)
  }
  process.exit(bad === 0 ? 0 : 1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
