/** @file Build the before/after change-review demo.
 *
 * Generates everything the /demo dashboard needs to let us decide what to keep
 * from this repo's pile of experiments before it becomes a portfolio piece:
 *
 *   - public/_demo/before/   snapshot of the code tree at HEAD (the "before")
 *   - public/_demo/after/    snapshot of the current working tree (the "after")
 *   - public/_demo/images-before/  original (pre-optimization) image files
 *   - public/_demo/docs/     copies of the agent-authored research/notes markdown
 *   - public/pages/demo/manifest.json  the curated list of changes + diffs
 *
 * Zero dependencies, no regex (string methods only), Node 22+. Run with:
 *   npm run demo:build
 *
 * This script is read-only with respect to the experiments: it only reads HEAD
 * and the working files. It never mutates tracked source or git history.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.join(import.meta.dirname, "..")
const publicDir = path.join(repoRoot, "public")
const demoDir = path.join(publicDir, "_demo")
const dashboardDir = path.join(publicDir, "pages", "demo")

const buildId = String(Date.now())

/** Dirs needed to render a whole page faithfully (effects + their import graph
 *  + the heavy image/font assets the page references). */
const PAGE_DIRS = ["effects", "styles", "pages", "components", "images", "fonts"]
/** Dirs needed to render just an effect or the admin table — no heavy images. */
const LIGHT_DIRS = ["effects", "styles", "pages", "components", "fonts"]

/**
 * Every code snapshot the dashboard can render, keyed by a URL-safe refKey.
 * `ref` is a git ref expression resolved with `git archive`, or the sentinel
 * "WORKTREE" for the current working tree. Generalizing beyond HEAD-vs-worktree
 * is what lets committed visual changes (chevron / mobile rows / parallax glow)
 * render A/B instead of only diffing.
 *
 * @type {Record<string, { ref: string, dirs: string[], label: string }>}
 */
const SNAPSHOTS = {
  before: { ref: "HEAD", dirs: PAGE_DIRS, label: "Before · HEAD" },
  after: { ref: "WORKTREE", dirs: PAGE_DIRS, label: "After · working tree" },
  "chevron-base": { ref: "5dbb861^", dirs: LIGHT_DIRS, label: "Before · 5dbb861^" },
  chevron: { ref: "5dbb861", dirs: LIGHT_DIRS, label: "After · 5dbb861" },
  "mobiletable-base": { ref: "8d3230a^", dirs: LIGHT_DIRS, label: "Before · 8d3230a^" },
  mobiletable: { ref: "8d3230a", dirs: LIGHT_DIRS, label: "After · 8d3230a" },
  "parallax-base": { ref: "fd40877^", dirs: LIGHT_DIRS, label: "Before · fd40877^" },
  parallax: { ref: "fd40877", dirs: LIGHT_DIRS, label: "After · fd40877" },
}

/** Build the before/after ref descriptors a dashboard entry needs. @param {string} beforeKey @param {string} afterKey */
function refPair(beforeKey, afterKey) {
  return {
    before: { key: beforeKey, label: SNAPSHOTS[beforeKey].label },
    after: { key: afterKey, label: SNAPSHOTS[afterKey].label },
  }
}

const MAX_DIFF_CHARS = 60000

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

/**
 * @param {string[]} gitArgs
 * @param {boolean} [binary]
 * @returns {Buffer | string}
 */
function git(gitArgs, binary) {
  return execFileSync("git", gitArgs, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 256,
    encoding: binary ? "buffer" : "utf-8",
    // Pipe stderr (don't inherit) so caught probes like existsAtRef() stay quiet.
    stdio: ["pipe", "pipe", "pipe"],
  })
}

/** @param {string} text */
function capDiff(text) {
  if (text.length <= MAX_DIFF_CHARS) return text
  return (
    text.slice(0, MAX_DIFF_CHARS) +
    "\n\n… (diff truncated — " +
    (text.length - MAX_DIFF_CHARS) +
    " more characters; inspect the full change with git) …\n"
  )
}

/** Unified diff of working tree vs HEAD for the given paths. @param {string[]} paths */
function diffWorking(paths) {
  try {
    return capDiff(String(git(["diff", "HEAD", "--", ...paths])))
  } catch (err) {
    return "Could not produce diff: " + describeError(err)
  }
}

/** Patch a commit introduced, restricted to paths if given. @param {string} hash @param {string[]} [paths] */
function diffCommit(hash, paths) {
  const args = ["show", "--no-color", hash]
  if (paths && paths.length) args.push("--", ...paths)
  try {
    return capDiff(String(git(args)))
  } catch (err) {
    return "Could not produce diff: " + describeError(err)
  }
}

/** File-level summary of a commit (for huge commits). @param {string} hash */
function statCommit(hash) {
  try {
    return String(git(["show", "--no-color", "--stat", "--format=%H%n%an  %ad%n%n%s%n%n%b", hash]))
  } catch (err) {
    return "Could not produce summary: " + describeError(err)
  }
}

/** @param {unknown} err */
function describeError(err) {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// filesystem helpers
// ---------------------------------------------------------------------------

/** @param {string} p */
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true })
}

/** @param {string} p */
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

