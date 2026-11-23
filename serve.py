#!/usr/bin/env python3
"""
Local preview server that behaves like the Vercel deployment.

    python serve.py                 # http://localhost:8000 (opens your browser)
    python serve.py 3000            # custom port
    python serve.py --no-browser    # don't open a browser tab
    (or double-click start.bat on Windows)

Needs only Python 3.8+ - no packages to install.

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
import threading
import time
import webbrowser
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


class Server(ThreadingHTTPServer):
    # On Windows, SO_REUSEADDR lets two servers share a port silently - turn it off
    # so a busy port is detected and the next free one is used instead.
    allow_reuse_address = os.name != "nt"
    allow_reuse_port = False
    daemon_threads = True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    open_browser = "--no-browser" not in sys.argv
    port = int(args[0]) if args else 8000

    server = None
    for candidate in range(port, port + 20):          # port busy? try the next one
        try:
            server = Server(("127.0.0.1", candidate), DevHandler)
            port = candidate
            break
        except OSError:
            continue
    if server is None:
        sys.exit("No free port between %d and %d." % (port, port + 19))

    base = "http://localhost:%d/" % port
    url = base + "index.html"
    rows = [
        ("Government jobs", base + "index.html"),
        ("Healthcare jobs", base + "healthcare.html"),
        ("Advertisements", base + "advertisements.html"),
        ("Python API", base + "api/source  (live data, e.g. " + base + "api/source?id=BPSC)"),
    ]
    print("", flush=True)
    print("  Hunt Gov Pk is running  (web server + Python API on one port)")
    print("")
    for label, link in rows:
        print("  %-16s %s" % (label, link))
    print("")
    print("  Jobs refresh live from all 8 official sources (refresh icon, top right).")
    print("  Press Ctrl+C to stop.", flush=True)
    print("", flush=True)
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")


if __name__ == "__main__":
    main()
