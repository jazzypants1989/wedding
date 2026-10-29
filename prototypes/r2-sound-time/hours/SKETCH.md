# The Long Day: the guestbook on one 24-hour day, and a Book of Hours

**View:** `node prototypes/serve.js` → `/r2-sound-time/hours/` (guestbook) and
`/r2-sound-time/hours/book.html` (memory book). Preview any moment with
`?at=YYYY-MM-DDTHH:MM` or the **⏱ Time machine** in the toolbar, which has presets for the
wedding night, six months at dawn, the 1st (paper), 2nd (cotton), 5th (wood), 25th
(silver) and 50th (gold). Also: `?open=top`, `?n=3|300`, `?theme=dark`, `?motion=reduce`.

## The idea

The guestbook already knows **when** each note was written. This sketch makes that the
structure.

- **One day:** every entry is placed by the _minute of the day_ it was written, whatever
  the date. Midnight is at the top of the page and the next midnight at the bottom, so
  scrolling is a day passing: the 1:42 am "Best. Wedding. Ever." from the after-party, the
  9 am thank-yous, the long letter written at 3:36 am. Sticky hour numerals run down the
  margin, with the canonical hours (Matins, Lauds, Prime…) marking each three-hour block.
- **You are placed in it:** the page opens at **the visitor's own hour**, and a "Now · 9:40
  pm" thread sits between the guests who wrote at that hour.
- **Card `sundial`:** every card is lit by **the real sun over Portland at the minute it was
  written** (`shared/sun.js`, checked against Portland's known solar noon, sunrise and
  sunset). The page is treated as a flat sheet with north at the top, so a 6:30 pm note
  casts a long gold shadow to the east, a noon note a short one to the north, and a 3 am
  note casts no shadow at all and is lamplit instead. A tiny sundial (or moon) glyph in
  the corner says the same thing. It is deterministic per entry, so it prints the same.
- **Background `daylight`:** the sky behind the page is the sky of the hour you are
  reading. The sun or moon tracks across it as you scroll, from deep indigo at Matins
  through a dawn blush and a pale noon to a golden-hour orange.
- **Anniversaries:**
  - The **ink ages**: fresh in year one, browner each year (iron-gall ink really does
    oxidise), sepia by the silver anniversary, never below legible contrast.
  - The accent colour takes the **traditional anniversary material** (paper, cotton,
    leather, wood, tin, silver, gold…).
  - **On the anniversary itself** the notes write themselves in again as they scroll into
    view, and if someone wrote on this calendar day, within this hour, a year ago, the Now
    thread says so: _"One year ago tonight, within this hour, Marguerite Okafor wrote the
    note beside you."_ (Try `?at=2027-04-26T22:00`.)
- **Memory book, "A Book of Hours":** a medieval book of hours is prayers arranged by the
  time of day they are said. This book is the guestbook arranged the same way. The
  **cover clock** is a 24-hour dial with one tick per guest at the minute they wrote
  (length = message length, favourites dotted) and the canonical hours lettered round the
  rim on SVG text paths. A contents page lists each hour. Each hour is a chapter with a
  mini dial highlighting its sector, rubricated times in the margin, the sundial glyph and
  a drop capital. The edition line follows the print date: "Printed six months married,
  while the ink is fresh", or "The paper anniversary edition", with the rubric in that
  year's material.

## Slots and params (ControlHint shapes)

| Slot         | id         | Param                         | Hint                                     | Default |
| ------------ | ---------- | ----------------------------- | ---------------------------------------- | ------- |
| `card`       | `sundial`  | `shadowMax` (px)              | `{min: 0, max: 40, step: 2}`             | `26` (`shadowOf()` arg; not URL-wired) |
|              |            | `inkSepia` → `--card-ink-sepia` | colour                                 | `light-dark(#6e4b26, #dcc096)` |
|              |            | `lamp` → `--card-lamp`        | colour                                   | `#ffbf66` |
|              |            | `inkAges`                     | `{options: ["yes", "no"]}`               | `"yes"` (declared; sketch always ages) |
| `background` | `daylight` | `skyMix` → `--bg-sky-mix` (%) | `{min: 0, max: 100, step: 5}`            | `80` light / `60` dark |
|              |            | `follow`                      | `{options: ["scroll", "clock"]}`         | `"scroll"` (`clock` is what reduced motion does) |
| `book`       | `hours`    | `ink` → `--mb-ink`            | colour                                   | `var(--color-text)` |
|              |            | `rubric` → `--mb-rubric`      | colour (the material replaces it)        | `var(--color-primary-dark)` |
|              |            | `dropcap` → `--mb-dropcap` (lines) | `{min: 0, max: 4, step: 1}`         | `2`     |
|              |            | `edition`                     | `{options: ["auto", "none"]}`            | `"auto"` |

The venue (lat/long, zone) is a site constant, not a param.

## Behaviour

- **Reduced motion:** the sky is painted once for the visitor's own hour and does not move
  with the scroll (scroll-linked colour and position is a vestibular trigger). There is no
  write-in animation and the jump to "now" is instant. Shadows, lamplight, ageing ink and
  the material accent all stay: static is the design.
- **Dark:** sky stops are mixed with the theme background (`--bg-sky-mix`). After dark,
  text that sits directly on the sky flips to starlight. The material accent is lifted
  for dark backgrounds.
- **Print:** the guestbook view hides the sky. The book is SVG + CSS: the cover clock gets
  its own page, then contents, then one chapter per page with no entry split. Checked in a
  real Chrome PDF. Black ink, rubrics in red or in the anniversary material.
- **3 / 300 entries:** at 3, most hours are compact empty markers, so the day still reads
  as a day. At 300, every hour fills. Both render without errors.
- **Accessibility:** the DOM order is reading order (by time of day). Each hour is a
  labelled section ("3 am, 2 notes"). The cards carry an sr-only "written after dark, at
  lauds". The intro's "the hour it is now" link jumps to the Now thread. The book's clock is `role="img"` with a summary.

## Build cost and risks

- **Files:** `sun.js` (~130, pure, tested), `clock.js` (~100), card CSS (~150) plus a small
  per-entry decorator that writes the CSS vars, the `daylight` effect (~150), the `hours`
  book CSS (~300) plus `decorate` (~200). About 1.1k lines.
- **Contract stretch (important):** "one day" is **not a card or a background**. It is a
  _feed arrangement_ (ordering + grouping). The same is true of The Stair. If the owner
  likes either, the contract probably wants a fifth slot, something like
  `arrangement: chronological | by-hour | stair`.
- **Pagination:** the live feed pages 50 at a time, newest first. Ordering by time of day
  needs every entry, as the memory book already fetches. That is fine for a wedding-sized
  guestbook, but it is a different fetch from the current feed.
- **Timezones:** the fixture stores wall-clock times. Real rows are presumably UTC, so
  they need converting to the venue's zone (`Intl.DateTimeFormat` with
  `America/Los_Angeles`) before the sun is computed. The sketch ignores the equation of
  time (±16 min), which is invisible in a shadow.
- **The sundial card works on its own:** it composes with a normal chronological feed (each
  card still shows its own light), so it can be picked without the one-day arrangement.
