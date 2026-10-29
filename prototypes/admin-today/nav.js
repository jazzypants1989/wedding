/** @file The navigation model — grouped and mode-aware (IA.md §3).
 *
 *  After the wedding, the work that is actually happening comes first; before
 *  it, the guest list does. Nothing is ever hidden by mode — only reordered —
 *  so every destination stays one click away in either. */

import { state, pendingModeration, unreadReplies, draftCards, pendingPetitions, unnamedGroups } from "./data.js"
import { taskCount } from "./views-core.js"

/** @typedef {{ key: string, label: string, to: string, icon: string, badge?: number | string, keyHint?: string }} NavItem */
/** @typedef {{ label: string, items: NavItem[] }} NavGroup */

/** @returns {NavGroup[]} */
export function NAV() {
  const today = { key: "today", label: "Today", to: "/", icon: "today", badge: taskCount() || "", keyHint: "g t" }
  const memories = {
    label: "Memories",
    items: [
      { key: "review", label: "Review queue", to: "/review", icon: "review", badge: pendingModeration().length || "", keyHint: "g r" },
      { key: "faces", label: "Faces", to: "/faces", icon: "faces", badge: unnamedGroups().length || "", keyHint: "g f" },
      { key: "gallery", label: "Gallery", to: "/gallery", icon: "gallery", keyHint: "g p" },
    ],
  }
  const thanks = {
    label: "Thank-yous",
    items: [
      { key: "cards", label: "Cards", to: "/thanks", icon: "cards", badge: draftCards().length ? `${draftCards().length} ready` : "", keyHint: "g c" },
      { key: "gifts", label: "Gifts", to: "/thanks/gifts", icon: "gifts" },
      { key: "mailbox", label: "Mailbox", to: "/thanks/mailbox", icon: "mailbox", badge: unreadReplies().length ? `♥ ${unreadReplies().length}` : "", keyHint: "g m" },
    ],
  }
  const guests = {
    label: "Guests",
    items: [
      { key: "guests", label: "Guest list", to: "/guests", icon: "guests", keyHint: "g g" },
      { key: "rsvps", label: "RSVPs", to: "/guests/rsvps", icon: "rsvps" },
      { key: "requests", label: "Requests", to: "/guests/requests", icon: "requests", badge: pendingPetitions().length || "" },
      { key: "accounts", label: "Accounts", to: "/guests/accounts", icon: "accounts" },
      { key: "blocklist", label: "Blocklist", to: "/guests/blocklist", icon: "blocklist" },
    ],
  }
  const site = {
    label: "Site",
    items: [
      { key: "content", label: "Site content", to: "/site/content", icon: "content", keyHint: "g s" },
      { key: "effects", label: "Effects", to: "/site/effects", icon: "effects" },
    ],
  }
  if (state.mode === "pre") {
    return [
      { label: "", items: [today] },
      guests,
      site,
      { label: "After the wedding", items: [...memories.items, ...thanks.items] },
    ]
  }
  return [{ label: "", items: [today] }, memories, thanks, guests, site]
}

/** The phone bottom bar: four destinations + "More". */
export function bottomItems() {
  const all = NAV().flatMap((g) => g.items)
  const keys = state.mode === "pre" ? ["today", "guests", "rsvps", "requests"] : ["today", "review", "faces", "cards"]
  return keys.map((k) => /** @type {NavItem} */ (all.find((i) => i.key === k)))
}

/** Which nav key a "g x" chord goes to. */
export const CHORDS = { t: "/", r: "/review", f: "/faces", p: "/gallery", c: "/thanks", m: "/thanks/mailbox", g: "/guests", s: "/site/content" }
