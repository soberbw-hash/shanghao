import {
  collectPeerAudioStats,
  advancePeerHealth,
  createPeerHealthState,
  evaluateInboundAudioFlow,
  type InboundAudioFlowEvaluation,
  type InboundAudioProgress,
  type MeshPeerConnection,
  type NetworkAdaptationTier,
  type PeerAudioStats,
  type PeerHealthSnapshot,
  type PeerHealthState,
} from "@private-voice/webrtc";
import { writeRendererLog } from "../../utils/logger";

interface PeerStatsMonitorOptions {
  getPeers: () => Iterable<[string, MeshPeerConnection]>;
  getPeerState: (peerId: string) => {
    isRemotePeer: boolean;
    isConnected: boolean;
    hasRemoteAudio: boolean;
    isRemoteMuted: boolean;
    isRemoteSpeaking: boolean;
    iceState: RTCIceConnectionState;
  };
  getRecovery: (peerId: string) => { count: number; lastRecoveryAt?: string };
  getResources: () => {
    peerConnectionCount: number;
    trackCount: number;
    mixerInputCount: number;
    audioNodeCount: number;
    audioContextCount: number;
    timerCount: number;
  };
  onLatency?: (peerId: string, latencyMs?: number) => void;
  onStats?: (stats: Record<string, PeerAudioStats>) => void;
  onFlowEvaluation: (
    peerId: string,
    stats: PeerAudioStats,
    evaluation: InboundAudioFlowEvaluation,
  ) => void;
  onAdaptationChanged?: (
    peerId: string,
    previousTier: NetworkAdaptationTier,
    nextTier: NetworkAdaptationTier,
    stats: PeerAudioStats,
  ) => void;
  intervalMs?: number;
  resourceSampleIntervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS = 60_000;
const MAX_RESOURCE_SAMPLES = 241;

export interface LongSessionAudioSnapshot {
  sampledAt: string;
  elapsedMs: number;
  peerConnectionCount: number;
  trackCount: number;
  mixerInputCount: number;
  audioNodeCount: number;
  audioContextCount: number;
  timerCount: number;
  averageLossPercent: number;
  averageJitterMs: number;
  averageConcealmentPercent: number;
  recoveryCount: number;
  degradedPeerCount: number;
}

export class PeerStatsMonitor {
  private timer?: number;
  private readonly stats = new Map<string, PeerAudioStats>();
  private readonly progress = new Map<string, InboundAudioProgress>();
  private readonly connectedAt = new Map<string, number>();
  private readonly adaptationTiers = new Map<string, NetworkAdaptationTier>();
  private readonly healthStates = new Map<string, PeerHealthState>();
  private resourceStartedAt = 0;
  private lastResourceSampleAt = 0;
  private readonly resourceTrend: LongSessionAudioSnapshot[] = [];

  constructor(private readonly options: PeerStatsMonitorOptions) {}

