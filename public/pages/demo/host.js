/** @file Fullscreen single-effect runner. Opened in a new tab from the
 *  dashboard. Reads base/ver/id/file/create from the query string, links the
 *  matching snapshot's effect CSS, then runs that one effect over a backdrop at
 *  full viewport fidelity. Zero deps, no regex, CSP-safe. */

const q = new URLSearchParams(location.search)
const base = q.get("base") || ""
const ver = q.get("ver") || "after"
const id = q.get("id") || ""
const file = q.get("file") || ""
const create = q.get("create") || ""
const label = q.get("label") || id
const verlabel = q.get("verlabel") || (ver === "before" ? "Before (HEAD)" : "After (working tree)")

const badge = document.getElementById("badge")
badge.textContent = label + " · " + verlabel

/** @param {string} href */
function addStyle(href) {
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}

addStyle(base + "/" + ver + "/public/styles/tokens.css")
addStyle(base + "/" + ver + "/public/styles/effects.css")

async function run() {
  try {
    const dir = base + "/" + ver + "/public/effects/"
    const mod = await import(dir + file)
    const cfgMod = await import(dir + "config.js")
    const cfg = (cfgMod.getDefaultConfig && cfgMod.getDefaultConfig(id)) || {}
    const instance = mod[create](cfg)
    instance.start()
  } catch (err) {
    badge.textContent =
      "Failed to run effect: " + (err instanceof Error ? err.message : String(err))
  }
}

run()
