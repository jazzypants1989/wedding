/** @file Herbarium params, in the ControlHint shape (DESIGN-SLOTS.md). The same
 *  declarations feed the harness drawer here and would feed the studio, the
 *  admin and the guest remix drawer once built. */

/** @type {Record<string, import("../shared/harness.js").Param>} */
export const PARAMS = {
  palette: { value: "theme", hint: { options: ["theme", "pressed", "cyanotype"] } },
  sway: { value: 1.5, hint: { min: 0, max: 4, step: 0.25 }, css: "--hb-sway", unit: "deg" },
  growSeconds: { value: 2.4, hint: { min: 0.6, max: 6, step: 0.2 }, css: "--hb-grow", unit: "s" },
  leafScale: { value: 1.25, hint: { min: 0.6, max: 1.6, step: 0.05 } },
  bloomScale: { value: 1, hint: { min: 0.6, max: 1.8, step: 0.05 } },
  lean: { value: 1, hint: { min: 0, max: 2.5, step: 0.1 } },
}

/** @param {Record<string, unknown>} v */
export function applyPalette(v) {
  if (v.palette === "theme") delete document.documentElement.dataset.hbPalette
  else document.documentElement.dataset.hbPalette = String(v.palette)
}

/** @param {Record<string, unknown>} v */
export function growOpts(v) {
  return { leafScale: Number(v.leafScale), bloomScale: Number(v.bloomScale), lean: Number(v.lean) }
}
