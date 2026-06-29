/** @file Change-review dashboard. Loads manifest.json and renders an
 *  interactive before/after for each change. Zero deps, no regex, CSP-safe
 *  (all DOM built via the DOM API; no inline scripts/styles). */

const panelEl = document.getElementById("panel")
const navEl = document.getElementById("nav")
const summaryEl = document.getElementById("summary")
const buildMetaEl = document.getElementById("build-meta")

/** @type {any} */
let manifest = null
/** Active effect preview, so we can tear it down on navigation. */
let preview = null

/** Persisted per-change verdicts/notes. Keyed by entry id; survives rebuilds. */
const STORE_KEY = "wedding-change-review/decisions/v1"
/** @type {Record<string, { verdict: string, note: string, updatedAt: string }>} */
let decisions = loadDecisions()

function loadDecisions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "{}")
    // Migrate the earlier "toss" verdict to the clearer "drop".
    for (const id of Object.keys(parsed)) {
      if (parsed[id] && parsed[id].verdict === "toss") parsed[id].verdict = "drop"
    }
    return parsed
  } catch {
    return {}
  }
}

function persistDecisions() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(decisions))
  } catch {}
}

/** @param {string} id @param {{ verdict?: string, note?: string }} patch */
function setDecision(id, patch) {
  const cur = decisions[id] || { verdict: "", note: "", updatedAt: "" }
  const next = {
    verdict: patch.verdict !== undefined ? patch.verdict : cur.verdict,
    note: patch.note !== undefined ? patch.note : cur.note,
    updatedAt: new Date().toISOString(),
  }
  if (!next.verdict && !next.note.trim()) delete decisions[id]
  else decisions[id] = next
  persistDecisions()
  updateNavMark(id)
  updateProgress()
}

// ---------------------------------------------------------------------------
// tiny DOM helpers
// ---------------------------------------------------------------------------

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

/** Map a verdict/recommendation word to its colour class. @param {string} rec */
function recClass(rec) {
  const r = rec.toLowerCase()
  if (r === "keep") return "rec-keep"
  if (r === "maybe") return "rec-review"
  if (r === "drop") return "rec-toss"
  return "rec-neutral"
}

/** @param {number} bytes */
function kib(bytes) {
  if (!bytes) return "—"
  if (bytes < 1024) return bytes + " B"
  return (bytes / 1024).toFixed(1) + " KiB"
}

