/** @file Unit test: the Guests & RSVPs, Requests | Blocked and Gallery routes
 *  (public/pages/admin/routes.js) — dialog routes beat the selection route
 *  they sit beside, each opens the right <dialog> over the right parent, and
 *  the retired RSVPs / Blocklist tabs still land somewhere. */

import { test } from "node:test"
import assert from "node:assert"
import {
  matchRoute,
  parentPath,
  crumbsFor,
  legacyHashRoute,
} from "../../public/pages/admin/routes.js"

/** @param {string} path */
function must(path) {
  const m = matchRoute(path)
  assert.ok(m, path)
  return m
}

test("a literal dialog path beats the selection param beside it", () => {
  assert.strictEqual(must("/admin/guests/new").route.dialog, "guest-modal")
  assert.strictEqual(must("/admin/guests/import").route.dialog, "import-modal")
  assert.strictEqual(must("/admin/guests/invite").route.dialog, "invite-modal")
  assert.strictEqual(must("/admin/guests/text").route.dialog, "manual-sms-modal")
  assert.strictEqual(must("/admin/requests/blocked").route.path, "requests/blocked")
  assert.strictEqual(must("/admin/requests/blocked/new").route.dialog, "blocklist-modal")
  assert.strictEqual(must("/admin/gallery/upload").route.dialog, "gallery-upload-modal")
})

test("selections fill their param and are replace-navigation (sel)", () => {
  const g = must("/admin/guests/g12")
  assert.strictEqual(g.route.path, "guests/:guest")
  assert.strictEqual(g.params.guest, "g12")
  assert.strictEqual(g.route.sel, "guest")
  const p = must("/admin/requests/p3")
  assert.strictEqual(p.params.req, "p3")
  assert.strictEqual(p.route.sel, "req")
  const b = must("/admin/requests/blocked/b5")
  assert.strictEqual(b.params.entry, "b5")
  assert.strictEqual(b.route.sel, "entry")
  // Requests and Blocked are one panel.
  assert.strictEqual(p.route.tab, b.route.tab)
})

test("a guest's own dialogs open over that guest", () => {
  const edit = must("/admin/guests/g12/edit")
  assert.strictEqual(edit.route.dialog, "guest-modal")
  assert.strictEqual(parentPath(edit), "/admin/guests/g12")
  const invite = must("/admin/guests/g12/invite")
  assert.strictEqual(invite.route.dialog, "invite-modal")
  assert.strictEqual(parentPath(invite), "/admin/guests/g12")
  // The list's dialogs open over the list.
  assert.strictEqual(parentPath(must("/admin/guests/new")), "/admin/guests")
  assert.strictEqual(parentPath(must("/admin/gallery/upload")), "/admin/gallery")
  assert.strictEqual(parentPath(must("/admin/requests/blocked/new")), "/admin/requests/blocked")
})

test("the invite results step is its own dialog route, not a guest called 'invite'", () => {
  const sent = must("/admin/guests/invite/sent")
  assert.strictEqual(sent.route.path, "guests/invite/sent")
  assert.strictEqual(sent.route.dialog, "invite-modal")
  assert.deepStrictEqual(sent.params, {})
})

test("the retired RSVPs and Blocklist tabs still land in their new homes", () => {
  assert.strictEqual(must("/admin/rsvps").route.redirect, "guests")
  assert.strictEqual(legacyHashRoute("#rsvps")?.redirect, "guests")
  assert.strictEqual(legacyHashRoute("#guests")?.path, "guests")
  assert.strictEqual(legacyHashRoute("#petitions")?.path, "requests")
  assert.strictEqual(legacyHashRoute("#blocklist")?.path, "requests/blocked")
})

test("every Guests route lights Guests & RSVPs; the section crumb is its root", () => {
  const paths = ["/admin/guests", "/admin/guests/g1", "/admin/guests/g1/edit", "/admin/guests/new"]
  for (const path of paths) {
    assert.strictEqual(must(path).route.nav, "guests", path)
  }
  assert.deepStrictEqual(crumbsFor(must("/admin/guests")), [
    { label: "Guest list" },
    { label: "Guests & RSVPs" },
  ])
})
