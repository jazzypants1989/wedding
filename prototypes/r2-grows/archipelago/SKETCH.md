# Archipelago: every note raises an island

`node prototypes/serve.js` → `/r2-grows/archipelago/` (guestbook) and
`/r2-grows/archipelago/book.html` (memory book). Try `?n=3`, `?n=300`,
`?dark=1`, `?motion=reduce`.

## The idea

The guestbook is a sea chart. The couple's island sits in the middle, and every
note raises an island around it. Oldest notes sit nearest the couple, on a
phyllotaxis spiral. The cartography is real: a seeded height field, marching
squares contours, hypsometric tints and engraved water-lines. The names come out
of the guests' own words:

| In the note                     | On the chart                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- |
| how much was written            | island size: a word or two makes a Rock, a letter makes Highlands            |
| each sentence                   | a hill (anisotropic, rotated); a long sentence throws off a spur             |
| each emoji                      | a sea stack off the coast                                                    |
| the most particular word        | the summit's name ("Mt. Sourdough", "Mt. Thanksgiving", "Mt. Microphone")    |
| its length in characters        | the summit's height                                                          |
| the next most particular word   | an anchorage ("Coffee Inlet", "Feeding Sound")                               |
| the author                      | the island's name ("Isle of Simone", "Lou Key", "The Abernathy Highlands")   |
| mentions a lighthouse, or has no words | a lighthouse ("Ezra Light", the ❤️ note)                              |
| two notes share an uncommon word | a dashed ferry route between them, labelled with the word ("vows", "cake")  |
| a Favorite                      | a capital's star; the name in capitals                                       |

The book is an **atlas**. The guests become a gazetteer, and each note is
printed as that island's *sailing directions*.

## Slots

### `background`: `chart` (registry effect)

The general chart. It has a graticule with grid references (A–I, 1–5), a
16-point portolan compass placed in the emptiest corner with rhumb lines
radiating across the sea, "The Sea of Good Wishes", and a scale bar in "ten
words". Water-lines swell gently. Hovering a note lights its island, and
tapping an island jumps to its note. At 300 notes, labels drop to the bigger
islands and Favorites, and routes are capped at 40 and at a maximum length.

### `card`: `inset` (CSS + a per-entry ornament)

A framed inset chart of the note's island, with its name and summit underneath.
From 1100px up it sits in the right margin. On a phone it sits at the card's
right edge. The island rises out of the sea, tint by tint, as it scrolls into
view.

### `book`: `atlas` (stylesheet + `decorate(root)`)

- **Cover:** a cartouche over the general chart, portrait.
- **Legend:** the mapping above, plus four sample islands at one common scale,
  so size reads.
- **One plate per island**, two to a sheet. Each plate has a framed chart with
  soundings (read from the note's own letters) and a north arrow, "Plate 7 ·
  chart D3", the name, "Surveyed by …", the summit and anchorage, and the
  **sailing directions** (the message). Long notes get a full plate.
- **Gazetteer:** every island, summit and anchorage, alphabetical (ignoring
  "Mt.", "Isle of", "Little"), with its grid square on the general chart and its
  plate number.

### `burst`: `surfacing`

Signing raises a new island on the chart, which fades up tint by tint.

## Params (ControlHint shape)

| Slot              | Param       | Default   | Hint                                             | Mechanism             |
| ----------------- | ----------- | --------- | ------------------------------------------------ | --------------------- |
| all               | `palette`   | `"theme"` | `{ options: ["theme", "vellum", "admiralty"] }`  | `data-ar-palette`     |
| all               | `coastline` | `1`       | `{ min: 0, max: 2.5, step: 0.1 }` (ruggedness)   | generator option      |
| background / book | `routes`    | `true`    | boolean                                          | chart option          |
| background / book | `labels`    | `"all"`   | `{ options: ["all", "big", "none"] }`            | chart option          |
| book              | `perSheet`  | `"2"`     | `{ options: ["1", "2"] }`                        | `decorate` pagination |

`theme` builds everything from tokens: sea from `--fx-cool-1` over
`--color-card-bg`, land from `--fx-gold-3` and `--fx-leaf-*`, accents from
`--effect-brand`. `vellum` is an antique sepia chart. `admiralty` is a modern
nautical chart.

## Reduced motion, dark, print

- **Reduced motion:** islands are simply there, with no surfacing and no swell.
  The chart is a static engraving.
- **Dark:** a night chart, with pale ink on deep plum sea. Contours and tints
  stay legible.
- **Print:** SVG only. The book forces light ink on white. Checked as a PDF: 21
  pages for 32 notes, and the cover chart and plates print crisp.

## Cost to build properly

- `island.js`: height field + marching squares + naming (≈300 lines).
- `chart.js`: layout, relaxation, routes, furniture (≈250).
- Background effect + `fire()` (≈100), plus four registry entries.
- Inset CSS (≈100), atlas stylesheet + `decorate` (≈350).
- Tests: determinism, closed coast loops, layout stays in bounds, gazetteer
  refs match placement.

**About 3 days.** It's the most code of the three, and label collision
avoidance is where the time goes.

## Risks and things to flag

- **Label collisions.** The sketch only does island-vs-island relaxation, so
  labels can overlap a neighbour (visible at 32 notes in places). A proper
  greedy label placer is a day's work.
- **Layout is global.** Adding one note re-flows the spiral: islands keep their
  shape, but the chart shifts a little. That's acceptable (it is a living
  chart), but a printed book and the live page may differ if printed at
  different times.
- **Summit names can misfire**, like the herbarium's binomials ("Mt. Letting",
  "During Sound"). A small stoplist of weak words would help, plus the couple
  previewing the gazetteer.
- **The card slot needs the same small `ornament(entry)` contract addition** as
  the other two sketches.
- **Weight.** About 22KB of path data per island. That's fine at 32; at 300 the
  page carries a few MB of SVG. Lower the grid resolution for the overview
  chart (44 → 28) before shipping.
