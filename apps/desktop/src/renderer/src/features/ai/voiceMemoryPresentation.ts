import {
  evaluateVoiceMemoryTranscriptionValidity,
  type AiAsrModelId,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptionStats,
} from "@private-voice/shared";

const clampPercent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const voiceMemoryStatsPercent = (
  stats: VoiceMemoryTranscriptionStats | undefined,
): number | undefined => {
  if (!stats) return undefined;
  if (evaluateVoiceMemoryTranscriptionValidity(stats).complete) return 100;
  if (stats.taskProgressPercent !== undefined) return clampPercent(stats.taskProgressPercent);
  if (stats.processedSpeechPercent !== undefined) return clampPercent(stats.processedSpeechPercent);
  if (stats.processedPercent !== undefined) return clampPercent(stats.processedPercent);
  if (stats.audioDurationMs > 0) {
    return clampPercent((stats.processedAudioMs / stats.audioDurationMs) * 100);
  }
  if (stats.totalUnits > 0) {
    return clampPercent((stats.completedUnits / stats.totalUnits) * 100);
  }
  return 0;
};

export const areVoiceMemoryStatsComplete = (
  stats: VoiceMemoryTranscriptionStats | undefined,
): boolean => evaluateVoiceMemoryTranscriptionValidity(stats).complete;

export const isVoiceMemoryTranscriptionComplete = (record: VoiceMemoryRecord): boolean => {
  if (record.phase === "transcribing" || record.phase === "paused") return false;
  if (record.transcriptionStats) return areVoiceMemoryStatsComplete(record.transcriptionStats);
  return (
    record.transcript.length > 0 &&
    (record.phase === "ready" || record.phase === "organizing") &&
    record.taskStatus !== "failed"
  );
};

/** Transcription occupies 0..70 of the combined transcription + organization progress scale. */
export const voiceMemoryTranscriptionPercent = (record: VoiceMemoryRecord): number => {
  const statsPercent = voiceMemoryStatsPercent(record.transcriptionStats);
  const hasActiveOrPausedTranscription =
    record.phase === "transcribing" ||
    (record.phase === "paused" && record.processingStage !== "organize");
  if (hasActiveOrPausedTranscription) {
    return Math.max(statsPercent ?? 0, clampPercent((record.progress / 70) * 100));
  }
  if (statsPercent !== undefined) return statsPercent;
  return isVoiceMemoryTranscriptionComplete(record) ? 100 : 0;
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
