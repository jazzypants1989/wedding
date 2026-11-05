/** @file Pure, DOM-free helpers for the thank-you composer, split out of
 *  thank-you.js so they can be unit-tested in Node without importing the
 *  DOM-touching admin modules. No regex (CLAUDE.md): token substitution and
 *  value comparison use string methods / JSON only.
 *
 *  - renderMessage: substitute {token} placeholders (e.g. {name}) in the card
 *    message so the live preview shows the resolved text.
 *  - diffConfig: reduce a full effect config to the sparse partial that differs
 *    from the effect's defaults — the card stores sparse partials, never full
 *    configs (matches the effects_config contract). */
/** @import * as Types from "./types.js" */

/**
 * Warm starter messages for the composer's template picker (E4). Each uses the
 * {name} placeholder, resolved live through renderMessage. Item-based templates
 * (honeymoon, registry) also carry a {gift} slot woven from the linked gift's
 * description (task 2, weaveGift) with a template-appropriate `giftFallback`
 * when no description exists, so the sentence always reads naturally. Pure data
 * — no DOM, no regex. `generic` doubles as the smart default for a brand-new
 * card (and for gift-less cards).
 * @type {Types.ThankYouTemplate[]}
 */
export const THANK_YOU_TEMPLATES = [
  {
    id: "generic",
    label: "Warm & general",
    message:
      "Dear {name},\n\nThank you so much for celebrating with us and for your incredible generosity. It truly meant the world to share our day with you. We feel so lucky to have you in our lives.\n\nWith love and gratitude,",
  },
  {
    id: "honeymoon",
    label: "Honeymoon fund",
    giftFallback: "honeymoon",
    message:
      "Dear {name},\n\nThank you from the bottom of our hearts for your generous gift toward our {gift}! Thanks to you we'll be making memories we treasure forever — and thinking of you the whole time. We're so grateful for your kindness.\n\nWith love,",
  },
  {
    id: "registry",
    label: "Registry gift",
    giftFallback: "wonderful gift",
    message:
      "Dear {name},\n\nThank you so much for the {gift}! It has already found a perfect place in our home, and we'll think of you every time we use it. We're so grateful you were part of our celebration.\n\nWith love and thanks,",
  },
  {
    id: "cash",
    label: "Cash gift",
    message:
      "Dear {name},\n\nThank you so much for your thoughtful and generous gift. Your kindness is helping us build our life together, and we're so touched. It meant the world to celebrate with you.\n\nWith love,",
  },
]

/**
 * One-tap occasion presets (D3): a matching theme + a curated effect stack.
 * Effect ids match the registry (public/effects/registry.js) and each config is
 * the effect's defaults (an empty sparse partial), which is always valid per
 * effect-config-schema. Kept here (the pure, DOM-free module) so it's unit-
 * testable against the schema. Theme ids are real EFFECT_THEMES ids.
 * @type {{ id: string, label: string, theme: string, effects: { id: string, config: Record<string, unknown> }[] }[]}
 */
/** A theme's config for one effect, as a card's starting point. Without `pages`:
 *  that says where the effect runs on the site, and a card isn't one of those
 *  places. Left in, it would be stored on the card and drawn as a control.
 *  @param {{ configs?: Record<string, Record<string, unknown>> }} theme
 *  @param {string} id
 *  @returns {Record<string, unknown>} */
export function themeSeedConfig(theme, id) {
  const config = structuredClone(theme.configs?.[id] ?? {})
  delete config.pages
  return config
}

export const OCCASION_PRESETS = [
  {
    id: "toast",
    label: "🥂 Toast",
    theme: "elegant",
    effects: [
      { id: "fizz", config: {} },
      { id: "frameglint", config: {} },
    ],
  },
  {
    id: "festival",
    label: "🏮 Festival",
    theme: "celebration",
    effects: [
      { id: "lanterns", config: {} },
      { id: "inksparkle", config: {} },
    ],
  },
  {
    id: "jubilee",
    label: "🎊 Jubilee",
    theme: "gratitude",
    effects: [
      { id: "confettidrift", config: {} },
      { id: "ribbons", config: {} },
    ],
  },
]

/**
 * A minimal gift shape for template selection / weaving — a real GiftWithGuest
 * is assignable to this. `amount` is admin-only and is used ONLY as a selection
 * signal here; it is NEVER woven into card text (only `description` is shown).
 * @typedef {{ description?: string | null, amount?: string | null, notes?: string | null }} GiftLike
 */

/** Keyword buckets for smart template selection (task 2). Plain substrings,
 *  matched with includes() — no regex (CLAUDE.md). */
