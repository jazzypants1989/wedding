/** @file The admin's places: every section is a real path under /admin.
 *
 *  Pure (no DOM), so the table is unit-tested. Three tables:
 *   - NAV: the sidebar's items (label, icon, badge id, root path). The sidebar,
 *     the phone bottom bar, the More page and the breadcrumbs are all drawn
 *     from it, so they can never disagree.
 *   - NAV_GROUPS: the sidebar's order (post-wedding only; owner decision).
 *   - ROUTES: every path. A route names the panel that draws it (`tab`, the
 *     #tab-<id> panel), the sidebar item it lights (`nav`), optionally the
 *     panel's sub-view pill (`sub`), the param that is a selection (`sel`),
 *     a dialog it opens over its parent (`dialog` + `parent`), or an alias
 *     target (`redirect`, whose `:param`s are filled from the alias's own).
 *     Paths may hold `:param` segments.
 *  No regex (CLAUDE.md). */
/** @import * as Types from './types.js' */

/** @type {Readonly<Record<string, Types.NavItem>>} */
export const NAV = {
  home: { label: "Home", path: "", icon: "home" },
  moderation: {
    label: "Review posts",
    short: "Review",
    path: "review",
    icon: "review",
    badge: "moderation-badge",
  },
  faces: {
    label: "Name faces",
    short: "Faces",
    path: "faces",
    icon: "faces",
    badge: "faces-badge",
  },
  gallery: { label: "Gallery", path: "gallery", icon: "gallery" },
  gifts: { label: "Gifts", path: "thank-yous/gifts", icon: "gifts", badge: "gifts-badge" },
  thankyous: { label: "Cards", path: "thank-yous/cards", icon: "cards", badge: "thankyous-badge" },
  replies: {
    label: "Replies",
    path: "thank-yous/replies",
    icon: "replies",
    badge: "thankyous-reply-badge",
    heart: true,
  },
  // One list: invitations, their RSVPs, and the people who signed in to the
  // website (owner decision — "Accounts" was a second list of the same people).
  guests: { label: "Guests", path: "guests", icon: "guests" },
  petitions: {
    label: "Requests",
    path: "requests",
    icon: "requests",
    badge: "petitions-badge",
  },
  "site-content": { label: "Site content", short: "Site", path: "site/content", icon: "content" },
  effects: { label: "Effects", path: "site/effects", icon: "effects" },
  more: { label: "More", path: "more", icon: "more" },
}

/** The sidebar, top to bottom. The first group has no heading. */
/** @type {readonly Types.NavGroup[]} */
export const NAV_GROUPS = [
  { label: "", items: ["home"] },
  { label: "Memories", items: ["moderation", "faces", "gallery"] },
  { label: "Thank-yous", items: ["gifts", "thankyous", "replies"] },
  { label: "Guest list", items: ["guests", "petitions"] },
  { label: "Site", items: ["site-content", "effects"] },
]

/** Phones: these four, then More (which lists everything). */
/** @type {readonly string[]} */
export const BOTTOM_NAV = ["home", "moderation", "faces", "thankyous"]

