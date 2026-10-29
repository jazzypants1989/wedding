/** @file WordArt, the "Arch Up" preset: an SVG textPath over a quadratic arc,
 *  extruded by stacking offset copies, filled with a token gradient. Real text
 *  in the SVG, and decorative here because the <h1> carries an sr-only copy. */

import { escapeHtml } from "/site/pages/utils.js"

/** @param {string} line1 arched line @param {string} line2 straight line
 *  @param {string} idPrefix unique per instance (gradient + path ids) */
export function wordart(line1, line2, idPrefix) {
  const a = escapeHtml(line1)
  const b = escapeHtml(line2)
  const g = `${idPrefix}-fill`
  const p = `${idPrefix}-arc`
  // Shrink the arched line's font for long names so it stays on the arc.
  const size1 = Math.max(34, Math.min(66, Math.round(1050 / Math.max(10, line1.length))))
  let depth1 = ""
  let depth2 = ""
  for (let i = 6; i >= 1; i--) {
    depth1 += `<text class="wa-text wa-depth" font-size="${size1}" transform="translate(${i * 0.9} ${i})"><textPath href="#${p}" startOffset="50%" text-anchor="middle">${a}</textPath></text>`
    depth2 += `<text class="wa-text wa-depth" x="360" y="186" font-size="58" text-anchor="middle" transform="translate(${i * 0.9} ${i})">${b}</text>`
  }
  return `<svg viewBox="0 0 720 200" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" class="wa-s1"/><stop offset="0.35" class="wa-s2"/>
        <stop offset="0.7" class="wa-s3"/><stop offset="1" class="wa-s4"/>
      </linearGradient>
      <path id="${p}" d="M 70 128 Q 360 -14 650 128" fill="none"/>
    </defs>
    ${depth1}
    <text class="wa-text wa-face" font-size="${size1}" fill="url(#${g})"><textPath href="#${p}" startOffset="50%" text-anchor="middle">${a}</textPath></text>
    ${depth2}
    <text class="wa-text wa-face" x="360" y="186" font-size="58" text-anchor="middle" fill="url(#${g})">${b}</text>
  </svg>`
}
