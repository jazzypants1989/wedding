# Player Piano: the guestbook as a punched roll, the book as a score

**View:** `node prototypes/serve.js` → `/r2-sound-time/player-piano/` (guestbook) and
`/r2-sound-time/player-piano/book.html` (memory book). Review params: `?n=3|300`,
`?theme=dark`, `?motion=reduce`, `?scale=pentatonic`, `?tempo=0.12`, `?trackerY=50`.

## The idea

Every signer's **name is spelled in notes**. It uses the old French musical-cryptogram
trick: the letters run A to G and then wrap, so H is A, I is B, O is A again. That means
every name is a phrase on the white keys. Note _k_ takes its length from word _k_ of the
message, so short words are quick and long words linger. Hearts end the phrase on a chord,
and a pinned favourite rings a bell an octave up. It is fully deterministic
(`shared/motif.js`, 10 unit checks in `shared/motif.test.js`).

- **Guestbook:** each entry carries its own strip of punched roll, and the strips butt
  together into one continuous roll down the left of the page. The letters of the name are
  printed down the margin like an old word-roll. A brass **tracker bar** is fixed in the
  viewport, so **your scroll is the crank**. Holes light up as they pass the bar, the
  matching tine on the bar glows, and the **letters of the name light up one by one as
  they are "sung"**. Scroll slowly and it is a lullaby. Flick and it is a glissando. Scroll
  back up and the tunes play backwards. The card rides the bar (sticky) while its tune
  plays. `⟳ Crank` auto-scrolls at the written tempo.
- **Composer (burst):** type your name and the leader strip punches a hole per letter (with
  a punch click and that letter's note if sound is on). You hear your name before you sign.
- **Memory book, "the score":** every guest is engraved as a line of real sheet music
  (drawn treble clef, stems, flags, dots, ledger lines, chords, double bar), with **the
  letters of their name as the lyrics** and their message underneath. The cover band is the
  whole guestbook's roll turned sideways, and there is a how-to-play page with the
  letter→note key. Anyone can sit at a piano and play the guestbook with one finger.

## Slots and params (ControlHint shapes)

| Slot         | id        | Param          | Hint                                       | Default               |
| ------------ | --------- | -------------- | ------------------------------------------ | --------------------- |
| `card`       | `roll`    | `unit` (px per eighth) → `--card-unit` | `{min: 6, max: 16, step: 1}`  | `10` (8 phone)        |
|              |           | `paper` → `--card-paper` | colour                           | card-bg mixed 12% `--fx-gold-3` |
|              |           | `hole` → `--card-hole`   | colour                           | `light-dark(#33261f, #07050b)` |
|              |           | `scale`        | `{options: ["cryptogram", "pentatonic"]}`  | `"cryptogram"`        |
| `background` | `tracker` | `trackerY` (% of viewport) → `--bg-tracker-y` | `{min: 25, max: 60, step: 1}` | `42` |
|              |           | `tempo` (s per eighth) | `{min: 0.08, max: 0.4, step: 0.01}` | `0.16`                |
| `burst`      | `punch`   | (none; `fire({ name, message })`) |                         |                       |
| `book`       | `score`   | `ink` → `--mb-ink`           | colour                       | `var(--color-text)`   |
|              |           | `rubric` → `--mb-rubric`     | colour                       | `var(--color-primary-dark)` |
|              |           | `staffSize` → `--mb-staff-size` | `{min: 0.7, max: 1.4, step: 0.05}` | `1`            |
|              |           | `order`        | `{options: ["signed", "alphabetical"]}`    | `"signed"`            |
|              |           | `coverBand`    | `{options: ["roll", "none"]}`              | `"roll"`              |

## Behaviour

- **Sound:** synthesised WebAudio only (`shared/musicbox.js`). It is a struck steel tine
  with inharmonic partials (6.27×, 17.5×), a 4 ms pin "tick", and a small procedural room
  using the sound-lab's buildImpulse approach. There is a polyphony guard (six voices per
  50 ms) so a fast flick can't pile up, and a jump of more than 1.5 viewports is treated as
  a teleport, not a glissando. **Muted by default.** No AudioContext exists until you
  press `♪ Sound`, a `▶ Play` button, or `⟳ Crank`.
- **Reduced motion:** sound, crank and Play buttons are off, with a one-line note. The
  holes and letters still light statically as the bar passes (no glow, no transitions).
  The punch animation is off. The roll is the design either way.
- **Dark:** all colours are tokens. The paper is card-bg tinted, the holes go near-black,
  and the brass has a light-dark pair. Checked at 390 and 1280 wide.
- **Print:** the book is SVG + CSS only. The cover gets its own page and so does the how-to
  page. Favourites are an "Overture" section, then "The book" starts on a new page. No
  staff ever splits across a page break. Checked in a real Chrome PDF.
- **3 / 300 entries:** both render (300 → ~5,700 beats, about 15 min of music). The cover
  band wraps the roll into rows, so it fills the band at any count.
- **Accessibility:** the text is real text. The roll SVG is `aria-hidden`. Each name is
  given to screen readers whole (the per-letter spans are `aria-hidden`), followed by
  "spelled in notes: A G G F…". The book staves are `role="img"` with the note names as
  the label. The feed is a `role="feed"` of articles.

## Build cost and risks

- **Files:** `motif.js` (~180 lines, pure, tested), `musicbox.js` (~230), `card` CSS (~300)
  plus a per-entry SVG decorator (~120), `tracker` background effect with
  `start/stop` (~200), `score` book CSS (~250) plus `decorate(root)` (~220). About 1.5k
  lines, and the motif and synth are shared with The Stair.
- **Contract stretch:** a `card` here needs **a per-entry decorate hook** to inject the roll
  SVG. The contract currently has `decorate` only for `book`. Recommend the card registry
  gets an optional `decorate(entryEl, entry)` too.
- **Composability:** as sketched, `tracker` reads hole positions from the `roll` strips. To
  work with _any_ card it should fall back to spreading the motif over the article's own
  height (about 20 lines). Not done in the sketch.
- **Phone width:** the roll takes ~110px of a 390px screen. It reads well in screenshots
  but is worth feeling on a real phone.
- **Music:** cryptogram tunes are diatonic and pleasant, but some names repeat a note
  ("Ezra" is E E D A). `pentatonic` is the "always pretty" escape hatch. A name with no
  Latin letters gets a deterministic code-point tune (tested), but its margin letters are
  then not a readable cryptogram.
- **Audio on iOS:** needs the context resumed inside the gesture. This is done, but it has
  not been heard on a device (I can't hear audio). The graph was reviewed by reading it.