/** @param {string} s */
function isAllDigits(s) {
  if (!s.length) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

async function load() {
  try {
    const res = await fetch("/pages/demo/manifest.json", { cache: "no-store" })
    if (!res.ok) throw new Error("HTTP " + res.status)
    manifest = await res.json()
  } catch (err) {
    panelEl.textContent =
      "Could not load manifest.json — run `npm run demo:build` first. (" +
      (err instanceof Error ? err.message : String(err)) +
      ")"
    return
  }
  renderSummary()
  renderNav()
  setupReviewControls()
  updateProgress()
  buildMetaEl.textContent =
    "Generated " +
    new Date(manifest.generatedAtIso).toLocaleString() +
    " · build " +
    manifest.buildId

  const initial = location.hash ? location.hash.slice(1) : ""
  if (initial && manifest.entries.some((e) => e.id === initial)) {
    selectEntry(initial)
  }
}

window.addEventListener("hashchange", () => {
  const id = location.hash ? location.hash.slice(1) : ""
  if (manifest && id && manifest.entries.some((e) => e.id === id)) selectEntry(id)
})

function renderSummary() {
  const c = manifest.counts
  summaryEl.appendChild(pill(c.total + " changes"))
  const order = ["Keep", "Maybe", "Drop"]
  for (const rec of order) {
    if (c.byRecommendation[rec]) {
      const p = pill("")
      p.appendChild(el("b", null, String(c.byRecommendation[rec])))
      p.appendChild(document.createTextNode(" " + rec))
      p.classList.add(recClass(rec))
      summaryEl.appendChild(p)
    }
  }
}

/** @param {string} text */
function pill(text) {
  return el("span", "pill", text)
}

function renderNav() {
  for (const cat of manifest.categoryOrder) {
    const items = manifest.entries.filter((e) => e.category === cat)
    if (!items.length) continue
    navEl.appendChild(el("div", "nav-group-title", manifest.categoryLabels[cat]))
    for (const entry of items) {
      const btn = el("button", "nav-item")
      btn.type = "button"
      btn.dataset.id = entry.id
      btn.appendChild(el("span", "nav-title", entry.title))
      const meta = el("div", "nav-meta")
      meta.appendChild(el("span", "chip " + recClass(entry.recommendation), entry.recommendation))
      if (entry.origin === "commit" && entry.commit) {
        meta.appendChild(el("span", "badge", entry.commit))
      }
      const mark = el("span", "nav-mark")
      mark.dataset.mark = entry.id
      meta.appendChild(mark)
      btn.appendChild(meta)
      btn.addEventListener("click", () => selectEntry(entry.id))
      navEl.appendChild(btn)
    }
  }
}

/** @param {string} id */
function selectEntry(id) {
  const entry = manifest.entries.find((e) => e.id === id)
  if (!entry) return
  for (const b of navEl.querySelectorAll(".nav-item")) {
    b.classList.toggle("active", b.dataset.id === id)
  }
  if (location.hash.slice(1) !== id) {
    history.replaceState(null, "", "#" + id)
  }
  renderPanel(entry)
}

// ---------------------------------------------------------------------------
// panel
// ---------------------------------------------------------------------------

/** @param {any} entry */
function renderPanel(entry) {
  stopPreview()
  panelEl.textContent = ""

  const head = el("div", "panel-head")
  const tags = el("div", "panel-tags")
  const sugg = el("span", "chip " + recClass(entry.recommendation))
  sugg.appendChild(el("span", "chip-pre", "my take: "))
  sugg.appendChild(document.createTextNode(entry.recommendation))
  tags.appendChild(sugg)
  tags.appendChild(el("span", "badge", manifest.categoryLabels[entry.category] || entry.category))
  tags.appendChild(el("span", "badge", entry.origin === "commit" ? "commit " + entry.commit : "uncommitted"))
  head.appendChild(tags)
  head.appendChild(el("h2", null, entry.title))
  head.appendChild(el("p", "panel-summary", entry.summary))
  const rat = el("div", "rationale")
  rat.appendChild(el("b", null, "Why this recommendation: "))
  rat.appendChild(document.createTextNode(entry.rationale))
  head.appendChild(rat)
  panelEl.appendChild(head)

  panelEl.appendChild(renderDecision(entry))

  // Tabs: see/interact first (Preview), measure (Impact), read the code (Code).
  // The diff is demoted to a secondary tab rather than the primary artifact.
  const tabDefs = buildTabs(entry)
  const tabbar = el("div", "tabbar")
  const body = el("div", "tab-body")
  for (const t of tabDefs) {
    const b = el("button", "tab", t.label)
    b.type = "button"
    b.dataset.tab = t.id
    b.addEventListener("click", () => activateTab(entry, tabDefs, t.id, tabbar, body))
    tabbar.appendChild(b)
  }
  panelEl.appendChild(tabbar)
  panelEl.appendChild(body)
  if (tabDefs.length) activateTab(entry, tabDefs, tabDefs[0].id, tabbar, body)

  panelEl.scrollTop = 0
  panelEl.focus()
}

/** Which tabs an entry offers, in priority order. @param {any} entry */
function buildTabs(entry) {
  /** @type {{id:string,label:string,render:(e:any,host:HTMLElement)=>void}[]} */
  const tabs = []
  if (entry.preview) tabs.push({ id: "preview", label: previewTabLabel(entry.preview.kind), render: renderPreview })
  if (entry.metrics) tabs.push({ id: "impact", label: "📊 Impact", render: renderImpact })
  if (entry.demoType === "markdown" && entry.docs) tabs.push({ id: "doc", label: "📄 Document", render: renderMarkdownWidget })
  if (entry.diff) tabs.push({ id: "code", label: "‹ › Code", render: renderDiffWidget })
  if (!tabs.length) tabs.push({ id: "notes", label: "Details", render: renderNoteWidget })
  return tabs
}

/** @param {string} kind */
function previewTabLabel(kind) {
  if (kind === "page") return "👁 Preview · page"
  if (kind === "table") return "👁 Preview · table"
  if (kind === "effect") return "👁 Preview · effect"
  if (kind === "image") return "👁 Preview · images"
  return "👁 Preview"
}

/** @param {any} entry @param {any[]} tabDefs @param {string} id @param {HTMLElement} tabbar @param {HTMLElement} body */
function activateTab(entry, tabDefs, id, tabbar, body) {
  stopPreview()
  for (const b of tabbar.querySelectorAll(".tab")) b.classList.toggle("on", b.dataset.tab === id)
  body.textContent = ""
  const def = tabDefs.find((t) => t.id === id)
  if (def) def.render(entry, body)
}

/** Preview-tab dispatch by preview kind. @param {any} entry @param {HTMLElement} host */
function renderPreview(entry, host) {
  const kind = entry.preview.kind
  if (kind === "effect") return renderEffectPreview(entry, host)
  if (kind === "page") return renderPagePreview(entry, host)
  if (kind === "table") return renderTablePreview(entry, host)
  if (kind === "image") return renderImageSlider(entry, host)
  renderNoteWidget(entry, host)
}

// ---------------------------------------------------------------------------
// effect preview (inline clipped pane + true side-by-side iframes)
// ---------------------------------------------------------------------------

/** @param {string} id */
function effectHint(id) {
  if (id === "cursor") return "Move your mouse across the pane to draw the trail."
  if (id === "entrance") return "Plays once on load — press Replay to watch it again."
  if (id === "parallaxsparkles") return "Scroll inside the pane; sparkles drift by depth."
  if (id === "burst" || id === "textglow" || id === "namespark") return "Runs on load — press Replay to repeat."
  return "Press Replay to restart the animation."
}

/** @param {any} effect @param {string} refKey @param {string} verlabel */
function effectHostUrl(effect, refKey, verlabel) {
  const q = new URLSearchParams({
    base: manifest.snapBase,
    ver: refKey,
    id: effect.id,
    file: effect.file,
    create: effect.create,
    label: effect.label,
    verlabel,
  })
  return "/pages/demo/host.html?" + q.toString()
}

/** @param {any} entry @param {HTMLElement} host */
function renderEffectPreview(entry, host) {
  const effects = (entry.preview && entry.preview.effects) || entry.effects || []
  const beforeRef = entry.refs.before
  const afterRef = entry.refs.after
  let selectedEffect = effects[0]
  let side = afterRef.key
  let mode = "inline"

  const section = el("div", "section")
  const controls = el("div", "fx-controls")

  const modeToggle = el("div", "toggle")
  const inlineBtn = el("button", null, "Inline")
  inlineBtn.type = "button"
  const sbsBtn = el("button", null, "Side by side")
  sbsBtn.type = "button"
  modeToggle.appendChild(inlineBtn)
  modeToggle.appendChild(sbsBtn)
  controls.appendChild(modeToggle)

  let select = null
  if (effects.length > 1) {
    const lab = el("label", "fx-effect-label", "Effect: ")
    select = el("select", "fx-select")
    for (const e of effects) {
      const opt = el("option", null, e.label)
      opt.value = e.id
      select.appendChild(opt)
    }
    lab.appendChild(select)
    controls.appendChild(lab)
  }
  section.appendChild(controls)

  const stageArea = el("div", "fx-area")
  section.appendChild(stageArea)
  host.appendChild(section)

  function renderInline() {
    const row = el("div", "fx-controls")
    const toggle = el("div", "toggle")
    const beforeBtn = el("button", null, beforeRef.label)
    beforeBtn.type = "button"
    const afterBtn = el("button", null, afterRef.label)
    afterBtn.type = "button"
    toggle.appendChild(beforeBtn)
    toggle.appendChild(afterBtn)
    row.appendChild(toggle)
    const replay = el("button", "btn", "↻ Replay")
    replay.type = "button"
    row.appendChild(replay)
    const fs = el("button", "btn", "⤢ Fullscreen")
    fs.type = "button"
    row.appendChild(fs)
    stageArea.appendChild(row)

    const wrap = el("div", "fx-stage-wrap")
    const label = el("div", "fx-stage-label", "")
    const stage = el("div", "fx-stage")
    wrap.appendChild(label)
    wrap.appendChild(stage)
    stageArea.appendChild(wrap)
    stageArea.appendChild(
      el("p", "fx-hint", effectHint(selectedEffect.id) + "  Layers are clipped to this pane — use Fullscreen or Side by side for an exact view."),
    )

    function apply() {
      const isBefore = side === beforeRef.key
      beforeBtn.classList.toggle("on", isBefore)
      afterBtn.classList.toggle("on", !isBefore)
      label.textContent = isBefore ? beforeRef.label : afterRef.label
      startPreview(stage, selectedEffect, side)
    }
    beforeBtn.addEventListener("click", () => { side = beforeRef.key; apply() })
    afterBtn.addEventListener("click", () => { side = afterRef.key; apply() })
    replay.addEventListener("click", apply)
    fs.addEventListener("click", () => {
      const ref = side === beforeRef.key ? beforeRef : afterRef
      window.open(effectHostUrl(selectedEffect, ref.key, ref.label), "_blank", "noopener")
    })
    apply()
  }

  function effectPane(ref) {
    const pane = el("div", "fx-pane")
    const bar = el("div", "fx-pane-bar")
    bar.appendChild(el("span", "fx-pane-label", ref.label))
    const replay = el("button", "btn btn-mini", "↻")
    replay.type = "button"
    const fs = el("button", "btn btn-mini", "⤢")
    fs.type = "button"
    bar.appendChild(replay)
    bar.appendChild(fs)
    pane.appendChild(bar)
    const frame = el("iframe", "fx-frame")
    frame.src = effectHostUrl(selectedEffect, ref.key, ref.label)
    pane.appendChild(frame)
    replay.addEventListener("click", () => { frame.src = effectHostUrl(selectedEffect, ref.key, ref.label) })
    fs.addEventListener("click", () => window.open(effectHostUrl(selectedEffect, ref.key, ref.label), "_blank", "noopener"))
    return pane
  }

  function renderSideBySide() {
    const grid = el("div", "fx-sbs")
    grid.appendChild(effectPane(beforeRef))
    grid.appendChild(effectPane(afterRef))
    stageArea.appendChild(grid)
    stageArea.appendChild(el("p", "fx-hint", effectHint(selectedEffect.id)))
  }

  function render() {
    inlineBtn.classList.toggle("on", mode === "inline")
    sbsBtn.classList.toggle("on", mode === "side")
    stopPreview()
    stageArea.textContent = ""
    if (mode === "inline") renderInline()
    else renderSideBySide()
  }

  inlineBtn.addEventListener("click", () => { mode = "inline"; render() })
  sbsBtn.addEventListener("click", () => { mode = "side"; render() })
  if (select) {
    select.addEventListener("change", () => {
      selectedEffect = effects.find((e) => e.id === select.value) || effects[0]
      render()
    })
  }
  render()
}

// ---------------------------------------------------------------------------
// full-page A/B preview (iframes via the permissive demo server + live timing)
// ---------------------------------------------------------------------------

/** @param {any} entry @param {HTMLElement} host */
function renderPagePreview(entry, host) {
  const beforeRef = entry.refs.before
  const afterRef = entry.refs.after
  const pagePath = entry.preview.path
  const viewports = entry.preview.viewports || ["desktop"]
  let width = viewports[0]
  let layout = "side"
  /** @type {{before: any, after: any}} */
  const timings = { before: null, after: null }

  const section = el("div", "section section-wide")
  const controls = el("div", "fx-controls")

  const layoutToggle = el("div", "toggle")
  const sideBtn = el("button", null, "Side by side")
  sideBtn.type = "button"
  const fadeBtn = el("button", null, "Fade overlay")
  fadeBtn.type = "button"
  layoutToggle.appendChild(sideBtn)
  layoutToggle.appendChild(fadeBtn)
  controls.appendChild(layoutToggle)

  const widthToggle = el("div", "toggle")
  const deskBtn = el("button", null, "Desktop")
  deskBtn.type = "button"
  const mobBtn = el("button", null, "Mobile")
  mobBtn.type = "button"
  widthToggle.appendChild(deskBtn)
  widthToggle.appendChild(mobBtn)
  controls.appendChild(widthToggle)

  const openBoth = el("button", "btn", "⤢ Open both")
  openBoth.type = "button"
  controls.appendChild(openBoth)
  section.appendChild(controls)

  const timing = el("div", "perf-timing")
  section.appendChild(timing)
  const area = el("div", "page-area")
  section.appendChild(area)
  host.appendChild(section)

  function srcFor(refKey) { return manifest.snapMount + "/" + refKey + "/" + pagePath }
  function ms(t, k) { return t && t[k] != null ? t[k] + " ms" : "…" }

  function drawTiming() {
    timing.textContent = ""
    timing.appendChild(el("p", "section-title", "Live load timing — local machine, relative comparison"))
    const tbl = el("table", "data-table")
    const head = el("tr")
    for (const h of ["Metric", beforeRef.label, afterRef.label]) head.appendChild(el("th", null, h))
    tbl.appendChild(head)
    const rows = [["First paint (FCP)", "fcp"], ["DOMContentLoaded", "dcl"], ["Load complete", "load"]]
    for (const r of rows) {
      const tr = el("tr")
      tr.appendChild(el("td", null, r[0]))
      tr.appendChild(el("td", "num", ms(timings.before, r[1])))
      tr.appendChild(el("td", "num", ms(timings.after, r[1])))
      tbl.appendChild(tr)
    }
    timing.appendChild(tbl)
  }

  /** @param {HTMLIFrameElement} frame @param {string} key */
  function attachTiming(frame, key) {
    frame.addEventListener("load", () => {
      setTimeout(() => {
        try {
          const w = /** @type {any} */ (frame.contentWindow)
          const nav = w.performance.getEntriesByType("navigation")[0]
          const fcp = w.performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint")
          timings[key] = {
            dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
            load: nav ? Math.round(nav.loadEventEnd) : null,
            fcp: fcp ? Math.round(fcp.startTime) : null,
          }
          drawTiming()
        } catch {}
      }, 80)
    })
  }

  function makeFrame(refKey, key) {
    const f = /** @type {HTMLIFrameElement} */ (el("iframe", "page-frame"))
    f.src = srcFor(refKey)
    f.style.width = width === "mobile" ? "414px" : "100%"
    attachTiming(f, key)
    return f
  }

  function renderSide() {
    const grid = el("div", "page-sbs")
    for (const ref of [beforeRef, afterRef]) {
      const col = el("div", "page-col")
      col.appendChild(el("div", "page-col-label", ref.label))
      col.appendChild(makeFrame(ref.key, ref === beforeRef ? "before" : "after"))
      grid.appendChild(col)
    }
    area.appendChild(grid)
  }

  function renderFade() {
    const stack = el("div", "page-stack")
    if (width === "mobile") stack.style.width = "414px"
    const beforeF = makeFrame(beforeRef.key, "before")
    const afterWrap = el("div", "page-over")
    const afterF = makeFrame(afterRef.key, "after")
    afterWrap.appendChild(afterF)
    stack.appendChild(beforeF)
    stack.appendChild(afterWrap)
    stack.appendChild(el("span", "img-tag before", beforeRef.label))
    stack.appendChild(el("span", "img-tag after", afterRef.label))
    area.appendChild(stack)
    const slider = /** @type {HTMLInputElement} */ (el("input", "fade-slider"))
    slider.type = "range"
    slider.min = "0"
    slider.max = "100"
    slider.value = "100"
    slider.addEventListener("input", () => { afterWrap.style.opacity = String(Number(slider.value) / 100) })
    area.appendChild(slider)
    area.appendChild(el("p", "fx-hint", "Drag the slider to fade the After page over the Before — handy for spotting that a “looks-identical” perf change really is identical."))
  }

  function render() {
    sideBtn.classList.toggle("on", layout === "side")
    fadeBtn.classList.toggle("on", layout === "fade")
    deskBtn.classList.toggle("on", width === "desktop")
    mobBtn.classList.toggle("on", width === "mobile")
    timings.before = null
    timings.after = null
    drawTiming()
    area.textContent = ""
    area.className = "page-area layout-" + layout + " width-" + width
    if (layout === "side") renderSide()
    else renderFade()
  }

  sideBtn.addEventListener("click", () => { layout = "side"; render() })
  fadeBtn.addEventListener("click", () => { layout = "fade"; render() })
  deskBtn.addEventListener("click", () => { width = "desktop"; render() })
  mobBtn.addEventListener("click", () => { width = "mobile"; render() })
  openBoth.addEventListener("click", () => {
    window.open(srcFor(beforeRef.key), "_blank", "noopener")
    window.open(srcFor(afterRef.key), "_blank", "noopener")
  })
  render()
}

// ---------------------------------------------------------------------------
// admin-table A/B preview (fetch-stubbed harness iframes)
// ---------------------------------------------------------------------------

/** @param {any} entry @param {HTMLElement} host */
function renderTablePreview(entry, host) {
  // One column per version: either an explicit N-version list (compare them all)
  // or the before/after pair.
  const versions = entry.preview.versions || [entry.refs.before, entry.refs.after]
  const viewports = entry.preview.viewports || ["mobile", "desktop"]
  let width = viewports[0]

  const section = el("div", "section section-wide")
  const controls = el("div", "fx-controls")
  const widthToggle = el("div", "toggle")
  const mobBtn = el("button", null, "Mobile")
  mobBtn.type = "button"
  const deskBtn = el("button", null, "Desktop")
  deskBtn.type = "button"
  widthToggle.appendChild(mobBtn)
  widthToggle.appendChild(deskBtn)
  controls.appendChild(widthToggle)
  section.appendChild(controls)

  const hint = el("p", "fx-hint", "")
  section.appendChild(hint)
  const area = el("div", "table-area")
  section.appendChild(area)
  host.appendChild(section)

  function tableUrl(refKey) {
    return "/pages/demo/table-host.html?build=" + manifest.buildId + "&ref=" + refKey
  }

  function render() {
    mobBtn.classList.toggle("on", width === "mobile")
    deskBtn.classList.toggle("on", width === "desktop")
    hint.textContent =
      width === "mobile"
        ? "Mobile width — click a row to expand its details. The chevron / expand-collapse is a mobile-only feature."
        : "Desktop width — full columns shown; the expand/collapse + chevron are hidden by design above 768px."
    area.textContent = ""
    const grid = el("div", "table-sbs")
    for (const ref of versions) {
      const col = el("div", "table-col")
      col.appendChild(el("div", "page-col-label", ref.label))
      const f = /** @type {HTMLIFrameElement} */ (el("iframe", "table-frame"))
      f.src = tableUrl(ref.key)
      f.style.width = width === "mobile" ? "414px" : "100%"
      col.appendChild(f)
      grid.appendChild(col)
    }
    area.appendChild(grid)
  }

  mobBtn.addEventListener("click", () => { width = "mobile"; render() })
  deskBtn.addEventListener("click", () => { width = "desktop"; render() })
  render()
}

// ---------------------------------------------------------------------------
// impact (perf metrics) tab
// ---------------------------------------------------------------------------

/** @param {any} v @param {boolean} [bytes] */
function fmtMetric(v, bytes) {
  if (typeof v === "string") return v
  if (typeof v !== "number") return "—"
  return bytes ? kib(v) : String(v)
}

/** @param {any} r */
function metricDelta(r) {
  if (typeof r.before !== "number" || typeof r.after !== "number") return el("td", "num", "")
  const diff = r.after - r.before
  if (diff === 0) return el("td", "num", "—")
  const better = r.betterIsLower ? diff < 0 : false
  const txt = (r.bytes ? kib(Math.abs(diff)) : String(Math.abs(diff))) + (diff < 0 ? " ↓" : " ↑")
  return el("td", "num " + (better ? "savings" : ""), txt)
}

/** @param {any} entry @param {HTMLElement} host */
function renderImpact(entry, host) {
  const m = entry.metrics
  const section = el("div", "section")
  section.appendChild(el("p", "section-title", "Measurable impact"))
  const tbl = el("table", "data-table")
  const head = el("tr")
  for (const h of ["Metric", "Before", "After", "Δ"]) head.appendChild(el("th", null, h))
  tbl.appendChild(head)
  for (const r of m.rows) {
    const tr = el("tr")
    tr.appendChild(el("td", null, r.label))
    tr.appendChild(el("td", "num", fmtMetric(r.before, r.bytes)))
    tr.appendChild(el("td", "num", fmtMetric(r.after, r.bytes)))
    tr.appendChild(metricDelta(r))
    tbl.appendChild(tr)
  }
  section.appendChild(tbl)
  if (m.note) section.appendChild(el("p", "impact-note", m.note))
  host.appendChild(section)
  if (entry.fonts) appendFontSection(entry, host)
}

/** @param {HTMLElement} stage @param {any} effect @param {string} side */
async function startPreview(stage, effect, side) {
  stopPreview()
  // Fresh backdrop so per-run effect classes (name shimmer, text glow) reset.
  stage.textContent = ""
  const backdrop = el("div", "fx-backdrop")
  backdrop.appendChild(el("h2", "couple-names", "Jesse & Jordana"))
  const content = el("div", "content-section")
  content.appendChild(el("p", null, "Together with our families, we invite you to celebrate our wedding."))
  const sched = el("div", "schedule-item")
  sched.appendChild(el("span", "schedule-details", "Saturday · 4:00 PM · Reception to follow"))
  content.appendChild(sched)
  backdrop.appendChild(content)
  stage.appendChild(backdrop)

  ensureStyle("fx-tokens", manifest.snapBase + "/" + side + "/public/styles/tokens.css")
  ensureStyle("fx-effects", manifest.snapBase + "/" + side + "/public/styles/effects.css")

  const token = {}
  const state = { instance: null, observer: null, stage, token, backdrop }
  preview = state

  // Adopt body-appended effect layers into the (transformed) stage so they're
  // clipped to the pane instead of covering the dashboard.
  const observer = new MutationObserver((mutations) => {
    if (preview !== state) return
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.parentNode === document.body) {
          stage.appendChild(node)
        }
      }
    }
  })
  observer.observe(document.body, { childList: true })
  state.observer = observer

  try {
    const dir = manifest.snapBase + "/" + side + "/public/effects/"
    const mod = await import(dir + effect.file)
    const cfgMod = await import(dir + "config.js")
    if (preview !== state) return // navigated away while importing
    const create = mod[effect.create]
    const cfg = (cfgMod.getDefaultConfig && cfgMod.getDefaultConfig(effect.id)) || {}
    const instance = create(cfg)
    instance.start()
    state.instance = instance
  } catch (err) {
    const msg = el("p", "loading", "Could not run this effect: " + (err instanceof Error ? err.message : String(err)))
    stage.appendChild(msg)
  }
}

