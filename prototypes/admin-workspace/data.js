/** @file Fake data for the Workspace admin prototype. Every name here is
 *  fictional; no real guest, photo, or face appears. Faces and photos are drawn
 *  as generated SVG (art.js) from the `hue`/`seed` numbers below, never images.
 *
 *  The store is persisted to sessionStorage so a reload keeps whatever you did
 *  in the prototype (approved items, named groups, sent cards). `?reset` on any
 *  URL starts fresh. */

const KEY = "admin-workspace-store-v3"

/** @param {number} n */
const hueOf = (n) => (n * 47) % 360

const PEOPLE_NAMES = [
  "Rosa Méndez", "Theo Lindqvist", "Auntie Lou", "Priya Raman", "Marcus Bell",
  "June Okafor", "Rafael Domínguez-Ortiz", "Hannah Weiss", "Sam Whitaker",
  "Grandpa Walt", "Ines Moreau", "Kofi Mensah", "Dana Kim", "Oliver Byrne",
]

function seedPeople() {
  return PEOPLE_NAMES.map((name, i) => ({
    id: 10 + i,
    name,
    hue: hueOf(i + 3),
    guestId: i % 3 === 2 ? null : 100 + i,
    faces: [3, 7, 22, 15, 9, 4, 11, 6, 2, 8, 5, 3, 1, 4][i],
  }))
}

/** Unnamed face groups. `faceIds[0]` is not special — any face id anchors its
 *  group, which is the whole point of anchoring on a face. */
function seedGroups() {
  const specs = [
    { size: 14, aside: 2, suggest: 10, margin: 0.21 },
    { size: 11, aside: 1, suggest: 11, margin: 0.18 },
    { size: 9, aside: 0, suggest: 13, margin: 0.09 },
    { size: 8, aside: 1, suggest: null, margin: null },
    { size: 7, aside: 0, suggest: 14, margin: 0.24 },
    { size: 6, aside: 2, suggest: null, margin: null },
    { size: 5, aside: 0, suggest: 17, margin: 0.05 },
    { size: 4, aside: 0, suggest: null, margin: null },
    { size: 3, aside: 1, suggest: 19, margin: 0.15 },
  ]
  let faceId = 1201
  let mediaId = 300
  return specs.map((s, gi) => {
    const faces = []
    for (let i = 0; i < s.size; i++) {
      faces.push({
        id: faceId++,
        mediaId: mediaId + ((i * 7 + gi * 3) % 40),
        hue: hueOf(gi + 1),
        seed: gi * 31 + i,
        setAside: i >= s.size - s.aside,
      })
    }
    mediaId += 2
    return {
      key: "g" + gi,
      faces,
      suggestion: s.suggest ? { personId: s.suggest, margin: s.margin } : null,
      done: null,
    }
  })
}

function seedAsk() {
  /** @type {any[]} */
  const items = []
  const cands = [
    [10, 12, 18], [11, 15], [16, 13, 21], [14], [17, 10], [18, 22], [19, 20, 11], [12],
  ]
  for (let i = 0; i < cands.length; i++) {
    items.push({
      id: 2001 + i,
      mediaId: 340 + i,
      hue: hueOf(i + 20),
      seed: 400 + i,
      unlocks: [6, 5, 4, 4, 3, 2, 1, 1][i],
      reason: ["blurry", "side-on", "small in frame", "partly hidden", "side-on", "blurry", "small in frame", "dim"][i],
      candidates: cands[i].map((pid, k) => ({ personId: pid, distance: 0.38 + k * 0.07 })),
      done: null,
    })
  }
  return items
}

function seedPropagations() {
  return [0, 1, 2, 3, 4].map((i) => ({
    toFaceId: 3001 + i,
    fromFaceId: 1201 + i * 2,
    personId: [10, 12, 15, 11, 16][i],
    hue: hueOf(i + 40),
    seed: 500 + i,
    applied: false,
    checked: true,
  }))
}

