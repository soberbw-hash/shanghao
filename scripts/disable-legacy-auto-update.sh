#!/usr/bin/env bash
# Retire the old ten-minute pull/restart loop without restarting a live voice room.
set -euo pipefail
umask 077
EXPECTED="${1:?expected root crontab SHA-256 required}"
[[ "$EUID" == 0 && "$EXPECTED" =~ ^[a-f0-9]{64}$ ]] || exit 2
mkdir -p /root/.codex-backups
BACKUP="$(mktemp -d /root/.codex-backups/retire-auto-update-XXXXXXXX)"
crontab -l > "$BACKUP/before.crontab"
[[ "$(sha256sum "$BACKUP/before.crontab" | cut -d' ' -f1)" == "$EXPECTED" ]] || exit 3
awk '
  $0 !~ /^[[:space:]]*#/ && $1=="*/10" && $2=="*" && $3=="*" && $4=="*" && $5=="*" && index($0,"/root/update-shanghao.sh") {
    print "# Disabled 2026-10-25: publish with the verified idle-room deployment flow. " $0; found++; next
  }
  {print}
  END {if(found!=1) exit 4}
' "$BACKUP/before.crontab" > "$BACKUP/after.crontab"
[[ "$(crontab -l | sha256sum | cut -d' ' -f1)" == "$EXPECTED" ]] || exit 5
crontab "$BACKUP/after.crontab"
crontab -l > "$BACKUP/verified.crontab"
cmp -s "$BACKUP/after.crontab" "$BACKUP/verified.crontab"
printf 'retired_legacy_restart_schedule=true\nservice_restarted=false\nbackup=%s\n' "$BACKUP"