function stopPreview() {
  if (!preview) return
  const p = preview
  preview = null
  if (p.observer) p.observer.disconnect()
  if (p.instance && typeof p.instance.stop === "function") {
    try {
      p.instance.stop()
    } catch {}
  }
  // Remove anything the effect left in the stage, keeping the backdrop.
  if (p.stage) {
    for (const child of Array.from(p.stage.children)) {
      if (child !== p.backdrop) child.remove()
    }
  }
}

/** Create or update a <link rel=stylesheet> with a stable id. @param {string} id @param {string} href */
function ensureStyle(id, href) {
  let link = document.getElementById(id)
  if (!link) {
    link = el("link")
    link.id = id
    link.rel = "stylesheet"
    document.head.appendChild(link)
  }
  if (link.getAttribute("href") !== href) link.setAttribute("href", href)
}

// ---------------------------------------------------------------------------
// image slider widget
// ---------------------------------------------------------------------------

/** @param {any} entry @param {HTMLElement} host */
function renderImageSlider(entry, host) {
  const section = el("div", "section")
  section.appendChild(el("p", "section-title", "Quality comparison — drag the handle"))

  const picker = el("div", "img-picker")
  section.appendChild(picker)

  const compare = el("div", "img-compare")
  section.appendChild(compare)

  const sizeWrap = el("div", "section")
  section.appendChild(sizeWrap)

  let selected = entry.images[0]

  function draw() {
    compare.textContent = ""
    const v = "?v=" + manifest.buildId
    const beforeImg = el("img")
    beforeImg.src = selected.before + v
    beforeImg.alt = "before"
    const afterWrap = el("div", "img-after-wrap")
    const afterImg = el("img")
    afterImg.src = selected.after + v
    afterImg.alt = "after"
    afterWrap.appendChild(afterImg)
    compare.appendChild(beforeImg)
    compare.appendChild(afterWrap)
    compare.appendChild(el("span", "img-tag before", "BEFORE (original)"))
    compare.appendChild(el("span", "img-tag after", "AFTER (WebP)"))
    const handle = el("div", "img-handle")
    compare.appendChild(handle)

    function setPos(px) {
      const w = compare.clientWidth
      const x = Math.max(0, Math.min(w, px))
      compare.style.setProperty("--compare-w", w + "px")
      afterWrap.style.width = x + "px"
      afterImg.style.width = w + "px"
      handle.style.left = x + "px"
    }
    function fromEvent(ev) {
      const rect = compare.getBoundingClientRect()
      setPos(ev.clientX - rect.left)
    }
    let dragging = false
    compare.addEventListener("pointerdown", (ev) => {
      dragging = true
      fromEvent(ev)
      compare.setPointerCapture(ev.pointerId)
    })
    compare.addEventListener("pointermove", (ev) => {
      if (dragging) fromEvent(ev)
    })
    compare.addEventListener("pointerup", () => {
      dragging = false
    })
    // initial position once the before image has laid out
    beforeImg.addEventListener("load", () => setPos(compare.clientWidth / 2))
    setPos(compare.clientWidth / 2)

    // size table for this image
    sizeWrap.textContent = ""
    sizeWrap.appendChild(el("p", "section-title", "Bytes saved"))
    const tbl = el("table", "data-table")
    const thead = el("tr")
    for (const h of ["Image", "Before", "After", "Saved"]) thead.appendChild(el("th", null, h))
    tbl.appendChild(thead)
    const row = el("tr")
    row.appendChild(el("td", null, selected.label))
    row.appendChild(el("td", "num", kib(selected.beforeBytes)))
    row.appendChild(el("td", "num", kib(selected.afterBytes)))
    const saved = selected.beforeBytes - selected.afterBytes
    const pct = selected.beforeBytes ? Math.round((saved / selected.beforeBytes) * 100) : 0
    const savedTd = el("td", "num savings", kib(saved) + " (" + pct + "%)")
    row.appendChild(savedTd)
    tbl.appendChild(row)
    sizeWrap.appendChild(tbl)
  }

  for (const img of entry.images) {
    const b = el("button", "btn")
    b.type = "button"
    b.textContent = img.label
    b.addEventListener("click", () => {
      selected = img
      draw()
    })
    picker.appendChild(b)
  }

  host.appendChild(section)
  draw()

  if (entry.variants) appendVariantSection(entry, host)
}

