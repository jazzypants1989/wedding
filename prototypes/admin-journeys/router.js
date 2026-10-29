/** @file The router — the part of this prototype meant to survive into the real
 *  admin more or less as written. Real paths, pushState/popstate, no regex.
 *
 *  HISTORY RULES (the route table in IA.md is these rules applied):
 *   - A new SCREEN pushes: sidebar, stepper, "Next step", opening a group, a card
 *     composer, a dialog.
 *   - Stepping WITHIN a screen replaces: next post, next group, next face to ask.
 *     The URL always names what you're looking at (reload/deep-link safe) but Back
 *     never makes you re-walk forty approvals — Back undoes navigation, not work.
 *   - "Up" (← All groups, closing a dialog) goes back() if the previous entry IS
 *     the parent, otherwise pushes (or, for a dialog, replaces) the parent. So a
 *     deep-linked dialog never strands you, and Back never reopens what you closed.
 *   - Finishing something irreversible (sending cards) REPLACES the confirm screen
 *     with the result, so Back can't land on "Send 6 cards" again.
 *
 *  GUARDS: a screen may register `guard = { dirty(), save() }`. In-app navigation
 *  asks first. popstate can't be cancelled, so on Back/Forward we undo the move
 *  with history.go(+delta) (we track an index in history.state, so we know the
 *  delta) and ask; if the index is unknown we fall back to re-pushing the old URL.
 *  beforeunload covers reload/close. */

/**
 * @typedef {{ pattern: string, name: string, dialog?: string, parent?: string,
 *   redirect?: (p: Record<string, string>) => string | null }} RouteDef
 * @typedef {{ route: RouteDef, params: Record<string, string>, path: string,
 *   query: URLSearchParams }} Match
 * @typedef {{ dirty: () => boolean, save?: () => void, discard?: () => void, what: string }} Guard
 */

/** @param {string} pattern @param {string} path @returns {Record<string, string> | null} */
function matchPattern(pattern, path) {
  const a = pattern.split("/").filter(Boolean)
  const b = path.split("/").filter(Boolean)
  if (a.length !== b.length) return null
  /** @type {Record<string, string>} */
  const params = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i])
    else if (a[i] !== b[i]) return null
  }
  return params
}

/** @param {string} pattern @param {Record<string, string>} params */
export function fill(pattern, params) {
  return pattern
    .split("/")
    .map((seg) => (seg.startsWith(":") ? encodeURIComponent(params[seg.slice(1)] || "") : seg))
    .join("/")
}

/**
 * @param {{ base: string, routes: RouteDef[], render: (m: Match) => void,
 *   confirmLeave: (what: string) => Promise<"stay" | "discard" | "save"> }} opts
 */
