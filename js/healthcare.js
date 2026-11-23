/* ==========================================================================
   Hunt Gov Pk — Healthcare jobs page (healthcare.html)
   Jobs from major hospitals (Shaukat Khanum, PKLI, ...) grouped by field,
   with Computer Science & IT as the first tab.
   ========================================================================== */
(function (HN) {
  "use strict";
  HN.pages = HN.pages || {};

  const u = HN.utils;
  const ui = HN.ui;
  const esc = u.escapeHtml;

  const FIELDS = [
    { id: "it", label: "Computer Science & IT", icon: "monitor" },
    { id: "all", label: "All fields", icon: "layout-grid" },
    { id: "medical", label: "Medical & Clinical", icon: "stethoscope" },
    { id: "nursing", label: "Nursing & Paramedical", icon: "heart-pulse" },
    { id: "pharmacy", label: "Pharmacy", icon: "pill" },
    { id: "research", label: "Research", icon: "flask-conical" },
    { id: "admin", label: "Management & Technical", icon: "briefcase" }
  ];

  let state, els;

  function openJobs() {
    return u.healthJobs.filter(function (j) { return state.closed || u.getStatus(j).key !== "closed"; });
  }

  function fieldCount(id) {
    return openJobs().filter(function (j) { return id === "all" || j.field === id; }).length;
  }

  function readState() {
    const p = u.getParams();
    const field = p.get("field");
    return {
      q: p.get("q") || "",
      hospital: p.get("hospital") || "",
      city: p.get("city") || "",
      closed: p.get("closed") === "1",
      // Default to Computer Science & IT when there are IT openings
      field: FIELDS.some(function (f) { return f.id === field; }) ? field : null
    };
  }

  function writeState() {
    const p = new URLSearchParams();
    if (state.field && state.field !== "all") p.set("field", state.field);
    if (state.field === "all") p.set("field", "all");
    if (state.q) p.set("q", state.q);
    if (state.hospital) p.set("hospital", state.hospital);
    if (state.city) p.set("city", state.city);
    if (state.closed) p.set("closed", "1");
    const qs = p.toString();
    try { history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "")); } catch (e) { /* ignore */ }
  }

  function matches(job) {
    if (state.field !== "all" && job.field !== state.field) return false;
    if (state.hospital && job.source !== state.hospital) return false;
    if (state.city && job.region !== state.city) return false;
    if (!state.closed && u.getStatus(job).key === "closed") return false;
    const tokens = u.tokenize(state.q);
    if (tokens.length) {
      const hay = [job.title, job.department, job.hospitalDept, job.region, job.fieldLabel, job.description,
        (job.details || []).join(" ")].join(" ").toLowerCase();
      if (!tokens.every(function (t) { return hay.indexOf(t) !== -1; })) return false;
    }
    return true;
  }

  function renderTabs() {
    els.tabs.innerHTML = FIELDS.map(function (f) {
      const n = fieldCount(f.id);
      return '<button type="button" class="field-tab' + (state.field === f.id ? " is-active" : "") + (f.id === "it" ? " field-tab--it" : "") +
        '" data-field="' + f.id + '" role="tab" aria-selected="' + (state.field === f.id) + '">' +
        ui.icon(f.icon) + "<span>" + f.label + "</span><b>" + n + "</b></button>";
    }).join("");
  }

  function render() {
    renderTabs();
    const results = u.healthJobs.filter(matches).sort(function (a, b) {
      return (a.closingDateObj || 0) - (b.closingDateObj || 0) || a.title.localeCompare(b.title);
    });
    const field = FIELDS.find(function (f) { return f.id === state.field; });
    els.count.innerHTML = "<b>" + results.length + "</b> " + (results.length === 1 ? "job" : "jobs") +
      (state.field !== "all" ? " in " + esc(field.label) : "") + (state.q ? " matching “" + esc(state.q) + "”" : "");
    els.reset.hidden = !(state.q || state.hospital || state.city || state.closed);

    if (!results.length) {
      const itEmpty = state.field === "it";
      els.list.innerHTML = ui.emptyState({
        icon: itEmpty ? "monitor-off" : "search-x",
        title: itEmpty ? "No Computer Science & IT openings right now" : "No jobs match",
        text: itEmpty
          ? "None of the tracked hospitals have an open IT post at the moment. They are re-checked on every refresh."
          : "Try another field or clear the filters.",
        actions: '<button class="btn btn-primary" type="button" data-field="all">' + ui.icon("layout-grid") + "Show all fields</button>"
      });
    } else {
      els.list.innerHTML = results.map(function (j) { return ui.jobCard(j, state.q); }).join("");
    }
    ui.refreshIcons();
    writeState();
  }

  function renderSummary() {
    const hospitals = u.sources.filter(function (s) { return s.group === "healthcare"; });
    els.summary.innerHTML =
      '<span class="hero-stat"><b>' + fieldCount("all") + "</b> open hospital jobs</span>" +
      '<span class="hero-stat"><b>' + fieldCount("it") + "</b> in Computer Science &amp; IT</span>" +
      '<span class="hero-stat">' + ui.icon("hospital") + "Hospitals:&nbsp;<span>" + hospitals.map(function (s) {
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + "</a>";
      }).join(", ") + "</span></span>";
  }

  function buildFilters() {
    const hospitals = Array.from(new Set(u.healthJobs.map(function (j) { return j.source; }))).sort();
    els.hospital.innerHTML = '<option value="">All hospitals</option>' + hospitals.map(function (h) {
      const job = u.healthJobs.find(function (j) { return j.source === h; });
      return '<option value="' + esc(h) + '">' + esc(job.department) + "</option>";
    }).join("");
    const cities = Array.from(new Set(u.healthJobs.map(function (j) { return j.region; }).filter(Boolean))).sort();
    els.city.innerHTML = '<option value="">All cities</option>' + cities.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + "</option>";
    }).join("");
  }

  function sync() {
    els.q.value = state.q;
    els.hospital.value = state.hospital;
    els.city.value = state.city;
    els.closed.checked = state.closed;
  }

  function bind() {
    els.q.addEventListener("input", u.debounce(function () { state.q = els.q.value.trim(); render(); }, 200));
    els.form.addEventListener("submit", function (e) { e.preventDefault(); state.q = els.q.value.trim(); render(); });
    els.hospital.addEventListener("change", function () { state.hospital = els.hospital.value; render(); });
    els.city.addEventListener("change", function () { state.city = els.city.value; render(); });
    els.closed.addEventListener("change", function () { state.closed = els.closed.checked; render(); });
    document.querySelector(".health-main").addEventListener("click", function (e) {
      const tab = e.target.closest("[data-field]");
      if (tab) { state.field = tab.dataset.field; render(); return; }
      if (e.target.closest("[data-reset]")) {
        state = { q: "", hospital: "", city: "", closed: false, field: state.field };
        sync();
        render();
      }
    });
  }

  HN.pages.health = function () {
    els = {
      form: document.getElementById("search-form"),
      q: document.getElementById("q"),
      hospital: document.getElementById("f-hospital"),
      city: document.getElementById("f-city"),
      closed: document.getElementById("f-closed"),
      tabs: document.getElementById("field-tabs"),
      count: document.getElementById("results-count"),
      reset: document.getElementById("reset-filters"),
      list: document.getElementById("job-list"),
      summary: document.getElementById("hero-summary")
    };
    if (!u.hasData || !u.healthJobs.length) {
      document.querySelector(".jobs-toolbar").hidden = true;
      els.list.innerHTML = ui.emptyState({
        icon: "database", title: "No hospital jobs yet",
        text: "Press Refresh to fetch the latest jobs, or run <code>python scraper/fetch_jobs.py</code> locally."
      });
      HN.pageRefresh = HN.pages.health;   // first live data arrives -> full init
      return;
    }
    document.querySelector(".jobs-toolbar").hidden = false;
    state = readState();
    if (!state.field) state.field = fieldCount("it") ? "it" : "all";
    buildFilters();
    sync();
    renderSummary();
    bind();
    render();

    HN.pageRefresh = function () {
      buildFilters();
      sync();
      renderSummary();
      render();
    };
  };
})(window.HN = window.HN || {});
