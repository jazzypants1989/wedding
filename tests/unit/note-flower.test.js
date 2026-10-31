/** @file Unit test: the guestbook note flower is deterministic, reads the note's
 *  grammar the way its key says, and stays a handful of elements however long
 *  the note is. */

import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { growFlower, flowerSVG, noteSentences } from "../../public/components/note-flower.js"

const SRC = path.join(import.meta.dirname, "..", "..", "public", "components", "note-flower.js")

/** @param {string} message @param {string} [author] */
const note = (message, author = "Ada Lovelace") => ({ author_name: author, message })

test("the same note grows the identical flower; the id is not part of the seed", () => {
  const a = flowerSVG(note("What a day. We danced until the lights came up!"))
  const b = flowerSVG({ ...note("What a day. We danced until the lights came up!"), id: 99 })
  assert.strictEqual(a, b)
  assert.notStrictEqual(a, flowerSVG(note("What a day. We danced until the lights came up?")))
})

test("no Math.random and no regex anywhere in the generator", () => {
  const src = fs.readFileSync(SRC, "utf8")
  assert.ok(!src.includes("Math.random("))
  assert.ok(!src.includes("RegExp("))
})

test("sentences split on . ! ? … and keep runs, commas and emoji", () => {
  const s = noteSentences("Hello there, friend. Wow!!! Really? Well… 🎉")
  assert.deepStrictEqual(
    s.map((x) => [x.end, x.marks]),
    [
      [".", 1],
      ["!", 3],
      ["?", 1],
      [".", 3],
      ["", 0],
    ],
  )
  assert.deepStrictEqual(s[0].commas, [2])
  assert.deepStrictEqual(s[4].emoji, ["🎉"])
  // A dot inside a token is not a sentence end.
  assert.strictEqual(noteSentences("See you at 10.30 tomorrow.").length, 1)
})

test("each ending grows its own tip", () => {
  assert.strictEqual(growFlower(note("We love you!")).parts.blooms, 1)
  assert.strictEqual(growFlower(note("We love you!!!")).parts.blooms, 3)
  assert.strictEqual(growFlower(note("When is the party?")).parts.buds, 1)
  assert.strictEqual(growFlower(note("When is the party???")).parts.buds, 3)
  assert.ok(growFlower(note("Still thinking about it…")).parts.berries >= 3)
  assert.strictEqual(growFlower(note("A modest wish.")).parts.tulips, 1)
  assert.strictEqual(growFlower(note("no full stop at all")).parts.tendrils, 1)
})

test("a plain sentence grows a flower as substantial as a bloom", () => {
  // A full stop must read as a flower, not as nothing: a tulip with filled
  // petals, standing about as tall and wide as the bloom the same words grow.
  const words = "We had the best time"
  const plain = growFlower(note(words + "."))
  const bloom = growFlower(note(words + "!"))
  assert.strictEqual(plain.parts.tulips, 1)
  assert.strictEqual(plain.parts.blooms + plain.parts.buds + plain.parts.tendrils, 0)
  assert.ok(plain.markup.includes('class="nf-cup'), "the tulip has filled back petals")
  assert.ok(plain.markup.includes('class="nf-bud'), "and a filled front petal")
  /** @param {{ box: { x0: number, y0: number, x1: number, y1: number } }} p */
  const area = (p) => (p.box.x1 - p.box.x0) * (p.box.y1 - p.box.y0)
  const ratio = area(plain) / area(bloom)
  assert.ok(ratio > 0.8 && ratio < 1.25, `tulip:bloom extent ${ratio.toFixed(2)}`)
  // Every sentence's full stop grows its own tulip.
  assert.strictEqual(growFlower(note("One. Two. Three.")).parts.tulips, 3)
})

test("sentences branch and words leaf", () => {
  const one = growFlower(note("One sentence only."))
  const three = growFlower(note("First one here. Second one here. Third one here."))
  assert.strictEqual(one.parts.branches, 0)
  assert.strictEqual(three.parts.branches, 2)
  assert.ok(three.parts.leaves > one.parts.leaves)
})

test("emoji grow special flowers", () => {
  assert.strictEqual(growFlower(note("Congratulations ❤️ 🥂 🎉")).parts.emoji, 3)
  assert.strictEqual(growFlower(note("🎉🎉🎉")).parts.emoji, 3)
})

test("a Favorite is gilded, whichever flowers it grew", () => {
  for (const m of ["Best day ever!", "Best day ever.", "Best day ever?"]) {
    const plain = growFlower(note(m))
    const gold = growFlower(note(m), { gold: true })
    assert.ok(!plain.markup.includes("nf-gold"), m)
    assert.ok(gold.markup.includes("nf-gold"), m)
  }
})

test("empty and odd notes still draw something", () => {
  for (const m of ["", "   ", "!!!", "…", "🎉", "a"]) {
    const svg = flowerSVG(note(m, ""))
    assert.ok(svg.startsWith("<svg"), `"${m}"`)
    assert.ok(!svg.includes("NaN"), `"${m}" has NaN`)
  }
})

test("a long note is still a handful of elements, and the size is capped", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i}, with words, and more words!`).join(" ")
  const p = growFlower(note(long + " ❤️🥂🎉🎉🎉"))
  const elements = p.markup.split("<path").length - 1
  assert.ok(elements <= 24, `${elements} elements`)
  const svg = flowerSVG(note(long), { maxW: 110, maxH: 130 })
  const w = Number(svg.split('width="')[1].split('"')[0])
  const h = Number(svg.split('height="')[1].split('"')[0])
  assert.ok(w <= 110 && h <= 130, `${w}×${h}`)
})
