/** @file The design review: one page that tours, compares and collects picks
 *  across every round-2 prototype, all served by `node prototypes/serve.js`.
 *
 *  Four views behind hash routes (this page is dev tooling, not the app):
 *    #/            overview grid, grouped by family
 *    #/tour/N      guided tour, step N: the intent beside the live prototype
 *    #/compare/a,b side by side with one shared toolbar
 *    #/picks       your favourites, per-slot keeps and notes, copyable as markdown
 *
 *  DOM is built with textContent only, and no regex (the repo's rules).
 */
import { DESIGNS, FAMILIES } from "./designs.js"

/** @typedef {import('./designs.js').Design} Design */

const app = /** @type {HTMLElement} */ (document.getElementById("app"))
const PICKS_KEY = "tour-picks-v1"

/** Viewing options shared by the tour stage and the compare panes. */
const view = { page: "screen", width: "desktop", dark: false, n: "32" }

// ---- tiny DOM helper --------------------------------------------------------

/**
 * @param {string} tag
 * @param {Record<string, string | boolean | ((e: Event) => void)>} [attrs]
 * @param {Array<Node | string | null | false | undefined>} [children]
 */
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.slice(2), v)
    else if (v === true) el.setAttribute(k, "")
    else if (v !== false) el.setAttribute(k, v)
  }
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue
    el.append(typeof c === "string" ? document.createTextNode(c) : c)
  }
  return el
}

// ---- picks (localStorage) ---------------------------------------------------

/** @typedef {{ star: boolean, keep: string[], note: string }} Pick */

/** @returns {Record<string, Pick>} */
function loadPicks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PICKS_KEY) || "{}")
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

/** @param {string} id @returns {Pick} */
function pickFor(id) {
  return loadPicks()[id] || { star: false, keep: [], note: "" }
}

/** @param {string} id @param {Partial<Pick>} patch */
function savePick(id, patch) {
  const all = loadPicks()
  all[id] = { ...pickFor(id), ...patch }
  localStorage.setItem(PICKS_KEY, JSON.stringify(all))
}

// ---- prototype URLs ---------------------------------------------------------

/** The URL a design should show under the current view options.
 *  @param {Design} d @param {string} [path] */
function frameUrl(d, path) {
  const base = path || (view.page === "book" && d.book ? d.book : d.screen)
  const url = new URL(base, location.origin)
  if (d.track === "guest") {
    url.searchParams.set("n", view.n)
    // The families spell dark mode differently: grows uses ?dark (its ?theme is
    // the effect theme); retro and sound-time use ?theme=dark|light.
    if (d.dark === "dark") url.searchParams.set("dark", view.dark ? "1" : "0")
    if (d.dark === "theme") url.searchParams.set("theme", view.dark ? "dark" : "light")
  }
  return url.pathname + url.search
}

// ---- shared pieces ----------------------------------------------------------

/** @param {() => void} onChange @param {{ guest: boolean }} opts */
function toolbar(onChange, opts) {
  /** @param {string} label @param {keyof typeof view} key @param {Array<[string, string]>} options */
  const seg = (label, key, options) =>
    h("div", { class: "seg", role: "group", "aria-label": label }, [
      h("span", { class: "seg-label" }, [label]),
      ...options.map(([value, text]) =>
        h(
          "button",
          {
            type: "button",
            "aria-pressed": String(String(view[key]) === value),
            onclick: () => {
              /** @type {Record<string, unknown>} */ (view)[key] = key === "dark" ? value === "1" : value
              onChange()
            },
          },
          [text],
        ),
      ),
    ])
  return h("div", { class: "toolbar" }, [
    opts.guest &&
      seg("Show", "page", [
        ["screen", "Guestbook"],
        ["book", "Memory book"],
      ]),
    seg("Width", "width", [
      ["desktop", "Desktop"],
      ["phone", "Phone"],
    ]),
    opts.guest &&
      seg("Mode", "dark", [
        ["0", "Light"],
        ["1", "Dark"],
      ]),
    opts.guest &&
      seg("Notes", "n", [
        ["3", "3"],
        ["32", "32"],
        ["300", "300"],
      ]),
  ])
}