/** @type {readonly Types.AdminRoute[]} */
export const ROUTES = [
  { path: "", tab: "inbox", nav: "home", title: "Home" },
  { path: "review", tab: "moderation", sub: "queue", nav: "moderation", title: "Review posts" },
  // The Review split view (phase 2) selects a post by `<type>-<id>`.
  {
    path: "review/:id",
    tab: "moderation",
    sub: "queue",
    nav: "moderation",
    title: "Review posts",
    sel: "id",
  },
  // Name faces (face-assignment.js): four steps, then People and History.
  // `/faces` alone resolves (replace) to the first unfinished step.
  { path: "faces", tab: "faces", nav: "faces", title: "Name faces" },
  { path: "faces/groups", tab: "faces", nav: "faces", title: "Groups", sel: "face" },
  // Faces anchors on a face id, never a group index (IA §8).
  { path: "faces/groups/:face", tab: "faces", nav: "faces", title: "Groups", sel: "face" },
  { path: "faces/ask", tab: "faces", nav: "faces", title: "Quick questions", sel: "face" },
  { path: "faces/ask/:face", tab: "faces", nav: "faces", title: "Quick questions", sel: "face" },
  { path: "faces/same-moment", tab: "faces", nav: "faces", title: "Same moment" },
  { path: "faces/leftovers", tab: "faces", nav: "faces", title: "Leftovers" },
  { path: "faces/people", tab: "faces", nav: "faces", title: "People", sel: "person" },
  { path: "faces/people/:person", tab: "faces", nav: "faces", title: "People", sel: "person" },
  { path: "faces/history", tab: "faces", nav: "faces", title: "History" },
  // The photograph dialog is a route under whichever screen opened it, so
  // Back closes it onto that screen and a reload redraws the same one under it.
  {
    path: "faces/photos/:media",
    tab: "faces",
    nav: "faces",
    title: "Photo",
    dialog: "faces-photo-modal",
    parent: "faces/leftovers",
  },
  {
    path: "faces/groups/:face/photos/:media",
    tab: "faces",
    nav: "faces",
    title: "Photo",
    dialog: "faces-photo-modal",
    parent: "faces/groups/:face",
  },
  {
    path: "faces/ask/:face/photos/:media",
    tab: "faces",
    nav: "faces",
    title: "Photo",
    dialog: "faces-photo-modal",
    parent: "faces/ask/:face",
  },
  {
    path: "faces/same-moment/photos/:media",
    tab: "faces",
    nav: "faces",
    title: "Photo",
    dialog: "faces-photo-modal",
    parent: "faces/same-moment",
  },
  {
    path: "faces/leftovers/photos/:media",
    tab: "faces",
    nav: "faces",
    title: "Photo",
    dialog: "faces-photo-modal",
    parent: "faces/leftovers",
  },
  {
    path: "faces/people/:person/photos/:media",
    tab: "faces",
    nav: "faces",
    title: "Photo",
    dialog: "faces-photo-modal",
    parent: "faces/people/:person",
  },
  { path: "gallery", tab: "gallery", sub: "official", nav: "gallery", title: "Gallery" },
  { path: "gallery/loved", tab: "gallery", sub: "loved", nav: "gallery", title: "Most loved" },
  {
    path: "gallery/upload",
    tab: "gallery",
    nav: "gallery",
    title: "Add official photos",
    dialog: "gallery-upload-modal",
    parent: "gallery",
  },
  {
    path: "gallery/honeymoon",
    tab: "gallery",
    sub: "honeymoon",
    nav: "gallery",
    title: "Honeymoon",
  },
  {
    path: "gallery/honeymoon/upload",
    tab: "gallery",
    nav: "gallery",
    title: "Add honeymoon photos",
    dialog: "gallery-upload-modal",
    parent: "gallery/honeymoon",
  },
  // Sort (gallery-sort.js): a section's hidden photos a moment at a time, each
  // shown or kept hidden. Its own panel; ?again=1 goes back through the kept-hidden.
  { path: "gallery/sort", tab: "gallery-sort", nav: "gallery", title: "Sort hidden photos" },
  {
    path: "gallery/honeymoon/sort",
    tab: "gallery-sort",
    nav: "gallery",
    title: "Sort hidden honeymoon photos",
  },
  // The old single Thank-yous section; its links (bookmarks, emails) land on Cards.
  {
    path: "thank-yous",
    tab: "thankyous",
    nav: "thankyous",
    title: "Cards",
    redirect: "thank-yous/cards",
  },
  // Thank-yous (thank-you.js): Gifts, Cards and Replies are three lists, each
  // with a detail (`g41`, `c17`); the composer is a guarded route of its own;
  // batch send is four step routes, so Back steps back through it.
  { path: "thank-yous/gifts", tab: "thankyous", nav: "gifts", title: "Gifts", sel: "id" },
  { path: "thank-yous/gifts/:id", tab: "thankyous", nav: "gifts", title: "Gift", sel: "id" },
  {
    path: "thank-yous/gifts/new",
    tab: "thankyous",
    nav: "gifts",
    title: "Log a gift",
    dialog: "gift-modal",
    parent: "thank-yous/gifts",
  },
  {
    path: "thank-yous/gifts/:id/edit",
    tab: "thankyous",
    nav: "gifts",
    title: "Edit gift",
    dialog: "gift-modal",
    parent: "thank-yous/gifts/:id",
  },
  {
    path: "thank-yous/cards",
    tab: "thankyous",
    sub: "cards",
    nav: "thankyous",
    title: "Cards",
    sel: "id",
  },
  { path: "thank-yous/cards/:id", tab: "thankyous", nav: "thankyous", title: "Card", sel: "id" },
  {
    path: "thank-yous/cards/write",
    tab: "thankyous",
    nav: "thankyous",
    title: "Write a card",
    dialog: "tc-guest-picker-modal",
    parent: "thank-yous/cards",
  },
  // The composer: `cards/new?gift=41` (or `?guest=12`, no gift) and
  // `cards/c17/edit`. Its photo picker is a dialog route INSIDE the guarded
  // path, so opening it never asks "leave without saving?".
  { path: "thank-yous/cards/new", tab: "thankyous", nav: "thankyous", title: "New card" },
  {
    path: "thank-yous/cards/new/photos",
    tab: "thankyous",
    nav: "thankyous",
    title: "Choose photos",
    dialog: "photo-picker-modal",
    parent: "thank-yous/cards/new",
  },
  {
    path: "thank-yous/cards/:id/edit",
    tab: "thankyous",
    sub: "cards",
    nav: "thankyous",
    title: "Edit card",
  },
  {
    path: "thank-yous/cards/:id/edit/photos",
    tab: "thankyous",
    nav: "thankyous",
    title: "Choose photos",
    dialog: "photo-picker-modal",
    parent: "thank-yous/cards/:id/edit",
  },
  {
    path: "thank-yous/cards/:id/send",
    tab: "thankyous",
    nav: "thankyous",
    title: "Send card",
    dialog: "thankyou-send-modal",
    parent: "thank-yous/cards/:id",
  },
  // Batch send: Choose → How → Check → Sent. Sent replaces Check (IA §13.5).
  { path: "thank-yous/cards/send", tab: "thankyous", nav: "thankyous", title: "Send · 1 Choose" },
  { path: "thank-yous/cards/send/how", tab: "thankyous", nav: "thankyous", title: "Send · 2 How" },
  {
    path: "thank-yous/cards/send/check",
    tab: "thankyous",
    nav: "thankyous",
    title: "Send · 3 Check",
  },
  { path: "thank-yous/cards/send/done", tab: "thankyous", nav: "thankyous", title: "Sent" },
  {
    path: "thank-yous/replies",
    tab: "thankyous",
    sub: "mailbox",
    nav: "replies",
    title: "Replies",
    sel: "id",
  },
  { path: "thank-yous/replies/:id", tab: "thankyous", nav: "replies", title: "Reply", sel: "id" },
  // Guests (guests.js): an RSVP is a fact about a guest, so it is a filter
  // (?rsvp=yes|no|awaiting|archived|uninvited, ?q=) and a block in the detail.
  // `:guest` is an invitation (`g12`) or a person who signed in to the website
  // (`a7`): one with an invitation lands on its page, one without has their own.
  { path: "guests", tab: "guests", nav: "guests", title: "Guests" },
  { path: "guests/:guest", tab: "guests", nav: "guests", title: "Guest", sel: "guest" },
  {
    path: "guests/new",
    tab: "guests",
    nav: "guests",
    title: "Add a guest",
    dialog: "guest-modal",
    parent: "guests",
  },
  {
    path: "guests/import",
    tab: "guests",
    nav: "guests",
    title: "Import guests",
    dialog: "import-modal",
    parent: "guests",
  },
  {
    path: "guests/invite",
    tab: "guests",
    nav: "guests",
    title: "Send invites",
    dialog: "invite-modal",
    parent: "guests",
  },
  // The invite's results step replaces the send step, so Back never lands on a live Send.
  {
    path: "guests/invite/sent",
    tab: "guests",
    nav: "guests",
    title: "Invites sent",
    dialog: "invite-modal",
    parent: "guests",
  },
  {
    path: "guests/text",
    tab: "guests",
    nav: "guests",
    title: "Text invites by hand",
    dialog: "manual-sms-modal",
    parent: "guests",
  },
  {
    path: "guests/:guest/edit",
    tab: "guests",
    nav: "guests",
    title: "Edit guest",
    dialog: "guest-modal",
    parent: "guests/:guest",
  },
  {
    path: "guests/:guest/invite",
    tab: "guests",
    nav: "guests",
    title: "Send invite",
    dialog: "invite-modal",
    parent: "guests/:guest",
  },
  // The old RSVPs tab is Guests now.
  { path: "rsvps", tab: "guests", nav: "guests", title: "Guests", redirect: "guests" },
  // The old Accounts list is Guests now. Its links (bookmarks, Review's author
  // card) keep working: an account `a7` lands on the guest page that shows it.
  { path: "accounts", tab: "guests", nav: "guests", title: "Guests", redirect: "guests" },
  {
    path: "accounts/:guest",
    tab: "guests",
    nav: "guests",
    title: "Guest",
    redirect: "guests/:guest",
  },
  // Requests | Blocked (petitions.js, blocklist.js): one split view, one panel.
  { path: "requests", tab: "petitions", nav: "petitions", title: "Requests" },
  { path: "requests/:req", tab: "petitions", nav: "petitions", title: "Request", sel: "req" },
  { path: "requests/blocked", tab: "petitions", nav: "petitions", title: "Blocked" },
  {
    path: "requests/blocked/:entry",
    tab: "petitions",
    nav: "petitions",
    title: "Blocked",
    sel: "entry",
  },
  {
    path: "requests/blocked/new",
    tab: "petitions",
    nav: "petitions",
    title: "Block someone",
    dialog: "blocklist-modal",
    parent: "requests/blocked",
  },
  { path: "site/content", tab: "site-content", nav: "site-content", title: "Site content" },
  { path: "site/effects", tab: "effects", nav: "effects", title: "Effects" },
  // Phones only: the bottom bar holds four sections, and More lists them all.
  // On a wide screen the router redirects it to Home.
  { path: "more", tab: "more", nav: "more", title: "Everything" },
]

