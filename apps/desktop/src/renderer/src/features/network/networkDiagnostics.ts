import type { ConnectionHealth } from "@private-voice/shared";

export const describeConnectionHealth = (health: ConnectionHealth): string => {
  if (health.packetLossPercent > 5 || health.latencyMs > 150) {
    return "Connection is under strain";
  }

  if (health.packetLossPercent > 1 || health.latencyMs > 80) {
    return "Connection is stable but not perfect";
  }

  return "Connection looks healthy";
};
