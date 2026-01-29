/** @file Theme toggle module. */
/** @import * as Types from './types.js' */

/** @type {Types.initThemeToggle} */
export function initThemeToggle() {
  updateToggleButtons()
  for (const btn of document.querySelectorAll(".theme-toggle")) {
    btn.addEventListener("click", toggleTheme)
  }
}

/** @type {Types.toggleTheme} */
export function toggleTheme() {
  const root = document.documentElement
  const current = root.getAttribute("data-theme")
  const next = current === "dark" ? "light" : "dark"

  root.setAttribute("data-theme", next)
  try {
    localStorage.setItem("theme", next)
  } catch (e) {
    console.warn("Could not persist theme preference:", e)
  }

  updateToggleButtons()
}

function updateToggleButtons() {
  const theme = document.documentElement.getAttribute("data-theme")
  const isDark = theme === "dark"
  const buttons = document.querySelectorAll(".theme-toggle")

  for (const btn of buttons) {
    btn.classList.toggle("theme-toggle-dark", isDark)
    btn.classList.toggle("theme-toggle-light", !isDark)
    btn.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode",
    )
  }

  const meta = document.querySelector("meta[name='theme-color']")
  if (meta) {
    meta.setAttribute("content", isDark ? "#1a1525" : "#eee6dc")
  }
}