/** @param {Design} d @param {string} [path] */
function stage(d, path) {
  const src = frameUrl(d, path)
  return h("div", { class: `stage stage-${view.width}` }, [
    h("iframe", { src, title: `${d.title} prototype`, loading: "lazy" }),
    h("div", { class: "stage-foot" }, [
      h("a", { href: src, target: "_blank", rel: "noopener" }, ["Open full page ↗"]),
      h("a", { href: d.doc, target: "_blank", rel: "noopener" }, [
        d.track === "admin" ? "Read the IA doc ↗" : "Read the sketch notes ↗",
      ]),
    ]),
  ])
}

/** @param {Design} d */
function starButton(d) {
  const on = pickFor(d.id).star
  return h(
    "button",
    {
      type: "button",
      class: `star${on ? " on" : ""}`,
      "aria-pressed": String(on),
      title: on ? "Unpick" : "Pick as a favourite",
      onclick: (e) => {
        e.stopPropagation()
        savePick(d.id, { star: !pickFor(d.id).star })
        render()
      },
    },
    [on ? "★ Picked" : "☆ Pick"],
  )
}

/** @param {Design} d */
function familyOf(d) {
  return FAMILIES.find((f) => f.id === d.family)
}

// ---- views ------------------------------------------------------------------

function overview() {
  return h("main", { class: "overview" }, [
    h("section", { class: "hero" }, [
      h("h1", {}, ["Design review, round 2"]),
      h("p", {}, [
        "Nine guestbook / memory-book sketches in three families, and three ways to " +
          "reorganise the admin. Everything below is live and running on this one server, " +
          "on the same fictional guests.",
      ]),
      h("div", { class: "hero-actions" }, [
        h("a", { class: "btn primary", href: "#/tour/0" }, ["Start the guided tour →"]),
        h("a", { class: "btn", href: "#/compare/herbarium,guestbook-cgi" }, ["Compare side by side"]),
        h("a", { class: "btn", href: "#/picks" }, [`Your picks (${starredCount()})`]),
      ]),
    ]),
    ...FAMILIES.map((f) =>
      h("section", { class: "family" }, [
        h("h2", {}, [f.title]),
        h("p", { class: "angle" }, [f.angle]),
        h(
          "div",
          { class: "grid" },
          DESIGNS.filter((d) => d.family === f.id).map((d) =>
            h("article", { class: "card" }, [
              h("a", { class: "thumb", href: `#/tour/${stepIndexOf(d.id)}` }, [
                h("img", { src: `/tour/shots/${d.id}.jpg`, alt: "", loading: "lazy" }),
              ]),
              h("div", { class: "card-body" }, [
                h("h3", {}, [d.title]),
                h("p", {}, [d.tagline]),
                h("div", { class: "card-actions" }, [
                  h("a", { href: `#/tour/${stepIndexOf(d.id)}` }, ["Tour"]),
                  h("a", { href: `#/compare/${d.id}` }, ["Compare"]),
                  starButton(d),
                ]),
              ]),
            ]),
          ),
        ),
      ]),
    ),
  ])
}

/** The tour's steps: an intro, then each family (its intro, then its designs),
 *  then a wrap-up.
 *  @typedef {{ kind: "intro" } | { kind: "family", family: typeof FAMILIES[number] } | { kind: "design", design: Design } | { kind: "end" }} Step */

/** @type {Step[]} */
const STEPS = [
  { kind: "intro" },
  ...FAMILIES.flatMap((family) => [
    /** @type {Step} */ ({ kind: "family", family }),
    ...DESIGNS.filter((d) => d.family === family.id).map(
      (design) => /** @type {Step} */ ({ kind: "design", design }),
    ),
  ]),
  { kind: "end" },
]

/** @param {string} id */
function stepIndexOf(id) {
  return STEPS.findIndex((s) => s.kind === "design" && s.design.id === id)
}

function starredCount() {
  return Object.values(loadPicks()).filter((p) => p.star).length
}