function seedLeftovers() {
  return [0, 1, 2, 3].map((i) => ({
    mediaId: 380 + i,
    seed: 600 + i,
    faces: [3, 1, 2, 4][i],
    unnamed: [3, 1, 2, 3][i],
    caption: ["Dance floor, late", "Cake table", "Back row of the group photo", "Sparkler exit"][i],
  }))
}

function seedReview() {
  const rows = [
    ["photo", "Hannah Weiss", "Friend of the bride", false, "The moment the rings came out", 18],
    ["message", "Grandpa Walt", "Grandfather of the groom", true, "Sixty-one years married and I still cried. Proud of you both. Keep dancing.", 22],
    ["comment", "Sam Whitaker", "College roommate", false, "Is that ME in the background?? I look like I'm narrating a nature documentary", 31],
    ["video", "Priya Raman", "Cousin", true, "First dance, from the balcony", 40],
    ["photo", "Kofi Mensah", "Plus-one", false, "", 55],
    ["message", "Dana Kim", "Coworker", false, "Thank you for the best taco truck of my life. Also congratulations.", 63],
    ["comment", "Ines Moreau", "Neighbour", false, "Gorgeous. The light in this one!", 70],
    ["photo", "Marcus Bell", "Groomsman", true, "Groomsmen, unsupervised", 84],
    ["photo", "June Okafor", "Friend of the groom", false, "Sparklers!!", 95],
    ["message", "Oliver Byrne", "Cousin", false, "Congrats! Sorry I spilled the champagne on the cake stand. Well, near it.", 120],
    ["comment", "Theo Lindqvist", "Best man", true, "Speech transcript available upon request (please do not request)", 150],
    ["video", "Rosa Méndez", "Maid of honour", true, "Bouquet toss, slow motion", 190],
    ["photo", "Hannah Weiss", "Friend of the bride", false, "Table 6 assembled", 240],
    ["message", "Auntie Lou", "Aunt of the bride", true, "Call your mother. Both of you. Love, Auntie Lou", 300],
  ]
  return rows.map((r, i) => ({
    id: 400 + i,
    type: /** @type {string} */ (r[0]),
    author: /** @type {string} */ (r[1]),
    relation: /** @type {string} */ (r[2]),
    trusted: /** @type {boolean} */ (r[3]),
    text: /** @type {string} */ (r[4]),
    minutesAgo: /** @type {number} */ (r[5]),
    seed: 700 + i,
    status: "pending",
    parent: r[0] === "comment" ? { kind: i % 2 ? "photo" : "message", author: "Rosa Méndez", snippet: i % 2 ? "Golden hour on the terrace" : "We love you two so much!", seed: 800 + i } : null,
  }))
}

function seedGuests() {
  const names = [
    "Auntie Lou", "Grandpa Walt", "Hannah Weiss", "Kofi Mensah & Abena Mensah", "Dana Kim",
    "Ines Moreau", "Marcus Bell", "June Okafor", "Oliver Byrne", "Priya Raman & Dev Raman",
    "Rafael Domínguez-Ortiz", "Rosa Méndez", "Sam Whitaker", "Theo Lindqvist", "The Fairbanks Family",
    "Mira & Joel Castellanos", "Bea Thornton", "Uncle Ray", "Nadia Petrova", "Callum Reid",
  ]
  return names.map((name, i) => ({
    id: 100 + i,
    name,
    email: i % 5 === 3 ? "" : name.split(" ")[0].toLowerCase().replaceAll("&", "") + "@example.com",
    phone: i % 4 === 1 ? "(503) 555-01" + String(10 + i) : "",
    party: name.includes("&") ? 2 : name.includes("Family") ? 4 : 1,
    rsvp: ["yes", "yes", "yes", "yes", "no", "yes", "yes", "yes", "yes", "yes"][i % 10],
  }))
}

