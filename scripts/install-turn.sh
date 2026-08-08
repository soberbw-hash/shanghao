#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行：sudo bash scripts/install-turn.sh" >&2
  exit 1
fi

APP_DIR="${SHANGHAO_DIR:-/opt/shanghao}"
ENV_FILE="${SHANGHAO_ENV_FILE:-${APP_DIR}/.env}"
TURN_REALM="${TURN_REALM:-shanghao.local}"
TURN_HOST="${TURN_HOST:-}"
TURN_PORT="${TURN_PORT:-3478}"
TURN_TLS_PORT="${TURN_TLS_PORT:-5349}"
TURN_ALT_TLS_PORT="${TURN_ALT_TLS_PORT:-}"
TURN_CERT_FILE="${TURN_CERT_FILE:-}"
TURN_KEY_FILE="${TURN_KEY_FILE:-}"
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
TURN_HOST="${TURN_HOST:-${TURN_EXTERNAL_IP}}"

TLS_ENABLED=0
if [[ -n "${TURN_CERT_FILE}" || -n "${TURN_KEY_FILE}" ]]; then
  if [[ ! -r "${TURN_CERT_FILE}" || ! -r "${TURN_KEY_FILE}" ]]; then
    echo "TURN_CERT_FILE 与 TURN_KEY_FILE 必须同时存在且可读。" >&2
    exit 1
  fi
  TLS_ENABLED=1
fi

if [[ -n "${TURN_ALT_TLS_PORT}" && "${TLS_ENABLED}" -ne 1 ]]; then
  echo "TURN_ALT_TLS_PORT 需要同时配置 TLS 证书和私钥。" >&2
  exit 1
fi

if [[ -n "${TURN_ALT_TLS_PORT}" ]] && ss -ltn "sport = :${TURN_ALT_TLS_PORT}" | tail -n +2 | grep -q .; then
  echo "端口 ${TURN_ALT_TLS_PORT} 已被占用，不会覆盖现有 HTTPS 服务。" >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn curl openssl

if [[ -f /etc/turnserver.conf ]]; then
  cp /etc/turnserver.conf "/etc/turnserver.conf.bak.$(date +%Y%m%d%H%M%S)"
fi

cat >/etc/turnserver.conf <<EOF
listening-port=${TURN_PORT}
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
no-dtls
EOF

if [[ "${TLS_ENABLED}" -eq 1 ]]; then
  cat >>/etc/turnserver.conf <<EOF
tls-listening-port=${TURN_TLS_PORT}
cert=${TURN_CERT_FILE}
pkey=${TURN_KEY_FILE}
EOF
  if [[ -n "${TURN_ALT_TLS_PORT}" ]]; then
    printf 'alt-tls-listening-port=%s\n' "${TURN_ALT_TLS_PORT}" >>/etc/turnserver.conf
  fi
else
  printf 'no-tls\n' >>/etc/turnserver.conf
fi

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

TURN_URLS_VALUE="turn:${TURN_HOST}:${TURN_PORT}?transport=udp,turn:${TURN_HOST}:${TURN_PORT}?transport=tcp"
if [[ "${TLS_ENABLED}" -eq 1 ]]; then
  TURN_URLS_VALUE="${TURN_URLS_VALUE},turns:${TURN_HOST}:${TURN_TLS_PORT}?transport=tcp"
  if [[ -n "${TURN_ALT_TLS_PORT}" ]]; then
    TURN_URLS_VALUE="${TURN_URLS_VALUE},turns:${TURN_HOST}:${TURN_ALT_TLS_PORT}?transport=tcp"
  fi
fi
upsert_env "TURN_HOST" "${TURN_HOST}"
upsert_env "TURN_PORT" "${TURN_PORT}"
upsert_env "TURN_TLS_PORT" "${TURN_TLS_PORT}"
upsert_env "TURN_ALT_TLS_PORT" "${TURN_ALT_TLS_PORT}"
upsert_env "TURN_URLS" "${TURN_URLS_VALUE}"
upsert_env "TURN_SHARED_SECRET" "${TURN_SHARED_SECRET}"
upsert_env "TURN_CREDENTIAL_TTL_SECONDS" "86400"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow "${TURN_PORT}/udp"
  ufw allow "${TURN_PORT}/tcp"
  if [[ "${TLS_ENABLED}" -eq 1 ]]; then
    ufw allow "${TURN_TLS_PORT}/tcp"
    if [[ -n "${TURN_ALT_TLS_PORT}" ]]; then
      ufw allow "${TURN_ALT_TLS_PORT}/tcp"
    fi
  fi
  ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp"
fi

systemctl enable --now coturn
systemctl restart coturn
if systemctl list-unit-files | grep -q '^shanghao-relay.service'; then
  systemctl restart shanghao-relay
fi

echo "TURN 已配置：${TURN_HOST}:${TURN_PORT}（UDP/TCP）"
if [[ "${TLS_ENABLED}" -eq 1 ]]; then
  echo "TURN TLS 已配置：${TURN_HOST}:${TURN_TLS_PORT}"
fi
echo "请确认腾讯云安全组已开放 TCP/UDP ${TURN_PORT}、UDP ${TURN_MIN_PORT}-${TURN_MAX_PORT}，以及已启用的 TLS 端口。"
echo "验证命令：curl -s http://127.0.0.1:43821/health"
