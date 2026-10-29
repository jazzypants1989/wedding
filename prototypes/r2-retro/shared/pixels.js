/** @file Pixel art in code. A sprite is an array of equal-length strings, one
 *  character per pixel; a palette maps characters to a colour. Every image in
 *  these sketches is drawn this way (or in CSS), so nothing is vendored.
 *
 *  Palette values: a literal colour (`#ff0`, `rgb(…)`) becomes a `fill`
 *  attribute; a value starting with `.` becomes a class, so CSS can colour it
 *  with theme tokens (`fill: var(--color-primary)`). `.` and space are clear.
 */

/**
 * @param {string[]} rows
 * @param {Record<string, string>} palette
 * @param {{ title?: string, className?: string, shape?: "square" | "dot", gap?: number }} [opts]
 * @returns {string} an `<svg>` string (decorative unless a title is given)
 */
export function pixelSvg(rows, palette, opts) {
  const o = opts || {}
  const h = rows.length
  let w = 0
  for (const r of rows) w = Math.max(w, r.length)
  let body = ""
  for (let y = 0; y < h; y++) {
    const row = rows[y]
    if (o.shape === "dot") {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (ch === "." || ch === " " || !(ch in palette)) continue
        const r = 0.5 - (o.gap === undefined ? 0.06 : o.gap)
        body += `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="${r}"${paint(palette[ch])}/>`
      }
      continue
    }
    // Merge horizontal runs of one colour into a single rect.
    let x = 0
    while (x < row.length) {
      const ch = row[x]
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      if (ch !== "." && ch !== " " && ch in palette) {
        body += `<rect x="${x}" y="${y}" width="${end - x}" height="1"${paint(palette[ch])}/>`
      }
      x = end
    }
  }
  const cls = o.className ? ` class="${o.className}"` : ""
  const a11y = o.title ? ` role="img" aria-label="${o.title}"` : ` aria-hidden="true"`
  const crisp = o.shape === "dot" ? "" : ` shape-rendering="crispEdges"`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${crisp}${cls}${a11y}>${body}</svg>`
}

/** @param {string} value */
function paint(value) {
  return value.startsWith(".") ? ` class="${value.slice(1)}"` : ` fill="${value}"`
}

/** Encode an SVG string as a CSS `url()` (percent-encoding only what must be).
 *  @param {string} svg */
export function svgUrl(svg) {
  const enc = svg
    .replaceAll("%", "%25")
    .replaceAll("#", "%23")
    .replaceAll("<", "%3C")
    .replaceAll(">", "%3E")
    .replaceAll('"', "'")
  return `url("data:image/svg+xml,${enc}")`
}

/** Resolve a CSS colour expression (tokens, light-dark(), color-mix()) to the
 *  concrete rgb() the browser computes right now, for places that cannot take
 *  var() — a data-URI tile, a canvas. @param {string} expr */
export function resolveColor(expr) {
  const probe = document.createElement("span")
  probe.style.setProperty("color", expr)
  probe.style.setProperty("display", "none")
  document.body.appendChild(probe)
  const out = getComputedStyle(probe).color
  probe.remove()
  return out
}