const HONEYMOON_WORDS = [
  "honeymoon",
  "travel",
  "trip",
  "flight",
  "airfare",
  "getaway",
  "adventure",
  "vacation",
]
const CASH_WORDS = [
  "cash",
  "check",
  "cheque",
  "venmo",
  "paypal",
  "zelle",
  "money",
  "gift card",
  "visa",
]
const REGISTRY_WORDS = [
  "registry",
  "kitchen",
  "dish",
  "towel",
  "linen",
  "bedding",
  "cookware",
  "pot",
  "pan",
  "appliance",
  "plate",
  "bowl",
  "vase",
  "home",
]

/** @param {string} hay @param {string[]} words @returns {boolean} */
function hasAny(hay, words) {
  return words.some((w) => hay.includes(w))
}

/**
 * Pick the best-fitting starter template id from a linked gift's fields (task 2).
 * Selection reads description + notes (lowercased) as keyword signals, then falls
 * back to amount/description presence, then to the general starter. A null/empty
 * gift (gift-less card) always maps to `generic`. Pure — no DOM, no regex.
 * @param {GiftLike | null | undefined} gift
 * @returns {string}
 */
export function selectTemplateId(gift) {
  if (!gift) return "generic"
  /** @type {string[]} */
  const parts = []
  if (typeof gift.description === "string" && gift.description) parts.push(gift.description)
  if (typeof gift.notes === "string" && gift.notes) parts.push(gift.notes)
  const hay = parts.join(" ").toLowerCase()
  if (hasAny(hay, HONEYMOON_WORDS)) return "honeymoon"
  if (hasAny(hay, CASH_WORDS)) return "cash"
  if (hasAny(hay, REGISTRY_WORDS)) return "registry"
  // No keyword hit: a bare monetary amount reads as cash; a described physical
  // item reads as a registry gift; otherwise the warm general starter.
  if (typeof gift.amount === "string" && gift.amount.trim()) return "cash"
  if (typeof gift.description === "string" && gift.description.trim()) return "registry"
  return "generic"
}

/**
 * Substitute the `{gift}` slot in a template message with the gift's description,
 * falling back to `fallback` (or a neutral "gift") when there's no description,
 * so the sentence always reads naturally. Messages without a `{gift}` slot are
 * returned unchanged. No regex — a literal split/join like renderMessage.
 * @param {string} message
 * @param {string | null | undefined} description
 * @param {string | null | undefined} [fallback]
 * @returns {string}
 */
export function weaveGift(message, description, fallback) {
  if (typeof message !== "string") return ""
  if (message.indexOf("{gift}") === -1) return message
  const desc = typeof description === "string" ? description.trim() : ""
  const fill = desc || (typeof fallback === "string" && fallback ? fallback : "gift")
  return message.split("{gift}").join(fill)
}

/** First name for the {name} slot: the text up to the first space, else the
 *  whole thing, else "friend". No regex. @param {string} name @returns {string} */
function firstName(name) {
  const t = typeof name === "string" ? name.trim() : ""
  if (!t) return "friend"
  const sp = t.indexOf(" ")
  return sp === -1 ? t : t.slice(0, sp)
}

/**
 * Build a NEW card's smart default message (task 2): auto-pick the best-fitting
 * template from the gift, weave the gift description into its {gift} slot, and
 * resolve {name} to the recipient's first name — ready to edit. A null gift
 * (gift-less card) uses the general starter with the name resolved. This only
 * seeds brand-new cards; saved cards and localStorage drafts are never touched.
 * @param {GiftLike | null | undefined} gift
 * @param {string} recipientName
 * @returns {string}
 */
export function buildSeedMessage(gift, recipientName) {
  const id = selectTemplateId(gift)
  const tpl = THANK_YOU_TEMPLATES.find((t) => t.id === id) || THANK_YOU_TEMPLATES[0]
  const desc = gift && typeof gift.description === "string" ? gift.description : ""
  const woven = weaveGift(tpl.message, desc, tpl.giftFallback)
  return renderMessage(woven, { name: firstName(recipientName) })
}

/**
 * Reroll to a DIFFERENT starter than the smart default (task D2's "↻ Reroll"):
 * deterministically rotate through THANK_YOU_TEMPLATES by click count, weave the
 * gift's description into the {gift} slot, and resolve {name}. `rerollCount` is
 * 1-based (the first click yields the template after the gift's best-fit pick),
 * so repeated clicks cycle predictably. Pure — no DOM, no regex.
 * @param {GiftLike | null | undefined} gift
 * @param {string} recipientName
 * @param {number} rerollCount
 * @returns {string}
 */
