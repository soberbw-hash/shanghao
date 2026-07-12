export interface PeerAudioStats {
  jitterMs?: number;
  packetsLost?: number;
  packetsReceived?: number;
  packetLossPercent?: number;
  roundTripTimeMs?: number;
  audioLevel?: number;
  localCandidateType?: RTCIceCandidateType;
  remoteCandidateType?: RTCIceCandidateType;
  connectionType?: "p2p" | "relay" | "unknown";
}

interface CandidatePairStats extends RTCStats {
  state?: string;
  selected?: boolean;
  nominated?: boolean;
  currentRoundTripTime?: number;
  localCandidateId?: string;
  remoteCandidateId?: string;
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

  const packetTotal = (snapshot.packetsReceived ?? 0) + Math.max(0, snapshot.packetsLost ?? 0);
  snapshot.packetLossPercent =
    packetTotal > 0
      ? Math.round((Math.max(0, snapshot.packetsLost ?? 0) / packetTotal) * 1_000) / 10
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
