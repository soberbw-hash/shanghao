import type { VoiceMemoryRecord } from "@private-voice/shared";
import type { KnownSpeakerTranscriptionSource } from "./speaker-transcript";
import { localAsrContextPrompt } from "./local-asr-context";
import { loadRecordingGameTimeline } from "./recording-participant-tracks";
import { recordingGameContextForRange } from "./recording-game-context";

/** Load only this recording's local snapshots; lack of evidence falls back to ordinary ASR. */
export async function prepareGameAsrContext(
  record: VoiceMemoryRecord,
  benchmark: boolean,
  signal: AbortSignal,
) {
  const timeline =
    record.localAsrAutoGameContext && !record.localAsrContext?.gameName && !benchmark
      ? await loadRecordingGameTimeline(record.recordingId).catch(() => undefined)
      : undefined;
  signal.throwIfAborted();
  return (source?: KnownSpeakerTranscriptionSource): string | undefined => {
    if (benchmark) return undefined;
    const automatic = source
      ? recordingGameContextForRange(
          timeline,
          record.roomId,
          source.accountIdentity,
          source.startMs,
          source.endMs,
        )
      : undefined;
    const gameName = record.localAsrContext?.gameName ?? automatic?.gameName;
    const terms = record.localAsrContext?.terms ?? [];
    return localAsrContextPrompt(
      gameName || terms.length ? { ...(gameName ? { gameName } : {}), terms } : undefined,
    );
  };
}
