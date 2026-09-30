#!/usr/bin/env bash
set -euo pipefail
umask 077
dir=/var/backups/zhijian-business-radar
file="$dir/radar-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$file.partial"' EXIT
pg_dump --format=custom --dbname=radar --file="$file.partial"
pg_restore --list "$file.partial" >/dev/null
mv "$file.partial" "$file"
# Retain only backups created by this job, for fourteen days.
find "$dir" -maxdepth 1 -type f -name 'radar-*.dump' -mtime +14 -delete
