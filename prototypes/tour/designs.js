/** @file The design review's content: every round-2 prototype, what it is for,
 *  and how to look at it. Written from each agent's own SKETCH.md / IA.md and
 *  final report; the docs stay the source of truth and are linked from each
 *  entry. Plain data — tour.js renders it.
 */

/**
 * @typedef {{ slot: string, id: string }} SlotPiece
 * @typedef {{ label: string, path: string }} DeepLink
 * @typedef {{
 *   id: string,
 *   track: "guest" | "admin",
 *   family: string,
 *   title: string,
 *   tagline: string,
 *   intent: string,
 *   surprise: string,
 *   slots?: SlotPiece[],
 *   cost: string,
 *   risks: string[],
 *   questions: string[],
 *   screen: string,
 *   book?: string,
 *   links?: DeepLink[],
 *   doc: string,
 *   dark: "dark" | "theme" | "none",
 * }} Design
 */

/** The three guest-page families, in tour order.
 *  @type {Array<{ id: string, title: string, angle: string }>} */
export const FAMILIES = [
  {
    id: "grows",
    title: "Grows from the entries",
    angle:
      "The page is made of the guests. Each note deterministically grows its own artwork " +
      "from its words and its author, so the same note always looks the same, on screen " +
      "and in print, and no two notes look alike.",
  },
  {
    id: "retro",
    title: "Retro web / zine",
    angle:
      "A deliberate, affectionate contrast with the polished front page. Each one is a " +
      "whole printed or digital medium from the past, done with real craft, and its " +
      "memory book is a real object in that medium.",
  },
  {
    id: "sound-time",
    title: "Sound, time and space",
    angle:
      "The guestbook as something you play, something that changes with the hour and the " +
      "anniversaries, or somewhere you walk around. Sound is synthesised and muted by default.",
  },
  {
    id: "admin",
    title: "Admin: three ways to organise the dashboard",
    angle:
      "All three fix what you filed: Back always goes to the previous screen, every " +
      "feature is one click away, and Faces walks you through step by step. They differ " +
      "in what the admin is organised around: your to-do list, a workspace, or journeys.",
  },
]

