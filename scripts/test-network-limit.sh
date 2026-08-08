#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
INTERFACE="${SHANGHAO_TEST_INTERFACE:-$(ip route show default | awk '/default/ {print $5; exit}')}"
RATE="${SHANGHAO_TEST_RATE:-4mbit}"
BURST="${SHANGHAO_TEST_BURST:-64kb}"
LATENCY="${SHANGHAO_TEST_LATENCY:-400ms}"

if [[ -z "${INTERFACE}" ]]; then
  echo "无法识别默认网卡，请设置 SHANGHAO_TEST_INTERFACE。" >&2
  exit 1
fi

show_status() {
  echo "网卡：${INTERFACE}"
  tc qdisc show dev "${INTERFACE}"
}

restore_limit() {
  tc qdisc del dev "${INTERFACE}" root 2>/dev/null || true
  echo "已移除 ${INTERFACE} 上的上号测试限速。"
}

case "${ACTION}" in
  status)
    show_status
    ;;
  restore)
    if [[ "${EUID}" -ne 0 ]]; then
      echo "请使用 sudo 执行恢复。" >&2
      exit 1
    fi
    restore_limit
    show_status
    ;;
  run)
    if [[ "${EUID}" -ne 0 ]]; then
      echo "请使用 sudo 执行受控限速。" >&2
      exit 1
    fi
    shift
    echo "应用前 qdisc："
    show_status
    trap 'restore_limit; echo "如仍有异常，请执行：sudo bash scripts/test-network-limit.sh restore"' EXIT INT TERM
    tc qdisc replace dev "${INTERFACE}" root handle 1: tbf \
      rate "${RATE}" burst "${BURST}" latency "${LATENCY}"
    echo "已将 ${INTERFACE} 出口限制为 ${RATE}。测试结束会自动恢复。"
    show_status
    if [[ "$#" -gt 0 ]]; then
      "$@"
    else
      read -r -p "开始五人语音验收；完成后按 Enter 自动恢复。"
    fi
    ;;
  *)
    echo "用法：sudo bash scripts/test-network-limit.sh {status|run [命令...]|restore}" >&2
    exit 2
    ;;
esac
