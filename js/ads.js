/* ==========================================================================
   Hunt Gov Pk — Official advertisements page (advertisements.html)
   Lists advertisement PDFs / notices collected from official websites, plus
   the watch list of newly created departments.
   ========================================================================== */
(function (HN) {
  "use strict";
  HN.pages = HN.pages || {};

  const u = HN.utils;
  const ui = HN.ui;
  const esc = u.escapeHtml;

  let state, els;

  function readState() {
    const p = u.getParams();
    return { q: p.get("q") || "", source: p.get("source") || "", newOnly: p.get("new") === "1" };
  }

  function writeState() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.source) p.set("source", state.source);
    if (state.newOnly) p.set("new", "1");
    const qs = p.toString();
    try { history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "")); } catch (e) { /* ignore */ }
  }

  function matches(ad) {
    const tokens = u.tokenize(state.q);
    if (tokens.length) {
      const hay = [ad.title, ad.organization, ad.adNo, ad.source, ad.note].join(" ").toLowerCase();
      if (!tokens.every(function (t) { return hay.indexOf(t) !== -1; })) return false;
    }
    if (state.source && ad.source !== state.source) return false;
    if (state.newOnly && !ad.newDepartment) return false;
    return true;
  }

  function render() {
    const list = u.ads.filter(matches).sort(function (a, b) { return (b.dateObj || 0) - (a.dateObj || 0); });
    els.count.innerHTML = "<b>" + list.length + "</b> " + (list.length === 1 ? "advertisement" : "advertisements") +
      (state.q ? " matching “" + esc(state.q) + "”" : "");
    els.reset.hidden = !(state.q || state.source || state.newOnly);
    els.list.innerHTML = list.length
      ? list.map(function (a) { return ui.adCard(a, state.q); }).join("")
      : ui.emptyState({
          icon: state.newOnly ? "radar" : "search-x",
          title: state.newOnly ? "No advertisements from new departments yet" : "No advertisements match",
          text: state.newOnly
            ? "None of the watched departments have an advertisement on the tracked official websites right now. They are checked on every refresh."
            : "Try a different keyword or clear the filters.",
          actions: '<button class="btn btn-primary" type="button" data-reset>' + ui.icon("rotate-ccw") + "Clear filters</button>"
        });
    ui.refreshIcons();
    writeState();
  }

  function renderSidebar() {
    els.watch.innerHTML = u.newDepartments.map(function (d) {
      const found = d.jobs + d.ads;
      return (
        '<li class="watch-item">' +
          '<span class="watch-dot ' + (found ? "is-found" : "") + '"></span>' +
          "<div><b>" + esc(d.name) + "</b>" +
          "<small>Est. " + esc(d.est) + " · " +
            (found ? '<a href="index.html?q=' + encodeURIComponent(d.name.replace(/\s*\(.*\)/, "")) + '">' + u.plural(d.jobs, "job") + "</a>, " + u.plural(d.ads, "advert") : "No openings found yet") +
          "</small></div>" +
        "</li>"
      );
    }).join("");

    els.sources.innerHTML = u.sources.map(function (s) {
      return (
        '<li class="watch-item">' +
          '<span class="watch-dot ' + (s.ok ? "is-found" : "is-error") + '"></span>' +
          '<div><b><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.id) + "</a></b>" +
          "<small>" + u.plural(s.jobs, "job") + " · " + u.plural(s.ads, "advert") +
            (s.ok ? "" : " · last fetch failed") + "</small></div>" +
        "</li>"
      );
    }).join("");
  }

  function bind() {
    els.q.addEventListener("input", u.debounce(function () { state.q = els.q.value.trim(); render(); }, 200));
    els.form.addEventListener("submit", function (e) { e.preventDefault(); state.q = els.q.value.trim(); render(); });
    els.source.addEventListener("change", function () { state.source = els.source.value; render(); });
    els.newOnly.addEventListener("change", function () { state.newOnly = els.newOnly.checked; render(); });
    document.querySelector(".ads-main").addEventListener("click", function (e) {
      if (!e.target.closest("[data-reset]")) return;
      state = { q: "", source: "", newOnly: false };
      sync();
      render();
    });
  }

  function sync() {
    els.q.value = state.q;
    els.source.value = state.source;
    els.newOnly.checked = state.newOnly;
  }

  HN.pages.ads = function () {
    els = {
      form: document.getElementById("search-form"),
      q: document.getElementById("q"),
      source: document.getElementById("f-source"),
      newOnly: document.getElementById("f-new"),
      count: document.getElementById("results-count"),
      reset: document.getElementById("reset-filters"),
      list: document.getElementById("ad-list"),
      watch: document.getElementById("watch-list"),
      sources: document.getElementById("source-list")
    };
    if (!u.hasData) {
      els.list.innerHTML = ui.emptyState({
        icon: "database", title: "No data yet",
        text: "Press Refresh to fetch the latest advertisements, or run <code>python scraper/fetch_jobs.py</code> locally."
      });
      HN.pageRefresh = HN.pages.ads;   // first live data arrives -> full init
      return;
    }
    function buildSourceFilter() {
      const sources = Array.from(new Set(u.ads.map(function (a) { return a.source; }))).sort();
      els.source.innerHTML = '<option value="">All sources</option>' + sources.map(function (s) {
        const n = u.ads.filter(function (a) { return a.source === s; }).length;
        return '<option value="' + esc(s) + '">' + esc(s) + " (" + n + ")</option>";
      }).join("");
    }
    buildSourceFilter();
    state = readState();
    sync();
    renderSidebar();
    bind();
    render();

    HN.pageRefresh = function () {
      buildSourceFilter();
      sync();
      renderSidebar();
      render();
    };
  };
})(window.HN = window.HN || {});
