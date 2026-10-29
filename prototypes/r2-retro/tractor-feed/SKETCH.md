# tractor-feed: dot-matrix by day, BBS by night

By day, the guestbook is a printout. Every entry is a chunk of green-bar continuous-form
paper torn off a dot-matrix printer: sprocket holes punched down both edges, perforated top
and bottom, and the record printed as a listing (`ENTRY #132  FROM: AUNTIE LOU  MAY 1,
2026`) in struck pins. The page opens with the printer housing and a Print Shop banner of
the couple's names.

By night, the same records sit on a phosphor-green **BBS** terminal ("J&J GUESTBOOK BBS
v1.0 · NODE 1 · 2400 BAUD") with scanlines and a rolling refresh bar. Signing prints a
receipt.

The memory book starts with a **Print Shop banner** of the names running sideways across
three pages, to tape end to end and hang up. After that comes the entire guestbook as a
green-bar listing on continuous form, with strips and bars on every sheet.

View: `node prototypes/serve.js` → `/r2-retro/tractor-feed/` and `/r2-retro/tractor-feed/book.html`
(`?theme=dark` for the BBS, `?banner=0..6`, `?n=3|300`, `?fire=1`, `?bar=0`).

All art is made here, including a **5×7 dot-matrix font** drawn for this sketch
(`font57.js`: A–Z, 0–9, `& ♥ ' . , - ! ? : / # *`). It is rendered as SVG circles,
double-struck. Body text is Courier with a **dot-grid mask**, which turns each glyph into
struck pins while staying real, selectable, accessible text.

## Slots filled

### background: `fanfold-feed` (`fanfold-feed.js`, `background.css`)

By day, two endless streams of continuous form feed slowly down past the page edges,
folding at every 11in perforation. They show only on wide screens. By night the whole page
is a CRT: scanlines, a vignette and a slow refresh bar.

| param       | ControlHint                                         | default  |
| ----------- | --------------------------------------------------- | -------- |
| `streams`   | `{ options: ["both", "left", "right", "none"] }`    | `"both"` |
| `speed`     | `{ min: 0, max: 12, step: 1 }` (lines per second)   | `4`      |
| `scanlines` | `{ min: 0, max: 100, step: 5 }` (dark only)         | `50`     |

### burst: `print-head` (`print-head.js`, `burst.css`)

A greenbar receipt feeds out of a slot at the top of the screen while the print head
chatters across it. It prints `THANK YOU, PALOMA ♥` in the dot font, one character-step at
a time, then `*** ENTRY SAVED ***`, and then the strip is torn off and drops. The optional
sound is one square-wave buzz per character through a band-pass.

| param   | ControlHint                    | default |
| ------- | ------------------------------ | ------- |
| `cps`   | `{ min: 4, max: 40, step: 1 }` | `14` (characters per second) |
| `tear`  | boolean                        | `true`  |
| `sound` | boolean                        | `false` |

### card: `tractor-feed` (`card.css`)

Real `feed.js` markup. The `====` and `----` rules, `ENTRY #` and `FROM:` are generated
content. Everything sits on a line grid, so the text lands on the green bars (three lines on,
three off). The sprocket holes are **punched with a CSS mask** on a `::before`, so you see
whatever background is behind them, and the drop shadow follows the holes. Ribbon wear
varies by entry id. Controls print as `[ ♥ 4 ]  [ 1 REPLY ]  [ SHARE ]`, with 40px-tall
targets. In dark mode the chunk becomes a rounded phosphor terminal panel with glow and
scanlines. Favorites become a `*** FAVORITES ***` listing in a double-ruled box.

| param      | ControlHint / var                                       | default   |
| ---------- | ------------------------------------------------------- | --------- |
| `dot`      | `{ min: 0.5, max: 1.5, step: 0.05 }` → `--card-dot` (px; 1.5 = solid) | `0.72` |
| `line`     | `{ min: 18, max: 28, step: 1 }` → `--card-line` (px)    | `20`      |
| `phosphor` | colour → `--card-phosphor` (dark)                       | `#46ff7a` (try `#ffb000` for amber) |
| `bar`      | colour → `--card-bar`                                   | `#dcefd8` |
| (ink)      | colour → `--card-ink`                                   | `#23242b` |

### book: `banner-fanfold` (`book.css`, `banner-fanfold.js` = `decorate(root, ctx)`)

- **Banner:** the names are laid out in the 5×7 font, rotated so they read down the paper
  (glyph tops facing right, the way Print Shop fed a banner). The banner is drawn once, and
  each banner page is a `viewBox` window onto the same tall SVG, so the dots continue
  across the perforations. The letters are sized so the whole name fits the chosen number
  of pages.
- **Listing:** a header block (`GUESTBK.TXT`, names, place, record count), `*** FAVORITES
  ***`, then every entry as a record, ending in `*** END OF FILE *** 32 RECORDS *** THANK
  YOU FOR COMING ***`.
- **Print:** `@page { size: letter; margin: 0 }`. The sprocket strips, perforations and
  green bars are `position: fixed`, which Chrome repeats on every sheet. The listing's
  per-page top and bottom margins come from `box-decoration-break: clone`, so the strips
  run edge to edge. Text is 10pt on 12pt (6 lines per inch), three lines to a 0.5in bar,
  as on real green-bar.

| param         | ControlHint / mechanism                               | default |
| ------------- | ----------------------------------------------------- | ------- |
| `bannerPages` | `{ min: 0, max: 6, step: 1 }` (0 = no banner; rebuilds) | `3` |
| `bar`         | colour → `--mb-bar`                                   | `#dcefd8` |
| `ink`         | colour → `--mb-ink`                                   | `#202128` |
| `dot`         | `{ min: 0.5, max: 1.5, step: 0.05 }` → `--mb-dot` (screen only) | `0.75` |

## Reduced motion, dark, print

- **Reduced motion:** the paper streams stop and the CRT stops rolling. The burst's receipt
  just appears fully printed (no feed, no head, no tear) and fades after about two seconds.
  A new record doesn't feed in. No sound.
- **Dark:** the guestbook becomes the BBS: phosphor text with glow, terminal panels, a CRT
  page. The book stays paper (it is a printout) on a dark desk.
- **Print:** checked as real PDFs. 32 entries print as 3 banner pages plus 4 listing pages.
  The dot mask is switched off in print so the type stays crisp, and the banner carries the
  dot-matrix look on paper. Strips and bars use `print-color-adjust: exact`.

## Build cost and risks

- **Files:** `fanfold-feed.js` (~60 lines) and `print-head.js` (~130) become registry
  effects. `font57.js` (~110), `card.css` (~430), `book.css` (~470) and
  `banner-fanfold.js` (~120). The printer housing and BBS composer are furniture; see the
  furniture note in `../guestbook-cgi/SKETCH.md`.
- **Risk: the dot mask at 1× DPR.** A 2px dot-grid mask reads beautifully on retina and a
  little grey on 1× screens. The `dot` param tunes it, and 1.5 turns it off.
- **Risk: fixed elements and `box-decoration-break: clone` in print.** Both work in
  current Chrome (verified). Safari and Firefox repeat fixed elements per page too, but
  their `clone` support for block fragmentation should be checked before shipping. The
  fallback is page margins with strips that stop short of the top and bottom edge.
- The banner font covers Latin capitals, digits and common punctuation. Accented names
  print their base letter's box glyph today. Adding the accents is a few more 5×7 arrays,
  for example `É`, `Ñ`, `Ø`.
- Emoji in messages print as colour emoji in the listing (e.g. Ezra's ❤️), which is a cute
  anachronism. They could be mapped to `<3`-style text if the owner prefers purity.
