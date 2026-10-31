/** @file Unit test: the admin's real-path route table — every section has a
 *  path, param routes fill and match, deeper paths fall back to their section,
 *  section memory, breadcrumbs, dialog parents, and old #tab links redirect. */

import { test } from "node:test"
import assert from "node:assert"
import {
  ROUTES,
  NAV,
  NAV_GROUPS,
  BOTTOM_NAV,
  matchRoute,
  routeFor,
  pathFor,
  legacyHashRoute,
  routeForSub,
  navRoot,
  navHref,
  parentPath,
  crumbsFor,
} from "../../public/pages/admin/routes.js"

test("bare /admin and /admin/ are Home", () => {
  assert.strictEqual(routeFor("/admin")?.tab, "inbox")
  assert.strictEqual(routeFor("/admin/")?.tab, "inbox")
  assert.strictEqual(routeFor("/admin")?.nav, "home")
})

test("every route round-trips through its own path", () => {
  for (const route of ROUTES) {
    const params = Object.fromEntries(
      route.path
        .split("/")
        .filter((s) => s.startsWith(":"))
        .map((s) => [s.slice(1), "x1"]),
    )
    const m = matchRoute(pathFor(route, params))
    assert.strictEqual(m?.route, route, pathFor(route, params))
    assert.deepStrictEqual(m?.params, params)
  }
})

test("paths are unique, and every route lights a sidebar item that exists", () => {
  assert.strictEqual(new Set(ROUTES.map((r) => r.path)).size, ROUTES.length)
  for (const r of ROUTES) assert.ok(Object.hasOwn(NAV, r.nav), r.path)
})

test("the sidebar groups name every item once, and the bottom bar is four of them", () => {
  const items = NAV_GROUPS.flatMap((g) => g.items)
  assert.strictEqual(new Set(items).size, items.length)
  for (const k of items) assert.ok(Object.hasOwn(NAV, k), k)
  assert.strictEqual(BOTTOM_NAV.length, 4)
  for (const k of BOTTOM_NAV) assert.ok(items.includes(k), k)
  // Every item's root path is a real route.
  for (const k of items) assert.ok(matchRoute(navRoot(k)), k)
})

test("the longest whole-segment match wins; deeper paths keep their section", () => {
  assert.strictEqual(routeFor("/admin/gallery/loved")?.sub, "loved")
  assert.strictEqual(routeFor("/admin/gallery")?.sub, "official")
  assert.strictEqual(routeFor("/admin/thank-yous/replies/")?.nav, "replies")
  assert.strictEqual(routeFor("/admin/faces/ask/f2003")?.tab, "faces")
  // Whole segments only: "review-x" is not "review".
  assert.strictEqual(routeFor("/admin/review-x"), null)
  assert.strictEqual(routeFor("/admin/nope"), null)
})

test("param routes fill their params; a prefix fallback carries none", () => {
  const m = matchRoute("/admin/review/photo-411")
  assert.strictEqual(m?.route.path, "review/:id")
  assert.deepStrictEqual(m?.params, { id: "photo-411" })
  assert.strictEqual(m?.route.sel, "id")

  const f = matchRoute("/admin/faces/groups/f1240")
  assert.strictEqual(f?.route.path, "faces/groups/:face")
  assert.strictEqual(f?.params.face, "f1240")

  const e = matchRoute("/admin/thank-yous/cards/17/edit")
  assert.strictEqual(e?.route.path, "thank-yous/cards/:id/edit")
  assert.strictEqual(e?.params.id, "17")

  // A param route only matches its own depth.
  const deeper = matchRoute("/admin/review/photo-411/extra")
  assert.strictEqual(deeper?.route.path, "review")
  assert.deepStrictEqual(deeper?.params, {})

  // A query string is not part of the match.
  assert.strictEqual(matchRoute("/admin/review/message-9?status=hidden")?.params.id, "message-9")
})