/** @param {string} p @returns {number} */
function sizeOf(p) {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

/** True if `relPath` is a tree/blob at the given git ref. @param {string} ref @param {string} relPath */
function existsAtRef(ref, relPath) {
  try {
    git(["cat-file", "-t", ref + ":" + relPath])
    return true
  } catch {
    return false
  }
}

/** Size of a path at HEAD, or 0 if absent. @param {string} relPath */
function sizeAtHead(relPath) {
  try {
    return Number(String(git(["cat-file", "-s", "HEAD:" + relPath])).trim())
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// snapshot generation
// ---------------------------------------------------------------------------

/** Snapshot dir is namespaced by buildId so immutable-cached module URLs (and
 *  their relative imports) are always fresh after a rebuild. */
const snapRoot = path.join(demoDir, "snap-" + buildId)

function buildSnapshots() {
  rmrf(demoDir)
  ensureDir(demoDir)
  for (const key of Object.keys(SNAPSHOTS)) {
    snapshotRef(key, SNAPSHOTS[key])
  }
}

/** Materialize one snapshot under snap-<id>/refs/<key>/public/. @param {string} key @param {{ ref: string, dirs: string[] }} spec */
function snapshotRef(key, spec) {
  const dest = path.join(snapRoot, "refs", key, "public")
  ensureDir(dest)

  if (spec.ref === "WORKTREE") {
    // Copy the working-tree dirs (incl. untracked webp/fonts), skipping the
    // demo's own output so it never snapshots itself.
    for (const d of spec.dirs) {
      const src = path.join(publicDir, d)
      if (!fs.existsSync(src)) continue
      fs.cpSync(src, path.join(dest, d), {
        recursive: true,
        filter(srcPath) {
          const rel = srcPath.split(path.sep).join("/")
          return !rel.includes("/pages/demo") && !rel.includes("/_demo")
        },
      })
    }
    return
  }

  // git ref: extract the dirs that exist at that ref via `git archive` → tar.
  // `git archive` errors if ANY pathspec is missing, so filter to the dirs
  // actually present at this ref. A dir absent at a ref (e.g. /fonts before
  // fonts were self-hosted) is simply omitted — exactly the "before" state.
  const archivePaths = spec.dirs
    .filter((d) => existsAtRef(spec.ref, "public/" + d))
    .map((d) => "public/" + d)
  if (!archivePaths.length) {
    console.warn("  ! snapshot " + key + " (" + spec.ref + "): no matching dirs")
    return
  }
  let tar
  try {
    tar = /** @type {Buffer} */ (
      git(["archive", "--format=tar", spec.ref, "--", ...archivePaths], true)
    )
  } catch (err) {
    console.warn("  ! snapshot " + key + " (" + spec.ref + "): " + describeError(err))
    return
  }
  // Strip the leading "public/" so contents land directly under dest.
  execFileSync("tar", ["-x", "--strip-components=1", "-C", dest], {
    input: tar,
    maxBuffer: 1024 * 1024 * 256,
  })
}

/** Copy pre-optimization image originals so the image slider has a "before". */
function copyImageOriginals() {
  const dest = path.join(demoDir, "images-before")
  ensureDir(dest)
  const originalsDir = path.join(publicDir, "images copy")
  // Map of demo key → original file in the backup dir.
  const originals = {
    "top-desktop.png": "top-desktop.png",
    "top-mobile.png": "top-mobile.png",
    "bottom-desktop.png": "bottom-desktop.png",
    "bottom-mobile.png": "bottom-mobile.png",
    "patrick-star.jpg": "patrick-star.jpg",
    "we-wear-pink.png": "we-wear-pink.png",
    "us.webp": "us.webp",
  }
  for (const [key, file] of Object.entries(originals)) {
    const src = path.join(originalsDir, file)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, key))
  }
}

/** Copy agent-authored notes so the markdown widget can fetch them. */
function copyDocs() {
  const dest = path.join(demoDir, "docs")
  ensureDir(dest)
  const docs = [
    "LIGHTHOUSE_CHANGES.md",
    "jsdoc-class-typing-addendum.md",
    "jsdoc-class-typing-patterns.md",
    "RECOVERY-GUIDE.md",
  ]
  for (const doc of docs) {
    const src = path.join(repoRoot, doc)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, doc))
  }
}

// ---------------------------------------------------------------------------
// image comparison data
// ---------------------------------------------------------------------------

/** @param {string} key @param {string} beforeRel @param {string} label */
function imagePair(key, beforeRel, label) {
  return {
    key,
    label,
    before: "/_demo/images-before/" + key,
    after: "/images/" + key.slice(0, key.lastIndexOf(".")) + ".webp",
    beforeBytes: sizeAtHead(beforeRel),
    afterBytes: sizeOf(path.join(publicDir, "images", key.slice(0, key.lastIndexOf(".")) + ".webp")),
  }
}

function imageComparisons() {
  return [
    imagePair("top-desktop.png", "public/images/top-desktop.png", "Hero (desktop)"),
    imagePair("top-mobile.png", "public/images/top-mobile.png", "Hero (mobile)"),
    imagePair("we-wear-pink.png", "public/images/we-wear-pink.png", "Dress code"),
    imagePair("patrick-star.jpg", "public/images/patrick-star.jpg", "Patrick"),
    imagePair("bottom-desktop.png", "public/images/bottom-desktop.png", "Footer (desktop)"),
  ]
}