/** The old `/admin#<tab>` deep links (digest emails, bookmarks) → today's paths. */
const LEGACY_HASHES = /** @type {Record<string, string>} */ ({
  inbox: "",
  guests: "guests",
  rsvps: "rsvps",
  petitions: "requests",
  moderation: "review",
  gallery: "gallery",
  faces: "faces",
  thankyous: "thank-yous/cards",
  blocklist: "requests/blocked",
  "site-content": "site/content",
  effects: "site/effects",
})

/** "/admin/faces/groups/" → ["faces", "groups"]. @param {string} pathname */
function segments(pathname) {
  const q = pathname.indexOf("?")
  const bare = q === -1 ? pathname : pathname.slice(0, q)
  const rest = bare.startsWith("/admin") ? bare.slice("/admin".length) : bare
  return rest.split("/").filter((s) => s !== "")
}

/** Match one pattern against the leading segments; null when it doesn't fit.
 *  @param {string[]} pattern @param {string[]} segs */
function fit(pattern, segs) {
  if (pattern.length > segs.length) return null
  /** @type {Record<string, string>} */
  const params = {}
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]
    if (p.startsWith(":")) {
      let value = segs[i]
      try {
        value = decodeURIComponent(value)
      } catch {
        // A malformed escape stays as typed rather than throwing.
      }
      params[p.slice(1)] = value
    } else if (p !== segs[i]) {
      return null
    }
  }
  return params
}

