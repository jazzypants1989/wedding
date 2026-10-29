# guestbook.cgi: a 1999 homepage guestbook

The front page is polished and romantic, so this page goes the other way on purpose: a
personal homepage from 1999, made with real care. It has pixel-heart wallpaper, WordArt
arched over the couple's names, a marquee, "This marriage is UNDER CONSTRUCTION, completion
date: never", a hit counter that counts signatures, a webring that links the site's own
pages, 88×31 badges ("Y2K COMPLIANT", "best viewed w/ tissues") and `canon_in_d.mid`,
synthesised. Every guest entry is the bordered table guestbook.cgi printed out. The memory
book is that page **printed from Netscape Navigator**, with the browser's header and
footer on every sheet.

View: `node prototypes/serve.js` → `/r2-retro/guestbook-cgi/` and `/r2-retro/guestbook-cgi/book.html`.
Extras: `?palette=netscape|angelfire`, `?theme=dark`, `?n=3|300`, `?fire=1`, `?bar=0`.

Every image is drawn in code: pixel sprites (`sprites.js`, `shared/pixels.js`), CSS badges,
CSS gradients and SVG WordArt. Nothing is vendored. The fonts are system fonts (Times,
Verdana, Impact, Comic Sans on the marquee), which was the 1999 web anyway.

## Slots filled

### background: `tiled-1999` (`tiled-1999.js`, `background.css`)

A wallpaper.gif tile drawn as SVG and coloured from theme tokens. A data URI can't use
`var()`, so the colours are resolved through a probe element, and a MutationObserver
re-resolves them when the theme changes. A handful of pixel sparkles twinkle in four
hard frames, the way a GIF does it.

| param      | ControlHint                                                   | default  |
| ---------- | ------------------------------------------------------------- | -------- |
| `tile`     | `{ options: ["auto", "hearts", "stars", "lace", "checker"] }` | `"auto"` (hearts by day, stars by night) |
| `scale`    | `{ min: 1, max: 5, step: 1 }`                                  | `3` (screen px per art pixel) |
| `twinkle`  | `{ min: 0, max: 40, step: 1 }`                                 | `14` sparkles |
| `contrast` | `{ min: 10, max: 70, step: 5 }`                                | `30` (% primary mixed into the background) |

### burst: `thanks-for-signing` (`thanks-burst.js`, `burst.css`)

`fire({ name, id })` opens a small grey window, "guestbook.cgi: Thank you for signing my
guestbook!!". A pixel envelope spins in it (squashed in X, frame by frame, like a GIF)
while pixel hearts fly out. The window stays until it is dismissed (focus moves to its
button and Esc closes it), because it is the confirmation, not decoration. An optional
SoundBlaster-style square-wave arpeggio plays with it.

| param    | ControlHint                    | default |
| -------- | ------------------------------ | ------- |
| `hearts` | `{ min: 0, max: 24, step: 1 }` | `12`    |
| `sound`  | boolean                        | `false` |

### card: `guestbook-cgi` (`card.css`)

This uses the real `feed.js` markup without changes. The header is `display: contents`,
and the labels "Name:", "Date:" and "Comments:" plus the "Entry #132" title bar are all
generated content (`attr(data-id)`) placed on a grid. The three newest entries get a
blinking **NEW!**. The monogram becomes a 16px bevelled avatar.gif that keeps its hue
bucket. Reactions and Share become Win95 push buttons. Favorites become "★ HOT ★
FAVORITES".

| param        | ControlHint / mechanism                                         | default |
| ------------ | --------------------------------------------------------------- | ------- |
| `palette`    | `{ options: ["theme", "netscape", "angelfire"] }` → `data-cgi-palette` | `"theme"` (grey bevels tinted by tokens) |
| `font`       | `{ options: ["times", "verdana", "comic"] }` → `data-cgi-font`  | `"times"` |
| `bevel`      | `{ min: 1, max: 4, step: 1 }` → `--card-bevel`                  | `2` |
| `labelWidth` | `{ min: 4, max: 9, step: 0.5 }` → `--card-label-w` (em)         | `6.5` |
| (accent)     | `--card-accent`, `--card-cell`                                  | `var(--color-primary)`, `var(--color-card-bg)` |

