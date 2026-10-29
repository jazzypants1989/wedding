/** @file guestbook.cgi sketch — the memory book (book slot `netscape-printout`). */

import { loadFixture, renderBook, mountSketchBar } from "../shared/kit.js"
import { decorate } from "./netscape-printout.js"

const data = await loadFixture()
document.getElementById("mb-entries")?.insertAdjacentHTML("beforeend", renderBook(data.entries, data.pinned))
const status = document.getElementById("mb-status")
if (status) status.hidden = true
document.getElementById("mb-print")?.addEventListener("click", () => window.print())

decorate(document.documentElement, {
  couple: data.couple.display,
  date: data.couple.date,
  location: data.couple.location,
  total: data.entries.length,
})

mountSketchBar({
  name: "netscape-printout",
  links: [
    ["guestbook", "./"],
    ["book", "./book.html"],
  ],
  params: [
    { key: "desktop", slot: "book", value: "teal", hint: { options: ["teal", "theme"] } },
    { key: "printLinks", slot: "book", value: "blue", hint: { options: ["blue", "ink"] } },
    { key: "entryGap", slot: "book", value: 10, hint: { min: 4, max: 24, step: 2 }, css: "--mb-gap", unit: "pt" },
  ],
  onParam(def, value) {
    if (def.key === "desktop") document.documentElement.dataset.npDesktop = String(value)
    if (def.key === "printLinks") document.documentElement.dataset.npLinks = String(value)
  },
})
