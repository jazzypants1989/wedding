/** @file Checks for the entry → tune mapping. Run: node --test prototypes/r2-sound-time/shared/ */

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { lettersOf, wordsOf, motifFor, midiOf, hzOf, LANES, MAX_NOTES } from "./motif.js"

const fixture = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "..", "fixtures", "entries.json"), "utf8"),
)

test("letters fold accents and drop everything else", () => {
  assert.equal(lettersOf("Rafael Domínguez-Ortiz"), "rafaeldominguezortiz")
  assert.equal(lettersOf("Annika Sørensen"), "annikasorensen")
  assert.equal(lettersOf('Henrietta "Hen" Vasquez'), "henriettahenvasquez")
  assert.equal(lettersOf("Little Maya (age 7)"), "littlemayaage")
  assert.equal(lettersOf(""), "")
})

test("words split on any whitespace", () => {
  assert.deepEqual(wordsOf("Dear J & J,\n\nWe  have"), ["Dear", "J", "&", "J,", "We", "have"])
  assert.deepEqual(wordsOf(""), [])
})

test("the French cryptogram spells A–G and wraps", () => {
  // a b c d e f g h i → A B C D E F G A B
  const m = motifFor({ author_name: "abcdefghi", message: "x" })
  assert.equal(m.spelled, "A B C D E F G A B")
})

test("Ezra spells E E D A, checked by hand", () => {
  // e=4→E, z=25→25%7=4→E, r=17→3→D, a=0→A
  const m = motifFor({ author_name: "Ezra", message: "♥ ♥" })
  assert.equal(m.spelled, "E E D A")
})

test("every fixture entry maps deterministically, on the roll, within limits", () => {
  for (const e of fixture.entries) {
    const a = motifFor(e)
    const b = motifFor(JSON.parse(JSON.stringify(e)))
    assert.deepEqual(a, b, "same entry, same tune")
    assert.ok(a.notes.length > 0 && a.notes.length <= MAX_NOTES)
    for (const n of a.notes) {
      assert.ok(n.lane >= 0 && n.lane < LANES, `lane ${n.lane} on the roll`)
      for (const c of n.chord) assert.ok(c >= 0 && c < LANES)
      assert.ok(n.dur >= 1 && n.dur <= 5)
    }
    const last = a.notes[a.notes.length - 1]
    assert.equal(last.start + last.dur, a.units, "units is the phrase length")
  }
})

test("consecutive notes stay within a seventh: nearest octave, clamped to the roll", () => {
  for (const e of fixture.entries) {
    const { notes } = motifFor(e)
    for (let i = 1; i < notes.length; i++) {
      assert.ok(Math.abs(notes[i].lane - notes[i - 1].lane) <= 6)
    }
  }
})

test("hearts make a chord, favourites ring a bell", () => {
  const plain = motifFor({ author_name: "Wren", message: "hi" })
  const loved = motifFor({ author_name: "Wren", message: "hi", reactions: { heart: { count: 6 } } })
  const fav = motifFor({ author_name: "Wren", message: "hi", favourite: true })
  assert.equal(plain.notes.at(-1)?.chord.length, 0)
  assert.equal(loved.notes.at(-1)?.chord.length, 2)
  assert.equal(loved.units, plain.units + 2)
  assert.equal(fav.notes.at(-1)?.bell, true)
})

test("pentatonic scale stays on C D E G A", () => {
  const m = motifFor({ author_name: "The Abernathy-Nguyen Family", message: "x" }, { scale: "pentatonic" })
  for (const n of m.notes) assert.ok(["C", "D", "E", "G", "A"].includes(n.name))
})

test("a name with no Latin letters still gets a deterministic tune", () => {
  const a = motifFor({ author_name: "田中 さくら", message: "おめでとう" })
  const b = motifFor({ author_name: "田中 さくら", message: "おめでとう" })
  assert.ok(a.notes.length > 0)
  assert.deepEqual(a, b)
  assert.ok(motifFor({ author_name: "", message: "" }).notes.length > 0)
})

test("pitch helpers", () => {
  assert.equal(midiOf(0), 60)
  assert.equal(midiOf(5), 69)
  assert.equal(midiOf(13), 83)
  assert.equal(Math.round(hzOf(69)), 440)
})
