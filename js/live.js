/* ==========================================================================
   Hunt Gov Pk — Live refresh
   --------------------------------------------------------------------------
   When the site is served over http(s) (e.g. on Vercel), jobs are refreshed
   from the serverless function /api/source?id=<SOURCE>, one request per
   source, all in parallel:

     - manually, with the Refresh button in the header (forces fresh data)
     - automatically every 5 minutes while the tab is open (uses the CDN's
       5-minute cache, so visitors share one fetch per source)

   Opened directly from disk (file://) there is no server, so the button just
   reloads the page to pick up a newly generated data/jobs.js.

   Events dispatched on window:
     hn:refresh-start  { total }
     hn:refresh-progress { done, total, id, ok }
     hn:refresh-end    { ok, failed: [ids], changed }
     hn:data           (new data has been applied - pages re-render)
   ========================================================================== */
(function (HN) {
  "use strict";

  const u = HN.utils;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 75 * 1000;
  const API = "api/source";

  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }

  function fetchJson(url) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } })
      .then(function (res) {
        const type = res.headers.get("content-type") || "";
        if (!res.ok || type.indexOf("application/json") === -1) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  /** Replace one source's jobs, ads and status inside a payload copy. */
  function mergeBlock(payload, block) {
    const id = block.id;
    payload.jobs = payload.jobs.filter(function (j) { return j.source !== id; }).concat(block.jobs || []);
    payload.advertisements = payload.advertisements.filter(function (a) { return a.source !== id; }).concat(block.ads || []);
    const status = {};
    Object.keys(block).forEach(function (k) { if (k !== "jobs" && k !== "ads") status[k] = block[k]; });
    status.jobs = (block.jobs || []).length;
    status.ads = (block.ads || []).length;
    const i = payload.sources.findIndex(function (s) { return s.id === id; });
    if (i === -1) payload.sources.push(status); else payload.sources[i] = status;
  }

  const live = {
    enabled: /^https?:$/.test(window.location.protocol),
    busy: false,
    lastRun: 0,

    /**
     * Refresh every source. force=true bypasses the 5-minute CDN cache
     * (at most one fresh fetch per source per minute).
     */
    refresh(force) {
      if (!live.enabled) { window.location.reload(); return Promise.resolve(); }
      if (live.busy) return Promise.resolve();
      live.busy = true;
      live.lastRun = Date.now();

      const base = u.data || { sources: [], jobs: [], advertisements: [], newDepartments: [] };
      const next = {
        generatedAt: base.generatedAt,
        sources: (base.sources || []).slice(),
        newDepartments: base.newDepartments || [],
        jobs: (base.jobs || []).slice(),
        advertisements: (base.advertisements || []).slice()
      };

      // Source list: from current data, or ask the API if we have none yet
      const ids = next.sources.map(function (s) { return s.id; });
      const listPromise = ids.length
        ? Promise.resolve(ids)
        : fetchJson(API).then(function (r) {
            next.newDepartments = r.newDepartments || [];
            return r.sources.map(function (s) { return s.id; });
          });

      return listPromise.then(function (sourceIds) {
        const total = sourceIds.length;
        const bucket = force ? "&m=" + Math.floor(Date.now() / 60000) : "";
        let done = 0;
        const failed = [];
        let okCount = 0;
        let newest = 0;
        emit("hn:refresh-start", { total: total });

        return Promise.all(sourceIds.map(function (id) {
          return fetchJson(API + "?id=" + encodeURIComponent(id) + bucket)
            .then(function (block) {
              mergeBlock(next, block);
              if (block.ok) {
                okCount++;
                newest = Math.max(newest, new Date(block.checkedAt).getTime() || 0);
              } else {
                failed.push(id);
              }
            })
            .catch(function () { failed.push(id); })
            .then(function () {
              done++;
              emit("hn:refresh-progress", { done: done, total: total, id: id, ok: failed.indexOf(id) === -1 });
            });
        })).then(function () {
          if (okCount) {
            next.generatedAt = new Date(newest || Date.now()).toISOString();
            u.setData(next);
            u.saveCache(next);
            emit("hn:data");
          }
          return { ok: okCount, failed: failed, total: total };
        });
      }).catch(function () {
        return { ok: 0, failed: ["all"], total: 0 };
      }).then(function (result) {
        result.manual = !!force;
        live.busy = false;
        emit("hn:refresh-end", result);
        return result;
      });
    },

    /** Auto-refresh loop: every 5 minutes while the tab is visible. */
    start() {
      if (!live.enabled) return;
      const age = Date.now() - (u.data && u.data.generatedAt ? new Date(u.data.generatedAt).getTime() : 0);
      live.lastRun = age < AUTO_REFRESH_MS ? Date.now() - age : 0;

      function tick() {
        if (document.visibilityState === "visible" && Date.now() - live.lastRun >= AUTO_REFRESH_MS) {
          live.refresh(false);
        }
      }
      setInterval(tick, 30 * 1000);
      document.addEventListener("visibilitychange", tick);
      tick();
    },

    nextAutoIn() {
      return Math.max(0, AUTO_REFRESH_MS - (Date.now() - live.lastRun));
    }
  };

  HN.live = live;
})(window.HN = window.HN || {});
