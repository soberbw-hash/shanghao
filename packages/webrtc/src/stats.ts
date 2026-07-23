export interface PeerAudioStats {
  jitterMs?: number;
  packetsLost?: number;
  packetsReceived?: number;
  bytesReceived?: number;
  totalSamplesReceived?: number;
  concealedSamples?: number;
  concealmentPercent?: number;
  lastPacketReceivedTimestampMs?: number;
  packetLossPercent?: number;
  roundTripTimeMs?: number;
  availableOutgoingBitrateBps?: number;
  audioLevel?: number;
  localCandidateType?: RTCIceCandidateType;
  remoteCandidateType?: RTCIceCandidateType;
  connectionType?: "p2p" | "relay" | "unknown";
  inboundAudioFlow?: InboundAudioFlowStatus;
}

export type InboundAudioFlowStatus = "warming" | "flowing" | "muted" | "stalled";

export interface InboundAudioProgress {
  bytesReceived?: number;
  packetsReceived?: number;
  stagnantSamples: number;
}

export interface InboundAudioFlowEvaluation {
  status: InboundAudioFlowStatus;
  progressed: boolean;
  next: InboundAudioProgress;
}

interface InboundAudioFlowContext {
  nowMs: number;
  connectedAtMs: number;
  isRemoteMuted: boolean;
  gracePeriodMs?: number;
  stalledSampleLimit?: number;
}

export const evaluateInboundAudioFlow = (
  stats: Pick<PeerAudioStats, "bytesReceived" | "packetsReceived">,
  previous: InboundAudioProgress | undefined,
  context: InboundAudioFlowContext,
): InboundAudioFlowEvaluation => {
  const nextCounters = {
    bytesReceived: stats.bytesReceived,
    packetsReceived: stats.packetsReceived,
  };
  if (!previous) {
    return {
      status: context.isRemoteMuted ? "muted" : "warming",
      progressed: false,
      next: { ...nextCounters, stagnantSamples: 0 },
    };
  }

  const hasByteCounter =
    typeof stats.bytesReceived === "number" && typeof previous.bytesReceived === "number";
  const hasPacketCounter =
    typeof stats.packetsReceived === "number" && typeof previous.packetsReceived === "number";
  const counterReset =
    (hasByteCounter && stats.bytesReceived! < previous.bytesReceived!) ||
    (hasPacketCounter && stats.packetsReceived! < previous.packetsReceived!);
  const progressed =
    (hasByteCounter && stats.bytesReceived! > previous.bytesReceived!) ||
    (hasPacketCounter && stats.packetsReceived! > previous.packetsReceived!);

  if (context.isRemoteMuted) {
    return {
      status: "muted",
      progressed,
      next: { ...nextCounters, stagnantSamples: 0 },
    };
  }
  if (progressed) {
    return {
      status: "flowing",
      progressed: true,
      next: { ...nextCounters, stagnantSamples: 0 },
    };
  }

  const gracePeriodMs = context.gracePeriodMs ?? 4_000;
  if (
    counterReset ||
    (!hasByteCounter && !hasPacketCounter) ||
    context.nowMs - context.connectedAtMs < gracePeriodMs
  ) {
    return {
      status: "warming",
      progressed: false,
      next: { ...nextCounters, stagnantSamples: 0 },
    };
  }

  const stagnantSamples = previous.stagnantSamples + 1;
  return {
    status: stagnantSamples >= (context.stalledSampleLimit ?? 3) ? "stalled" : "warming",
    progressed: false,
    next: { ...nextCounters, stagnantSamples },
  };
};

interface CandidatePairStats extends RTCStats {
  state?: string;
  selected?: boolean;
  nominated?: boolean;
  currentRoundTripTime?: number;
  localCandidateId?: string;
  remoteCandidateId?: string;
  availableOutgoingBitrate?: number;
}

interface CandidateStats extends RTCStats {
  candidateType?: RTCIceCandidateType;
}

export const collectPeerAudioStats = async (
  peerConnection: RTCPeerConnection,
): Promise<PeerAudioStats> => {
  const stats = await peerConnection.getStats();
  const snapshot: PeerAudioStats = {};
  let preferredCandidatePair: CandidatePairStats | undefined;
  let fallbackCandidatePair: CandidatePairStats | undefined;

  stats.forEach((report) => {
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      const candidatePair = report as CandidatePairStats;
      fallbackCandidatePair ??= candidatePair;
      if (candidatePair.selected === true || candidatePair.nominated === true) {
        preferredCandidatePair = candidatePair;
      }
    }

    if (report.type === "inbound-rtp" && report.kind === "audio") {
      snapshot.jitterMs =
        typeof report.jitter === "number" ? Math.round(report.jitter * 1000) : undefined;
      snapshot.packetsLost =
        typeof report.packetsLost === "number" ? report.packetsLost : undefined;
      snapshot.packetsReceived =
        typeof report.packetsReceived === "number" ? report.packetsReceived : undefined;
      snapshot.bytesReceived =
        typeof report.bytesReceived === "number" ? report.bytesReceived : undefined;
      snapshot.totalSamplesReceived =
        typeof report.totalSamplesReceived === "number" ? report.totalSamplesReceived : undefined;
      snapshot.concealedSamples =
        typeof report.concealedSamples === "number" ? report.concealedSamples : undefined;
      snapshot.lastPacketReceivedTimestampMs =
        typeof report.lastPacketReceivedTimestamp === "number"
          ? report.lastPacketReceivedTimestamp
          : undefined;
    }

    if (report.type === "track" && report.kind === "audio") {
      snapshot.audioLevel =
        typeof report.audioLevel === "number" ? Math.round(report.audioLevel * 100) : undefined;
    }
  });

  const candidatePair = preferredCandidatePair ?? fallbackCandidatePair;
  snapshot.roundTripTimeMs =
    candidatePair && typeof candidatePair.currentRoundTripTime === "number"
      ? Math.round(candidatePair.currentRoundTripTime * 1000)
      : undefined;
  snapshot.availableOutgoingBitrateBps =
    candidatePair && typeof candidatePair.availableOutgoingBitrate === "number"
      ? Math.max(0, Math.round(candidatePair.availableOutgoingBitrate))
      : undefined;

  const packetTotal = (snapshot.packetsReceived ?? 0) + Math.max(0, snapshot.packetsLost ?? 0);
  snapshot.packetLossPercent =
    packetTotal > 0
      ? Math.round((Math.max(0, snapshot.packetsLost ?? 0) / packetTotal) * 1_000) / 10
      : 0;
  snapshot.concealmentPercent =
    (snapshot.totalSamplesReceived ?? 0) > 0
      ? Math.round(
          (Math.max(0, snapshot.concealedSamples ?? 0) /
            Math.max(1, snapshot.totalSamplesReceived ?? 0)) *
            1_000,
        ) / 10
      : 0;

  const localCandidate = candidatePair?.localCandidateId
    ? (stats.get(candidatePair.localCandidateId) as CandidateStats | undefined)
    : undefined;
  const remoteCandidate = candidatePair?.remoteCandidateId
    ? (stats.get(candidatePair.remoteCandidateId) as CandidateStats | undefined)
    : undefined;
  snapshot.localCandidateType = localCandidate?.candidateType;
  snapshot.remoteCandidateType = remoteCandidate?.candidateType;
  snapshot.connectionType =
    localCandidate?.candidateType === "relay" || remoteCandidate?.candidateType === "relay"
      ? "relay"
      : localCandidate || remoteCandidate
        ? "p2p"
        : "unknown";

  return snapshot;
};
