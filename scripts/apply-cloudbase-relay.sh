#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/root/shanghao}"
SERVICE_NAME="${2:-shanghao-relay}"
STAGING_DIR="${3:-${APP_DIR}/.codex-cloudbase-sync}"
ENV_FILE="${APP_DIR}/.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root so it can restart the relay service." >&2
  exit 1
fi
if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "Refusing to deploy: ${APP_DIR} is not a Git checkout." >&2
  exit 2
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Refusing to deploy: ${ENV_FILE} does not exist; create it manually first." >&2
  exit 3
fi

grep -Eq '^SHANGHAO_ACCOUNT_PROVIDER=[[:space:]]*cloudbase[[:space:]]*$' "${ENV_FILE}" || {
  echo "Refusing to deploy: set SHANGHAO_ACCOUNT_PROVIDER=cloudbase in ${ENV_FILE}." >&2
  exit 4
}
grep -Eq '^CLOUDBASE_ENV_ID=[^[:space:]]+' "${ENV_FILE}" || {
  echo "Refusing to deploy: set CLOUDBASE_ENV_ID in ${ENV_FILE}." >&2
  exit 5
}
grep -Eq '^CLOUDBASE_REGION=[^[:space:]]+' "${ENV_FILE}" || {
  echo "Refusing to deploy: set CLOUDBASE_REGION in ${ENV_FILE}." >&2
  exit 6
}

if [[ ! -f "${STAGING_DIR}/packages/signaling/src/account-service.ts" ||
  ! -f "${STAGING_DIR}/packages/signaling/src/server.ts" ]]; then
  echo "Refusing to deploy: staged CloudBase Relay sources are incomplete." >&2
  exit 7
fi

STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_DIR="${APP_DIR}/.codex-cloudbase-sync/backups/${STAMP}"
mkdir -p "${BACKUP_DIR}/packages/signaling/src"
cp -a "${APP_DIR}/packages/signaling/src/account-service.ts" "${BACKUP_DIR}/packages/signaling/src/account-service.ts"
cp -a "${APP_DIR}/packages/signaling/src/server.ts" "${BACKUP_DIR}/packages/signaling/src/server.ts"
cp -a "${STAGING_DIR}/packages/signaling/src/account-service.ts" "${APP_DIR}/packages/signaling/src/account-service.ts"
cp -a "${STAGING_DIR}/packages/signaling/src/server.ts" "${APP_DIR}/packages/signaling/src/server.ts"

cd "${APP_DIR}"
corepack pnpm --filter @private-voice/shared build
corepack pnpm --filter @private-voice/signaling build

if command -v pm2 >/dev/null 2>&1 && pm2 describe "${SERVICE_NAME}" >/dev/null 2>&1; then
  pm2 restart "${SERVICE_NAME}" --update-env
elif command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "${SERVICE_NAME}.service" --no-legend 2>/dev/null | grep -q .; then
  systemctl restart "${SERVICE_NAME}.service"
else
  echo "Build completed, but service ${SERVICE_NAME} was not found in PM2 or systemd." >&2
  exit 8
fi

PORT_VALUE="$(awk -F= '$1 == "PORT" { print $2; exit }' "${ENV_FILE}")"
PORT_VALUE="${PORT_VALUE:-43821}"
HEALTH_URL="http://127.0.0.1:${PORT_VALUE}/health"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 "${HEALTH_URL}" | grep -q '"ok":true'; then
    echo "CloudBase Relay is healthy on ${HEALTH_URL}."
    exit 0
  fi
  sleep 1
done

echo "Relay restart finished but health check failed: ${HEALTH_URL}" >&2
exit 9
