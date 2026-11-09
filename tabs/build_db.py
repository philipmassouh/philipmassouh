#!/usr/bin/env python3
"""Load the ug-tabs.7z dump into one SQLite file.

The archive holds ~1M small .txt tabs (ug-tabs/<Type>/<Artist>-<id>/<Song>.txt),
so it is never unpacked: bsdtar re-streams it as tar on stdout and each member
is parsed in memory.

The result has our own ids and only what the site uses: artists, songs (one per
title, across types) and tabs (one per version). Ratings and votes are read
only to order things and are not kept:

    songs.rank  1 = best song overall
    tabs.rank   1 = best version of that song for its type

Both use a Bayesian average, (votes * rating + M * C) / (votes + M), where C is
the mean rating over all votes, so a 5.0 with three votes doesn't outrank a 4.8
with thousands. A song's votes and rating pool all of its versions, and songs
use a much heavier M: ratings cluster around 4.8, so with a light prior a B-side
with a hundred 4.9 votes would outrank a song with thousands.

    python3 tabs/build_db.py ~/Downloads/ug-tabs.7z ~/Downloads/ug-tabs.db
    python3 tabs/build_db.py ~/Downloads/ug-tabs.7z /tmp/t.db --include 'ug-tabs/Drums/*'

Bodies are zlib-compressed. The tabs_text view decompresses them with the
sqlite3 shell's sqlar_uncompress, so `sqlite3 ug-tabs.db "SELECT body FROM
tabs_text ..."` works; other clients zlib-decompress tabs.body themselves.

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

# Prior weights in votes. Versions: about the 90th percentile of votes per
# rated tab. Songs: enough that only well-voted songs move far from the mean.
M_TAB = 50
M_SONG = 2000

RAW = """
CREATE TABLE raw (
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    ug_song_id INTEGER,
    title TEXT NOT NULL,
    ug_artist_id INTEGER,
    artist TEXT NOT NULL,
    rating REAL NOT NULL,
    votes INTEGER NOT NULL,
    tonality TEXT,
    tuning TEXT,
    body BLOB NOT NULL,
    size INTEGER NOT NULL
);
"""

SCHEMA = """
CREATE TABLE artists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    artist_id INTEGER NOT NULL REFERENCES artists(id),
    title TEXT NOT NULL,
    rank INTEGER NOT NULL
);
CREATE TABLE tabs (
    id INTEGER PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id),
    type TEXT NOT NULL,
    rank INTEGER NOT NULL,
    tonality TEXT,
    tuning TEXT,
    body BLOB NOT NULL,
    size INTEGER NOT NULL
);
CREATE INDEX songs_artist ON songs(artist_id, rank);
CREATE INDEX songs_rank ON songs(rank);
CREATE INDEX tabs_song ON tabs(song_id, type, rank);
CREATE VIRTUAL TABLE songs_fts USING fts5(title, artist);
CREATE VIEW tabs_text AS
    SELECT tabs.id, songs.title, artists.name AS artist, tabs.type, tabs.rank,
           songs.rank AS song_rank, tabs.tonality, tabs.tuning, tabs.song_id,
           songs.artist_id, sqlar_uncompress(tabs.body, tabs.size) AS body
    FROM tabs JOIN songs ON songs.id = tabs.song_id JOIN artists ON artists.id = songs.artist_id;
"""

# Ids are assigned in a fixed order (names, then paths), so rebuilding from the
# same archive gives the same ids and links keep working.
DERIVE = """
CREATE TEMP TABLE prior AS
    SELECT sum(rating * votes) / sum(votes) AS c FROM raw WHERE votes > 0;

CREATE TEMP TABLE artist_map AS
    SELECT ug_artist_id AS ug,
           row_number() OVER (ORDER BY min(artist) COLLATE NOCASE, ug_artist_id) AS id,
           min(artist) AS name
    FROM raw GROUP BY ug_artist_id;

CREATE TEMP TABLE scored AS
    SELECT rowid AS raw_id, ug_artist_id, ug_song_id, path, type, title,
           (votes * rating + :m_tab * (SELECT c FROM prior)) / (votes + :m_tab) AS score,
           votes * rating AS weighted, votes
    FROM raw;