export function createRouter(opts) {
  const { base, routes, render, confirmLeave } = opts
  /** @type {Guard | null} */
  let guard = null
  let idx = 0
  let restoring = false
  let bypass = false
  /** @type {Match | null} */
  let current = null
  const STACK_KEY = "aj-stack"
  /** @type {Record<string, string>} idx -> path, for "is the previous entry the parent?" */
  let stack = {}
  try {
    stack = JSON.parse(sessionStorage.getItem(STACK_KEY) || "{}")
  } catch {}
  const saveStack = () => sessionStorage.setItem(STACK_KEY, JSON.stringify(stack))

  /** Path inside the app (base stripped), without query. */
  function appPath() {
    const p = location.pathname
    const rel = p.startsWith(base) ? p.slice(base.length) : p
    return rel === "" ? "/" : rel
  }

  /** @param {string} full @returns {Match} */
  function resolve(full) {
    const q = full.indexOf("?")
    const path = q === -1 ? full : full.slice(0, q)
    const query = new URLSearchParams(q === -1 ? "" : full.slice(q + 1))
    const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path
    for (const route of routes) {
      const params = matchPattern(route.pattern, clean)
      if (params) return { route, params, path: clean, query }
    }
    return { route: { pattern: "*", name: "notfound" }, params: {}, path: clean, query }
  }

  function remember() {
    // Save scroll on the entry we're leaving.
    const st = history.state || {}
    history.replaceState({ ...st, idx, scroll: window.scrollY }, "")
  }

  /** @param {string} full */
  function show(full, scroll = 0) {
    let m = resolve(full)
    if (m.route.redirect) {
      const to = m.route.redirect(m.params)
      if (to && to !== m.path) {
        history.replaceState({ idx, scroll: 0 }, "", base + to)
        stack[idx] = to
        saveStack()
        m = resolve(to)
      }
    }
    current = m
    guard = null
    render(m)
    window.scrollTo(0, scroll)
  }

  /** @param {string} to @param {{ replace?: boolean, force?: boolean }} [o] */
  async function navigate(to, o = {}) {
    if (!o.force && guard && guard.dirty()) {
      const choice = await confirmLeave(guard.what)
      if (choice === "stay") return
      if (choice === "save" && guard.save) guard.save()
      if (choice === "discard" && guard.discard) guard.discard()
    }
    if (o.replace) {
      history.replaceState({ idx, scroll: 0 }, "", base + to)
    } else {
      remember()
      idx += 1
      history.pushState({ idx, scroll: 0 }, "", base + to)
    }
    stack[idx] = to
    // forget forward entries we just overwrote
    for (const k of Object.keys(stack)) if (Number(k) > idx) delete stack[k]
    saveStack()
    show(to)
  }

  window.addEventListener("popstate", async (e) => {
    const st = e.state || {}
    const target = typeof st.idx === "number" ? st.idx : null
    if (restoring) {
      restoring = false
      if (target !== null) idx = target
      return
    }
    if (!bypass && guard && guard.dirty()) {
      const was = idx
      const keepPath = current ? current.path + (current.query.toString() ? "?" + current.query : "") : "/"
      if (target !== null) {
        restoring = true
        history.go(was - target) // undo the move without losing forward history
      } else {
        history.pushState({ idx: was }, "", base + keepPath) // fallback: re-push
      }
      const choice = await confirmLeave(guard.what)
      if (choice === "stay") return
      if (choice === "save" && guard.save) guard.save()
      if (choice === "discard" && guard.discard) guard.discard()
      if (target !== null) {
        bypass = true
        history.go(target - was)
      }
      return
    }
    bypass = false
    idx = target !== null ? target : idx + 1
    show(appPath() + location.search, typeof st.scroll === "number" ? st.scroll : 0)
  })

  window.addEventListener("beforeunload", (e) => {
    if (guard && guard.dirty()) {
      e.preventDefault()
      e.returnValue = ""
    }
  })

  // Real <a href> everywhere, so middle-click / open-in-new-tab still work.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const t = e.target instanceof Element ? e.target.closest("a[href]") : null
    if (!t) return
    const href = t.getAttribute("href") || ""
    if (!href.startsWith(base + "/") && href !== base) return
    if (t.getAttribute("target")) return
    e.preventDefault()
    const to = href.slice(base.length) || "/"
    const mode = t.getAttribute("data-nav")
    if (mode === "up") up(to)
    else navigate(to, { replace: mode === "replace" })
  })

  /** "Up" to a parent: back() if that's literally where we came from. @param {string} to */
  function up(to) {
    if (stack[idx - 1] === to && idx > 0) history.back()
    else navigate(to)
  }

  /** Close the current route's dialog. */
  function closeDialog() {
    if (!current || !current.route.parent) return
    const parent = fill(current.route.parent, current.params)
    if (stack[idx - 1] === parent && idx > 0) history.back()
    else navigate(parent, { replace: true })
  }

  function start() {
    const st = history.state || {}
    idx = typeof st.idx === "number" ? st.idx : 0
    history.replaceState({ idx, scroll: st.scroll || 0 }, "")
    stack[idx] = appPath()
    saveStack()
    show(appPath() + location.search, st.scroll || 0)
  }

  return {
    start,
    navigate,
    up,
    closeDialog,
    /** Re-render the current route in place (after a mutation). */
    refresh() {
      const y = window.scrollY
      if (current) show(current.path + (current.query.toString() ? "?" + current.query : ""), y)
    },
    /** @param {Guard | null} g */
    setGuard(g) {
      guard = g
    },
    get current() {
      return current
    },
    get depth() {
      return idx
    },
    link: (/** @type {string} */ p) => base + p,
  }
}