/** @type {Types.matchRoute} */
export function matchRoute(pathname) {
  const segs = segments(pathname)
  if (segs.length === 0) return { route: ROUTES[0], params: {} }
  // An exact-length match beats a prefix; then the longer pattern; then the
  // one with more literal segments (so /gallery/loved beats /gallery/:x).
  // A prefix match is the fallback that keeps a deeper, not-yet-built path
  // (an old link, a slice still to come) inside its section.
  /** @type {Types.RouteMatch | null} */
  let best = null
  let bestScore = -1
  for (const route of ROUTES) {
    if (route.path === "") continue
    const pattern = route.path.split("/")
    const params = fit(pattern, segs)
    if (!params) continue
    const literals = pattern.filter((s) => !s.startsWith(":")).length
    const exact = pattern.length === segs.length ? 1 : 0
    // A param route only matches its own depth: /review/x/y is not "review/:id".
    if (!exact && literals !== pattern.length) continue
    const score = exact * 10000 + pattern.length * 100 + literals
    if (score > bestScore) {
      best = { route, params: exact ? params : {} }
      bestScore = score
    }
  }
  return best
}

/** @type {Types.routeFor} */
export function routeFor(pathname) {
  return matchRoute(pathname)?.route ?? null
}

/** @type {Types.pathFor} */
export function pathFor(route, params = {}) {
  if (route.path === "") return "/admin"
  const filled = route.path
    .split("/")
    .map((s) => (s.startsWith(":") ? encodeURIComponent(params[s.slice(1)] ?? "") : s))
  return "/admin/" + filled.join("/")
}