/** @param {any} entry @param {HTMLElement} host */
function appendVariantSection(entry, host) {
  const section = el("div", "section")
  section.appendChild(el("p", "section-title", "Responsive WebP variants generated"))
  const tbl = el("table", "data-table")
  const head = el("tr")
  for (const h of ["Source", "Variant", "Size"]) head.appendChild(el("th", null, h))
  tbl.appendChild(head)
  for (const [label, files] of Object.entries(entry.variants)) {
    let first = true
    for (const f of files) {
      const tr = el("tr")
      tr.appendChild(el("td", null, first ? label : ""))
      tr.appendChild(el("td", null, f.name))
      tr.appendChild(el("td", "num", kib(f.bytes)))
      tbl.appendChild(tr)
      first = false
    }
  }
  section.appendChild(tbl)
  host.appendChild(section)
}

// ---------------------------------------------------------------------------
// diff / summary widget
// ---------------------------------------------------------------------------

/** @param {any} entry @param {HTMLElement} host */
function renderDiffWidget(entry, host) {
  appendDiffSection(entry, host, entry.demoType === "summary" ? "Files changed in this commit" : "Diff")
}

/** @param {any} entry @param {HTMLElement} host @param {string} title */
function appendDiffSection(entry, host, title) {
  const section = el("div", "section")
  section.appendChild(el("p", "section-title", title))
  if (entry.diffFiles && entry.diffFiles.length) {
    section.appendChild(el("div", "diff-files", entry.diffFiles.join("   ")))
  }
  section.appendChild(buildDiff(entry.diff || "(no diff captured)"))
  host.appendChild(section)
}