export function rerollSeedMessage(gift, recipientName, rerollCount) {
  // Anchor the rotation at the gift's best-fit template so click #1 lands on the
  // NEXT starter, not a repeat of the seeded default.
  const baseId = selectTemplateId(gift)
  const baseIdx = THANK_YOU_TEMPLATES.findIndex((t) => t.id === baseId)
  const anchor = baseIdx === -1 ? 0 : baseIdx
  const n = THANK_YOU_TEMPLATES.length
  const safeCount = Number.isFinite(rerollCount) ? Math.trunc(rerollCount) : 0
  const idx = (((anchor + safeCount) % n) + n) % n
  const tpl = THANK_YOU_TEMPLATES[idx]
  const desc = gift && typeof gift.description === "string" ? gift.description : ""
  const woven = weaveGift(tpl.message, desc, tpl.giftFallback)
  return renderMessage(woven, { name: firstName(recipientName) })
}

/**
 * Substitute `{key}` placeholders in `template` with `vars[key]`. Unknown
 * placeholders are left untouched. No regex — each key is a literal replaceAll.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function renderMessage(template, vars) {
  if (typeof template !== "string") return ""
  let out = template
  for (const key of Object.keys(vars)) {
    out = out.split("{" + key + "}").join(vars[key])
  }
  return out
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Structural equality for the simple JSON shapes effect configs hold (numbers,
 *  strings, booleans, and arrays/objects of those). JSON serialization is stable
 *  for same-ordered keys, which is what mergeConfig preserves. No regex.
 *  @param {unknown} a @param {unknown} b @returns {boolean} */
function deepEqual(a, b) {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Return the sparse partial of `current` that differs from `defaults`: only keys
 * whose value isn't deep-equal to the default are kept (nested plain objects
 * recurse; an all-equal nested object is dropped). Keys absent from `defaults`
 * are always kept (a genuinely new field). The result is a fresh object; neither
 * input is mutated.
 * @param {Record<string, unknown>} defaults
 * @param {Record<string, unknown>} current
 * @returns {Record<string, unknown>}
 */
export function diffConfig(defaults, current) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const key of Object.keys(current)) {
    const cur = current[key]
    const def = defaults ? defaults[key] : undefined
    if (isPlainObject(cur) && isPlainObject(def)) {
      const nested = diffConfig(def, cur)
      if (Object.keys(nested).length > 0) out[key] = nested
      continue
    }
    if (!deepEqual(cur, def)) out[key] = cur
  }
  return out
}

// ==================== Workspace lists (Gifts · Cards · Replies) ====================

/** The one word a card's state reads as in the lists (prototype `statusOf`): a
 *  reply outranks an open, an open outranks a send. Pure.
 *  @param {{ status: string, viewed_at: string | null, replied_at: string | null }} card
 *  @returns {"draft" | "sent" | "opened" | "replied"} */
export function cardStatus(card) {
  if (card.status === "draft") return "draft"
  if (card.replied_at) return "replied"
  if (card.viewed_at || card.status === "viewed") return "opened"
  return "sent"
}

/** Label for each cardStatus() value (also the Cards filter chips). */
export const CARD_STATUS_LABEL = /** @type {const} */ ({
  draft: "Draft",
  sent: "Sent",
  opened: "Opened",
  replied: "Replied",
})

/** Parse an ISO-8601 or SQLite `YYYY-MM-DD HH:MM:SS` (UTC, no zone) timestamp
 *  to epoch ms; NaN when unparseable. No regex.
 *  @param {string | null | undefined} iso @returns {number} */
export function parseStamp(iso) {
  if (typeof iso !== "string" || !iso) return NaN
  let s = iso.trim()
  if (!s.includes("T") && s.includes(" ")) s = s.replace(" ", "T")
  const tail = s.slice(10)
  const zoned = tail.endsWith("Z") || tail.includes("+") || tail.includes("-")
  if (s.includes("T") && !zoned) s += "Z"
  return Date.parse(s)
}

/** The list's compact time ("12m ago", "5h ago", "3d ago", then a date), as the
 *  prototype's rows show it. Pure: `nowMs` is injectable for tests.
 *  @param {string | null | undefined} iso @param {number} [nowMs] @returns {string} */
