/* ==========================================================================
   Hunt Gov Pk — Shared UI components
   ========================================================================== */
(function (HN) {
  "use strict";

  const u = HN.utils;
  const esc = u.escapeHtml;

  const BRAND_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/><path d="m7.8 10.6 1.9 1.9 3.6-3.8"/></svg>';

  const GITHUB_URL = "https://github.com/cyberspaceforce";
  const GITHUB_SVG =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

  /** Icon-only link to the Cyberspace Force GitHub profile. */
  function githubLink(cls) {
    return '<a class="' + cls + '" href="' + GITHUB_URL + '" target="_blank" rel="noopener" title="Cyberspace Force on GitHub" aria-label="Cyberspace Force on GitHub">' + GITHUB_SVG + "</a>";
  }

  function openCount(list) {
    return list.filter(function (j) { return u.getStatus(j).key !== "closed"; }).length;
  }

  const ui = {
    icon(name, cls) {
      return '<i data-lucide="' + name + '"' + (cls ? ' class="' + cls + '"' : "") + ' aria-hidden="true"></i>';
    },

    setActiveNav(id) {
      document.querySelectorAll(".main-nav a").forEach(function (a) {
        const active = a.getAttribute("href") === { jobs: "index.html", health: "healthcare.html", ads: "advertisements.html" }[id];
        a.classList.toggle("is-active", active);
        if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      });
    },

    refreshIcons() {
      if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
    },

    /* ---------------------------------------------------------- Chrome */
    navCounts() {
      return { jobs: openCount(u.govJobs), health: openCount(u.healthJobs), ads: u.ads.length };
    },

    updatedText() {
      return u.data ? "Updated " + u.relativeTime(u.data.generatedAt) : "No data yet";
    },

    /** Refresh header numbers and "Updated …" text in place (keeps button state). */
    updateHeader() {
      const counts = ui.navCounts();
      document.querySelectorAll("[data-nav-count]").forEach(function (el) {
        el.textContent = counts[el.getAttribute("data-nav-count")];
      });
      const meta = document.querySelector("[data-updated]");
      if (meta && !(HN.live && HN.live.busy)) meta.textContent = ui.updatedText();
    },

    header(active) {
      const counts = ui.navCounts();
      const liveOn = HN.live && HN.live.enabled;
      const nav = [
        { id: "jobs", href: "index.html", label: "Government Jobs" },
        { id: "health", href: "healthcare.html", label: "Healthcare" },
        { id: "ads", href: "advertisements.html", label: "Advertisements" }
      ].map(function (n) {
        return '<a href="' + n.href + '"' + (n.id === active ? ' class="is-active" aria-current="page"' : "") + ">" +
          n.label + '<span class="nav-count" data-nav-count="' + n.id + '">' + counts[n.id] + "</span></a>";
      }).join("");
      const updated =
        '<button type="button" class="refresh-btn" data-refresh title="' +
          (liveOn ? "Fetch the latest jobs from all official sources" : "Reload data from data/jobs.js") + '">' +
          ui.icon("refresh-cw") + '<span class="refresh-btn__label" data-updated>' + ui.updatedText() + "</span></button>" +
        githubLink("github-link github-link--header");
      return (
        '<header class="site-header">' +
          '<div class="container">' +
            '<a class="brand" href="index.html" aria-label="Hunt Gov Pk home">' +
              '<span class="brand-mark">' + BRAND_SVG + "</span>" +
              "<span>Hunt Gov <em>Pk</em><small>Government Jobs · Pakistan</small></span>" +
            "</a>" +
            '<nav class="main-nav" aria-label="Main">' + nav + "</nav>" +
            '<div class="header-actions">' + updated + "</div>" +
          "</div>" +
        "</header>"
      );
    },

    footer() {
      return (
        '<footer class="site-footer">' +
          '<div class="container footer-bottom">' +
            '<div class="footer-text">' +
              "<span>Hunt Gov Pk collects advertisements from official recruitment websites. Always confirm details on the official advertisement before applying.</span>" +
              "<span>Not affiliated with any government body.</span>" +
            "</div>" +
            githubLink("github-link github-link--footer") +
          "</div>" +
        "</footer>"
      );
    },

    /* ----------------------------------------------------------- Atoms */
    orgLogo(name, size) {
      const c = u.orgColor(name);
      return '<span class="org-logo' + (size ? " org-logo--" + size : "") + '" style="background:' + c.bg + ";color:" + c.fg + '" aria-hidden="true">' +
        esc(u.monogram(name)) + "</span>";
    },

    statusBadge(job) {
      const s = u.getStatus(job);
      const cls = { open: "badge-open", closing: "badge-closing", closed: "badge-closed" }[s.key];
      return '<span class="badge badge-dot ' + cls + '">' + s.label + "</span>";
    },

    newBadge(job) {
      return u.isNew(job) && u.getStatus(job).key !== "closed" ? '<span class="badge badge-new">New</span>' : "";
    },

    /** Highlight for recently created departments (NCCIA, Federal Constabulary, ...). */
    newDeptBadge(item) {
      return item.newDepartment
        ? '<span class="badge badge-newdept" title="' + esc(item.newDepartment) + '">' + ui.icon("sparkles") + "New department</span>"
        : "";
    },

    fieldBadge(job) {
      if (!job.field && job.itJob) return '<span class="badge badge-field badge-field--it">Computer Science &amp; IT</span>';
      if (!job.field) return "";
      return '<span class="badge badge-field badge-field--' + esc(job.field) + '">' + esc(job.fieldLabel) + "</span>";
    },

    sourceBadge(source) {
      return '<span class="badge badge-source">' + esc(source) + "</span>";
    },

    daysLeft(job) {
      const s = u.getStatus(job);
      return '<span class="days-left ' + u.urgencyClass(s.daysLeft) + '">' + ui.icon(s.key === "closed" ? "circle-x" : "clock") + u.daysLeftText(s.daysLeft) + "</span>";
    },

    /* -------------------------------------------------------- Job card */
    jobCard(job, query) {
      const s = u.getStatus(job);
      const meta = [
        u.hasValue(job.payScale) && ["layers", esc(job.payScale)],
        u.hasValue(job.salary) && ["wallet", "Rs. " + esc(job.salary)],
        u.hasValue(job.employmentType) && ["file-signature", esc(job.employmentType)],
        u.hasValue(job.posts) && ["users", esc(u.plural(job.posts, "post"))],
        u.hasValue(job.hospitalDept) && ["stethoscope", esc(job.hospitalDept)],
        u.hasValue(job.region) && ["map-pin", esc(job.region)],
        u.hasValue(job.experience) && job.group === "healthcare" && ["briefcase", esc(job.experience)],
        u.hasValue(job.testType) && ["clipboard-list", esc(job.testType)],
        u.hasValue(job.adNo) && ["file-text", "Ad No. " + esc(job.adNo)],
        u.hasValue(job.projectCode) && ["hash", "Code " + esc(job.projectCode)],
        u.hasValue(job.fee) && ["receipt", "Fee Rs. " + esc(job.fee)]
      ].filter(Boolean);
      return (
        '<article class="job-card' + (s.key === "closed" ? " is-closed" : "") + '">' +
          '<div class="job-card__head">' +
            ui.orgLogo(job.department) +
            '<div class="job-card__heading">' +
              '<a class="job-card__title" href="' + u.jobUrl(job) + '">' + u.highlight(esc(job.title), query) + "</a>" +
              '<div class="job-card__org"><strong>' + u.highlight(esc(job.department), query) + "</strong>" +
                '<span aria-hidden="true">·</span><span>via ' + esc(job.source) + "</span></div>" +
            "</div>" +
            '<div class="job-card__badges">' + ui.fieldBadge(job) + ui.newDeptBadge(job) + ui.newBadge(job) + ui.statusBadge(job) + "</div>" +
          "</div>" +
          '<div class="job-card__meta">' + meta.map(function (m) { return "<span>" + ui.icon(m[0]) + m[1] + "</span>"; }).join("") + "</div>" +
          '<div class="job-card__foot">' +
            '<div class="job-card__dates">' +
              (job.adDateObj ? "<span>Advertised <b>" + u.formatDate(job.adDateObj) + "</b></span>" : "") +
              "<span>Last date <b>" + u.formatDate(job.closingDateObj) + "</b></span>" +
              ui.daysLeft(job) +
            "</div>" +
            '<div class="job-card__actions"><a class="btn btn-outline btn-sm" href="' + u.jobUrl(job) + '">View details ' + ui.icon("arrow-right") + "</a></div>" +
          "</div>" +
        "</article>"
      );
    },

    /* ------------------------------------------------- Advertisement row */
    adCard(ad, query) {
      const icon = { pdf: "file-text", image: "image", page: "external-link" }[ad.type] || "file";
      const action = { pdf: "Open PDF", image: "View image", page: "Open on " + ad.source }[ad.type] || "Open";
      const typeLabel = { pdf: "PDF", image: "Image", page: "Web page" }[ad.type] || "File";
      return (
        '<article class="ad-card">' +
          '<div class="ad-card__icon ad-card__icon--' + esc(ad.type) + '">' + ui.icon(icon) + "</div>" +
          '<div class="ad-card__body">' +
            '<a class="ad-card__title" href="' + esc(ad.url) + '" target="_blank" rel="noopener noreferrer">' + u.highlight(esc(ad.title), query) + "</a>" +
            '<div class="ad-card__meta">' +
              ui.sourceBadge(ad.source) +
              "<span>" + u.highlight(esc(ad.organization), query) + "</span>" +
              (ad.adNo ? "<span>No. " + esc(ad.adNo) + "</span>" : "") +
              "<span>" + (ad.dateObj ? esc(u.formatDate(ad.dateObj)) : "Date not stated") + "</span>" +
              "<span>" + typeLabel + "</span>" +
              ui.newDeptBadge(ad) +
            "</div>" +
            (ad.note ? '<p class="ad-card__note">' + esc(ad.note) + "</p>" : "") +
          "</div>" +
          '<a class="btn btn-outline btn-sm ad-card__action" href="' + esc(ad.url) + '" target="_blank" rel="noopener noreferrer">' +
            action + " " + ui.icon("arrow-up-right") + "</a>" +
        "</article>"
      );
    },

    emptyState(o) {
      return (
        '<div class="empty-state">' +
          '<div class="empty-state__icon">' + ui.icon(o.icon || "inbox") + "</div>" +
          "<h3>" + o.title + "</h3>" +
          "<p>" + o.text + "</p>" +
          (o.actions ? '<div class="empty-state__actions">' + o.actions + "</div>" : "") +
        "</div>"
      );
    },

    toast(message, icon) {
      let region = document.querySelector(".toast-region");
      if (!region) {
        region = document.createElement("div");
        region.className = "toast-region";
        region.setAttribute("role", "status");
        region.setAttribute("aria-live", "polite");
        document.body.appendChild(region);
      }
      const el = document.createElement("div");
      el.className = "toast";
      el.innerHTML = ui.icon(icon || "circle-check") + "<span>" + message + "</span>";
      region.appendChild(el);
      ui.refreshIcons();
      setTimeout(function () {
        el.classList.add("is-leaving");
        setTimeout(function () { el.remove(); }, 200);
      }, 2600);
    }
  };

  HN.ui = ui;
})(window.HN = window.HN || {});
