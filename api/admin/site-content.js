/** @file Admin site-content editor — runtime override of content.js defaults.
 *
 *  Stores a validated SiteContent blob under the `site_content` app_state key and
 *  re-resolves the effective content (onContentChanged) so every templated page
 *  and /api/config reflect the edit without a redeploy. Reset clears the key and
 *  falls back to content.js defaults. Zero deps, no regex.
 */
/** @import * as Types from './types.js' */
/** @import * as Root from '../../types.js' */

import { parseBody, sendJson } from "../../core/http.js"
import { ValidationError, validateEmail, validateRequiredString } from "../../core/validation.js"
import { log, AUDIT_ACTIONS } from "../../core/utils.js"
import { getClientIp } from "../../core/rate-limit.js"
import { setAppState } from "../../db/utils.js"
import { sql } from "../../db/sql.js"
import { getContent, diffFromDefaults } from "../../core/site-content.js"
import { onContentChanged } from "../../core/static.js"

const SITE_CONTENT_KEY = "site_content"

// Per-field length caps (server-enforced; the admin form mirrors these as
// maxlength). welcomeIntro is generous because it may carry trusted inline HTML.
const CAP = {
  display: 100,
  first: 100,
  monogram: 20,
  name: 100,
  weddingDate: 40,
  location: 200,
  theme: 40,
  url: 500,
  label: 200,
  heading: 200,
  intro: 5000,
  href: 200,
  navLabel: 100,
}
const MAX_NAMES = 10
const MAX_NAV = 20

