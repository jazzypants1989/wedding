/** @file Fake data for the guided-journeys prototype. Every name here is invented;
 *  every face and photo is a generated SVG (art.js). The store persists to
 *  sessionStorage so a reload keeps your place AND your progress — "Reset demo"
 *  in the prototype drawer wipes it. */

const KEY = "aj-demo-v2"

const GUEST_NAMES = [
  "Auntie Lou",
  "Marcus Bell",
  "Priya Natarajan",
  "Tom & Ellie Reyes",
  "Grandma June",
  "Sam Okafor",
  "Dana Whitfield",
  "The Kowalskis",
  "Hiro Tanaka",
  "Bea Lindqvist",
  "Omar Haddad",
  "Rosa Delgado",
  "Felix Brandt",
  "Nadia Petrova",
  "Cal Jensen",
  "Imani Brooks",
  "Ruth Abernathy",
  "Leo Marchetti",
  "Wen Li",
  "Gus Fairbanks",
]

/** @returns {any} */
function fresh() {
  const guests = GUEST_NAMES.map((name, i) => ({
    id: 101 + i,
    name,
    email: i % 3 === 2 ? "" : name.split(" ")[0].toLowerCase().replaceAll("&", "") + "@example.com",
    phone: i % 3 === 2 ? "+1 503 555 01" + String(10 + i) : "",
    status: i < 17 ? "responded" : i < 19 ? "invited" : "pending",
    party: 1 + (i % 3),
    attending: i % 7 !== 3,
  }))

  // People: the photographed cast. Some are roster guests, some are not.
  const people = [
    { id: 1, name: "Auntie Lou", hue: 12, guestId: 101 },
    { id: 2, name: "Marcus Bell", hue: 210, guestId: 102 },
    { id: 3, name: "Priya Natarajan", hue: 290, guestId: 103 },
    { id: 4, name: "Grandma June", hue: 45, guestId: 105 },
    { id: 5, name: "Sam Okafor", hue: 150, guestId: 106 },
    { id: 6, name: "Hiro Tanaka", hue: 330, guestId: 109 },
    { id: 7, name: "Mira (photographer)", hue: 95, guestId: null },
    { id: 8, name: "Little Theo", hue: 185, guestId: null },
  ]

  // Unnamed recognition groups. `truth` is the fictional person behind the
  // faces — used only for the placeholder hue, never shown.
  const sizes = [24, 18, 15, 12, 9, 7, 5, 4]
  const truths = [1, 2, 4, 3, 5, 1, 6, 8]
  let fid = 1001
  const groups = sizes.map((size, gi) => {
    const faces = []
    for (let k = 0; k < size; k++) {
      faces.push({
        id: fid++,
        mediaId: 300 + ((gi * 7 + k * 3) % 60),
        setAside: k === size - 1 && size > 6,
        // one wrong face hiding in the second group, to make "exclude" real
        oddHue: gi === 1 && k === 5 ? 330 : null,
      })
    }
    return { truth: truths[gi], faces }
  })

  // Ask queue: harder single faces with ranked candidates.
  const ask = []
  const askTruths = [1, 2, 4, 3, 2, 5, 1, 4, 3, 6, 2, 1]
  for (let i = 0; i < askTruths.length; i++) {
    const t = askTruths[i]
    const other = t === 2 ? 5 : t === 4 ? 1 : 2
    const third = t === 3 ? 4 : 3
    ask.push({
      id: 3001 + i,
      mediaId: 400 + i,
      truth: t,
      candidates: i % 3 === 0 ? [t, other, third] : i % 3 === 1 ? [other, t] : [t, other],
      margin: [0.08, 0.04, 0.11, 0.02, 0.06, 0.09, 0.03, 0.05, 0.07, 0.1, 0.01, 0.04][i],
      unlocks: [9, 7, 6, 6, 5, 4, 4, 3, 3, 2, 2, 1][i],
    })
  }

  // Same moment: near-duplicate frames of a face in a group.
  const sameMoment = [0, 0, 1, 2, 2, 3].map((g, i) => ({
    id: 4001 + i,
    mediaId: 500 + i,
    fromFaceId: groups[g].faces[i].id,
    group: g,
  }))

  const pending = [
    { key: "g-201", type: "guestbook", author: "Ruth Abernathy", text: "The vows had the whole back row sniffling. Thank you for letting us be part of it. Wishing you a lifetime of slow Sunday mornings.", at: "2h ago" },
    { key: "m-342", type: "media", author: "Leo Marchetti", text: "First dance, from the balcony", seed: 342, at: "3h ago" },
    { key: "c-77", type: "comment", author: "Wen Li", text: "This one needs to be framed!!", on: "photo · Cake cutting", at: "3h ago" },
    { key: "g-202", type: "guestbook", author: "Gus Fairbanks", text: "Best. Playlist. Ever. Who knew Grandma June could do the worm.", at: "5h ago" },
    { key: "m-343", type: "media", author: "Leo Marchetti", text: "Sparklers!", seed: 343, at: "5h ago" },
    { key: "g-203", type: "guestbook", author: "Anonymous visitor", text: "CHEAP WATCHES >>> click here for deals", at: "6h ago", spam: true },
    { key: "c-78", type: "comment", author: "Imani Brooks", text: "I can't believe how fast the night went. Love you two.", on: "guestbook · Auntie Lou", at: "8h ago" },
    { key: "m-344", type: "media", author: "Cal Jensen", text: "Table 6 being table 6", seed: 344, at: "yesterday" },
    { key: "g-204", type: "guestbook", author: "Nadia Petrova", text: "Congratulations from all of us in Tallinn! We watched the livestream with coffee at 3am.", at: "yesterday" },
  ]

  const approved = [
    { id: 132, author: "Auntie Lou", text: "Call your mother. Both of you. Love, Auntie Lou", pinned: true },
    { id: 133, author: "Marcus Bell", text: "Ten years ago you two argued about pineapple on pizza for an hour. Look at you now.", pinned: false },
    { id: 134, author: "Priya Natarajan", text: "The flowers! The speeches! The tiny dog in a bow tie!", pinned: true },
    { id: 135, author: "Hiro Tanaka", text: "Wishing you a marriage as long as the conga line.", pinned: false },
    { id: 136, author: "Bea Lindqvist", text: "So much love in one room. Thank you for having us.", pinned: false },
    { id: 137, author: "Omar Haddad", text: "Still thinking about that lemon cake.", pinned: false },
  ]

  const accounts = [
    { id: 1, name: "Auntie Lou", posts: 6, trusted: true },
    { id: 2, name: "Marcus Bell", posts: 4, trusted: true },
    { id: 3, name: "Leo Marchetti", posts: 9, trusted: false },
    { id: 4, name: "Wen Li", posts: 3, trusted: false },
    { id: 5, name: "Ruth Abernathy", posts: 2, trusted: false },
    { id: 6, name: "Gus Fairbanks", posts: 2, trusted: false },
    { id: 7, name: "Cal Jensen", posts: 5, trusted: false },
  ]

  const gifts = [
    { id: 11, guestId: 101, what: "the hand-thrown serving bowl", at: "Apr 28" },
    { id: 12, guestId: 102, what: "the espresso machine", at: "Apr 28" },
    { id: 13, guestId: 103, what: "the hammock", at: "Apr 29" },
    { id: 14, guestId: 104, what: "the honeymoon kayak trip", at: "Apr 29" },
    { id: 15, guestId: 105, what: "the family quilt", at: "Apr 30" },
    { id: 16, guestId: 106, what: "the cookbook stack", at: "May 1" },
    { id: 17, guestId: 107, what: "the cast-iron pan", at: "May 1" },
    { id: 18, guestId: 108, what: "the record player", at: "May 2" },
    { id: 19, guestId: 109, what: "the framed print", at: "May 3" },
    { id: 20, guestId: 110, what: "the picnic set", at: "May 3" },
    { id: 21, guestId: 111, what: "a generous gift card", at: "May 5" },
    { id: 22, guestId: 112, what: "the herb garden kit", at: "May 6" },
  ]

  const cards = [
    { id: 501, guestId: 101, status: "viewed", channel: "email", message: "Dear Lou, the bowl already has a permanent spot on our table…", photos: [311, 318], reply: { emoji: "heart", text: "Oh you two. I cried. Come for dinner soon!", read: false } },
    { id: 502, guestId: 102, status: "sent", channel: "email", message: "Marcus — the espresso machine has changed our mornings…", photos: [305], reply: null },
    { id: 503, guestId: 105, status: "viewed", channel: "sms", message: "Grandma June, we wrapped up in the quilt the first night home…", photos: [322], reply: { emoji: "laugh", text: "That worm was NOTHING. Wait till the anniversary party.", read: false } },
    { id: 504, guestId: 103, status: "viewed", channel: "link", message: "Priya, the hammock is officially Jesse's nap headquarters…", photos: [], reply: { emoji: "tear", text: "Best day. Love you both.", read: true } },
    { id: 505, guestId: 106, status: "draft", channel: "email", message: "Sam, thank you for the cookbook stack — we've already ruined two recipes and loved every minute.", photos: [330] },
    { id: 506, guestId: 107, status: "draft", channel: "sms", message: "Dana, the cast-iron pan is seasoned and so are we. Thank you!", photos: [] },
    { id: 507, guestId: 109, status: "draft", channel: "email", message: "Hiro, the framed print is the first thing anyone sees when they walk in. Thank you for such a thoughtful gift.", photos: [312, 341] },
  ]

  const official = Array.from({ length: 10 }, (_, i) => ({
    id: 300 + i,
    caption: ["Getting ready", "The walk", "Vows", "First kiss", "Confetti", "Family photo", "Cake", "First dance", "Sparklers", "Goodnight"][i],
  }))
  const loved = Array.from({ length: 8 }, (_, i) => ({
    id: 360 + i,
    by: ["Leo Marchetti", "Wen Li", "Cal Jensen", "Imani Brooks", "Gus Fairbanks", "Leo Marchetti", "Bea Lindqvist", "Omar Haddad"][i],
    hearts: [41, 33, 29, 22, 18, 15, 11, 9][i],
    caption: ["Dance floor at midnight", "Grandma June mid-worm", "Table 6", "The getaway car", "Sunset on the porch", "Shoes off", "Flower crowns", "Late-night tacos"][i],
    promoted: false,
  }))

  return {
    mode: "post",
    sessionExpired: false,
    guests,
    people,
    groups,
    assigned: /** @type {Record<string, number>} */ ({}), // faceId -> personId
    notFace: /** @type {Record<string, boolean>} */ ({}),
    ejected: /** @type {Record<string, boolean>} */ ({}), // left out of a group → sent to Ask
    skippedAsk: /** @type {Record<string, boolean>} */ ({}),
    ask,
    sameMoment,
    batches: /** @type {any[]} */ ([]),
    pending,
    decided: /** @type {any[]} */ ([]),
    approved,
    accounts,
    gifts,
    cards,
    official,
    loved,
    galleryAdded: false,
    resume: /** @type {Record<string, string>} */ ({}),
    seenIntro: /** @type {Record<string, boolean>} */ ({}),
    site: { welcomeHeading: "Thank you for celebrating with us", welcomeIntro: "Photos, messages and memories from April 26." },
  }
}

