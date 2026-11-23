/* ==========================================================================
   Hunt Gov Pk — App bootstrap
   Renders the shared header/footer, runs the page module registered at
   HN.pages[<body data-page>], and wires the refresh button and the first-load refresh.
   Page modules may set HN.pageRefresh() to re-render when new data arrives.
   ========================================================================== */
(function (HN) {
  "use strict";

  const ui = HN.ui;
  const live = HN.live;

  function setButton(state, text) {
    const btn = document.querySelector("[data-refresh]");
    if (!btn) return;
    btn.classList.toggle("is-busy", state === "busy");
    btn.disabled = state === "busy";
    const label = btn.querySelector("[data-updated]");
    if (label) label.textContent = text;
  }

  function wireRefresh() {
    const btn = document.querySelector("[data-refresh]");
    if (btn) btn.addEventListener("click", function () { live.refresh(true); });

    window.addEventListener("hn:refresh-start", function (e) {
      setButton("busy", "Refreshing 0/" + e.detail.total);
    });
    window.addEventListener("hn:refresh-progress", function (e) {
      setButton("busy", "Refreshing " + e.detail.done + "/" + e.detail.total);
    });
    window.addEventListener("hn:refresh-end", function (e) {
      setButton("idle", ui.updatedText());
      const r = e.detail;
      if (r.silent && r.ok && !r.failed.length) return;   // quiet on first-load refresh unless something failed
      if (!r.ok) {
        ui.toast("Couldn't reach the official sources — showing saved data", "triangle-alert");
      } else if (r.failed.length) {
        ui.toast("Updated · " + r.failed.join(", ") + " unavailable, kept last saved data", "triangle-alert");
      } else {
        ui.toast("Jobs updated from " + r.ok + " official sources");
      }
    });
    window.addEventListener("hn:data", function () {
      ui.updateHeader();
      if (typeof HN.pageRefresh === "function") HN.pageRefresh();
      ui.refreshIcons();
    });

    // Keep "Updated 3 min ago" current
    setInterval(ui.updateHeader, 30 * 1000);
  }

  function boot() {
    const header = document.querySelector("[data-site-header]");
    const footer = document.querySelector("[data-site-footer]");
    if (header) header.outerHTML = ui.header(document.body.dataset.nav || document.body.dataset.page);
    if (footer) footer.outerHTML = ui.footer();

    const init = HN.pages && HN.pages[document.body.dataset.page];
    if (typeof init === "function") init();

    wireRefresh();
    live.refreshOnFirstLoad();

    ui.refreshIcons();
    // Lucide is loaded with "defer" from a CDN — render icons again once it's ready.
    window.addEventListener("load", ui.refreshIcons);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.HN = window.HN || {});
