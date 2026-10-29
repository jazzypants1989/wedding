/* Classic (non-module) script: set light/dark and the effect theme before first
   paint, like public/components/theme-init.js does on the real pages. */
;(function () {
  var params = new URL(location.href).searchParams
  var theme = params.get("theme")
  try {
    theme = theme || localStorage.getItem("r2-retro-theme")
  } catch (e) {}
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light"
  var fx = params.get("fx")
  if (fx) document.documentElement.dataset.effectTheme = fx
})()
