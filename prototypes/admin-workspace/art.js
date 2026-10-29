/** @file Generated placeholder art. The real Faces tab shows crops of real
 *  people; this prototype never loads an image — every face is an abstract
 *  silhouette and every photo an abstract landscape, drawn from a number. */

/** @param {number} seed */
function rand(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

/** A face placeholder: a silhouette on a tinted ground.
 *  @param {{ hue: number, seed: number }} f @param {string} [label] */
export function faceSvg(f, label = "Face placeholder") {
  const r = rand(f.seed)
  const hair = 20 + Math.round(r * 18)
  const tilt = Math.round((rand(f.seed + 1) - 0.5) * 14)
  const bg = `hsl(${f.hue} 45% 78%)`
  const fg = `hsl(${f.hue} 30% 38%)`
  return `<svg class="art" viewBox="0 0 100 100" role="img" aria-label="${label}">
    <rect width="100" height="100" fill="${bg}"/>
    <g transform="rotate(${tilt} 50 60)" fill="${fg}">
      <ellipse cx="50" cy="44" rx="${hair}" ry="${hair + 2}" opacity="0.55"/>
      <circle cx="50" cy="46" r="17"/>
      <path d="M18 100 C20 74 34 66 50 66 C66 66 80 74 82 100 Z"/>
    </g>
  </svg>`
}

/** A person avatar: initials on a hue.
 *  @param {{ name: string, hue: number }} p */
export function avatarSvg(p) {
  const parts = p.name.split(" ").filter((w) => w.length > 0 && w !== "&")
  const initials = (parts[0] ? parts[0][0] : "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")
  return `<svg class="art" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="20" fill="hsl(${p.hue} 40% 55%)"/>
    <text x="20" y="25" text-anchor="middle" font-size="14" font-family="sans-serif" fill="#fff">${initials}</text>
  </svg>`
}

let gradientSerial = 0

/** An abstract "photo": sky, hills, a sun. Video gets a play badge.
 *  @param {number} seed @param {{ video?: boolean, boxes?: number }} [opts] */
export function photoSvg(seed, opts = {}) {
  // Unique per call: the same photo can be drawn twice on a page (list thumb +
  // detail), and a gradient id defined inside a display:none pane paints nothing.
  const gid = "sky" + seed + "-" + gradientSerial++
  const h =Math.round(rand(seed) * 360)
  const sunX = 20 + Math.round(rand(seed + 2) * 60)
  const hill1 = 50 + Math.round(rand(seed + 3) * 15)
  const hill2 = 58 + Math.round(rand(seed + 4) * 12)
  let boxes = ""
  for (let i = 0; i < (opts.boxes || 0); i++) {
    const x = 14 + i * (72 / Math.max(1, opts.boxes || 1))
    boxes += `<g><rect x="${x}" y="${34 + (i % 2) * 6}" width="14" height="16" rx="2" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="${i === 0 ? "0" : "2 1.5"}"/>
      <text x="${x + 7}" y="${30 + (i % 2) * 6}" font-size="5" fill="#fff" text-anchor="middle" font-family="sans-serif">${i + 1}</text></g>`
  }
  const play = opts.video
    ? `<circle cx="50" cy="40" r="11" fill="rgba(0,0,0,.45)"/><path d="M46 34 L57 40 L46 46 Z" fill="#fff"/>`
    : ""
  return `<svg class="art" viewBox="0 0 100 75" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Photo placeholder">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="hsl(${h} 60% 72%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360} 70% 86%)"/>
    </linearGradient></defs>
    <rect width="100" height="75" fill="url(#${gid})"/>
    <circle cx="${sunX}" cy="22" r="8" fill="hsl(${(h + 180) % 360} 80% 92%)"/>
    <path d="M0 ${hill1} Q30 ${hill1 - 14} 60 ${hill1} T100 ${hill1 - 4} V75 H0 Z" fill="hsl(${(h + 120) % 360} 25% 52%)"/>
    <path d="M0 ${hill2} Q40 ${hill2 - 10} 70 ${hill2 + 2} T100 ${hill2} V75 H0 Z" fill="hsl(${(h + 140) % 360} 30% 38%)"/>
    ${boxes}${play}
  </svg>`
}

/** Stroke icons, 20px grid. */
const PATHS = {
  home: "M3 9.5 10 4l7 5.5V17H3z M8 17v-5h4v5",
  review: "M3 4h14v10H8l-4 3v-3H3z M6 8h8 M6 11h5",
  faces: "M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M4 17c0-3 3-5 6-5s6 2 6 5",
  gallery: "M3 4h14v12H3z M3 13l4-4 3 3 3-3 4 4",
  gifts: "M3 8h14v3H3z M4 11h12v6H4z M10 8v9 M10 8C8 4 5 5 6.5 7 M10 8c2-4 5-3 3.5-1",
  cards: "M3 5h14v10H3z M3 5l7 6 7-6",
  replies: "M10 16s-6-3.5-6-8a3.2 3.2 0 0 1 6-1.6A3.2 3.2 0 0 1 16 8c0 4.5-6 8-6 8z",
  guests: "M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M2 16c0-2.5 2.2-4 5-4s5 1.5 5 4 M13.5 9a2 2 0 1 0 0-4 M14 12c2.2 0 4 1.3 4 4",
  accounts: "M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M4 17c0-3 3-5 6-5s6 2 6 5 M15 3l1 1 2-2",
  rsvps: "M4 4h12v13H4z M7 9l2 2 4-4 M7 14h6",
  requests: "M4 4h12v9H9l-3 3v-3H4z M10 7v3 M10 12h.01",
  blocklist: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M5 5l10 10",
  content: "M4 3h9l3 3v11H4z M7 8h6 M7 11h6 M7 14h4",
  effects: "M10 2l1.8 4.6L16 8l-4.2 1.4L10 14l-1.8-4.6L4 8l4.2-1.4z M15 13l.7 1.8 1.8.7-1.8.7L15 18l-.7-1.8-1.8-.7 1.8-.7z",
  more: "M4 10h.01 M10 10h.01 M16 10h.01",
  back: "M12 4l-6 6 6 6",
  sun: "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M10 2v2 M10 16v2 M2 10h2 M16 10h2 M4.3 4.3l1.4 1.4 M14.3 14.3l1.4 1.4 M4.3 15.7l1.4-1.4 M14.3 5.7l1.4-1.4",
  moon: "M15 12.5A6 6 0 0 1 7.5 5a6 6 0 1 0 7.5 7.5z",
  check: "M4 10l4 4 8-8",
  search: "M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M13.5 13.5 17 17",
  key: "M7 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z M10 10h7 M14 10v3 M16 10v2",
}

/** @param {keyof typeof PATHS} name */
export function icon(name) {
  return `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[name]}"/></svg>`
}