/** Responsive variants now generated for each source image (filename → bytes). */
function variantTable() {
  const imagesDir = path.join(publicDir, "images")
  /** @type {Record<string, { name: string, bytes: number }[]>} */
  const groups = {}
  const prefixes = {
    "top-desktop": "Hero (desktop)",
    "top-mobile": "Hero (mobile)",
    "bottom-desktop": "Footer (desktop)",
    "bottom-mobile": "Footer (mobile)",
    "we-wear-pink": "Dress code",
    "patrick-star": "Patrick",
    "us": "Couple photo",
  }
  let files = []
  try {
    files = fs.readdirSync(imagesDir)
  } catch {
    files = []
  }
  for (const [prefix, label] of Object.entries(prefixes)) {
    const matches = files
      .filter((f) => f.endsWith(".webp") && belongsTo(f, prefix))
      .map((f) => ({ name: f, bytes: sizeOf(path.join(imagesDir, f)) }))
      .sort((a, b) => a.bytes - b.bytes)
    if (matches.length) groups[label] = matches
  }
  return groups
}

/** True if a webp filename is a variant of `prefix` (and not of a longer prefix). @param {string} file @param {string} prefix */
function belongsTo(file, prefix) {
  if (!file.startsWith(prefix)) return false
  const rest = file.slice(prefix.length)
  // rest is like ".webp" or "-768w.webp"; reject if it continues the name (e.g. top-desktop vs top-mobile already handled by startsWith)
  return rest.startsWith(".") || rest.startsWith("-")
}

// ---------------------------------------------------------------------------
// performance impact metrics (build-time byte/request math, no fabrication)
// ---------------------------------------------------------------------------

/** Working-tree size of a public/ file. @param {string} rel */
function sizePublic(rel) {
  return sizeOf(path.join(publicDir, rel))
}

/** Self-hosted fonts: render-blocking requests + origins removed. */
function fontsMetrics() {
  let total = 0
  for (const f of fontTable()) total += f.bytes
  return {
    note: "Self-hosting drops the render-blocking Google Fonts stylesheet and two third-party origins; subsetted woff2 ship from /fonts and are preloaded so text paints without a network round-trip.",
    rows: [
      { label: "Render-blocking font CSS requests", before: 1, after: 0, betterIsLower: true },
      { label: "Third-party origins (googleapis + gstatic)", before: 2, after: 0, betterIsLower: true },
      { label: "Font payload source", before: "Google CDN", after: kibStr(total) + " self-hosted" },
    ],
  }
}

/** Inline critical CSS: stylesheet round-trips removed at first paint. */
function inlineCssMetrics() {
  const inlined =
    sizePublic("styles/tokens.css") +
    sizePublic("styles/layout.css") +
    sizePublic("styles/components.css")
  return {
    note: "tokens + layout + components CSS (and the tiny theme-init script) are inlined into each HTML response with matching CSP hashes, so first paint needs no stylesheet round-trips while gzip/ETag caching is preserved in hash mode. (Serve-time transform in static.js — not visible in a page A/B, only in load behaviour.)",
    rows: [
      { label: "Render-blocking stylesheet requests", before: 3, after: 0, betterIsLower: true },
      { label: "Critical CSS inlined", before: 0, after: inlined, bytes: true },
    ],
  }
}

/** Defer effects: animation CSS/JS pushed off the LCP critical path. */
function deferEffectsMetrics() {
  const effectsDir = path.join(publicDir, "effects")
  let files = []
  try {
    files = fs.readdirSync(effectsDir)
  } catch {
    files = []
  }
  const modules = files.filter((f) => f.endsWith(".js") && f !== "config.js")
  let jsBytes = 0
  for (const f of modules) jsBytes += sizeOf(path.join(effectsDir, f))
  return {
    note: "pages/main.js dynamically imports the effect manager inside requestAnimationFrame, and effects.css loads as media=print then flips to media=all once effects start — so animation work no longer blocks LCP/TBT.",
    rows: [
      { label: "Render-blocking effect CSS", before: 1, after: 0, betterIsLower: true },
      { label: "effects.css off the critical path", before: 0, after: sizePublic("styles/effects.css"), bytes: true },
      { label: "Effect JS modules deferred (dynamic import)", before: 0, after: modules.length },
      { label: "Effect JS bytes deferred", before: 0, after: jsBytes, bytes: true },
    ],
  }
}

/** Responsive images: total hero payload before/after. */
function responsiveImagesMetrics() {
  const imgs = imageComparisons()
  let before = 0
  let after = 0
  let smallest = Infinity
  for (const im of imgs) {
    before += im.beforeBytes
    after += im.afterBytes
  }
  // Smallest mobile variant actually generated (best-case for small screens).
  for (const files of Object.values(variantTable())) {
    for (const f of files) if (f.bytes && f.bytes < smallest) smallest = f.bytes
  }
  return {
    note: "Heavy PNG/JPG heroes became responsive WebP variants (414w/768w/1440w/2400w) wired through <picture>/srcset/sizes, with width/height + fetchpriority on the LCP image to prevent layout shift.",
    rows: [
      { label: "Hero image payload (" + imgs.length + " full-size images)", before, after, bytes: true, betterIsLower: true },
      { label: "Smallest mobile WebP variant now served", before: "full-size only", after: smallest === Infinity ? 0 : smallest, bytes: true },
    ],
  }
}

