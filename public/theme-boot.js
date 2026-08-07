// No-flash theme boot (PROG-150, externalized in PROG-163): applies the stored
// theme preset before first paint. Loaded as a blocking classic script in
// index.html's <head> so it runs before any paint — external rather than
// inline because an inline script needs a CSP sha256 pin that must be
// regenerated on every edit, and a stale pin silently blocks the script in
// production (exactly the PROG-163 bug; dev never sees it since vite dev
// doesn't apply public/_headers). As /theme-boot.js it's covered by
// script-src 'self' forever.
//
// Mirrors src/client/theme.ts's THEME_KEY and THEMES[].swatch.paper — it can't
// import that module (nothing is bundled yet), so keep the two in sync when a
// theme is added, removed, or recolored; theme.test.ts has a drift guard that
// parses this file and fails if they diverge. Reads localStorage only;
// everything is try/caught so a storage failure just means "porcelain this
// load", never a broken boot. main.tsx re-applies the stored theme at mount as
// a second line of defense, so even a failed boot self-corrects after hydrate.
(function () {
  try {
    var id = window.localStorage.getItem("progress:theme");
    var paper = { adobe: "#f5efe0", sanzo: "#f9f4e9", mono: "#f7f7f7" }[id];
    if (paper) {
      document.documentElement.dataset.theme = id;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", paper);
    }
  } catch (e) {
    /* default this time */
  }
})();
