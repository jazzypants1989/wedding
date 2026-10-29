/** @file Entry point: the route table (mirrors IA.md §4) and the dispatcher.
 *  Prototype paths are IA paths with `/admin` swapped for `/admin-journeys`. */

import { createRouter, fill } from "./router.js"
import { db, save, reset, openGroups, groupByFace, openAsk } from "./data.js"
import { paint, wireShell, wireDrawer, initTheme, confirmLeave } from "./shell.js"
import { homeScreen, journeyScreen, doneScreen, allScreen, notFoundScreen } from "./views-home.js"
import * as F from "./views-faces.js"
import * as T from "./views-thanks.js"
import * as R from "./views-review.js"
import * as M from "./views-misc.js"

/** @typedef {import("./router.js").RouteDef} RouteDef */

/** @type {RouteDef[]} */
const routes = [
  { pattern: "/", name: "home" },
  { pattern: "/all", name: "all" },

  { pattern: "/review", name: "journey:review" },
  {
    pattern: "/review/new",
    name: "review.new",
    redirect: () => (db.pending.length ? "/review/new/" + db.pending[0].key : null),
  },
  {
    pattern: "/review/new/:key",
    name: "review.new",
    redirect: (p) => {
      if (db.pending.some((/** @type {any} */ x) => x.key === p.key)) return null
      return db.pending.length ? "/review/new/" + db.pending[0].key : "/review/new"
    },
  },
  { pattern: "/review/all", name: "review.all" },
  { pattern: "/review/favorites", name: "review.favorites" },
  { pattern: "/review/trusted", name: "review.trusted" },
  { pattern: "/review/done", name: "done:review" },

  { pattern: "/gallery", name: "journey:gallery" },
  { pattern: "/gallery/add", name: "gallery.add" },
  { pattern: "/gallery/order", name: "gallery.order" },
  { pattern: "/gallery/loved", name: "gallery.loved" },
  { pattern: "/gallery/done", name: "done:gallery" },

  { pattern: "/faces", name: "journey:faces" },
  { pattern: "/faces/people", name: "faces.people" },
  { pattern: "/faces/people/new", name: "faces.people", dialog: "add-person", parent: "/faces/people" },
  { pattern: "/faces/groups", name: "faces.groups" },
  {
    pattern: "/faces/groups/:anchor",
    name: "faces.group",
    // The anchor is a FACE id. If that face's group has since been named, go to
    // the next open group rather than a dead page.
    redirect: (p) => {
      if (groupByFace(Number(p.anchor.slice(1)))) return null
      const og = openGroups()
      return og.length ? "/faces/groups/f" + og[0].anchor : "/faces/groups"
    },
  },
  {
    pattern: "/faces/groups/:anchor/photo/:media",
    name: "faces.group",
    dialog: "photo",
    parent: "/faces/groups/:anchor",
  },
  {
    pattern: "/faces/ask",
    name: "faces.ask",
    redirect: () => {
      const o = openAsk()
      return o.length ? "/faces/ask/f" + o[0].id : null
    },
  },
  {
    pattern: "/faces/ask/:face",
    name: "faces.ask",
    redirect: (p) => {
      const o = openAsk()
      if (o.some((/** @type {any} */ a) => "f" + a.id === p.face)) return null
      return o.length ? "/faces/ask/f" + o[0].id : "/faces/ask"
    },
  },
  { pattern: "/faces/ask/:face/photo/:media", name: "faces.ask", dialog: "photo", parent: "/faces/ask/:face" },
  { pattern: "/faces/same-moment", name: "faces.moment" },
  { pattern: "/faces/check", name: "faces.check" },
  { pattern: "/faces/check/set-aside", name: "faces.check.setaside" },
  {
    pattern: "/faces/check/set-aside/photo/:media",
    name: "faces.check.setaside",
    dialog: "photo",
    parent: "/faces/check/set-aside",
  },
  { pattern: "/faces/check/history", name: "faces.check.history" },
  { pattern: "/faces/check/:person", name: "faces.check.person" },
  { pattern: "/faces/done", name: "done:faces" },

  { pattern: "/thanks", name: "journey:thanks" },
  { pattern: "/thanks/gifts", name: "thanks.gifts" },
  { pattern: "/thanks/gifts/new", name: "thanks.gifts", dialog: "gift", parent: "/thanks/gifts" },
  { pattern: "/thanks/write", name: "thanks.write" },
  { pattern: "/thanks/write/:card", name: "thanks.composer" },
  { pattern: "/thanks/send", name: "thanks.send" },
  { pattern: "/thanks/send/preview", name: "thanks.preview" },
  { pattern: "/thanks/send/sent", name: "thanks.sent" },
  { pattern: "/thanks/replies", name: "thanks.replies" },
  { pattern: "/thanks/replies/:card", name: "thanks.replies", dialog: "reply", parent: "/thanks/replies" },
  { pattern: "/thanks/done", name: "done:thanks" },

  { pattern: "/invite", name: "journey:invite" },
  { pattern: "/guests", name: "guests" },
  { pattern: "/guests/new", name: "guests", dialog: "guest-new", parent: "/guests" },
  { pattern: "/guests/import", name: "guests", dialog: "import", parent: "/guests" },
  { pattern: "/guests/:id", name: "guests", dialog: "guest", parent: "/guests" },
  { pattern: "/invites", name: "invites" },
  { pattern: "/invites/manual", name: "invites.manual" },
  { pattern: "/rsvps", name: "rsvps" },
  { pattern: "/requests", name: "requests" },
  { pattern: "/requests/blocked", name: "requests.blocked" },
  { pattern: "/site", name: "site" },
  { pattern: "/site/effects", name: "site.effects" },
]

