#!/usr/bin/env python3
"""JSON API over the tabs SQLite file built by build_db.py.

In production Caddy serves the static page and proxies /tabs/api/* here. For
local work this also serves the page itself:

    TABS_DB=~/Downloads/tabs.db python3 tabs/server.py
    open http://localhost:8710/tabs/

Routes (all GET, all JSON). Songs come best-ranked first, each with the id of
its best tab per type:
    /tabs/api/search?q=&type=&limit=
    /tabs/api/artist/<id>?type=
    /tabs/api/tab/<id>        body, its song, and the song's other versions
"""
import json
import os
import re
import sqlite3
import threading
import zlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

DB = os.path.expanduser(os.environ.get("TABS_DB", "~/Downloads/tabs.db"))
HOST = os.environ.get("TABS_HOST", "127.0.0.1")
PORT = int(os.environ.get("TABS_PORT", "8710"))
ROOT = Path(__file__).resolve().parent.parent
TYPES = ("Chords", "Tab")

SONG_COLS = "songs.id, songs.title, artists.name AS artist, artists.id AS artist_id"

local = threading.local()


def db():
    if not hasattr(local, "db"):
        local.db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        local.db.row_factory = sqlite3.Row
    return local.db


def fts_query(q):
    """Turn free text into an FTS5 query: every word must match, the last as a prefix."""
    words = re.findall(r"\w+", q)
    if not words:
        return None
    terms = [f'"{w}"' for w in words]
    terms[-1] += "*"
    return " ".join(terms)


def type_arg(params):
    t = params.get("type", [""])[0]
    return t if t in TYPES else None


def best_tabs(song_ids):
    """{song_id: {type: tab_id}} for each song's best version of each type."""
    out = {i: {} for i in song_ids}
    if song_ids:
        marks = ",".join("?" * len(song_ids))
        for r in db().execute(
                f"SELECT song_id, type, id FROM tabs WHERE rank = 1 AND song_id IN ({marks})", song_ids):
            out[r["song_id"]][r["type"]] = r["id"]
    return {i: {t: by_type[t] for t in TYPES if t in by_type} for i, by_type in out.items()}


def with_tabs(rows):
    songs = [dict(r) for r in rows]
    tabs = best_tabs([s["id"] for s in songs])
    for s in songs:
        s["tabs"] = tabs[s["id"]]
    return songs


def has_type(t):
    return " AND EXISTS (SELECT 1 FROM tabs WHERE tabs.song_id = songs.id AND tabs.type = ?)" if t else ""


def search(params):
    match = fts_query(params.get("q", [""])[0])
    if not match:
        return []
    limit = min(int(params.get("limit", ["50"])[0] or 50), 200)
    t = type_arg(params)
    sql = (f"SELECT {SONG_COLS} FROM songs_fts "
           "JOIN songs ON songs.id = songs_fts.rowid JOIN artists ON artists.id = songs.artist_id "
           "WHERE songs_fts MATCH ?" + has_type(t) + " ORDER BY songs.rank LIMIT ?")
    return with_tabs(db().execute(sql, [match] + ([t] if t else []) + [limit]))


def artist(artist_id, params):
    row = db().execute("SELECT id, name FROM artists WHERE id = ?", (artist_id,)).fetchone()
    if not row:
        return None
    t = type_arg(params)
    sql = (f"SELECT {SONG_COLS} FROM songs JOIN artists ON artists.id = songs.artist_id "
           "WHERE songs.artist_id = ?" + has_type(t) + " ORDER BY songs.rank")
    return {**dict(row), "songs": with_tabs(db().execute(sql, [artist_id] + ([t] if t else [])))}


def tab(tab_id):
    row = db().execute(
        f"SELECT tabs.id, tabs.type, tabs.tonality, tabs.tuning, tabs.body, tabs.song_id, {SONG_COLS} "
        "FROM tabs JOIN songs ON songs.id = tabs.song_id JOIN artists ON artists.id = songs.artist_id "
        "WHERE tabs.id = ?", (tab_id,)).fetchone()
    if not row:
        return None
    out = dict(row)
    out["id"] = tab_id
    out["body"] = zlib.decompress(row["body"]).decode("utf-8")
    out["tabs"] = best_tabs([row["song_id"]])[row["song_id"]]
    out["versions"] = [r[0] for r in db().execute(
        "SELECT id FROM tabs WHERE song_id = ? AND type = ? ORDER BY rank",
        (row["song_id"], row["type"]))]
    return out


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        url = urlsplit(self.path)
        if not url.path.startswith("/tabs/api/"):
            # Local dev only; in production Caddy serves the static files.
            if url.path.endswith(".py"):
                return self.send_error(404)
            return super().do_GET()
        params = parse_qs(url.query)
        route = url.path[len("/tabs/api/"):]
        try:
            if route == "search":
                return self.json(search(params))
            if m := re.fullmatch(r"tab/(\d+)", route):
                return self.json(tab(int(m.group(1))))
            if m := re.fullmatch(r"artist/(\d+)", route):
                return self.json(artist(int(m.group(1)), params))
        except (ValueError, sqlite3.OperationalError) as e:
            return self.send_error(400, str(e))
        self.send_error(404)

    def json(self, data):
        if data is None:
            return self.send_error(404)
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    if not os.path.exists(DB):
        raise SystemExit(f"no database at {DB}; set TABS_DB")
    print(f"serving {DB} on http://{HOST}:{PORT}/tabs/")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
