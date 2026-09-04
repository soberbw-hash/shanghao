import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";

export interface KnownSpeakerAudioSegment {
  speakerId: string;
  displayNameSnapshot: string;
  startMs: number;
  endMs: number;
}

export interface KnownParticipantAudioTrack extends KnownSpeakerAudioSegment {
  filePath: string;
  userId?: string;
  trackId?: string;
}

export interface KnownSpeakerTranscriptionSource extends KnownSpeakerAudioSegment {
  filePath: string;
  /** Offset inside this participant's independent audio file. */
  audioOffsetMs: number;
}

/**
 * Splits durable per-participant tracks into the same bounded units used by the
 * regular long-recording pipeline. The account user id becomes the stable
 * speaker id, so a reconnect cannot turn one person into two speakers.
 */
export const splitParticipantTracksIntoSpeakerSources = (
  tracks: readonly KnownParticipantAudioTrack[],
  rangeEndMs: number,
  chunkDurationMs: number,
  rangeStartMs = 0,
): KnownSpeakerTranscriptionSource[] => {
  if (rangeEndMs <= rangeStartMs || chunkDurationMs <= 0) return [];
  return [...tracks]
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        (left.userId ?? left.speakerId).localeCompare(right.userId ?? right.speakerId) ||
        (left.trackId ?? left.filePath).localeCompare(right.trackId ?? right.filePath),
    )
    .flatMap((track) => {
      const originalTrackStartMs = Math.max(0, track.startMs);
      const trackStartMs = Math.max(rangeStartMs, originalTrackStartMs);
      const trackEndMs = Math.min(rangeEndMs, Math.max(originalTrackStartMs, track.endMs));
      if (trackEndMs <= trackStartMs) return [];
      const speakerId = track.userId?.trim() || track.speakerId;
      const sources: KnownSpeakerTranscriptionSource[] = [];
      for (let startMs = trackStartMs; startMs < trackEndMs; startMs += chunkDurationMs) {
        sources.push({
          filePath: track.filePath,
          speakerId,
          displayNameSnapshot: track.displayNameSnapshot,
          startMs,
          endMs: Math.min(trackEndMs, startMs + chunkDurationMs),
          audioOffsetMs: startMs - originalTrackStartMs,
        });
      }
      return sources;
    });
};

export const bindTranscriptToKnownSpeaker = (
  recordingId: string,
  unit: number,
  source: KnownSpeakerAudioSegment,
  recognized: VoiceMemoryTranscriptSegment[],
): VoiceMemoryTranscriptSegment[] =>
  recognized.map((segment, index) => {
    const startMs = Math.max(source.startMs, source.startMs + segment.startMs);
    const endMs = Math.min(
      source.endMs,
      Math.max(source.startMs + segment.startMs + 1, source.startMs + segment.endMs),
    );
    return {
      ...segment,
      id: `${recordingId}-speaker-${unit}-${index}`,
      recordingId,
      startMs,
      endMs,
      ...(segment.words?.length
        ? {
            words: segment.words.map((word, wordIndex) => {
              const wordStartMs = Math.max(source.startMs, source.startMs + word.startMs);
              return {
                ...word,
                id: `${recordingId}-speaker-${unit}-${index}-word-${wordIndex}`,
                startMs: wordStartMs,
                endMs: Math.min(
                  source.endMs,
                  Math.max(wordStartMs + 1, source.startMs + word.endMs),
                ),
              };
            }),
          }
        : {}),
      speakerId: source.speakerId,
      memberId: source.speakerId,
      nickname: source.displayNameSnapshot,
      displayNameSnapshot: source.displayNameSnapshot,
      confidence: "high" as const,
    };
  });

export const mergeSpeakerTranscript = (
  retained: VoiceMemoryTranscriptSegment[],
  incoming: VoiceMemoryTranscriptSegment[],
): VoiceMemoryTranscriptSegment[] =>
  [...retained, ...incoming].sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