/** @param {number} bytes */
function kibStr(bytes) {
  if (!bytes) return "0 B"
  if (bytes < 1024) return bytes + " B"
  return (bytes / 1024).toFixed(1) + " KiB"
}

// ---------------------------------------------------------------------------
// manifest: the curated change list
// ---------------------------------------------------------------------------

/**
 * Each entry is one decision. Recommendations come from reading the actual diff,
 * not from any agent-authored notes (those are surfaced separately, clearly
 * labeled, under the Docs category — to be read skeptically).
 */
function buildEntries() {
  /** Effect ids the inline preview can switch between. */
  const ALL_EFFECTS = [
    { id: "disco", label: "Disco ball", file: "disco-ball.js", create: "createDiscoBall" },
    { id: "cursor", label: "Cursor trail", file: "cursor-trail.js", create: "createCursorTrail" },
    { id: "shimmer", label: "Mermaid shimmer", file: "mermaid-shimmer.js", create: "createMermaidShimmer" },
    { id: "burst", label: "Sparkle burst", file: "sparkle-burst.js", create: "createSparkleBurst" },
    { id: "dividers", label: "Sparkle dividers", file: "sparkle-dividers.js", create: "createSparkleDividers" },
    { id: "namespark", label: "Name shimmer", file: "name-shimmer.js", create: "createNameShimmer" },
    { id: "textglow", label: "Text sparkle", file: "text-sparkle.js", create: "createTextSparkle" },
    { id: "parallaxsparkles", label: "Parallax sparkles", file: "parallax-sparkles.js", create: "createParallaxSparkles" },
    { id: "entrance", label: "Grand entrance", file: "grand-entrance.js", create: "createGrandEntrance" },
    { id: "spotlight", label: "Disco spotlight", file: "disco-spotlight.js", create: "createDiscoSpotlight" },
    { id: "reflections", label: "Mirror reflections", file: "mirror-reflections.js", create: "createMirrorReflections" },
  ]

  /** @type {any[]} */
  const entries = []

  // ===== UNCOMMITTED: visual effects =====
  entries.push({
    id: "effects-config-tuning",
    title: "Effect visuals: hand-tuned config values",
    category: "Visual",
    recommendation: "Keep",
    origin: "uncommitted",
    rationale:
      "config.js moved every effect off generic slider-style \"50\" placeholders onto specific, deliberate values (disco spin 4.75s, ball 88px, parallax density 17, etc.) plus new range params. The numbers read as intentional tuning and the effects look more polished. Preview each effect Before (HEAD) vs After (working tree).",
    summary:
      "Replaced placeholder slider magnitudes with calculated per-effect values and added range/threshold params across all 11 effects.",
    demoType: "effect-ab",
    refs: refPair("before", "after"),
    preview: { kind: "effect", effects: ALL_EFFECTS },
    effects: ALL_EFFECTS,
    diff: diffWorking(["public/effects/config.js"]),
    diffFiles: ["public/effects/config.js"],
  })

  entries.push({
    id: "effects-grand-entrance-waves",
    title: "Grand entrance: 345 DOM nodes → box-shadow waves",
    category: "Visual",
    recommendation: "Keep",
    origin: "uncommitted",
    rationale:
      "The opening sparkle curtain was rebuilt to render each wave as a single box-shadow element instead of ~69 nodes apiece (~345 total), and setTimeout chains became async/await with a cancellable delay. Big render-cost win for a visually equivalent entrance. Preview the 'Grand entrance' effect Before vs After.",
    summary:
      "Rewrote the grand-entrance curtain to box-shadow waves + async/await; large DOM-node reduction.",
    demoType: "effect-ab",
    refs: refPair("before", "after"),
    preview: { kind: "effect", effects: ALL_EFFECTS.filter((e) => e.id === "entrance") },
    effects: ALL_EFFECTS.filter((e) => e.id === "entrance"),
    diff: diffWorking(["public/effects/grand-entrance.js"]),
    diffFiles: ["public/effects/grand-entrance.js"],
  })

  // ===== UNCOMMITTED: effects refactor / removal =====
  entries.push({
    id: "effects-abort-refactor",
    title: "Effects: AbortController cleanup (memory-leak fix)",
    category: "Refactor",
    recommendation: "Keep",
    origin: "uncommitted",
    rationale:
      "Each effect now creates an AbortController on start() and passes its signal to every addEventListener/timer, so stop() tears everything down atomically — no orphaned listeners when effects toggle on tab visibility. Adds a cancellableDelay() helper. Solid, low-risk hygiene; not visually observable, so shown as a diff.",
    summary:
      "Replaced manual listener/timer cleanup with AbortController + cancellableDelay across the effect manager and several effects.",
    demoType: "diff",
    diff: diffWorking([
      "public/effects/main.js",
      "public/effects/cursor-trail.js",
      "public/effects/disco-spotlight.js",
      "public/effects/mirror-reflections.js",
      "public/effects/parallax-sparkles.js",
    ]),
    diffFiles: [
      "public/effects/main.js",
      "public/effects/cursor-trail.js",
      "public/effects/disco-spotlight.js",
      "public/effects/mirror-reflections.js",
      "public/effects/parallax-sparkles.js",
    ],
  })

  entries.push({
    id: "effects-caustics-delete",
    title: "Delete the underwater caustics effect",
    category: "Cleanup",
    recommendation: "Review",
    origin: "uncommitted",
    rationale:
      "caustics.js (53 lines) was removed and dropped from the effect manager. The CSS keyframes are still in effects.css. Decide whether the caustics look was wanted; if removing for good, also prune the dead .caustics-* CSS.",
    summary: "Removed public/effects/caustics.js and its manager registration.",
    demoType: "diff",
    diff: diffWorking(["public/effects/caustics.js"]),
    diffFiles: ["public/effects/caustics.js"],
  })

  // ===== UNCOMMITTED: performance / Lighthouse =====
  entries.push({
    id: "perf-self-hosted-fonts",
    title: "Self-host fonts (drop render-blocking Google Fonts)",
    category: "Perf",
    recommendation: "Keep",
    origin: "uncommitted",
    rationale:
      "tokens.css swapped the Google Fonts @import for local @font-face with unicode-range subsetting and font-display: swap; the HTML pages preload the latin subsets and the CSP no longer needs googleapis/gstatic. Removes a render-blocking third-party request. ~78 KiB of woff2 now ship from /fonts.",
    summary: "Replaced Google Fonts @import with self-hosted, subsetted woff2 + preloads.",
    demoType: "diff",
    refs: refPair("before", "after"),
    preview: { kind: "page", path: "pages/index.html", viewports: ["desktop", "mobile"] },
    metrics: fontsMetrics(),
    diff: diffWorking([
      "public/styles/tokens.css",
      "public/pages/index.html",
      "public/pages/rsvp/index.html",
      "public/pages/admin/index.html",
    ]),
    diffFiles: ["public/styles/tokens.css", "public/pages/index.html"],
    fonts: fontTable(),
  })

  entries.push({
    id: "perf-inline-critical-css",
    title: "Inline critical CSS + theme-init at serve time",
    category: "Perf",
    recommendation: "Keep",
    origin: "uncommitted",
    rationale:
      "static.js now inlines tokens/layout/components CSS and the tiny theme-init script directly into HTML responses (with matching CSP hashes), eliminating render-blocking stylesheet/script requests while keeping ETag/gzip caching in hash mode. Smart, and it preserves cacheability.",
    summary: "Server inlines critical CSS + theme-init into HTML, with CSP hashes.",
    demoType: "diff",
    metrics: inlineCssMetrics(),
    diff: diffWorking(["core/static.js"]),
    diffFiles: ["core/static.js"],
  })

  entries.push({
    id: "perf-responsive-images",
    title: "Responsive WebP images (<picture>/srcset)",
    category: "Perf",
    recommendation: "Keep",
    origin: "uncommitted",
    rationale:
      "Large PNG/JPG heroes were replaced with responsive WebP variants (414w/768w/1440w/2400w) wired through <picture>/srcset/sizes, with fetchpriority + width/height on the LCP image to prevent layout shift. Order-of-magnitude byte savings (e.g. top-desktop 438 KiB PNG → ~12–69 KiB WebP). Drag the slider to compare quality.",
    summary: "Swapped heavy PNG/JPG for responsive WebP variants with srcset/sizes and CLS-safe sizing.",
    demoType: "image-slider",
    preview: { kind: "image" },
    metrics: responsiveImagesMetrics(),
    images: imageComparisons(),
    variants: variantTable(),
    diff: diffWorking(["public/pages/index.html", "public/styles/layout.css"]),
    diffFiles: ["public/pages/index.html", "public/styles/layout.css"],
  })

  entries.push({
    id: "perf-defer-effects",
    title: "Defer effects init off the critical path",
    category: "Perf",
    recommendation: "Keep",
    origin: "uncommitted",
    rationale:
      "pages/main.js now dynamically imports the effect manager inside requestAnimationFrame (instead of a top-level static import), and effects.css loads as media=print then flips to media=all once effects start — so animations no longer block LCP/TBT. effects.css also adds contain: layout style. Low risk.",
    summary: "Effects load via dynamic import in rAF; effects.css deferred via media swap + contain.",
    demoType: "diff",
    refs: refPair("before", "after"),
    preview: { kind: "page", path: "pages/index.html", viewports: ["desktop", "mobile"] },
    metrics: deferEffectsMetrics(),
    diff: diffWorking([
      "public/pages/main.js",
      "public/pages/utils.js",
      "public/styles/effects.css",
    ]),
    diffFiles: ["public/pages/main.js", "public/pages/utils.js", "public/styles/effects.css"],
  })

  // ===== UNCOMMITTED: security / infra =====
  entries.push({
    id: "security-csp-modes",
    title: "CSP: hash mode (cacheable) vs nonce mode",
    category: "Infra/Security",
    recommendation: "Review",
    origin: "uncommitted",
    rationale:
      "static.js gained a CSP_NONCE flag: default 'hash' mode uses static sha256 CSP so HTML stays ETag/gzip-cacheable; 'nonce' mode issues a per-request nonce (disables HTML caching). Sound engineering — decide whether you want the toggle complexity for a static site or just keep hash mode.",
    summary: "Added CSP_NONCE flag selecting between cacheable hash-based and per-request nonce CSP.",
    demoType: "diff",
    diff: diffWorking(["core/static.js", "types.js", "types.d.ts"]),
    diffFiles: ["core/static.js", "types.js"],
  })

  // ===== UNCOMMITTED: admin UI =====
  entries.push({
    id: "admin-rsvp-redesign",
    title: "Admin RSVP table: expand/collapse redesign",
    category: "Visual",
    recommendation: "Review",
    origin: "uncommitted",
    rationale:
      "The admin RSVP table went through three designs: (1) the first mobile-expandable rows with a text ▼ arrow, (2) the CSS-drawn chevron, and (3) this working-tree redesign — an accessible toggle (aria-expanded / aria-hidden), a height-animated detail row, delegated click handling, and a WeakMap of per-row AbortControllers. The preview renders all three at once so you can compare the whole evolution; click a row (mobile width) to expand.",
    summary: "Rebuilt the admin RSVP row expand/collapse — compared against its two earlier designs.",
    demoType: "diff",
    refs: refPair("before", "after"),
    preview: {
      kind: "table",
      viewports: ["mobile", "desktop"],
      versions: [
        { key: "mobiletable", label: "1 · Mobile rows (text ▼)" },
        { key: "chevron", label: "2 · CSS chevron" },
        { key: "after", label: "3 · Accessible redesign" },
      ],
    },
    diff: diffWorking([
      "public/pages/admin/rsvps.js",
      "public/pages/admin/admin.css",
      "public/pages/admin/index.html",
    ]),
    diffFiles: ["public/pages/admin/rsvps.js", "public/pages/admin/admin.css"],
  })

  // ===== UNCOMMITTED: cleanup =====
  entries.push({
    id: "cleanup-cruft",
    title: "Stray test/cruft files",
    category: "Cleanup",
    recommendation: "Toss",
    origin: "uncommitted",
    rationale:
      "public/images/test.jpg (234 KiB) and the untracked 'public/images copy/' backup directory are working scratch, not part of the site. Safe to delete — though note 'images copy/' is the only place the original full-res images live, which is why this build copies the few it needs into _demo/images-before first.",
    summary: "test.jpg and the 'images copy/' backup dir are scratch; remove before publishing.",
    demoType: "note",
  })

  entries.push({
    id: "cleanup-audit-logs",
    title: "Deleted audit logs (data/audit/*.jsonl)",
    category: "Cleanup",
    recommendation: "Keep deleted",
    origin: "uncommitted",
    rationale:
      "Four JSONL audit logs (real guest LOGIN/RSVP_SUBMIT events from the live wedding) were deleted from the working tree. Keeping them deleted is correct for a public portfolio — they're runtime data containing personal info, not code.",
    summary: "Removed live audit logs with personal data; appropriate to keep out of a portfolio.",
    demoType: "note",
  })

  // ===== UNCOMMITTED: docs (agent-authored — read skeptically) =====
  entries.push({
    id: "docs-jsdoc-research",
    title: "JSDoc class-typing research notes",
    category: "Docs",
    recommendation: "Toss / archive",
    origin: "uncommitted",
    rationale:
      "Two long untracked markdown files exploring TypeScript JSDoc class-typing patterns. Agent-authored research, not applied to the code. Read skeptically; archive elsewhere if you want to keep the notes, but they don't belong in the portfolio repo.",
    summary: "Exploratory JSDoc-typing research; not wired into the codebase.",
    demoType: "markdown",
    docs: [
      { label: "jsdoc-class-typing-patterns.md", path: "/_demo/docs/jsdoc-class-typing-patterns.md" },
      { label: "jsdoc-class-typing-addendum.md", path: "/_demo/docs/jsdoc-class-typing-addendum.md" },
    ],
  })

  entries.push({
    id: "docs-agent-notes",
    title: "Agent notes: LIGHTHOUSE_CHANGES & RECOVERY-GUIDE",
    category: "Docs",
    recommendation: "Toss / archive",
    origin: "uncommitted",
    rationale:
      "Two untracked markdown files an agent wrote: a Lighthouse change log and a 'recovery guide' that labels working-tree changes as intentional vs from a 'rogue agent'. Treat as UNVERIFIED background, not ground truth — every recommendation in this dashboard is derived from the actual diffs instead. Useful context, but archive rather than ship.",
    summary: "Agent-authored change log + recovery guide. Unverified; do not treat as authoritative.",
    demoType: "markdown",
    docs: [
      { label: "LIGHTHOUSE_CHANGES.md", path: "/_demo/docs/LIGHTHOUSE_CHANGES.md" },
      { label: "RECOVERY-GUIDE.md (unverified)", path: "/_demo/docs/RECOVERY-GUIDE.md" },
    ],
  })

  // ===== COMMITTED: recent commits =====
  entries.push({
    id: "commit-chevron",
    title: "Admin: CSS-drawn chevron indicator",
    category: "Visual",
    recommendation: "Keep",
    origin: "commit",
    commit: "5dbb861",
    rationale:
      "Replaced the text ▼ expand indicator with a border-drawn CSS chevron that rotates on expand/hover with opacity transitions. Small, clean polish on the admin table.",
    summary: "Text dropdown arrow → animated CSS chevron in the admin RSVP table.",
    demoType: "diff",
    refs: refPair("chevron-base", "chevron"),
    preview: { kind: "table", viewports: ["mobile", "desktop"] },
    diff: diffCommit("5dbb861"),
    diffFiles: ["public/pages/admin/admin.css"],
  })

  entries.push({
    id: "commit-mobile-table",
    title: "Admin: mobile-expandable RSVP rows",
    category: "Visual",
    recommendation: "Keep",
    origin: "commit",
    commit: "8d3230a",
    rationale:
      "Added expandable detail rows (food / message / submitted) for the admin table on mobile, with renamed columns. This is the feature the uncommitted 'admin-rsvp-redesign' later reworks — compare the two.",
    summary: "Introduced expandable mobile detail rows in the admin RSVP table.",
    demoType: "diff",
    refs: refPair("mobiletable-base", "mobiletable"),
    preview: { kind: "table", viewports: ["mobile", "desktop"] },
    diff: diffCommit("8d3230a"),
    diffFiles: ["public/pages/admin/rsvps.js", "public/pages/admin/admin.css"],
  })

  entries.push({
    id: "commit-abortsignal-polyfill",
    title: "Fix: AbortSignal.timeout() Safari compatibility",
    category: "Infra/Security",
    recommendation: "Keep",
    origin: "commit",
    commit: "fbd4a8a",
    rationale:
      "Replaced AbortSignal.timeout() (unsupported in older Safari) with a manual AbortController + setTimeout + finally-clear pattern on the auth session-check and login fetches. Correct, defensive compatibility fix.",
    summary: "Swapped AbortSignal.timeout() for a manual controller/timeout for older Safari.",
    demoType: "diff",
    diff: diffCommit("fbd4a8a"),
  })

  entries.push({
    id: "commit-parallax-glow",
    title: "Parallax sparkles: glow refinement",
    category: "Visual",
    recommendation: "Keep",
    origin: "commit",
    commit: "fd40877",
    rationale:
      "Sparkles set a --color custom property so currentColor drives the box-shadow glow, and the glow was dialed back (8px/2px → 4px/1px) for a subtler look. Already part of 'before' for the uncommitted effect previews.",
    summary: "Tuned parallax sparkle glow to use currentColor and a softer shadow.",
    demoType: "diff",
    refs: refPair("parallax-base", "parallax"),
    preview: {
      kind: "effect",
      effects: [{ id: "parallaxsparkles", label: "Parallax sparkles", file: "parallax-sparkles.js", create: "createParallaxSparkles" }],
    },
    diff: diffCommit("fd40877"),
    diffFiles: ["public/effects/parallax-sparkles.js", "public/styles/effects.css"],
  })

  entries.push({
    id: "commit-mobile-perf-pass",
    title: "Mobile performance pass across effects",
    category: "Perf",
    recommendation: "Keep",
    origin: "commit",
    commit: "050b331",
    rationale:
      "Broad mobile optimization: skip caustics blend mode + fewer layers, event-delegated animationend listeners, CSS-driven disco tile cycling, reduced mobile particle counts, 30fps RAF throttling with translate3d. Sensible, targeted perf work.",
    summary: "Mobile-focused effect optimizations (fewer nodes, delegation, throttled RAF).",
    demoType: "diff",
    diff: diffCommit("050b331"),
  })

  entries.push({
    id: "commit-architecture-refactor",
    title: "Architecture refactor (effects move + CSS modules + tests)",
    category: "Refactor",
    recommendation: "Keep",
    origin: "commit",
    commit: "4cb77fe",
    rationale:
      "Large restructure: moved effects to public/effects/, split CSS into tokens/layout/components, removed the effect-preview UI, reorganized admin modules, and added a real unit-test suite. Professional cleanup — shown as a file-level summary because the full patch is ~136 files.",
    summary: "Repo-wide reorg: effects relocation, CSS modularization, admin renames, test suite (~136 files).",
    demoType: "summary",
    diff: statCommit("4cb77fe"),
  })

  entries.push({
    id: "commit-cicd-deploy",
    title: "CI/CD deploy workflow + deploy script",
    category: "Infra/Security",
    recommendation: "Review",
    origin: "commit",
    commit: "2273e9a",
    rationale:
      "Added a GitHub Actions deploy workflow and scripts/deploy.js, plus meta-tag tweaks. Useful to show DevOps chops in a portfolio, but check it for any environment/secret specifics before publishing.",
    summary: "GitHub Actions deploy pipeline + deploy script.",
    demoType: "diff",
    diff: diffCommit("2273e9a"),
  })

  entries.push({
    id: "commit-docker-sms",
    title: "Docker support + admin bulk-SMS feature",
    category: "Feature",
    recommendation: "Keep",
    origin: "commit",
    commit: "3ade79e",
    rationale:
      "Added Dockerfile/compose, a manual bulk-SMS admin feature (api + UI), the admin dashboard styling, and pruned ~14 unused effects. A meaty feature commit — shown as a file-level summary because the full patch is ~56 files.",
    summary: "Docker, admin bulk-SMS, dashboard styling, effect pruning (~56 files).",
    demoType: "summary",
    diff: statCommit("3ade79e"),
  })

  return entries
}

