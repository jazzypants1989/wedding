/** @file tractor-feed sketch — the memory book as a banner + green-bar listing. */

import { loadFixture, renderBook, mountSketchBar, query } from "../shared/kit.js"
import { decorate } from "./banner-fanfold.js"

const data = await loadFixture()
document.getElementById("mb-entries")?.insertAdjacentHTML("beforeend", renderBook(data.entries, data.pinned))
const status = document.getElementById("mb-status")
if (status) status.hidden = true
document.getElementById("mb-print")?.addEventListener("click", () => window.print())

const pagesParam = query("banner")
const bannerPages = pagesParam === null ? 3 : Math.max(0, Math.min(6, Number(pagesParam) || 0))
decorate(document.documentElement, {
  couple: data.couple.display,
  date: data.couple.date,
  location: data.couple.location,
  total: data.entries.length,
  bannerPages,
})

mountSketchBar({
  name: "banner-fanfold",
  links: [
    ["guestbook", "./"],
    ["book", "./book.html"],
  ],
  params: [
    { key: "bannerPages", slot: "book", value: bannerPages, hint: { min: 0, max: 6, step: 1 }, note: "rebuilds" },
    { key: "bar", slot: "book", value: "#dcefd8", css: "--mb-bar" },
    { key: "ink", slot: "book", value: "#202128", css: "--mb-ink" },
    { key: "dot", slot: "book", value: 0.75, hint: { min: 0.5, max: 1.5, step: 0.05 }, css: "--mb-dot" },
  ],
  onParam(def, value) {
    if (def.key === "bannerPages") {
      const url = new URL(location.href)
      url.searchParams.set("banner", String(value))
      location.href = url.pathname + url.search
    }
  },
})