export function shortAgo(iso, nowMs = Date.now()) {
  const then = parseStamp(iso)
  if (Number.isNaN(then)) return ""
  const minutes = Math.max(0, Math.round((nowMs - then) / 60000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return minutes + "m ago"
  if (minutes < 1440) return Math.round(minutes / 60) + "h ago"
  if (minutes < 1440 * 14) return Math.round(minutes / 1440) + "d ago"
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** Compute the thank-you worklist from gift + card lists. Pure — shared by the
 *  Gifts list, the composer's "write the next one" and Home (inbox.js), so the
 *  "who do we still owe" logic lives in exactly one place.
 *
 *  "owed" = distinct guests we owe a thank-you: every guest with a logged gift,
 *  PLUS the guests of any gift-less card (we chose to thank them even without a
 *  gift). "thanked" = those owed guests who have at least one card that's actually
 *  been SENT (`sent_at` set — status sent or viewed); a still-draft card doesn't
 *  count. "remaining" = owed-but-not-thanked, de-duped, in gift order then
 *  gift-less-card order.
 *  @param {Array<{ guest_id: number, guest_name: string }>} gifts
 *  @param {Array<{ guest_id: number, guest_name: string, gift_id: number | null, sent_at: string | null }>} cards
 *  @returns {{ owed: number, thanked: number, remaining: { guestId: number, name: string }[] }} */
export function computeWorklist(gifts, cards) {
  /** @type {Set<number>} */
  const owed = new Set()
  for (const g of gifts) owed.add(g.guest_id)
  for (const c of cards) if (c.gift_id == null) owed.add(c.guest_id)
  /** @type {Set<number>} */
  const thanked = new Set()
  for (const c of cards) {
    if (c.sent_at && owed.has(c.guest_id)) thanked.add(c.guest_id)
  }
  /** @type {Set<number>} */
  const seen = new Set()
  /** @type {{ guestId: number, name: string }[]} */
  const remaining = []
  for (const g of gifts) {
    if (thanked.has(g.guest_id) || seen.has(g.guest_id)) continue
    seen.add(g.guest_id)
    remaining.push({ guestId: g.guest_id, name: g.guest_name })
  }
  for (const c of cards) {
    if (c.gift_id != null) continue
    if (thanked.has(c.guest_id) || seen.has(c.guest_id)) continue
    seen.add(c.guest_id)
    remaining.push({ guestId: c.guest_id, name: c.guest_name })
  }
  return { owed: owed.size, thanked: thanked.size, remaining }
}

/** "Save and write the next one" (IA §13.2): the next guest still owed a
 *  thank-you who has no card at all yet (a drafted card is written — it's
 *  waiting in Cards for the batch send), skipping the one just written. Null
 *  when everyone has a card: the composer then reads "Save and finish".
 *  @param {Array<{ id: number, guest_id: number, guest_name: string }>} gifts
 *  @param {Array<{ id: number, guest_id: number, guest_name: string, gift_id: number | null, sent_at: string | null, status: string }>} cards
 *  @param {number | null} excludeGuestId
 *  @returns {{ guestId: number, name: string, giftId: number | null } | null} */
export function nextToWrite(gifts, cards, excludeGuestId) {
  /** @type {Set<number>} */
  const drafted = new Set()
  for (const c of cards) if (c.status === "draft") drafted.add(c.guest_id)
  for (const r of computeWorklist(gifts, cards).remaining) {
    if (r.guestId === excludeGuestId || drafted.has(r.guestId)) continue
    const gift = gifts.find((g) => g.guest_id === r.guestId)
    return { guestId: r.guestId, name: r.name, giftId: gift ? gift.id : null }
  }
  return null
}

/** Which ways a card can go to one guest, and why not when it can't: the
 *  guest's contact on file, and whether the site has Resend / Twilio keys. A
 *  channel we can't use is shown disabled with its reason, never hidden
 *  (IA §5 C), so it's clear why someone is getting a link. Pure.
 *  @param {{ email: string | null, phone: string | null }} contact
 *  @param {{ email: boolean, sms: boolean }} configured
 *  @returns {Array<{ key: "email" | "sms" | "link", label: string, ok: boolean, why: string }>} */
export function channelOptions(contact, configured) {
  /** @param {boolean} has @param {boolean} set @param {string} what */
  const why = (has, set, what) => (!set ? "not set up on this site" : !has ? `no ${what} on file` : "")
  return [
    {
      key: "email",
      label: "Email",
      ok: !!contact.email && configured.email,
      why: why(!!contact.email, configured.email, "email"),
    },
    {
      key: "sms",
      label: "Text message",
      ok: !!contact.phone && configured.sms,
      why: why(!!contact.phone, configured.sms, "phone number"),
    },
    { key: "link", label: "Copy a link (send it yourself)", ok: true, why: "" },
  ]
}

/** The channel a card is pre-picked to go by: email if we can, else a text,
 *  else a link the couple sends themselves (IA §5 C step 2).
 *  @param {{ email: string | null, phone: string | null }} contact
 *  @param {{ email: boolean, sms: boolean }} configured
 *  @returns {"email" | "sms" | "link"} */
export function defaultChannel(contact, configured) {
  const usable = channelOptions(contact, configured).find((o) => o.ok)
  return usable ? usable.key : "link"
}