/** @param {string} text */
function buildDiff(text) {
  const box = el("div", "diff")
  const lines = text.split("\n")
  for (const raw of lines) {
    const line = raw
    const span = el("span", "ln")
    if (line.indexOf("diff --git") === 0) span.classList.add("d-file")
    else if (line.indexOf("--- ") === 0 || line.indexOf("+++ ") === 0 || line.indexOf("index ") === 0 || line.indexOf("new file") === 0 || line.indexOf("deleted file") === 0 || line.indexOf("similarity ") === 0 || line.indexOf("rename ") === 0) span.classList.add("d-meta")
    else if (line.indexOf("@@") === 0) span.classList.add("d-hunk")
    else if (line.charAt(0) === "+") span.classList.add("d-add")
    else if (line.charAt(0) === "-") span.classList.add("d-del")
    span.textContent = line.length ? line : " "
    box.appendChild(span)
  }
  return box
}

/** @param {any} entry @param {HTMLElement} host */
function appendFontSection(entry, host) {
  const section = el("div", "section")
  section.appendChild(el("p", "section-title", "Self-hosted fonts now shipping from /fonts"))
  const tbl = el("table", "data-table")
  const head = el("tr")
  for (const h of ["File", "Size"]) head.appendChild(el("th", null, h))
  tbl.appendChild(head)
  let total = 0
  for (const f of entry.fonts) {
    total += f.bytes
    const tr = el("tr")
    tr.appendChild(el("td", null, f.name))
    tr.appendChild(el("td", "num", kib(f.bytes)))
    tbl.appendChild(tr)
  }
  const tr = el("tr")
  tr.appendChild(el("td", null, "Total (replaces render-blocking Google Fonts)"))
  tr.appendChild(el("td", "num savings", kib(total)))
  tbl.appendChild(tr)
  section.appendChild(tbl)
  host.appendChild(section)
}

