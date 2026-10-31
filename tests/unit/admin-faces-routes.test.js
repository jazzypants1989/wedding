/** @file Unit test: Name faces' places (routes.js). Four steps, two reference
 *  tabs and a photograph dialog — every one a real path, each selection a face
 *  or person id, and the dialog a route UNDER whichever screen opened it, so
 *  closing it (or Back) lands exactly there and a reload redraws the same
 *  screen beneath it. */

import { test } from "node:test"
import assert from "node:assert"
import { matchRoute, parentPath, crumbsFor, pathFor } from "../../public/pages/admin/routes.js"

test("every Name faces screen is a path in the faces section", () => {
  const paths = [
    "/admin/faces",
    "/admin/faces/groups",
    "/admin/faces/groups/f1240",
    "/admin/faces/ask",
    "/admin/faces/ask/f2003",
    "/admin/faces/same-moment",
    "/admin/faces/leftovers",
    "/admin/faces/people",
    "/admin/faces/people/p12",
    "/admin/faces/history",
  ]
  for (const p of paths) {
    const m = matchRoute(p)
    assert.ok(m, p)
    assert.strictEqual(m.route.tab, "faces", p)
    assert.strictEqual(m.route.nav, "faces", p)
    assert.strictEqual(m.route.dialog, undefined, p)
    // Exact: the path round-trips, nothing falls back to a prefix.
    assert.strictEqual(pathFor(m.route, m.params), p)
  }
})

test("selections are face and person ids, moved by replace", () => {
  const g = matchRoute("/admin/faces/groups/f1240")
  assert.strictEqual(g?.route.sel, "face")
  assert.strictEqual(g?.params.face, "f1240")
  const a = matchRoute("/admin/faces/ask/f2003")
  assert.strictEqual(a?.route.sel, "face")
  assert.strictEqual(a?.params.face, "f2003")
  const p = matchRoute("/admin/faces/people/p12")
  assert.strictEqual(p?.route.sel, "person")
  assert.strictEqual(p?.params.person, "p12")
})

test("the photograph dialog is a route over the screen that opened it", () => {
  const cases = [
    ["/admin/faces/groups/f1240/photos/m380", "/admin/faces/groups/f1240"],
    ["/admin/faces/ask/f2003/photos/m380", "/admin/faces/ask/f2003"],
    ["/admin/faces/same-moment/photos/m380", "/admin/faces/same-moment"],
    ["/admin/faces/leftovers/photos/m380", "/admin/faces/leftovers"],
    ["/admin/faces/people/p12/photos/m380", "/admin/faces/people/p12"],
    // The IA's bare form opens over Leftovers.
    ["/admin/faces/photos/m380", "/admin/faces/leftovers"],
  ]
  for (const [path, parent] of cases) {
    const m = matchRoute(path)
    assert.ok(m, path)
    assert.strictEqual(m.route.dialog, "faces-photo-modal", path)
    assert.strictEqual(m.params.media, "m380", path)
    assert.strictEqual(parentPath(m), parent, path)
  }
})

test("breadcrumbs read Memories › Name faces › the step", () => {
  const m = matchRoute("/admin/faces/same-moment")
  assert.ok(m)
  assert.deepStrictEqual(
    crumbsFor(m).map((c) => c.label),
    ["Memories", "Name faces", "Same moment"],
  )
  const root = matchRoute("/admin/faces")
  assert.ok(root)
  assert.deepStrictEqual(
    crumbsFor(root).map((c) => c.label),
    ["Memories", "Name faces"],
  )
})
