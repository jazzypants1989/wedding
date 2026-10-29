/** @file Tiny escaping template tag. No regex — escaping is replaceAll. */

export class Raw {
  /** @param {string} s */
  constructor(s) {
    this.s = s
  }
  toString() {
    return this.s
  }
}

/** @param {string} s */
export const raw = (s) => new Raw(s)

/** @param {unknown} s */
export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/** @param {unknown} v @returns {string} */
function fmt(v) {
  if (v === null || v === undefined || v === false) return ""
  if (v instanceof Raw) return v.s
  if (Array.isArray(v)) return v.map(fmt).join("")
  return esc(v)
}

/** @param {TemplateStringsArray} strings @param {unknown[]} vals */
export function html(strings, ...vals) {
  let out = strings[0]
  for (let i = 0; i < vals.length; i++) out += fmt(vals[i]) + strings[i + 1]
  return new Raw(out)
}

/** @param {number} n @param {string} one @param {string} [many] */
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`
