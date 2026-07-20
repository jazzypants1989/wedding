/** @file studio.js — dev-only Sound lab decision endpoint.
 *
 *  GET/POST /api/studio/sound-decision persists Jordana's verdict for whether
 *  (and what) sound plays on each of the four thank-you-card reveal beats. It is
 *  the server side of the "Decision" section in public/pages/studio/sound-lab.js.
 *
 *  Gated EXACTLY like the /studio page: core/static.js 404s DEV_ONLY_PAGES
 *  (["studio"]) when NODE_ENV === "production", so this companion endpoint mirrors
 *  that — 404 in production, live in dev. The valid option ids are hardcoded here
 *  (they duplicate the CUES/SAMPLES manifests in sound-lab.js) so the whitelist
 *  never trusts the client. Zero deps, no regex (string split on ":" + Set
 *  lookups). The chosen decision is written atomically (temp file + rename) to
 *  docs/post-wedding/sound-decision.json; see docs/post-wedding/SOUND-DECISION.md
 *  for the schema + how a future agent implements from it.
 */
/** @import * as Types from "./types.js" */

import fs from "node:fs"
import path from "node:path"
import { sendJson, parseBody } from "../core/http.js"
import { NotFoundError, ValidationError } from "../core/validation.js"

/** Where the decision is persisted (committed doc dir, beside SOUND-DECISION.md). */
const DECISION_PATH = path.join(
  import.meta.dirname,
  "..",
  "docs",
  "post-wedding",
  "sound-decision.json",
)

/** The four reveal beats — these ids double as the synth cue ids in sound-lab.js. */
const BEATS = ["envelope-tap", "envelope-open", "word-cascade", "celebration"]
const BEAT_SET = new Set(BEATS)

/** Sample file id → the beat it voices (mirrors the SAMPLES manifest). */
/** @type {Record<string, string>} */
const SAMPLE_BEAT = {
  "tap-wood": "envelope-tap",
  "open-paper": "envelope-open",
  "cascade-chimes": "word-cascade",
  "cascade-bells": "word-cascade",
  "celebrate-cork": "celebration",
  "celebrate-fizz": "celebration",
}

/** Allowed slider keys per synth cue (mirrors each cue's params in sound-lab.js). */
/** @type {Record<string, Set<string>>} */
const SYNTH_PARAM_KEYS = {
  "envelope-tap": new Set(["level", "tone", "body"]),
  "envelope-open": new Set(["level", "density", "brightness"]),
  "word-cascade": new Set(["root", "decay", "warmth"]),
  celebration: new Set(["level", "pop", "fizz"]),
}

const NOTES_MAX = 2000
const DECIDED_BY_MAX = 120

/** @param {string} error @returns {{ valid: false; error: string }} */
function fail(error) {
  return { valid: false, error }
}

/**
 * Validate one beat's choice string against the hardcoded whitelist. Valid forms:
 * "none", "synth:<beat>" (the beat's own synth cue), or "sample:<file-id>" where
 * the sample's manifest beat matches this beat. No regex — a single-colon split.
 * @param {string} beat @param {unknown} choice
 * @returns {{ valid: true; value: string } | { valid: false; error: string }}
 */
function validateChoice(beat, choice) {
  if (typeof choice !== "string") return fail("choice for " + beat + " must be a string")
  if (choice === "none") return { valid: true, value: "none" }

  const idx = choice.indexOf(":")
  if (idx === -1) return fail("invalid choice for " + beat + ": " + choice)
  if (choice.indexOf(":", idx + 1) !== -1) return fail("invalid choice for " + beat + ": " + choice)

  const kind = choice.slice(0, idx)
  const id = choice.slice(idx + 1)
  if (!id) return fail("invalid choice for " + beat + ": " + choice)

  if (kind === "synth") {
    if (id !== beat) return fail("unknown synth cue for " + beat + ": " + id)
    return { valid: true, value: choice }
  }
  if (kind === "sample") {
    if (SAMPLE_BEAT[id] !== beat) return fail("unknown sample for " + beat + ": " + id)
    return { valid: true, value: choice }
  }
  return fail("unknown choice kind for " + beat + ": " + kind)
}

/**
 * Strict whitelist validation of a decision POST body. Returns the cleaned,
 * storable input on success. Rejects any unknown beat, choice, param, or shape.
 * @type {Types.validateSoundDecision}
 */
