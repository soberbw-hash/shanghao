import type { PeerAudioStats } from "./stats";

/** Preserve absolute RTP counters for stall detection, derive quality from the latest interval. */
export function intervalPeerAudioStats(
  current: PeerAudioStats,
  previous?: PeerAudioStats,
): PeerAudioStats {
  if (
    !previous ||
    current.inboundStreamId !== previous.inboundStreamId ||
    (current.packetsReceived ?? 0) < (previous.packetsReceived ?? 0) ||
    (current.totalSamplesReceived ?? 0) < (previous.totalSamplesReceived ?? 0)
  )
    return { ...current };
  const delta = (key: keyof PeerAudioStats): number | undefined => {
    const now = current[key],
      before = previous[key];
    return typeof now === "number" && typeof before === "number"
      ? Math.max(0, now - before)
      : undefined;
  };
  const received = delta("packetsReceived"),
    lost = delta("packetsLost");
  const samples = delta("totalSamplesReceived"),
    concealed = delta("concealedSamples");
  const emitted = delta("jitterBufferEmittedCount"),
    delay = delta("jitterBufferDelayMs");
  const targetDelay = delta("jitterBufferTargetDelayMs");
  return {
    ...current,
    receivedSamplesDelta: samples,
    outboundPacketsSentDelta: delta("outboundPacketsSent"),
    packetLossPercent:
      received !== undefined && lost !== undefined
        ? received + lost
          ? (lost / (received + lost)) * 100
          : 0
        : current.packetLossPercent,
    concealmentPercent:
      samples !== undefined && concealed !== undefined
        ? samples
          ? Math.min(100, (concealed / samples) * 100)
          : 0
        : current.concealmentPercent,
    averageJitterBufferDelayMs: emitted && delay !== undefined ? delay / emitted : undefined,
    averageJitterBufferTargetDelayMs:
      emitted && targetDelay !== undefined ? targetDelay / emitted : undefined,
  };
}

export interface PeerPlayoutState {
  bad: number;
  good: number;
  stalled: boolean;
}

export const evaluatePeerOutboundQuality = (
  stats: PeerAudioStats,
  previous: PeerPlayoutState | undefined,
  speaking: boolean,
): PeerPlayoutState =>
  evaluatePeerPlayoutQuality(
    {
      concealmentPercent: stats.outboundPacketLossPercent,
      receivedSamplesDelta: stats.outboundPacketsSentDelta === 0 ? 0 : undefined,
    },
    previous,
    {
      speaking,
      muted: !speaking,
      packetsProgressing: stats.outboundPacketsSentDelta !== undefined,
    },
  );
/** Active speech can be unusable even while RTP counters keep advancing. */
export function evaluatePeerPlayoutQuality(
  stats: PeerAudioStats,
  previous: PeerPlayoutState | undefined,
  context: { speaking: boolean; muted: boolean; packetsProgressing: boolean },
): PeerPlayoutState {
  if (context.muted || !context.speaking) return { bad: 0, good: 0, stalled: false };
  const damaged =
    context.packetsProgressing &&
    ((stats.concealmentPercent ?? 0) >= 25 ||
      ((stats.packetLossPercent ?? 0) >= 15 && (stats.concealmentPercent ?? 0) >= 8) ||
      (stats.averageJitterBufferDelayMs ?? 0) >= 600 ||
      stats.receivedSamplesDelta === 0);
  const bad = damaged ? (previous?.bad ?? 0) + 1 : 0;
  const good = damaged ? 0 : (previous?.good ?? 0) + 1;
  return { bad, good, stalled: bad >= 4 || (previous?.stalled === true && good < 3) };
}
