/** @file Admin RSVP table preview harness.
 *
 * The admin page is auth-gated, so we can't iframe it directly. Instead we
 * render the REAL table for a given snapshot ref by:
 *   1. linking that ref's CSS (tokens/layout/components + admin.css),
 *   2. extracting that ref's actual #rsvps-table markup from its admin page,
 *   3. stubbing window.fetch so /api/admin/rsvps returns seed rows, and
 *   4. importing that ref's rsvps.js and calling its exported loadRsvps().
 *
 * The row markup, chevron, toggle and expand/collapse animation are therefore
 * the genuine code for that version — only the data and the surrounding shell
 * are authored here. Zero deps, no regex. */

const q = new URLSearchParams(location.search)
const build = q.get("build") || ""
const ref = q.get("ref") || ""
const snapBase = "/_demo/snap-" + build + "/refs/" + ref + "/public"

const root = /** @type {HTMLElement} */ (document.getElementById("root"))

/** @param {string} href */
function addStyle(href) {
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = href
  document.head.appendChild(link)
}

addStyle(snapBase + "/styles/tokens.css")
addStyle(snapBase + "/styles/layout.css")
addStyle(snapBase + "/styles/components.css")
addStyle(snapBase + "/pages/admin/admin.css")

/** @param {string} msg */
function showNote(msg) {
  const p = document.createElement("p")
  p.className = "demo-table-note"
  p.textContent = msg
  root.appendChild(p)
}

/** Pull this ref's real <table id="rsvps-table">…</table> out of its admin page. @param {string} html */
function extractRsvpTable(html) {
  const marker = html.indexOf('id="rsvps-table"')
  if (marker === -1) return ""
  const start = html.lastIndexOf("<table", marker)
  const close = html.indexOf("</table>", marker)
  if (start === -1 || close === -1) return ""
  return html.slice(start, close + "</table>".length)
}

async function run() {
  let tableHtml = ""
  try {
    const res = await fetch(snapBase + "/pages/admin/index.html")
    tableHtml = extractRsvpTable(await res.text())
  } catch {
    /* fall through to skeleton */
  }
  if (!tableHtml) {
    tableHtml =
      '<table id="rsvps-table"><thead><tr><th scope="col">Guest</th>' +
      '<th scope="col">Attending</th><th scope="col">Party Size</th></tr></thead>' +
      '<tbody id="rsvps-tbody"></tbody></table>'
  }

  // The shell admin.css expects (incl. #notification-banner, which admin's
  // utils.js grabs at import time). Must exist BEFORE importing rsvps.js.
  root.innerHTML =
    '<div id="notification-banner" class="alert alert-error" role="alert" hidden></div>' +
    '<div id="tab-rsvps" class="tab-content active" role="tabpanel">' +
    '<div class="card">' +
    '<div class="card-header flex-between"><h2>RSVP Responses</h2></div>' +
    '<div class="table-container">' +
    tableHtml +
    "</div></div></div>"

  // Make the real rsvps.js render our seed data instead of hitting the API.
  const { SEED_RSVPS } = await import("/pages/demo/fixtures.js")
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || ""
    if (url.includes("/api/admin/rsvps")) {
      return new Response(JSON.stringify({ rsvps: SEED_RSVPS }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }
    return realFetch(input, init)
  }

  try {
    const mod = await import(snapBase + "/pages/admin/rsvps.js")
    if (typeof mod.loadRsvps === "function") {
      await mod.loadRsvps()
    } else {
      showNote("This version's rsvps.js has no loadRsvps export — see the Code tab for the diff.")
    }
  } catch (err) {
    showNote("Could not render this table version: " + (err instanceof Error ? err.message : String(err)))
  }
}

run()
