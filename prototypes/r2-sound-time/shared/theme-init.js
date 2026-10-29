/* Blocking, pre-paint: pick light/dark and the effect theme before first render.
   ?theme=dark|light wins, then a saved choice, then the OS preference.
   ?fx=<effect theme> sets data-effect-theme (romantic, garden, celestial, …). */
;(function () {
  var q = new URL(location.href).searchParams
  var saved = null
  try {
    saved = localStorage.getItem("r2-theme")
  } catch (e) {}
  var t =
    q.get("theme") || saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  document.documentElement.dataset.theme = t === "dark" ? "dark" : "light"
  var fx = q.get("fx")
  if (fx) document.documentElement.dataset.effectTheme = fx
  var still = q.get("motion") === "reduce" || (q.get("motion") !== "full" && matchMedia("(prefers-reduced-motion: reduce)").matches)
  if (still) document.documentElement.dataset.still = ""
})()