/** @param {number} index */
function tour(index) {
  const step = STEPS[Math.max(0, Math.min(index, STEPS.length - 1))]
  const prev = index > 0 ? `#/tour/${index - 1}` : null
  const next = index < STEPS.length - 1 ? `#/tour/${index + 1}` : null
  const nav = h("nav", { class: "tour-nav", "aria-label": "Tour" }, [
    prev ? h("a", { class: "btn", href: prev }, ["← Back"]) : h("span", {}, []),
    h("span", { class: "tour-count" }, [`${index + 1} / ${STEPS.length}`]),
    next ? h("a", { class: "btn primary", href: next }, ["Next →"]) : h("a", { class: "btn primary", href: "#/picks" }, ["Your picks →"]),
  ])

  if (step.kind !== "design") {
    return h("main", { class: "tour tour-text" }, [nav, h("article", { class: "prose" }, proseFor(step)), nav.cloneNode(true)])
  }

  const d = step.design
  const fam = familyOf(d)
  const pick = pickFor(d.id)
  return h("main", { class: "tour" }, [
    nav,
    h("div", { class: "tour-split" }, [
      h("aside", { class: "intent" }, [
        h("p", { class: "eyebrow" }, [fam ? fam.title : ""]),
        h("h2", {}, [d.title]),
        h("p", { class: "tagline" }, [d.tagline]),
        h("h3", {}, ["The idea"]),
        h("p", {}, [d.intent]),
        h("h3", {}, ["What's surprising"]),
        h("p", {}, [d.surprise]),
        d.slots &&
          h("div", {}, [
            h("h3", {}, ["Pieces you could mix and match"]),
            h(
              "ul",
              { class: "slots" },
              d.slots.map((s) =>
                h("li", {}, [
                  h("label", {}, [
                    h("input", {
                      type: "checkbox",
                      checked: pick.keep.includes(s.slot),
                      onchange: (e) => {
                        const box = /** @type {HTMLInputElement} */ (e.target)
                        const keep = pickFor(d.id).keep.filter((k) => k !== s.slot)
                        if (box.checked) keep.push(s.slot)
                        savePick(d.id, { keep })
                      },
                    }),
                    h("span", { class: "slot-name" }, [s.slot]),
                    " ",
                    s.id,
                  ]),
                ]),
              ),
            ),
            h("p", { class: "hint" }, ["Tick a piece to keep it, even if you don't pick the whole design."]),
          ]),
        d.links &&
          h("div", {}, [
            h("h3", {}, ["Jump to"]),
            h(
              "ul",
              { class: "links" },
              d.links.map((l) =>
                h("li", {}, [
                  h(
                    "button",
                    {
                      type: "button",
                      class: "linkish",
                      onclick: () => {
                        const frame = app.querySelector(".stage iframe")
                        if (frame instanceof HTMLIFrameElement) frame.src = frameUrl(d, l.path)
                      },
                    },
                    [l.label],
                  ),
                ]),
              ),
            ),
          ]),
        h("h3", {}, ["Cost"]),
        h("p", {}, [d.cost]),
        h("h3", {}, ["Risks the agent flagged"]),
        h("ul", {}, d.risks.map((r) => h("li", {}, [r]))),
        d.questions.length > 0 &&
          h("div", {}, [h("h3", {}, ["Questions for you"]), h("ul", {}, d.questions.map((q) => h("li", {}, [q])))]),
        h("h3", {}, ["Your notes"]),
        h("textarea", {
          rows: "3",
          placeholder: "What you liked, what you didn't…",
          oninput: (e) => savePick(d.id, { note: /** @type {HTMLTextAreaElement} */ (e.target).value }),
        }),
        h("div", { class: "intent-actions" }, [starButton(d), h("a", { class: "btn", href: `#/compare/${d.id}` }, ["Compare with…"])]),
      ]),
      h("section", { class: "viewer" }, [toolbar(render, { guest: d.track === "guest" }), stage(d)]),
    ]),
  ])
}

