#!/usr/bin/env bash
set -euo pipefail
base=/opt/zhijian-business-radar
node="$base/runtime/node-v24.19.0-linux-x64/bin/node"
test -x "$node"
test -f "$base/runtime.env"
mkdir -p "$base/data"
chown radar:radar "$base/data" "$base/runtime.env" "$base/runtime/radar-tunnel-token"
chmod 600 "$base/runtime.env" "$base/runtime/radar-tunnel-token"
chmod 755 "$base/runtime/radar-cloudflared-linux-amd64"
# The SSR website and access gateway receive only the configuration they use.
# Model credentials and the database URL remain in backend processes.
python3 - "$base" <<'PY'
from pathlib import Path
import sys
base = Path(sys.argv[1])
lines = (base / 'runtime.env').read_text().splitlines()
groups = {
    'web.env': {'NODE_ENV', 'SITE_URL', 'WEB_HOST', 'WEB_PORT', 'API_BASE_URL', 'TRUST_PROXY'},
    'access.env': {'NODE_ENV', 'SITE_URL', 'ACCESS_USER', 'ACCESS_PASSWORD', 'SESSION_SECRET', 'ACCESS_PORT', 'ACCESS_UPSTREAM'},
}
for name, keys in groups.items():
    target = base / name
    target.write_text('\n'.join(line for line in lines if line.split('=', 1)[0] in keys) + '\n')
    target.chmod(0o600)
PY
chown radar:radar "$base/web.env" "$base/access.env"
for process in api web worker access; do
  envfile="$base/runtime.env"
  case "$process" in
    api) entry=apps/api/src/main.ts ;;
    web) entry=apps/web/server.ts; envfile="$base/web.env" ;;
    worker) entry=apps/worker/src/main.ts ;;
    access) entry=deploy/access-gateway.mjs; envfile="$base/access.env" ;;
  esac
  cat >"/etc/systemd/system/radar-$process.service" <<EOF
[Unit]
Description=Zhijian business radar $process
After=network-online.target postgresql.service
Wants=network-online.target
[Service]
User=radar
Group=radar
WorkingDirectory=$base/app
ExecStart=$node --env-file=$envfile $base/app/$entry
Restart=always
RestartSec=5
TimeoutStopSec=210
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$base/data
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
done
cat >/etc/systemd/system/radar-tunnel.service <<EOF
[Unit]
Description=Zhijian business radar encrypted ingress
After=network-online.target radar-access.service
Wants=network-online.target
[Service]
User=radar
Group=radar
ExecStart=$base/runtime/radar-cloudflared-linux-amd64 --no-autoupdate tunnel --protocol http2 run --token-file $base/runtime/radar-tunnel-token
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable radar-api radar-web radar-worker radar-access radar-tunnel
systemctl restart radar-api radar-web radar-access radar-tunnel
# Worker starts only after seeds, budgets and initial collection are verified.

install -d -o postgres -g postgres -m 700 /var/backups/zhijian-business-radar
cat >/etc/systemd/system/radar-backup.service <<EOF
[Unit]
Description=Daily radar PostgreSQL backup
After=postgresql.service
[Service]
Type=oneshot
User=postgres
Group=postgres
ExecStart=/bin/bash $base/app/deploy/backup-database.sh
UMask=0077
NoNewPrivileges=true
EOF
cat >/etc/systemd/system/radar-backup.timer <<EOF
[Unit]
Description=Daily radar backup timer
[Timer]
OnCalendar=*-*-* 04:10:00 Asia/Shanghai
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now radar-backup.timer