function seedGifts(/** @type {any[]} */ guests) {
  const items = [
    "Cast-iron dutch oven", "Honeymoon dinner fund", "Hand-thrown mugs (set of 4)", "Cheque",
    "Vintage record player", "Quilt (handmade!)", "Garden tools + seeds", "Cocktail book & bitters",
    "Kayak day trip voucher", "Framed map of Portland", "Espresso machine", "Picnic set",
  ]
  return items.map((desc, i) => ({
    id: 41 + i,
    guestId: guests[i].id,
    description: desc,
    amount: i === 1 ? "$200" : i === 3 ? "$150" : "",
    received: "2026-0" + (4 + (i % 2)) + "-" + String(10 + i),
    physicalCard: i % 4 === 0,
  }))
}

function seedCards(/** @type {any[]} */ gifts) {
  const statuses = ["viewed", "viewed", "sent", "viewed", "draft", "draft", "draft", "draft", "draft", "draft"]
  return statuses.map((status, i) => ({
    id: 17 + i,
    giftId: gifts[i].id,
    guestId: gifts[i].guestId,
    status,
    via: status === "draft" ? null : ["email", "sms", "link", "email"][i % 4],
    message: "Dear {name}, thank you so much for the " + gifts[i].description.toLowerCase() + ". It already feels like it has always lived with us.",
    theme: ["gratitude", "golden hour", "garden", "confetti"][i % 4],
    photos: (i % 3) + 1,
    reply: status === "viewed" && i !== 3 ? { emoji: i === 0 ? "heart" : "laugh", text: i === 0 ? "We cried! Love you both." : "The photo of Walt dancing!! Framing it.", seen: i !== 1, ago: i === 0 ? 50 : 300 } : null,
  }))
}

function fresh() {
  const guests = seedGuests()
  const gifts = seedGifts(guests)
  return {
    mode: "post",
    people: seedPeople(),
    groups: seedGroups(),
    ask: seedAsk(),
    propagations: seedPropagations(),
    leftovers: seedLeftovers(),
    review: seedReview(),
    guests,
    gifts,
    cards: seedCards(gifts),
    batches: [{ id: 1, label: "Named 6 faces Kofi Mensah", minutesAgo: 1440, revoked: false }],
    sendFlow: null,
    nextId: 9000,
  }
}

/** @returns {ReturnType<typeof fresh>} */
function load() {
  if (location.search.includes("reset")) {
    sessionStorage.removeItem(KEY)
  }
  const raw = sessionStorage.getItem(KEY)
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {
      // fall through to fresh data
    }
  }
  return fresh()
}

export const store = load()

export function save() {
  sessionStorage.setItem(KEY, JSON.stringify(store))
}

/** @param {number} id */
export const person = (id) => store.people.find((p) => p.id === id)
/** @param {number} id */
export const guest = (id) => store.guests.find((g) => g.id === id)
/** @param {number} id */
export const gift = (id) => store.gifts.find((g) => g.id === id)

/** The group holding face `id`, or undefined. Groups are found BY FACE, never
 *  by position — a URL that names a face survives regrouping. */
export function groupOfFace(/** @type {number} */ id) {
  return store.groups.find((g) => g.faces.some((f) => f.id === id))
}

export const pendingReview = () => store.review.filter((r) => r.status === "pending")
export const groupsLeft = () => store.groups.filter((g) => !g.done)
export const askLeft = () => store.ask.filter((a) => !a.done)
export const propsLeft = () => store.propagations.filter((p) => !p.applied)
export const leftoversLeft = () => store.leftovers.filter((l) => l.unnamed > 0)
export const drafts = () => store.cards.filter((c) => c.status === "draft")
export const unreadReplies = () => store.cards.filter((c) => c.reply && !c.reply.seen)
export const giftsUnthanked = () =>
  store.gifts.filter((g) => !store.cards.some((c) => c.giftId === g.id))

/** @param {number} minutes */
export function ago(minutes) {
  if (minutes < 60) return minutes + "m ago"
  if (minutes < 1440) return Math.round(minutes / 60) + "h ago"
  return Math.round(minutes / 1440) + "d ago"
}
