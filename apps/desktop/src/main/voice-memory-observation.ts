import type { VoiceMemoryRecord, VoiceMemorySpeakingObservation } from "@private-voice/shared";

export const applySpeakingTimeline = (
  record: VoiceMemoryRecord,
  observations: VoiceMemorySpeakingObservation[],
): VoiceMemoryRecord => {
  if (!observations.length) return record;
  // Room observations arrive in timestamp order. Index that common path so a long
  // recording does not rescan every observation for every transcript segment.
  // Keep the original scan for imported/out-of-order timelines: its encounter
  // order is significant when two members receive an equal score.
  const chronological = observations.every(
    (observation, index) =>
      Number.isFinite(observation.offsetMs) &&
      (index === 0 || observations[index - 1]!.offsetMs <= observation.offsetMs),
  );
  const firstObservationAtOrAfter = (offsetMs: number): number => {
    let low = 0;
    let high = observations.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (observations[middle]!.offsetMs < offsetMs) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const updates = new Map<
    string,
    { memberId: string; nickname: string; confidence: "high" | "medium" }
  >();
  for (const speakerId of new Set(record.transcript.map((segment) => segment.speakerId))) {
    const scores = new Map<string, { memberId: string; nickname: string; count: number }>();
    for (const segment of record.transcript.filter((item) => item.speakerId === speakerId)) {
      const lowerBound = segment.startMs - 350;
      const upperBound = segment.endMs + 350;
      const firstIndex = chronological ? firstObservationAtOrAfter(lowerBound) : 0;
      for (let index = firstIndex; index < observations.length; index += 1) {
        const observation = observations[index]!;
        if (chronological && observation.offsetMs > upperBound) break;
        if (observation.offsetMs < lowerBound || observation.offsetMs > upperBound) continue;
        const current = scores.get(observation.memberId);
        scores.set(observation.memberId, {
          memberId: observation.memberId,
          nickname: observation.nickname,
          count: (current?.count ?? 0) + 1,
        });
      }
    }
    const ranked = [...scores.values()].sort((left, right) => right.count - left.count);
    const total = ranked.reduce((sum, item) => sum + item.count, 0);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || total === 0) continue;
    const share = best.count / total;
    if (share < 0.62 || (second && best.count < second.count * 1.45)) continue;
    updates.set(speakerId, {
      memberId: best.memberId,
      nickname: best.nickname,
      confidence: share >= 0.78 ? "high" : "medium",
    });
  }
  return {
    ...record,
    speakers: record.speakers.map((speaker) => ({
      ...speaker,
      ...(updates.get(speaker.speakerId) ?? {}),
    })),
    transcript: record.transcript.map((segment) => ({
      ...segment,
      ...(updates.get(segment.speakerId) ?? {}),
    })),
  };
};
