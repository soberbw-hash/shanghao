import type { AiAsrModelId, VoiceMemoryRecord } from "@private-voice/shared";

/** Transcription occupies 0..70 of the combined transcription + organization progress scale. */
export const voiceMemoryTranscriptionPercent = (record: VoiceMemoryRecord): number => {
  const hasActiveOrPausedTranscription =
    record.phase === "transcribing" ||
    (record.phase === "paused" && record.processingStage !== "organize");
  if (hasActiveOrPausedTranscription) {
    return Math.max(0, Math.min(100, Math.round((record.progress / 70) * 100)));
  }
  return record.transcript.length > 0 || record.phase === "organizing" || record.phase === "ready"
    ? 100
    : 0;
};

/** Whether the globally selected model has a saved result that should become visible now. */
export const shouldActivateVoiceMemoryVariant = (
  record: VoiceMemoryRecord | undefined,
  modelId: AiAsrModelId,
): boolean =>
  Boolean(
    record &&
    record.phase === "ready" &&
    record.transcriptionModel?.id !== modelId &&
    record.transcriptionVariants?.[modelId],
  );
