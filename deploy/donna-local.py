#!/usr/bin/env python3
"""Run Aunt Donna's Wall locally with real Jev and Deepgram.

Does what the Caddyfile does in production: serves the site and adds the
API keys to /donna/api/* calls. Keys come from an env file with
TYPESAFE_API_KEY= and DEEPGRAM_API_KEY= lines (default ~/src/.donna.env).

    python3 deploy/donna-local.py [env-file]   then open http://localhost:8787/donna/
"""
import os
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8787
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else "~/src/.donna.env")

KEYS = {}
with open(ENV_FILE) as f:
    for line in f:
        name, sep, value = line.strip().partition("=")
        if sep and not name.startswith("#"):
            KEYS[name.strip()] = value.strip().strip("'\"")


def key(name):
    if not KEYS.get(name):
        sys.exit(f"{name} is missing from {ENV_FILE}")
    return KEYS[name]


ROUTES = {
    "/donna/api/jev": ("https://api.typesafe.ai/v1/systemone", "Bearer", key("TYPESAFE_API_KEY")),
    "/donna/api/stt-token": ("https://api.deepgram.com/v1/auth/grant", "Token", key("DEEPGRAM_API_KEY")),
}


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        route = ROUTES.get(self.path)
        if not route:
            self.send_error(404)
            return
        url, scheme, secret = route
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": f"{scheme} {secret}",
            "Content-Type": self.headers.get("Content-Type") or "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                status, data = res.status, res.read()
        except urllib.error.HTTPError as err:
            status, data = err.code, err.read()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=ROOT))
    print(f"http://localhost:{PORT}/donna/")
    server.serve_forever()
