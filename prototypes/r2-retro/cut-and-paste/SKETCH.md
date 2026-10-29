# cut-and-paste: a photocopied zine

A riot-grrrl / punk zine, cut out and glued down. The page is a photocopy, with toner
speckle, the dark smear where the lid didn't close and a couple of drum streaks. The
headings are ransom notes, every letter cut from a different magazine. Each entry is a
clipping: typewritten on white bond, torn from a spiral notebook, stapled newsprint, graph
paper with the first line highlighted, a black photocopy, or pink construction paper. Each
one is signed in marker, rubber-stamped with its date and has a doodle in the margin.
Signing runs the page through the copier.

The memory book is **a real zine**. It is paginated by measuring the content, padded to a
multiple of four and imposed for saddle-stitch. You print it double-sided, fold the stack,
staple the spine, and the pages come out in order.

View: `node prototypes/serve.js` → `/r2-retro/cut-and-paste/` and `/r2-retro/cut-and-paste/book.html`
(`?print=pages`, `?paper=a4`, `?n=3|300`, `?theme=dark`, `?fire=1`, `?bar=0`).

All art is made here. Doodles are hand-drawn SVG paths used as CSS masks
(`doodles.css`), so token colours paint them. Paper textures are CSS gradients and SVG
`feTurbulence`. Fonts are system fonts: Courier for the typewriter, and Marker Felt /
Segoe Print / Comic Sans as the marker fallback chain.

## Slots filled

### background: `xerox` (`xerox.js`, `background.css`)

SVG noise is thresholded so only its peaks print as toner dots, and a low-frequency layer
adds blotchiness. Streaks and the lid shadow are gradients. In dark mode it is a
**negative copy**: black stock with white toner. Nothing moves.

| param      | ControlHint                     | default |
| ---------- | ------------------------------- | ------- |
| `grain`    | `{ min: 0, max: 100, step: 5 }` | `40`    |
| `streaks`  | `{ min: 0, max: 5, step: 1 }`   | `2`     |
| `lid`      | `{ min: 0, max: 100, step: 5 }` | `45`    |
| `negative` | boolean (invert in dark mode)   | `true`  |

### burst: `photocopy` (`photocopy-burst.js`, `burst.css`)

A green-white scan lamp sweeps down the screen, then a worn rubber stamp thumps down:
**RECEIVED, thank you, Paloma ♥**. It draws only its own overlay. The optional sound is
the copier whirr (band-passed noise) plus the stamp's ka-chunk.

| param   | ControlHint                                                 | default      |
| ------- | ----------------------------------------------------------- | ------------ |
| `sweep` | `{ min: 0.4, max: 3, step: 0.1 }` (seconds)                 | `1.1`        |
| `stamp` | `{ options: ["RECEIVED", "SIGNED", "COPIED", "XOXO"] }`     | `"RECEIVED"` |
| `sound` | boolean                                                     | `false`      |

### card: `clipping` (`card.css`, needs `doodles.css`)

Real `feed.js` markup. **Deterministic per entry with no JS**: the paper, the cut edge, the
tilt, the doodle and the highlighter are all keyed off the last digit of `data-id`
(`[data-id$="7"]`), so the same entry gets the same clipping on every visit and in print.
The paper sits on a `::before` with a scissor-cut `clip-path`, so the drop shadow follows
the cut. Share reads "pass it on →" (its aria-label is untouched). Favorites get a Dymo
label and a marker loop. The feed is a CSS multi-column collage, one column on a phone.

| param    | ControlHint / var                                        | default |
| -------- | -------------------------------------------------------- | ------- |
| `marker` | colour → `--card-marker`                                 | primary darkened to stay ≥4.5:1 on paper |
| `tilt`   | `{ min: 0, max: 2.5, step: 0.25 }` → `--card-tilt`        | `1` (0 = everything straight) |
| `type`   | `{ min: 0.85, max: 1.3, step: 0.05 }` → `--card-type` (rem) | `1` |
| `cols`   | `{ min: 14, max: 40, step: 1 }` → `--card-cols` (rem)     | `19` |

