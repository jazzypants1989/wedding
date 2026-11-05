/** @file Black-and-white twin detection, the part that needs pixels. Pure
 *  functions over RGBA bytes: no DOM, so the unit tests run them in Node.
 *
 *  The browser draws each candidate's thumbnail into a TONE_GRID × TONE_GRID
 *  canvas (gallery-twins.js) and hands the bytes here. Two numbers come out:
 *  how colourful the picture is, and a coarse brightness map. A black-and-white
 *  copy is all but colourless; its brightness map lines up with its colour
 *  original's even after a photographer's own black-and-white mix, while a
 *  different frame from the same burst second lines up less well. */
/** @import * as Types from './types.js' */

/** The side of the square every thumbnail is drawn into before measuring. */
export const TONE_GRID = 32

/** Mean per-pixel colourfulness (max channel - min channel, 0-255) below which
 *  a picture counts as black-and-white. A true grayscale copy measures ~0; JPEG
 *  chroma noise and a colour-managed canvas leave it a point or two above. */
const GRAY_CHROMA_MAX = 6
/** …and above which a picture is clearly a colour one. The gap between the two
 *  is a "can't tell" band — a sepia print, a muted dusk shot — where nothing is
 *  proposed and the couple can still pair by hand. */
const COLOUR_CHROMA_MIN = 12
/** The weakest brightness-map correlation still proposed as one frame. */
const MIN_CORRELATION = 0.6

/** @type {Types.measureTone} */
export function measureTone(rgba) {
  const pixels = Math.floor(rgba.length / 4)
  if (pixels === 0) return null
  let chroma = 0
  /** @type {number[]} */
  const luma = []
  for (let i = 0; i < pixels; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    chroma += Math.max(r, g, b) - Math.min(r, g, b)
    // Rec. 709 weights: what a plain desaturation would keep.
    luma.push(0.2126 * r + 0.7152 * g + 0.0722 * b)
  }
  return { chroma: chroma / pixels, luma }
}

/** @type {Types.toneKind} */
export function toneKind(tone) {
  if (tone.chroma <= GRAY_CHROMA_MAX) return "gray"
  if (tone.chroma >= COLOUR_CHROMA_MIN) return "colour"
  return "unsure"
}

/** @type {Types.lumaCorrelation} */
export function lumaCorrelation(a, b) {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i]
    meanB += b[i]
  }
  meanA /= n
  meanB /= n
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA
    const db = b[i] - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  // A flat picture has no shape to match; call it no match rather than divide by 0.
  if (varA === 0 || varB === 0) return 0
  return cov / Math.sqrt(varA * varB)
}

/** @type {Types.proposeTwins} */
export function proposeTwins(groups, tones) {
  /** @type {Types.TwinProposal[]} */
  const proposals = []
  for (const group of groups) {
    /** @type {Array<{ id: number, tone: Types.Tone }>} */
    const grays = []
    /** @type {Array<{ id: number, tone: Types.Tone }>} */
    const colours = []
    for (const member of group.members) {
      const tone = tones.get(member.id)
      if (!tone) continue
      const kind = toneKind(tone)
      if (kind === "gray") grays.push({ id: member.id, tone })
      else if (kind === "colour") colours.push({ id: member.id, tone })
    }
    // Best matches first across the whole group, so a burst of three colour
    // frames and their three copies pairs each copy with its own frame rather
    // than whichever colour frame happened to be listed first.
    /** @type {Array<{ gray: number, colour: number, score: number }>} */
    const scored = []
    for (const gray of grays) {
      for (const colour of colours) {
        scored.push({
          gray: gray.id,
          colour: colour.id,
          score: lumaCorrelation(gray.tone.luma, colour.tone.luma),
        })
      }
    }
    scored.sort((x, y) => y.score - x.score || x.colour - y.colour || x.gray - y.gray)
    const taken = new Set()
    for (const s of scored) {
      if (s.score < MIN_CORRELATION) break
      if (taken.has(s.gray) || taken.has(s.colour)) continue
      taken.add(s.gray)
      taken.add(s.colour)
      proposals.push({ primaryId: s.colour, twinId: s.gray, score: s.score })
    }
  }
  return proposals
}

/** @type {Types.pairDirection} */
export function pairDirection(chosen, other) {
  // The photo the couple started from is the colour one unless the pixels say
  // plainly that it is the black-and-white one and the other isn't.
  if (!chosen.tone || !other.tone) return { primaryId: chosen.id, twinId: other.id }
  const a = toneKind(chosen.tone)
  const b = toneKind(other.tone)
  if (a === "gray" && b === "colour") return { primaryId: other.id, twinId: chosen.id }
  return { primaryId: chosen.id, twinId: other.id }
}
