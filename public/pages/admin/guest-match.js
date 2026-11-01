/**
 * @file Matching a photographed person to the guest list. Pure: no DOM, no
 *  fetch, so the rules can be unit-tested.
 *
 *  Faces get named informally ("Aunt Sue", "Mike"), and an invitation is named
 *  formally, often for a whole party ("Michael & Dana Rossi"). Three jobs:
 *  give every guest a label the type-ahead can tell apart, even when two guests
 *  share a name; resolve what was typed to exactly one guest; and rank the
 *  guests a person's informal name most likely refers to.
 *
 *  String methods only (no regex).
 */

/** @import * as Types from './types.js' */

/** Words that say who someone is to the couple, not what they're called. */
const IGNORED = new Set([
  "aunt",
  "auntie",
  "uncle",
  "grandma",
  "grandpa",
  "granny",
  "nana",
  "papa",
  "cousin",
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "the",
  "and",
  "family",
  "plus",
  "one",
  "guest",
])

/**
 * Short forms, both directions folded to one key. Inert data: the common ones
 * only, because a miss costs nothing but a typed name.
 * @type {Record<string, string>}
 */
const NICKNAMES = {
  mike: "michael",
  mikey: "michael",
  mick: "michael",
  liz: "elizabeth",
  lizzie: "elizabeth",
  beth: "elizabeth",
  betsy: "elizabeth",
  eliza: "elizabeth",
  bob: "robert",
  bobby: "robert",
  rob: "robert",
  robbie: "robert",
  bill: "william",
  billy: "william",
  will: "william",
  liam: "william",
  jim: "james",
  jimmy: "james",
  jamie: "james",
  joe: "joseph",
  joey: "joseph",
  kate: "katherine",
  katie: "katherine",
  kathy: "katherine",
  kat: "katherine",
  catherine: "katherine",
  kathryn: "katherine",
  tom: "thomas",
  tommy: "thomas",
  dan: "daniel",
  danny: "daniel",
  dave: "david",
  matt: "matthew",
  chris: "christopher",
  nick: "nicholas",
  tony: "anthony",
  steve: "steven",
  stephen: "steven",
  ben: "benjamin",
  sam: "samuel",
  alex: "alexander",
  andy: "andrew",
  drew: "andrew",
  ed: "edward",
  eddie: "edward",
  ted: "edward",
  greg: "gregory",
  jen: "jennifer",
  jenny: "jennifer",
  jess: "jessica",
  jessie: "jessica",
  meg: "margaret",
  maggie: "margaret",
  peggy: "margaret",
  sue: "susan",
  susie: "susan",
  suzy: "susan",
  becky: "rebecca",
  becca: "rebecca",
  vicky: "victoria",
  tori: "victoria",
  abby: "abigail",
  mandy: "amanda",
  pam: "pamela",
  pat: "patricia",
  patty: "patricia",
  trish: "patricia",
  debbie: "deborah",
  deb: "deborah",
  cindy: "cynthia",
  sandy: "sandra",
  chuck: "charles",
  charlie: "charles",
  hank: "henry",
  harry: "henry",
  jack: "john",
  johnny: "john",
  jon: "john",
  rick: "richard",
  rich: "richard",
  dick: "richard",
  larry: "lawrence",
  ron: "ronald",
  don: "donald",
  jerry: "gerald",
  gerry: "gerald",
  fred: "frederick",
  freddie: "frederick",
  al: "albert",
  ken: "kenneth",
  kenny: "kenneth",
  tim: "timothy",
  zach: "zachary",
  zack: "zachary",
  josh: "joshua",
  nate: "nathan",
  nathaniel: "nathan",
}

/**
 * The comparison words of a name: lower-cased, accents and punctuation gone,
 * relationship words dropped, nicknames folded.
 * @param {string} name
 * @returns {string[]}
 */
export function nameWords(name) {
  const folded = name.normalize("NFD").toLowerCase()
  /** @type {string[]} */
  const words = []
  let cur = ""
  for (const ch of folded) {
    const code = ch.charCodeAt(0)
    // A combining mark (U+0300–U+036F) is the accent NFD split off: drop it.
    if (code >= 0x300 && code <= 0x36f) continue
    const letter = ch.toLowerCase() !== ch.toUpperCase()
    const digit = ch >= "0" && ch <= "9"
    if (letter || digit || ch === "'") {
      if (ch !== "'") cur += ch
    } else if (cur) {
      words.push(cur)
      cur = ""
    }
  }
  if (cur) words.push(cur)
  return words.filter((w) => !IGNORED.has(w)).map((w) => NICKNAMES[w] ?? w)
}

/**
 * How well one informal word matches one formal word. Exact (after nickname
 * folding) beats a shared prefix ("chris" / "christina"), which beats sharing
 * only the first three letters.
 * @param {string} a @param {string} b
 */
function wordScore(a, b) {
  if (a === b) return 3
  const short = a.length <= b.length ? a : b
  const long = short === a ? b : a
  if (short.length >= 3 && long.startsWith(short)) return 2
  if (short.length >= 3 && long.slice(0, 3) === short.slice(0, 3)) return 1
  return 0
}

/** @type {Types.guestMatchScore} */
export function guestMatchScore(personName, guestName) {
  const p = nameWords(personName)
  const g = nameWords(guestName)
  if (p.length === 0 || g.length === 0) return 0
  let total = 0
  for (const w of p) {
    let best = 0
    for (const v of g) best = Math.max(best, wordScore(w, v))
    total += best
  }
  return total
}

/** @type {Types.suggestGuests} */
export function suggestGuests(personName, guests, limit = 3) {
  // At least one strong word: a lone three-letter overlap ("Dan" / "Dana")
  // is noise, not a suggestion.
  const MIN = 2
  return guests
    .map((guest) => ({ guest, score: guestMatchScore(personName, guest.name) }))
    .filter((s) => s.score >= MIN)
    .sort((a, b) => b.score - a.score || a.guest.name.localeCompare(b.guest.name))
    .slice(0, limit)
    .map((s) => s.guest)
}

/**
 * Fold a typed label to its comparison key, the way the type-ahead's values
 * are compared.
 * @param {string} s
 */
function labelKey(s) {
  return s.normalize("NFC").trim().toLowerCase()
}

/** @type {Types.guestChoices} */
export function guestChoices(guests) {
  /** @type {Map<string, number>} */
  const seen = new Map()
  for (const g of guests) seen.set(labelKey(g.name), (seen.get(labelKey(g.name)) ?? 0) + 1)
  return guests.map((g) => {
    if ((seen.get(labelKey(g.name)) ?? 0) < 2) return { ...g, label: g.name }
    // Same name as another guest: the label carries what tells them apart.
    const detail = g.email || g.phone || `invite ${g.inviteCode}`
    return { ...g, label: `${g.name} — ${detail}` }
  })
}

/** @type {Types.resolveGuestChoice} */
export function resolveGuestChoice(typed, choices) {
  const key = labelKey(typed)
  if (!key) return { kind: "none" }
  const exact = choices.filter((c) => labelKey(c.label) === key)
  if (exact.length === 1) return { kind: "one", guest: exact[0] }
  const byName = choices.filter((c) => labelKey(c.name) === key)
  if (byName.length === 1) return { kind: "one", guest: byName[0] }
  if (byName.length > 1) return { kind: "ambiguous" }
  return { kind: "none" }
}
