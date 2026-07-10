/** @file Runtime-editable site content resolver.
 *
 *  `content.js` holds the checked-in defaults. Admins can override any of it at
 *  runtime via the `site_content` key in `app_state` (see api/admin/site-content.js).
 *  This module resolves the *effective* content = defaults ⊕ stored override and
 *  caches it, re-resolved at boot and on each admin save. The generic resolve +
 *  merge/diff machinery lives in `override-store.js`; this module is the
 *  site-content-typed instance plus its `getMode` helper.
 *
 *  Kept separate from `content.js` (which stays dependency-free) so the DB import
 *  lives here, not in the pure defaults module. Zero deps, no regex.
 */
/** @import * as Types from '../types.js' */

import { CONTENT as CONTENT_DEFAULTS, getTimelineMode } from "../content.js"
import {
  createOverrideStore,
  deepMerge as mergeGeneric,
  diffFromDefaults as diffGeneric,
} from "./override-store.js"

const store = createOverrideStore("site_content", CONTENT_DEFAULTS)

/** @type {Types.deepMergeContent} */
export function deepMerge(base, override) {
  return mergeGeneric(base, /** @type {Record<string, unknown>} */ (override))
}

/** @type {Types.diffFromDefaults} */
export function diffFromDefaults(full, base = CONTENT_DEFAULTS) {
  return /** @type {Types.SiteContentOverride} */ (diffGeneric(full, base))
}

/** @type {Types.resolveSiteContent} */
export function resolveSiteContent() {
  return store.resolve()
}

/** @type {Types.getContent} */
export function getContent() {
  return store.get()
}

/** @type {Types.getMode} */
export function getMode(now = Date.now()) {
  return getTimelineMode(now, store.get().weddingDate)
}
