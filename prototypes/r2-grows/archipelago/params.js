/** @file Archipelago params, in the ControlHint shape (DESIGN-SLOTS.md). */

/** @type {Record<string, import("../shared/harness.js").Param>} */
export const PARAMS = {
  palette: { value: "theme", hint: { options: ["theme", "vellum", "admiralty"] } },
  coastline: { value: 1, hint: { min: 0, max: 2.5, step: 0.1 } },
  routes: { value: true },
  labels: { value: "all", hint: { options: ["all", "big", "none"] } },
}

/** @param {Record<string, unknown>} v */
export function applyPalette(v) {
  if (v.palette === "theme") delete document.documentElement.dataset.arPalette
  else document.documentElement.dataset.arPalette = String(v.palette)
}
