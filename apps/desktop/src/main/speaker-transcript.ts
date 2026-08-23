import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";

export interface KnownSpeakerAudioSegment {
  speakerId: string;
  displayNameSnapshot: string;
  startMs: number;
  endMs: number;
}

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
