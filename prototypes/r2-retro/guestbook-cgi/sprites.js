/** @file guestbook.cgi sprites — every "animated GIF" on the page, drawn as
 *  pixel art in code. Colours are classes, so theme tokens paint them. */

import { pixelSvg } from "../shared/pixels.js"

const HEART = [
  ".###...###.",
  "#####.#####",
  "##w########",
  "#w#########",
  "###########",
  ".#########.",
  "..#######..",
  "...#####...",
  "....###....",
  ".....#.....",
]

const SIGN = [
  "........k........",
  ".......kyk.......",
  "......kyyyk......",
  ".....kyyyyyk.....",
  "....kyyykkyyk....",
  "...kyyyykkyyyk...",
  "..kyyyyykyyyyyk..",
  ".kyyyykkkkyyykyk.",
  "kyyyyyyykyyyykyyk",
  ".kyyyyykykyykyyk.",
  "..kyyyykyykyyyk..",
  "...kyykyyykkkk...",
  "....kyyyyyyyk....",
  ".....kyyyyyk.....",
  "......kyyyk......",
  ".......kyk.......",
  "........k........",
]

const ENVELOPE = [
  "kkkkkkkkkkkkkkkk",
  "kkwwwwwwwwwwwwkk",
  "kwkwwwwwwwwwwkwk",
  "kwwkwwwwwwwwkwwk",
  "kwwwkwwwwwwkwwwk",
  "kwwwwkwwwwkwwwwk",
  "kwwwwwkhhkwwwwwk",
  "kwwwwkwhhwkwwwwk",
  "kwwwkwwwwwwkwwwk",
  "kwwkwwwwwwwwkwwk",
  "kkkkkkkkkkkkkkkk",
]

const SPARKLE = [
  "...w...",
  "...w...",
  "..wyw..",
  "wwyyyww",
  "..wyw..",
  "...w...",
  "...w...",
]

const STAR = [
  ".....k.....",
  "....kyk....",
  "....kyk....",
  "kkkkyyykkkk",
  "kyyyyyyyyyk",
  ".kyyyyyyyk.",
  "..kyyyyyk..",
  "..kyykyyk..",
  ".kyyk.kyyk.",
  ".kyk...kyk.",
  ".kk.....kk.",
]

/* Twelve-frame "spinning" is done in CSS (scaleX with steps()), the way a 1999
   GIF faked a coin spin — so one frame of art is enough. */

/** @param {string} [title] */
export const heart = (title) =>
  pixelSvg(HEART, { "#": ".px-heart", w: ".px-shine" }, { className: "px px-heart-svg", title })

export const sign = () =>
  pixelSvg(SIGN, { k: ".px-ink", y: ".px-caution" }, { className: "px px-sign" })

export const envelope = () =>
  pixelSvg(ENVELOPE, { k: ".px-ink", w: ".px-paper", h: ".px-heart" }, { className: "px px-envelope" })

export const sparkle = () =>
  pixelSvg(SPARKLE, { w: ".px-shine", y: ".px-caution" }, { className: "px px-sparkle" })

export const star = () =>
  pixelSvg(STAR, { k: ".px-ink", y: ".px-caution" }, { className: "px px-star" })

/** Raw rows, for the background tile (which needs literal colours). */
export const ROWS = { HEART, SPARKLE }
