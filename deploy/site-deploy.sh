#!/bin/bash
# Publishes the latest commit. bootstrap.sh installs this as root-owned
# /usr/local/bin/site-deploy, so changes here need a provision.sh re-run.
set -euo pipefail

SITE=/srv/site
WWW=/var/www/philipmassouh.com/html

git -C "$SITE" pull --ff-only
rsync -a --delete --exclude '.*' --exclude src --exclude build.py "$SITE/hrrr/" "$WWW/hrrr/"
rsync -a --delete --exclude '.*' "$SITE/food/" "$WWW/food/"
rsync -a --delete --exclude '.*' --exclude src "$SITE/texture/" "$WWW/texture/"
cp "$SITE/index.html" "$WWW/index.html"
