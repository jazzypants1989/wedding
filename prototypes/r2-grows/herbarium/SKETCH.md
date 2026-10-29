# Herbarium: every note grows a plant from its grammar

`node prototypes/serve.js` → `/r2-grows/herbarium/` (guestbook) and
`/r2-grows/herbarium/book.html` (memory book). Add `?n=3`, `?n=300`, `?dark=1`,
`?motion=reduce`, `?theme=garden` to test the edges.

## The idea

The guestbook becomes a garden, and each guest plants something they didn't pick:
the plant grows out of how the note is written. The rule is short enough to
print in the book's endpaper, so guests can read their own plant:

| In the note                 | In the plant                                                    |
| --------------------------- | --------------------------------------------------------------- |
| each sentence               | a branch; the last sentence is the leading shoot                |
| each word                   | a leaf on that branch, longer for longer words                  |
| a comma                     | a pair of opposite leaves                                       |
| ends in `.`                 | a flower; the author's name picks the kind (star, umbel, bell, cup) |
| ends in `!` (`!!!`)         | a showy double blossom (three of them)                          |
| ends in `?`                 | a closed bud                                                    |
| ends in `…`                 | berries, still ripening                                         |
| no full stop                | a curled tendril, still unfurling                               |
| an emoji                    | a special flower: ❤️ heart petals, 🎉 an allium burst, 🥂 bellflowers |
| the author's name           | leaf shape, petal shape and count, the basal rosette            |
| signed after 9 pm           | the blossoms come out pale, as night flowers                    |
| 3+ heart reactions          | a butterfly visits                                              |
| a Favorite                  | gold-hearted blooms; the book stamps it TYPE SPECIMEN           |

It gets weird in the book. Every guest gets a mock-Latin binomial: genus from
their name, species from the most particular word in their note. So we get
*Junopsis thanksgivicola* (Grandma June), *Abernathyella sourdoughensis*,
*Devella lolifolia* ("lol the dog in the bow tie") and *Kenjina pyrotechnica*
(🎉🎉🎉). The binomials then become an **Index of Species**.

The composer grows **your** plant live as you type, which makes guests play
with punctuation. The seed is author + message (not the row id), so the plant
you preview is the plant you get.

## Slots

### `background`: `meadow` (registry effect)

Every plant in one bed, oldest at the back. Rows recede (smaller and paler), so
the garden visibly fills in over the week. On first arrival it grows row by row,
back to front, and then each plant sways on its own clock. Tapping a plant jumps
to its note, and hovering a note lights its plant. With fewer than 8 notes,
empty plots show seed markers ("room to grow") rather than a bare strip.

### `card`: `specimen` (CSS + a per-entry ornament)

Each card carries its own plant. On a phone it stands at the card's right edge,
rooted on the card's foot. From 1100px up, plants stand in the beds on either
side of the feed, alternating sides as you scroll down. The card markup is
unchanged; the ornament is one `aria-hidden` element positioned by CSS grid
or absolute positioning.

### `book`: `herbarium` (stylesheet + `decorate(root)`)

- **Cover:** a wreath of every plant, rooted on a ring.
- **Endpaper:** "How to read a specimen", with eight sample plants drawn by the
  same code from sample sentences.
- **One mounted sheet per note**, two to a sheet by default. Each sheet has the
  plant with linen mounting straps, a specimen label (herbarium name, No., the
  binomial, "Coll." author, date and place, field notes = the message), and a
  determination slip ("Det. 3 branches · 21 leaves · 2 flowers"). Favorites get
  a full sheet and a red TYPE stamp. Long notes (>220 chars) always get a full
  sheet.
- **Index of species:** alphabetical by binomial, with collector and page.

### `burst`: `seed` (optional, small)

In the sketch, signing adds the new plant to the front of the meadow. It grows
from nothing while the rest stay still, and the card's own plant grows as it
scrolls into view. A registry `fire(detail)` would do exactly that.

## Params (ControlHint shape)

| Slot          | Param         | Default   | Hint                                             | Mechanism             |
| ------------- | ------------- | --------- | ------------------------------------------------ | --------------------- |
| all           | `palette`     | `"theme"` | `{ options: ["theme", "pressed", "cyanotype"] }` | `data-hb-palette`     |
| background    | `sway`        | `1.5`     | `{ min: 0, max: 4, step: 0.25 }` (deg)           | `--hb-sway`           |
| background    | `growSeconds` | `2.4`     | `{ min: 0.6, max: 6, step: 0.2 }`                | `--hb-grow`           |
| all           | `leafScale`   | `1.25`    | `{ min: 0.6, max: 1.6, step: 0.05 }`             | generator option      |
| all           | `bloomScale`  | `1`       | `{ min: 0.6, max: 1.8, step: 0.05 }`             | generator option      |
| all           | `lean`        | `1`       | `{ min: 0, max: 2.5, step: 0.1 }`                | generator option      |
| book          | `perSheet`    | `"2"`     | `{ options: ["1", "2"] }`                        | `decorate` pagination |

`palette: "theme"` uses only tokens (`--color-text`, `--fx-green-*`,
`--fx-leaf-*`, `--effect-brand`, `--fx-gold-1`), so it follows all 10 effect
themes and light/dark. `pressed` is faded tea and rust, like a real herbarium
sheet. `cyanotype` draws white silhouettes on Prussian blue, a sun-print.

## Reduced motion, dark, print

- **Reduced motion:** every plant is fully grown and perfectly still. There is
  no growth, sway or meadow wave. It's still a whole garden.
- **Dark:** the token palette turns it into a night garden: pale ink, bright
  leaves and glowing blooms on plum. It looks good, maybe better than light.
- **Print:** SVG only, no canvas anywhere. The book forces `color-scheme: light`
  and white paper (unless a palette param is chosen), and growth and sway are
  pinned to their final state. Checked as a PDF: 21 Letter pages for 32 notes,
  with no sheet overflowing.

## Cost to build properly

- `public/effects/grown/plant.js`: the generator, pure (≈450 lines; this
  sketch's `plant.js` is close to shippable).
- Meadow background effect + `fire()` (≈150), plus its four registry entries
  (registry, config, schema bounds, control-meta).
- Card ornament CSS (≈120) and the book stylesheet and `decorate` (≈350).
- Unit tests: determinism (same entry → identical SVG string), no `Math.random`,
  every mapping in the table above.

**About 2–3 days.**

## Risks and things to flag

- **The card slot needs one small contract change.** DESIGN-SLOTS says a `card`
  is CSS only and "markup stays the same". A per-entry artwork needs one
  `aria-hidden` ornament element per card. That is an optional
  `ornament(entry) → svg` hook on the card registry. The rest of the markup is
  untouched, and the ornament positions itself.
- **Binomials can land wrong.** A name that folds badly, or an unlucky word,
  could read as a joke at someone's expense. It's deterministic, so the couple
  can preview every one. A per-entry override would be the fix if one is bad.
- **Weight.** 300 plants is fine (≈15k SVG nodes in the meadow). At several
  thousand notes the meadow should sample rather than draw everyone.
