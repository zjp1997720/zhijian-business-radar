#!/usr/bin/env bash
set -euo pipefail
base=/opt/zhijian-business-radar
node="$base/runtime/node-v24.19.0-linux-x64/bin/node"
test -x "$node"
test -f "$base/app/apps/worker/src/run-business-discovery.ts"
cat >/etc/systemd/system/radar-business-discovery.service <<EOF
[Unit]
Description=WorkBuddy business source discovery
After=network-online.target postgresql.service
Wants=network-online.target
[Service]
Type=oneshot
User=radar
Group=radar
WorkingDirectory=$base/app
ExecStart=$node --env-file=$base/runtime.env $base/app/apps/worker/src/run-business-discovery.ts --write
TimeoutStartSec=900
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$base/data
UMask=0077
EOF
cat >/etc/systemd/system/radar-business-discovery.timer <<EOF
[Unit]
Description=WorkBuddy business discovery before daily radar
[Timer]
OnCalendar=*-*-* 07:00:00 Asia/Shanghai
OnCalendar=*-*-* 19:00:00 Asia/Shanghai
Persistent=true
RandomizedDelaySec=60
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now radar-business-discovery.timer
