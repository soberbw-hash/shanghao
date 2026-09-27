#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 || "$#" -ne 2 ]]; then
  echo "Usage: sudo bash deploy/install-phone-mic-sidecar.sh /path/to/phone-mic-sidecar.cjs 3.2.0" >&2
  exit 2
fi

bundle="$1"
version="$2"
source_env="/root/shanghao/.env"
target_dir="/opt/shanghao-phone-mic"
target_bundle="$target_dir/phone-mic-sidecar.cjs"
service_source="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/systemd/shanghao-phone-mic.service"
service_target="/etc/systemd/system/shanghao-phone-mic.service"
env_target="/etc/shanghao/phone-mic.env"

[[ -f "$bundle" && -f "$service_source" && -f "$source_env" ]] || {
  echo "Sidecar bundle, service template or existing relay environment is missing" >&2
  exit 1
}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Version must be major.minor.patch" >&2
  exit 1
}
node --check "$bundle"

if ! id -u shanghao-phone-mic >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin shanghao-phone-mic
fi
install -d -o root -g root -m 0755 "$target_dir"
install -d -o root -g shanghao-phone-mic -m 0750 /etc/shanghao

backup_suffix="$(date -u +%Y%m%dT%H%M%SZ)"
backup_env=""
backup_bundle=""
backup_service=""
if [[ -f "$env_target" ]]; then
  backup_env="${env_target}.backup.${backup_suffix}"
  cp -p "$env_target" "$backup_env"
fi
if [[ -f "$target_bundle" ]]; then
  backup_bundle="${target_bundle}.backup.${backup_suffix}"
  cp -p "$target_bundle" "$backup_bundle"
fi
if [[ -f "$service_target" ]]; then
  backup_service="${service_target}.backup.${backup_suffix}"
  cp -p "$service_target" "$backup_service"
fi

# Copy only the TURN keys needed by this sidecar. Never grant it access to the
# relay's root-only .env, which may also contain account and cloud-AI secrets.
env_next="$(mktemp /etc/shanghao/phone-mic.env.XXXXXX)"
awk -F= '/^(TURN_URLS|TURN_SHARED_SECRET|TURN_USERNAME|TURN_CREDENTIAL|TURN_CREDENTIAL_TTL_SECONDS)=/ { print }' "$source_env" > "$env_next"
printf 'SHANGHAO_VERSION=%s\n' "$version" >> "$env_next"
chown root:shanghao-phone-mic "$env_next"
chmod 0640 "$env_next"
mv -f "$env_next" "$env_target"

bundle_next="$target_bundle.next"
install -o root -g root -m 0644 "$bundle" "$bundle_next"
mv -f "$bundle_next" "$target_bundle"

install -o root -g root -m 0644 "$service_source" "$service_target"
systemctl daemon-reload
if ! systemctl restart shanghao-phone-mic || ! curl --fail --silent --show-error --retry 12 --retry-connrefused --retry-delay 1 --output /dev/null http://127.0.0.1:43822/phone-mic/health; then
  [[ -z "$backup_env" ]] || cp -p "$backup_env" "$env_target"
  [[ -z "$backup_bundle" ]] || cp -p "$backup_bundle" "$target_bundle"
  if [[ -n "$backup_service" ]]; then
    cp -p "$backup_service" "$service_target"
    systemctl daemon-reload
    systemctl restart shanghao-phone-mic || true
  fi
  echo "Phone microphone service failed readiness; previous files and service were restored" >&2
  exit 1
fi

# Prune only this sidecar's timestamped backups after the new service passes
# readiness. Lexical order matches UTC creation order for this suffix format.
prune_sidecar_backups() {
  local target="$1" base directory candidate
  local -a backups=()
  directory="$(dirname "$target")"
  base="$(basename "$target")"
  while IFS= read -r candidate; do
    [[ "$(basename "$candidate")" =~ ^${base//./\.}\.backup\.[0-9]{8}T[0-9]{6}Z$ ]] || continue
    backups+=("$candidate")
  done < <(find "$directory" -maxdepth 1 -type f -name "${base}.backup.*" -print | sort -r)
  for ((i=3; i<${#backups[@]}; i++)); do
    rm -- "${backups[i]}"
  done
}
prune_sidecar_backups "$env_target"
prune_sidecar_backups "$target_bundle"
prune_sidecar_backups "$service_target"

echo "Phone microphone sidecar is healthy under $(systemctl show shanghao-phone-mic -p User --value)"
[[ -z "$backup_service" ]] || echo "Previous service file preserved at $backup_service"
