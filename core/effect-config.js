/** @file Runtime-editable effect-config resolver.
 *
 *  `public/effects/config.js` holds the checked-in per-effect defaults. Admins
 *  can override them site-wide at runtime via the `effect_config` key in
 *  `app_state` (see api/admin/effect-config.js) — the "promote studio values to
 *  defaults" flow. Unlike site content, the *defaults* live only in the browser
 *  module, so this store carries no defaults ({}) and only ever exposes the raw
 *  sparse override: the server inlines it into the page and the client layers it
 *  over its own defaults + the active theme + localStorage (getEffectiveConfig).
 *
 *  Zero deps, no regex.
 */
/** @import * as Types from './types.js' */

import { createOverrideStore } from "./override-store.js"

const store = createOverrideStore("effect_config", /** @type {Record<string, unknown>} */ ({}))

/** @type {Types.resolveEffectConfig} */
export function resolveEffectConfig() {
  return store.resolve()
}

/** @type {Types.getEffectConfigOverride} */
export function getEffectConfigOverride() {
  return store.getOverride()
}
