#!/usr/bin/env python3
"""
Local preview server that behaves like the Vercel deployment.

    python serve.py            # http://localhost:8000
    python serve.py 3000       # custom port

- Serves the static site (index.html, css/, js/, data/ ...)
- Runs api/source.py for /api/source?id=... exactly as Vercel does
- Imitates Vercel's CDN cache: successful API responses are reused for 5 minutes
  (unless the URL differs, e.g. the Refresh button's "&m=<minute>" parameter)

Not deployed (listed in .vercelignore).
"""
import importlib.util
import io
import os
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

spec = importlib.util.spec_from_file_location("api_source", os.path.join(ROOT, "api", "source.py"))
api_source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api_source)

CDN_TTL = 300
_cache = {}  # path -> (expires_at, status_line_and_headers, body)


class DevHandler(api_source.handler, SimpleHTTPRequestHandler):
    def do_GET(self):
        if not self.path.startswith("/api/source"):
            return SimpleHTTPRequestHandler.do_GET(self)

        hit = _cache.get(self.path)
        if hit and hit[0] > time.time():
            self.wfile.write(hit[1])
            self.log_message("CDN cache HIT %s", self.path)
            return

        # Run the real function, capturing its output so we can cache it
        real = self.wfile
        buf = io.BytesIO()
        self.wfile = buf
        try:
            api_source.handler.do_GET(self)
        finally:
            self.wfile = real
        raw = buf.getvalue()
        real.write(raw)
        if b"s-maxage=300" in raw.split(b"\r\n\r\n", 1)[0]:
            _cache[self.path] = (time.time() + CDN_TTL, raw)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), DevHandler)
    print("Hunt Gov Pk preview on http://localhost:%d  (Ctrl+C to stop)" % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
