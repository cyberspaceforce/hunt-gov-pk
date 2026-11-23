/* ==========================================================================
   Hunt Gov Pk — Live refresh
   --------------------------------------------------------------------------
   When the site is served over http(s) (e.g. on Vercel), jobs are refreshed
   from the serverless function /api/source?id=<SOURCE>, one request per
   source, all in parallel. It runs:
     - once when a visitor first opens the site (once per browser tab session,
       so moving between pages doesn't refetch everything), and
     - whenever the user clicks the refresh icon next to "Updated … ago".

   Opened directly from disk (file://) there is no server to fetch through, so
   the button explains how to start the local server (start.bat / serve.py).

   Events dispatched on window:
     hn:refresh-start  { total }
     hn:refresh-progress { done, total, id, ok }
     hn:refresh-end    { ok, failed: [ids], changed }
     hn:data           (new data has been applied - pages re-render)
   ========================================================================== */
(function (HN) {
  "use strict";

  const u = HN.utils;
  // Generous: a source can take ~30-60 s (Vercel stops functions at 60 s anyway).
  const REQUEST_TIMEOUT_MS = 120 * 1000;
  const API = "api/source";

  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }

  function fetchJson(url, timeoutMs) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || REQUEST_TIMEOUT_MS);
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
    _apiCheck: null,

    /**
     * Is the Python API (/api/source) available here? True on Vercel and with
     * start.bat / serve.py; false on static-only servers such as VS Code Live
     * Server or file://. Checked once per page.
     */
    hasApi() {
      if (!live.enabled) return Promise.resolve(false);
      if (!live._apiCheck) {
        live._apiCheck = fetchJson(API, 8000)
          .then(function (r) { return !!(r && r.sources); })
          .catch(function () { return false; });
      }
      return live._apiCheck;
    },

    /**
     * Refresh every source. force=true bypasses the 5-minute CDN cache
     * (at most one fresh fetch per source per minute). silent=true: no toast.
     */
    refresh(force, silent) {
      if (!live.enabled) return Promise.resolve(null);   // file:// - no server to fetch through
      if (live.busy) return Promise.resolve();
      live.busy = true;

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
        result.silent = !!silent;
        live.busy = false;
        emit("hn:refresh-end", result);
        return result;
      });
    },

    /** First visit in this tab session: fetch fresh jobs automatically (no toast). */
    refreshOnFirstLoad() {
      if (!live.enabled) return;
      const KEY = "huntgovpk.loadedThisSession";
      try { if (sessionStorage.getItem(KEY)) return; } catch (e) { /* storage blocked: just refresh */ }
      live.hasApi().then(function (ok) {
        if (!ok) return;   // static server (e.g. Live Server): keep the saved data quietly
        // Mark done only after it finishes, so leaving the page mid-refresh retries on the next page.
        live.refresh(true, true).then(function (r) {
          if (r && r.ok) { try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* ignore */ } }
        });
      });
    }
  };

  HN.live = live;
})(window.HN = window.HN || {});
