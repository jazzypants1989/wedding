/** @file Generated placeholder art. Every "face" and "photo" in this prototype is
 *  an abstract SVG built from a number — never an image file, never a person.
 *  The hue is the only thing that ties faces of the same (fictional) person
 *  together, so a group visibly "looks alike" and the odd one out is spottable. */

/** Deterministic PRNG so a face id always draws the same silhouette.
 *  @param {number} seed */
export function rng(seed) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** @param {string} svg */
function uri(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
}

/** An abstract head-and-shoulders silhouette on a tinted ground.
 *  @param {number} hue  the fictional person's hue
 *  @param {number} id   the face id — varies tilt/lightness a little
 *  @param {{ size?: number, odd?: boolean }} [opts] */
export function faceSvg(hue, id, opts = {}) {
  const r = rng(id * 7919)
  const tilt = Math.round((r() - 0.5) * 14)
  const light = 78 + Math.round(r() * 10)
  const sat = 38 + Math.round(r() * 18)
  const dx = Math.round((r() - 0.5) * 10)
  const bg = `hsl(${hue} ${sat}% ${light}%)`
  const fg = `hsl(${hue} ${sat + 8}% ${light - 42}%)`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${bg}"/>` +
    `<g transform="rotate(${tilt} 50 60) translate(${dx} 0)" fill="${fg}" opacity="0.85">` +
    `<circle cx="50" cy="42" r="19"/>` +
    `<path d="M14 104 C16 76 32 66 50 66 C68 66 84 76 86 104 Z"/>` +
    `</g></svg>`
  return uri(svg)
}

/** @param {number} hue @param {number} id @param {string} cls @param {string} alt */
export function faceImg(hue, id, cls = "face", alt = "") {
  return `<img class="${cls}" src="${faceSvg(hue, id)}" alt="${alt}" width="96" height="96">`
}

/** An abstract "photograph": sky, ground, and a few silhouettes. If `boxes` are
 *  given (0..1 coordinates), those silhouettes are drawn at those spots.
 *  @param {number} seed
 *  @param {{ figures?: { hue: number, x: number, y: number, s: number }[] }} [opts] */
export function sceneSvg(seed, opts = {}) {
  const r = rng(seed * 104729)
  const skyHue = Math.round(r() * 360)
  const groundHue = (skyHue + 90 + Math.round(r() * 80)) % 360
  const figures =
    opts.figures ||
    Array.from({ length: 2 + Math.floor(r() * 4) }, (_, i) => ({
      hue: Math.round(r() * 360),
      x: 0.15 + i * 0.18 + r() * 0.06,
      y: 0.42 + r() * 0.08,
      s: 0.13 + r() * 0.05,
    }))
  let people = ""
  for (const f of figures) {
    const cx = f.x * 160
    const cy = f.y * 100
    const s = f.s * 100
    people +=
      `<g fill="hsl(${f.hue} 35% 38%)" opacity="0.9">` +
      `<circle cx="${cx}" cy="${cy}" r="${s * 0.45}"/>` +
      `<path d="M${cx - s} 100 C${cx - s} ${cy + s * 0.9} ${cx - s * 0.5} ${cy + s * 0.6} ${cx} ${
        cy + s * 0.6
      } C${cx + s * 0.5} ${cy + s * 0.6} ${cx + s} ${cy + s * 0.9} ${cx + s} 100 Z"/>` +
      `</g>`
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="hsl(${skyHue} 55% 82%)"/>` +
    `<stop offset="1" stop-color="hsl(${skyHue} 45% 92%)"/></linearGradient></defs>` +
    `<rect width="160" height="100" fill="url(#s)"/>` +
    `<path d="M0 70 Q40 ${58 + r() * 10} 80 66 T160 ${62 + r() * 8} V100 H0 Z" fill="hsl(${groundHue} 30% 62%)"/>` +
    people +
    `</svg>`
  return uri(svg)
}

/** @param {number} seed @param {string} cls @param {string} alt */
export function sceneImg(seed, cls = "scene", alt = "Placeholder photo") {
  return `<img class="${cls}" src="${sceneSvg(seed)}" alt="${alt}">`
}

/** Initial-in-a-circle avatar for a person or guest (no picture at all).
 *  @param {string} name @param {number} hue */
export function monogram(name, hue) {
  const parts = name.split(" ").filter(Boolean)
  const first = parts[0] ? parts[0][0] : "?"
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ""
  return `<span class="mono" style="--h:${hue}" aria-hidden="true">${first}${last}</span>`
}
