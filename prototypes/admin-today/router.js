/** @file The admin router, written the way the real one would be (IA.md §5).
 *
 *  - Real paths, pushState/popstate. Every history entry carries `{ idx }`, a
 *    monotonically increasing position, so popstate knows how far it moved.
 *  - THE RULE: navigating pushes; *advancing because a task got done* replaces.
 *    So Back always means "the previous screen", never "re-do the last item".
 *  - Guards: a dirty view registers `setGuard()`. A link click asks first. A
 *    popstate (already happened, can't be cancelled) is reversed with
 *    `history.go(-delta)`, the guard dialog is shown, and "Discard" replays
 *    `history.go(delta)`. Forward history survives, unlike a re-push.
 *  - Overlays without a URL of their own (palette, help, menu) push a same-URL
 *    entry tagged `{ overlay }`, so Back closes them on phones too.
 *  - `entries` remembers which path sits at each idx (sessionStorage), which is
 *    what lets ✕ / "Back to Today" use history.back() when that lands in the
 *    right place, and push otherwise — so the stack never fills with loops.
 *
 *  No regex: patterns are split on "/" and matched segment by segment. A
 *  segment like "f:id" is a literal prefix plus a parameter. */

export const BASE = "/admin-today"
const ENTRIES_KEY = "admin-today-entries"

/** @typedef {{ pattern: string, view: any }} Route */
/** @type {Route[]} */
const routes = []
let curIdx = 0
let restoring = false
/** @type {null | { message: string, isDirty: () => boolean, save?: () => void }} */
let guard = null
/** @type {Record<string, string>} */
let entries = {}
/** @type {(m: any) => void} */
let onRender = () => {}
/** @type {(g: any, proceed: () => void) => void} */
let onGuard = (_g, proceed) => proceed()

export function route(pattern, view) {
  routes.push({ pattern, view })
}

/** App-relative path of the current location ("/faces/groups/f1203"). */
export function currentPath() {
  const p = location.pathname
  const rel = p.startsWith(BASE) ? p.slice(BASE.length) : p
  return rel === "" ? "/" : rel
}
export function currentQuery() {
  return new URLSearchParams(location.search)
}
export function overlayState() {
  return (history.state && history.state.overlay) || null
}

/** @param {string} path */
export function match(path) {
  const segs = path.split("/").filter(Boolean)
  for (const r of routes) {
    const pats = r.pattern.split("/").filter(Boolean)
    if (pats.length !== segs.length) continue
    /** @type {Record<string, string>} */
    const params = {}
    let ok = true
    for (let i = 0; i < pats.length; i++) {
      const p = pats[i]
      const colon = p.indexOf(":")
      if (colon === -1) {
        if (p !== segs[i]) ok = false
      } else {
        const prefix = p.slice(0, colon)
        if (!segs[i].startsWith(prefix) || segs[i].length === prefix.length) ok = false
        else params[p.slice(colon + 1)] = segs[i].slice(prefix.length)
      }
      if (!ok) break
    }
    if (ok) return { view: r.view, params, path }
  }
  return null
}

function saveEntries() {
  try {
    sessionStorage.setItem(ENTRIES_KEY, JSON.stringify(entries))
  } catch {
    // non-fatal
  }
}

function pathWithQuery(to) {
  return BASE + (to === "/" ? "" : to)
}

/**
 * @param {string} to  app path, may include ?query
 * @param {{ replace?: boolean, force?: boolean }} [opts]
 */
export function navigate(to, opts = {}) {
  if (!opts.force && guard && guard.isDirty()) {
    onGuard(guard, () => {
      guard = null
      navigate(to, { ...opts, force: true })
    })
    return
  }
  // Leaving a palette/menu overlay *for* somewhere replaces it, so Back from
  // the destination lands on the page underneath, not on the palette.
  if (opts.replace || overlayState()) {
    history.replaceState({ idx: curIdx }, "", pathWithQuery(to))
  } else {
    curIdx += 1
    history.pushState({ idx: curIdx }, "", pathWithQuery(to))
    // Anything "forward" of here is gone now.
    for (const k of Object.keys(entries)) if (Number(k) > curIdx) delete entries[k]
  }
  entries[curIdx] = to.split("?")[0]
  saveEntries()
  render()
}

/** Filters, sort order, selected face: view state, not screens. */
export function setQuery(params) {
  const q = currentQuery()
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === "") q.delete(k)
    else q.set(k, String(v))
  }
  const s = q.toString()
  history.replaceState(history.state, "", location.pathname + (s ? "?" + s : ""))
}