-- The song's title is its best version's; max() picks that row's title.
CREATE TEMP TABLE song_agg AS
    SELECT ug_artist_id, ug_song_id, title, max(score) AS top,
           (sum(weighted) + :m_song * (SELECT c FROM prior)) / (sum(votes) + :m_song) AS score
    FROM scored GROUP BY ug_artist_id, ug_song_id;

CREATE TEMP TABLE song_map AS
    SELECT s.ug_artist_id, s.ug_song_id, s.title, a.id AS artist_id,
           row_number() OVER (ORDER BY a.name COLLATE NOCASE, a.id, s.title COLLATE NOCASE, s.ug_song_id) AS id,
           row_number() OVER (ORDER BY s.score DESC, s.title, s.ug_song_id) AS rank
    FROM song_agg s JOIN artist_map a ON a.ug = s.ug_artist_id;

CREATE INDEX temp.song_map_ug ON song_map(ug_artist_id, ug_song_id);

INSERT INTO artists (id, name) SELECT id, name FROM artist_map;

INSERT INTO songs (id, artist_id, title, rank) SELECT id, artist_id, title, rank FROM song_map;

INSERT INTO tabs (id, song_id, type, rank, tonality, tuning, body, size)
    SELECT row_number() OVER (ORDER BY s.path),
           m.id, s.type,
           row_number() OVER (PARTITION BY m.id, s.type ORDER BY s.score DESC, s.path),
           r.tonality, r.tuning, r.body, r.size
    FROM scored s
    JOIN raw r ON r.rowid = s.raw_id
    JOIN song_map m ON m.ug_artist_id = s.ug_artist_id AND m.ug_song_id IS s.ug_song_id;

INSERT INTO songs_fts (rowid, title, artist)
    SELECT songs.id, songs.title, artists.name FROM songs JOIN artists ON artists.id = songs.artist_id;

DROP TABLE raw
"""

LINKED = re.compile(r"^(.*) \[(\d+)\]: (\S+)$")
FIELD = re.compile(r"^([A-Za-z ]+): ?(.*)$")
INSERT = "INSERT INTO raw VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"


def num(s, kind=int):
    try:
        return kind(s)
    except (TypeError, ValueError):
        return None


def parse(path, text):
    """Return a raw row, or raise ValueError if the 11-line header is off."""
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
    if not re.match(r"^Version \d+$", lines[10]):
        raise ValueError("bad version line")
    rating, _, votes = fields.get("Rating", "").partition(", Votes: ")
    body = "\n".join(lines[11:]).strip("\n").encode("utf-8")
    return (
        path,
        path.split("/")[1],
        num(title.group(2)),
        title.group(1),
        num(by.group(2)),
        by.group(1)[3:],
        num(rating, float) or 0.0,
        num(votes) or 0,
        fields.get("Tonality") or None,
        fields.get("Tuning") or None,
        zlib.compress(body, 6),
        len(body),
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("archive")
    ap.add_argument("db")
    ap.add_argument("--include", help="bsdtar --include glob, e.g. 'ug-tabs/Tab/Metallica-*'")
    args = ap.parse_args()

    work = args.db + ".work"
    tmp = args.db + ".partial"
    for f in (work, tmp):
        if os.path.exists(f):
            os.remove(f)
    db = sqlite3.connect(work)
    db.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;" + RAW + SCHEMA)

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
        sys.exit(f"bsdtar exited {proc.returncode}; left {work} for inspection")

    print("ranking and indexing", flush=True)
    for statement in DERIVE.split(";\n\n"):
        params = {k: v for k, v in (("m_tab", M_TAB), ("m_song", M_SONG)) if ":" + k in statement}
        db.execute(statement, params)
    db.commit()
    print("compacting", flush=True)
    db.execute("VACUUM INTO ?", (tmp,))
    db.close()
    os.remove(work)
    os.replace(tmp, args.db)

    print(f"loaded {loaded:,}, skipped {len(skipped):,} in {time.time() - start:.0f}s -> {args.db}")
    for name, why in skipped[:20]:
        print(f"  skipped {name}: {why}")


if __name__ == "__main__":
    main()