### book: `netscape-printout` (`book.css`, `netscape-printout.js` = `decorate(root, ctx)`)

- **On screen** it is a print-preview window: title bar, File/Edit/View menu, big toolbar
  buttons (the page's real Back link and Print button are restyled, and the rest are
  inert), a Location bar with a GeoCities URL, a throbber with a comet, and a teal Win95
  desktop.
- **In print** the margin text is what Navigator put on paper. Title top-left, "Page 2 of
  7" top-right, the URL bottom-left and the date bottom-right, all from **CSS `@page`
  margin boxes**. The strings go in through a constructed stylesheet (CSSOM), not a
  `<style>` tag. Background fills drop out, the way Navigator printed with "background
  images" off, so the entry tables keep their borders and print clean. The homepage header
  (WordArt, under construction, the counter) is simply the top of page 1, and the webring
  and badges close the last page.

| param        | ControlHint / mechanism                                   | default |
| ------------ | --------------------------------------------------------- | ------- |
| `desktop`    | `{ options: ["teal", "theme"] }` → `data-np-desktop`      | `"teal"` |
| `printLinks` | `{ options: ["blue", "ink"] }` → `data-np-links`          | `"blue"` |
| `entryGap`   | `{ min: 4, max: 24, step: 2 }` → `--mb-gap` (pt)          | `10` |

## Reduced motion, dark, print

- **Reduced motion:** every "GIF" holds a frame (sparkles at mid-twinkle, hearts and the
  digging worker still, the rainbow rule stops). The marquee becomes a centred banner that
  wraps. NEW! stays lit without blinking. The burst window appears without its opening
  animation and the hearts freeze part-way out of the envelope. Sound (MIDI and jingle) is
  refused: the play button is disabled with "sound is off (reduced motion)".
- **Dark:** the tile switches to a starfield. The "theme" palette re-tints through
  `light-dark()` tokens. `netscape` dark is the classic black page with lime links and
  navy cells. The book's paper dims slightly and the desktop goes dark teal.
- **Print:** checked as real PDFs from headless Chrome (7 letter pages for 32 entries).
  The margin boxes need Chrome 131+ or a recent Safari/Firefox. Older engines simply omit
  the header and footer.

## Build cost and risks

- **Files:** about 6 new files. `tiled-1999.js` (~150 lines) and `thanks-burst.js` (~120)
  go into the effect registry (registry, config, schema and control-meta entries).
  `card.css` (~400) and `book.css` (~550) go under the card/book sibling registry, plus
  `netscape-printout.js` (~130), `sprites.js`/`pixels.js` (~150) and `wordart.js` (~40).
  `midi.js` (~130) only if the music is kept.
- **Furniture is the open question.** The marquee, WordArt header, under-construction
  strip, counter, webring, badges and MIDI player don't fit any of the four slots. They are
  page chrome that the card and background can't own. Options: (a) a fifth, optional
  `furniture` slot per page (a set of decorative blocks in fixed spots: header, before the
  feed, footer); (b) fold them into the `background` effect as a fixed overlay, which
  breaks for the webring links and the counter's real number; (c) drop them. I'd argue for
  (a), because the same question comes up for the zine masthead and the printer housing.
- **Options params as data attributes.** The contract says CSS params are custom
  properties, but an `options` param (palette, font) has to switch whole rule sets. Two
  routes: `@container style(--card-palette: netscape)` (Chrome/Safari only today) or the
  slot registry renders an options param as `data-<piece>-<param>`. The sketch uses data
  attributes.
- `data-gb-card` sits on `.gb-section` as well as `#gb-feed`, so the Favorites strip (a
  sibling of the feed) can be styled. That is worth adopting in the contract.
- The memory book entries carry `data-id` here (see `shared/kit.js`). That is a
  one-attribute upstream change, and it is what makes book pieces deterministic per entry.
- The GeoCities URL is a joke string. Swap in the real domain if a dead brand name is
  unwelcome.
