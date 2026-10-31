/** @file Two pressed-flower sprays in the page's lower corners, drawn by the
 *  same generator as the notes, so the empty margins of a wide screen belong
 *  to the garden. Fixed and still: one composited layer that the page scrolls
 *  over, never repainted. Decorative (aria-hidden), and only where there is
 *  margin to spare (see .gb-backdrop in guestbook.css). */
/** @import * as Types from "./types.js" */

import { growFlower } from "../../components/note-flower.js"

/** Fixed seeds, so the sprays are the same on every visit. Each line is a
 *  plant: who it is (its hue and habit) and how its sentences end. */
const LEFT = [
  { author_name: "Marigold", message: "What a day! What a night!" },
  { author_name: "Wren", message: "We loved every minute of it." },
  { author_name: "Juniper", message: "Who could forget it? Not us." },
  { author_name: "Clementine", message: "Dancing. Laughing. Crying. All of it!" },
]
const RIGHT = [
  { author_name: "Hollis", message: "So happy for you both. Always." },
  { author_name: "Primrose", message: "Best day ever!!" },
  { author_name: "Lark", message: "Was that the best cake ever made? Yes." },
  { author_name: "Sorrel", message: "Here is to the next fifty years." },
]

/** @param {number} n */
const f = (n) => String(Math.round(n * 100) / 100)

/** A spray rooted at the corner, fanned toward the page.
 *  @param {Types.FlowerNote[]} seeds @param {1 | -1} side */
function spray(seeds, side) {
  let out = ""
  seeds.forEach((note, i) => {
    const p = growFlower(note)
    const lean = 3 + i * 6
    const scale = 3 - i * 0.34
    const x = 124 + i * 40
    out += `<g transform="translate(${f(x)} 600) rotate(${f(lean)}) scale(${f(scale)})">${p.markup}</g>`
  })
  // Mirrored for the right corner, so both sprays lean in toward the page.
  const flip = side === 1 ? "" : ` transform="translate(360 0) scale(-1 1)"`
  return `<svg class="gb-spray gb-spray-${side === 1 ? "left" : "right"}" viewBox="0 0 360 600"
    preserveAspectRatio="xMidYMax meet" focusable="false"><g${flip}>${out}</g></svg>`
}

/** @type {Types.initBackdrop} */
export function initBackdrop() {
  const layer = document.createElement("div")
  layer.className = "gb-backdrop"
  layer.setAttribute("aria-hidden", "true")
  layer.innerHTML = spray(LEFT, 1) + spray(RIGHT, -1)
  document.body.prepend(layer)
}
