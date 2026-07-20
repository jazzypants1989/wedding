/** @file Effect studio — config serialization ("copy values").
 *
 *  Studio-only helper: formats a live-tuned config object as a pasteable
 *  `defaults` literal for config.js. The presentation metadata (labels, slider
 *  bounds) and the generic control builders now live in the shared, production
 *  modules public/effects/control-meta.js and public/components/effect-controls.js
 *  so the thank-you card composer can reuse them. This formatter stays here
 *  because it is only useful for authoring config.js by hand.
 */

/**
 * Format one value as it would appear in config.js `defaults`.
 * @param {unknown} value @param {number} depth
 * @returns {string}
 */
function formatValue(value, depth) {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) {
    const allNumbers = value.every((v) => typeof v === "number")
    if (allNumbers) return "[" + value.join(", ") + "]"
    // String arrays (color palettes) print multiline, matching config.js.
    const pad = "  ".repeat(depth + 1)
    const closePad = "  ".repeat(depth)
    const items = value.map((v) => pad + formatValue(v, depth + 1) + ",")
    return "[\n" + items.join("\n") + "\n" + closePad + "]"
  }
  return JSON.stringify(value)
}

/**
 * Serialize a config object as a pasteable `defaults` literal for config.js.
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
export function serializeConfig(config) {
  const lines = Object.entries(config).map(
    ([key, value]) => "  " + key + ": " + formatValue(value, 1) + ",",
  )
  return "{\n" + lines.join("\n") + "\n}"
}
