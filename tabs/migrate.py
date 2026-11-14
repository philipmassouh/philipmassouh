#!/usr/bin/env python3
"""Apply pending migrations in tabs/migrations/ to a tabs database.

Migrations are NNN_name.sql files applied in order; the database's
PRAGMA user_version records the last one applied. Each runs in its own
transaction, and the file is vacuumed afterwards if anything ran.

    python3 tabs/migrate.py ~/Downloads/tabs.db
    python3 tabs/migrate.py --pending ~/Downloads/tabs.db

--pending lists what would run and exits 0 if anything is pending, 10 if
the database is up to date.

On the server deploys run this automatically: tabs-restart.path notices a
change in tabs/migrations/ and deploy/tabs-migrate.sh migrates a copy of the
database and swaps it in.
"""
import re
import sqlite3
import sys
import time
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent / "migrations"
UP_TO_DATE = 10


def pending_migrations(db):
    current = db.execute("PRAGMA user_version").fetchone()[0]
    found = sorted(
        (int(m.group(1)), f) for f in MIGRATIONS.glob("*.sql")
        if (m := re.match(r"(\d+)_", f.name)))
    return current, [(v, f) for v, f in found if v > current]


def main():
    args = sys.argv[1:]
    check = args[:1] == ["--pending"]
    if check:
        args = args[1:]
    if len(args) != 1:
        sys.exit(__doc__)

    if check:
        db = sqlite3.connect(f"file:{args[0]}?mode=ro", uri=True)
        current, pending = pending_migrations(db)
        for _, path in pending:
            print(f"pending {path.name}")
        if not pending:
            print(f"up to date at version {current}")
        sys.exit(0 if pending else UP_TO_DATE)

    db = sqlite3.connect(args[0], isolation_level=None)
    current, pending = pending_migrations(db)
    if not pending:
        print(f"up to date at version {current}")
        return
    for version, path in pending:
        start = time.time()
        # One script so the migration and its version bump commit together.
        try:
            db.executescript(f"BEGIN;\n{path.read_text()}\nPRAGMA user_version = {version};\nCOMMIT;")
        except Exception:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        print(f"applied {path.name} in {time.time() - start:.0f}s")
    print("vacuuming")
    db.execute("VACUUM")
    db.close()


if __name__ == "__main__":
    main()
