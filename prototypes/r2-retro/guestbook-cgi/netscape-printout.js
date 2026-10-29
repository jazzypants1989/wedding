/** @file book slot: `netscape-printout` — the memory book as a 1999 homepage
 *  printed from the browser. On screen it sits in a print-preview window; on
 *  paper every page carries the header and footer Navigator printed (title,
 *  "Page 2 of 7", the URL, the date), via CSS @page margin boxes.
 *
 *  decorate(root) is the book slot's optional JS hook. It only ADDS: window
 *  chrome around the toolbar, WordArt and the counter on the cover, a webring
 *  and 88x31 badges after the count, and the @page margin text (written into a
 *  constructed stylesheet, a CSSOM write, because the strings are content).
 */

import { wordart } from "./wordart.js"
import { heart, sign, envelope } from "./sprites.js"

/** Quote a string for CSS `content:`. @param {string} s */
function cssString(s) {
  return '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ") + '"'
}

/** @param {string} label @param {string} glyph */
function fakeButton(label, glyph) {
  return `<span class="np-tool np-tool-off" aria-hidden="true"><span class="np-glyph">${glyph}</span>${label}</span>`
}

/**
 * @param {HTMLElement} root the <html> element
 * @param {{ couple: string, date: string, location: string, total: number, url?: string }} ctx
 */
export function decorate(root, ctx) {
  const doc = root.ownerDocument
  const url = ctx.url || "http://www.geocities.com/Heartland/Meadows/0426/guestbook.html"
  const title = `${ctx.couple}'s Wedding Guestbook`
  const printed = new Date(ctx.date + "T23:59:00").toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  })

  // ---- browser chrome (screen only) ----
  const toolbar = /** @type {HTMLElement} */ (doc.querySelector(".mb-toolbar"))
  const chrome = doc.createElement("div")
  chrome.className = "np-chrome"
  chrome.innerHTML = `
    <div class="np-titlebar"><span class="np-title"></span><span class="np-winbtns" aria-hidden="true"><i>_</i><i>□</i><i>×</i></span></div>
    <div class="np-menubar" aria-hidden="true"><span><u>F</u>ile</span><span><u>E</u>dit</span><span><u>V</u>iew</span><span><u>G</u>o</span><span><u>B</u>ookmarks</span><span><u>H</u>elp</span></div>`
  const titleEl = /** @type {HTMLElement} */ (chrome.querySelector(".np-title"))
  titleEl.textContent = `Print Preview - ${title} - J&J Navigator`
  toolbar.before(chrome)
  chrome.appendChild(toolbar)
  const back = toolbar.querySelector("a")
  const print = toolbar.querySelector("button")
  if (back) {
    back.className = "np-tool"
    back.innerHTML = `<span class="np-glyph" aria-hidden="true">◀</span>Back`
    back.setAttribute("aria-label", "Back to guestbook")
  }
  if (print) {
    print.className = "np-tool"
    print.innerHTML = `<span class="np-glyph" aria-hidden="true">🖶</span>Print`
    print.setAttribute("aria-label", "Print or save as PDF")
  }
  back?.insertAdjacentHTML("afterend", fakeButton("Forward", "▶") + fakeButton("Reload", "↻") + fakeButton("Home", "⌂"))
  print?.insertAdjacentHTML("beforebegin", fakeButton("Search", "⌕"))
  print?.insertAdjacentHTML("afterend", fakeButton("Stop", "⨯"))
  toolbar.insertAdjacentHTML("beforeend", `<span class="np-throbber" aria-hidden="true"><span>J♥J</span></span>`)
  const loc = doc.createElement("div")
  loc.className = "np-location"
  loc.innerHTML = `<span class="np-loc-label" aria-hidden="true">Location:</span><span class="np-loc-url"></span>`
  const locUrl = /** @type {HTMLElement} */ (loc.querySelector(".np-loc-url"))
  locUrl.textContent = url
  chrome.appendChild(loc)

  // ---- the "paper": screen-only header/footer bands that echo @page ----
  const book = /** @type {HTMLElement} */ (doc.querySelector(".mb-book"))
  const head = doc.createElement("div")
  head.className = "np-band np-band-head"
  head.setAttribute("aria-hidden", "true")
  const headTitle = doc.createElement("span")
  headTitle.textContent = title
  const headPage = doc.createElement("span")
  headPage.textContent = "Page 1"
  head.append(headTitle, headPage)
  book.prepend(head)

  // ---- cover: the top of the homepage ----
  const cover = /** @type {HTMLElement} */ (doc.querySelector(".mb-cover"))
  cover.insertAdjacentHTML("afterbegin", `<div class="np-wordart">${wordart(`${ctx.couple}'s`, "WEDDING GUESTBOOK", "np")}</div>`)
  cover.insertAdjacentHTML(
    "beforeend",
    `<hr class="cgi-rainbow">
     <div class="np-under" aria-hidden="true"><span class="cgi-sign">${sign()}</span><b>UNDER CONSTRUCTION</b> since ${ctx.date.slice(5, 7)}&middot;${ctx.date.slice(8, 10)}&middot;${ctx.date.slice(0, 4)} &mdash; a lifetime project<span class="cgi-sign">${sign()}</span></div>
     <p class="np-counter">This guestbook was signed <span class="np-odo"></span> times.</p>`,
  )
  const odo = /** @type {HTMLElement} */ (cover.querySelector(".np-odo"))
  for (const d of String(ctx.total).padStart(6, "0")) {
    const s = doc.createElement("span")
    s.className = "cgi-digit"
    s.textContent = d
    odo.appendChild(s)
  }

  // ---- after the count: webring, badges, last updated ----
  const count = doc.querySelector(".mb-count")
  count?.insertAdjacentHTML(
    "afterend",
    `<hr class="cgi-rainbow">
    <div class="np-tail">
      <p class="np-ring"><span class="np-ring-heart">${heart()}</span> a proud member of the <b>J&amp;J Wedding Webring</b> <span class="np-ring-heart">${heart()}</span><br>
        <a href="#">&lt;&lt; Prev</a> | <a href="#">Random</a> | <a href="#">Next &gt;&gt;</a></p>
      <div class="cgi-badges" aria-hidden="true">
        <span class="b88 b88-jj"><span class="b88-l">${heart()}</span><span class="b88-r">J+J<br>2026</span></span>
        <span class="b88 b88-notepad"><span class="b88-l">✎</span><span class="b88-r">made with<br>NOTEPAD</span></span>
        <span class="b88 b88-now"><span class="b88-l">☀</span><span class="b88-r">Get Married<br><b>NOW!</b></span></span>
        <span class="b88 b88-y2k"><span class="b88-l">✓</span><span class="b88-r">Y2K<br>COMPLIANT</span></span>
      </div>
      <p class="np-mail"><span class="cgi-env">${envelope()}</span> E-mail the happy couple! &middot; &copy; ${ctx.date.slice(0, 4)}</p>
    </div>`,
  )
  const foot = doc.createElement("div")
  foot.className = "np-band np-band-foot"
  foot.setAttribute("aria-hidden", "true")
  const footUrl = doc.createElement("span")
  footUrl.textContent = url
  const footDate = doc.createElement("span")
  footDate.textContent = printed
  foot.append(footUrl, footDate)
  book.appendChild(foot)

  // ---- print: Navigator's header + footer, as @page margin boxes ----
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(`@page {
    @top-left { content: ${cssString(title)}; }
    @top-right { content: "Page " counter(page) " of " counter(pages); }
    @bottom-left { content: ${cssString(url)}; }
    @bottom-right { content: ${cssString(printed)}; }
  }`)
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
}
