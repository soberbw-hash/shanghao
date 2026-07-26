import {
  collectPeerAudioStats,
  evaluateInboundAudioFlow,
  type InboundAudioFlowEvaluation,
  type InboundAudioProgress,
  type MeshPeerConnection,
  type NetworkAdaptationTier,
  type PeerAudioStats,
} from "@private-voice/webrtc";

interface PeerStatsMonitorOptions {
  getPeers: () => Iterable<[string, MeshPeerConnection]>;
  getPeerState: (peerId: string) => {
    isRemotePeer: boolean;
    isConnected: boolean;
    hasRemoteAudio: boolean;
    isRemoteMuted: boolean;
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
}

const DEFAULT_INTERVAL_MS = 1_000;

export class PeerStatsMonitor {
  private timer?: number;
  private readonly stats = new Map<string, PeerAudioStats>();
  private readonly progress = new Map<string, InboundAudioProgress>();
  private readonly connectedAt = new Map<string, number>();
  private readonly adaptationTiers = new Map<string, NetworkAdaptationTier>();

  constructor(private readonly options: PeerStatsMonitorOptions) {}

  start(): void {
    this.stop();
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
  }

  getStats(): Record<string, PeerAudioStats> {
    return Object.fromEntries(this.stats);
  }

  getAdaptationTiers(): Record<string, NetworkAdaptationTier> {
    return Object.fromEntries(this.adaptationTiers);
  }

  private async collect(): Promise<void> {
    await Promise.all(
      [...this.options.getPeers()].map(async ([peerId, peer]) => {
        try {
          const stats = await collectPeerAudioStats(peer.connection);
          this.evaluateAudioFlow(peerId, stats);
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
    this.options.onStats?.(this.getStats());
  }

  private evaluateAudioFlow(peerId: string, stats: PeerAudioStats): void {
    const peerState = this.options.getPeerState(peerId);
    if (!peerState.isRemotePeer || !peerState.isConnected || !peerState.hasRemoteAudio) {
      return;
    }

    const nowMs = Date.now();
    const connectedAtMs = this.connectedAt.get(peerId) ?? nowMs;
    this.connectedAt.set(peerId, connectedAtMs);
    const evaluation = evaluateInboundAudioFlow(stats, this.progress.get(peerId), {
      nowMs,
      connectedAtMs,
      isRemoteMuted: peerState.isRemoteMuted,
    });
    stats.inboundAudioFlow = evaluation.status;
    this.progress.set(peerId, evaluation.next);
    this.options.onFlowEvaluation(peerId, stats, evaluation);
  }
}