// Allowed effect theme ids. Duplicated from public/effects/themes.js
// EFFECT_THEMES because the server can't import that browser-only module; keep
// in sync when adding a theme.
const THEME_IDS = new Set(["mermaid-disco", "romantic", "elegant", "classic"])

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * A nested object field, defaulting to `{}` when absent so partial bodies don't throw.
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function obj(value, field) {
  if (value === undefined) return {}
  if (!isPlainObject(value)) throw new ValidationError(field + " must be an object")
  return value
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function reqStr(value, field, max) {
  const result = validateRequiredString(value, field, max)
  if (!result.valid) throw new ValidationError(result.error)
  return result.value
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @returns {string}
 */
function reqUrl(value, field, max) {
  const s = reqStr(value, field, max)
  if (!s.startsWith("http://") && !s.startsWith("https://")) {
    throw new ValidationError(field + " must start with http:// or https://")
  }
  return s
}

/**
 * Optional URL that may be cleared to `null` (empty/absent → null).
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @returns {string | null}
 */
function optUrl(value, field, max) {
  if (value === null || value === undefined || value === "") return null
  return reqUrl(value, field, max)
}

/**
 * Optional email that may be cleared to `null` (empty/absent → null).
 * @param {unknown} value
 * @returns {string | null}
 */
function optEmail(value) {
  if (value === null || value === undefined || value === "") return null
  const result = validateEmail(value)
  if (!result.valid) throw new ValidationError(result.error)
  return result.value
}

/**
 * @param {unknown} value
 * @returns {string} a parseable ISO date string
 */
function reqDate(value) {
  const s = reqStr(value, "Wedding date", CAP.weddingDate)
  if (Number.isNaN(Date.parse(s))) {
    throw new ValidationError("Wedding date must be a valid date")
  }
  return s
}

/**
 * Effect theme id — absent/empty falls back to the default; a present value must
 * be a known theme id.
 * @param {unknown} value
 * @returns {string}
 */
function reqTheme(value) {
  if (value === undefined || value === null || value === "") return "mermaid-disco"
  const s = reqStr(value, "Theme", CAP.theme)
  if (!THEME_IDS.has(s)) {
    throw new ValidationError("Theme must be one of: " + Array.from(THEME_IDS).join(", "))
  }
  return s
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function reqNames(value) {
  if (!Array.isArray(value)) throw new ValidationError("Full names must be a list")
  if (value.length > MAX_NAMES) throw new ValidationError("Too many full names")
  return value.map((n, i) => reqStr(n, "Full name " + (i + 1), CAP.name))
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Root.SiteContentNavLink[]}
 */
function reqNav(value, field) {
  if (!Array.isArray(value)) throw new ValidationError(field + " must be a list")
  if (value.length > MAX_NAV) throw new ValidationError(field + " has too many links")
  return value.map((item, i) => {
    const link = obj(item, field + "[" + i + "]")
    const href = reqStr(link.href, field + " link " + (i + 1) + " href", CAP.href)
    // Restrict to safe navigable targets — page-anchor, site-relative, or http(s).
    // Blocks javascript:/data: and other schemes even though hrefs are escaped.
    const safe = href.startsWith("#") || href.startsWith("/") || href.startsWith("http://") || href.startsWith("https://")
    if (!safe) {
      throw new ValidationError(field + " link " + (i + 1) + " href must be an anchor (#), path (/), or http(s) URL")
    }
    return {
      href,
      label: reqStr(link.label, field + " link " + (i + 1) + " label", CAP.navLabel),
    }
  })
}

/**
 * Validate a full submitted body into a clean, complete SiteContent object.
 * The caller diffs it against defaults before storing (only changed fields are
 * persisted), so every field is required and validated here.
 * @param {Record<string, unknown>} body
 * @returns {Root.SiteContent}
 */
function buildOverride(body) {
  const couple = obj(body.couple, "couple")
  const registry = obj(body.registry, "registry")
  const nav = obj(body.nav, "nav")
  const footer = obj(body.footer, "footer")
  const copy = obj(body.copy, "copy")
  const copyPre = obj(copy.pre, "copy.pre")
  const copyPost = obj(copy.post, "copy.post")

  return {
    couple: {
      display: reqStr(couple.display, "Couple display name", CAP.display),
      first: reqStr(couple.first, "Couple first names", CAP.first),
      monogram: reqStr(couple.monogram, "Monogram", CAP.monogram),
      fullNames: reqNames(couple.fullNames),
    },
    weddingDate: reqDate(body.weddingDate),
    location: reqStr(body.location, "Location", CAP.location),
    theme: reqTheme(body.theme),
    registry: {
      url: reqUrl(registry.url, "Registry URL", CAP.url),
      label: reqStr(registry.label, "Registry label", CAP.label),
    },
    contactEmail: optEmail(body.contactEmail),
    nav: {
      pre: reqNav(nav.pre, "Pre-wedding nav"),
      post: reqNav(nav.post, "Post-wedding nav"),
    },
    footer: { githubUrl: optUrl(footer.githubUrl, "Footer GitHub URL", CAP.url) },
    copy: {
      pre: {
        welcomeHeading: reqStr(copyPre.welcomeHeading, "Pre welcome heading", CAP.heading),
        welcomeIntro: reqStr(copyPre.welcomeIntro, "Pre welcome intro", CAP.intro),
      },
      post: {
        welcomeHeading: reqStr(copyPost.welcomeHeading, "Post welcome heading", CAP.heading),
        welcomeIntro: reqStr(copyPost.welcomeIntro, "Post welcome intro", CAP.intro),
      },
    },
  }
}

/** @type {Types.AsyncHandler} */
export async function get(req, res) {
  return sendJson(res, 200, { content: getContent() })
}

/** @type {Types.AuthedHandler} */
export async function update(req, res, { session }) {
  const body = await parseBody(req)
  const validated = buildOverride(body)

  // Store only the diff from shipped defaults so unchanged fields keep tracking
  // future content.js edits. An all-defaults submission clears the override.
  const sparse = diffFromDefaults(validated)
  if (Object.keys(sparse).length === 0) {
    sql`DELETE FROM app_state WHERE key = ${SITE_CONTENT_KEY}`.run()
  } else {
    setAppState(SITE_CONTENT_KEY, JSON.stringify(sparse))
  }
  onContentChanged()

  log({
    action: AUDIT_ACTIONS.SITE_CONTENT_UPDATE,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "site_content",
  })

  return sendJson(res, 200, {
    success: true,
    message: "Site content updated",
    content: getContent(),
  })
}

/** @type {Types.AuthedHandler} */
export async function reset(req, res, { session }) {
  sql`DELETE FROM app_state WHERE key = ${SITE_CONTENT_KEY}`.run()
  onContentChanged()

  log({
    action: AUDIT_ACTIONS.SITE_CONTENT_RESET,
    adminId: session?.token,
    ip: getClientIp(req),
    resourceType: "site_content",
  })

  return sendJson(res, 200, {
    success: true,
    message: "Site content reset to defaults",
    content: getContent(),
  })
}
