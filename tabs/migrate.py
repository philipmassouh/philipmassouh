#!/usr/bin/env python3
"""Apply pending migrations in tabs/migrations/ to a tabs database.

Migrations are NNN_name.sql files applied in order; the database's
PRAGMA user_version records the last one applied. Each runs in its own
transaction, and the file is vacuumed afterwards if anything ran.

    python3 tabs/migrate.py ~/Downloads/tabs.db

On the server, migrate a copy and swap it in so the API never sees a
half-migrated file:

    sudo cp /srv/tabs/tabs.db /srv/tabs/tabs.db.new
    sudo python3 /srv/site/tabs/migrate.py /srv/tabs/tabs.db.new
    sudo mv /srv/tabs/tabs.db.new /srv/tabs/tabs.db
    sudo systemctl restart tabs
"""
import re
import sqlite3
import sys
import time
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    db = sqlite3.connect(sys.argv[1], isolation_level=None)
    current = db.execute("PRAGMA user_version").fetchone()[0]
    pending = sorted(
        (int(m.group(1)), f) for f in MIGRATIONS.glob("*.sql")
        if (m := re.match(r"(\d+)_", f.name)) and int(m.group(1)) > current)
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
