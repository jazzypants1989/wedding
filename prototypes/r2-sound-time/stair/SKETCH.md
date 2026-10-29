# The Stair: notes hung round a spiral, and the spiral of every name

**View:** `node prototypes/serve.js` → `/r2-sound-time/stair/` (guestbook) and
`/r2-sound-time/stair/book.html` (memory book). Review params: `?flat=1`, `?perTurn=9`,
`?rise=100`, `?n=3|300`, `?theme=dark`, `?motion=reduce`.

## The idea

- **Guestbook:** the notes are **hung on threads around a spiral stair** in real CSS 3D:
  one `preserve-3d` list, each note rotated round a central newel post and dropped a
  little lower than the last. Scrolling turns the helix and walks you down it. The note in
  front is full size and flat to you, at the perspective plane, so its text is crisp. The
  others turn away round the post and fade into the room. **The backs of the far notes
  show the signer's name**, so across the stair you see a scatter of names, and they turn
  into messages as they come round. Each note swings very slightly on its thread, each on
  its own beat. A `1 / 32` counter sits at the foot.
- **Sound (optional):** as a note turns to face you, its music-box tune (the same
  name-cryptogram as Player Piano) plays from the side it arrived from, through an HRTF
  panner.
- **Flat:** under reduced motion, in print, or with the `☰ Flat` toggle, the stair is drawn
  as **the same spiral seen from the side**: a gentle zig-zag of notes on one continuous
  thread. It is a design state, not a fallback list.
- **Memory book, "the spiral":** seen from above, the helix is a spiral. The frontispiece
  sets **every signer's name along one continuous Archimedean spiral** of SVG text, with
  the first to sign at the centre around the couple's monogram, the last on the outside
  edge, and favourites in red. The spiral is sized from the text and fitted exactly with
  `textLength`, so it closes cleanly at 3 names or 300 (checked: at 300 it becomes a dense
  disc of names, like a record). Then every note in signing order, numbered, each with a
  tiny copy of the spiral marking where its writer sits on the big one.

## Slots and params (ControlHint shapes)

| Slot         | id       | Param                         | Hint                                    | Default |
| ------------ | -------- | ----------------------------- | --------------------------------------- | ------- |
| `card`       | `hung`   | `width` → `--card-w` (rem)    | `{min: 12, max: 24, step: 1}`           | `19` (15 phone) |
|              |          | `thread` → `--card-thread`    | colour                                  | text at 38% |
|              |          | `swing` → `--card-swing` (deg) | `{min: 0, max: 4, step: 0.5}`          | `1.2`   |
| `background` | `stair`  | `perTurn`                     | `{min: 4, max: 14, step: 1}`            | `7` (5 phone) |
|              |          | `rise` (px per note)          | `{min: 20, max: 160, step: 10}`         | `70`    |
|              |          | `depth` → `--bg-depth` (px)   | `{min: 600, max: 2400, step: 100}`      | `1100` (800 phone) |
| `book`       | `spiral` | `ink` → `--mb-ink`            | colour                                  | `var(--color-text)` |
|              |          | `rubric` → `--mb-rubric`      | colour                                  | `var(--color-primary-dark)` |
|              |          | `columns` → `--mb-columns`    | `{min: 1, max: 3, step: 1}`             | `2`     |

The `hung` card works without the stair: in any flat feed it is a note on a thread.

## Behaviour

- **Reduced motion:** always flat, no swing, no smooth scrolling, sound off, with a
  one-line note. The flat toggle is disabled (it is already flat).
- **Dark:** tokens throughout. The post is a gradient mixed from text and background; the
  backs of the notes are card-bg mixed toward text. Checked on a 390px phone and at 1280.
- **Print:** the guestbook view prints flat. The book is SVG + CSS: the cover and spiral
  together on page 1, then the notes in two columns with no note split. Checked in a real
  Chrome PDF at 32 and 300 entries.
- **Keyboard and screen readers:** it is an ordered list of articles in reading order
  (`aria-posinset`/`setsize`). **Tab** to a note and the stair turns to it; **↓ / ↑** step
  one note at a time. The 3D is transforms only, so nothing is hidden from the
  accessibility tree (far notes go transparent, not `visibility: hidden`). The book's
  spiral is `role="img"` labelled with every name in order.
- **3 / 300 entries:** both render. Only notes within about 1.6 turns of the front get
  transforms each frame; the rest are parked transparent.

## Build cost and risks

- **Files:** `hung` card CSS (~200), the `stair` layout module (~250 JS + ~150 CSS),
  `spiral` book (~170 JS + ~180 CSS). It reuses `motif.js` and `musicbox.js` from Player
  Piano. About 1k lines.
- **Contract stretch:** like The Long Day, the stair is really a **feed arrangement**, not
  a `background`: it takes over the feed's geometry and the page's scroll (a tall spacer
  plus a sticky stage). It needs the arrangement slot suggested there, and a decision
  about where the composer and "load more" live (the sketch assumes all entries are
  loaded).
- **3D gotchas found while building:** `opacity` on a `preserve-3d` element flattens its
  children and silently breaks `backface-visibility`. The faces read `--hx-op` instead.
  `will-change: transform` on the helix made the front note's text rasterise soft, so it
  was removed. On a 3× phone the front note is still very slightly softer than flat text.
  Safari's preserve-3d has its own quirks and has **not been checked** (headless Chrome
  only).
- **Motion sensitivity:** a rotating scene tied to scroll is the most vestibular-heavy
  idea in this round. Reduced motion handles the OS setting, but some people without it
  set will still find it a lot. The flat toggle is one tap away.