// ---------------------------------------------------------------------------
// markdown widget
// ---------------------------------------------------------------------------

/** @param {any} entry @param {HTMLElement} host */
function renderMarkdownWidget(entry, host) {
  const section = el("div", "section")
  section.appendChild(el("p", "section-title", "Document (agent-authored — read skeptically)"))

  const tabs = el("div", "md-tabs")
  const body = el("div", "md")
  body.appendChild(el("p", "loading", "Loading…"))

  async function show(doc) {
    for (const b of tabs.querySelectorAll("button")) b.classList.toggle("on", b.dataset.path === doc.path)
    body.textContent = ""
    body.appendChild(el("p", "loading", "Loading…"))
    try {
      const res = await fetch(doc.path + "?v=" + manifest.buildId, { cache: "no-store" })
      const text = await res.text()
      body.textContent = ""
      renderMarkdown(text, body)
    } catch (err) {
      body.textContent = "Could not load: " + (err instanceof Error ? err.message : String(err))
    }
  }

  for (const doc of entry.docs) {
    const b = el("button", "btn")
    b.type = "button"
    b.dataset.path = doc.path
    b.textContent = doc.label
    b.addEventListener("click", () => show(doc))
    tabs.appendChild(b)
  }
  section.appendChild(tabs)
  section.appendChild(body)
  host.appendChild(section)
  if (entry.docs.length) show(entry.docs[0])
}

