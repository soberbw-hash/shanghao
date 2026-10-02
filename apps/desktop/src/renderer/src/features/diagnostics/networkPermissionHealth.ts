import type { RelayStatusSnapshot, WindowsIntegrationStatus } from "@private-voice/shared";
import type { HealthFinding } from "./healthProjection";

export const networkHealth = (relay?: RelayStatusSnapshot): HealthFinding => {
  if (
    !relay?.isReachable ||
    relay.latencyMs === undefined ||
    !Number.isFinite(relay.latencyMs) ||
    relay.latencyMs < 0
  )
    return { level: "未检测", description: "等待连接后检查网络延迟。" };
  if (relay.latencyMs >= 160)
    return {
      level: "需要看看",
      description: `延迟 ${Math.round(relay.latencyMs)} ms，响应偏慢。连接中断会自动尝试恢复；持续偏慢时请检查网络。`,
    };
  return { level: "正常", description: "网络响应正常。" };
};

export const networkPermissionHealth = (
  status?: WindowsIntegrationStatus["firewall"],
): HealthFinding & { badge?: string; retry?: boolean } => {
  if (!status) return { level: "未检测", description: "正在检查 Windows 网络权限。" };
  if (!status.supported)
    return { level: "未检测", badge: "无需检查", description: "当前系统无需 Windows 网络规则。" };
  if (status.healthy) return { level: "正常", description: "系统网络权限正常。" };
  if (status.repairState === "repairing")
    return {
      level: "未检测",
      badge: "修复中",
      description: "正在自动补齐上号的网络规则。如 Windows 请求授权，请确认系统授权框。",
    };
  if (status.repairState === "unavailable")
    return { level: "未检测", badge: "检查暂不可用", description: "暂时无法检查，稍后自动重试。" };
  return {
    level: "需要看看",
    badge: status.repairState === "authorization_required" ? "待系统授权" : "修复未完成",
    description: status.message,
    retry: true,
  };
};
