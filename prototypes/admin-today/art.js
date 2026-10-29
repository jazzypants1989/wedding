/** @file Generated placeholder art. There are NO photographs in this prototype:
 *  a "face" is an abstract silhouette whose colour and hair shape derive from a
 *  hidden identity number (so a group visibly hangs together), and a "photo" is
 *  a gradient with silhouettes on it. Nothing here depicts anyone. */

const HAIR = [
  // short
  "M22 30 C22 14 58 14 58 30 C54 22 26 22 22 30 Z",
  // long
  "M20 34 C18 10 62 10 60 34 L62 56 C58 44 58 30 56 26 C48 20 32 20 24 26 C22 30 22 44 18 56 Z",
  // curly crown
  "M21 30 C18 22 24 14 32 15 C36 10 46 10 50 15 C58 14 63 22 59 30 C52 22 28 22 21 30 Z",
  // none (bald / hat-less)
  "",
]

/** @param {number} n */
function hueOf(n) {
  return (n * 47 + 11) % 360
}

/**
 * One face chip as inline SVG.
 * @param {number} identity  hidden identity — drives colour + hair
 * @param {number} variant   per-face jitter — tilt, offset, lighting
 * @param {{ size?: number, dim?: boolean }} [opts]
 */
export function faceSvg(identity, variant, opts = {}) {
  const size = opts.size || 96
  const h = hueOf(identity)
  const tilt = ((variant % 21) - 10) * 0.9
  const dx = ((variant % 7) - 3) * 0.8
  const light = 52 + (variant % 13)
  const hair = HAIR[identity % HAIR.length]
  const dim = opts.dim ? ' opacity="0.45"' : ""
  return `<svg viewBox="0 0 80 80" width="${size}" height="${size}" aria-hidden="true" class="face-svg"${dim}>
    <rect width="80" height="80" fill="hsl(${(h + 180) % 360} 25% ${light + 25}%)"/>
    <g transform="rotate(${tilt} 40 44) translate(${dx} 0)">
      <path d="M8 80 C10 60 26 54 40 54 C54 54 70 60 72 80 Z" fill="hsl(${h} 30% ${light - 18}%)"/>
      <ellipse cx="40" cy="36" rx="17" ry="20" fill="hsl(${h} 35% ${light + 8}%)"/>
      ${hair ? `<path d="${hair}" fill="hsl(${(h + 30) % 360} 30% ${light - 30}%)"/>` : ""}
    </g>
  </svg>`
}

/** A named person's avatar: initial on a colour. Names are typed by the
 *  couple, so showing one is fine; it is the unnamed faces that stay abstract. */
export function avatar(name, size = 32) {
  let n = 0
  for (let i = 0; i < name.length; i++) n = (n + name.charCodeAt(i)) % 997
  const h = hueOf(n)
  const initial = name.trim().charAt(0).toUpperCase()
  return `<span class="avatar" style="--a:${h};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px" aria-hidden="true">${initial}</span>`
}

/** A placeholder "photograph": gradient sky, ground, and some silhouettes.
 *  Returns the SVG plus face boxes in percent, for the photo dialog. */
export function photoSvg(mediaId, faceCount = 0) {
  const h = (mediaId * 29) % 360
  const boxes = []
  let figs = ""
  for (let i = 0; i < faceCount; i++) {
    const x = 12 + (i * 76) / Math.max(1, faceCount - 1 || 1) - (faceCount === 1 ? -26 : 0)
    const s = 0.7 + ((mediaId + i * 3) % 5) * 0.08
    const y = 34 + ((mediaId + i) % 3) * 4
    const ident = (mediaId + i * 5) % 12
    const fh = hueOf(ident)
    figs += `<g transform="translate(${x} ${y}) scale(${s})">
      <path d="M-14 60 C-12 30 12 30 14 60 Z" fill="hsl(${fh} 30% 35%)"/>
      <circle cx="0" cy="18" r="9" fill="hsl(${fh} 35% 62%)"/></g>`
    boxes.push({ x: x - 10 * s, y: y + 6 * s, w: 20 * s, h: 24 * s, ident })
  }
  const svg = `<svg viewBox="0 0 100 75" preserveAspectRatio="none" class="photo-svg" aria-hidden="true">
    <defs><linearGradient id="sky${mediaId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${h} 55% 78%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 60% 88%)"/>
    </linearGradient></defs>
    <rect width="100" height="75" fill="url(#sky${mediaId})"/>
    <circle cx="${70 + (mediaId % 20)}" cy="16" r="7" fill="hsl(${(h + 50) % 360} 80% 92%)"/>
    <path d="M0 58 C25 50 45 62 70 54 C85 50 95 54 100 52 L100 75 L0 75 Z" fill="hsl(${(h + 100) % 360} 30% 52%)"/>
    ${figs}
  </svg>`
  return { svg, boxes }
}

/** A placeholder for a guest-uploaded photo in the moderation queue — a
 *  landscape-ish abstract, no figures at all. */
export function scenerySvg(hue) {
  return `<svg viewBox="0 0 160 100" class="scenery-svg" aria-hidden="true">
    <rect width="160" height="100" fill="hsl(${hue} 60% 80%)"/>
    <circle cx="120" cy="28" r="12" fill="hsl(${(hue + 40) % 360} 85% 92%)"/>
    <path d="M0 70 L40 40 L70 62 L105 30 L160 72 L160 100 L0 100 Z" fill="hsl(${(hue + 150) % 360} 25% 50%)"/>
    <path d="M0 84 C40 74 90 92 160 80 L160 100 L0 100 Z" fill="hsl(${(hue + 120) % 360} 30% 38%)"/>
  </svg>`
}
