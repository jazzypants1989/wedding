/** @file Fake data for the Task-first / Today admin prototype. Every name here
 *  is fictional; there are no photographs anywhere — faces and "photos" are
 *  generated SVG placeholders (see art.js). State lives in sessionStorage so a
 *  reload keeps your progress; "Reset demo" in the dev strip clears it. */

const KEY = "admin-today-state-v3"

/** Deterministic pseudo-random from a seed, so the demo looks the same each load. */
function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

const GUESTS = [
  ["g1", "Auntie Lou", "lou@example.com", ""],
  ["g2", "Rafael Domínguez-Ortiz", "rafa@example.com", "+1 503 555 0102"],
  ["g3", "Nadia Haddad", "", "+1 503 555 0103"],
  ["g4", "Priya Natarajan", "priya@example.com", ""],
  ["g5", "Tom Okafor", "tom@example.com", "+1 503 555 0105"],
  ["g6", "Mei Lin", "mei@example.com", ""],
  ["g7", "Grandpa Walt", "", ""],
  ["g8", "Ben Adler", "ben@example.com", ""],
  ["g9", "Sofia Marchetti", "sofia@example.com", ""],
  ["g10", "Keiko Sato", "", "+1 503 555 0110"],
  ["g11", "Dev Patel", "dev@example.com", ""],
  ["g12", "Hannah Kim", "hannah@example.com", ""],
  ["g13", "Marcus Bell", "marcus@example.com", ""],
  ["g14", "Inês Ferreira", "ines@example.com", ""],
  ["g15", "Owen Brady", "", "+1 503 555 0115"],
  ["g16", "Lucía Romero", "lucia@example.com", ""],
  ["g17", "Sam & Alex Rivera", "rivera@example.com", ""],
  ["g18", "Theo Nguyen", "theo@example.com", ""],
  ["g19", "Ruth Abramson", "ruth@example.com", ""],
  ["g20", "Jonah Weiss", "", ""],
].map(([id, name, email, phone]) => ({ id, name, email, phone }))