/** Minimal, no-regex Markdown → DOM. @param {string} md @param {HTMLElement} container */
function renderMarkdown(md, container) {
  const lines = md.split("\n")
  let i = 0
  let list = null
  while (i < lines.length) {
    const line = lines[i]
    if (line.indexOf("```") === 0) {
      list = null
      const code = []
      i++
      while (i < lines.length && lines[i].indexOf("```") !== 0) {
        code.push(lines[i])
        i++
      }
      i++
      const pre = el("pre")
      pre.appendChild(el("code", null, code.join("\n")))
      container.appendChild(pre)
      continue
    }
    if (line.trim() === "") {
      list = null
      i++
      continue
    }
    if (line.charAt(0) === "#") {
      list = null
      let level = 0
      while (line.charAt(level) === "#") level++
      const h = el("h" + Math.min(level, 3))
      parseInline(line.slice(level).trim(), h)
      container.appendChild(h)
      i++
      continue
    }
    const trimmed = line.trimStart()
    if (trimmed.indexOf("- ") === 0 || trimmed.indexOf("* ") === 0) {
      if (!list || list.tagName !== "UL") {
        list = el("ul")
        container.appendChild(list)
      }
      const li = el("li")
      parseInline(trimmed.slice(2), li)
      list.appendChild(li)
      i++
      continue
    }
    const dot = trimmed.indexOf(". ")
    if (dot > 0 && isAllDigits(trimmed.slice(0, dot))) {
      if (!list || list.tagName !== "OL") {
        list = el("ol")
        container.appendChild(list)
      }
      const li = el("li")
      parseInline(trimmed.slice(dot + 2), li)
      list.appendChild(li)
      i++
      continue
    }
    list = null
    const p = el("p")
    parseInline(line, p)
    container.appendChild(p)
    i++
  }
}

/** @param {string} text @param {HTMLElement} parent */
function parseInline(text, parent) {
  let i = 0
  let buf = ""
  function flush() {
    if (buf) {
      parent.appendChild(document.createTextNode(buf))
      buf = ""
    }
  }
  while (i < text.length) {
    const ch = text.charAt(i)
    if (ch === "`") {
      const end = text.indexOf("`", i + 1)
      if (end !== -1) {
        flush()
        parent.appendChild(el("code", null, text.slice(i + 1, end)))
        i = end + 1
        continue
      }
    }
    if (ch === "*" && text.charAt(i + 1) === "*") {
      const end = text.indexOf("**", i + 2)
      if (end !== -1) {
        flush()
        parent.appendChild(el("strong", null, text.slice(i + 2, end)))
        i = end + 2
        continue
      }
    }
    if (ch === "[") {
      const close = text.indexOf("]", i + 1)
      if (close !== -1 && text.charAt(close + 1) === "(") {
        const paren = text.indexOf(")", close + 2)
        if (paren !== -1) {
          flush()
          const a = el("a", null, text.slice(i + 1, close))
          a.href = text.slice(close + 2, paren)
          a.target = "_blank"
          a.rel = "noopener"
          parent.appendChild(a)
          i = paren + 1
          continue
        }
      }
    }
    buf += ch
    i++
  }
  flush()
}

// ---------------------------------------------------------------------------
// note widget
// ---------------------------------------------------------------------------

/** @param {any} entry @param {HTMLElement} host */
function renderNoteWidget(entry, host) {
  const section = el("div", "section")
  const card = el("div", "note-card")
  card.appendChild(document.createTextNode(entry.summary))
  section.appendChild(card)
  host.appendChild(section)
}

// ---------------------------------------------------------------------------
// decision tracking
// ---------------------------------------------------------------------------

const VERDICTS = [
  { v: "keep", label: "✓ Keep it" },
  { v: "maybe", label: "Maybe / later" },
  { v: "drop", label: "✗ Drop it" },
  { v: "", label: "Clear" },
]