/**
 * Normalize every entry so the dashboard can state, unambiguously, what each
 * choice DOES. Aligns the recommendation vocabulary with the user's verdicts
 * (Keep / Maybe / Drop) and attaches concrete keep/drop outcome sentences.
 */
function finalizeEntries(entries) {
  // What kind of change this is — determines the default outcome wording.
  /** @type {Record<string, string>} */
  const CHANGE_KIND = {
    "effects-caustics-delete": "delete",
    "cleanup-audit-logs": "delete",
    "cleanup-cruft": "add",
    "docs-jsdoc-research": "add",
    "docs-agent-notes": "add",
  }
  // Map my advice onto the same words the user picks from.
  /** @type {Record<string, string>} */
  const REC_MAP = {
    Keep: "Keep",
    Review: "Maybe",
    Toss: "Drop",
    "Toss / archive": "Drop",
    "Keep deleted": "Keep",
  }
  // Per-change outcome wording where the generic text isn't specific enough.
  /** @type {Record<string, { keep: string, drop: string }>} */
  const RESULTS = {
    "effects-caustics-delete": {
      keep: "Leave caustics.js deleted — the effect stays gone.",
      drop: "Restore caustics.js and put the caustics effect back.",
    },
    "cleanup-audit-logs": {
      keep: "Leave the audit logs deleted (kept out of the repo).",
      drop: "Restore the deleted audit-log files.",
    },
    "cleanup-cruft": {
      keep: "Leave test.jpg and the “images copy/” backup in the repo.",
      drop: "Delete the scratch files (test.jpg and “images copy/”).",
    },
    "docs-jsdoc-research": {
      keep: "Keep these research .md files in the repo.",
      drop: "Delete the research .md files (or archive them elsewhere).",
    },
    "docs-agent-notes": {
      keep: "Keep these agent-note .md files in the repo.",
      drop: "Delete the agent-note .md files (or archive them elsewhere).",
    },
    "perf-responsive-images": {
      keep: "Ship the responsive WebP <picture> markup + variants; the old PNG/JPGs stay removed.",
      drop: "Revert to the original PNG/JPG heroes and the old markup.",
    },
    "effects-grand-entrance-waves": {
      keep: "Ship the box-shadow “wave” rewrite of the entrance.",
      drop: "Revert to the original per-sparkle entrance.",
    },
  }
  /** @param {string} kind */
  function defaultResults(kind) {
    if (kind === "delete") return { keep: "Leave it deleted.", drop: "Restore the deleted file(s)." }
    if (kind === "add") return { keep: "Keep the new file(s) in the repo.", drop: "Remove the new file(s)." }
    if (kind === "commit") return { keep: "Keep this commit in the history.", drop: "Revert this commit." }
    return {
      keep: "Apply this change — keep the working-tree version.",
      drop: "Discard this change — revert to the committed (HEAD) version.",
    }
  }
  for (const e of entries) {
    e.changeKind = CHANGE_KIND[e.id] || (e.origin === "commit" ? "commit" : "modify")
    e.recommendation = REC_MAP[e.recommendation] || e.recommendation
    const def = defaultResults(e.changeKind)
    const custom = RESULTS[e.id] || {}
    e.keepResult = custom.keep || def.keep
    e.dropResult = custom.drop || def.drop
  }
  return entries
}