### book: `zine-a5` (`book.css`, `zine-a5.js` = `decorate(root, ctx)` + `howTo()`)

- **Pages:** cover (ransom "OUR GUEST BOOK", issue #1, a marker heart, the count), "hello!"
  (a note from the couple and a contents list with real page numbers), "the good stuff"
  (Favorites), "letters", "notes" pages to pad to a multiple of four, and a back cover
  ("the end (the beginning, really)", colophon, "staple here").
- **Pagination by measurement.** Each `.mb-entry` is moved into a real page-sized box and
  bumped to a new page when it overflows. Long letters span the page, one-liners sit two to
  a row and a lone emoji is a scrap. The measured layout is the printed layout, because both
  use the same CSS mm/in.
- **Imposition.** An aria-hidden copy is laid out as printed sides: `[N, 1] [2, N−1]
  [N−2, 3] …`, landscape, with a dashed fold line, fold ticks and staple marks on the outer
  sheet. Named `@page` rules size each mode.
- **Screen:** spreads on a green cutting mat (cover alone on the right), a "how to make it"
  slip with mode and paper switches, and zoom-to-fit on a phone.

| param   | ControlHint / mechanism                                   | default |
| ------- | --------------------------------------------------------- | ------- |
| `paper` | `{ options: ["letter", "a4"] }` → `data-zine-paper` (re-paginates) | `"letter"` (5.5×8.5in pages) |
| `print` | `{ options: ["booklet", "pages"] }` → `data-zine-mode`    | `"booklet"` |
| `tilt`  | `{ min: 0, max: 2.5, step: 0.25 }` → `--mb-tilt`          | `1` |
| `toner` | `{ min: 0, max: 1, step: 0.1 }` → `--mb-toner`            | `1` |

## Reduced motion, dark, print

- **Reduced motion:** the background never moves. The burst has no scan sweep and no
  thump: the stamp just appears for about two seconds, then fades. A fresh entry doesn't
  slap in. No sound.
- **Dark:** the page becomes a negative photocopy. Clippings stay paper (dimmed a touch),
  so it reads as cut paper on black card. The marker colour is computed to keep contrast on
  paper in both modes. The book's cutting mat darkens and the pages stay paper.
- **Print:** checked as real PDFs. 32 entries → 8 pages → 2 sheets (4 sides). 300 entries →
  40 pages → 10 sheets. 3 entries → 4 pages. Single A5 pages work too. Clipping papers and
  ransom letters use `print-color-adjust: exact`. Without it they would print as bare text,
  which is still legible.

## Build cost and risks

- **Files:** `xerox.js` (~110 lines) and `photocopy-burst.js` (~130) become registry
  effects. `card.css` (~520) and `doodles.css` (8 masks), `book.css` (~700) and
  `zine-a5.js` (~280), and `ransom.js`/`ransom.css` (~150). The ransom lettering is shared
  page furniture (masthead and section heads); see the furniture note in
  `../guestbook-cgi/SKETCH.md`.
- **Booklet printing is a user skill.** Duplex with "flip on short edge" is the only fiddly
  step, so the screen slip spells it out, and "single pages" is the safe fallback. 300
  entries make a 40-page zine (10 sheets), right at the edge of what a desk stapler goes
  through. Past that, the book should split into volumes (issue #1, #2…), which is easy to
  add to `decorate()`.
- Measured pagination needs the fonts loaded before `decorate()` runs. Courier is a system
  font, but a production version should `await document.fonts.ready`.
- The "hello" note speaks for the couple ("We didn't change a word"). It should be couple-
  editable copy, not hard-coded.
- The marker hand is a system font chain, so it varies by OS (great on Mac and Windows,
  `cursive` elsewhere). A drawn marker alphabet in SVG would make it consistent. That's
  doable, about a day.
- `data-id` on `.mb-entry` is the same one-attribute upstream change the other sketches
  need.