export function validateSoundDecision(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("body must be an object")
  }
  const b = /** @type {Record<string, unknown>} */ (body)

  // --- choices: exactly the four known beats, each a whitelisted choice -------
  const choices = b.choices
  if (!choices || typeof choices !== "object" || Array.isArray(choices)) {
    return fail("choices must be an object")
  }
  const choicesObj = /** @type {Record<string, unknown>} */ (choices)
  if (Object.keys(choicesObj).length !== BEATS.length) {
    return fail("choices must cover exactly the four beats")
  }
  /** @type {Record<string, string>} */
  const cleanChoices = {}
  for (const beat of BEATS) {
    if (!(beat in choicesObj)) return fail("missing choice for beat: " + beat)
    const result = validateChoice(beat, choicesObj[beat])
    if (!result.valid) return result
    cleanChoices[beat] = result.value
  }

  // --- masterLevel: a number in [0, 1] ----------------------------------------
  const masterLevel = b.masterLevel
  if (typeof masterLevel !== "number" || !Number.isFinite(masterLevel) || masterLevel < 0 || masterLevel > 1) {
    return fail("masterLevel must be a number between 0 and 1")
  }

  // --- notes / decidedBy: optional, length-capped strings ---------------------
  let notes = ""
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== "string") return fail("notes must be a string")
    if (b.notes.length > NOTES_MAX) return fail("notes must be at most " + NOTES_MAX + " characters")
    notes = b.notes
  }
  let decidedBy = ""
  if (b.decidedBy !== undefined && b.decidedBy !== null) {
    if (typeof b.decidedBy !== "string") return fail("decidedBy must be a string")
    if (b.decidedBy.length > DECIDED_BY_MAX) return fail("decidedBy must be at most " + DECIDED_BY_MAX + " characters")
    decidedBy = b.decidedBy.trim()
  }

  // --- synthParams: per-beat snapshot of slider values (whitelisted keys) ------
  const synthParams = b.synthParams
  if (!synthParams || typeof synthParams !== "object" || Array.isArray(synthParams)) {
    return fail("synthParams must be an object")
  }
  const synthParamsObj = /** @type {Record<string, unknown>} */ (synthParams)
  /** @type {Record<string, Record<string, number>>} */
  const cleanParams = {}
  for (const beat of Object.keys(synthParamsObj)) {
    if (!BEAT_SET.has(beat)) return fail("unknown synthParams beat: " + beat)
    const params = synthParamsObj[beat]
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      return fail("synthParams." + beat + " must be an object")
    }
    const paramsObj = /** @type {Record<string, unknown>} */ (params)
    const allowed = SYNTH_PARAM_KEYS[beat]
    /** @type {Record<string, number>} */
    const clean = {}
    for (const key of Object.keys(paramsObj)) {
      if (!allowed.has(key)) return fail("unknown param " + key + " for beat " + beat)
      const value = paramsObj[key]
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail("synthParams." + beat + "." + key + " must be a finite number")
      }
      clean[key] = value
    }
    cleanParams[beat] = clean
  }

  return {
    valid: true,
    value: { choices: cleanChoices, masterLevel, notes, decidedBy, synthParams: cleanParams },
  }
}

/**
 * Mirror core/static.js DEV_ONLY_PAGES gating: the /studio page (and thus this
 * companion endpoint) is 404'd when NODE_ENV === "production". Throws a
 * NotFoundError (→ 404) so production never exposes the decision store.
 */
function assertDevOnly() {
  if (process.env.NODE_ENV === "production") throw new NotFoundError("Resource")
}

/**
 * GET /api/studio/sound-decision — return the stored decision, or { exists:false }
 * when nothing has been saved yet.
 * @type {Types.soundDecisionGet}
 */
export async function get(req, res) {
  assertDevOnly()
  try {
    const raw = await fs.promises.readFile(DECISION_PATH, "utf-8")
    sendJson(res, 200, JSON.parse(raw))
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      sendJson(res, 200, { exists: false })
      return
    }
    throw err
  }
}

/**
 * POST /api/studio/sound-decision — validate + atomically persist the decision to
 * docs/post-wedding/sound-decision.json (temp file + rename).
 * @type {Types.soundDecisionSave}
 */
export async function save(req, res) {
  assertDevOnly()
  const body = await parseBody(req)
  const result = validateSoundDecision(body)
  if (!result.valid) throw new ValidationError(result.error)

  const record = {
    version: 1,
    savedAt: new Date().toISOString(),
    decidedBy: result.value.decidedBy,
    notes: result.value.notes,
    masterLevel: result.value.masterLevel,
    choices: result.value.choices,
    synthParams: result.value.synthParams,
  }

  const json = JSON.stringify(record, null, 2) + "\n"
  await fs.promises.mkdir(path.dirname(DECISION_PATH), { recursive: true })
  const tmp = DECISION_PATH + ".tmp-" + process.pid + "-" + Date.now()
  await fs.promises.writeFile(tmp, json, "utf-8")
  await fs.promises.rename(tmp, DECISION_PATH)

  sendJson(res, 200, { success: true, savedAt: record.savedAt })
}