function initialState() {
  const r = rng(7)

  const moderation = [
    { key: "media-412", type: "media", author: "Hannah Kim", trusted: false, firstPost: true, caption: "First dance from the balcony!", hue: 18, ago: "14 min" },
    { key: "guestbook-133", type: "guestbook", author: "Owen Brady", trusted: false, firstPost: true, text: "Still the best party I have been to. Jordana, your speech wrecked me. Jesse, that dance.", ago: "40 min" },
    { key: "comment-77", type: "comment", author: "Mei Lin", trusted: true, firstPost: false, text: "I have the video of this somewhere!!", parent: "Photo: “The cake moment” by Ben Adler", ago: "1 h" },
    { key: "media-413", type: "media", author: "Hannah Kim", trusted: false, firstPost: false, caption: "", hue: 200, ago: "1 h" },
    { key: "guestbook-134", type: "guestbook", author: "Lucía Romero", trusted: false, firstPost: true, text: "Felicidades a los dos. Thank you for the playlist — I have been listening to it all week.", ago: "3 h" },
    { key: "media-414", type: "media", author: "Theo Nguyen", trusted: true, firstPost: false, caption: "Golden hour on the lawn", hue: 42, ago: "5 h" },
    { key: "comment-78", type: "comment", author: "Owen Brady", trusted: false, firstPost: false, text: "who let Walt near the dance floor", parent: "Message by Grandpa Walt", ago: "yesterday" },
  ].map((m) => ({ ...m, status: "pending" }))

  // Hidden identities drive the placeholder art (so a group "looks like" one
  // person) — never shown as text for unnamed groups.
  const people = [
    { id: "p1", name: "Jordana", guestId: null },
    { id: "p2", name: "Jesse", guestId: null },
    { id: "p3", name: "Auntie Lou", guestId: "g1" },
    { id: "p4", name: "Rafael Domínguez-Ortiz", guestId: "g2" },
    { id: "p5", name: "Priya Natarajan", guestId: "g4" },
    { id: "p6", name: "Tom Okafor", guestId: "g5" },
    { id: "p7", name: "Mei Lin", guestId: "g6" },
    { id: "p8", name: "Grandpa Walt", guestId: "g7" },
    { id: "p9", name: "The photographer", guestId: null },
  ]

  const suggestions = ["Auntie Lou", null, "Mei Lin", "Tom Okafor", null, "Rafael Domínguez-Ortiz", null, "Grandpa Walt", null, null, "Priya Natarajan", null]
  const sizes = [23, 18, 15, 14, 12, 11, 9, 8, 7, 6, 5, 4]
  let faceId = 1200
  let mediaId = 400
  const groups = sizes.map((size, gi) => {
    const faces = []
    for (let i = 0; i < size; i++) {
      faceId += 1 + Math.floor(r() * 3)
      const setAside = i >= size - Math.max(1, Math.floor(size / 7)) && size > 6
      faces.push({ id: faceId, mediaId: mediaId + Math.floor(r() * 60), setAside, v: Math.floor(r() * 1000) })
    }
    return {
      anchor: faces[0].id,
      identity: gi,
      suggestion: suggestions[gi],
      faces,
      named: null,
    }
  })

  const ask = []
  for (let i = 0; i < 10; i++) {
    faceId += 2
    const a = people[2 + (i % 6)]
    const b = people[2 + ((i + 3) % 6)]
    ask.push({
      id: faceId,
      mediaId: mediaId + Math.floor(r() * 60),
      identity: 20 + i,
      unlocks: 1 + Math.floor(r() * 7),
      candidates: [
        { personId: a.id, name: a.name, margin: 0.18 + r() * 0.2 },
        { personId: b.id, name: b.name, margin: 0.04 + r() * 0.08 },
      ],
      done: null,
    })
  }

  const gifts = [
    ["gf1", "g4", "Ceramic serving bowls", 0, "2026-05-02"],
    ["gf2", "g5", "Honeymoon fund", 150, "2026-05-02"],
    ["gf3", "g6", "Cookbook + a very long note", 0, "2026-05-03"],
    ["gf4", "g8", "Espresso grinder", 0, "2026-05-04"],
    ["gf5", "g10", "Hand-dyed linen napkins", 0, "2026-05-05"],
    ["gf6", "g9", "Hand-thrown serving bowl", 0, "2026-10-17"],
    ["gf7", "g11", "Honeymoon fund", 100, "2026-05-06"],
    ["gf8", "g12", "Picnic set", 0, "2026-05-07"],
    ["gf9", "g13", "Framed map of Portland", 0, "2026-05-07"],
    ["gf10", "g14", "Cash gift", 200, "2026-05-08"],
    ["gf11", "g16", "Vinyl records", 0, "2026-05-08"],
    ["gf12", "g17", "Cast iron pan", 0, "2026-05-09"],
    ["gf13", "g18", "Plant (a big one)", 0, "2026-05-10"],
    ["gf14", "g19", "Challah cover", 0, "2026-05-11"],
    ["gf15", "g2", "Mezcal and two glasses", 0, "2026-05-01"],
    ["gf16", "g1", "Quilt", 0, "2026-04-30"],
  ].map(([id, guestId, desc, amount, received]) => ({ id, guestId, desc, amount, received }))

  const cards = [
    { id: "c1", guestId: "g1", giftId: "gf16", status: "viewed", message: "Dear Auntie Lou, the quilt is on our bed already…", theme: "Garden", sentVia: "email", reply: { emoji: "💛", text: "I cried. Call me!", unread: true, ago: "2 h" } },
    { id: "c2", guestId: "g2", giftId: "gf15", status: "viewed", message: "Rafa — the mezcal did not survive the week…", theme: "Fiesta", sentVia: "sms", reply: { emoji: "🎉", text: "Salud! Next round on me.", unread: true, ago: "yesterday" } },
    { id: "c3", guestId: "g4", giftId: "gf1", status: "viewed", message: "Dear Priya, the bowls are perfect…", theme: "Garden", sentVia: "email", reply: { emoji: "😍", text: "So glad you love them.", unread: true, ago: "2 days" } },
    { id: "c4", guestId: "g13", giftId: "gf9", status: "sent", message: "Marcus, the map is up in the hallway…", theme: "Classic", sentVia: "email", reply: null },
    { id: "c5", guestId: "g19", giftId: "gf14", status: "viewed", message: "Dear Ruth…", theme: "Classic", sentVia: "email", reply: { emoji: "❤️", text: "Mazel tov again, my dears.", unread: false, ago: "1 week" } },
    { id: "c6", guestId: "g5", giftId: "gf2", status: "draft", message: "Dear Tom, thank you for the honeymoon fund — we spent it on the best dinner of the trip.", theme: "Champagne", sentVia: null, reply: null },
    { id: "c7", guestId: "g6", giftId: "gf3", status: "draft", message: "Mei! The note made us both cry, and the cookbook is already splattered.", theme: "Garden", sentVia: null, reply: null },
    { id: "c8", guestId: "g8", giftId: "gf4", status: "draft", message: "Ben, our mornings are better now. Thank you for the grinder.", theme: "Classic", sentVia: null, reply: null },
    { id: "c9", guestId: "g10", giftId: "gf5", status: "draft", message: "Dear Keiko, the napkins are too beautiful to use. We use them anyway.", theme: "Garden", sentVia: null, reply: null },
  ]

  const guests = GUESTS.map((g, i) => ({
    ...g,
    status: i < 15 ? "responded" : i < 18 ? "invited" : "pending",
    party: 1 + (i % 3),
    attending: i % 5 !== 3,
  }))

  return {
    mode: "post",
    moderation,
    people,
    groups,
    ask,
    moments: [
      { id: "mo1", name: "Auntie Lou", count: 3, done: false },
      { id: "mo2", name: "Jesse", count: 6, done: false },
      { id: "mo3", name: "Tom Okafor", count: 2, done: false },
    ],
    setAside: [
      { mediaId: 431, faces: 4 },
      { mediaId: 437, faces: 2 },
      { mediaId: 442, faces: 6 },
    ],
    facesTotal: 540,
    facesNamedBase: 312,
    batches: [
      { id: "b31", kind: "Named a group", detail: "11 faces → Jesse", ago: "yesterday", revoked: false },
      { id: "b30", kind: "Same moment", detail: "4 faces → Jordana", ago: "2 days ago", revoked: false },
    ],
    gifts,
    cards,
    guests,
    petitions: [{ id: "pt8", name: "Carla Mendes", note: "I am Owen's partner — he RSVP'd for one by mistake. Would love to see the photos!", status: "pending", ago: "2 days" }],
    blocklist: [{ id: "bl1", value: "spam@example.net" }],
    accounts: [
      { id: "a1", name: "Hannah Kim", trusted: false, posts: 2 },
      { id: "a2", name: "Mei Lin", trusted: true, posts: 9 },
      { id: "a3", name: "Owen Brady", trusted: false, posts: 2 },
      { id: "a4", name: "Theo Nguyen", trusted: true, posts: 14 },
      { id: "a5", name: "Lucía Romero", trusted: false, posts: 1 },
    ],
    official: [410, 405, 418, 422, 407, 433, 401, 419],
    loved: [{ mediaId: 444, author: "Ben Adler", hearts: 31 }, { mediaId: 447, author: "Theo Nguyen", hearts: 22 }, { mediaId: 452, author: "Mei Lin", hearts: 17 }],
    siteContent: { headline: "Thank you for celebrating with us", body: "The photos are in! Add yours to the gallery, leave us a note in the guestbook, and find yourself in the pictures." },
    done: [],
    snoozed: [],
    sendBatch: null,
    nextCardId: 10,
    sprint: null,
    setDoneToday: false,
    expireArmed: false,
  }
}

