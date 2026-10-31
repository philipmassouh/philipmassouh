#!/bin/bash
# Run from your Mac to set up a server, or to re-apply this config to one.
#
#   ./deploy/provision.sh <host> [branch]             fresh VPS, logs in as root
#   SSH_USER=pm ./deploy/provision.sh <host> [branch] re-run once root login is off
set -euo pipefail

HOST=${1:?usage: provision.sh <host> [branch]}
BRANCH=${2:-main}
SSH_USER=${SSH_USER:-root}
HERE=$(cd "$(dirname "$0")" && pwd)

scp "$HERE/bootstrap.sh" "$SSH_USER@$HOST:bootstrap.sh"
# -t gives bootstrap a terminal so it can prompt for pm's sudo password.
ssh -t "$SSH_USER@$HOST" "sudo bash bootstrap.sh '$BRANCH' && rm bootstrap.sh"
