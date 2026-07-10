#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行：sudo bash scripts/install-turn.sh" >&2
  exit 1
fi

APP_DIR="${SHANGHAO_DIR:-/opt/shanghao}"
ENV_FILE="${SHANGHAO_ENV_FILE:-${APP_DIR}/.env}"
TURN_REALM="${TURN_REALM:-shanghao.local}"
TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49220}"
TURN_EXTERNAL_IP="${TURN_EXTERNAL_IP:-}"

if [[ -z "${TURN_EXTERNAL_IP}" ]]; then
  TURN_EXTERNAL_IP="$(curl -4fsS --max-time 8 https://api.ipify.org || true)"
fi
if [[ -z "${TURN_EXTERNAL_IP}" ]]; then
  echo "无法自动识别公网 IP。请改用：sudo TURN_EXTERNAL_IP=你的公网IP bash scripts/install-turn.sh" >&2
  exit 1
fi

TURN_SHARED_SECRET="${TURN_SHARED_SECRET:-$(openssl rand -hex 32)}"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn curl openssl

if [[ -f /etc/turnserver.conf ]]; then
  cp /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%Y%m%d%H%M%S)"
fi

cat >/etc/turnserver.conf <<EOF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=${TURN_SHARED_SECRET}
realm=${TURN_REALM}
external-ip=${TURN_EXTERNAL_IP}
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
stale-nonce=600
no-cli
no-multicast-peers
no-loopback-peers
no-tls
no-dtls
EOF

if [[ -f /etc/default/coturn ]]; then
  if grep -q '^TURNSERVER_ENABLED=' /etc/default/coturn; then
    sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  else
    printf '\nTURNSERVER_ENABLED=1\n' >>/etc/default/coturn
  fi
fi

mkdir -p "$(dirname "${ENV_FILE}")"
touch "${ENV_FILE}"

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${ENV_FILE}"
  fi
}

upsert_env "TURN_URLS" "turn:${TURN_EXTERNAL_IP}:3478?transport=udp,turn:${TURN_EXTERNAL_IP}:3478?transport=tcp"
upsert_env "TURN_SHARED_SECRET" "${TURN_SHARED_SECRET}"
upsert_env "TURN_CREDENTIAL_TTL_SECONDS" "86400"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 3478/udp
  ufw allow 3478/tcp
  ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp"
fi

systemctl enable --now coturn
systemctl restart coturn
if systemctl list-unit-files | grep -q '^shanghao-relay.service'; then
  systemctl restart shanghao-relay
fi

echo "TURN 已配置：${TURN_EXTERNAL_IP}:3478"
echo "请确认腾讯云安全组已开放 TCP/UDP 3478 和 UDP ${TURN_MIN_PORT}-${TURN_MAX_PORT}。"
echo "验证命令：curl -s http://127.0.0.1:43821/health"