/** @type {ReturnType<typeof initialState>} */
export let state = load()

function load() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // fall through to a fresh state
  }
  return initialState()
}

export function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // sessionStorage unavailable: progress just won't survive reload
  }
}

export function reset() {
  state = initialState()
  save()
}

export const guestById = (id) => state.guests.find((g) => g.id === id)
export const giftById = (id) => state.gifts.find((g) => g.id === id)
export const cardById = (id) => state.cards.find((c) => c.id === id)

/** Record something finished, for Today's "Done today" list. */
export function logDone(area, text) {
  state.done.unshift({ area, text, at: Date.now() })
  save()
}

// ---- derived counts (what Today and the nav badges read) -----------------

export function pendingModeration() {
  return state.moderation.filter((m) => m.status === "pending")
}
export function unreadReplies() {
  return state.cards.filter((c) => c.reply && c.reply.unread)
}
export function draftCards() {
  return state.cards.filter((c) => c.status === "draft")
}
export function pendingPetitions() {
  return state.petitions.filter((p) => p.status === "pending")
}
export function unnamedGroups() {
  return state.groups.filter((g) => !g.named)
}
export function openAsk() {
  return state.ask.filter((a) => !a.done)
}
export function openMoments() {
  return state.moments.filter((m) => !m.done)
}
export function facesNamed() {
  let n = state.facesNamedBase
  for (const g of state.groups) if (g.named) n += g.named.count
  for (const a of state.ask) if (a.done && a.done.personId) n += 1
  for (const m of state.moments) if (m.done) n += m.count
  return n
}

/** The thank-you worklist: guests with a gift and no sent card (mirrors
 *  computeWorklist in public/pages/admin/thank-you.js). */
export function thanksProgress() {
  const owed = new Set(state.gifts.map((g) => g.guestId))
  const thanked = new Set(
    state.cards.filter((c) => c.status !== "draft").map((c) => c.guestId),
  )
  const drafted = new Set(state.cards.map((c) => c.guestId))
  const remaining = state.gifts
    .filter((g) => !thanked.has(g.guestId) && !drafted.has(g.guestId))
    .sort((a, b) => (a.received < b.received ? -1 : 1))
  return { owed: owed.size, thanked: [...owed].filter((g) => thanked.has(g)).length, remaining }
}