const router = createRouter({ base: "/admin-journeys", routes, render, confirmLeave })

const ctx = {
  /** @param {string} to @param {{ replace?: boolean }} [o] */
  nav: (to, o) => router.navigate(to, o),
  /** @param {string} to */
  up: (to) => router.up(to),
  refresh: () => router.refresh(),
  closeDialog: () => router.closeDialog(),
  /** @param {import("./router.js").Guard | null} g */
  setGuard: (g) => router.setGuard(g),
}
F.setRefresh(ctx.refresh)

/** @param {import("./router.js").Match} m */
function screenFor(m) {
  const { route, params, query } = m
  const n = route.name
  if (n.startsWith("journey:")) return journeyScreen(n.slice(8))
  if (n.startsWith("done:")) return doneScreen(n.slice(5))
  switch (n) {
    case "home":
      return homeScreen()
    case "all":
      return allScreen()
    case "review.new":
      return R.newPostsScreen(ctx, params.key || null)
    case "review.all":
      return R.allPostsScreen(ctx)
    case "review.favorites":
      return R.favoritesScreen(ctx)
    case "review.trusted":
      return R.trustedScreen(ctx)
    case "gallery.add":
      return M.galleryAddScreen(ctx)
    case "gallery.order":
      return M.galleryOrderScreen(ctx)
    case "gallery.loved":
      return M.galleryLovedScreen(ctx)
    case "faces.people":
      return route.dialog ? F.addPersonDialog(ctx) : F.peopleScreen()
    case "faces.groups":
      return F.groupsScreen()
    case "faces.group": {
      const s = F.groupReviewScreen(params.anchor, ctx)
      return route.dialog ? F.photoDialog(s, params.media, Number(params.anchor.slice(1))) : s
    }
    case "faces.ask": {
      const s = F.askScreen(ctx, params.face || null)
      return route.dialog ? F.photoDialog(s, params.media, Number(params.face.slice(1))) : s
    }
    case "faces.moment":
      return F.sameMomentScreen(ctx)
    case "faces.check":
      return F.checkScreen(ctx, "people", null)
    case "faces.check.setaside": {
      const s = F.checkScreen(ctx, "set-aside", null)
      return route.dialog ? F.photoDialog(s, params.media, 1001) : s
    }
    case "faces.check.history":
      return F.checkScreen(ctx, "history", null)
    case "faces.check.person":
      return F.checkScreen(ctx, "people", params.person)
    case "thanks.gifts":
      return route.dialog ? T.giftDialog(ctx) : T.giftsScreen()
    case "thanks.write":
      return T.writeScreen(ctx)
    case "thanks.composer":
      return T.composerScreen(ctx, params.card)
    case "thanks.send":
      return T.sendScreen(ctx)
    case "thanks.preview":
      return T.sendPreviewScreen(ctx, query)
    case "thanks.sent":
      return T.sentScreen(query)
    case "thanks.replies":
      return route.dialog ? T.replyDialog(params.card) : T.repliesScreen()
    case "guests":
      if (route.dialog === "import") return M.importDialog()
      if (route.dialog) return M.guestDialog(ctx, params.id || null)
      return M.guestsScreen()
    case "invites":
      return M.invitesScreen()
    case "invites.manual":
      return M.manualSmsScreen()
    case "rsvps":
      return M.rsvpsScreen()
    case "requests":
      return M.requestsScreen("pending")
    case "requests.blocked":
      return M.requestsScreen("blocked")
    case "site":
      return M.siteScreen(ctx, "content")
    case "site.effects":
      return M.siteScreen(ctx, "effects")
  }
  return notFoundScreen(m.path)
}

/** @param {import("./router.js").Match} m */
function render(m) {
  const s = screenFor(m)
  router.setGuard(s.guard || null)
  // Remember where each journey was left, so "Continue" returns there. A dialog
  // remembers its parent; done screens and overviews aren't places to resume.
  const transient = m.route.name === "thanks.sent" || m.route.name === "thanks.preview"
  if (s.journey && s.step && !m.route.name.startsWith("done:") && !transient) {
    const at = m.route.parent ? fill(m.route.parent, m.params) : m.path
    if (db.resume[s.journey] !== at) {
      db.resume[s.journey] = at
      save()
    }
  }
  paint(s, { closeDialog: ctx.closeDialog, path: m.path })
}

initTheme()
wireShell({ refresh: ctx.refresh })
wireDrawer({
  refresh: ctx.refresh,
  reset: () => {
    reset()
    router.navigate("/", { force: true })
  },
})
router.start()