/** @param {Step} step @returns {Node[]} */
function proseFor(step) {
  if (step.kind === "intro") {
    return [
      h("h1", {}, ["Round 2: why these exist"]),
      h("p", {}, [
        "Round 1's three designs (confetti party, romantic keepsake, theme-native) were " +
          "“all okay, but a little safe and kinda boring… people had already seen all " +
          "that on the front page.” So round 2 went looking for things only a guestbook " +
          "can do, from three deliberately different angles.",
      ]),
      h("p", {}, [
        "Every guest-page sketch is built from interchangeable pieces (background, card " +
          "style, burst, memory-book layout, and sometimes an arrangement), so you can keep " +
          "one sketch's book and another's background. The tour lets you tick the pieces " +
          "you like as you go.",
      ]),
      h("p", {}, [
        "The admin track is different: three information architectures for the redesign " +
          "your faces issues asked for. Pick one, or the best parts of each.",
      ]),
      h("p", { class: "hint" }, [
        "Every sketch uses the same 32 fictional guests. Use the toolbar to switch to the " +
          "memory book, a phone width, dark mode, or 3 or 300 notes. Arrow keys move through the tour.",
      ]),
    ]
  }
  if (step.kind === "family") {
    const designs = DESIGNS.filter((d) => d.family === step.family.id)
    return [
      h("p", { class: "eyebrow" }, [step.family.id === "admin" ? "Admin" : "Guest pages"]),
      h("h1", {}, [step.family.title]),
      h("p", {}, [step.family.angle]),
      h("ul", { class: "family-list" }, designs.map((d) => h("li", {}, [h("strong", {}, [d.title]), ": ", d.tagline]))),
    ]
  }
  return [
    h("h1", {}, ["That's everything"]),
    h("p", {}, [
      "Next: compare your favourites side by side, then open Your picks and copy the " +
        "summary back to Claude. That summary is what the build phase works from: the " +
        "admin design to build, and which guest-page pieces become real slots.",
    ]),
    h("p", {}, [h("a", { class: "btn primary", href: "#/picks" }, ["Your picks →"])]),
  ]
}

/** @param {string[]} ids */
function compare(ids) {
  const chosen = ids.map((id) => DESIGNS.find((d) => d.id === id)).filter((d) => d !== undefined)
  while (chosen.length < 2) {
    const fallback = DESIGNS.find((d) => !chosen.includes(d) && (chosen.length === 0 || d.track === chosen[0].track))
    if (!fallback) break
    chosen.push(fallback)
  }
  const anyGuest = chosen.some((d) => d.track === "guest")

  /** @param {number} slot */
  const picker = (slot) =>
    h(
      "select",
      {
        "aria-label": `Design ${slot + 1}`,
        onchange: (e) => {
          const next = chosen.map((d) => d.id)
          next[slot] = /** @type {HTMLSelectElement} */ (e.target).value
          location.hash = `#/compare/${next.join(",")}`
        },
      },
      FAMILIES.map((f) =>
        h(
          "optgroup",
          { label: f.title },
          DESIGNS.filter((d) => d.family === f.id).map((d) =>
            h("option", { value: d.id, selected: d.id === chosen[slot].id }, [d.title]),
          ),
        ),
      ),
    )

  return h("main", { class: "compare" }, [
    h("div", { class: "compare-head" }, [
      h("h1", {}, ["Compare"]),
      toolbar(render, { guest: anyGuest }),
      chosen.length < 3 &&
        h(
          "button",
          {
            type: "button",
            class: "btn",
            onclick: () => {
              const extra = DESIGNS.find((d) => !chosen.includes(d) && d.track === chosen[0].track)
              if (extra) location.hash = `#/compare/${[...chosen, extra].map((d) => d.id).join(",")}`
            },
          },
          ["+ Add a third"],
        ),
    ]),
    h(
      "div",
      { class: `compare-grid cols-${chosen.length}` },
      chosen.map((d, i) =>
        h("section", { class: "pane" }, [
          h("div", { class: "pane-head" }, [picker(i), starButton(d)]),
          h("p", { class: "pane-tagline" }, [d.tagline]),
          stage(d),
        ]),
      ),
    ),
  ])
}