test("params are decoded on the way in and encoded on the way out", () => {
  const route = ROUTES.find((r) => r.path === "review/:id")
  assert.ok(route)
  assert.strictEqual(pathFor(route, { id: "a b/c" }), "/admin/review/a%20b%2Fc")
  assert.strictEqual(matchRoute("/admin/review/a%20b%2Fc")?.params.id, "a b/c")
  // A malformed escape is kept as typed, not thrown.
  assert.strictEqual(matchRoute("/admin/review/%E0%A4")?.params.id, "%E0%A4")
})

test("an alias names where it goes", () => {
  assert.strictEqual(routeFor("/admin/thank-yous")?.redirect, "thank-yous/cards")
  assert.ok(matchRoute("/admin/" + routeFor("/admin/thank-yous")?.redirect))
})

test("old #tab links map onto the new paths", () => {
  assert.strictEqual(legacyHashRoute("#thankyous")?.path, "thank-yous/cards")
  assert.strictEqual(legacyHashRoute("#moderation")?.path, "review")
  assert.strictEqual(legacyHashRoute("#blocklist")?.path, "requests/blocked")
  assert.strictEqual(legacyHashRoute("#inbox")?.path, "")
  assert.strictEqual(legacyHashRoute(""), null)
  assert.strictEqual(legacyHashRoute("#toString"), null)
})

test("sub-view pills resolve to their plain routes, never an alias or a param route", () => {
  assert.strictEqual(routeForSub("moderation", "accounts")?.path, "accounts")
  assert.strictEqual(routeForSub("moderation", "queue")?.path, "review")
  assert.strictEqual(routeForSub("thankyous", "mailbox")?.path, "thank-yous/replies")
  assert.strictEqual(routeForSub("thankyous", "cards")?.path, "thank-yous/cards")
  assert.strictEqual(routeForSub("gallery", "nope"), null)
})

test("section memory: elsewhere → where you left it; in the section → its root", () => {
  const memory = { faces: "/admin/faces/groups/f1240", moderation: "/admin/review/photo-4" }
  assert.strictEqual(navHref("faces", "thankyous", memory), "/admin/faces/groups/f1240")
  assert.strictEqual(navHref("faces", "faces", memory), "/admin/faces")
  assert.strictEqual(navHref("gallery", "faces", memory), "/admin/gallery")
  // Home is always Home.
  assert.strictEqual(navHref("home", "faces", { home: "/admin/x" }), "/admin")
})

test("breadcrumbs: group › section › page, the section linking to its root", () => {
  assert.deepStrictEqual(crumbsFor({ route: ROUTES[0], params: {} }), [{ label: "Home" }])
  const review = matchRoute("/admin/review")
  assert.ok(review)
  assert.deepStrictEqual(crumbsFor(review), [{ label: "Memories" }, { label: "Review posts" }])
  const blocked = matchRoute("/admin/requests/blocked")
  assert.ok(blocked)
  assert.deepStrictEqual(crumbsFor(blocked), [
    { label: "Guest list" },
    { label: "Requests", href: "/admin/requests" },
    { label: "Blocked" },
  ])
  const post = matchRoute("/admin/review/photo-4")
  assert.ok(post)
  assert.deepStrictEqual(crumbsFor(post), [
    { label: "Memories" },
    { label: "Review posts", href: "/admin/review" },
  ])
})

test("a dialog route's parent is filled with the same params", () => {
  const route = {
    path: "guests/:guest/edit",
    tab: "guests",
    nav: "guests",
    title: "Edit guest",
    dialog: "guest-modal",
    parent: "guests",
  }
  assert.strictEqual(parentPath({ route, params: { guest: "g12" } }), "/admin/guests")
  const sel = { ...route, parent: "review/:id" }
  assert.strictEqual(parentPath({ route: sel, params: { id: "photo-1" } }), "/admin/review/photo-1")
  assert.strictEqual(parentPath({ route: ROUTES[1], params: {} }), null)
})