  start(): void {
    this.stop();
    this.resourceStartedAt = Date.now();
    void this.collect();
    this.timer = window.setInterval(
      () => void this.collect(),
      this.options.intervalMs ?? DEFAULT_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.stats.clear();
    this.progress.clear();
    this.connectedAt.clear();
    this.adaptationTiers.clear();
    this.healthStates.clear();
    this.resourceTrend.length = 0;
    this.resourceStartedAt = 0;
    this.lastResourceSampleAt = 0;
  }

  markConnected(peerId: string): void {
    this.connectedAt.set(peerId, Date.now());
    this.progress.delete(peerId);
  }

  markDisconnected(peerId: string): void {
    this.progress.delete(peerId);
    this.connectedAt.delete(peerId);
  }

  forgetPeer(peerId: string): void {
    this.stats.delete(peerId);
    this.progress.delete(peerId);
    this.connectedAt.delete(peerId);
    this.adaptationTiers.delete(peerId);
    this.healthStates.delete(peerId);
  }

  getStats(): Record<string, PeerAudioStats> {
    return Object.fromEntries(this.stats);
  }

  getAdaptationTiers(): Record<string, NetworkAdaptationTier> {
    return Object.fromEntries(this.adaptationTiers);
  }

  getPeerHealth(): Record<string, PeerHealthSnapshot> {
    return Object.fromEntries(
      [...this.healthStates]
        .map(([peerId, state]) => [peerId, state.snapshot] as const)
        .filter((entry): entry is readonly [string, PeerHealthSnapshot] => Boolean(entry[1])),
    );
  }

  getLongSessionAudioTrend(): LongSessionAudioSnapshot[] {
    return this.resourceTrend.map((sample) => ({ ...sample }));
  }

  private async collect(): Promise<void> {
    await Promise.all(
      [...this.options.getPeers()].map(async ([peerId, peer]) => {
        try {
          const stats = await collectPeerAudioStats(peer.connection);
          const flow = this.evaluateAudioFlow(peerId, stats);
          const peerState = this.options.getPeerState(peerId);
          const recovery = this.options.getRecovery(peerId);
          this.healthStates.set(
            peerId,
            advancePeerHealth(this.healthStates.get(peerId) ?? createPeerHealthState(), {
              peerId,
              stats,
              iceState: peerState.iceState,
              packetsProgressing: flow?.progressed ?? false,
              recoveryCount: recovery.count,
              lastRecoveryAt: recovery.lastRecoveryAt,
            }),
          );
          this.stats.set(peerId, stats);
          this.options.onLatency?.(peerId, stats.roundTripTimeMs);
          const previousTier = this.adaptationTiers.get(peerId);
          const nextTier = await peer.adaptToNetwork(stats);
          this.adaptationTiers.set(peerId, nextTier);
          if (previousTier && previousTier !== nextTier) {
            this.options.onAdaptationChanged?.(peerId, previousTier, nextTier, stats);
          }
        } catch {
          this.stats.delete(peerId);
          this.adaptationTiers.delete(peerId);
          this.options.onLatency?.(peerId, undefined);
        }
      }),
    );
    this.captureResourceTrend();
    this.options.onStats?.(this.getStats());
  }

  private captureResourceTrend(): void {
    const now = Date.now();
    if (
      this.lastResourceSampleAt > 0 &&
      now - this.lastResourceSampleAt <
        (this.options.resourceSampleIntervalMs ?? DEFAULT_RESOURCE_SAMPLE_INTERVAL_MS)
    ) {
      return;
    }
    this.lastResourceSampleAt = now;
    const snapshots = [...this.stats.values()];
    const average = (values: Array<number | undefined>) => {
      const measured = values.filter((value): value is number => typeof value === "number");
      return measured.length
        ? measured.reduce((total, value) => total + value, 0) / measured.length
        : 0;
    };
    const resources = this.options.getResources();
    this.resourceTrend.push({
      sampledAt: new Date(now).toISOString(),
      elapsedMs: Math.max(0, now - this.resourceStartedAt),
      ...resources,
      averageLossPercent: average(snapshots.map((stats) => stats.packetLossPercent)),
      averageJitterMs: average(snapshots.map((stats) => stats.jitterMs)),
      averageConcealmentPercent: average(snapshots.map((stats) => stats.concealmentPercent)),
      recoveryCount: [...this.healthStates.values()].reduce(
        (total, state) => total + (state.snapshot?.recoveryCount ?? 0),
        0,
      ),
      degradedPeerCount: [...this.healthStates.values()].filter(
        (state) => state.snapshot && state.snapshot.level !== "healthy",
      ).length,
    });
    if (this.resourceTrend.length > MAX_RESOURCE_SAMPLES) this.resourceTrend.shift();
  }

  private evaluateAudioFlow(
    peerId: string,
    stats: PeerAudioStats,
  ): InboundAudioFlowEvaluation | undefined {
    const peerState = this.options.getPeerState(peerId);
    if (!peerState.isRemotePeer || !peerState.isConnected || !peerState.hasRemoteAudio) {
      return undefined;
    }

    const nowMs = Date.now();
    const connectedAtMs = this.connectedAt.get(peerId) ?? nowMs;
    this.connectedAt.set(peerId, connectedAtMs);
    const evaluation = evaluateInboundAudioFlow(stats, this.progress.get(peerId), {
      nowMs,
      connectedAtMs,
      isRemoteMuted: peerState.isRemoteMuted,
      isRemoteSpeaking: peerState.isRemoteSpeaking,
    });
    stats.inboundAudioFlow = evaluation.status;
    this.progress.set(peerId, evaluation.next);
    this.options.onFlowEvaluation(peerId, stats, evaluation);
    return evaluation;
  }
}

export const logPeerNetworkAdaptation = (
  peerId: string,
  previousTier: NetworkAdaptationTier,
  nextTier: NetworkAdaptationTier,
  stats: PeerAudioStats,
): void => {
  void writeRendererLog("webrtc", "info", "Peer network adaptation changed", {
    peerId,
    previousTier,
    nextTier,
    packetLossPercent: stats.packetLossPercent,
    jitterMs: stats.jitterMs,
    roundTripTimeMs: stats.roundTripTimeMs,
    concealmentPercent: stats.concealmentPercent,
    averageJitterBufferDelayMs: stats.averageJitterBufferDelayMs,
    availableOutgoingBitrateBps: stats.availableOutgoingBitrateBps,
  });
};
