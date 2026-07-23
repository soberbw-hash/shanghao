import type { ConnectionHealth } from "@private-voice/shared";

export type ConnectionQualityLevel = "pending" | "good" | "fair" | "poor";

export interface ConnectionQualitySummary {
  level: ConnectionQualityLevel;
  label: "检测中" | "流畅" | "一般" | "不稳定";
  detail: string;
}

export const summarizeConnectionHealth = (health: ConnectionHealth): ConnectionQualitySummary => {
  const latency = Math.max(0, Math.round(health.latencyMs));
  const jitter = Math.max(0, Math.round(health.jitterMs));
  const loss = Math.max(0, health.packetLossPercent);
  const bitrate = health.availableOutgoingBitrateKbps;
  const detail = `延迟 ${latency || "--"} ms · 抖动 ${jitter} ms · 丢包 ${loss.toFixed(1)}%${
    typeof bitrate === "number" ? ` · 上行 ${bitrate} kbps` : ""
  }`;

  if (!health.lastUpdatedAt && latency === 0 && jitter === 0 && loss === 0) {
    return { level: "pending", label: "检测中", detail: "正在采集真实通话质量" };
  }
  if (
    loss >= 8 ||
    latency >= 420 ||
    jitter >= 90 ||
    (typeof bitrate === "number" && bitrate < 100) ||
    health.relayFallbackActive
  ) {
    return { level: "poor", label: "不稳定", detail };
  }
  if (
    loss >= 3 ||
    latency >= 220 ||
    jitter >= 45 ||
    (typeof bitrate === "number" && bitrate < 240)
  ) {
    return { level: "fair", label: "一般", detail };
  }
  return { level: "good", label: "流畅", detail };
};

export const describeConnectionHealth = (health: ConnectionHealth): string => {
  return summarizeConnectionHealth(health).label;
};