function picks() {
  const all = loadPicks()
  const starred = DESIGNS.filter((d) => all[d.id]?.star)
  const kept = DESIGNS.filter((d) => (all[d.id]?.keep || []).length > 0)
  const noted = DESIGNS.filter((d) => (all[d.id]?.note || "").trim())
  const summary = summaryMarkdown()
  return h("main", { class: "picks prose" }, [
    h("h1", {}, ["Your picks"]),
    starred.length === 0 && kept.length === 0 && noted.length === 0
      ? h("p", {}, ["Nothing picked yet. Use ☆ Pick and the piece checkboxes in the tour."])
      : h("div", {}, [
          h("h2", {}, ["Favourites"]),
          h("ul", {}, starred.length ? starred.map((d) => h("li", {}, [d.title])) : [h("li", {}, ["None starred."])]),
          h("h2", {}, ["Pieces to keep"]),
          h(
            "ul",
            {},
            kept.length
              ? kept.map((d) => h("li", {}, [`${d.title}: ${(all[d.id]?.keep || []).join(", ")}`]))
              : [h("li", {}, ["None ticked."])],
          ),
        ]),
    h("h2", {}, ["Summary to paste back to Claude"]),
    h("textarea", { class: "summary", rows: "14", readonly: true }, [summary]),
    h("div", { class: "intent-actions" }, [
      h(
        "button",
        {
          type: "button",
          class: "btn primary",
          onclick: (e) => {
            const button = /** @type {HTMLButtonElement} */ (e.target)
            void navigator.clipboard.writeText(summary).then(() => {
              button.textContent = "Copied ✓"
            })
          },
        },
        ["Copy summary"],
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn",
          onclick: () => {
            if (confirm("Clear every pick, kept piece and note?")) {
              localStorage.removeItem(PICKS_KEY)
              render()
            }
          },
        },
        ["Clear all"],
      ),
    ]),
  ])
}

function summaryMarkdown() {
  const all = loadPicks()
  const lines = ["# Design review picks", ""]
  for (const f of FAMILIES) {
    const rows = DESIGNS.filter((d) => d.family === f.id).filter((d) => {
      const p = all[d.id]
      return p && (p.star || p.keep.length > 0 || p.note.trim())
    })
    if (rows.length === 0) continue
    lines.push(`## ${f.title}`)
    for (const d of rows) {
      const p = all[d.id]
      const bits = [p.star ? "★ picked" : "", p.keep.length ? `keep: ${p.keep.join(", ")}` : ""].filter(Boolean)
      lines.push(`- **${d.title}**${bits.length ? ` (${bits.join("; ")})` : ""}`)
      if (p.note.trim()) lines.push(`  - ${p.note.trim().split("\n").join("\n    ")}`)
    }
    lines.push("")
  }
  return lines.length > 2 ? lines.join("\n") : "Nothing picked yet."
}

// ---- router -----------------------------------------------------------------

function render() {
  const hash = location.hash.startsWith("#/") ? location.hash.slice(2) : ""
  const [name, arg] = hash.split("/")
  /** @type {HTMLElement} */
  let page
  if (name === "tour") page = tour(Number(arg) || 0)
  else if (name === "compare") page = compare((arg || "").split(",").filter(Boolean))
  else if (name === "picks") page = picks()
  else page = overview()
  app.replaceChildren(header(name || "overview"), page)
  // Restore note text after render (textarea value is not an attribute).
  const step = name === "tour" ? STEPS[Number(arg) || 0] : null
  if (step && step.kind === "design") {
    const note = app.querySelector(".intent textarea")
    if (note instanceof HTMLTextAreaElement) note.value = pickFor(step.design.id).note
  }
}

/** @param {string} current */
function header(current) {
  /** @param {string} href @param {string} key @param {string} text */
  const link = (href, key, text) => h("a", { href, "aria-current": current === key ? "page" : "false" }, [text])
  return h("header", { class: "top" }, [
    h("a", { class: "brand", href: "#/" }, ["Design review"]),
    h("nav", {}, [
      link("#/", "overview", "Overview"),
      link("#/tour/0", "tour", "Guided tour"),
      link("#/compare/herbarium,guestbook-cgi", "compare", "Compare"),
      link("#/picks", "picks", `Your picks (${starredCount()})`),
    ]),
  ])
}

window.addEventListener("hashchange", () => {
  render()
  window.scrollTo(0, 0)
})
document.addEventListener("keydown", (e) => {
  const target = e.target
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return
  if (!location.hash.startsWith("#/tour/")) return
  const n = Number(location.hash.slice("#/tour/".length)) || 0
  if (e.key === "ArrowRight" && n < STEPS.length - 1) location.hash = `#/tour/${n + 1}`
  if (e.key === "ArrowLeft" && n > 0) location.hash = `#/tour/${n - 1}`
})
render()