/** Go "up" to `path`: rewind history to it if it is one of the last few
 *  entries (so the stack never fills with loops), otherwise push it. Used by
 *  ✕, dialog close, step links and "Back to Today". */
export function returnTo(path) {
  const target = path.split("?")[0]
  let found = -1
  for (let i = curIdx - 1; i >= Math.max(0, curIdx - 6); i--) {
    if (entries[i] === target) {
      found = i
      break
    }
  }
  if (found === -1) {
    navigate(path)
    return
  }
  const go = () => history.go(found - curIdx)
  if (guard && guard.isDirty()) {
    onGuard(guard, () => {
      guard = null
      go()
    })
    return
  }
  go()
}

/** Finish a flow: rewind to the entry where the flow started and replace it
 *  with the outcome. The steps collapse into ONE history entry, so Back from
 *  "Sent!" goes to wherever you were before the flow, never into a spent step.
 *  @param {number} startIdx @param {string} path @param {string} expect */
export function unwindTo(startIdx, path, expect) {
  if (startIdx >= curIdx || entries[startIdx] !== expect) {
    navigate(path, { replace: true })
    return
  }
  pendingReplace = path
  history.go(startIdx - curIdx)
}
/** @type {string | null} */
let pendingReplace = null

export function currentIdx() {
  return curIdx
}

/** Where Back would land, if we know (for "← Back to X" affordances). */
export function previousPath() {
  return curIdx > 0 ? entries[curIdx - 1] || null : null
}

export function openOverlay(name) {
  if (overlayState() === name) return
  curIdx += 1
  history.pushState({ idx: curIdx, overlay: name }, "", location.href)
  entries[curIdx] = currentPath()
  saveEntries()
  render()
}
export function closeOverlay() {
  if (overlayState()) history.back()
}

/** @param {typeof guard} g */
export function setGuard(g) {
  guard = g
}
export function hasDirtyGuard() {
  return Boolean(guard && guard.isDirty())
}

function render() {
  const path = currentPath()
  const m = match(path) || match("/404")
  onRender({ ...m, path, query: currentQuery(), overlay: overlayState() })
}

/** @param {{ onRender: typeof onRender, onGuard: typeof onGuard }} hooks */
export function start(hooks) {
  onRender = hooks.onRender
  onGuard = hooks.onGuard
  try {
    entries = JSON.parse(sessionStorage.getItem(ENTRIES_KEY) || "{}")
  } catch {
    entries = {}
  }
  if (!history.state || typeof history.state.idx !== "number") {
    history.replaceState({ idx: 0 }, "", location.href)
    entries = {}
  }
  curIdx = history.state.idx
  // A reload while an un-addressable overlay was open: drop the overlay.
  if (history.state.overlay) history.replaceState({ idx: curIdx }, "", location.href)
  entries[curIdx] = currentPath()
  saveEntries()

  addEventListener("popstate", (e) => {
    const idx = e.state && typeof e.state.idx === "number" ? e.state.idx : 0
    if (restoring) {
      restoring = false
      curIdx = idx
      return
    }
    if (pendingReplace) {
      const to = pendingReplace
      pendingReplace = null
      curIdx = idx
      navigate(to, { replace: true, force: true })
      return
    }
    const delta = idx - curIdx
    if (guard && guard.isDirty() && delta !== 0) {
      // Can't cancel a popstate. Undo it, ask, and replay it if they agree.
      restoring = true
      history.go(-delta)
      onGuard(guard, () => {
        guard = null
        history.go(delta)
      })
      return
    }
    curIdx = idx
    entries[curIdx] = currentPath()
    saveEntries()
    render()
  })

  addEventListener("beforeunload", (e) => {
    if (guard && guard.isDirty()) e.preventDefault()
  })

  // One delegated handler turns every in-app <a> into a pushState navigation.
  document.addEventListener("click", (e) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const a = t.closest("a[href]")
    if (!(a instanceof HTMLAnchorElement)) return
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    const href = a.getAttribute("href") || ""
    if (!href.startsWith(BASE) || a.target) return
    e.preventDefault()
    const to = href.slice(BASE.length) || "/"
    navigate(to, { replace: a.dataset.replace === "true" })
  })

  render()
}

/** Build an href for an app path. */
export function href(to) {
  return pathWithQuery(to)
}
