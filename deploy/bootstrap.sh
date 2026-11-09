#!/bin/bash
# Turns a fresh Ubuntu LTS VPS into the philipmassouh.com server. Safe to re-run.
# Run through provision.sh, which supplies a terminal for the password prompt.
#
# pm is the admin login. It has sudo, which needs a password.
# deploy owns the site files and has no sudo. Its SSH key can only run
# site-deploy, so GitHub Actions never gets a shell here.
set -euo pipefail

BRANCH=${1:-main}
REPO=https://github.com/philipmassouh/philipmassouh.git
SITE=/srv/site
WWW=/var/www/philipmassouh.com/html

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "==> Installing packages"
apt-get update
apt-get -y upgrade
apt-get -y install curl debian-keyring debian-archive-keyring apt-transport-https \
  git gnupg python3 rsync ufw unattended-upgrades

if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
fi
apt-get -y install caddy

echo "==> Setting up users"
id pm >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups sudo pm
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy

# A fresh pm has no password, and without one nobody could sudo after root
# login is turned off below.
if [ "$(passwd -S pm | awk '{print $2}')" != P ]; then
  echo "Set a sudo password for pm:"
  passwd pm
fi

install -d -m 700 -o pm -g pm /home/pm/.ssh
if [ ! -s /home/pm/.ssh/authorized_keys ]; then
  install -m 600 -o pm -g pm /root/.ssh/authorized_keys /home/pm/.ssh/authorized_keys
fi

echo "==> Fetching the site"
install -d -o deploy -g deploy "$SITE" "$WWW"
if [ ! -d "$SITE/.git" ]; then
  runuser -u deploy -- git clone "$REPO" "$SITE"
fi
runuser -u deploy -- git -C "$SITE" fetch origin
runuser -u deploy -- git -C "$SITE" checkout "$BRANCH"
runuser -u deploy -- git -C "$SITE" pull --ff-only

echo "==> Installing deploy command"
install -m 755 "$SITE/deploy/site-deploy.sh" /usr/local/bin/site-deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
{
  printf 'restrict,command="/usr/local/bin/site-deploy" '
  cat "$SITE/deploy/deploy_key.pub"
} > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "==> Setting up the tabs API"
# The database is too big for git. Upload it once to pm's home and re-run:
#   rsync -P ~/Downloads/ug-tabs.db pm@<host>:
TABS_DB=/srv/tabs/ug-tabs.db
install -d -m 755 /srv/tabs
if [ ! -f "$TABS_DB" ] && [ -f /home/pm/ug-tabs.db ]; then
  mv /home/pm/ug-tabs.db "$TABS_DB"
  chown root:root "$TABS_DB"
  chmod 644 "$TABS_DB"
fi
install -m 644 "$SITE/deploy/tabs.service" "$SITE/deploy/tabs-restart.service" \
  "$SITE/deploy/tabs-restart.path" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tabs-restart.path
if [ -f "$TABS_DB" ]; then
  systemctl enable tabs.service
  systemctl restart tabs.service
else
  echo "no $TABS_DB yet: upload it to pm's home and re-run provision.sh" >&2
fi

echo "==> Setting up API keys for /donna"
# The /donna password, and the keys Caddy adds to /donna's API calls. Fill them in with
#   sudo nano /etc/caddy/donna.env && sudo systemctl restart caddy
if [ ! -f /etc/caddy/donna.env ]; then
  install -m 640 -o root -g caddy /dev/null /etc/caddy/donna.env
  printf 'DONNA_PASSWORD=\nTYPESAFE_API_KEY=\nDEEPGRAM_API_KEY=\n' > /etc/caddy/donna.env
fi
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/donna.conf <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/donna.env
EOF
systemctl daemon-reload

echo "==> Deploying the pages"
runuser -u deploy -- /usr/local/bin/site-deploy
install -m 644 "$SITE/deploy/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
# Restart, not reload: Caddy reads donna.env only when it starts.
systemctl restart caddy

echo "==> Turning on automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52site-reboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "09:00";
EOF

echo "==> Configuring the firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443
ufw --force enable

echo "==> Hardening SSH"
# Last on purpose: if anything above fails, the provider's root login still works.
if [ ! -s /home/pm/.ssh/authorized_keys ]; then
  echo "pm has no SSH keys; leaving SSH alone to avoid a lockout" >&2
  exit 1
fi
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sshd -t
systemctl reload ssh

echo "==> Done. Next login: ssh pm@<host>"