/** @type {Design[]} */
export const DESIGNS = [
  {
    id: "herbarium",
    track: "guest",
    family: "grows",
    title: "Herbarium",
    tagline: "Every note grows a plant from its grammar.",
    intent:
      "How a note is written decides how its plant grows: each sentence is a branch, each " +
      "word a leaf, a full stop a flower, \u201c!\u201d a big bloom, \u201c?\u201d a bud, \u201c\u2026\u201d berries, and a " +
      "missing full stop leaves a curled tendril. The guest's name picks the leaf and " +
      "petal shapes. The guestbook is a meadow of everyone's plants.",
    surprise:
      "The memory book is a herbarium of mounted specimen sheets, each with a mock-Latin " +
      "name (Devella lolifolia), a TYPE stamp on Favorites and an index of species. Its " +
      "night-garden dark mode is the agent's favourite state.",
    slots: [
      { slot: "background", id: "meadow" },
      { slot: "card", id: "specimen (plant ornament)" },
      { slot: "book", id: "herbarium" },
      { slot: "burst", id: "seed" },
    ],
    cost: "About 2–3 days. The generator is close to shippable.",
    risks: [
      "A generated Latin name could read as a joke at someone's expense. It never changes, so you can preview every one; a per-note override may be needed.",
      "At several thousand notes the meadow should sample rather than draw everyone (300 is fine).",
    ],
    questions: ["Are the generated plant names charming or a liability?"],
    screen: "/r2-grows/herbarium/",
    book: "/r2-grows/herbarium/book.html",
    doc: "/r2-grows/herbarium/SKETCH.md",
    dark: "dark",
  },
  {
    id: "pattern-book",
    track: "guest",
    family: "grows",
    title: "Pattern Book",
    tagline: "Every note is threaded onto a loom and woven.",
    intent:
      "The weaving is real: each letter is one thread on an 8-shaft loom, so long words " +
      "weave wide diamonds and short notes make tight motifs. The background is a coverlet " +
      "bordered with cloth woven from your names, with bare warp still on the loom where " +
      "future notes will go.",
    surprise:
      "Every page of the memory book is a weaving draft a weaver could actually follow, so " +
      "the guestbook could be woven into a real blanket.",
    slots: [
      { slot: "background", id: "coverlet" },
      { slot: "card", id: "swatch (cloth ornament)" },
      { slot: "book", id: "pattern-book" },
      { slot: "burst", id: "shuttle" },
    ],
    cost: "About 2 days, the cheapest of the three to make correct.",
    risks: [
      "On a phone a small swatch reads as texture rather than pattern.",
      "The printed book is heavy: 7 MB of PDF for 32 notes until runs are merged.",
    ],
    questions: [],
    screen: "/r2-grows/pattern-book/",
    book: "/r2-grows/pattern-book/book.html",
    doc: "/r2-grows/pattern-book/SKETCH.md",
    dark: "dark",
  },
  {
    id: "archipelago",
    track: "guest",
    family: "grows",
    title: "Archipelago",
    tagline: "Every note raises an island.",
    intent:
      "Each note raises an island on a sea chart. Its summit is named for the note's most " +
      "particular word (Mt. Thanksgiving), and dashed shipping routes join notes that share " +
      "a word, so the guestbook becomes a map of what people talked about.",
    surprise:
      "The memory book is an atlas: each note printed as its island's sailing directions, " +
      "ending with a gazetteer of every place name.",
    slots: [
      { slot: "background", id: "chart" },
      { slot: "card", id: "inset (island ornament)" },
      { slot: "book", id: "atlas" },
      { slot: "burst", id: "surfacing" },
    ],
    cost: "About 3 days, the most code of the three; label placement is where the time goes.",
    risks: [
      "Island labels can overlap at 32+ notes; a proper label placer is a day's work.",
      "Summit names can misfire (“Mt. Letting”); needs a stoplist and your preview.",
      "Adding a note shifts the chart a little, so a book printed later can differ.",
    ],
    questions: [],
    screen: "/r2-grows/archipelago/",
    book: "/r2-grows/archipelago/book.html",
    doc: "/r2-grows/archipelago/SKETCH.md",
    dark: "dark",
  },
  {
    id: "guestbook-cgi",
    track: "guest",
    family: "retro",
    title: "guestbook.cgi",
    tagline: "A loving 1999 homepage guestbook.",
    intent:
      "Pixel-heart wallpaper, WordArt, a marquee, “This marriage is UNDER CONSTRUCTION " +
      "— completion date: never”, a hit counter, a webring, 88×31 badges and a " +
      "synthesised Canon in D MIDI (muted). Each entry is the classic guestbook.cgi table, " +
      "built from the real feed markup with CSS alone.",
    surprise:
      "The memory book is the page “printed from Navigator”: title, “Page 2 of 7”, " +
      "URL and date in every page margin, done with real CSS print margin boxes.",
    slots: [
      { slot: "background", id: "tiled-1999" },
      { slot: "burst", id: "thanks-for-signing" },
      { slot: "card", id: "guestbook-cgi" },
      { slot: "book", id: "netscape-printout" },
    ],
    cost: "About 6 new files (~1.5k lines), plus the MIDI only if it's kept.",
    risks: [
      "The marquee, counter, webring and badges don't fit any slot. The agent proposes a sixth, optional “furniture” slot.",
      "The GeoCities URL is a joke string; swap in the real domain if a dead brand is unwelcome.",
    ],
    questions: ["Is a “furniture” slot (page decorations) worth adding to the contract?"],
    screen: "/r2-retro/guestbook-cgi/",
    book: "/r2-retro/guestbook-cgi/book.html",
    doc: "/r2-retro/guestbook-cgi/SKETCH.md",
    dark: "theme",
  },
  {
    id: "cut-and-paste",
    track: "guest",
    family: "retro",
    title: "cut-and-paste",
    tagline: "A photocopied riot-grrrl zine.",
    intent:
      "Ransom-note headings, xerox grain, and every entry a clipping on a different " +
      "paper (bond, notebook, newsprint, graph, black photocopy, construction paper). " +
      "Signing runs the page through the copier and stamps it “RECEIVED”.",
    surprise:
      "The memory book is a real zine: paginated by measuring, then imposed for saddle " +
      "stitch. Print double-sided, fold, staple, and the pages come out in order.",
    slots: [
      { slot: "background", id: "xerox" },
      { slot: "burst", id: "photocopy" },
      { slot: "card", id: "clipping" },
      { slot: "book", id: "zine-a5" },
    ],
    cost: "About 1.9k lines, mostly CSS.",
    risks: [
      "Booklet printing needs duplex “flip on short edge”; single pages is the fallback.",
      "300 entries make a 40-page zine, the limit of a desk stapler; beyond that it should split into issues.",
      "The marker handwriting is a system font, so it varies by OS until it's drawn as SVG (about a day).",
    ],
    questions: [],
    screen: "/r2-retro/cut-and-paste/",
    book: "/r2-retro/cut-and-paste/book.html",
    doc: "/r2-retro/cut-and-paste/SKETCH.md",
    dark: "theme",
  },
  {
    id: "tractor-feed",
    track: "guest",
    family: "retro",
    title: "tractor-feed",
    tagline: "Dot-matrix printout by day, BBS terminal by night.",
    intent:
      "By day each entry is a torn-off chunk of green-bar printer paper with sprocket " +
      "holes and pin-struck text. In dark mode the same entries sit on a phosphor-green " +
      "BBS terminal. Signing prints a receipt.",
    surprise:
      "The memory book opens with a Print Shop banner of your names running sideways " +
      "across three pages (tape them up), then the whole guestbook as a green-bar listing.",
    slots: [
      { slot: "background", id: "fanfold-feed" },
      { slot: "burst", id: "print-head" },
      { slot: "card", id: "tractor-feed" },
      { slot: "book", id: "banner-fanfold" },
    ],
    cost: "About 1.3k lines.",
    risks: [
      "The dot-matrix mask looks a little grey on non-retina screens (tunable).",
      "The banner font lacks accented capitals so far (a few more glyphs).",
      "Print behaviour verified in Chrome; Safari and Firefox need a check.",
    ],
    questions: [],
    screen: "/r2-retro/tractor-feed/",
    book: "/r2-retro/tractor-feed/book.html",
    doc: "/r2-retro/tractor-feed/SKETCH.md",
    dark: "theme",
  },
  {
    id: "player-piano",
    track: "guest",
    family: "sound-time",
    title: "Player Piano",
    tagline: "The guestbook is a punched roll; your scroll is the crank.",
    intent:
      "Each name is spelled in notes (letters A–G, wrapping) and the words set the rhythm, " +
      "so every note is a short tune punched into one long roll. Holes light up as they " +
      "cross a brass bar as you scroll. Typing your name in the composer punches your holes.",
    surprise:
      "The memory book engraves every guest as real sheet music with their name as the " +
      "lyrics, so anyone can play the guestbook on a piano.",
    slots: [
      { slot: "background", id: "tracker" },
      { slot: "card", id: "roll" },
      { slot: "burst", id: "punch" },
      { slot: "book", id: "score" },
    ],
    cost: "About 1.5k lines; the motif and synth are shared with The Stair.",
    risks: [
      "Nobody has heard it yet: the agent can't hear audio, so the sound graph was checked by reading it.",
      "On a phone the roll takes ~110px of width; worth feeling on a real device.",
      "Some names repeat a note; a pentatonic mode is the “always pretty” fallback.",
    ],
    questions: ["Does sound belong on the guestbook at all (muted by default)?"],
    screen: "/r2-sound-time/player-piano/",
    book: "/r2-sound-time/player-piano/book.html",
    doc: "/r2-sound-time/player-piano/SKETCH.md",
    dark: "theme",
  },
  {
    id: "hours",
    track: "guest",
    family: "sound-time",
    title: "The Long Day",
    tagline: "Every note on one 24-hour day, lit by the real sun.",
    intent:
      "Notes are laid on one day by the minute they were written, and the page opens at " +
      "your own hour. Each card casts the real Portland sun's shadow from the moment it " +
      "was written; night notes are lamplit. The ink browns with the years and the accent " +
      "becomes that year's anniversary material.",
    surprise:
      "On the anniversary it says “One year ago tonight… Marguerite wrote the note " +
      "beside you”. The memory book is a medieval Book of Hours. Try the ⏱ time machine.",
    slots: [
      { slot: "arrangement", id: "one-day" },
      { slot: "background", id: "daylight" },
      { slot: "card", id: "sundial" },
      { slot: "book", id: "hours" },
    ],
    cost: "About 1.1k lines. The sundial card also works on its own in a normal feed.",
    risks: [
      "Ordering by time of day needs every entry loaded (fine at wedding scale, but a different fetch).",
      "Real timestamps must be converted to Portland time before the sun is computed.",
    ],
    questions: [],
    screen: "/r2-sound-time/hours/",
    book: "/r2-sound-time/hours/book.html",
    links: [{ label: "First anniversary, 10pm", path: "/r2-sound-time/hours/?at=2027-04-26T22:00" }],
    doc: "/r2-sound-time/hours/SKETCH.md",
    dark: "theme",
  },
  {
    id: "stair",
    track: "guest",
    family: "sound-time",
    title: "The Stair",
    tagline: "Notes hung round a 3D spiral staircase.",
    intent:
      "Notes hang around a CSS 3D spiral stair that turns as you scroll, with each signer's " +
      "name on the back. It goes flat under reduced motion, and a flat toggle is one tap away.",
    surprise:
      "The memory book sets every name on one spiral of text that fits whether there are " +
      "3 names or 300.",
    slots: [
      { slot: "arrangement", id: "stair" },
      { slot: "card", id: "hung" },
      { slot: "book", id: "spiral" },
    ],
    cost: "About 1k lines, reusing Player Piano's motif and synth.",
    risks: [
      "The most motion-heavy idea of the round; some people will find it a lot.",
      "Safari's 3D hasn't been checked (headless Chrome only).",
    ],
    questions: [],
    screen: "/r2-sound-time/stair/",
    book: "/r2-sound-time/stair/book.html",
    doc: "/r2-sound-time/stair/SKETCH.md",
    dark: "theme",
  },
  {
    id: "admin-today",
    track: "admin",
    family: "admin",
    title: "Today",
    tagline: "Task-first: home is what needs you, in order.",
    intent:
      "Home is “Today”: guests waiting, then replies, then requests, then drafts to send, " +
      "then the next thank-you, then faces. Each item opens its exact screen; finishing " +
      "returns you to Today with it ticked under “Done today”. Faces comes as today's set " +
      "of 5 groups, so you can actually reach “All caught up”. A / or ⌘K palette jumps anywhere.",
    surprise:
      "One history rule: opening adds a Back step, moving on after finishing replaces it, " +
      "so Back never replays work and Undo (Z or the toast) is the only undo. No “are you " +
      "sure?” on anything undoable.",
    cost: "About 11 days. Faces is the biggest piece (~2.5).",
    risks: ["Daily sets could feel artificial if you want to power through faces in one sitting."],
    questions: [
      "How big should the daily face set be?",
      "Should the next thank-you rank above replies?",
      "Should the review queue allow “Later”?",
      "One undo toast at a time, or a stack?",
      "Batch sending: best channel per guest, or email only?",
    ],
    screen: "/admin-today/",
    links: [
      { label: "A review item", path: "/admin-today/review/media-412" },
      { label: "A face group", path: "/admin-today/faces/groups/f1202" },
      { label: "Send thank-yous", path: "/admin-today/thanks/send" },
      { label: "A dialog on cold load", path: "/admin-today/faces/history/b31/revoke" },
    ],
    doc: "/admin-today/IA.md",
    dark: "none",
  },
  {
    id: "admin-workspace",
    track: "admin",
    family: "admin",
    title: "Workspace",
    tagline: "A grouped sidebar plus mail-client list/detail views.",
    intent:
      "A fixed, grouped sidebar is always on screen (an icon rail at medium width, a " +
      "bottom bar plus More on phones) with live counts. Each feature is a split: queue " +
      "on the left, the selected item on the right, j/k to move, act in place. Faces is a " +
      "three-pane screen (groups | faces in the group | who is it) inside a four-step walk.",
    surprise:
      "Back undoes navigation, not motion: opening something adds a Back step, moving " +
      "within a list replaces it, so thirty Approve presses are one entry and Back leaves Review.",
    cost: "About 18–20 days in shippable slices; the first slice fixes Back and re-login on its own.",
    risks: ["The densest of the three; strongest on a laptop, more cramped on a phone."],
    questions: [
      "Should a sidebar click return you to exactly where you left that section?",
      "Should Review and Faces jump to the next item after each decision?",
      "Should trusting an author also approve their waiting posts?",
    ],
    screen: "/admin-workspace/",
    links: [
      { label: "Review", path: "/admin-workspace/review" },
      { label: "Faces", path: "/admin-workspace/faces" },
      { label: "Send cards", path: "/admin-workspace/cards/send" },
      { label: "Edit a card", path: "/admin-workspace/cards/c21/edit" },
    ],
    doc: "/admin-workspace/IA.md",
    dark: "none",
  },
  {
    id: "admin-journeys",
    track: "admin",
    family: "admin",
    title: "Journeys",
    tagline: "Post-wedding work as four guided journeys.",
    intent:
      "Keep the guestbook tidy, Curate the gallery, Name the faces, Thank everyone. Each " +
      "journey's numbered steps are its sub-tabs, each with its own address. Each step " +
      "opens with a large plain-language intro that shrinks once you've done its work, and " +
      "a sticky bar says “Skip ahead” until the step is done, then “Next”.",
    surprise:
      "Home leads with one “Next up” card and a numbered map of the journeys; the order " +
      "flips between before and after the wedding.",
    cost: "About 17 days in full; a first slice of about 6.",
    risks: ["Guidance that helps the first time can feel slow on the tenth; the intros shrink to compensate."],
    questions: [
      "Does a finished step mean “done for now” or “done for good”?",
      "Should Home's Continue go to where you left off, or the most useful next step?",
    ],
    screen: "/admin-journeys/",
    links: [
      { label: "A face group", path: "/admin-journeys/faces/groups/f1001" },
      { label: "A new guest post", path: "/admin-journeys/review/new/g-201" },
      { label: "Write a card", path: "/admin-journeys/thanks/write/c505" },
      { label: "Send cards", path: "/admin-journeys/thanks/send" },
    ],
    doc: "/admin-journeys/IA.md",
    dark: "none",
  },
]
