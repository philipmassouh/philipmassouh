#!/usr/bin/env python3
"""Load the ug-tabs.7z dump into one SQLite file.

The archive holds ~1M small .txt tabs (ug-tabs/<Category>/<Artist>-<id>/<Song>.txt),
so it is never unpacked: bsdtar re-streams it as tar on stdout and each member
is parsed in memory. Bodies are zlib-compressed. Every version is kept; `best`
marks the most-voted version of each song per category.

The tabs_text view decompresses bodies with the sqlite3 shell's sqlar_uncompress,
so plain `sqlite3 ug-tabs.db "SELECT body FROM tabs_text ..."` works. Other
clients need to zlib-decompress tabs.body themselves.

    python3 tabs/build_db.py ~/Downloads/ug-tabs.7z ~/Downloads/ug-tabs.db
    python3 tabs/build_db.py ~/Downloads/ug-tabs.7z /tmp/t.db --include 'ug-tabs/Drums/*'

The database is the dataset, not site content: keep it out of the repo.
"""
import argparse
import os
import re
import sqlite3
import subprocess
import sys
import tarfile
import time
import zlib

SCHEMA = """
CREATE TABLE tabs (
    id INTEGER PRIMARY KEY,
    ug_id INTEGER,
    song_id INTEGER,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    artist_id INTEGER,
    category TEXT NOT NULL,
    type TEXT,
    rating REAL,
    votes INTEGER,
    date INTEGER,
    tonality TEXT,
    difficulty TEXT,
    tuning TEXT,
    author TEXT,
    verified INTEGER,
    version INTEGER,
    best INTEGER NOT NULL DEFAULT 0,
    url TEXT,
    path TEXT NOT NULL UNIQUE,
    body BLOB NOT NULL,
    size INTEGER NOT NULL
);
CREATE VIRTUAL TABLE tabs_fts USING fts5(title, artist, content='tabs', content_rowid='id');
"""

INDEXES = """
CREATE INDEX tabs_artist ON tabs(artist_id, category);
CREATE INDEX tabs_song ON tabs(song_id, category);
CREATE INDEX tabs_best ON tabs(category, best);
CREATE VIEW tabs_text AS
    SELECT id, ug_id, song_id, title, artist, artist_id, category, type, rating, votes,
           date, tonality, difficulty, tuning, author, verified, version, best, url, path,
           sqlar_uncompress(body, size) AS body
    FROM tabs;
"""

LINKED = re.compile(r"^(.*) \[(\d+)\]: (\S+)$")
FIELD = re.compile(r"^([A-Za-z ]+): ?(.*)$")
COLUMNS = ("ug_id", "song_id", "title", "artist", "artist_id", "category", "type", "rating",
           "votes", "date", "tonality", "difficulty", "tuning", "author", "verified",
           "version", "url", "path", "body", "size")
INSERT = f"INSERT INTO tabs ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})"


def num(s, kind=int):
    try:
        return kind(s)
    except (TypeError, ValueError):
        return None


def parse(path, text):
    """Return a row tuple, or raise ValueError if the 11-line header is off."""
    lines = text.split("\n")
    if len(lines) < 11:
        raise ValueError("short header")
    title = LINKED.match(lines[0])
    by = LINKED.match(lines[1])
    if not title or not by or not by.group(1).startswith("By "):
        raise ValueError("bad title/artist line")
    fields = {}
    for line in lines[2:10]:
        m = FIELD.match(line)
        if not m:
            raise ValueError(f"bad field line {line[:40]!r}")
        fields[m.group(1)] = m.group(2).strip()
    rating, _, votes = fields.get("Rating", "").partition(", Votes: ")
    version = re.match(r"^Version (\d+)$", lines[10])
    if not version:
        raise ValueError("bad version line")
    url = title.group(3)
    ug_id = re.search(r"[-/](\d+)$", url)
    author = re.sub(r" \[\d+\].*$", "", fields.get("Tab By", "")) or None
    body = "\n".join(lines[11:]).strip("\n").encode("utf-8")
    return (
        num(ug_id.group(1)) if ug_id else None,
        num(title.group(2)),
        title.group(1),
        by.group(1)[3:],
        num(by.group(2)),
        path.split("/")[1],
        fields.get("Type") or None,
        num(rating, float),
        num(votes),
        num(fields.get("Date")),
        fields.get("Tonality") or None,
        fields.get("Difficulty") or None,
        fields.get("Tuning") or None,
        author,
        num(fields.get("Verified")),
        num(version.group(1)),
        url,
        path,
        zlib.compress(body, 6),
        len(body),
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("archive")
    ap.add_argument("db")
    ap.add_argument("--include", help="bsdtar --include glob, e.g. 'ug-tabs/Tab/Metallica-*'")
    args = ap.parse_args()

    tmp = args.db + ".partial"
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;" + SCHEMA)

    cmd = ["bsdtar", "-cf", "-", "--format=pax"]
    if args.include:
        cmd += ["--include", args.include]
    cmd.append("@" + args.archive)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)

    start = time.time()
    loaded, skipped, batch = 0, [], []
    with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
        for member in tf:
            if not member.isfile():
                continue
            text = tf.extractfile(member).read().decode("utf-8", "replace")
            try:
                batch.append(parse(member.name, text))
            except ValueError as e:
                skipped.append((member.name, str(e)))
                continue
            if len(batch) >= 5000:
                db.executemany(INSERT, batch)
                loaded += len(batch)
                batch.clear()
                if loaded % 50000 == 0:
                    print(f"{loaded:>9,} tabs  {time.time() - start:6.0f}s", flush=True)
    db.executemany(INSERT, batch)
    loaded += len(batch)
    if proc.wait() != 0:
        sys.exit(f"bsdtar exited {proc.returncode}; left {tmp} for inspection")

    print("indexing", flush=True)
    db.executescript(INDEXES + """
        UPDATE tabs SET best = 1 WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY category, artist_id, song_id
                    ORDER BY votes DESC, rating DESC, version DESC) AS r
                FROM tabs)
            WHERE r = 1);
        INSERT INTO tabs_fts(tabs_fts) VALUES ('rebuild');
    """)
    db.commit()
    db.close()
    os.replace(tmp, args.db)

    print(f"loaded {loaded:,}, skipped {len(skipped):,} in {time.time() - start:.0f}s -> {args.db}")
    for name, why in skipped[:20]:
        print(f"  skipped {name}: {why}")


if __name__ == "__main__":
    main()
