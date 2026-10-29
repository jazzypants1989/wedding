# Pattern Book: every note is threaded onto a loom and woven

`node prototypes/serve.js` → `/r2-grows/pattern-book/` (guestbook) and
`/r2-grows/pattern-book/book.html` (memory book). Try `?n=3`, `?n=300`,
`?dark=1`, `?motion=reduce`.

## The idea

This isn't a texture. It is real weaving math. Each note becomes an 8-shaft
**draft**, the notation hand-weavers have used for centuries, and the cloth on
screen is that draft's drawdown, rendered thread by thread.

| In the note                   | On the loom                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| each letter                   | one warp thread                                                             |
| each word                     | a run: it climbs the shafts, then the next word climbs back down            |
| word boundaries               | the points of the diamonds, so a long word weaves a wide diamond            |
| the whole note                | mirrored, as coverlet drafts are, and treadled *tromp as writ* (square motif) |
| the first letter of each word | thrown in an accent weft: a stripe at each diamond's point                  |
| the author's name             | the twill (one of six tie-ups) and the yarn colours, so all your notes share a texture |
| an emoji-only note            | threaded from its code points                                               |

Every page of the book is **loom-ready**. A weaver could thread an 8-shaft loom
from any page and weave that guest's square. If they weave them all in order,
they get the coverlet on the cover. That is the surprise, and it could become a
real object: a blanket woven from the guestbook.

## Slots

### `background`: `coverlet` (registry effect)

Every note's square pieced into one blanket, oldest first, joined with a running
stitch. It is framed by a border woven from the couple's own names and date, and
a fringe hangs below. Slots not yet woven show bare warp, still on the loom, so
3 notes looks like a weaving in progress, not an empty page. At 300 notes it
becomes a dense, gorgeous quilt. Hovering a note lifts its square; tapping a
square jumps to its note.

### `card`: `swatch` (CSS + a per-entry ornament)

A pinking-sheared fabric sample of the note's own cloth, with the letters it
was threaded from written underneath ("CALL·YOUR·MOTHER·BOTH"). On a phone it
sits at the card's right edge. From 1100px up it is pinned in the margin beside
its note with a pearl-headed pin, at a small deterministic tilt. When a swatch
scrolls into view it weaves in pick by pick: a stepped `clip-path` reveal.

### `book`: `pattern-book` (stylesheet + `decorate(root)`)

- **Cover:** the whole coverlet with a cartouche.
- **Key:** "How a note becomes cloth", one real draft annotated: threading,
  tie-up, treadling, drawdown.
- **One draft per note**, two to a sheet. Each has the full draft with the
  letters under the threading, a swatch "as woven", and the spec ("8 shafts · 47
  ends · four-and-four twill · tromp as writ"), with the message beneath.
  Favorites come first; long notes get a full sheet.
- **Register of drafts:** a thumbnail swatch per guest. The colophon says the
  drafts are loom-ready.

### `burst`: `shuttle`

Signing adds a new square to the coverlet, which weaves in pick by pick.

## Params (ControlHint shape)

| Slot              | Param          | Default   | Hint                                               | Mechanism                         |
| ----------------- | -------------- | --------- | -------------------------------------------------- | --------------------------------- |
| all               | `palette`      | `"theme"` | `{ options: ["theme", "indigo", "madder", "undyed"] }` | `data-wv-palette`             |
| all               | `ends`         | `48`      | `{ min: 24, max: 80, step: 4 }`                    | generator option (motif scale)    |
| card / background | `weaveSeconds` | `2.2`     | `{ min: 0.4, max: 6, step: 0.2 }`                  | `--wv-weave`                      |
| card              | `showLetters`  | `true`    | boolean                                            | `data-wv-letters`                 |
| book              | `perSheet`     | `"2"`     | `{ options: ["1", "2"] }`                          | `decorate` pagination             |

`theme` takes the yarns from tokens (`--effect-brand`, `--fx-gold-1`,
`--fx-rose-3`, `--fx-cool-1`, `--fx-green-1`, `--fx-leaf-1`) and the warp from
`--color-card-bg`. So light mode is coloured wool on undyed cotton, and dark
mode is bright wool on a dark warp. `indigo`, `madder` and `undyed` are
historic coverlet dyes.

## Reduced motion, dark, print

- **Reduced motion:** every square is fully woven on arrival, with no reveal.
  Nothing else moves.
- **Dark:** it holds up well. The drafts' drawdowns glow like a Jacquard punch
  card. The fringe and bare warp switch to a muted mix, so they don't vanish.
- **Print:** SVG only. Threads are shaded by a repeating gradient
  (`userSpaceOnUse`, period = one cell), and this prints correctly. The book
  forces light ink on white. Checked as a PDF: 20 pages for 32 notes.

## Cost to build properly

- `weave.js` generator + drawdown + draft renderer (≈280 lines, near-final).
- `coverlet.js` (≈120).
- Background effect + `fire()` (≈100), plus four registry entries.
- Swatch CSS (≈100), book stylesheet + `decorate` (≈300).
- Tests: determinism, plus "every float ≤ 4", so the cloth would actually hold
  together on a loom.

**About 2 days.** It's the cheapest of the three to make correct, because the
maths is fixed by a craft tradition.

## Risks and things to flag

- **The card slot needs one small contract change**, the same as the other
  sketches: an optional per-entry `ornament(entry)` hook. See the herbarium
  SKETCH.md.
- **Busy at small sizes.** A 68px swatch on a phone is texture rather than
  pattern. That's fine for a card; the coverlet and the book carry the detail.
- **Short notes repeat.** "Best. Wedding. Ever." loops its letters to fill 24
  ends, so short notes make small, tight motifs. That's honest, but they can
  look alike. The author's twill and yarn keep them apart.
- **PDF weight.** The drafts are many little squares: 7MB for 32 notes. Merging
  runs into rects would cut that a lot before 300-note books.
