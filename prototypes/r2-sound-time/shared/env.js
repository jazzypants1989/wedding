/** @file Shared sketch chrome: the light/dark toggle and the reduced-motion flag. */

/** True when the page should be still: OS setting, or `?motion=reduce` for review. */
export function stillness() {
  return document.documentElement.hasAttribute("data-still")
}

/** Wire every `[data-theme-toggle]` button to flip light/dark and remember it. */
export function wireThemeToggle() {
  for (const btn of document.querySelectorAll("[data-theme-toggle]")) {
    const sync = () => {
      const dark = document.documentElement.dataset.theme === "dark"
      btn.setAttribute("aria-pressed", String(dark))
      btn.textContent = dark ? "☾ Dark" : "☀ Light"
    }
    sync()
    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem("r2-theme", next)
      } catch {}
      sync()
      document.dispatchEvent(new CustomEvent("r2:theme"))
    })
  }
}

/** Keep `?n=` / `?theme=` / `?fx=` / `?at=` when linking between a sketch's views. */
export function carryParams() {
  const here = new URL(location.href).searchParams
  for (const a of document.querySelectorAll("a[data-carry]")) {
    const href = a.getAttribute("href") || ""
    const url = new URL(href, location.href)
    for (const k of ["n", "theme", "fx", "motion", "at"]) {
      const v = here.get(k)
      if (v !== null && !url.searchParams.has(k)) url.searchParams.set(k, v)
    }
    a.setAttribute("href", url.pathname + url.search)
  }
}
