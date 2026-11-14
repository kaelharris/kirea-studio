// Applies the stored theme before first paint (classic script, no module delay).
// The React app re-applies it from the persisted settings once they load.
(function () {
  var preference = "dark";
  var hasMirror = false;
  try {
    var stored = window.localStorage.getItem("kirea.theme");
    if (stored === "dark" || stored === "light" || stored === "system") {
      preference = stored;
      hasMirror = true;
    }
  } catch (error) {
    // Storage unavailable: keep the dark default.
  }
  var resolved = preference;
  if (preference === "system") {
    var prefersDark =
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    resolved = prefersDark ? "dark" : "light";
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-preference", preference);
  if (!hasMirror) {
    // First launch without a mirror: hold the UI until the saved theme loads.
    root.setAttribute("data-theme-pending", "");
    window.setTimeout(function () {
      root.removeAttribute("data-theme-pending");
    }, 2500);
  }
})();
