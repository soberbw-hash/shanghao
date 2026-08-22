#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash scripts/deploy-relay-ubuntu.sh" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Unable to identify the operating system." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This installer supports Ubuntu only (detected: ${ID:-unknown})." >&2
  exit 1
fi

APP_USER="${SHANGHAO_USER:-shanghao}"
APP_DIR="${SHANGHAO_DIR:-/opt/shanghao}"
DATA_DIR="${APP_DIR}/data"
LOG_DIR="${SHANGHAO_LOG_DIR:-/var/log/shanghao}"
ENV_FILE="${APP_DIR}/.env"
REPO_URL="${SHANGHAO_REPO_URL:-https://github.com/soberbw-hash/shanghao.git}"
REPO_REF="${SHANGHAO_REF:-main}"
DOMAIN="${SHANGHAO_DOMAIN:-}"
PORT="${SHANGHAO_PORT:-43821}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git openssl

install_node_22() {
  local major=""
  if command -v node >/dev/null 2>&1; then
    major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  fi
  if [[ "${major}" != "22" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  corepack enable
  corepack prepare pnpm@10.0.0 --activate
}

install_node_22

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${APP_DIR}" --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --tags --prune origin
  git -C "${APP_DIR}" checkout "${REPO_REF}"
  git -C "${APP_DIR}" pull --ff-only origin "${REPO_REF}"
else
  if [[ -e "${APP_DIR}" ]] && [[ -n "$(find "${APP_DIR}" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "${APP_DIR} already exists and is not a ShangHao Git checkout; refusing to delete it." >&2
    exit 1
  fi
  git clone --branch "${REPO_REF}" --depth 1 "${REPO_URL}" "${APP_DIR}"
fi

mkdir -p "${DATA_DIR}" "${LOG_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" "${LOG_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  relay_token="$(openssl rand -hex 32)"
  cat >"${ENV_FILE}" <<EOF
PORT=${PORT}
ROOM_NAME=ShangHao
MAX_ROOM_MEMBERS=5
MAX_CONNECTIONS=100
CHAT_HISTORY_FILE=${DATA_DIR}/chat-history.json
RELAY_ACCESS_TOKEN=${relay_token}
DEEPSEEK_API_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
EOF
  chown "${APP_USER}:${APP_USER}" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Existing environment files are never overwritten."
else
  echo "Keeping existing ${ENV_FILE} unchanged."
fi

runuser -u "${APP_USER}" -- corepack pnpm --dir "${APP_DIR}" install --frozen-lockfile
runuser -u "${APP_USER}" -- corepack pnpm --dir "${APP_DIR}" relay:build

cat >/etc/systemd/system/shanghao-relay.service <<EOF
[Unit]
Description=ShangHao signaling relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${APP_DIR}/scripts/start-relay.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=${DATA_DIR} ${LOG_DIR}

[Install]
WantedBy=multi-user.target
EOF

if [[ -n "${DOMAIN}" ]]; then
  apt-get install -y caddy
  CADDY_MAIN="/etc/caddy/Caddyfile"
  CADDY_CONF_DIR="/etc/caddy/conf.d"
  CADDY_FRAGMENT="${CADDY_CONF_DIR}/shanghao.caddy"
  CADDY_BACKUP="${CADDY_MAIN}.shanghao.$(date +%Y%m%d%H%M%S).bak"
  FRAGMENT_BACKUP="$(mktemp)"
  HAD_FRAGMENT=0

  mkdir -p "${CADDY_CONF_DIR}"
  touch "${CADDY_MAIN}"
  cp -a "${CADDY_MAIN}" "${CADDY_BACKUP}"
  if [[ -f "${CADDY_FRAGMENT}" ]]; then
    cp -a "${CADDY_FRAGMENT}" "${FRAGMENT_BACKUP}"
    HAD_FRAGMENT=1
  fi

  if ! grep -Fqx 'import /etc/caddy/conf.d/*' "${CADDY_MAIN}"; then
    printf '\nimport /etc/caddy/conf.d/*\n' >>"${CADDY_MAIN}"
  fi

  cat >"${CADDY_FRAGMENT}" <<EOF
${DOMAIN} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:${PORT}
}
EOF

  if ! caddy validate --config "${CADDY_MAIN}"; then
    cp -a "${CADDY_BACKUP}" "${CADDY_MAIN}"
    if [[ "${HAD_FRAGMENT}" == "1" ]]; then
      cp -a "${FRAGMENT_BACKUP}" "${CADDY_FRAGMENT}"
    else
      rm -f "${CADDY_FRAGMENT}"
    fi
    rm -f "${FRAGMENT_BACKUP}"
    echo "Caddy validation failed; previous configuration was restored." >&2
    exit 1
  fi

  rm -f "${FRAGMENT_BACKUP}"
  systemctl enable --now caddy
  systemctl reload caddy
fi

systemctl daemon-reload
systemctl enable --now shanghao-relay
systemctl restart shanghao-relay

for _ in {1..20}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/tmp/shanghao-health.json; then
    break
  fi
  sleep 1
done

if ! grep -q '"ok":true' /tmp/shanghao-health.json 2>/dev/null; then
  echo "Relay health check failed. Inspect: journalctl -u shanghao-relay -n 100 --no-pager" >&2
  exit 1
fi

echo "ShangHao relay is healthy."
cat /tmp/shanghao-health.json
echo
echo "Useful commands:"
echo "  systemctl status shanghao-relay --no-pager"
echo "  journalctl -u shanghao-relay -f"
echo "  systemctl restart shanghao-relay"
echo "Cloud AI: set DEEPSEEK_API_KEY only in ${ENV_FILE}, chmod 600, then restart the relay."
if [[ -n "${DOMAIN}" ]]; then
  echo "Client address: wss://${DOMAIN}/?token=<RELAY_ACCESS_TOKEN from ${ENV_FILE}>"
  echo "Tencent Cloud security group: TCP 80,443; TURN TCP/UDP 3478 and UDP 49160-49220."
else
  echo "Temporary test address: ws://SERVER_IP:${PORT}/?token=<RELAY_ACCESS_TOKEN from ${ENV_FILE}>"
  echo "For production, rerun with SHANGHAO_DOMAIN=voice.example.com to enable WSS."
  echo "Tencent Cloud security group for temporary ws: TCP ${PORT}."
fi
