#!/bin/bash
# Brings the tabs database up to date with tabs/migrations/. bootstrap.sh
# installs this root-owned as /usr/local/bin/tabs-migrate, and
# tabs-restart.service runs it as the tabs user after each deploy.
#
# Migrates a copy and swaps it in, so the API never reads a half-migrated file
# and a failed migration leaves the old database in place.
set -euo pipefail

DB=${TABS_DB:-/srv/tabs/tabs.db}
MIGRATE=${TABS_MIGRATE:-/srv/site/tabs/migrate.py}

[ -f "$DB" ] || { echo "no $DB; nothing to migrate"; exit 0; }

status=0
python3 "$MIGRATE" --pending "$DB" || status=$?
case $status in
  0) ;;
  10) exit 0 ;;
  *) exit "$status" ;;
esac

rm -f "$DB.new"
cp "$DB" "$DB.new"
if ! python3 "$MIGRATE" "$DB.new"; then
  rm -f "$DB.new"
  echo "migration failed; $DB left as it was" >&2
  exit 1
fi
mv "$DB.new" "$DB"
