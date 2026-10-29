# Design slots: the contract for guest-page design pieces

**Written 2026-10-29.** Status: **live**. This is the shape that every piece of
the guestbook and memory-book redesign (issues #11 and #13) has to fit. The
reason it exists:

- Design round 1 produced three good branches that **could not be combined**.
  Each rewrote `memory-book.css` wholesale, and two of them bypassed the effect
  registry, so neither the studio nor a mixer could see them.
- The owner wants guests and the couple to **mix and match**. That only works if
  every idea arrives as an interchangeable part, not as a page.

## The five slots

A page design is one choice per slot. Each slot has one job and one mechanism.

| Slot         | Job                                                                                       | Mechanism                                                                                                  | Pages                          |
| ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `background` | Ambient life behind the content: sky, garden, paper, pattern                              | A **registry effect** (`public/effects/registry.js`), started by the effect manager                         | guestbook (and others later)   |
| `burst`      | A response to a guest's action: signing, reacting, opening a note                         | A **registry effect** that exposes a `fire(detail)` method in addition to `start()`/`stop()`                | guestbook, gallery             |
| `card`       | How one guestbook entry looks: notecard, polaroid, letter, zine clipping, 1999 table row | **CSS keyed off `data-gb-card="<id>"`** on the feed container, plus an optional `ornament(entry)` hook (below) | guestbook, memory book         |
| `arrangement`| Where entries sit relative to each other: a feed, a 24-hour day, a spiral, a map         | A **layout function** `arrange(feedEl, entries)` that may reorder or position cards; markup and order in the DOM stay readable | guestbook, memory book         |
| `book`       | The memory book's whole layout: cover, chapters, pagination, index                        | **A stylesheet keyed off `data-mb-layout="<id>"`** on `<html>`, plus an optional `decorate(root)` JS hook   | memory book                    |

Rules that hold for every slot:

- **Every piece declares its params** in the `ControlHint` shape from
  `public/effects/types.d.ts` (`{min, max, step}`, `{options}`,
  `{kind: "glyphs"}`). That way `buildControl()` in
  `public/components/effect-controls.js` can make a control for each param, in
  the studio, in the admin and in the guest remix drawer, with no per-piece UI.
- **CSS pieces take their params as custom properties.** A `card` or `book`
  param `ink` is read as `var(--card-ink)` or `var(--mb-ink)`. It is set by a
  **CSSOM write** (`el.style.setProperty`), never by a `style=` attribute,
  which the CSP blocks (see `tests/unit/csp-inline-style.test.js`).
- **Pieces compose.** Any `background` must work with any `card`. A piece may
  not restyle another slot's elements, and a `card` may not assume a particular
  `background`.
- **Theme tokens first.** Use `var(--color-*)` from `public/styles/tokens.css`,
  so a piece works under all 10 themes and in light and dark mode. A piece may
  bring its own palette only as a param with a theme-token default.
- **Reduced motion** stills every animation and keeps the design. Static is a
  design state, not a blank page.
- **The book must print.** A `book` piece (and any `card` used in the book)
  renders in SVG or CSS. **Canvas does not print reliably**, so it is allowed on
  screen only, with an SVG/CSS print fallback. Check it in print preview, not
  only on screen.
- **Sound is opt-in and muted by default.** It is gated on reduced motion and
  never plays before a user gesture. Synthesised WebAudio
  (`public/pages/studio/sound-lab.js` is the precedent) needs nothing extra. A
  new sample must be CC0 and recorded in `SOUND-DECISION.md`.
- **Content-driven is fine and encouraged.** A piece may read the entries
  (text, author name, id, timestamp, favourite flag) to decide what it draws. It
  must be **deterministic per entry**, so the same entry looks the same on every
  visit and in print, and it must never call out to a network service.

## Where effects run: `pages`

A registry entry can be limited to certain pages:

```js
{ id: "disco", create: createDiscoBall, pages: HOME_ONLY }
```

- With no `pages`, an entry runs on every page that starts the manager.
- The landing-page set pieces (`disco`, `textglow`, `entrance`, `spotlight`,
  `reflections`, `tiltdepth`) are `["home"]`, because they target landing DOM.
- A page starts the manager with `<script type="module" src="/effects/autostart.js">`,
  which reads its page id from the URL (`public/effects/pages.js`).
- `autostart.js` is **not wired into any page yet**. Deciding which pages get
  ambience is part of the design round.

## Registering a piece (once it is picked, not while sketching)

A registry effect (`background` or `burst`) needs all four of these entries,
and the drift tests fail if any is missing:

1. `public/effects/registry.js`: `{ id, create, pages? }`
2. `public/effects/config.js`: defaults in `EFFECT_CONFIGS`
3. `core/effect-config-schema.js`: a server-side bound for every key
4. `public/effects/control-meta.js`: a `LABELS` entry and `HINTS` for its params

`card`, `arrangement` and `book` pieces will get a small sibling registry when
the first one is built (id → label, params with hints, stylesheet, hooks). It
follows the same rules, and it is not designed ahead of a real piece.

### Added after round 2's sketches (2026-10-29)

Two independent sketch agents hit the same two gaps, so the contract grew:

- **`ornament(entry) → SVG string`** on a `card`. Art drawn for each entry
  (a plant, a woven swatch, an island, a punched roll) has nowhere to live in
  CSS. The hook returns one `aria-hidden` element appended to the card. It must
  be deterministic per entry (seeded from author + message), and it is never
  the only carrier of information. The text stays the text.
- **`arrangement`** as a fifth slot. Some designs change WHERE entries sit (by
  the minute they were written, around a stair, on a chart), which no other
  slot can express. The DOM keeps entries in feed order, so keyboard and screen
  reader users read the guestbook the normal way, and `arrange` positions them
  visually. Under reduced motion or in print it may fall back to the plain feed.

## The mixer (built after the picks)

The owner's decision is that **both** the couple and guests mix:

- **The couple** sets the site default in admin. It is stored with the site
  content as an allowlisted `{ [page]: { [slot]: { id, params } } }`, validated
  server-side against the registries and the schema bounds, and rendered as
  data attributes.
- **A guest** can remix in a drawer on the page. The same shape goes in
  `localStorage` and overlays the couple's default. It holds only allowlisted
  ids and bounded params, so no arbitrary CSS or URLs. Printing the memory book
  prints the guest's own remix.
- **The studio** gains slot pickers, for tuning.

## Sketches (design round 2)

Round 2 makes **sketches**, not integrations. A sketch is a standalone page under
`prototypes/<agent>/<sketch>/`, served by `node prototypes/serve.js`, and it
uses the shared fixture `prototypes/fixtures/entries.json`, so every sketch
shows the same guests. Each sketch has a `SKETCH.md` that says:

- which slot(s) it fills, and for each one its params with `ControlHint`
  shapes and defaults;
- how it behaves under reduced motion, in dark mode and in print;
- what it would cost to build properly (new files, rough size) and any risks.

The owner picks from the sketches, and only the picks are built into slots.