/** @type {any} */
export let db = load()

function load() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return fresh()
}

export function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(db))
  } catch {}
}

export function reset() {
  db = fresh()
  save()
}

// ---------- derived helpers ----------

/** @param {number} id */
export const guestById = (id) => db.guests.find((/** @type {any} */ g) => g.id === id)
/** @param {number} id */
export const personById = (id) => db.people.find((/** @type {any} */ p) => p.id === id)

/** Faces of a group that are still unnamed and still faces. @param {any} g */
export function liveFaces(g) {
  return g.faces.filter((/** @type {any} */ f) => !db.assigned[f.id] && !db.notFace[f.id] && !(db.ejected || {})[f.id])
}

/** Groups that still have something to name, biggest first. Each carries its
 *  stable anchor: the lowest live face id it holds. */
export function openGroups() {
  return db.groups
    .map((/** @type {any} */ g, i) => ({ g, i, live: liveFaces(g) }))
    .filter((/** @type {any} */ x) => x.live.some((/** @type {any} */ f) => !f.setAside))
    .map((/** @type {any} */ x) => ({ ...x, anchor: x.live[0].id }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => b.live.length - a.live.length)
}

/** Find the open group containing a face id — how deep links stay stable when
 *  the group list is recomputed. @param {number} faceId */
export function groupByFace(faceId) {
  return openGroups().find((x) => x.g.faces.some((/** @type {any} */ f) => f.id === faceId))
}

/** Hue a face is drawn with. @param {any} g @param {any} f */
export function faceHue(g, f) {
  if (f.oddHue !== null && f.oddHue !== undefined) return f.oddHue
  return personById(g.truth).hue
}

/** People with at least one confirmed face. */
export function knownPeople() {
  const ids = new Set(Object.values(db.assigned))
  return db.people.filter((/** @type {any} */ p) => ids.has(p.id))
}

/** A suggestion for a group: if the person it really is has already been named
 *  elsewhere, the "matcher" proposes them. @param {any} g */
export function suggestionFor(g) {
  const known = new Set(Object.values(db.assigned))
  return known.has(g.truth) ? personById(g.truth) : null
}

/** Ask items that are answerable now: unanswered and with a known candidate. */
export function openAsk() {
  const known = new Set(Object.values(db.assigned))
  return db.ask.filter(
    (/** @type {any} */ a) =>
      !db.assigned[a.id] && !db.notFace[a.id] && a.candidates.some((/** @type {number} */ c) => known.has(c)),
  )
}

export function waitingAsk() {
  return db.ask.filter((/** @type {any} */ a) => !db.assigned[a.id] && !db.notFace[a.id])
}

/** Same-moment rows that are ready: their source face has been named. */
export function openSameMoment() {
  return db.sameMoment.filter(
    (/** @type {any} */ s) => db.assigned[s.fromFaceId] && !db.assigned[s.id] && !db.notFace[s.id],
  )
}

export function faceTotals() {
  let total = 0
  let setAside = 0
  for (const g of db.groups) {
    total += g.faces.length
    for (const f of g.faces) if (f.setAside && !db.assigned[f.id] && !db.notFace[f.id]) setAside++
  }
  // faces left out of a group are re-queued in `ask` — don't count them twice
  total += db.ask.filter((/** @type {any} */ a) => !a.fromGroup).length + db.sameMoment.length
  const named = Object.keys(db.assigned).length
  const notFace = Object.keys(db.notFace).length
  return { total, named, notFace, setAside, left: total - named - notFace - setAside }
}

/** @param {number} personId */
export function facesOf(personId) {
  return Object.entries(db.assigned)
    .filter(([, p]) => p === personId)
    .map(([f]) => Number(f))
}

/** Hue for any face id (group face, ask face or same-moment face). @param {number} faceId */
export function hueOfFace(faceId) {
  for (const g of db.groups) {
    const f = g.faces.find((/** @type {any} */ x) => x.id === faceId)
    if (f) return faceHue(g, f)
  }
  const a = db.ask.find((/** @type {any} */ x) => x.id === faceId)
  if (a) return personById(a.truth).hue
  const s = db.sameMoment.find((/** @type {any} */ x) => x.id === faceId)
  if (s) return personById(db.groups[s.group].truth).hue
  return 0
}

/** Cards + gifts joined into the thank-you worklist. */
export function cardFor(guestId) {
  return db.cards.find((/** @type {any} */ c) => c.guestId === guestId)
}
export function unwritten() {
  return db.gifts.filter((/** @type {any} */ g) => !cardFor(g.guestId))
}
export function drafts() {
  return db.cards.filter((/** @type {any} */ c) => c.status === "draft")
}
export function sentCards() {
  return db.cards.filter((/** @type {any} */ c) => c.status !== "draft")
}
export function unreadReplies() {
  return db.cards.filter((/** @type {any} */ c) => c.reply && !c.reply.read)
}

/** Photos a guest's person appears in — the bridge from "Name the faces" to
 *  "Thank everyone". @param {number} guestId */
export function photosOfGuest(guestId) {
  const person = db.people.find((/** @type {any} */ p) => p.guestId === guestId)
  if (!person) return []
  const ids = new Set(facesOf(person.id))
  /** @type {Set<number>} */
  const media = new Set()
  for (const g of db.groups) for (const f of g.faces) if (ids.has(f.id)) media.add(f.mediaId)
  return [...media].slice(0, 6)
}
