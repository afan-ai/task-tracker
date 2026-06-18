/* Browser capability detector. PLAIN ES5 ONLY so it parses and runs in very
   old engines. No arrow functions, no let/const, no template literals, no eval,
   no new Function. If the engine lacks ES2022-era features the modern app
   relies on, reveal the pre-placed "please update your browser" banner. */
(function () {
  "use strict";

  function supportsModernEngine() {
    var arr = Array.prototype;
    var hasAt = typeof arr.at === "function";
    var hasHasOwn = typeof Object.hasOwn === "function";
    return hasAt && hasHasOwn;
  }

  function revealBanner() {
    var banner = document.getElementById("browser-update-banner");
    if (!banner) { return; }
    banner.className = banner.className.replace(/(^|\s)is-hidden(\s|$)/g, " ");
    banner.removeAttribute("hidden");
  }

  if (!supportsModernEngine()) {
    if (document.getElementById("browser-update-banner")) {
      revealBanner();
    } else if (document.addEventListener) {
      document.addEventListener("DOMContentLoaded", revealBanner, false);
    } else if (document.attachEvent) {
      document.attachEvent("onreadystatechange", function () {
        if (document.readyState === "complete") { revealBanner(); }
      });
    }
  }
})();