/** @type {Types.legacyHashRoute} */
export function legacyHashRoute(hash) {
  const id = hash.startsWith("#") ? hash.slice(1) : hash
  if (!id || !Object.hasOwn(LEGACY_HASHES, id)) return null
  return routeFor("/admin/" + LEGACY_HASHES[id])
}

/** @type {Types.routeForSub} */
export function routeForSub(tab, sub) {
  const found = ROUTES.find(
    (r) => r.tab === tab && r.sub === sub && !r.redirect && !r.path.includes(":"),
  )
  return found ?? null
}

/** @type {Types.navRoot} */
export function navRoot(key) {
  const item = NAV[key]
  if (!item) return "/admin"
  return item.path === "" ? "/admin" : "/admin/" + item.path
}

/** @type {Types.navGroupOf} */
export function navGroupOf(key) {
  return NAV_GROUPS.find((g) => g.items.includes(key))?.label ?? ""
}

/** @type {Types.navHref} */
export function navHref(key, currentNav, memory) {
  // Already in the section → its root. Elsewhere → back to exactly where you
  // left it (IA §1.6, owner decision: yes).
  const remembered = memory[key]
  if (remembered && key !== currentNav && key !== "home" && key !== "more") return remembered
  return navRoot(key)
}

/** @type {Types.redirectPath} */
export function redirectPath(match) {
  const to = match.route.redirect
  if (to === undefined) return null
  const route = ROUTES.find((r) => r.path === to)
  if (route) return pathFor(route, match.params)
  return to === "" ? "/admin" : "/admin/" + to
}

/** @type {Types.parentPath} */
export function parentPath(match) {
  const parent = match.route.parent
  if (parent === undefined) return null
  const route = ROUTES.find((r) => r.path === parent)
  if (!route) return parent === "" ? "/admin" : "/admin/" + parent
  return pathFor(route, match.params)
}

/** @type {Types.crumbsFor} */
export function crumbsFor(match) {
  const { route } = match
  const item = NAV[route.nav]
  if (!item || route.nav === "home" || route.nav === "more") return [{ label: route.title }]
  /** @type {Types.Crumb[]} */
  const crumbs = []
  const group = navGroupOf(route.nav)
  if (group) crumbs.push({ label: group })
  const root = navRoot(route.nav)
  const here = pathFor(route, match.params)
  if (here === root) {
    crumbs.push({ label: item.label })
    return crumbs
  }
  crumbs.push({ label: item.label, href: root })
  // A selection inside the section ("review/:id") is named by its panel
  // (setCrumbs); until then it doesn't repeat the section's name.
  if (route.title !== item.label) crumbs.push({ label: route.title })
  return crumbs
}
