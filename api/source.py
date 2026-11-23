"""
Vercel serverless function: live data for ONE source.

    GET /api/source            -> list of sources + new-department watch list
    GET /api/source?id=PPSC    -> {"id", "ok", "checkedAt", "jobs": [...], "ads": [...], ...}

The browser calls this once per source (in parallel) when the user presses
Refresh, and automatically every 5 minutes. Responses are cached on Vercel's
CDN for 5 minutes (s-maxage=300), so many visitors share one fetch and the
government websites are not hit on every page view.

The scraping logic lives in scraper/fetch_jobs.py (bundled via vercel.json
"includeFiles"), so the CLI and the website always use the same code.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scraper"))

import fetch_jobs  # noqa: E402

# Fresh data is served from the CDN for 5 minutes, then refreshed in the background.
CACHE_OK = "public, max-age=0, s-maxage=300, stale-while-revalidate=600"
# Failed fetches (site down) are cached briefly so we retry soon.
CACHE_FAILED = "public, max-age=0, s-maxage=60"


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload, cache):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        source_id = (query.get("id") or [""])[0].strip().upper()

        if not source_id:
            self._send(200, {
                "sources": [{"id": s["id"], "name": s["name"], "url": s["url"],
                             "group": s.get("group", "government")} for s in fetch_jobs.SOURCES],
                "newDepartments": [{"name": d["name"], "est": d["est"], "website": d["website"]}
                                   for d in fetch_jobs.NEW_DEPARTMENTS],
            }, CACHE_OK)
            return

        if not fetch_jobs.source_by_id(source_id):
            self._send(404, {"error": "Unknown source", "id": source_id}, CACHE_FAILED)
            return

        try:
            block = fetch_jobs.fetch_source(source_id)
        except Exception as exc:  # last-resort guard - never return an HTML error page
            self._send(500, {"id": source_id, "ok": False, "error": str(exc), "jobs": [], "ads": []}, CACHE_FAILED)
            return
        self._send(200, block, CACHE_OK if block.get("ok") else CACHE_FAILED)
