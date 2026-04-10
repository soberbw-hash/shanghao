export interface PeerAudioStats {
  jitterMs?: number;
  packetsLost?: number;
  roundTripTimeMs?: number;
  audioLevel?: number;
}

export const collectPeerAudioStats = async (
  peerConnection: RTCPeerConnection,
): Promise<PeerAudioStats> => {
  const stats = await peerConnection.getStats();
  const snapshot: PeerAudioStats = {};

  stats.forEach((report) => {
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      snapshot.roundTripTimeMs =
        typeof report.currentRoundTripTime === "number"
          ? Math.round(report.currentRoundTripTime * 1000)
          : undefined;
    }

    if (report.type === "inbound-rtp" && report.kind === "audio") {
      snapshot.jitterMs =
        typeof report.jitter === "number" ? Math.round(report.jitter * 1000) : undefined;
      snapshot.packetsLost =
        typeof report.packetsLost === "number" ? report.packetsLost : undefined;
    }

    if (report.type === "track" && report.kind === "audio") {
      snapshot.audioLevel =
        typeof report.audioLevel === "number"
          ? Math.round(report.audioLevel * 100)
          : undefined;
    }
  });

  return snapshot;
};