/** Font files now shipped from /fonts (filename → bytes). */
function fontTable() {
  const fontsDir = path.join(publicDir, "fonts")
  let files = []
  try {
    files = fs.readdirSync(fontsDir)
  } catch {
    files = []
  }
  return files
    .filter((f) => f.endsWith(".woff2"))
    .map((f) => ({ name: f, bytes: sizeOf(path.join(fontsDir, f)) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log("Building change-review demo…")
  buildSnapshots()
  console.log("  ✓ before/after code snapshots")
  copyImageOriginals()
  console.log("  ✓ image originals")
  copyDocs()
  console.log("  ✓ docs")

  const entries = finalizeEntries(buildEntries())

  /** @type {Record<string, string>} */
  const categoryOrder = {
    Visual: "Visual & interactive",
    Perf: "Performance",
    Refactor: "Refactoring",
    Feature: "Features",
    "Infra/Security": "Infrastructure & security",
    Cleanup: "Cleanup",
    Docs: "Docs & notes",
  }

  const manifest = {
    buildId,
    // Static base for direct module/CSS imports of a snapshot (effect previews).
    snapBase: "/_demo/snap-" + buildId + "/refs",
    // Demo-server mount that rewrites absolute asset paths (full-page/table A/B).
    snapMount: "/snap/" + buildId,
    snapshots: SNAPSHOTS,
    generatedAtIso: new Date(buildId * 1).toISOString(),
    categoryOrder: Object.keys(categoryOrder),
    categoryLabels: categoryOrder,
    counts: summarize(entries),
    entries,
  }

  ensureDir(dashboardDir)
  fs.writeFileSync(
    path.join(dashboardDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  )
  console.log("  ✓ manifest.json (" + entries.length + " changes)")
  console.log("Done. Run `npm run demo` (or `node scripts/demo-server.js`) and open http://localhost:5050")
}

/** @param {any[]} entries */
function summarize(entries) {
  /** @type {Record<string, number>} */
  const byRec = {}
  for (const e of entries) {
    byRec[e.recommendation] = (byRec[e.recommendation] || 0) + 1
  }
  return { total: entries.length, byRecommendation: byRec }
}

main()