/** @param {any} entry */
function renderDecision(entry) {
  const cur = decisions[entry.id] || { verdict: "", note: "" }
  const box = el("div", "decision")

  box.appendChild(el("p", "decision-q", "Your call — should the cleaned-up portfolio repo include this change?"))

  const row = el("div", "decision-row")
  const verdict = el("div", "verdict")
  for (const opt of VERDICTS) {
    const b = el("button", null, opt.label)
    b.type = "button"
    b.dataset.v = opt.v
    if (opt.v && opt.v === cur.verdict) b.classList.add("on")
    b.addEventListener("click", () => {
      setDecision(entry.id, { verdict: opt.v })
      for (const sib of verdict.querySelectorAll("button")) {
        sib.classList.toggle("on", !!opt.v && sib.dataset.v === opt.v)
      }
      reflectOutcome(box, opt.v)
      flashSaved(saved)
    })
    verdict.appendChild(b)
  }
  row.appendChild(verdict)
  const saved = el("span", "decision-saved", cur.verdict || cur.note ? "saved" : "")
  row.appendChild(saved)
  box.appendChild(row)

  // Concrete result of each choice, for THIS change. Removes any ambiguity
  // about what "keep" / "drop" actually does (e.g. for deletions).
  const outcomes = el("div", "outcomes")
  const keepRow = el("div", "outcome o-keep")
  keepRow.dataset.outcome = "keep"
  keepRow.appendChild(el("span", "o-mark", "Keep"))
  keepRow.appendChild(el("span", "o-text", entry.keepResult))
  const dropRow = el("div", "outcome o-drop")
  dropRow.dataset.outcome = "drop"
  dropRow.appendChild(el("span", "o-mark", "Drop"))
  dropRow.appendChild(el("span", "o-text", entry.dropResult))
  outcomes.appendChild(keepRow)
  outcomes.appendChild(dropRow)
  box.appendChild(outcomes)
  reflectOutcome(box, cur.verdict || "")

  const note = el("textarea", "decision-note")
  note.placeholder = "Notes / reasoning — saved automatically and exported with your verdict."
  note.value = cur.note || ""
  let t = null
  note.addEventListener("input", () => {
    if (t) clearTimeout(t)
    t = setTimeout(() => {
      setDecision(entry.id, { note: note.value })
      flashSaved(saved)
    }, 350)
  })
  box.appendChild(note)

  box.appendChild(
    el("p", "decision-hint", "Saved in your browser only — nothing is sent anywhere. Use Export / Copy in the sidebar for a JSON decision sheet."),
  )
  return box
}

/** Highlight the outcome row matching the chosen verdict. @param {HTMLElement} box @param {string} v */
function reflectOutcome(box, v) {
  for (const row of box.querySelectorAll(".outcome")) {
    row.classList.toggle("chosen", row.dataset.outcome === v)
    row.classList.toggle("dimmed", (v === "keep" || v === "drop") && row.dataset.outcome !== v)
  }
}

/** @param {HTMLElement} savedEl */
function flashSaved(savedEl) {
  savedEl.textContent = "saved ✓"
}

/** @param {string} id */
function updateNavMark(id) {
  const mark = navEl.querySelector('[data-mark="' + id + '"]')
  if (!mark) return
  const v = (decisions[id] && decisions[id].verdict) || ""
  mark.className = "nav-mark" + (v ? " v-" + v : "")
}

function refreshAllNavMarks() {
  for (const entry of manifest.entries) updateNavMark(entry.id)
}

function updateProgress() {
  let decided = 0
  for (const entry of manifest.entries) {
    if (decisions[entry.id] && decisions[entry.id].verdict) decided++
  }
  const total = manifest.entries.length
  const bar = document.getElementById("progress-bar")
  const text = document.getElementById("progress-text")
  if (bar) bar.style.width = Math.round((decided / total) * 100) + "%"
  if (text) text.textContent = decided + " / " + total + " decided"
}

function setupReviewControls() {
  refreshAllNavMarks()
  const exportBtn = document.getElementById("export-btn")
  const copyBtn = document.getElementById("copy-btn")
  const importBtn = document.getElementById("import-btn")
  const importFile = document.getElementById("import-file")
  if (exportBtn) exportBtn.addEventListener("click", exportJson)
  if (copyBtn) copyBtn.addEventListener("click", copyJson)
  if (importBtn && importFile) {
    importBtn.addEventListener("click", () => importFile.click())
    importFile.addEventListener("change", () => {
      if (importFile.files && importFile.files[0]) importJson(importFile.files[0])
      importFile.value = ""
    })
  }
}

function buildExport() {
  let decided = 0
  const items = manifest.entries.map((e) => {
    const d = decisions[e.id] || {}
    if (d.verdict) decided++
    const verdict = d.verdict || "undecided"
    let action = "Undecided — no action chosen yet"
    if (verdict === "keep") action = e.keepResult
    else if (verdict === "drop") action = e.dropResult
    else if (verdict === "maybe") action = "Revisit later before deciding"
    return {
      id: e.id,
      title: e.title,
      category: e.category,
      changeKind: e.changeKind,
      origin: e.origin,
      commit: e.commit || null,
      myRecommendation: e.recommendation,
      verdict,
      action,
      keepResult: e.keepResult,
      dropResult: e.dropResult,
      note: d.note || "",
      updatedAt: d.updatedAt || null,
    }
  })
  return {
    exportedAt: new Date().toISOString(),
    buildId: manifest.buildId,
    total: manifest.entries.length,
    decided,
    items,
  }
}

function exportJson() {
  const json = JSON.stringify(buildExport(), null, 2)
  const blob = new Blob([json], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = el("a")
  a.href = url
  a.download = "change-review-decisions.json"
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  flashMsg("Exported change-review-decisions.json")
}

async function copyJson() {
  const json = JSON.stringify(buildExport(), null, 2)
  try {
    await navigator.clipboard.writeText(json)
    flashMsg("Copied JSON to clipboard")
  } catch {
    flashMsg("Clipboard blocked — use Export instead")
  }
}

/** @param {File} file */
function importJson(file) {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result))
      const items = Array.isArray(data) ? data : data.items || []
      let n = 0
      for (const it of items) {
        if (!it || !it.id) continue
        const verdict = it.verdict === "undecided" ? "" : it.verdict || ""
        const note = it.note || ""
        if (!verdict && !note) continue
        decisions[it.id] = {
          verdict,
          note,
          updatedAt: it.updatedAt || new Date().toISOString(),
        }
        n++
      }
      persistDecisions()
      refreshAllNavMarks()
      updateProgress()
      const active = navEl.querySelector(".nav-item.active")
      if (active) selectEntry(active.dataset.id)
      flashMsg("Imported " + n + " decision" + (n === 1 ? "" : "s"))
    } catch {
      flashMsg("Could not read that file — expected exported JSON")
    }
  }
  reader.readAsText(file)
}

let flashTimer = null
/** @param {string} msg */
function flashMsg(msg) {
  const f = document.getElementById("flash")
  if (!f) return
  f.textContent = msg
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    f.textContent = ""
  }, 3000)
}

load()
