import type { PeerAudioStats } from "./stats";

export type PeerHealthLevel = "healthy" | "degraded" | "critical";
export type PeerHealthTrend = "improving" | "stable" | "degrading";
export type PeerDegradationSource = "none" | "network" | "media_pipeline";

export interface PeerHealthSnapshot {
  peerId: string;
  level: PeerHealthLevel;
  trend: PeerHealthTrend;
  degradationSource: PeerDegradationSource;
  score: number;
  rttMs?: number;
  jitterMs?: number;
  packetLossPercent?: number;
  concealmentPercent?: number;
  averageJitterBufferDelayMs?: number;
  availableOutgoingBitrateBps?: number;
  connectionType: "p2p" | "relay" | "unknown";
  iceState: RTCIceConnectionState;
  audioFlow: PeerAudioStats["inboundAudioFlow"];
  packetsProgressing: boolean;
  lastRecoveryAt?: string;
  recoveryCount: number;
  sampledAt: string;
}

export interface PeerHealthState {
  scores: number[];
  snapshot?: PeerHealthSnapshot;
}

export const createPeerHealthState = (): PeerHealthState => ({ scores: [] });

const healthScore = (stats: PeerAudioStats, iceState: RTCIceConnectionState): number => {
  let score = 100;
  score -= Math.min(35, (stats.packetLossPercent ?? 0) * 3.5);
  score -= Math.min(18, Math.max(0, (stats.jitterMs ?? 0) - 20) * 0.25);
  score -= Math.min(16, Math.max(0, (stats.roundTripTimeMs ?? 0) - 120) * 0.04);
  score -= Math.min(18, (stats.concealmentPercent ?? 0) * 1.8);
  score -= Math.min(10, Math.max(0, (stats.averageJitterBufferDelayMs ?? 0) - 80) * 0.05);
  if (stats.inboundAudioFlow === "stalled") score -= 45;
  if (iceState === "disconnected") score -= 30;
  if (iceState === "failed" || iceState === "closed") score = 0;
  return Math.max(0, Math.round(score));
};

export const advancePeerHealth = (
  previous: PeerHealthState,
  input: {
    peerId: string;
    stats: PeerAudioStats;
    iceState: RTCIceConnectionState;
    packetsProgressing: boolean;
    recoveryCount?: number;
    lastRecoveryAt?: string;
    now?: Date;
  },
): PeerHealthState => {
  const score = healthScore(input.stats, input.iceState);
  const scores = [...previous.scores.slice(-7), score];
  const recent = scores.slice(-4);
  const delta = recent.length >= 2 ? (recent.at(-1) ?? score) - (recent[0] ?? score) : 0;
  const trend: PeerHealthTrend = delta <= -8 ? "degrading" : delta >= 8 ? "improving" : "stable";
  const networkDegraded =
    (input.stats.packetLossPercent ?? 0) >= 3 ||
    (input.stats.jitterMs ?? 0) >= 45 ||
    (input.stats.roundTripTimeMs ?? 0) >= 220 ||
    (input.stats.concealmentPercent ?? 0) >= 4 ||
    (input.stats.averageJitterBufferDelayMs ?? 0) >= 140 ||
    (input.stats.availableOutgoingBitrateBps ?? Number.POSITIVE_INFINITY) < 240_000;
  const degradationSource: PeerDegradationSource = networkDegraded
    ? "network"
    : input.stats.inboundAudioFlow === "stalled"
      ? "media_pipeline"
      : "none";
  return {
    scores,
    snapshot: {
      peerId: input.peerId,
      level: score < 40 ? "critical" : score < 72 ? "degraded" : "healthy",
      trend,
      degradationSource,
      score,
      rttMs: input.stats.roundTripTimeMs,
      jitterMs: input.stats.jitterMs,
      packetLossPercent: input.stats.packetLossPercent,
      concealmentPercent: input.stats.concealmentPercent,
      averageJitterBufferDelayMs: input.stats.averageJitterBufferDelayMs,
      availableOutgoingBitrateBps: input.stats.availableOutgoingBitrateBps,
      connectionType: input.stats.connectionType ?? "unknown",
      iceState: input.iceState,
      audioFlow: input.stats.inboundAudioFlow,
      packetsProgressing: input.packetsProgressing,
      lastRecoveryAt: input.lastRecoveryAt,
      recoveryCount: input.recoveryCount ?? 0,
      sampledAt: (input.now ?? new Date()).toISOString(),
    },
  };
};
