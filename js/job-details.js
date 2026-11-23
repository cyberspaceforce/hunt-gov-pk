/* ==========================================================================
   Hunt Gov Pk — Job details page
   Every field shown here comes from the official source page for the post.
   ========================================================================== */
(function (HN) {
  "use strict";
  HN.pages = HN.pages || {};

  const u = HN.utils;
  const ui = HN.ui;
  const esc = u.escapeHtml;

  function section(id, icon, title, body) {
    return (
      '<section class="card detail-section" id="' + id + '">' +
        '<div class="detail-section__head"><h2>' + ui.icon(icon) + title + "</h2></div>" +
        '<div class="detail-section__body">' + body + "</div>" +
      "</section>"
    );
  }

  /** Render official clause text ("i) ... ii) ... OR ...") as readable lists. */
  function clauses(text) {
    const blocks = u.splitClauses(text);
    if (!blocks.length) return "<p>" + esc(text) + "</p>";
    return blocks.map(function (block, i) {
      const list = block.length > 1
        ? '<ul class="clause-list">' + block.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>"
        : "<p>" + esc(block[0]) + "</p>";
      return (i > 0 ? '<div class="or-divider"><span>OR</span></div>' : "") +
        (blocks.length > 1 ? '<div class="option-label">Option ' + (i + 1) + "</div>" : "") + list;
    }).join("");
  }

  /** "Male: 24 to 30 + 05 = 35 Years Female: ..." -> one line per rule. */
  function ageList(text) {
    const parts = String(text)
      .split(/\s+(?=(?:Male|Female|Transgender)\s*:|Age and sex|IMPORTANT NOTE|For special persons)/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (parts.length < 2) return "<p>" + esc(text) + "</p>";
    return '<ul class="clause-list">' + parts.map(function (p) {
      const m = /^(Male|Female|Transgender)\s*:\s*(.*)$/.exec(p);
      return "<li>" + (m ? "<strong>" + m[1] + ":</strong> " + esc(m[2]) : esc(p)) + "</li>";
    }).join("") + "</ul>";
  }

  function applySteps(job) {
    const last = "<strong>" + esc(u.formatDate(job.closingDateObj)) + "</strong>";
    if (job.source === "PJP") {
      return [
        "Read the official advertisement and the requirements above. A Punjab domicile is usually required.",
        "Open this job on the Punjab Job Portal (jobs.punjab.gov.pk) and register or log in.",
        "Complete your profile (education, experience, CNIC) and click <strong>Apply for this Job</strong>.",
        "Submit before " + last + ". Only shortlisted candidates are contacted."
      ];
    }
    if (job.source === "OTS") {
      return [
        "Open the post details on OTS and read the official advertisement for <strong>" + esc(job.title) + "</strong>.",
        "Log in or register on the OTS applicant portal and select this post (project code " + esc(job.projectCode) + ").",
        "Fill the online form, upload your documents and pay the fee using the PSID shown on the portal.",
        "Submit before " + last + ". Roll number slips are issued through the OTS website."
      ];
    }
    return [
      "Read the official advertisement (Ad No. " + esc(job.adNo) + ") carefully and confirm you meet every requirement.",
      "Open the " + esc(job.source) + " jobs page and select <strong>" + esc(job.titleRaw || job.title) + "</strong>" + (job.caseNo ? " (Case No. " + esc(job.caseNo) + ")" : "") + ".",
      "Create or log in to your " + esc(job.source) + " online account and complete the application form.",
      (u.hasValue(job.fee) ? "Pay the application fee of Rs. " + esc(job.fee) + " and submit" : "Submit your application") + " before " + last + "."
    ];
  }

  /* ----------------------------------------------- Hospital (healthcare) jobs */
  function healthFacts(job) {
    return [
      fact("hospital", "Hospital", esc(job.source === "SKMCH" ? (job.placeOfPosting || job.department) : job.source + (job.region ? ", " + job.region : ""))),
      fact("stethoscope", "Department", esc(job.hospitalDept || "Not stated")),
      fact("tag", "Field", esc(job.fieldLabel || "—")),
      fact("calendar-x", "Last date to apply", esc(u.formatDate(job.closingDateObj))),
      fact("users", "Seats", job.posts ? esc(job.posts) : "Not stated"),
      fact("briefcase", "Experience", esc(job.experience || "As per advertisement"))
    ].join("");
  }

  /** PKLI details come as items; "## Heading" items become sub-headings. */
  function detailItems(items) {
    const clean = u.cleanDetails(items);
    let html = clean.sections.map(function (s) {
      return (s.heading ? '<h4 class="detail-subhead">' + esc(s.heading) + "</h4>" : "") +
        '<ul class="clause-list">' + s.items.map(function (it) { return "<li>" + esc(it) + "</li>"; }).join("") + "</ul>";
    }).join("");
    if (clean.facts.length) {
      html += '<h4 class="detail-subhead">At a glance</h4><table class="eligibility-table"><tbody>' +
        clean.facts.map(function (f) { return "<tr><th>" + esc(f[0]) + "</th><td>" + esc(f[1]) + "</td></tr>"; }).join("") +
        "</tbody></table>";
    }
    return html || "<p>See the official advertisement for full details.</p>";
  }

  function healthMain(job) {
    const details = job.details || [];
    const hasHeadings = details.some(function (d) { return d.indexOf("## ") === 0; });
    return (
      '<div class="card facts-card"><div class="facts-grid">' + healthFacts(job) + "</div></div>" +
      (job.description ? section("about", "file-text", "About the role", "<p>" + esc(job.description) + "</p>") : "") +
      (details.length
        ? section("requirements", "list-checks", hasHeadings ? "Qualification, experience &amp; duties" : "Eligibility criteria", detailItems(details))
        : section("requirements", "list-checks", "Requirements",
            "<p>The full requirements are published on the hospital's careers portal.</p>")) +
      section("apply", "send", "How to apply",
        '<ol class="num-list">' + [
          "Read the requirements above and make sure you meet them.",
          "Open the " + esc(job.source) + " careers portal using the <strong>Apply</strong> button.",
          job.source === "SKMCH"
            ? "Apply online through the portal. Shaukat Khanum notes that only shortlisted candidates are contacted."
            : "Register or log in on the portal, then submit your application for this post.",
          "Apply before <strong>" + esc(u.formatDate(job.closingDateObj)) + "</strong>."
        ].map(function (step) { return "<li><span>" + step + "</span></li>"; }).join("") + "</ol>")
    );
  }

  function fact(icon, label, value) {
    return '<div class="fact"><div class="fact__icon">' + ui.icon(icon) + '</div><div><div class="fact__label">' + label +
      '</div><div class="fact__value">' + value + "</div></div></div>";
  }

  function render(job) {
    const s = u.getStatus(job);
    document.title = job.title + " — " + job.department + " | Hunt Gov Pk";

    const isFull = job.hasDetails;
    const isHealth = job.group === "healthcare";
    let facts = (isFull ? [
      fact("layers", "Pay scale", esc(job.payScale || "Not stated")),
      fact("users", "Total posts", job.posts ? esc(job.posts) : "Not stated"),
      fact("calendar-x", "Last date to apply", esc(u.formatDate(job.closingDateObj))),
      job.salary ? fact("wallet", "Monthly salary", "Rs. " + esc(job.salary))
        : fact("receipt", "Application fee", u.hasValue(job.fee) ? "Rs. " + esc(job.fee) : "Not stated"),
      fact("user-check", "Who can apply", esc(job.eligibility || "Not stated")),
      fact("map-pin", "Place of posting", esc(job.placeOfPosting || job.region || "Not stated"))
    ] : [
      fact("calendar-x", "Last date to apply", esc(u.formatDate(job.closingDateObj))),
      fact("clipboard-list", "Selection process", esc(job.testType || "Not stated")),
      fact("hash", "Project code", esc(job.projectCode || job.adNo || "—"))
    ]).join("");

    const quota = [
      ["Total posts", job.posts], ["Reserved for women", job.postsWomen],
      ["Reserved for special persons", job.postsSpecial], ["Reserved for minorities", job.postsMinorities]
    ];

    const extras = [
      ["Additional requirement", job.additionalRequirement],
      ["Preferences", job.preferences],
      ["Note", job.note]
    ].filter(function (x) { return x[1]; });

    let main =
      '<div class="card facts-card"><div class="facts-grid">' + facts + "</div></div>" +
      (isFull ? "" : section("official-details", "file-search", "Eligibility, qualification &amp; pay",
        "<p>" + esc(job.sourceName) + " publishes the qualification, age limit, pay scale and number of posts for this post in its official advertisement and post-details page. Open them below to read the full requirements.</p>" +
        '<div class="inline-actions">' +
          (job.detailsUrl ? '<a class="btn btn-primary" href="' + esc(job.detailsUrl) + '" target="_blank" rel="noopener noreferrer">' + ui.icon("file-text") + "Post details on " + esc(job.source) + "</a>" : "") +
          (job.advertisementUrl ? '<a class="btn btn-outline" href="' + esc(job.advertisementUrl) + '" target="_blank" rel="noopener noreferrer">' + ui.icon("external-link") + "Project &amp; advertisement</a>" : "") +
        "</div>")) +
      (job.qualification ? section("qualification", "graduation-cap", "Qualification", clauses(job.qualification)) : "") +
      (job.experience ? section("experience", "briefcase", "Experience", clauses(job.experience)) : "") +
      (job.age ? section("age", "cake", "Age limit", ageList(job.age)) : "") +
      (job.details && job.details.length && !isHealth ? section("role", "clipboard-list", "Responsibilities, degree &amp; skills", detailItems(job.details)) : "") +
      (!isFull || job.source !== "PPSC" ? "" : section("quota", "pie-chart", "Posts &amp; quota",
        '<table class="eligibility-table"><tbody>' + quota.map(function (q) {
          return "<tr><th>" + q[0] + "</th><td>" + esc(q[1] || 0) + "</td></tr>";
        }).join("") + "</tbody></table>")) +
      (extras.length ? section("notes", "info", "Notes from the advertisement",
        extras.map(function (x) { return '<h4 class="note-title">' + x[0] + "</h4>" + clauses(x[1]); }).join("")) : "") +
      section("apply", "list-checks", "How to apply",
        '<ol class="num-list">' + applySteps(job).map(function (step) { return "<li><span>" + step + "</span></li>"; }).join("") + "</ol>" +
        (job.howToApplyUrl ? '<p style="margin-top:14px"><a class="link-arrow" href="' + esc(job.howToApplyUrl) + '" target="_blank" rel="noopener noreferrer">Official online application guide (PDF) ' + ui.icon("external-link") + "</a></p>" : ""));

    if (isHealth) {
      facts = healthFacts(job);
      main = healthMain(job);
    }

    const aside =
      '<div class="card apply-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
          '<span class="fact__label">Application deadline</span>' + ui.statusBadge(job) + "</div>" +
        '<div class="countdown' + (s.key === "closed" ? " is-closed" : "") + '" id="countdown"></div>' +
        '<a class="btn btn-primary btn-block btn-lg" href="' + esc(job.applyUrl) + '" target="_blank" rel="noopener noreferrer">' +
          "Apply on " + esc(job.source === "PJP" ? "Punjab Job Portal" : job.source) + " website " + ui.icon("external-link") + "</a>" +
        (job.advertisementUrl
          ? '<a class="btn btn-outline btn-block" href="' + esc(job.advertisementUrl) + '" target="_blank" rel="noopener noreferrer">' + ui.icon("file-text") + (job.source === "OTS" ? "View project &amp; advertisement" : "View official advertisement") + "</a>"
          : "") +
        '<button class="btn btn-ghost btn-block" type="button" id="copy-link">' + ui.icon("link") + "Copy link to this job</button>" +
        '<div class="apply-dates" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">' +
          (job.adDateObj ? "<div><span>Advertised</span><b>" + esc(u.formatDate(job.adDateObj)) + "</b></div>" : "") +
          "<div><span>Last date</span><b>" + esc(u.formatDate(job.closingDateObj)) + "</b></div>" +
          (job.adNo ? "<div><span>Advertisement No.</span><b>" + esc(job.adNo) + "</b></div>" : "") +
          (job.caseNo ? "<div><span>Case No.</span><b>" + esc(job.caseNo) + "</b></div>" : "") +
          (job.projectCode ? "<div><span>Project code</span><b>" + esc(job.projectCode) + "</b></div>" : "") +
          (job.employmentType ? "<div><span>Employment</span><b>" + esc(job.employmentType) + "</b></div>" : "") +
          (job.project && job.project !== job.department ? "<div><span>Project</span><b>" + esc(job.project) + "</b></div>" : "") +
        "</div>" +
      "</div>" +
      '<div class="card card-pad">' +
        '<h3 class="card-title">' + ui.icon("shield-check") + "Official source</h3>" +
        '<p class="text-sm muted">All information on this page was taken from the <a href="' + esc(job.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' +
          esc(job.sourceName) + "</a> website on " + esc(u.formatDateTime(u.data.generatedAt)) + ".</p>" +
        '<p class="text-sm muted" style="margin-top:10px">The official advertisement is the final authority. Always verify before applying.</p>' +
      "</div>";

    document.getElementById("details-root").innerHTML =
      '<section class="details-hero">' +
        '<div class="container">' +
          '<nav class="breadcrumb" aria-label="Breadcrumb"><a href="' + (isHealth ? "healthcare.html" : "index.html") + '">' + (isHealth ? "Healthcare jobs" : "Government jobs") + "</a>" + ui.icon("chevron-right") + "<span>" + esc(job.title) + "</span></nav>" +
          '<div class="details-head">' +
            ui.orgLogo(job.department, "lg") +
            '<div class="details-head__main">' +
              "<h1>" + esc(job.title) + "</h1>" +
              '<div class="details-head__org">' +
                "<span>" + ui.icon("building-2") + "<strong>" + esc(job.department) + "</strong></span>" +
                (isHealth
                  ? (job.region ? "<span>" + ui.icon("map-pin") + esc(job.region) + "</span>" : "")
                  : "<span>" + ui.icon("landmark") + esc(job.sourceName) + "</span>") +
              "</div>" +
              '<div class="details-head__badges">' + ui.statusBadge(job) + ui.fieldBadge(job) + ui.newDeptBadge(job) + ui.newBadge(job) + ui.sourceBadge(job.source) +
                (job.payScale ? '<span class="badge badge-neutral">' + esc(job.payScale) + "</span>" : "") +
                (job.posts ? '<span class="badge badge-neutral">' + esc(u.plural(job.posts, "post")) + "</span>" : "") +
                ui.daysLeft(job) +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
      "</section>" +
      '<div class="container details-layout">' +
        '<div class="details-main">' + main + "</div>" +
        '<aside class="details-aside">' + aside + "</aside>" +
      "</div>" +
      '<div class="mobile-apply-bar">' +
        '<a class="btn btn-primary" href="' + esc(job.applyUrl) + '" target="_blank" rel="noopener noreferrer">Apply on ' + esc(job.source) + "</a>" +
        (job.advertisementUrl ? '<a class="btn btn-outline" href="' + esc(job.advertisementUrl) + '" target="_blank" rel="noopener noreferrer">Advertisement</a>' : "") +
      "</div>";

    document.body.classList.add("has-apply-bar");
    startCountdown(job);
    document.getElementById("copy-link").addEventListener("click", copyLink);
  }

  function startCountdown(job) {
    const el = document.getElementById("countdown");
    if (!job.closingDateObj) { el.innerHTML = '<div style="grid-column:1/-1"><small>Deadline not stated</small></div>'; return; }
    const end = new Date(job.closingDateObj);
    end.setHours(23, 59, 59, 999);
    function tick() {
      const ms = end - Date.now();
      if (ms <= 0) {
        el.classList.add("is-closed");
        el.innerHTML = '<div style="grid-column:1/-1"><b>Closed</b><small>Applications no longer accepted</small></div>';
        return;
      }
      const d = Math.floor(ms / 86400000);
      const h = Math.floor((ms % 86400000) / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      el.innerHTML = "<div><b>" + d + "</b><small>Days</small></div><div><b>" + h + "</b><small>Hours</small></div><div><b>" + m + "</b><small>Mins</small></div>";
    }
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 30000);
  }
  let countdownTimer = null;

  function copyLink() {
    const url = window.location.href;
    const done = function () { ui.toast("Link copied to clipboard"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, fallback);
    } else fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { ui.toast("Could not copy link", "circle-x"); }
      ta.remove();
    }
  }

  function renderNotFound(message) {
    document.getElementById("details-root").innerHTML =
      '<div class="container" style="padding:56px 24px">' +
        ui.emptyState({
          icon: "file-question",
          title: "Job not found",
          text: message,
          actions: '<a class="btn btn-primary" href="index.html">' + ui.icon("arrow-left") + "Back to all jobs</a>"
        }) +
      "</div>";
  }

  HN.pages.details = function () {
    // Re-run on every data refresh: the job may have been updated or removed at the source
    HN.pageRefresh = HN.pages.details;
    if (!u.hasData) {
      renderNotFound("Job data hasn't been fetched yet. Press Refresh, or run <code>python scraper/fetch_jobs.py</code> locally.");
      return;
    }
    const job = u.job(u.getParams().get("id"));
    if (!job) {
      renderNotFound("This advertisement is no longer listed on the official website, or the link is incorrect.");
      return;
    }
    render(job);
    ui.setActiveNav(job.group === "healthcare" ? "health" : "jobs");
  };
})(window.HN = window.HN || {});
