/** @file Pattern Book params, in the ControlHint shape (DESIGN-SLOTS.md). */

/** @type {Record<string, import("../shared/harness.js").Param>} */
export const PARAMS = {
  palette: { value: "theme", hint: { options: ["theme", "indigo", "madder", "undyed"] } },
  ends: { value: 48, hint: { min: 24, max: 80, step: 4 } },
  weaveSeconds: { value: 2.2, hint: { min: 0.4, max: 6, step: 0.2 }, css: "--wv-weave", unit: "s" },
  showLetters: { value: true },
}

/** @param {Record<string, unknown>} v */
export function applyPalette(v) {
  if (v.palette === "theme") delete document.documentElement.dataset.wvPalette
  else document.documentElement.dataset.wvPalette = String(v.palette)
  document.documentElement.dataset.wvLetters = v.showLetters ? "on" : "off"
}
