/* ==========================================================================
   Hunt Gov Pk — Job listing page (index.html)
   ========================================================================== */
(function (HN) {
  "use strict";
  HN.pages = HN.pages || {};

  const u = HN.utils;
  const ui = HN.ui;
  const esc = u.escapeHtml;

  const SORTS = [
    { id: "deadline", label: "Closing soonest" },
    { id: "latest", label: "Newest first" },
    { id: "scale", label: "Highest pay scale" },
    { id: "posts", label: "Most posts" }
  ];

  let state, els;

  /* ------------------------------------------------------------- State */
  function readState() {
    const p = u.getParams();
    return {
      q: p.get("q") || "",
      source: p.get("source") || "",
      department: p.get("department") || "",
      scale: p.get("scale") || "",
      newOnly: p.get("new") === "1",
      it: p.get("it") === "1",
      closed: p.get("closed") === "1",
      sort: SORTS.some(function (s) { return s.id === p.get("sort"); }) ? p.get("sort") : "deadline"
    };
  }

  function writeState() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.source) p.set("source", state.source);
    if (state.department) p.set("department", state.department);
    if (state.newOnly) p.set("new", "1");
    if (state.it) p.set("it", "1");
    if (state.scale) p.set("scale", state.scale);
    if (state.closed) p.set("closed", "1");
    if (state.sort !== "deadline") p.set("sort", state.sort);
    const qs = p.toString();
    try { history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "")); } catch (e) { /* ignore */ }
  }

  /* ----------------------------------------------------------- Filtering */
  function matches(job) {
    const tokens = u.tokenize(state.q);
    if (tokens.length) {
      const hay = [job.title, job.department, job.qualification, job.payScale, job.placeOfPosting, job.adNo, job.caseNo, job.source, job.projectCode, job.testType, job.newDepartment, job.project, job.salary, job.itJob ? "computer science it" : ""]
        .join(" ").toLowerCase();
      if (!tokens.every(function (t) { return hay.indexOf(t) !== -1; })) return false;
    }
    if (state.source && job.source !== state.source) return false;
    if (state.newOnly && !job.newDepartment) return false;
    if (state.it && !job.itJob) return false;
    if (state.department && job.department !== state.department) return false;
    if (state.scale && job.payScale !== state.scale) return false;
    if (!state.closed && u.getStatus(job).key === "closed") return false;
    return true;
  }

  function sortJobs(list) {
    const byDeadline = function (a, b) {
      const ac = u.getStatus(a).key === "closed", bc = u.getStatus(b).key === "closed";
      if (ac !== bc) return ac ? 1 : -1;
      return (a.closingDateObj || 0) - (b.closingDateObj || 0);
    };
    const cmp = {
      deadline: byDeadline,
      latest: function (a, b) { return (b.adDateObj || 0) - (a.adDateObj || 0) || byDeadline(a, b); },
      scale: function (a, b) { return u.scaleNumber(b) - u.scaleNumber(a) || byDeadline(a, b); },
      posts: function (a, b) { return b.posts - a.posts || byDeadline(a, b); }
    }[state.sort];
    return list.slice().sort(cmp);
  }

  /* ------------------------------------------------------------- Render */
  function options(values, allLabel) {
    return '<option value="">' + allLabel + "</option>" +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + "</option>"; }).join("");
  }

  function buildControls() {
    const departments = Array.from(new Set(u.govJobs.map(function (j) { return j.department; }))).sort();
    const scales = Array.from(new Set(u.govJobs.map(function (j) { return j.payScale; }).filter(Boolean)))
      .sort(function (a, b) { return parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10); });

    const sources = Array.from(new Set(u.govJobs.map(function (j) { return j.source; }))).sort();
    els.source.innerHTML = '<option value="">All sources</option>' + sources.map(function (s) {
      const n = u.govJobs.filter(function (j) { return j.source === s; }).length;
      return '<option value="' + esc(s) + '">' + esc(s) + " (" + n + ")</option>";
    }).join("");
    els.department.innerHTML = options(departments, "All departments");
    els.scale.innerHTML = options(scales, "All pay scales");
    els.sort.innerHTML = SORTS.map(function (s) { return '<option value="' + s.id + '">' + s.label + "</option>"; }).join("");
  }

  function syncControls() {
    els.q.value = state.q;
    els.source.value = state.source;
    els.newOnly.checked = state.newOnly;
    els.it.checked = state.it;
    els.department.value = state.department;
    els.scale.value = state.scale;
    els.closed.checked = state.closed;
    els.sort.value = state.sort;
  }

  function renderSummary() {
    const open = u.govJobs.filter(function (j) { return u.getStatus(j).key !== "closed"; });
    const posts = open.reduce(function (s, j) { return s + (j.posts || 0); }, 0);
    const sources = u.sources.filter(function (s) { return s.jobs && s.group !== "healthcare"; }).map(function (s) {
      return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(s.name) + '">' + esc(s.id) + "</a>" +
        (s.ok ? "" : ' <span class="badge badge-closing">fetch failed — last saved data</span>');
    }).join(", ");

    els.summary.innerHTML =
      '<span class="hero-stat"><b>' + open.length + "</b> open adverts</span>" +
      '<span class="hero-stat"><b>' + posts + "</b> total posts</span>" +
      '<span class="hero-stat"><a href="?it=1"><b>' + open.filter(function (j) { return j.itJob; }).length + "</b> in Computer Science &amp; IT</a></span>" +
      '<span class="hero-stat">' + ui.icon("shield-check") + "Official sources:&nbsp;<span>" + sources + "</span></span>" +
      '<span class="hero-stat">' + ui.icon("file-text") + '<a href="advertisements.html">' + u.ads.length + " official advertisements</a></span>" +
      '<span class="hero-stat">' + ui.icon("clock") + "Fetched " + esc(u.formatDateTime(u.data.generatedAt)) + "</span>";

    if (u.dataAgeHours() > 24) {
      els.stale.hidden = false;
      els.stale.innerHTML = ui.icon("triangle-alert") +
        "<div><strong>This data was fetched " + esc(u.relativeTime(u.data.generatedAt)) + ".</strong> " +
        "Run <code>python scraper/fetch_jobs.py</code> to pull the latest advertisements from the official websites.</div>";
    }
  }

  function render() {
    const results = sortJobs(u.govJobs.filter(matches));
    const active = !!(state.q || state.source || state.newOnly || state.it || state.department || state.scale || state.closed);

    els.count.innerHTML = "<b>" + results.length + "</b> " + (results.length === 1 ? "job" : "jobs") +
      (state.q ? " matching “" + esc(state.q) + "”" : "");
    els.reset.hidden = !active;

    if (!results.length) {
      let closedMatches = 0;
      if (!state.closed) {
        state.closed = true;
        closedMatches = u.govJobs.filter(function (j) { return u.getStatus(j).key === "closed" && matches(j); }).length;
        state.closed = false;
      }
      els.list.innerHTML = ui.emptyState({
        icon: "search-x",
        title: state.newOnly ? "No jobs from new departments right now" : "No jobs match your search",
        text: state.newOnly
          ? "None of the watched departments (NCCIA, Federal Constabulary, PERA and others) have an open post on the tracked official websites today. They are checked on every refresh."
          : "Try a different keyword or clear the filters.",
        actions: '<button class="btn btn-primary" type="button" data-reset>' + ui.icon("rotate-ccw") + "Clear filters</button>" +
          (closedMatches ? '<button class="btn btn-outline" type="button" data-show-closed>Show ' + closedMatches + " closed</button>" : "")
      });
    } else {
      els.list.innerHTML = results.map(function (j) { return ui.jobCard(j, state.q); }).join("");
    }
    ui.refreshIcons();
    writeState();
  }

  function renderNoData() {
    document.querySelector(".jobs-toolbar").hidden = true;
    els.summary.innerHTML = "";
    els.list.innerHTML = ui.emptyState({
      icon: "database",
      title: "No job data yet",
      text: "Job listings are fetched from the official websites by the scraper. Open a terminal in the project folder and run:<br><code>python scraper/fetch_jobs.py</code><br>then refresh this page."
    });
  }

  /* ------------------------------------------------------------- Events */
  function bind() {
    els.q.addEventListener("input", u.debounce(function () { state.q = els.q.value.trim(); render(); }, 200));
    els.form.addEventListener("submit", function (e) { e.preventDefault(); state.q = els.q.value.trim(); render(); });
    els.source.addEventListener("change", function () { state.source = els.source.value; render(); });
    els.newOnly.addEventListener("change", function () { state.newOnly = els.newOnly.checked; render(); });
    els.it.addEventListener("change", function () { state.it = els.it.checked; render(); });
    els.department.addEventListener("change", function () { state.department = els.department.value; render(); });
    els.scale.addEventListener("change", function () { state.scale = els.scale.value; render(); });
    els.closed.addEventListener("change", function () { state.closed = els.closed.checked; render(); });
    els.sort.addEventListener("change", function () { state.sort = els.sort.value; render(); });

    document.querySelector(".jobs-main").addEventListener("click", function (e) {
      if (e.target.closest("[data-reset]")) {
        state = { q: "", source: "", newOnly: false, it: false, department: "", scale: "", closed: false, sort: state.sort };
        syncControls();
        render();
      } else if (e.target.closest("[data-show-closed]")) {
        state.closed = true;
        syncControls();
        render();
      }
    });
  }

  HN.pages.jobs = function () {
    els = {
      form: document.getElementById("search-form"),
      q: document.getElementById("q"),
      source: document.getElementById("f-source"),
      newOnly: document.getElementById("f-new"),
      it: document.getElementById("f-it"),
      department: document.getElementById("f-department"),
      scale: document.getElementById("f-scale"),
      closed: document.getElementById("f-closed"),
      sort: document.getElementById("f-sort"),
      count: document.getElementById("results-count"),
      reset: document.getElementById("reset-filters"),
      list: document.getElementById("job-list"),
      summary: document.getElementById("hero-summary"),
      stale: document.getElementById("stale-notice")
    };

    if (!u.hasData) {
      renderNoData();
      HN.pageRefresh = HN.pages.jobs;   // first live data arrives -> full init
      return;
    }

    document.querySelector(".jobs-toolbar").hidden = false;
    state = readState();
    buildControls();
    syncControls();
    renderSummary();
    bind();
    render();

    // New live data: rebuild dropdowns (keeping the user's filters) and re-render
    HN.pageRefresh = function () {
      buildControls();
      syncControls();
      renderSummary();
      render();
    };
  };
})(window.HN = window.HN || {});
